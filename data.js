// Capa de datos con dos implementaciones de la misma interfaz:
//  - SupabaseDatos: producción (Auth + RLS + 2FA).
//  - DemoDatos: solo para probar la interfaz; guarda en localStorage del
//    navegador. NUNCA usar con datos reales de clientes.
import { INHABILES_BASE, hoyISO, sumarDiasHabiles, toISO } from "./plazos.js";

function revisar({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export class SupabaseDatos {
  constructor(sb) {
    this.sb = sb;
    this.demo = false;
  }

  async miPerfil(uid) {
    return revisar(await this.sb.from("abogados").select("*").eq("id", uid).maybeSingle());
  }
  async abogados() {
    return revisar(await this.sb.from("abogados").select("*").order("nombre"));
  }
  async actualizarAbogado(id, cambios) {
    revisar(await this.sb.from("abogados").update(cambios).eq("id", id));
  }

  async expedientes() {
    return revisar(await this.sb.from("expedientes").select("*").order("creado_at", { ascending: false }));
  }
  async guardarExpediente(exp) {
    const { id, ...campos } = exp;
    if (id) revisar(await this.sb.from("expedientes").update(campos).eq("id", id));
    else revisar(await this.sb.from("expedientes").insert(campos));
  }

  async acuerdos() {
    return revisar(await this.sb.from("acuerdos").select("*").order("fecha_vencimiento", { ascending: true, nullsFirst: false }));
  }
  async guardarAcuerdo(ac) {
    const { id, ...campos } = ac;
    if (id) revisar(await this.sb.from("acuerdos").update(campos).eq("id", id));
    else revisar(await this.sb.from("acuerdos").insert(campos));
  }

  async inhabiles() {
    return revisar(await this.sb.from("dias_inhabiles").select("*").order("fecha"));
  }
  async agregarInhabil(fecha, motivo) {
    revisar(await this.sb.from("dias_inhabiles").upsert({ fecha, motivo }));
  }
  async quitarInhabil(fecha) {
    revisar(await this.sb.from("dias_inhabiles").delete().eq("fecha", fecha));
  }

  async bitacora() {
    return revisar(await this.sb.from("bitacora").select("*").order("at", { ascending: false }).limit(300));
  }
}

// ------------------------------------------------------------------ demo
const CLAVE = "despacho_demo_v1";
const DEMO_USUARIO = { id: "demo-admin", email: "demo@despacho.local", nombre: "Lic. Demo (admin)", rol: "admin", activo: true };

function semilla() {
  const hoy = hoyISO();
  const inh = new Set(INHABILES_BASE.map(([f]) => f));
  const d = (n) => sumarDiasHabiles(hoy, n, inh);
  const abogados = [
    DEMO_USUARIO,
    { id: "demo-2", email: "ana@despacho.local", nombre: "Lic. Ana Ruiz", rol: "abogado", activo: true },
  ];
  const expedientes = [
    { id: "e1", numero: "845/2026", juzgado: "Juzgado 3º Civil CDMX", materia: "Civil", cliente: "Comercial del Norte SA", contraparte: "Inmobiliaria Sur", responsable_id: "demo-admin", estado: "activo", notas: "" },
    { id: "e2", numero: "1203/2026", juzgado: "Junta Local de Conciliación 5", materia: "Laboral", cliente: "Transportes Rivera", contraparte: "J. Pérez", responsable_id: "demo-2", estado: "activo", notas: "" },
  ];
  const ac = (id, exp, desc, venc, resp, estado = "pendiente") => ({
    id, expediente_id: exp, fecha_publicacion: hoy, fecha_notificacion: hoy, descripcion: desc,
    dias_termino: null, surte_efectos: true, fecha_vencimiento: venc, responsable_id: resp,
    estado, nota_atencion: "", atendido_por: null, atendido_at: null, creado_at: new Date().toISOString(),
  });
  const acuerdos = [
    ac("a1", "e1", "Se tiene por contestada la demanda; vista a la actora para replicar.", d(1), "demo-admin"),
    ac("a2", "e1", "Se abre periodo de ofrecimiento de pruebas.", d(3), "demo-admin"),
    ac("a3", "e2", "Se señala fecha para audiencia; presentar pliego de posiciones.", d(8), "demo-2"),
    ac("a4", "e2", "Se previene al actor para aclarar su escrito.", hoy, "demo-2"),
  ];
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 2);
  const vencido = ac("a5", "e1", "Requerimiento para exhibir documento original.", toISO(ayer), "demo-2");
  vencido.fecha_notificacion = vencido.fecha_publicacion = vencido.fecha_vencimiento;
  acuerdos.push(vencido);
  return {
    abogados, expedientes, acuerdos,
    inhabiles: INHABILES_BASE.map(([fecha, motivo]) => ({ fecha, motivo })),
    bitacora: [],
  };
}

export class DemoDatos {
  constructor() {
    this.demo = true;
    this.usuario = DEMO_USUARIO;
    try {
      this.db = JSON.parse(localStorage.getItem(CLAVE)) || semilla();
    } catch {
      this.db = semilla();
    }
    this._guardar();
  }
  _guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(this.db)); } catch { /* modo privado */ }
  }
  _log(tabla, registro_id, accion, antes, despues) {
    this.db.bitacora.unshift({
      id: Date.now() + Math.random(), at: new Date().toISOString(), usuario_id: DEMO_USUARIO.id,
      usuario_email: DEMO_USUARIO.email, tabla, registro_id, accion, antes, despues,
    });
    this.db.bitacora = this.db.bitacora.slice(0, 300);
  }
  _upsert(tabla, obj) {
    const lista = this.db[tabla];
    const ahora = new Date().toISOString();
    if (obj.id) {
      const i = lista.findIndex((x) => x.id === obj.id);
      const antes = lista[i];
      const despues = { ...antes, ...obj, actualizado_at: ahora };
      if (tabla === "acuerdos") {
        if (despues.estado === "atendido" && antes.estado !== "atendido") {
          despues.atendido_por = DEMO_USUARIO.id; despues.atendido_at = ahora;
        } else if (despues.estado === "pendiente") {
          despues.atendido_por = null; despues.atendido_at = null;
        }
      }
      lista[i] = despues;
      this._log(tabla, obj.id, "UPDATE", antes, despues);
    } else {
      const nuevo = { ...obj, id: crypto.randomUUID(), creado_por: DEMO_USUARIO.id, creado_at: ahora, actualizado_at: ahora };
      lista.push(nuevo);
      this._log(tabla, nuevo.id, "INSERT", null, nuevo);
    }
    this._guardar();
  }

  async miPerfil() { return DEMO_USUARIO; }
  async abogados() { return structuredClone(this.db.abogados); }
  async actualizarAbogado(id, cambios) {
    const a = this.db.abogados.find((x) => x.id === id);
    if (id === DEMO_USUARIO.id && ("rol" in cambios || "activo" in cambios)) {
      throw new Error("No puede cambiar su propio rol ni desactivarse");
    }
    const antes = { ...a };
    Object.assign(a, cambios);
    this._log("abogados", id, "UPDATE", antes, a);
    this._guardar();
  }
  async expedientes() { return structuredClone(this.db.expedientes); }
  async guardarExpediente(exp) {
    const dup = this.db.expedientes.find((x) => x.id !== exp.id && x.numero === exp.numero && x.juzgado === exp.juzgado);
    if (dup) throw new Error("Ya existe un expediente con ese número en ese juzgado");
    this._upsert("expedientes", exp);
  }
  async acuerdos() { return structuredClone(this.db.acuerdos); }
  async guardarAcuerdo(ac) { this._upsert("acuerdos", ac); }
  async inhabiles() { return [...this.db.inhabiles].sort((a, b) => a.fecha.localeCompare(b.fecha)); }
  async agregarInhabil(fecha, motivo) {
    this.db.inhabiles = this.db.inhabiles.filter((x) => x.fecha !== fecha);
    this.db.inhabiles.push({ fecha, motivo });
    this._log("dias_inhabiles", fecha, "INSERT", null, { fecha, motivo });
    this._guardar();
  }
  async quitarInhabil(fecha) {
    const antes = this.db.inhabiles.find((x) => x.fecha === fecha);
    this.db.inhabiles = this.db.inhabiles.filter((x) => x.fecha !== fecha);
    this._log("dias_inhabiles", fecha, "DELETE", antes, null);
    this._guardar();
  }
  async bitacora() { return structuredClone(this.db.bitacora); }
  reiniciar() {
    this.db = semilla();
    this._guardar();
  }
}
