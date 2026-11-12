// Pruebas de la función "ia" con Supabase y Claude simulados (sin red ni costo).
// Ejecutar:  npm run test:ia   (requiere Deno)
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";

type Peticion = { metodo: string; ruta: string; cuerpo: string; headers: Headers };
const peticiones: Peticion[] = [];
let autorizado = true;
let respuestaClaude: Record<string, unknown> = {};
let stopReason = "end_turn";

const EXP = { id: "exp1", numero: "845/2026", juzgado: "Juzgado 3º Civil de Guadalajara", materia: "Civil", cliente: "ACME SA", representa: "Demandado", contraparte: "Juan Pérez", tipo_juicio: "", etapa: "", notas: "" };
const DOC = { id: "doc1", expediente_id: "exp1", nombre: "acuerdo.pdf", ruta: "exp1/acuerdo.pdf", mime: "application/pdf", tamano: 9, extraccion: null };
const PDF = new TextEncoder().encode("%PDF-1.4 x");

function sse(texto: string, stop: string) {
  const ev = (tipo: string, data: unknown) => `event: ${tipo}\ndata: ${JSON.stringify(data)}\n\n`;
  return ev("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }) +
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: texto } }) +
    ev("content_block_stop", { type: "content_block_stop", index: 0 }) +
    ev("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }) +
    ev("message_stop", { type: "message_stop" });
}

const servidor = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  const u = new URL(req.url);
  const cuerpo = req.method === "GET" ? "" : await req.text();
  peticiones.push({ metodo: req.method, ruta: u.pathname + u.search, cuerpo, headers: req.headers });
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
  const objeto = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
  const filas = (arr: unknown[]) => objeto ? json(arr[0] ?? null) : json(arr);

  if (u.pathname === "/v1/messages") return new Response(sse(JSON.stringify(respuestaClaude), stopReason), { headers: { "content-type": "text/event-stream" } });
  if (u.pathname === "/rest/v1/rpc/es_abogado") return json(autorizado);
  if (u.pathname.startsWith("/storage/v1/object/")) return new Response(PDF, { headers: { "content-type": "application/pdf" } });
  if (u.pathname === "/rest/v1/expedientes") return req.method === "GET" ? filas([EXP]) : new Response(null, { status: 204 });
  if (u.pathname === "/rest/v1/documentos") return req.method === "GET" ? filas([DOC]) : new Response(null, { status: 204 });
  if (u.pathname === "/rest/v1/acuerdos") return filas([]);
  if (u.pathname === "/rest/v1/escritos") {
    if (req.method === "POST") return filas([{ id: "esc1", ...JSON.parse(cuerpo) }]);
    return filas([]);
  }
  if (u.pathname === "/rest/v1/analisis") return filas([{ id: "an1", ...JSON.parse(cuerpo) }]);
  return json({ message: "no simulado: " + u.pathname }, 404);
});
const base = `http://127.0.0.1:${servidor.addr.port}`;

Deno.env.set("IA_NO_SERVE", "1");
Deno.env.set("SUPABASE_URL", base);
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("ANTHROPIC_API_KEY", "sk-prueba");
Deno.env.set("ANTHROPIC_BASE_URL", base);
const prueba = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const ia = await import("../supabase/functions/ia/index.ts");

