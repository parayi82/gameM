// Motor de vinculación: encuentra los expedientes del despacho dentro del
// texto de un boletín judicial, una lista de acuerdos o un correo de
// notificación. Funciones puras (sin DOM ni red): se usan en el navegador,
// en la función "buzon" del servidor y en las pruebas.
//
// Criterio: el número/año del expediente debe aparecer en el texto. Como
// el mismo número existe en muchos juzgados, se confirma con el encabezado
// del juzgado más cercano y con los nombres de las partes.

const ORDINALES = {
  PRIMER: 1, PRIMERO: 1, PRIMERA: 1, SEGUNDO: 2, SEGUNDA: 2, TERCER: 3, TERCERO: 3, TERCERA: 3,
  CUARTO: 4, CUARTA: 4, QUINTO: 5, QUINTA: 5, SEXTO: 6, SEXTA: 6, SEPTIMO: 7, SEPTIMA: 7,
  OCTAVO: 8, OCTAVA: 8, NOVENO: 9, NOVENA: 9, DECIMO: 10, DECIMA: 10,
  UNDECIMO: 11, DECIMOPRIMERO: 11, DUODECIMO: 12, DECIMOSEGUNDO: 12, DECIMOTERCERO: 13,
  DECIMOCUARTO: 14, DECIMOQUINTO: 15, DECIMOSEXTO: 16, DECIMOSEPTIMO: 17, DECIMOOCTAVO: 18,
  DECIMONOVENO: 19, VIGESIMO: 20,
};

// Palabras que no ayudan a distinguir un juzgado de otro.
const VACIAS = new Set(["JUZGADO", "JUZGADOS", "DE", "DEL", "LA", "LAS", "LO", "LOS", "EN", "EL", "Y", "E",
  "MATERIA", "PRIMERA", "INSTANCIA", "ESTADO", "PARTIDO", "JUDICIAL", "SALA", "TRIBUNAL", "ORGANO",
  "JURISDICCIONAL", "PONENCIA", "JUNTA", "LOCAL", "CON", "SEDE", "RESIDENCIA", "CIUDAD", "UNITARIO", "COLEGIADO"]);

export function sinAcentos(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/** "L-0149/26" → { numero: 149, anio: 2026 } ; null si no hay número/año. */
export function partesNumero(texto) {
  const m = String(texto ?? "").match(/(\d{1,7})\s*[/-]\s*(\d{4}|\d{2})(?!\d)/);
  if (!m) return null;
  let anio = Number(m[2]);
  if (m[2].length === 2) anio += anio > 50 ? 1900 : 2000;
  return { numero: Number(m[1]), anio };
}

/** Expresión que reconoce el número de expediente con variantes: 0845/2026, 845/26, 845-2026, L-845/2026. */
export function regexExpediente(numero) {
  const p = partesNumero(numero);
  if (!p) return null;
  const corto = String(p.anio).slice(2);
  return new RegExp(`(?<![\\d/])0*${p.numero}\\s*[/-]\\s*(?:${p.anio}|${corto})(?!\\d)`, "g");
}

/** Claves que distinguen a un juzgado: ordinal, materia, ciudad. */
export function clavesJuzgado(nombre) {
  const t = sinAcentos(nombre)
    // Ordinales que NO identifican al juzgado: partido judicial, circuito, instancia.
    .replace(/\b[A-Z0-9º°]+\s+(PARTIDO\s+JUDICIAL|CIRCUITO|DISTRITO\s+JUDICIAL)\b/g, " ")
    .replace(/\bPRIMERA\s+INSTANCIA\b/g, " ")
    .replace(/(\d+)\s*[º°OA]?\b/g, " $1 ").replace(/[^A-Z0-9 ]+/g, " ");
  const claves = new Set();
  for (const w of t.split(/\s+/).filter(Boolean)) {
    if (ORDINALES[w]) claves.add(String(ORDINALES[w]));
    else if (/^\d+$/.test(w)) claves.add(String(Number(w)));
    else if (w.length > 2 && !VACIAS.has(w)) claves.add(w);
  }
  return claves;
}

/** Fracción de las claves del juzgado del expediente que aparecen en el encabezado detectado. */
export function parecidoJuzgado(juzgadoExpediente, encabezado) {
  const a = clavesJuzgado(juzgadoExpediente);
  if (!a.size || !encabezado) return 0;
  const b = clavesJuzgado(encabezado);
  let comunes = 0;
  for (const k of a) if (b.has(k)) comunes++;
  // El ordinal es decisivo: "Juzgado 3º Civil" no es "Juzgado 4º Civil".
  const ordA = [...a].filter((k) => /^\d+$/.test(k));
  if (ordA.length && !ordA.some((k) => b.has(k))) return 0;
  return comunes / a.size;
}

const RE_ENCABEZADO = /^[^\n]{0,40}\b(JUZGADO|SALA|TRIBUNAL|PONENCIA|JUNTA|CENTRO DE CONCILIACION)\b[^\n]{0,160}$/gm;
// Inicio de otra entrada: una línea que empieza con (consecutivo opcional y) un número de expediente.
const RE_OTRA_ENTRADA = /\n[ \t]*(?:\d{1,4}[.)-]?[ \t]+)?(?:[A-Z][A-Z.]{0,5}[ \t-]*)?\d{1,7}[ \t]*[/-][ \t]*\d{2,4}(?!\d)/g;

