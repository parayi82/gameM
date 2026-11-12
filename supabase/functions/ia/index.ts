// =====================================================================
// Lexpress — Función "ia" (Supabase Edge Function, Deno)
//
// Tres agentes especializados, todos con el mismo control de acceso:
//   extraer   → lee un documento escaneado (PDF/imagen) y propone los
//               acuerdos, fechas y términos que contiene.
//   analizar  → razona en qué etapa va el juicio y qué sigue.
//   redactar  → elabora el borrador del escrito que corresponde.
//
// La IA SOLO PROPONE: el abogado confirma cada acuerdo y da el visto bueno
// a cada escrito antes de imprimirlo. Toda lectura/escritura se hace con
// la sesión del abogado (su JWT), así que aplican las mismas reglas de
// seguridad (RLS + 2FA) que en la app.
//
// Secreto requerido (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY
// =====================================================================
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";

export const MODELO = "claude-opus-5-5";
const MAX_BYTES_DOCUMENTO = 22 * 1024 * 1024; // límite por archivo enviado a la IA
const MAX_BYTES_CONTEXTO = 18 * 1024 * 1024; // suma de archivos adjuntos al analizar/redactar
const MAX_DOCS_CONTEXTO = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --------------------------------------------------------------------------
// Conocimiento procesal (la "skill" de los agentes)
// --------------------------------------------------------------------------
export const CONOCIMIENTO_PROCESAL = `
GUÍA DE ETAPAS PROCESALES (México). Úsala como mapa; ajusta siempre a la legislación
que corresponda según el juzgado (código procesal local de la entidad, Código de Comercio,
Ley Federal del Trabajo, Ley de Amparo, CNPCF, CNPP, etc.).

CIVIL / FAMILIAR (escrito tradicional; el Código Nacional de Procedimientos Civiles y
Familiares entra en vigor gradualmente por entidad: verifica cuál aplica):
 1. Demanda y auto admisorio (o prevención / desechamiento).
 2. Emplazamiento.
 3. Contestación, excepciones y reconvención (y contestación a la reconvención).
 4. Vista / réplica y dúplica cuando proceda.
 5. Audiencia previa / de conciliación y depuración.
 6. Ofrecimiento de pruebas → admisión → preparación y desahogo.
 7. Alegatos.
 8. Citación para sentencia y sentencia.
 9. Recursos (revocación, apelación) → amparo directo.
 10. Ejecución de sentencia.
 Familiar: medidas provisionales, pensión alimenticia, guarda y custodia, convivencias
 pueden tramitarse incidentalmente en cualquier etapa.

MERCANTIL (Código de Comercio):
 - Ejecutivo mercantil: demanda con título ejecutivo → auto de exequendo (requerimiento
   de pago, embargo y emplazamiento) → contestación y excepciones (8 días) → pruebas →
   alegatos → sentencia → apelación → remate/ejecución.
 - Oral mercantil: demanda → emplazamiento → contestación → audiencia preliminar
   (depuración, conciliación, fijación de la litis, admisión de pruebas) → audiencia de
   juicio (desahogo, alegatos, sentencia).
 - Ordinario mercantil: demanda → contestación (15 días) → pruebas → alegatos → sentencia.

LABORAL (LFT, reforma 2019):
 1. Conciliación prejudicial (Centro de Conciliación) → constancia de no conciliación.
 2. Demanda ante Tribunal Laboral → admisión / prevención.
 3. Emplazamiento → contestación (15 días hábiles), reconvención.
 4. Réplica (8 días) → contrarréplica (5 días).
 5. Audiencia preliminar (depuración, admisión de pruebas).
 6. Audiencia de juicio (desahogo de pruebas, alegatos, sentencia).
 7. Amparo directo. Ejecución.
 Procedimientos especiales y huelga tienen reglas propias.

AMPARO (Ley de Amparo):
 - Indirecto: demanda → admisión / prevención / desechamiento → suspensión provisional
   e incidente de suspensión (audiencia incidental, suspensión definitiva) → informes
   justificados → audiencia constitucional → sentencia → recurso de revisión (10 días).
 - Directo: demanda presentada ante la autoridad responsable → admisión por el
   Tribunal Colegiado → amparo adhesivo / alegatos (15 días) → sentencia.
 - Recursos: queja, revisión, reclamación (plazos cortos: verificar).

PENAL ACUSATORIO (CNPP):
 Etapa de investigación (inicial y complementaria: audiencia inicial, control de
 detención, formulación de imputación, vinculación a proceso, medidas cautelares,
 plazo de cierre) → etapa intermedia (acusación, descubrimiento probatorio, audiencia
 intermedia, auto de apertura) → juicio oral (fallo, individualización, sentencia) →
 recursos (apelación) → amparo. Salidas alternas y procedimiento abreviado.

ESCRITOS FRECUENTES: contestación de demanda, desahogo de vista, desahogo de prevención,
ofrecimiento de pruebas, objeción de documentos, alegatos, solicitud de copias,
autorización de abogados/notificaciones, solicitud de fecha de audiencia, se tenga por
precluido un derecho / acuse de rebeldía, exhibición de documentos, recurso de
revocación / apelación, incidente, promoción de impulso procesal, solicitud de
ejecución, cumplimiento de requerimiento.
`;

