#!/usr/bin/env node
// Pipeline de arte OFFLINE con Nano Banana (Gemini 3.1 Flash Image).
// Se ejecuta como script aparte de contenido, NUNCA en runtime del juego.
// Uso:
//   GEMINI_API_KEY=... node scripts/generate-art.js
//   node scripts/generate-art.js --only ch1_cabana_intro
//   node scripts/generate-art.js --manifest scripts/art-manifest.json --force

const fs = require("fs");
const path = require("path");

const MODEL = "gemini-3.1-flash-image-preview";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function parseArgs(argv) {
  const args = { manifest: "scripts/art-manifest.json", force: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--manifest") args.manifest = argv[++i];
    else if (argv[i] === "--force") args.force = true;
    else if (argv[i] === "--only") args.only = argv[++i];
  }
  return args;
}

async function generateImage(apiKey, prompt) {
  const res = await fetch(`${API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    throw new Error("La respuesta no contenía datos de imagen (revisar prompt/safety filters)");
  }
  return Buffer.from(imagePart.inlineData.data, "base64");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Falta GEMINI_API_KEY en el entorno.");
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..");
  const manifestPath = path.resolve(repoRoot, args.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const items = args.only ? manifest.filter((it) => it.id === args.only) : manifest;
  if (items.length === 0) {
    console.error(`No se encontraron entradas para --only ${args.only}`);
    process.exit(1);
  }

  for (const item of items) {
    const outputPath = path.resolve(repoRoot, item.outputPath);
    if (fs.existsSync(outputPath) && !args.force) {
      console.log(`[skip] ${item.id} ya existe (usar --force para regenerar)`);
      continue;
    }

    console.log(`[gen] ${item.id} -> ${item.outputPath}`);
    try {
      const buffer = await generateImage(apiKey, item.prompt);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      console.log(`[ok]  ${item.outputPath} (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`[error] ${item.id}: ${err.message}`);
    }
  }

  console.log(
    "\nRecordatorio: actualizar las extensiones (.svg -> .png) en chapters/*.json si los" +
      " placeholders SVG fueron reemplazados por arte generado aquí."
  );
}

main();
