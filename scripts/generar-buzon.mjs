// Genera supabase/functions/buzon/index.ts (un solo archivo para pegar en el
// editor de Supabase) a partir de fuente.ts + el motor boletin.js.
// Uso: npm run generar:buzon      Verificar: node scripts/generar-buzon.mjs --verificar
import { readFileSync, writeFileSync } from "node:fs";

const raiz = new URL("..", import.meta.url);
const fuente = readFileSync(new URL("supabase/functions/buzon/fuente.ts", raiz), "utf8");
const motor = readFileSync(new URL("boletin.js", raiz), "utf8").replace(/^export /gm, "");
const IMPORT = 'import { buscarEnBoletin } from "../../../boletin.js";';
if (!fuente.includes(IMPORT)) throw new Error("fuente.ts ya no importa boletin.js como se esperaba");

const salida = [
  "// @ts-nocheck",
  "// ARCHIVO GENERADO por scripts/generar-buzon.mjs — NO EDITAR A MANO.",
  "// Edite supabase/functions/buzon/fuente.ts o boletin.js y ejecute `npm run generar:buzon`.",
  "// Este es el archivo que se pega en Supabase → Edge Functions → buzon.",
  fuente.replace(IMPORT, `// ---- motor de vinculación (copiado de boletin.js) ----\n${motor}\n// ---- fin del motor ----`),
].join("\n");

const destino = new URL("supabase/functions/buzon/index.ts", raiz);
if (process.argv.includes("--verificar")) {
  let actual = "";
  try { actual = readFileSync(destino, "utf8"); } catch { /* no existe */ }
  if (actual !== salida) { console.error("index.ts está desactualizado: ejecute npm run generar:buzon"); process.exit(1); }
  console.log("index.ts al día");
} else {
  writeFileSync(destino, salida);
  console.log("Generado supabase/functions/buzon/index.ts");
}