const REGLAS_BASE = `Eres un asistente jurídico de un despacho de abogados litigantes en México.
Trabajas SIEMPRE bajo la supervisión de un abogado titulado que revisa todo lo que produces.

Reglas obligatorias:
- Nunca inventes hechos, nombres, fechas, montos, números de expediente ni datos que no
  estén en los documentos o en la información del expediente.
- Cuando falte un dato escribe exactamente [COMPLETAR: descripción del dato].
- No inventes jurisprudencia ni tesis. Cita artículos de ley solo cuando tengas
  seguridad razonable; si dudas del numeral o de la vigencia escribe [VERIFICAR] junto a la cita.
- Las fechas van en formato AAAA-MM-DD en los campos de fecha. Si una fecha no aparece o
  es ilegible, deja el campo vacío ("").
- Escribe en español jurídico mexicano, claro y formal.
- Si un documento es ilegible o no corresponde a un expediente judicial, dilo.
${CONOCIMIENTO_PROCESAL}`;

// --------------------------------------------------------------------------
// Esquemas de salida (structured outputs)
// --------------------------------------------------------------------------
const texto = { type: "string" };
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});

export const ESQUEMA_EXTRACCION = obj({
  tipo_documento: { type: "string", description: "acuerdo, auto, sentencia, demanda, contestación, promoción, notificación, cédula, oficio, otro" },
  legible: { type: "boolean" },
  resumen: texto,
  expediente: obj({
    numero: texto, juzgado: texto, materia: texto, tipo_juicio: texto, actor: texto, demandado: texto,
  }),
  acuerdos: {
    type: "array",
    items: obj({
      fecha_acuerdo: texto,
      fecha_publicacion: texto,
      fecha_notificacion: texto,
      sintesis: { type: "string", description: "Síntesis breve de lo que acuerda el juzgado y lo que se debe hacer" },
      texto_relevante: { type: "string", description: "Transcripción literal de la parte medular del acuerdo" },
      dias_termino: { type: "integer", description: "Días del término concedido; 0 si no concede término" },
      tipo_dias: { type: "string", enum: ["habiles", "naturales", "ninguno"] },
      a_cargo_de_nuestro_cliente: { type: "boolean", description: "true si el término o requerimiento corre a cargo de la parte que representa el despacho" },
      accion_requerida: texto,
      confianza: { type: "string", enum: ["alta", "media", "baja"] },
    }),
  },
  observaciones: texto,
});

export const ESQUEMA_ANALISIS = obj({
  tipo_juicio: texto,
  legislacion_aplicable: { type: "array", items: texto },
  etapa_actual: texto,
  explicacion_etapa: texto,
  etapas: {
    type: "array",
    items: obj({ nombre: texto, estado: { type: "string", enum: ["concluida", "actual", "pendiente"] } }),
  },
  ultimo_acontecimiento: texto,
  siguiente_paso: texto,
  acciones: {
    type: "array",
    items: obj({
      prioridad: { type: "string", enum: ["urgente", "alta", "normal"] },
      accion: texto,
      fundamento: texto,
      fecha_limite: texto,
      escrito_sugerido: { type: "string", description: "Título del escrito a elaborar, o vacío si no requiere escrito" },
    }),
  },
  riesgos: { type: "array", items: texto },
  datos_faltantes: { type: "array", items: texto },
});

