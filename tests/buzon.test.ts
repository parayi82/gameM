// Pruebas de la función "buzon" (el archivo generado que se pega en Supabase).
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import { encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";

type Peticion = { metodo: string; ruta: string; cuerpo: string; headers: Headers };
const peticiones: Peticion[] = [];
const huellas = new Set<string>();

const EXPS = [
  { id: "e1", numero: "1203/2026", juzgado: "Juzgado Cuarto de Distrito en Materias Civil y del Trabajo en Jalisco", cliente: "Ana Ruiz Torres", contraparte: "", estado: "activo" },
  { id: "e2", numero: "88/2026", juzgado: "Sala Unitaria Tercera TJA", cliente: "Constructora Ola", contraparte: "Municipio de Zapopan", estado: "activo" },
];

const servidor = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  const u = new URL(req.url);
  const cuerpo = req.method === "GET" ? "" : await req.text();
  peticiones.push({ metodo: req.method, ruta: u.pathname + u.search, cuerpo, headers: req.headers });
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
  if (u.pathname === "/rest/v1/expedientes") return json(EXPS);
  if (u.pathname === "/rest/v1/publicaciones" && req.method === "POST") {
    const filas = [JSON.parse(cuerpo)].flat();
    const nuevas = filas.filter((f) => {
      const h = `${f.expediente_id}|${f.fecha_publicacion}|${f.texto}`;
      if (huellas.has(h)) return false;
      huellas.add(h);
      return true;
    });
    return json(nuevas.map((_, i) => ({ id: `pub${huellas.size}-${i}` })), 201);
  }
  if (u.pathname === "/rest/v1/publicaciones" && req.method === "PATCH") return new Response(null, { status: 204 });
  if (u.pathname.startsWith("/storage/v1/object/expedientes/")) return json({ Key: u.pathname });
  if (u.pathname === "/rest/v1/documentos") return json({ id: "doc1" }, 201);
  return json({ message: "no simulado " + u.pathname }, 404);
});

const TOKEN = "clave-de-prueba-muy-larga-1234567890";
Deno.env.set("BUZON_NO_SERVE", "1");
Deno.env.set("BUZON_TOKEN", TOKEN);
Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${servidor.addr.port}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role");
const buzon = await import("../supabase/functions/buzon/index.ts");

const prueba = (name: string, fn: () => Promise<void> | void) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const enviar = (cuerpo: unknown, token = TOKEN) =>
  buzon.manejar(new Request("http://x/buzon", { method: "POST", headers: { "x-lexpress-token": token, "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));

const CORREO_PJF = {
  id: "m1", de: "notificaciones@pjf.gob.mx", fecha: "2026-11-13T02:30:00Z",
  asunto: "Notificación electrónica - Expediente 1203/2026",
  texto: "Órgano jurisdiccional:\nJuzgado Cuarto de Distrito en Materias Civil y del Trabajo en el Estado de Jalisco\nExpediente: 1203/2026\nQuejosa: Ana Ruiz Torres\nSe concede la suspensión definitiva.",
  adjuntos: [{ nombre: "acuerdo.pdf", mime: "application/pdf", base64: encodeBase64(new TextEncoder().encode("%PDF-1.4")) },
    { nombre: "virus.exe", mime: "application/octet-stream", base64: "AAAA" }],
};

prueba("clave incorrecta → 401 y no toca la base", async () => {
  peticiones.length = 0;
  assertEquals((await enviar({ mensajes: [CORREO_PJF] }, "otra")).status, 401);
  assertEquals((await enviar({ mensajes: [CORREO_PJF] }, "")).status, 401);
  assertEquals(peticiones.length, 0);
});

prueba("correo del PJF: se vincula, guarda solo el PDF y usa la fecha de México", async () => {
  peticiones.length = 0;
  const r = await enviar({ mensajes: [CORREO_PJF] });
  assertEquals(r.status, 200, await r.clone().text());
  const res = await r.json();
  assertEquals(res.vinculadas, 1);
  assertEquals(res.documentos, 1);
  const pub = JSON.parse(peticiones.find((p) => p.ruta.startsWith("/rest/v1/publicaciones") && p.metodo === "POST")!.cuerpo);
  assertEquals(pub.expediente_id, "e1");
  assertEquals(pub.fuente, "correo");
  assertEquals(pub.fecha_publicacion, "2026-11-12", "02:30 UTC del 13 es 12 de noviembre en CDMX");
  assertEquals(pub.confianza, "alta");
  const subidas = peticiones.filter((p) => p.ruta.startsWith("/storage/"));
  assertEquals(subidas.length, 1, "el .exe se ignora");
  assertMatch(subidas[0].ruta, /^\/storage\/v1\/object\/expedientes\/e1\//);
  const conflicto = peticiones.find((p) => p.ruta.startsWith("/rest/v1/publicaciones") && p.metodo === "POST")!;
  assertMatch(conflicto.ruta, /on_conflict=huella/);
  assertMatch(conflicto.headers.get("prefer") ?? "", /ignore-duplicates/);
});

prueba("el mismo correo otra vez no se duplica ni vuelve a subir el adjunto", async () => {
  peticiones.length = 0;
  const res = await (await enviar({ mensajes: [CORREO_PJF] })).json();
  assertEquals(res.duplicadas, 1);
  assertEquals(res.vinculadas, 0);
  assert(!peticiones.some((p) => p.ruta.startsWith("/storage/")));
});

prueba("correo sin expediente reconocible queda sin vincular", async () => {
  const res = await (await enviar({ mensajes: [{ de: "avisos@tjajal.gob.mx", asunto: "Aviso", texto: "Mantenimiento del portal el sábado." }] })).json();
  assertEquals(res.sin_vincular, 1);
});

prueba("validaciones de entrada", async () => {
  assertEquals((await enviar({ mensajes: [] })).status, 200);
  assertEquals((await enviar({})).status, 400);
  assertEquals((await enviar({ mensajes: Array(51).fill(CORREO_PJF) })).status, 400);
  assert(buzon.mismaClave("abc", "abc") && !buzon.mismaClave("abc", "abd") && !buzon.mismaClave("abc", "abcd"));
});

prueba("index.ts generado está al día con fuente.ts y boletin.js", async () => {
  const p = new Deno.Command("node", { args: ["scripts/generar-buzon.mjs", "--verificar"] });
  const { code } = await p.output();
  assertEquals(code, 0);
});

Deno.test({ name: "cerrar servidor simulado", sanitizeOps: false, sanitizeResources: false, fn: () => servidor.shutdown() });