const llamar = (cuerpo: unknown, token = "Bearer jwt-abogado") =>
  ia.manejar(new Request("http://x/ia", { method: "POST", headers: { Authorization: token, "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
const aClaude = () => peticiones.filter((p) => p.ruta.startsWith("/v1/messages")).map((p) => JSON.parse(p.cuerpo));

prueba("sin sesión → 401; sin 2FA/cuenta inactiva → 403 y no se llama a la IA", async () => {
  peticiones.length = 0;
  assertEquals((await llamar({ accion: "extraer" }, "")).status, 401);
  autorizado = false;
  const r = await llamar({ accion: "extraer", documento_id: "doc1" });
  autorizado = true;
  assertEquals(r.status, 403);
  assertEquals(aClaude().length, 0);
});

prueba("extraer: envía el PDF a Claude con esquema y guarda la extracción", async () => {
  peticiones.length = 0;
  respuestaClaude = { tipo_documento: "acuerdo", legible: true, resumen: "Se tiene por contestada", expediente: { numero: "845/2026", juzgado: "", materia: "", tipo_juicio: "", actor: "", demandado: "" }, acuerdos: [], observaciones: "" };
  const r = await llamar({ accion: "extraer", documento_id: "doc1" });
  assertEquals(r.status, 200, await r.clone().text());
  assertEquals((await r.json()).extraccion.tipo_documento, "acuerdo");
  const [req] = aClaude();
  assertEquals(req.model, "claude-opus-5-5");
  assertEquals(req.fallbacks, "default");
  assertEquals(req.output_config.format.type, "json_schema");
  assertEquals(req.output_config.effort, "medium");
  assert(req.stream, "debe usar streaming");
  const doc = req.messages[0].content[0];
  assertEquals(doc.type, "document");
  assertEquals(atob(doc.source.data), "%PDF-1.4 x");
  assertMatch(req.messages[0].content[1].text, /Demandado/);
  const beta = peticiones.find((p) => p.ruta.startsWith("/v1/messages"))!.headers.get("anthropic-beta") ?? "";
  assertMatch(beta, /server-side-fallback-2026-07-01/);
  const guardado = peticiones.filter((p) => p.metodo === "PATCH" && p.ruta.startsWith("/rest/v1/documentos")).map((p) => JSON.parse(p.cuerpo));
  assertEquals(guardado[0].estado_ia, "procesando");
  assertEquals(guardado[1].estado_ia, "procesado");
  assertEquals(guardado[1].extraccion.resumen, "Se tiene por contestada");
  // Toda consulta a Supabase viaja con el JWT del abogado (aplica RLS + 2FA)
  for (const p of peticiones.filter((p) => p.ruta.startsWith("/rest/") || p.ruta.startsWith("/storage/"))) {
    assertEquals(p.headers.get("authorization"), "Bearer jwt-abogado");
  }
});

prueba("extraer: si la IA se queda sin espacio marca el documento con error", async () => {
  peticiones.length = 0;
  stopReason = "max_tokens";
  respuestaClaude = { a: 1 };
  const r = await llamar({ accion: "extraer", documento_id: "doc1" });
  stopReason = "end_turn";
  assertEquals(r.status, 500);
  assertMatch((await r.json()).error, /incompleta/);
  const ult = peticiones.filter((p) => p.metodo === "PATCH").map((p) => JSON.parse(p.cuerpo)).at(-1);
  assertEquals(ult.estado_ia, "error");
});

prueba("analizar: guarda el análisis y actualiza etapa del expediente", async () => {
  peticiones.length = 0;
  respuestaClaude = { tipo_juicio: "Ordinario civil", legislacion_aplicable: [], etapa_actual: "Contestación de demanda", explicacion_etapa: "", etapas: [], ultimo_acontecimiento: "", siguiente_paso: "Contestar", acciones: [], riesgos: [], datos_faltantes: [] };
  const r = await llamar({ accion: "analizar", expediente_id: "exp1" });
  assertEquals(r.status, 200, await r.clone().text());
  assertEquals((await r.json()).analisis.resultado.etapa_actual, "Contestación de demanda");
  assertEquals(aClaude()[0].output_config.effort, "high");
  const upd = peticiones.find((p) => p.metodo === "PATCH" && p.ruta.startsWith("/rest/v1/expedientes"))!;
  assertEquals(JSON.parse(upd.cuerpo), { etapa: "Contestación de demanda", tipo_juicio: "Ordinario civil" });
});

prueba("redactar: crea el escrito como borrador generado por IA", async () => {
  peticiones.length = 0;
  respuestaClaude = { titulo: "Contestación de demanda", contenido: "C. JUEZ...\n\nPROTESTO LO NECESARIO", fundamentos: ["Art. 1 [VERIFICAR]"], datos_por_completar: ["Domicilio"], notas_para_el_abogado: "Revise excepciones" };
  const r = await llamar({ accion: "redactar", expediente_id: "exp1", tipo_escrito: "Contestación de demanda", instrucciones: "Negar hechos 3 y 4" });
  assertEquals(r.status, 200, await r.clone().text());
  const { escrito } = await r.json();
  assertEquals(escrito.generado_ia, true);
  assertEquals(escrito.notas_ia.datos_por_completar, ["Domicilio"]);
  assert(!("estado" in escrito), "el estado lo pone la base (borrador)");
  assertMatch(aClaude()[0].messages[0].content.at(-1).text, /Negar hechos 3 y 4/);
});

prueba("redactar sin indicar el escrito → error claro", async () => {
  const r = await llamar({ accion: "redactar", expediente_id: "exp1", tipo_escrito: " " });
  assertMatch((await r.json()).error, /Indique qué escrito/);
});

prueba("utilidades", () => {
  assertEquals(ia.hoyMexico(new Date("2026-11-12T03:00:00Z")), "2026-11-11");
  assertMatch(ia.describirExpediente({ numero: "1/2026" }), /Contraparte: \(sin dato\)/);
  let error = "";
  try { ia.bloqueArchivo("application/zip", "", "x"); } catch (e) { error = (e as Error).message; }
  assertMatch(error, /no soportado/);
  for (const esquema of [ia.ESQUEMA_EXTRACCION, ia.ESQUEMA_ANALISIS, ia.ESQUEMA_ESCRITO]) {
    const revisar = (s: Record<string, unknown>): void => {
      if (s.type === "object") {
        assertEquals(s.additionalProperties, false);
        assertEquals((s.required as string[]).sort(), Object.keys(s.properties as object).sort());
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(revisar);
      }
      if (s.type === "array") revisar(s.items as Record<string, unknown>);
    };
    revisar(esquema as Record<string, unknown>);
  }
});

Deno.test({ name: "cerrar servidor simulado", sanitizeOps: false, sanitizeResources: false, fn: () => servidor.shutdown() });