export const ESQUEMA_ESCRITO = obj({
  titulo: texto,
  contenido: { type: "string", description: "Texto completo del escrito listo para imprimir. Párrafos separados por una línea en blanco." },
  fundamentos: { type: "array", items: texto },
  datos_por_completar: { type: "array", items: texto },
  notas_para_el_abogado: texto,
});

// --------------------------------------------------------------------------
// Utilidades puras (probadas en tests/ia.test.ts)
// --------------------------------------------------------------------------
export function hoyMexico(fecha = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(fecha);
}

type Fila = Record<string, unknown>;

export function describirExpediente(exp: Fila): string {
  const c = (k: string) => String(exp[k] ?? "").trim() || "(sin dato)";
  return [
    `Expediente: ${c("numero")}`,
    `Juzgado / tribunal: ${c("juzgado")}`,
    `Materia: ${c("materia")}`,
    `Tipo de juicio: ${c("tipo_juicio")}`,
    `Nuestro cliente: ${c("cliente")}`,
    `Parte que representamos: ${c("representa")}`,
    `Contraparte: ${c("contraparte")}`,
    `Etapa registrada: ${c("etapa")}`,
    `Notas del abogado: ${c("notas")}`,
  ].join("\n");
}

export function describirAcuerdos(acuerdos: Fila[]): string {
  if (!acuerdos.length) return "(sin acuerdos registrados)";
  return acuerdos
    .map((a) =>
      `- Notificado ${a.fecha_notificacion ?? "?"}; vence ${a.fecha_vencimiento ?? "sin término"}; ` +
      `estado ${a.estado}: ${a.descripcion}${a.nota_atencion ? ` (atendido: ${a.nota_atencion})` : ""}`
    )
    .join("\n");
}

export function describirDocumentos(docs: Fila[]): string {
  if (!docs.length) return "(sin documentos)";
  return docs
    .map((d) => {
      const x = (d.extraccion ?? null) as Fila | null;
      if (!x) return `- ${d.nombre}: (no leído por la IA)`;
      const acs = ((x.acuerdos ?? []) as Fila[])
        .map((a) => `    · ${a.fecha_acuerdo || a.fecha_notificacion || "s/f"}: ${a.sintesis}`)
        .join("\n");
      return `- ${d.nombre} [${x.tipo_documento}]: ${x.resumen}${acs ? "\n" + acs : ""}`;
    })
    .join("\n");
}

export function describirEscritos(escritos: Fila[]): string {
  if (!escritos.length) return "(ninguno)";
  return escritos.map((e) => `- ${e.titulo} (${e.estado}${e.presentado_at ? `, presentado ${e.presentado_at}` : ""})`).join("\n");
}

export function bloqueArchivo(mime: string, base64: string, titulo: string): Anthropic.Beta.BetaContentBlockParam {
  if (mime === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 }, title: titulo };
  }
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
    return { type: "image", source: { type: "base64", media_type: mime, data: base64 } };
  }
  throw new Error(`Tipo de archivo no soportado: ${mime}`);
}

export function textoSalida(msg: Anthropic.Beta.BetaMessage): string {
  if (msg.stop_reason === "refusal") {
    throw new Error("La IA no pudo procesar esta solicitud. Revise el documento o reformule la instrucción.");
  }
  if (msg.stop_reason === "max_tokens") {
    throw new Error("La respuesta de la IA quedó incompleta (demasiado larga). Intente con menos documentos o instrucciones más acotadas.");
  }
  const t = msg.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("");
  if (!t) throw new Error("La IA no devolvió respuesta.");
  return t;
}

