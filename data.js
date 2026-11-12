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

  // ---------------------------------------------- documentos, IA y escritos
  async documentos(expId) {
    return revisar(await this.sb.from("documentos").select("*").eq("expediente_id", expId).order("creado_at", { ascending: false }));
  }
  async subirDocumento(expId, archivo) {
    const limpio = archivo.name.normalize("NFD").replace(/[^\w.\-]+/g, "_").slice(-80);
    const ruta = `${expId}/${crypto.randomUUID()}-${limpio}`;
    const { error } = await this.sb.storage.from("expedientes").upload(ruta, archivo, { contentType: archivo.type, upsert: false });
    if (error) throw new Error(`No se pudo subir ${archivo.name}: ${error.message}`);
    return revisar(await this.sb.from("documentos").insert({
      expediente_id: expId, nombre: archivo.name, ruta, mime: archivo.type, tamano: archivo.size,
    }).select().single());
  }
  async urlDocumento(doc) {
    const { data, error } = await this.sb.storage.from("expedientes").createSignedUrl(doc.ruta, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }
  async ultimoAnalisis(expId) {
    return revisar(await this.sb.from("analisis").select("*").eq("expediente_id", expId)
      .order("creado_at", { ascending: false }).limit(1).maybeSingle());
  }
  async escritos(expId) {
    return revisar(await this.sb.from("escritos").select("*").eq("expediente_id", expId).order("creado_at", { ascending: false }));
  }
  async escrito(id) {
    return revisar(await this.sb.from("escritos").select("*").eq("id", id).single());
  }
  async guardarEscrito(e) {
    const { id, ...campos } = e;
    return revisar(await this.sb.from("escritos").update(campos).eq("id", id).select().single());
  }
  /** Llama a la función de IA del servidor (la llave de Anthropic nunca llega al navegador). */
  async ia(accion, params) {
    const { data, error } = await this.sb.functions.invoke("ia", { body: { accion, ...params } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* sin cuerpo JSON */ }
      throw new Error(msg);
    }
    return data;
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
    const lista = (this.db[tabla] ||= []);
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
      if (tabla === "documentos" && !antes) return;
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
  // ------------------------------------------- documentos, IA y escritos (demo)
  _tabla(n) { return (this.db[n] ||= []); }
  async documentos(expId) { return this._tabla("documentos").filter((d) => d.expediente_id === expId).reverse(); }
  async subirDocumento(expId, archivo) {
    (this.archivos ||= new Map());
    const doc = { expediente_id: expId, nombre: archivo.name, ruta: `demo/${archivo.name}`, mime: archivo.type, tamano: archivo.size, estado_ia: "sin_procesar", extraccion: null, error_ia: "" };
    this._upsert("documentos", doc);
    const nuevo = this._tabla("documentos").at(-1);
    this.archivos.set(nuevo.id, URL.createObjectURL(archivo));
    return nuevo;
  }
  async urlDocumento(doc) {
    const url = this.archivos?.get(doc.id);
    if (!url) throw new Error("En modo demo los archivos solo se pueden ver en la sesión en que se subieron.");
    return url;
  }
  async ultimoAnalisis(expId) { return this._tabla("analisis").filter((a) => a.expediente_id === expId).at(-1) || null; }
  async escritos(expId) { return this._tabla("escritos").filter((e) => e.expediente_id === expId).reverse(); }
  async escrito(id) { return structuredClone(this._tabla("escritos").find((e) => e.id === id)); }
  async guardarEscrito(e) {
    const antes = this._tabla("escritos").find((x) => x.id === e.id);
    if (["aprobado", "presentado"].includes(antes.estado) && (e.estado ?? antes.estado) === antes.estado && "contenido" in e && e.contenido !== antes.contenido) {
      throw new Error("El escrito ya tiene visto bueno; regréselo a borrador para modificarlo");
    }
    const cambios = { ...e };
    if (e.estado === "aprobado" && antes.estado !== "aprobado") Object.assign(cambios, { aprobado_por: DEMO_USUARIO.id, aprobado_at: new Date().toISOString() });
    if (e.estado === "borrador") Object.assign(cambios, { aprobado_por: null, aprobado_at: null, presentado_at: null });
    this._upsert("escritos", cambios);
    return this.escrito(e.id);
  }
  /** Respuestas de ejemplo: en demo no se llama a ninguna IA. */
  async ia(accion, p) {
    await new Promise((r) => setTimeout(r, 700));
    const hoy = hoyISO();
    if (accion === "extraer") {
      const extraccion = {
        tipo_documento: "acuerdo", legible: true,
        resumen: "(EJEMPLO DE DEMOSTRACIÓN) Acuerdo que tiene por contestada la demanda y da vista a la actora.",
        expediente: { numero: "", juzgado: "", materia: "Civil", tipo_juicio: "Ordinario civil", actor: "", demandado: "" },
        acuerdos: [{
          fecha_acuerdo: hoy, fecha_publicacion: hoy, fecha_notificacion: hoy,
          sintesis: "Se tiene por contestada la demanda en tiempo; se da vista a la parte actora por tres días para que manifieste lo que a su derecho convenga.",
          texto_relevante: "…con el escrito de cuenta se tiene por contestada la demanda…", dias_termino: 3, tipo_dias: "habiles",
          a_cargo_de_nuestro_cliente: true, accion_requerida: "Desahogar la vista", confianza: "alta",
        }],
        observaciones: "Ejemplo generado sin IA (modo demostración).",
      };
      this._upsert("documentos", { id: p.documento_id, estado_ia: "procesado", extraccion });
      return { extraccion };
    }
    if (accion === "analizar") {
      const resultado = {
        tipo_juicio: "Ordinario civil", legislacion_aplicable: ["Código de Procedimientos Civiles local [VERIFICAR]"],
        etapa_actual: "Fijación de la litis (contestación y vista)", explicacion_etapa: "(EJEMPLO) La demanda fue contestada y corre la vista a la actora.",
        etapas: [
          { nombre: "Demanda y admisión", estado: "concluida" }, { nombre: "Emplazamiento", estado: "concluida" },
          { nombre: "Contestación y vista", estado: "actual" }, { nombre: "Pruebas", estado: "pendiente" },
          { nombre: "Alegatos", estado: "pendiente" }, { nombre: "Sentencia", estado: "pendiente" },
        ],
        ultimo_acontecimiento: "Acuerdo que da vista con la contestación.", siguiente_paso: "Desahogar la vista dentro del término.",
        acciones: [{ prioridad: "urgente", accion: "Desahogar la vista con la contestación", fundamento: "[VERIFICAR]", fecha_limite: "", escrito_sugerido: "Desahogo de vista" }],
        riesgos: ["Preclusión del derecho a desahogar la vista"], datos_faltantes: ["Copia de la contestación de demanda"],
      };
      const analisis = { expediente_id: p.expediente_id, resultado, modelo: "demo" };
      this._upsert("analisis", analisis);
      this._upsert("expedientes", { id: p.expediente_id, etapa: resultado.etapa_actual });
      return { analisis: this._tabla("analisis").at(-1) };
    }
    if (accion === "redactar") {
      const exp = this.db.expedientes.find((e) => e.id === p.expediente_id) || {};
      const contenido = [
        `EXPEDIENTE: ${exp.numero}\n${(p.tipo_escrito || "").toUpperCase()}`,
        `C. JUEZ ${String(exp.juzgado || "").toUpperCase()}\nP R E S E N T E`,
        "[COMPLETAR: nombre del promovente], en mi carácter de [COMPLETAR], ante Usted con el debido respeto comparezco para exponer:",
        "(EJEMPLO DE DEMOSTRACIÓN — en producción este texto lo redacta la IA con base en el expediente.)",
        "Por lo anteriormente expuesto, a Usted C. Juez, atentamente pido:\n\nPRIMERO.- Tenerme por presentado en los términos de este escrito.",
        "PROTESTO LO NECESARIO\n[COMPLETAR: lugar], a [COMPLETAR: fecha]\n\n\n______________________________\n[COMPLETAR: nombre y firma]",
      ].join("\n\n");
      this._upsert("escritos", { expediente_id: p.expediente_id, acuerdo_id: p.acuerdo_id || null, titulo: p.tipo_escrito, contenido, estado: "borrador", generado_ia: true,
        notas_ia: { fundamentos: [], datos_por_completar: ["Nombre del promovente", "Lugar y fecha"], notas: "Ejemplo de demostración." } });
      return { escrito: this._tabla("escritos").at(-1) };
    }
    throw new Error("Acción desconocida");
  }

  reiniciar() {
    this.db = semilla();
    this._guardar();
  }
}
