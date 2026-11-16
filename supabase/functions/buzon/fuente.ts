// =====================================================================
// Lexpress — Función "buzon" (Supabase Edge Function)
//
// Recibe los correos de notificación (TJA, Portal de Servicios en Línea
// del PJF, etc.) que reenvía el script de Gmail del despacho, encuentra
// el expediente al que pertenecen y los deja en la Bandeja de
// publicaciones. Los PDF/imágenes adjuntos se guardan en el expediente.
//
// NO registra acuerdos: el abogado revisa la bandeja y los registra.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   BUZON_TOKEN  → clave larga y aleatoria; la misma va en el script de Gmail.
// Ajuste: Settings → "Verify JWT" APAGADO (Gmail no tiene sesión de Supabase;
// la protección es BUZON_TOKEN).
//
// ESTE ES EL CÓDIGO FUENTE. Para pegar en Supabase use index.ts, que se
// genera con `npm run generar:buzon` e incluye el motor de boletin.js.
// =====================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { decodeBase64 } from "jsr:@std/encoding@1.0.10/base64";
import { buscarEnBoletin } from "../../../boletin.js";

const MIME_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_ADJUNTO = 15 * 1024 * 1024;
const MAX_TEXTO = 6000;

type Adjunto = { nombre: string; mime: string; base64: string };
type Mensaje = { id?: string; de?: string; asunto?: string; fecha?: string; texto?: string; adjuntos?: Adjunto[] };
type FilaPublicacion = {
  fuente: string; origen: string; asunto: string; fecha_publicacion: string; expediente_id: string | null;
  juzgado_detectado: string; confianza: string; motivo: string; texto: string;
};
type Expediente = { id: string; numero: string; juzgado: string; cliente: string; contraparte: string; estado: string };

function fechaMexico(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(isNaN(d.getTime()) ? new Date() : d);
}

/** Comparación en tiempo constante para no filtrar la clave por tiempos de respuesta. */
export function mismaClave(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

async function guardarAdjuntos(sb: SupabaseClient, expedienteId: string, adjuntos: Adjunto[]): Promise<string | null> {
  let primero: string | null = null;
  for (const a of adjuntos) {
    if (!MIME_PERMITIDOS.includes(a.mime)) continue;
    const bytes = decodeBase64(a.base64);
    if (bytes.byteLength > MAX_ADJUNTO) continue;
    const limpio = (a.nombre || "adjunto").normalize("NFD").replace(/[^\w.\-]+/g, "_").slice(-80);
    const ruta = `${expedienteId}/${crypto.randomUUID()}-${limpio}`;
    const { error } = await sb.storage.from("expedientes").upload(ruta, bytes, { contentType: a.mime });
    if (error) { console.error("adjunto", error.message); continue; }
    const { data, error: e2 } = await sb.from("documentos").insert({
      expediente_id: expedienteId, nombre: a.nombre || limpio, ruta, mime: a.mime, tamano: bytes.byteLength,
    }).select("id").single();
    if (e2) { console.error("documento", e2.message); continue; }
    primero ??= data.id;
  }
  return primero;
}

export async function procesarMensajes(sb: SupabaseClient, mensajes: Mensaje[]) {
  const { data: exps, error } = await sb.from("expedientes").select("id, numero, juzgado, cliente, contraparte, estado").eq("estado", "activo");
  if (error) throw new Error(error.message);
  const resumen = { recibidos: mensajes.length, vinculadas: 0, sin_vincular: 0, duplicadas: 0, documentos: 0 };

  for (const m of mensajes) {
    const asunto = String(m.asunto ?? "").slice(0, 300);
    const cuerpo = String(m.texto ?? "").replace(/\r\n?/g, "\n").trim();
    const completo = `${asunto}\n${cuerpo}`;
    const fecha = fechaMexico(m.fecha);
    const base = { fuente: "correo", origen: String(m.de ?? "").slice(0, 200), asunto, fecha_publicacion: fecha };
    const hallazgos = buscarEnBoletin(completo, (exps ?? []) as Expediente[]);
    // Un correo puede mencionar varios expedientes; uno por expediente.
    const porExpediente = new Map<string, (typeof hallazgos)[number]>();
    const rango = { alta: 3, media: 2, baja: 1 } as Record<string, number>;
    for (const h of hallazgos) {
      const previo = porExpediente.get(h.expediente_id);
      if (!previo || rango[h.confianza] > rango[previo.confianza]) porExpediente.set(h.expediente_id, h);
    }

    const filas: FilaPublicacion[] = porExpediente.size
      ? [...porExpediente.values()].map((h) => ({
        ...base, expediente_id: h.expediente_id, juzgado_detectado: h.juzgado_detectado,
        confianza: h.confianza, motivo: h.motivo, texto: completo.slice(0, MAX_TEXTO),
      }))
      : [{ ...base, expediente_id: null, juzgado_detectado: "", confianza: "baja", motivo: "No se encontró un expediente del despacho en el correo", texto: completo.slice(0, MAX_TEXTO) }];

    for (const fila of filas) {
      const { data: insertada, error: e } = await sb.from("publicaciones")
        .upsert(fila, { onConflict: "huella", ignoreDuplicates: true }).select("id");
      if (e) throw new Error(e.message);
      if (!insertada?.length) { resumen.duplicadas++; continue; }
      if (fila.expediente_id) {
        resumen.vinculadas++;
        if (m.adjuntos?.length) {
          const doc = await guardarAdjuntos(sb, fila.expediente_id, m.adjuntos);
          if (doc) {
            resumen.documentos++;
            await sb.from("publicaciones").update({ documento_id: doc }).eq("id", insertada[0].id);
          }
        }
      } else {
        resumen.sin_vincular++;
      }
    }
  }
  return resumen;
}

function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
}

export async function manejar(req: Request): Promise<Response> {
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);
  const token = Deno.env.get("BUZON_TOKEN") ?? "";
  if (token.length < 24) return responder({ error: "Falta configurar BUZON_TOKEN (mínimo 24 caracteres)" }, 500);
  if (!mismaClave(req.headers.get("x-lexpress-token") ?? "", token)) return responder({ error: "No autorizado" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const llave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !llave) return responder({ error: "Configuración de Supabase incompleta" }, 500);

  let cuerpo: { mensajes?: Mensaje[] };
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: "Solicitud inválida" }, 400);
  }
  if (!Array.isArray(cuerpo.mensajes) || cuerpo.mensajes.length > 50) return responder({ error: "Envíe entre 1 y 50 mensajes" }, 400);

  const sb = createClient(url, llave, { auth: { persistSession: false } });
  try {
    return responder(await procesarMensajes(sb, cuerpo.mensajes));
  } catch (e) {
    console.error(e);
    return responder({ error: (e as Error).message }, 500);
  }
}

if (!Deno.env.get("BUZON_NO_SERVE")) Deno.serve(manejar);