// --------------------------------------------------------------------------
// Llamada a Claude
// --------------------------------------------------------------------------
export async function preguntarAClaude<T>(
  claude: Anthropic,
  opts: { system: string; content: Anthropic.Beta.BetaContentBlockParam[]; esquema: Record<string, unknown>; effort: "low" | "medium" | "high"; maxTokens?: number },
): Promise<T> {
  const stream = claude.beta.messages.stream({
    model: MODELO,
    max_tokens: opts.maxTokens ?? 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // si el modelo declina, el servidor reintenta con otro modelo
    system: opts.system,
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.esquema } },
    messages: [{ role: "user", content: opts.content }],
  });
  const msg = await stream.finalMessage();
  return JSON.parse(textoSalida(msg)) as T;
}

// --------------------------------------------------------------------------
// Acceso a datos con la sesión del abogado
// --------------------------------------------------------------------------
async function revisar<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function descargarBase64(sb: SupabaseClient, ruta: string): Promise<{ b64: string; bytes: number }> {
  const { data, error } = await sb.storage.from("expedientes").download(ruta);
  if (error || !data) throw new Error(`No se pudo leer el archivo: ${error?.message ?? ruta}`);
  const buf = new Uint8Array(await data.arrayBuffer());
  return { b64: encodeBase64(buf), bytes: buf.byteLength };
}

async function cargarContexto(sb: SupabaseClient, expedienteId: string) {
  const exp = await revisar(sb.from("expedientes").select("*").eq("id", expedienteId).maybeSingle());
  if (!exp) throw new Error("Expediente no encontrado o sin permiso.");
  const [acuerdos, docs, escritos] = await Promise.all([
    revisar(sb.from("acuerdos").select("*").eq("expediente_id", expedienteId).order("fecha_notificacion")),
    revisar(sb.from("documentos").select("*").eq("expediente_id", expedienteId).order("creado_at")),
    revisar(sb.from("escritos").select("titulo, estado, presentado_at").eq("expediente_id", expedienteId).order("creado_at")),
  ]);
  return { exp: exp as Fila, acuerdos: acuerdos as Fila[], docs: docs as Fila[], escritos: escritos as Fila[] };
}

