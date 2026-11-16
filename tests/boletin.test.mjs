import { test } from "node:test";
import assert from "node:assert/strict";
import { buscarEnBoletin, partesNumero, parecidoJuzgado, clavesJuzgado } from "../boletin.js";

const EXPS = [
  { id: "e1", numero: "845/2026", juzgado: "Juzgado 3º Civil de Guadalajara", cliente: "Comercial del Norte SA de CV", contraparte: "María López Hernández", estado: "activo" },
  { id: "e2", numero: "L-149/2026", juzgado: "Juzgado Segundo Laboral de Zapopan", cliente: "Transportes Rivera", contraparte: "Juan Pérez Gómez", estado: "activo" },
  { id: "e3", numero: "1203/2026", juzgado: "Juzgado Cuarto de Distrito en Materias Civil y del Trabajo en Jalisco", cliente: "Ana Ruiz Torres", contraparte: "", estado: "activo" },
  { id: "e4", numero: "77/2025", juzgado: "Juzgado 1º Familiar", cliente: "X", contraparte: "", estado: "archivado" },
];

const BOLETIN = `BOLETÍN JUDICIAL DEL ESTADO DE JALISCO
LISTA DE ACUERDOS 12 DE NOVIEMBRE DE 2026
JUZGADO TERCERO DE LO CIVIL DEL PRIMER PARTIDO JUDICIAL
1. 0844/2026 JUICIO CIVIL ORDINARIO. BANCO X VS. PEDRO Y. SE ADMITE LA DEMANDA.
2. 0845/2026 JUICIO CIVIL ORDINARIO. INMOBILIARIA SUR VS. COMERCIAL DEL NORTE SA DE CV.
   SE TIENE POR CONTESTADA LA DEMANDA Y SE DA VISTA A LA ACTORA POR TRES DÍAS.
3. 0846/2026 DILIGENCIAS. SE ARCHIVA.
JUZGADO CUARTO DE LO CIVIL DEL PRIMER PARTIDO JUDICIAL
1. 845/2026 EJECUTIVO MERCANTIL. OTRO ACTOR VS OTRO DEMANDADO. SE ORDENA EMPLAZAR.
JUZGADO SEGUNDO LABORAL CON SEDE EN ZAPOPAN
1. L-149/2026 PÉREZ GÓMEZ JUAN VS TRANSPORTES RIVERA. SE SEÑALA AUDIENCIA PRELIMINAR.
JUZGADO PRIMERO FAMILIAR
1. 77/2025 SE ARCHIVA.`;

test("partes del número", () => {
  assert.deepEqual(partesNumero("L-0149/26"), { numero: 149, anio: 2026 });
  assert.deepEqual(partesNumero("Exp. 845-2026"), { numero: 845, anio: 2026 });
  assert.equal(partesNumero("sin número"), null);
});

test("claves de juzgado ignoran partido judicial y circuito", () => {
  assert.deepEqual([...clavesJuzgado("JUZGADO TERCERO DE LO CIVIL DEL PRIMER PARTIDO JUDICIAL")].sort(), ["3", "CIVIL"]);
  assert.deepEqual([...clavesJuzgado("Tercer Tribunal Colegiado en Materia Civil del Tercer Circuito")].sort(), ["3", "CIVIL"]);
  assert.equal(parecidoJuzgado("Juzgado 3º Civil de Guadalajara", "JUZGADO CUARTO DE LO CIVIL DEL PRIMER PARTIDO JUDICIAL"), 0);
});

test("boletín estatal: vincula el expediente correcto y descarta el mismo número en otro juzgado", () => {
  const r = buscarEnBoletin(BOLETIN, EXPS);
  const e1 = r.filter((x) => x.expediente_id === "e1");
  assert.equal(e1.length, 1, "solo la entrada del Juzgado Tercero");
  assert.equal(e1[0].confianza, "alta");
  assert.match(e1[0].texto, /SE TIENE POR CONTESTADA LA DEMANDA/);
  assert.doesNotMatch(e1[0].texto, /0846\/2026/);
  assert.doesNotMatch(e1[0].texto, /EJECUTIVO MERCANTIL/);
  const e2 = r.find((x) => x.expediente_id === "e2");
  assert.ok(e2, "laboral con prefijo L-");
  assert.equal(e2.confianza, "alta");
  assert.match(e2.texto, /AUDIENCIA PRELIMINAR/);
  assert.ok(!r.some((x) => x.expediente_id === "e4"), "los archivados no se buscan");
});

test("lista federal pegada desde una tabla (tabuladores)", () => {
  const lista = "JUZGADO CUARTO DE DISTRITO EN MATERIAS CIVIL Y DEL TRABAJO EN EL ESTADO DE JALISCO\nNo.\tExpediente\tQuejoso\tSíntesis\n1\t1202/2026\tFULANO\tSe admite\n2\t1203/2026\tANA RUIZ TORRES\tSe concede la suspensión provisional\n3\t1204/2026\tMENGANO\tSe desecha";
  const r = buscarEnBoletin(lista, EXPS);
  assert.equal(r.length, 1);
  assert.equal(r[0].expediente_id, "e3");
  assert.match(r[0].texto, /suspensión provisional/);
  assert.doesNotMatch(r[0].texto, /Se desecha/);
});

test("correo sin encabezado: confianza media, o alta si menciona a las partes", () => {
  const correo = "Se le notifica el acuerdo dictado en el expediente 845/2026 relativo al juicio promovido por Inmobiliaria Sur.";
  assert.equal(buscarEnBoletin(correo, EXPS)[0].confianza, "media");
  const conParte = correo + " en contra de Comercial del Norte SA de CV";
  assert.equal(buscarEnBoletin(conParte, EXPS)[0].confianza, "alta");
});

test("correo con asunto como juzgado por defecto descarta otro juzgado", () => {
  const r = buscarEnBoletin("Acuerdo en el expediente 845/2026", EXPS, { juzgadoPorDefecto: "Juzgado Quinto Civil" });
  assert.equal(r.length, 0);
});

test("encabezado de Junta laboral se reconoce y separa secciones", () => {
  const exps = [{ id: "j", numero: "1203/2026", juzgado: "Junta Local de Conciliación 5", cliente: "Transportes Rivera", contraparte: "", estado: "activo" }];
  const texto = "JUZGADO CUARTO DE LO CIVIL\n1. 845/2026 OTRO. SE ORDENA EMPLAZAR.\nJUNTA LOCAL DE CONCILIACIÓN 5\n1. 1203/2026 TRANSPORTES RIVERA. SE SEÑALA AUDIENCIA.";
  const r = buscarEnBoletin(texto, exps);
  assert.equal(r.length, 1);
  assert.equal(r[0].confianza, "alta");
  assert.match(r[0].juzgado_detectado, /JUNTA LOCAL/);
});
