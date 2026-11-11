// Cálculo de términos judiciales en días hábiles.
// Funciones puras (sin DOM ni red) para poder probarlas con `node --test`.
// Todas las fechas viajan como texto ISO "AAAA-MM-DD" para evitar errores
// de zona horaria; internamente se usan Date a mediodía local.

export function parseISO(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d, 12, 0, 0);
}

export function toISO(fecha) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

export function hoyISO() {
  return toISO(new Date());
}

function sumarDiasNaturales(iso, n) {
  const f = parseISO(iso);
  f.setDate(f.getDate() + n);
  return toISO(f);
}

/** Sábado, domingo y las fechas del set de inhábiles no cuentan. */
export function esHabil(iso, inhabiles = new Set()) {
  const dia = parseISO(iso).getDay();
  return dia !== 0 && dia !== 6 && !inhabiles.has(iso);
}

/** Avanza `n` días hábiles después de `iso` (n = 0 devuelve la misma fecha). */
export function sumarDiasHabiles(iso, n, inhabiles = new Set()) {
  let actual = iso;
  let restantes = n;
  while (restantes > 0) {
    actual = sumarDiasNaturales(actual, 1);
    if (esHabil(actual, inhabiles)) restantes--;
  }
  return actual;
}

/**
 * Fecha de vencimiento de un término.
 *  - surteEfectos = true (regla general): la notificación surte efectos el
 *    día hábil siguiente y el término empieza a correr el día hábil
 *    siguiente a ese.
 *  - surteEfectos = false: el término corre desde el día hábil siguiente a
 *    la notificación.
 * Devuelve { surte, inicio, vencimiento } en ISO.
 */
export function calcularVencimiento({ fechaNotificacion, dias, surteEfectos = true, inhabiles = new Set() }) {
  if (!fechaNotificacion || !Number.isInteger(dias) || dias < 1) return null;
  const surte = surteEfectos ? sumarDiasHabiles(fechaNotificacion, 1, inhabiles) : fechaNotificacion;
  const inicio = sumarDiasHabiles(surte, 1, inhabiles);
  const vencimiento = sumarDiasHabiles(surte, dias, inhabiles);
  return { surte, inicio, vencimiento };
}

/**
 * Días hábiles que faltan para el vencimiento.
 * 0 = vence hoy; negativo = vencido (días naturales de atraso, en negativo).
 */
export function diasHabilesRestantes(hoy, vencimiento, inhabiles = new Set()) {
  if (vencimiento < hoy) {
    const ms = parseISO(hoy) - parseISO(vencimiento);
    return -Math.round(ms / 86400000);
  }
  let cuenta = 0;
  let actual = hoy;
  while (actual < vencimiento) {
    actual = sumarDiasNaturales(actual, 1);
    if (esHabil(actual, inhabiles)) cuenta++;
  }
  return cuenta;
}

/** rojo: vencido, hoy o mañana hábil · ambar: ≤ 3 días hábiles · verde: resto · gris: sin término */
export function semaforo(hoy, vencimiento, inhabiles = new Set()) {
  if (!vencimiento) return "gris";
  const r = diasHabilesRestantes(hoy, vencimiento, inhabiles);
  if (r <= 1) return "rojo";
  if (r <= 3) return "ambar";
  return "verde";
}

export function describirRestante(hoy, vencimiento, inhabiles = new Set()) {
  if (!vencimiento) return "Sin término";
  const r = diasHabilesRestantes(hoy, vencimiento, inhabiles);
  if (r < 0) return `VENCIDO hace ${-r} día${r === -1 ? "" : "s"}`;
  if (r === 0) {
    return esHabil(hoy, inhabiles) ? "VENCE HOY" : "Vence hoy (día inhábil: revisar)";
  }
  if (r === 1) return "Vence mañana hábil";
  return `Faltan ${r} días hábiles`;
}

/** Días inhábiles base (México). Cada despacho debe ajustarlos al calendario oficial de su tribunal. */
export const INHABILES_BASE = [
  ["2026-01-01", "Año Nuevo"],
  ["2026-02-02", "Día de la Constitución"],
  ["2026-03-16", "Natalicio de Benito Juárez"],
  ["2026-04-02", "Jueves Santo"],
  ["2026-04-03", "Viernes Santo"],
  ["2026-05-01", "Día del Trabajo"],
  ["2026-05-05", "Batalla de Puebla"],
  ["2026-09-16", "Día de la Independencia"],
  ["2026-11-02", "Día de Muertos"],
  ["2026-11-16", "Revolución Mexicana"],
  ["2026-12-25", "Navidad"],
  ["2027-01-01", "Año Nuevo"],
  ["2027-02-01", "Día de la Constitución"],
  ["2027-03-15", "Natalicio de Benito Juárez"],
  ["2027-03-25", "Jueves Santo"],
  ["2027-03-26", "Viernes Santo"],
  ["2027-05-05", "Batalla de Puebla"],
  ["2027-09-16", "Día de la Independencia"],
  ["2027-11-02", "Día de Muertos"],
  ["2027-11-15", "Revolución Mexicana"],
];