/** Adjunta los documentos más recientes (hasta el límite) para que la IA los lea directamente. */
async function adjuntarRecientes(sb: SupabaseClient, docs: Fila[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const bloques: Anthropic.Beta.BetaContentBlockParam[] = [];
  let total = 0;
  for (const d of [...docs].reverse()) {
    if (bloques.length >= MAX_DOCS_CONTEXTO) break;
    const tam = Number(d.tamano ?? 0);
    if (total + tam > MAX_BYTES_CONTEXTO) continue;
    const { b64, bytes } = await descargarBase64(sb, String(d.ruta));
    total += bytes;
    bloques.unshift(bloqueArchivo(String(d.mime), b64, String(d.nombre)));
  }
  return bloques;
}

function contextoTexto(c: Awaited<ReturnType<typeof cargarContexto>>): string {
  return [
    `FECHA DE HOY: ${hoyMexico()}`,
    "",
    "DATOS DEL EXPEDIENTE:",
    describirExpediente(c.exp),
    "",
    "ACUERDOS REGISTRADOS:",
    describirAcuerdos(c.acuerdos),
    "",
    "DOCUMENTOS DEL EXPEDIENTE (lectura previa de la IA):",
    describirDocumentos(c.docs),
    "",
    "ESCRITOS YA ELABORADOS:",
    describirEscritos(c.escritos),
  ].join("\n");
}

// --------------------------------------------------------------------------
// Agentes
// --------------------------------------------------------------------------
async function agenteExtraer(sb: SupabaseClient, claude: Anthropic, documentoId: string) {
  const doc = await revisar(sb.from("documentos").select("*").eq("id", documentoId).maybeSingle()) as Fila | null;
  if (!doc) throw new Error("Documento no encontrado o sin permiso.");
  if (Number(doc.tamano) > MAX_BYTES_DOCUMENTO) {
    throw new Error("El archivo es demasiado grande para leerlo de una vez (máx. 22 MB). Divídalo en partes.");
  }
  await revisar(sb.from("documentos").update({ estado_ia: "procesando", error_ia: "" }).eq("id", documentoId));
  try {
    const c = await cargarContexto(sb, String(doc.expediente_id));
    const { b64 } = await descargarBase64(sb, String(doc.ruta));
    const extraccion = await preguntarAClaude<Fila>(claude, {
      system: REGLAS_BASE + `
TAREA: Eres el LECTOR de documentos del despacho. Lee el documento escaneado adjunto y
extrae con precisión cada acuerdo, auto o resolución que contenga: sus fechas (del acuerdo,
de publicación en boletín/lista y de notificación), lo que ordena, el término que concede
(días y si son hábiles o naturales) y si corre a cargo de nuestro cliente. No calcules
fechas de vencimiento: el sistema las calcula con el calendario de días inhábiles.
Si la fecha de notificación no aparece, déjala vacía. Usa el contexto del expediente
para saber cuál es nuestra parte y no repetir acuerdos ya registrados (puedes mencionarlos
en observaciones).`,
      content: [
        bloqueArchivo(String(doc.mime), b64, String(doc.nombre)),
        { type: "text", text: `${contextoTexto({ ...c, docs: [] })}\n\nLee el documento adjunto "${doc.nombre}".` },
      ],
      esquema: ESQUEMA_EXTRACCION,
      effort: "medium",
    });
    await revisar(sb.from("documentos").update({ estado_ia: "procesado", extraccion }).eq("id", documentoId));
    return { extraccion };
  } catch (e) {
    await sb.from("documentos").update({ estado_ia: "error", error_ia: String((e as Error).message).slice(0, 500) }).eq("id", documentoId);
    throw e;
  }
}

async function agenteAnalizar(sb: SupabaseClient, claude: Anthropic, expedienteId: string) {
  const c = await cargarContexto(sb, expedienteId);
  const adjuntos = await adjuntarRecientes(sb, c.docs);
  const resultado = await preguntarAClaude<Fila>(claude, {
    system: REGLAS_BASE + `
TAREA: Eres el ANALISTA PROCESAL del despacho. Con los datos del expediente, los acuerdos
registrados y los documentos adjuntos, determina:
- el tipo de juicio y la legislación aplicable (según el juzgado y la materia);
- la etapa procesal actual, explicada en términos claros;
- el mapa de etapas (concluidas, actual, pendientes);
- el último acontecimiento procesal y el siguiente paso concreto;
- las acciones que debe realizar NUESTRA parte, priorizadas, con su fundamento, fecha
  límite (si hay un acuerdo registrado con vencimiento, usa esa fecha; no la recalcules)
  y el escrito que corresponde elaborar;
- riesgos (preclusión, caducidad, rebeldía, etc.) y datos que faltan para un mejor análisis.
Sé concreto y práctico: el abogado usará esto para decidir qué presentar.`,
    content: [...adjuntos, { type: "text", text: contextoTexto(c) + "\n\nAnaliza el juicio." }],
    esquema: ESQUEMA_ANALISIS,
    effort: "high",
  });
  const fila = await revisar(sb.from("analisis").insert({ expediente_id: expedienteId, resultado, modelo: MODELO }).select().single());
  const cambios: Fila = { etapa: String(resultado.etapa_actual ?? "").slice(0, 200) };
  if (!String(c.exp.tipo_juicio ?? "").trim()) cambios.tipo_juicio = String(resultado.tipo_juicio ?? "").slice(0, 200);
  await revisar(sb.from("expedientes").update(cambios).eq("id", expedienteId));
  return { analisis: fila };
}

async function agenteRedactar(
  sb: SupabaseClient, claude: Anthropic,
  p: { expediente_id: string; tipo_escrito: string; instrucciones?: string; acuerdo_id?: string | null },
) {
  if (!p.tipo_escrito?.trim()) throw new Error("Indique qué escrito se debe elaborar.");
  const c = await cargarContexto(sb, p.expediente_id);
  const adjuntos = await adjuntarRecientes(sb, c.docs);
  const acuerdo = p.acuerdo_id ? c.acuerdos.find((a) => a.id === p.acuerdo_id) : null;
  const pedido = [
    `ESCRITO SOLICITADO: ${p.tipo_escrito.trim()}`,
    acuerdo ? `EN RELACIÓN CON EL ACUERDO: notificado ${acuerdo.fecha_notificacion}, vence ${acuerdo.fecha_vencimiento ?? "s/t"}: ${acuerdo.descripcion}` : "",
    p.instrucciones?.trim() ? `INSTRUCCIONES DEL ABOGADO: ${p.instrucciones.trim()}` : "",
  ].filter(Boolean).join("\n");
  const r = await preguntarAClaude<Fila>(claude, {
    system: REGLAS_BASE + `
TAREA: Eres el REDACTOR del despacho. Elabora el escrito solicitado, completo y listo para
que el abogado lo revise, firme y presente. Estructura habitual:
1. Rubro (derecha): número de expediente, juicio/vía, actor vs. demandado y "ESCRITO: ...".
2. Destinatario: "C. JUEZ ..." (o el órgano que corresponda, tomado del expediente).
3. Proemio: nombre de quien promueve y su carácter [COMPLETAR si no consta], domicilio
   procesal y autorizados [COMPLETAR], y la frase de comparecencia.
4. Cuerpo: exposición ordenada (antecedentes/hechos, manifestaciones, agravios o pruebas,
   según el tipo de escrito) basada únicamente en lo que consta en el expediente y documentos.
5. Fundamentos de derecho (con [VERIFICAR] donde haya duda).
6. Puntos petitorios numerados ("PRIMERO.-", "SEGUNDO.-", ...).
7. "PROTESTO LO NECESARIO", lugar y fecha [COMPLETAR si no consta], y línea de firma.
Usa MAYÚSCULAS solo en encabezados y nombres de partes. No uses markdown (ni #, ni **).
En "datos_por_completar" lista todo lo que dejaste como [COMPLETAR] o [VERIFICAR].`,
    content: [...adjuntos, { type: "text", text: contextoTexto(c) + "\n\n" + pedido }],
    esquema: ESQUEMA_ESCRITO,
    effort: "high",
  });
  const escrito = await revisar(sb.from("escritos").insert({
    expediente_id: p.expediente_id,
    acuerdo_id: p.acuerdo_id || null,
    titulo: String(r.titulo || p.tipo_escrito).slice(0, 300),
    contenido: String(r.contenido ?? ""),
    generado_ia: true,
    notas_ia: { fundamentos: r.fundamentos, datos_por_completar: r.datos_por_completar, notas: r.notas_para_el_abogado, modelo: MODELO },
  }).select().single());
  return { escrito };
}

// --------------------------------------------------------------------------
// Servidor HTTP
// --------------------------------------------------------------------------
function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function manejar(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return responder({ error: "Sesión requerida" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const llave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!url || !anon) return responder({ error: "Configuración de Supabase incompleta" }, 500);
  if (!llave) return responder({ error: "Falta configurar ANTHROPIC_API_KEY en los secretos de la función" }, 500);

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: autorizado, error: errAuth } = await sb.rpc("es_abogado");
  if (errAuth || autorizado !== true) {
    return responder({ error: "Acceso denegado: se requiere cuenta activa con verificación en dos pasos" }, 403);
  }

  let cuerpo: Fila;
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: "Solicitud inválida" }, 400);
  }

  const claude = new Anthropic({ apiKey: llave });
  try {
    switch (cuerpo.accion) {
      case "extraer":
        return responder(await agenteExtraer(sb, claude, String(cuerpo.documento_id)));
      case "analizar":
        return responder(await agenteAnalizar(sb, claude, String(cuerpo.expediente_id)));
      case "redactar":
        return responder(await agenteRedactar(sb, claude, cuerpo as never));
      default:
        return responder({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return responder({ error: "La IA está saturada; intente en un minuto." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return responder({ error: "La llave de Anthropic no es válida." }, 500);
    if (e instanceof Anthropic.APIError) return responder({ error: `Error de la IA (${e.status}): ${e.message}` }, 502);
    console.error(e);
    return responder({ error: (e as Error).message || String(e) }, 500);
  }
}

if (!Deno.env.get("IA_NO_SERVE")) Deno.serve(manejar);
