import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sumarDiasHabiles, calcularVencimiento, diasHabilesRestantes, semaforo, esHabil, describirRestante,
} from "../plazos.js";

const inh = new Set(["2026-11-16"]); // lunes inhábil

test("fines de semana no son hábiles", () => {
  assert.equal(esHabil("2026-11-14"), false); // sábado
  assert.equal(esHabil("2026-11-15"), false); // domingo
  assert.equal(esHabil("2026-11-13"), true);  // viernes
  assert.equal(esHabil("2026-11-16", inh), false);
});

test("sumar días hábiles salta fin de semana e inhábiles", () => {
  assert.equal(sumarDiasHabiles("2026-11-13", 1), "2026-11-16");
  assert.equal(sumarDiasHabiles("2026-11-13", 1, inh), "2026-11-17");
  assert.equal(sumarDiasHabiles("2026-11-13", 0), "2026-11-13");
});

test("término de 3 días con notificación que surte efectos al día siguiente", () => {
  // Notificado miércoles 11; surte jueves 12; corre vie 13, mar 17 (lunes inhábil), mié 18.
  const r = calcularVencimiento({ fechaNotificacion: "2026-11-11", dias: 3, surteEfectos: true, inhabiles: inh });
  assert.deepEqual(r, { surte: "2026-11-12", inicio: "2026-11-13", vencimiento: "2026-11-18" });
});

test("término sin día de surtimiento", () => {
  const r = calcularVencimiento({ fechaNotificacion: "2026-11-11", dias: 3, surteEfectos: false });
  assert.equal(r.inicio, "2026-11-12");
  assert.equal(r.vencimiento, "2026-11-16");
});

test("entradas inválidas devuelven null", () => {
  assert.equal(calcularVencimiento({ fechaNotificacion: "2026-11-11", dias: 0 }), null);
  assert.equal(calcularVencimiento({ fechaNotificacion: "", dias: 3 }), null);
});

test("días restantes y semáforo", () => {
  assert.equal(diasHabilesRestantes("2026-11-11", "2026-11-11"), 0);
  assert.equal(diasHabilesRestantes("2026-11-13", "2026-11-17", inh), 1);
  assert.equal(diasHabilesRestantes("2026-11-12", "2026-11-10"), -2);
  assert.equal(semaforo("2026-11-11", "2026-11-12"), "rojo");
  assert.equal(semaforo("2026-11-11", "2026-11-16"), "ambar");
  assert.equal(semaforo("2026-11-11", "2026-11-25"), "verde");
  assert.equal(semaforo("2026-11-11", null), "gris");
  assert.equal(describirRestante("2026-11-12", "2026-11-11"), "VENCIDO hace 1 día");
});