function encabezadoAnterior(texto, posicion) {
  const previo = sinAcentos(texto.slice(Math.max(0, posicion - 20000), posicion));
  let ultimo = null;
  for (const m of previo.matchAll(RE_ENCABEZADO)) ultimo = m[0].trim();
  return ultimo;
}

function extraerEntrada(texto, inicio, fin) {
  const desde = texto.lastIndexOf("\n", inicio) + 1;
  RE_OTRA_ENTRADA.lastIndex = fin;
  const sig = RE_OTRA_ENTRADA.exec(texto);
  let hasta = sig ? sig.index : texto.length;
  // No cruzar a la sección de otro juzgado.
  RE_ENCABEZADO.lastIndex = 0;
  const resto = sinAcentos(texto.slice(fin, hasta));
  const enc = resto.search(/\n[^\n]{0,40}\b(JUZGADO|SALA|TRIBUNAL|PONENCIA|JUNTA|CENTRO DE CONCILIACION)\b/);
  if (enc >= 0) hasta = fin + enc;
  return texto.slice(desde, Math.min(hasta, desde + 2500)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function apellidos(nombre) {
  return sinAcentos(nombre).replace(/[^A-Z ]+/g, " ").split(/\s+/)
    .filter((w) => w.length >= 4 && !["SOCIEDAD", "ANONIMA", "CAPITAL", "VARIABLE", "LICENCIADO", "CIUDADANO"].includes(w));
}

function mencionaParte(entrada, exp) {
  const t = sinAcentos(entrada);
  return [exp.cliente, exp.contraparte].some((n) => {
    const ws = apellidos(n);
    if (!ws.length) return false;
    const hallados = ws.filter((w) => t.includes(w)).length;
    return hallados >= Math.min(2, ws.length);
  });
}

/**
 * Busca los expedientes dentro del texto.
 * @param {string} texto  boletín, lista de acuerdos o cuerpo de correo
 * @param {Array} expedientes  [{id, numero, juzgado, cliente, contraparte, estado}]
 * @param {{juzgadoPorDefecto?: string}} opciones  encabezado a usar si el texto no trae ninguno (p. ej. asunto del correo)
 * @returns {Array<{expediente_id, numero, juzgado_detectado, texto, confianza, motivo}>}
 */
export function buscarEnBoletin(texto, expedientes, opciones = {}) {
  const limpio = String(texto ?? "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const hallazgos = [];
  const vistos = new Set();
  for (const exp of expedientes) {
    if (exp.estado === "archivado") continue;
    const re = regexExpediente(exp.numero);
    if (!re) continue;
    for (const m of limpio.matchAll(re)) {
      const encabezado = encabezadoAnterior(limpio, m.index) || (opciones.juzgadoPorDefecto ? sinAcentos(opciones.juzgadoPorDefecto) : null);
      const entrada = extraerEntrada(limpio, m.index, m.index + m[0].length);
      const parte = mencionaParte(entrada, exp);
      const parecido = encabezado ? parecidoJuzgado(exp.juzgado, encabezado) : null;
      let confianza;
      let motivo;
      if (parecido !== null && parecido >= 0.6) {
        confianza = "alta";
        motivo = parte ? "Coinciden número, juzgado y partes" : "Coinciden número y juzgado";
      } else if (parte) {
        confianza = parecido === null ? "alta" : "media";
        motivo = "Coinciden número y nombre de las partes";
      } else if (parecido === null) {
        confianza = "media";
        motivo = "Coincide el número; el texto no indica juzgado";
      } else {
        continue; // mismo número en otro juzgado: no es nuestro asunto
      }
      const clave = `${exp.id}|${entrada}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      hallazgos.push({ expediente_id: exp.id, numero: exp.numero, juzgado_detectado: encabezado || "", texto: entrada, confianza, motivo });
    }
  }
  return hallazgos;
}
