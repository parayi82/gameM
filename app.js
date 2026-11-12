import {
  hoyISO, calcularVencimiento, semaforo, describirRestante, diasHabilesRestantes,
} from "./plazos.js";
import { SupabaseDatos, DemoDatos } from "./data.js";

const CFG = window.DESPACHO_CONFIG || {};
const MINUTOS_INACTIVIDAD = CFG.MINUTOS_INACTIVIDAD || 20;
const raiz = document.getElementById("app");

// ------------------------------------------------------------ utilidades DOM
// Todo el contenido se inserta como texto (textContent): nunca innerHTML con
// datos del usuario, así no hay forma de inyectar código.
function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of hijos.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const fmt = (iso) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};
const fmtHora = (ts) => (ts ? new Date(ts).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—");

function aviso(msg, tipo = "ok") {
  const t = h("div", { class: `toast toast-${tipo}`, role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 4500);
}

async function intentar(fn, ok) {
  try {
    await fn();
    if (ok) aviso(ok);
    return true;
  } catch (e) {
    aviso(e.message || String(e), "error");
    return false;
  }
}

function pantallaCentrada(...hijos) {
  raiz.replaceChildren(
    h("main", { class: "centrado" },
      h("div", { class: "tarjeta auth" },
        h("div", { class: "marca" }, h("span", { class: "sello" }, "§"), CFG.NOMBRE_DESPACHO || "Despacho"),
        ...hijos)));
}

// ------------------------------------------------------------------- estado
const S = {
  datos: null, sb: null, perfil: null,
  abogados: [], expedientes: [], acuerdos: [], inhabiles: [], inhSet: new Set(),
  vista: "agenda", filtro: "mios", busqueda: "", verAtendidos: false, expedienteSel: null,
  detalle: null, escritoSel: null,
};

const nombreAbogado = (id) => {
  const a = S.abogados.find((x) => x.id === id);
  return a ? a.nombre || a.email : "Sin asignar";
};
const expediente = (id) => S.expedientes.find((x) => x.id === id);

async function cargarTodo() {
  const [abogados, expedientes, acuerdos, inhabiles] = await Promise.all([
    S.datos.abogados(), S.datos.expedientes(), S.datos.acuerdos(), S.datos.inhabiles(),
  ]);
  Object.assign(S, { abogados, expedientes, acuerdos, inhabiles, inhSet: new Set(inhabiles.map((x) => x.fecha)) });
}

async function refrescar() {
  await intentar(cargarTodo);
  render();
}

// --------------------------------------------------------------- arranque
async function iniciar() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
    S.datos = new DemoDatos();
    S.perfil = await S.datos.miPerfil();
    await cargarTodo();
    return render();
  }
  // Detectar enlaces de invitación / recuperación ANTES de que supabase-js limpie la URL.
  const hash = location.hash;
  const debeFijarPassword = /type=(invite|recovery)/.test(hash);

  S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    // sessionStorage: la sesión muere al cerrar la pestaña/navegador.
    auth: { storage: window.sessionStorage, persistSession: true, detectSessionInUrl: true },
  });
  S.datos = new SupabaseDatos(S.sb);

  const { data: { session } } = await S.sb.auth.getSession();
  if (!session) return vistaLogin();
  if (debeFijarPassword) return vistaFijarPassword();
  return verificarSegundoFactor();
}

async function verificarSegundoFactor() {
  const { data, error } = await S.sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return vistaLogin(error.message);
  if (data.currentLevel === "aal2") return entrar();
  if (data.nextLevel === "aal2") return vistaRetoMFA();
  return vistaAltaMFA();
}

async function entrar() {
  const { data: { user } } = await S.sb.auth.getUser();
  try {
    S.perfil = await S.datos.miPerfil(user.id);
  } catch (e) {
    return vistaLogin(e.message);
  }
  if (!S.perfil || !S.perfil.activo) {
    return pantallaCentrada(
      h("h1", {}, "Cuenta pendiente de activación"),
      h("p", {}, `Su cuenta (${user.email}) aún no ha sido activada por el administrador del despacho.`),
      h("button", { class: "btn", onclick: salir }, "Salir"));
  }
  vigilarInactividad();
  await refrescar();
}

async function salir() {
  if (S.sb) await S.sb.auth.signOut();
  sessionStorage.clear();
  location.replace(location.pathname);
}

function vigilarInactividad() {
  let t;
  const reiniciar = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await salir();
    }, MINUTOS_INACTIVIDAD * 60 * 1000);
  };
  ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((ev) => addEventListener(ev, reiniciar, { passive: true }));
  reiniciar();
}

// -------------------------------------------------------------- vistas auth
function vistaLogin(error) {
  const email = h("input", { type: "email", required: true, autocomplete: "username", placeholder: "correo@despacho.mx" });
  const pass = h("input", { type: "password", required: true, autocomplete: "current-password" });
  const msg = h("p", { class: "error", role: "alert" }, error || "");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = "";
      const { error } = await S.sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (error) {
        msg.textContent = "Correo o contraseña incorrectos.";
        return;
      }
      verificarSegundoFactor();
    },
  },
  h("label", {}, "Correo", email),
  h("label", {}, "Contraseña", pass),
  msg,
  h("button", { class: "btn btn-primario", type: "submit" }, "Entrar"),
  h("button", {
    class: "btn-link", type: "button",
    onclick: async () => {
      if (!email.value) { msg.textContent = "Escriba su correo primero."; return; }
      await S.sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
      msg.textContent = "";
      aviso("Si el correo está registrado, recibirá un enlace para restablecer su contraseña.");
    },
  }, "Olvidé mi contraseña"));
  pantallaCentrada(
    h("h1", {}, "Acceso exclusivo para abogados"),
    h("p", { class: "tenue" }, "Solo personal autorizado. Los accesos quedan registrados."),
    form);
}

function vistaFijarPassword() {
  const p1 = h("input", { type: "password", required: true, minlength: 12, autocomplete: "new-password" });
  const p2 = h("input", { type: "password", required: true, minlength: 12, autocomplete: "new-password" });
  const msg = h("p", { class: "error", role: "alert" });
  pantallaCentrada(
    h("h1", {}, "Defina su contraseña"),
    h("p", { class: "tenue" }, "Mínimo 12 caracteres. Use una frase larga que no use en otro sitio."),
    h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        if (p1.value !== p2.value) { msg.textContent = "Las contraseñas no coinciden."; return; }
        if (p1.value.length < 12) { msg.textContent = "Mínimo 12 caracteres."; return; }
        const { error } = await S.sb.auth.updateUser({ password: p1.value });
        if (error) { msg.textContent = error.message; return; }
        history.replaceState(null, "", location.pathname);
        verificarSegundoFactor();
      },
    }, h("label", {}, "Nueva contraseña", p1), h("label", {}, "Repetir contraseña", p2), msg,
    h("button", { class: "btn btn-primario" }, "Guardar")));
}

async function vistaAltaMFA() {
  // Limpiar intentos de alta anteriores que no se completaron.
  const { data: lista } = await S.sb.auth.mfa.listFactors();
  for (const f of lista?.all || []) {
    if (f.status === "unverified") await S.sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await S.sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Despacho ${Date.now()}` });
  if (error) return vistaLogin(error.message);
  const codigo = h("input", { inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6, required: true, autocomplete: "one-time-code" });
  const msg = h("p", { class: "error", role: "alert" });
  pantallaCentrada(
    h("h1", {}, "Active la verificación en dos pasos"),
    h("p", {}, "Es obligatoria. Escanee el código con Google Authenticator, Microsoft Authenticator o similar y escriba el código de 6 dígitos."),
    h("img", { class: "qr", src: data.totp.qr_code, alt: "Código QR para la app autenticadora" }),
    h("p", { class: "tenue" }, "¿No puede escanear? Clave manual: ", h("code", {}, data.totp.secret)),
    h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        const { error } = await S.sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: codigo.value.trim() });
        if (error) { msg.textContent = "Código incorrecto, intente de nuevo."; return; }
        entrar();
      },
    }, h("label", {}, "Código", codigo), msg, h("button", { class: "btn btn-primario" }, "Verificar")),
    h("button", { class: "btn-link", onclick: salir }, "Cancelar y salir"));
}

async function vistaRetoMFA() {
  const { data } = await S.sb.auth.mfa.listFactors();
  const factor = data?.totp?.[0];
  if (!factor) return vistaAltaMFA();
  const codigo = h("input", { inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6, required: true, autocomplete: "one-time-code", autofocus: true });
  const msg = h("p", { class: "error", role: "alert" });
  pantallaCentrada(
    h("h1", {}, "Verificación en dos pasos"),
    h("p", {}, "Escriba el código de 6 dígitos de su app autenticadora."),
    h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        const { error } = await S.sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo.value.trim() });
        if (error) { msg.textContent = "Código incorrecto."; return; }
        entrar();
      },
    }, h("label", {}, "Código", codigo), msg, h("button", { class: "btn btn-primario" }, "Entrar")),
    h("button", { class: "btn-link", onclick: salir }, "Salir"));
  codigo.focus();
}

// ------------------------------------------------------------------ layout
function render() {
  const esAdmin = S.perfil?.rol === "admin";
  const pestañas = [
    ["agenda", "Agenda de términos"],
    ["expedientes", "Expedientes"],
    ["inhabiles", "Días inhábiles"],
    ...(esAdmin ? [["equipo", "Equipo"], ["bitacora", "Bitácora"]] : []),
  ];
  // Insignia: acuerdos vencidos o que vencen hoy.
  const urgentes = S.acuerdos.filter((a) => a.estado === "pendiente" && a.fecha_vencimiento && a.fecha_vencimiento <= hoyISO()).length;

  const cuerpo = {
    agenda: vistaAgenda, expedientes: vistaExpedientes, inhabiles: vistaInhabiles,
    equipo: vistaEquipo, bitacora: vistaBitacora, expediente: vistaDetalleExpediente, escrito: vistaEscrito,
  }[S.vista]();

  raiz.replaceChildren(
    S.datos.demo && h("div", { class: "banda-demo" },
      "MODO DEMOSTRACIÓN — los datos se guardan solo en este navegador. No capture información real de clientes. ",
      h("button", { class: "btn-link", onclick: () => { S.datos.reiniciar(); refrescar(); } }, "Reiniciar demo")),
    h("header", { class: "barra" },
      h("div", { class: "marca" }, h("span", { class: "sello" }, "§"), CFG.NOMBRE_DESPACHO || "Despacho"),
      h("nav", {}, pestañas.map(([id, txt]) =>
        h("button", {
          class: `tab ${S.vista === id || (id === "expedientes" && ["expediente", "escrito"].includes(S.vista)) ? "activa" : ""}`,
          onclick: () => { S.vista = id; render(); },
        }, txt, id === "agenda" && urgentes ? h("span", { class: "insignia", title: "Vencidos o vencen hoy" }, urgentes) : null))),
      h("div", { class: "usuario" },
        h("span", {}, S.perfil.nombre || S.perfil.email),
        h("button", { class: "btn btn-chico", onclick: salir }, "Salir"))),
    h("main", { class: "contenido" }, cuerpo));
}

// ------------------------------------------------------------------ agenda
function vistaAgenda() {
  const hoy = hoyISO();
  let lista = S.acuerdos.filter((a) => (S.verAtendidos ? true : a.estado === "pendiente"));
  if (S.filtro === "mios") lista = lista.filter((a) => a.responsable_id === S.perfil.id);
  if (S.busqueda) {
    const q = S.busqueda.toLowerCase();
    lista = lista.filter((a) => {
      const e = expediente(a.expediente_id) || {};
      return [a.descripcion, e.numero, e.cliente, e.juzgado, nombreAbogado(a.responsable_id)].join(" ").toLowerCase().includes(q);
    });
  }
  lista.sort((a, b) => (a.estado === b.estado ? 0 : a.estado === "pendiente" ? -1 : 1)
    || (a.fecha_vencimiento || "9999").localeCompare(b.fecha_vencimiento || "9999"));

  const pend = S.acuerdos.filter((a) => a.estado === "pendiente" && (S.filtro === "todos" || a.responsable_id === S.perfil.id));
  const cuenta = (pred) => pend.filter((a) => a.fecha_vencimiento && pred(diasHabilesRestantes(hoy, a.fecha_vencimiento, S.inhSet))).length;

  return [
    h("div", { class: "encabezado" },
      h("h1", {}, "Agenda de términos"),
      h("div", { class: "acciones" },
        h("button", { class: "btn", onclick: exportarCSV }, "Exportar CSV"),
        h("button", { class: "btn btn-primario", onclick: () => formAcuerdo() }, "+ Registrar acuerdo"))),
    h("div", { class: "resumen" },
      kpi("Vencidos", cuenta((r) => r < 0), "rojo"),
      kpi("Vencen hoy", cuenta((r) => r === 0), "rojo"),
      kpi("Próximos 3 días hábiles", cuenta((r) => r >= 1 && r <= 3), "ambar"),
      kpi("Pendientes", pend.length, "neutro")),
    h("div", { class: "filtros" },
      h("div", { class: "segmentado" },
        ["mios", "todos"].map((f) => h("button", {
          class: S.filtro === f ? "activa" : "", onclick: () => { S.filtro = f; render(); },
        }, f === "mios" ? "Mis asuntos" : "Todo el despacho"))),
      h("input", {
        type: "search", placeholder: "Buscar expediente, cliente, juzgado…", value: S.busqueda,
        oninput: (e) => { S.busqueda = e.target.value; const pos = e.target.selectionStart; render(); const i = raiz.querySelector(".filtros input[type=search]"); i.focus(); i.setSelectionRange(pos, pos); },
      }),
      h("label", { class: "check" },
        h("input", { type: "checkbox", checked: S.verAtendidos, onchange: (e) => { S.verAtendidos = e.target.checked; render(); } }),
        "Incluir atendidos")),
    lista.length ? tablaAcuerdos(lista, true) : h("p", { class: "vacio" }, "No hay acuerdos pendientes con estos filtros. 👍"),
  ];
}

function kpi(titulo, valor, color) {
  return h("div", { class: `kpi kpi-${color}` }, h("div", { class: "kpi-valor" }, valor), h("div", { class: "kpi-titulo" }, titulo));
}

function tablaAcuerdos(lista, conExpediente) {
  const hoy = hoyISO();
  return h("div", { class: "tabla-wrap" }, h("table", {},
    h("thead", {}, h("tr", {},
      h("th", {}, "Vencimiento"), conExpediente && h("th", {}, "Expediente"), h("th", {}, "Acuerdo"),
      h("th", {}, "Responsable"), h("th", {}, ""))),
    h("tbody", {}, lista.map((a) => {
      const e = expediente(a.expediente_id) || {};
      const atendido = a.estado === "atendido";
      const color = atendido ? "atendido" : semaforo(hoy, a.fecha_vencimiento, S.inhSet);
      return h("tr", { class: `fila-${color}` },
        h("td", {}, h("div", { class: "venc" },
          h("span", { class: `punto punto-${color}` }),
          h("div", {}, h("strong", {}, fmt(a.fecha_vencimiento)),
            h("div", { class: "tenue chico" }, atendido ? `Atendido ${fmtHora(a.atendido_at)}` : describirRestante(hoy, a.fecha_vencimiento, S.inhSet))))),
        conExpediente && h("td", {},
          h("button", { class: "btn-link", onclick: () => abrirExpediente(e.id) }, e.numero || "—"),
          h("div", { class: "tenue chico" }, e.cliente), h("div", { class: "tenue chico" }, e.juzgado)),
        h("td", {}, a.descripcion,
          h("div", { class: "tenue chico" }, `Notificado ${fmt(a.fecha_notificacion)}`, a.dias_termino ? ` · término ${a.dias_termino} días hábiles` : ""),
          a.nota_atencion && h("div", { class: "nota" }, "✔ ", a.nota_atencion),
          a.documento_id && h("button", { class: "btn-link chico", onclick: () => abrirDocumento({ id: a.documento_id }) }, "📎 Ver documento escaneado")),
        h("td", {}, nombreAbogado(a.responsable_id)),
        h("td", {}, h("div", { class: "acciones-fila" },
          atendido
            ? h("button", { class: "btn btn-chico", onclick: () => reabrir(a) }, "Reabrir")
            : h("button", { class: "btn btn-chico btn-ok", onclick: () => marcarAtendido(a) }, "Marcar atendido"),
          h("button", { class: "btn btn-chico", onclick: () => formAcuerdo(a) }, "Editar"))));
    }))));
}

function marcarAtendido(a) {
  const nota = h("textarea", { rows: 3, required: true, placeholder: "Ej. Se presentó escrito de contestación el 12/11, folio 4587." });
  modal("Marcar acuerdo como atendido", [
    h("p", { class: "tenue" }, a.descripcion),
    h("label", {}, "¿Qué se hizo? (obligatorio, queda en el registro)", nota),
  ], async () => {
    if (!nota.value.trim()) throw new Error("Describa cómo se atendió el acuerdo.");
    await S.datos.guardarAcuerdo({ id: a.id, estado: "atendido", nota_atencion: nota.value.trim() });
  }, "Acuerdo marcado como atendido");
}

function reabrir(a) {
  if (!confirm("¿Reabrir este acuerdo como pendiente?")) return;
  intentar(() => S.datos.guardarAcuerdo({ id: a.id, estado: "pendiente" }), "Acuerdo reabierto").then(refrescar);
}

function formAcuerdo(a = {}, expedienteFijo) {
  const activos = S.expedientes.filter((e) => e.estado === "activo" || e.id === a.expediente_id);
  if (!activos.length) {
    aviso("Primero dé de alta un expediente.", "error");
    S.vista = "expedientes";
    return render();
  }
  const hoy = hoyISO();
  const exp = h("select", { required: true },
    h("option", { value: "" }, "— Seleccione —"),
    activos.map((e) => h("option", { value: e.id }, `${e.numero} · ${e.juzgado} · ${e.cliente}`)));
  exp.value = a.expediente_id || expedienteFijo || "";
  const pub = h("input", { type: "date", value: a.fecha_publicacion || "" });
  const notif = h("input", { type: "date", required: true, value: a.fecha_notificacion || hoy });
  const desc = h("textarea", { rows: 3, required: true, value: a.descripcion || "", placeholder: "Síntesis del acuerdo y lo que se debe hacer" });
  const modo = h("select", {},
    h("option", { value: "dias" }, "Término en días hábiles"),
    h("option", { value: "fecha" }, "Fecha límite específica"),
    h("option", { value: "ninguno" }, "Sin término (informativo)"));
  modo.value = a.id ? (a.dias_termino ? "dias" : a.fecha_vencimiento ? "fecha" : "ninguno") : (a.modo || "dias");
  const dias = h("input", { type: "number", min: 1, max: 365, value: a.dias_termino || 3 });
  const surte = h("input", { type: "checkbox", checked: a.id ? a.surte_efectos !== false : true });
  const fechaFija = h("input", { type: "date", value: a.fecha_vencimiento || "" });
  const resp = h("select", {},
    h("option", { value: "" }, "Sin asignar"),
    S.abogados.filter((x) => x.activo).map((x) => h("option", { value: x.id }, x.nombre || x.email)));
  resp.value = a.responsable_id || expediente(exp.value)?.responsable_id || S.perfil.id;
  exp.addEventListener("change", () => { if (!a.id) resp.value = expediente(exp.value)?.responsable_id || S.perfil.id; });

  const vista = h("div", { class: "calculo" });
  const filaDias = h("div", { class: "fila" }, h("label", {}, "Días hábiles", dias),
    h("label", { class: "check" }, surte, "La notificación surte efectos al día hábil siguiente"));
  const filaFecha = h("label", {}, "Fecha límite", fechaFija);

  function vencimiento() {
    if (modo.value === "ninguno") return null;
    if (modo.value === "fecha") return fechaFija.value || null;
    const r = calcularVencimiento({ fechaNotificacion: notif.value, dias: Number(dias.value), surteEfectos: surte.checked, inhabiles: S.inhSet });
    return r?.vencimiento || null;
  }
  function actualizar() {
    filaDias.hidden = modo.value !== "dias";
    filaFecha.hidden = modo.value !== "fecha";
    vista.replaceChildren();
    if (modo.value === "dias") {
      const r = calcularVencimiento({ fechaNotificacion: notif.value, dias: Number(dias.value), surteEfectos: surte.checked, inhabiles: S.inhSet });
      if (r) {
        vista.append(
          h("div", {}, "Surte efectos: ", h("strong", {}, fmt(r.surte)), " · Empieza a correr: ", h("strong", {}, fmt(r.inicio))),
          h("div", { class: "venc-grande" }, "Vence: ", fmt(r.vencimiento)),
          h("div", { class: "tenue chico" }, "Cálculo excluyendo sábados, domingos y días inhábiles registrados. Verifique siempre contra la ley aplicable."));
      }
    }
    const v = vencimiento();
    if (v && v <= hoy && !a.id) vista.append(h("div", { class: "error" }, "⚠ El término vence hoy o ya venció."));
  }
  [modo, dias, surte, notif, fechaFija].forEach((el) => el.addEventListener("input", actualizar));
  actualizar();

  modal(a.id ? "Editar acuerdo" : "Registrar acuerdo", [
    a.propuestoIA && h("div", { class: "aviso-ia" }, "Datos propuestos por la IA a partir del documento. Verifíquelos contra el original antes de guardar."),
    h("label", {}, "Expediente", exp),
    h("div", { class: "fila" }, h("label", {}, "Fecha de publicación", pub), h("label", {}, "Fecha de notificación", notif)),
    h("label", {}, "Acuerdo", desc),
    h("label", {}, "Plazo", modo),
    filaDias, filaFecha, vista,
    h("label", {}, "Responsable", resp),
  ], async () => {
    if (!exp.value) throw new Error("Seleccione el expediente.");
    if (!desc.value.trim()) throw new Error("Escriba la síntesis del acuerdo.");
    if (!notif.value) throw new Error("Indique la fecha de notificación.");
    const v = vencimiento();
    if (modo.value !== "ninguno" && !v) throw new Error("Indique el plazo.");
    if (v && v < notif.value) throw new Error("El vencimiento no puede ser anterior a la notificación.");
    await S.datos.guardarAcuerdo({
      ...(a.id ? { id: a.id } : {}),
      expediente_id: exp.value,
      fecha_publicacion: pub.value || null,
      fecha_notificacion: notif.value,
      descripcion: desc.value.trim(),
      dias_termino: modo.value === "dias" ? Number(dias.value) : null,
      surte_efectos: surte.checked,
      fecha_vencimiento: v,
      responsable_id: resp.value || null,
      ...(a.documento_id ? { documento_id: a.documento_id } : {}),
    });
    if (S.vista === "expediente") cargarDetalle(exp.value);
  }, a.id ? "Acuerdo actualizado" : "Acuerdo registrado");
}

function exportarCSV() {
  const cols = ["expediente", "juzgado", "cliente", "acuerdo", "notificacion", "vencimiento", "responsable", "estado", "nota_atencion"];
  const esc = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const filas = S.acuerdos.map((a) => {
    const e = expediente(a.expediente_id) || {};
    return [e.numero, e.juzgado, e.cliente, a.descripcion, a.fecha_notificacion, a.fecha_vencimiento, nombreAbogado(a.responsable_id), a.estado, a.nota_atencion].map(esc).join(",");
  });
  const blob = new Blob(["﻿" + [cols.join(","), ...filas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  h("a", { href: url, download: `acuerdos-${hoyISO()}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------- expedientes
function vistaExpedientes() {
  const q = S.busqueda.toLowerCase();
  const lista = S.expedientes.filter((e) => !q || [e.numero, e.juzgado, e.cliente, e.contraparte, e.materia].join(" ").toLowerCase().includes(q));
  const pendientesDe = (id) => S.acuerdos.filter((a) => a.expediente_id === id && a.estado === "pendiente");
  return [
    h("div", { class: "encabezado" },
      h("h1", {}, "Expedientes"),
      h("button", { class: "btn btn-primario", onclick: () => formExpediente() }, "+ Nuevo expediente")),
    h("div", { class: "filtros" }, h("input", {
      type: "search", placeholder: "Buscar por número, juzgado, cliente…", value: S.busqueda,
      oninput: (e) => { S.busqueda = e.target.value; const pos = e.target.selectionStart; render(); const i = raiz.querySelector(".filtros input[type=search]"); i.focus(); i.setSelectionRange(pos, pos); },
    })),
    lista.length ? h("div", { class: "tabla-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Expediente", "Juzgado", "Cliente", "Materia", "Responsable", "Pendientes", "Estado"].map((t) => h("th", {}, t)))),
      h("tbody", {}, lista.map((e) => {
        const p = pendientesDe(e.id);
        const peor = p.map((a) => semaforo(hoyISO(), a.fecha_vencimiento, S.inhSet)).sort((x, y) => ["rojo", "ambar", "verde", "gris"].indexOf(x) - ["rojo", "ambar", "verde", "gris"].indexOf(y))[0];
        return h("tr", { class: "clic", onclick: () => abrirExpediente(e.id) },
          h("td", {}, h("strong", {}, e.numero)), h("td", {}, e.juzgado), h("td", {}, e.cliente), h("td", {}, e.materia),
          h("td", {}, nombreAbogado(e.responsable_id)),
          h("td", {}, p.length ? [h("span", { class: `punto punto-${peor}` }), p.length] : "—"),
          h("td", {}, h("span", { class: `etiqueta etiqueta-${e.estado}` }, e.estado)));
      })))) : h("p", { class: "vacio" }, "Aún no hay expedientes."),
  ];
}

// ------------------------------------------------- detalle de expediente
function abrirExpediente(id) {
  S.expedienteSel = id;
  S.vista = "expediente";
  S.detalle = null;
  render();
  cargarDetalle(id);
}

async function cargarDetalle(id) {
  try {
    const [documentos, escritos, analisis] = await Promise.all([
      S.datos.documentos(id), S.datos.escritos(id), S.datos.ultimoAnalisis(id),
    ]);
    if (S.expedienteSel !== id) return;
    S.detalle = { documentos, escritos, analisis };
  } catch (e) {
    S.detalle = { documentos: [], escritos: [], analisis: null, error: e.message };
  }
  if (S.vista === "expediente") render();
}

/** Ventana de espera mientras trabaja la IA (no se puede cerrar a medias). */
async function conCargando(mensaje, fn) {
  const dlg = h("dialog", { class: "modal cargando-ia" },
    h("div", { class: "cargando-cuerpo" }, h("div", { class: "spinner" }), h("p", {}, mensaje),
      h("p", { class: "tenue chico" }, "Puede tardar de 30 segundos a 2 minutos. No cierre esta ventana.")));
  dlg.addEventListener("cancel", (e) => e.preventDefault());
  document.body.append(dlg);
  dlg.showModal();
  try {
    return await fn();
  } finally {
    dlg.close();
    dlg.remove();
  }
}

async function abrirDocumento(doc) {
  // Se abre la ventana antes de pedir el enlace para que el navegador no la bloquee.
  const w = window.open("", "_blank");
  try {
    const url = await S.datos.urlDocumento(doc);
    if (w) w.location.href = url; else location.href = url;
  } catch (e) {
    if (w) w.close();
    aviso(e.message, "error");
  }
}

function vistaDetalleExpediente() {
  const e = expediente(S.expedienteSel);
  if (!e) { S.vista = "expedientes"; return vistaExpedientes(); }
  const acs = S.acuerdos.filter((a) => a.expediente_id === e.id)
    .sort((x, y) => (x.estado === y.estado ? 0 : x.estado === "pendiente" ? -1 : 1) || (y.fecha_notificacion || "").localeCompare(x.fecha_notificacion || ""));
  const d = S.detalle;
  return [
    h("button", { class: "btn-link", onclick: () => { S.vista = "expedientes"; render(); } }, "← Expedientes"),
    h("div", { class: "encabezado" },
      h("h1", {}, `Expediente ${e.numero}`),
      h("div", { class: "acciones" },
        h("button", { class: "btn", onclick: () => formExpediente(e) }, "Editar"),
        h("button", { class: "btn btn-primario", onclick: () => formAcuerdo({}, e.id) }, "+ Registrar acuerdo"))),
    h("dl", { class: "ficha" },
      ...[["Juzgado", e.juzgado], ["Materia", e.materia], ["Tipo de juicio", e.tipo_juicio], ["Cliente", e.cliente],
        ["Representamos a", e.representa], ["Contraparte", e.contraparte], ["Etapa", e.etapa],
        ["Responsable", nombreAbogado(e.responsable_id)], ["Estado", e.estado], ["Notas", e.notas]]
        .flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v || "—")])),
    d?.error && h("p", { class: "error" }, d.error),
    seccionAnalisis(e, d),
    h("h2", {}, "Acuerdos"),
    acs.length ? tablaAcuerdos(acs, false) : h("p", { class: "vacio" }, "Sin acuerdos registrados. Suba el acuerdo escaneado y la IA le propondrá los datos."),
    seccionDocumentos(e, d),
    seccionEscritos(e, d),
  ];
}

// ------------------------------------------------------------ análisis IA
function seccionAnalisis(e, d) {
  const an = d?.analisis;
  const r = an?.resultado;
  const boton = h("button", { class: "btn btn-ia", disabled: !d, onclick: () => analizar(e) }, r ? "↻ Volver a analizar" : "✦ Analizar etapa y siguiente paso");
  if (!r) {
    return h("section", { class: "panel-ia" },
      h("div", { class: "panel-cab" }, h("h2", {}, "Análisis del juicio"), boton),
      h("p", { class: "tenue" }, d ? "La IA revisa los acuerdos y documentos del expediente, determina en qué etapa va el juicio, qué sigue y qué escrito corresponde." : "Cargando…"));
  }
  const prioridad = { urgente: "rojo", alta: "ambar", normal: "neutro" };
  return h("section", { class: "panel-ia" },
    h("div", { class: "panel-cab" },
      h("div", {}, h("h2", {}, "Análisis del juicio"),
        h("div", { class: "tenue chico" }, `Generado por IA el ${fmtHora(an.creado_at)} — es una propuesta: verifíquela.`)),
      boton),
    h("div", { class: "etapa-actual" }, h("span", { class: "tenue chico" }, "Etapa actual"), h("strong", {}, r.etapa_actual), h("p", {}, r.explicacion_etapa)),
    r.etapas?.length > 0 && h("ol", { class: "linea-etapas" }, r.etapas.map((x) => h("li", { class: `etapa-${x.estado}` }, x.nombre))),
    h("div", { class: "rejilla-2" },
      h("div", {}, h("h3", {}, "Último acontecimiento"), h("p", {}, r.ultimo_acontecimiento || "—")),
      h("div", {}, h("h3", {}, "Siguiente paso"), h("p", {}, h("strong", {}, r.siguiente_paso || "—")))),
    r.acciones?.length > 0 && [h("h3", {}, "Acciones a realizar"),
      h("ul", { class: "acciones-ia" }, r.acciones.map((x) => h("li", {},
        h("span", { class: `etiqueta etiqueta-${prioridad[x.prioridad] || "neutro"}` }, x.prioridad),
        h("div", { class: "accion-texto" }, h("strong", {}, x.accion),
          x.fundamento && h("div", { class: "tenue chico" }, "Fundamento: ", x.fundamento),
          x.fecha_limite && h("div", { class: "chico" }, "Fecha límite: ", fmt(x.fecha_limite))),
        x.escrito_sugerido && h("button", { class: "btn btn-chico btn-ia", onclick: () => nuevoEscrito(e, { tipo: x.escrito_sugerido, instrucciones: x.accion }) },
          "✎ Redactar: ", x.escrito_sugerido))))],
    (r.riesgos?.length || r.datos_faltantes?.length) && h("div", { class: "rejilla-2" },
      r.riesgos?.length > 0 && h("div", {}, h("h3", {}, "Riesgos"), h("ul", {}, r.riesgos.map((x) => h("li", {}, x)))),
      r.datos_faltantes?.length > 0 && h("div", {}, h("h3", {}, "Información que falta"), h("ul", {}, r.datos_faltantes.map((x) => h("li", {}, x))))),
    r.legislacion_aplicable?.length > 0 && h("p", { class: "tenue chico" }, "Legislación considerada: ", r.legislacion_aplicable.join("; ")));
}

async function analizar(e) {
  const ok = await intentar(() => conCargando("La IA está analizando el expediente…", () => S.datos.ia("analizar", { expediente_id: e.id })), "Análisis listo");
  if (ok) { await cargarTodo(); await cargarDetalle(e.id); }
}

// -------------------------------------------------------------- documentos
const ESTADO_IA = { sin_procesar: ["Sin leer", "neutro"], procesando: ["Leyendo…", "ambar"], procesado: ["Leído por IA", "activo"], error: ["Error al leer", "rojo"] };
const fmtTam = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function seccionDocumentos(e, d) {
  const input = h("input", {
    type: "file", multiple: true, hidden: true, accept: "application/pdf,image/jpeg,image/png,image/webp",
    onchange: () => subirArchivos(e, [...input.files]),
  });
  return h("section", {},
    h("div", { class: "panel-cab" },
      h("h2", {}, "Documentos escaneados"),
      h("button", { class: "btn btn-primario", disabled: !d, onclick: () => input.click() }, "⬆ Subir archivos"), input),
    h("p", { class: "tenue chico" }, "PDF o fotos (JPG/PNG) de acuerdos, demanda, contestación, etc. Máximo 30 MB por archivo. Al subirlos, la IA los lee y le propone los acuerdos y fechas para que usted los confirme."),
    !d ? h("p", { class: "tenue" }, "Cargando…")
      : d.documentos.length ? h("div", { class: "tabla-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Archivo", "Subido", "Lectura IA", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, d.documentos.map((doc) => {
          const [txt, color] = ESTADO_IA[doc.estado_ia] || ESTADO_IA.sin_procesar;
          return h("tr", {},
            h("td", {}, h("strong", {}, doc.nombre), h("div", { class: "tenue chico" }, fmtTam(doc.tamano),
              doc.extraccion?.tipo_documento ? ` · ${doc.extraccion.tipo_documento}` : "")),
            h("td", { class: "chico" }, fmtHora(doc.creado_at)),
            h("td", {}, h("span", { class: `etiqueta etiqueta-${color}` }, txt), doc.error_ia && h("div", { class: "error chico" }, doc.error_ia)),
            h("td", {}, h("div", { class: "acciones-fila" },
              h("button", { class: "btn btn-chico", onclick: () => abrirDocumento(doc) }, "Ver"),
              doc.extraccion && h("button", { class: "btn btn-chico btn-ok", onclick: () => verExtraccion(e, doc) }, "Ver lo que leyó"),
              h("button", { class: "btn btn-chico btn-ia", onclick: () => leerConIA(e, doc) }, doc.extraccion ? "Volver a leer" : "✦ Leer con IA"))));
        })))) : h("p", { class: "vacio" }, "Aún no hay documentos en este expediente."));
}

async function subirArchivos(e, archivos) {
  const permitidos = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  for (const f of archivos) {
    if (!permitidos.includes(f.type)) { aviso(`${f.name}: solo PDF, JPG, PNG o WEBP.`, "error"); continue; }
    if (f.size > 30 * 1024 * 1024) { aviso(`${f.name}: excede 30 MB. Divídalo en partes.`, "error"); continue; }
    let doc;
    const subido = await intentar(async () => { doc = await conCargando(`Subiendo ${f.name}…`, () => S.datos.subirDocumento(e.id, f)); });
    if (!subido) continue;
    await cargarDetalle(e.id);
    await leerConIA(e, doc);
  }
}

async function leerConIA(e, doc) {
  let res;
  const ok = await intentar(async () => {
    res = await conCargando(`La IA está leyendo “${doc.nombre}”…`, () => S.datos.ia("extraer", { documento_id: doc.id }));
  });
  await cargarDetalle(e.id);
  if (ok) verExtraccion(e, { ...doc, extraccion: res.extraccion });
}

function verExtraccion(e, doc) {
  const x = doc.extraccion || {};
  const dlg = h("dialog", { class: "modal modal-ancho" });
  const cerrar = () => dlg.close();
  const registrar = (ac) => {
    cerrar();
    const naturales = ac.tipo_dias === "naturales";
    formAcuerdo({
      expediente_id: e.id,
      fecha_publicacion: ac.fecha_publicacion || "",
      fecha_notificacion: ac.fecha_notificacion || "",
      descripcion: [ac.sintesis, ac.accion_requerida && `Acción: ${ac.accion_requerida}`].filter(Boolean).join(" — "),
      dias_termino: ac.dias_termino > 0 && !naturales ? ac.dias_termino : null,
      modo: ac.dias_termino > 0 ? (naturales ? "fecha" : "dias") : "ninguno",
      documento_id: doc.id,
      propuestoIA: true,
    }, e.id);
    if (naturales) aviso("El término es en días naturales: capture la fecha límite manualmente.", "error");
  };
  // Sugerir completar datos vacíos del expediente con lo leído.
  const sugeridos = Object.entries({ numero: x.expediente?.numero, juzgado: x.expediente?.juzgado, materia: x.expediente?.materia, tipo_juicio: x.expediente?.tipo_juicio })
    .filter(([k, v]) => v && !String(e[k] || "").trim());
  const etiquetas = { numero: "Número", juzgado: "Juzgado", materia: "Materia", tipo_juicio: "Tipo de juicio" };

  dlg.append(h("div", { class: "modal-cuerpo" },
    h("h2", {}, "Lo que la IA leyó en “", doc.nombre, "”"),
    h("div", { class: "aviso-ia" }, "Propuesta generada por IA. Compare siempre contra el documento original antes de registrar."),
    x.legible === false && h("p", { class: "error" }, "La IA indica que el documento no es legible o está incompleto."),
    h("p", {}, h("strong", {}, x.tipo_documento ? `${x.tipo_documento[0].toUpperCase()}${x.tipo_documento.slice(1)}: ` : ""), x.resumen),
    sugeridos.length > 0 && h("div", { class: "sugerencia" },
      h("div", {}, "Datos del expediente encontrados: ", sugeridos.map(([k, v]) => `${etiquetas[k]}: ${v}`).join(" · ")),
      h("button", { class: "btn btn-chico", onclick: async () => {
        if (await intentar(() => S.datos.guardarExpediente({ ...e, ...Object.fromEntries(sugeridos) }), "Expediente actualizado")) { cerrar(); refrescar(); }
      } }, "Completar expediente")),
    h("h3", {}, `Acuerdos encontrados (${x.acuerdos?.length || 0})`),
    x.acuerdos?.length ? h("div", { class: "lista-propuestas" }, x.acuerdos.map((ac) => h("div", { class: "propuesta" },
      h("div", { class: "propuesta-cab" },
        h("strong", {}, "Acuerdo del ", fmt(ac.fecha_acuerdo)),
        h("span", { class: `etiqueta etiqueta-${ac.confianza === "alta" ? "activo" : ac.confianza === "media" ? "ambar" : "rojo"}` }, `confianza ${ac.confianza}`)),
      h("p", {}, ac.sintesis),
      h("div", { class: "tenue chico" },
        `Publicado: ${fmt(ac.fecha_publicacion)} · Notificado: ${fmt(ac.fecha_notificacion)} · `,
        ac.dias_termino > 0 ? `Término: ${ac.dias_termino} días ${ac.tipo_dias === "naturales" ? "naturales" : "hábiles"}` : "Sin término",
        ac.a_cargo_de_nuestro_cliente ? " · A cargo de nuestro cliente" : ""),
      ac.accion_requerida && h("div", { class: "chico" }, "Acción requerida: ", h("strong", {}, ac.accion_requerida)),
      ac.texto_relevante && h("details", {}, h("summary", { class: "chico" }, "Texto del acuerdo"), h("blockquote", {}, ac.texto_relevante)),
      h("div", { class: "acciones" },
        h("button", { class: "btn btn-chico btn-primario", onclick: () => registrar(ac) }, "Registrar este acuerdo"),
        ac.accion_requerida && h("button", { class: "btn btn-chico btn-ia", onclick: () => { cerrar(); nuevoEscrito(e, { tipo: ac.accion_requerida, instrucciones: ac.sintesis }); } }, "✎ Redactar escrito"))))) : h("p", { class: "tenue" }, "No se encontraron acuerdos con término en este documento."),
    x.observaciones && h("p", { class: "tenue chico" }, "Observaciones: ", x.observaciones),
    h("div", { class: "acciones fin" }, h("button", { class: "btn", onclick: cerrar }, "Cerrar"))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------------------------------------------------------------- escritos
const ESTADO_ESCRITO = { borrador: ["Borrador", "ambar"], aprobado: ["Visto bueno", "activo"], presentado: ["Presentado", "neutro"], descartado: ["Descartado", "archivado"] };
const ESCRITOS_COMUNES = ["Contestación de demanda", "Desahogo de vista", "Desahogo de prevención", "Ofrecimiento de pruebas", "Objeción de documentos",
  "Alegatos", "Recurso de revocación", "Recurso de apelación", "Solicitud de copias certificadas", "Autorización de abogados y domicilio procesal",
  "Se acuse rebeldía / se tenga por precluido el derecho", "Solicitud de fecha de audiencia", "Cumplimiento de requerimiento", "Promoción de impulso procesal", "Solicitud de ejecución de sentencia"];

function seccionEscritos(e, d) {
  return h("section", {},
    h("div", { class: "panel-cab" },
      h("h2", {}, "Escritos"),
      h("button", { class: "btn btn-ia", disabled: !d, onclick: () => nuevoEscrito(e) }, "✎ Nuevo escrito con IA")),
    !d ? h("p", { class: "tenue" }, "Cargando…")
      : d.escritos.length ? h("div", { class: "tabla-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Escrito", "Estado", "Creado", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, d.escritos.map((x) => {
          const [txt, color] = ESTADO_ESCRITO[x.estado] || ESTADO_ESCRITO.borrador;
          return h("tr", { class: "clic", onclick: () => abrirEscrito(x.id) },
            h("td", {}, h("strong", {}, x.titulo), x.generado_ia && h("div", { class: "tenue chico" }, "Borrador elaborado por IA")),
            h("td", {}, h("span", { class: `etiqueta etiqueta-${color}` }, txt),
              x.presentado_at && h("div", { class: "tenue chico" }, `el ${fmt(x.presentado_at)}`)),
            h("td", { class: "chico" }, fmtHora(x.creado_at)),
            h("td", {}, h("button", { class: "btn btn-chico" }, "Abrir")));
        })))) : h("p", { class: "vacio" }, "Sin escritos. Pida a la IA que elabore el que corresponda."));
}

function nuevoEscrito(e, pre = {}) {
  const tipo = h("input", { required: true, list: "lista-escritos", value: pre.tipo || "", placeholder: "Ej. Desahogo de vista" });
  const sugeridos = (S.detalle?.analisis?.resultado?.acciones || []).map((x) => x.escrito_sugerido).filter(Boolean);
  const lista = h("datalist", { id: "lista-escritos" }, [...new Set([...sugeridos, ...ESCRITOS_COMUNES])].map((t) => h("option", { value: t })));
  const pendientes = S.acuerdos.filter((a) => a.expediente_id === e.id && a.estado === "pendiente");
  const acuerdo = h("select", {}, h("option", { value: "" }, "— Ninguno en particular —"),
    pendientes.map((a) => h("option", { value: a.id }, `${fmt(a.fecha_notificacion)} · ${a.descripcion.slice(0, 90)}`)));
  const instrucciones = h("textarea", { rows: 5, value: pre.instrucciones || "", placeholder: "Opcional: hechos, estrategia, pruebas a ofrecer, puntos a negar, nombre del promovente…" });
  const msg = h("p", { class: "error", role: "alert" });
  const dlg = h("dialog", { class: "modal" }, h("form", {
    onsubmit: async (ev) => {
      ev.preventDefault();
      if (!tipo.value.trim()) { msg.textContent = "Indique qué escrito se debe elaborar."; return; }
      dlg.close();
      let res;
      const ok = await intentar(async () => {
        res = await conCargando(`La IA está redactando “${tipo.value.trim()}”…`, () => S.datos.ia("redactar", {
          expediente_id: e.id, tipo_escrito: tipo.value.trim(), instrucciones: instrucciones.value.trim(), acuerdo_id: acuerdo.value || null,
        }));
      }, "Borrador listo para su revisión");
      if (ok) abrirEscrito(res.escrito.id);
    },
  },
  h("h2", {}, "Nuevo escrito con IA"),
  h("p", { class: "tenue chico" }, "La IA usará los datos del expediente, los acuerdos y los documentos escaneados. El resultado es un BORRADOR: debe revisarlo y darle visto bueno antes de imprimirlo."),
  h("label", {}, "¿Qué escrito se necesita?", tipo), lista,
  h("label", {}, "Acuerdo con el que se relaciona", acuerdo),
  h("label", {}, "Instrucciones para la IA", instrucciones), msg,
  h("div", { class: "acciones" },
    h("button", { type: "button", class: "btn", onclick: () => dlg.close() }, "Cancelar"),
    h("button", { class: "btn btn-ia" }, "✎ Redactar"))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

async function abrirEscrito(id) {
  try {
    S.escritoSel = await S.datos.escrito(id);
    S.vista = "escrito";
    render();
    scrollTo(0, 0);
  } catch (e) {
    aviso(e.message, "error");
  }
}

const pendientesDeTexto = (t) => ({
  completar: (t.match(/\[COMPLETAR[^\]]*\]/g) || []).length,
  verificar: (t.match(/\[VERIFICAR[^\]]*\]/g) || []).length,
});

function vistaEscrito() {
  const x = S.escritoSel;
  const e = expediente(x?.expediente_id);
  if (!x || !e) { S.vista = "expedientes"; return vistaExpedientes(); }
  const editable = x.estado === "borrador";
  const [txt, color] = ESTADO_ESCRITO[x.estado] || ESTADO_ESCRITO.borrador;
  const titulo = h("input", { class: "titulo-escrito", value: x.titulo, disabled: !editable });
  const area = h("textarea", { class: "editor-escrito", value: x.contenido, readonly: !editable, spellcheck: true });
  const marcas = h("div", { class: "chico" });
  const contar = () => {
    const p = pendientesDeTexto(area.value);
    marcas.replaceChildren(
      p.completar ? h("span", { class: "etiqueta etiqueta-rojo" }, `${p.completar} dato(s) por completar [COMPLETAR]`) : h("span", { class: "etiqueta etiqueta-activo" }, "Sin datos por completar"),
      " ", p.verificar ? h("span", { class: "etiqueta etiqueta-ambar" }, `${p.verificar} cita(s) por verificar [VERIFICAR]`) : "");
  };
  area.addEventListener("input", contar);
  contar();

  const guardar = async (cambios, ok) => {
    if (await intentar(async () => { S.escritoSel = await S.datos.guardarEscrito({ id: x.id, ...cambios }); }, ok)) {
      render();
      cargarDetalle(x.expediente_id);
    }
  };
  const darVistoBueno = async () => {
    const p = pendientesDeTexto(area.value);
    if (p.completar) { aviso("Aún hay datos [COMPLETAR] en el texto. Complételos antes de dar el visto bueno.", "error"); return; }
    if (p.verificar && !confirm(`Hay ${p.verificar} cita(s) marcadas [VERIFICAR]. ¿Confirma que ya las revisó? (Puede borrar la marca en el texto.)`)) return;
    if (!confirm("Al dar el visto bueno usted confirma que revisó el escrito completo. El texto quedará bloqueado. ¿Continuar?")) return;
    await guardar({ titulo: titulo.value.trim() || x.titulo, contenido: area.value, estado: "aprobado" }, "Visto bueno registrado");
  };
  const marcarPresentado = () => {
    const fecha = h("input", { type: "date", required: true, value: hoyISO() });
    modal("Marcar escrito como presentado", [h("label", {}, "Fecha de presentación", fecha)], async () => {
      S.escritoSel = await S.datos.guardarEscrito({ id: x.id, estado: "presentado", presentado_at: fecha.value });
      cargarDetalle(x.expediente_id);
    }, "Escrito marcado como presentado");
  };
  const notas = x.notas_ia || {};

  return [
    h("button", { class: "btn-link", onclick: () => abrirExpediente(e.id) }, `← Expediente ${e.numero}`),
    h("div", { class: "encabezado" },
      h("div", { class: "titulo-wrap" }, titulo, h("span", { class: `etiqueta etiqueta-${color}` }, txt)),
      h("div", { class: "acciones" },
        editable && [
          h("button", { class: "btn", onclick: () => guardar({ titulo: titulo.value.trim() || x.titulo, contenido: area.value }, "Cambios guardados") }, "Guardar"),
          h("button", { class: "btn btn-primario", onclick: darVistoBueno }, "✔ Dar visto bueno"),
          h("button", { class: "btn", onclick: () => confirm("¿Descartar este escrito?") && guardar({ estado: "descartado" }, "Escrito descartado") }, "Descartar"),
        ],
        !editable && x.estado !== "descartado" && [
          h("button", { class: "btn btn-primario", onclick: () => imprimirEscrito(x) }, "🖨 Imprimir"),
          h("button", { class: "btn", onclick: () => descargarWord(x) }, "Descargar Word"),
          x.estado === "aprobado" && h("button", { class: "btn btn-ok", onclick: marcarPresentado }, "Marcar presentado"),
        ],
        !editable && h("button", { class: "btn", onclick: () => confirm("¿Regresar a borrador? Se quitará el visto bueno.") && guardar({ estado: "borrador" }, "Regresado a borrador") }, "Regresar a borrador"))),
    x.estado === "aprobado" && h("p", { class: "nota" }, `✔ Visto bueno de ${nombreAbogado(x.aprobado_por)} el ${fmtHora(x.aprobado_at)}. Listo para imprimir, firmar y presentar.`),
    editable && x.generado_ia && h("div", { class: "aviso-ia" }, "Borrador elaborado por IA. Revise hechos, fundamentos y datos; complete los campos [COMPLETAR] y verifique las citas [VERIFICAR] antes de dar el visto bueno."),
    marcas,
    h("div", { class: "escrito-layout" },
      area,
      (notas.datos_por_completar?.length || notas.fundamentos?.length || notas.notas) && h("aside", { class: "notas-ia" },
        h("h3", {}, "Notas de la IA"),
        notas.notas && h("p", {}, notas.notas),
        notas.datos_por_completar?.length > 0 && [h("h4", {}, "Datos por completar"), h("ul", {}, notas.datos_por_completar.map((t) => h("li", {}, t)))],
        notas.fundamentos?.length > 0 && [h("h4", {}, "Fundamentos usados"), h("ul", {}, notas.fundamentos.map((t) => h("li", {}, t)))])),
  ];
}

function parrafos(texto) {
  return texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function imprimirEscrito(x) {
  const hoja = h("div", { id: "impresion" }, parrafos(x.contenido).map((p) => h("p", {}, ...p.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l])))));
  document.getElementById("impresion")?.remove();
  document.body.append(hoja);
  window.addEventListener("afterprint", () => hoja.remove(), { once: true });
  window.print();
}

function descargarWord(x) {
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cuerpo = parrafos(x.contenido).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(x.titulo)}</title>
<style>@page{size:21.59cm 27.94cm;margin:2.5cm 2.5cm 2.5cm 3cm}body{font-family:Arial,sans-serif;font-size:12pt;line-height:1.5}p{text-align:justify;margin:0 0 12pt}</style></head><body>${cuerpo}</body></html>`;
  const url = URL.createObjectURL(new Blob(["﻿" + html], { type: "application/msword" }));
  const nombre = x.titulo.normalize("NFD").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "escrito";
  h("a", { href: url, download: `${nombre}.doc` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formExpediente(e = {}) {
  const campo = (valor, attrs = {}) => h("input", { value: valor || "", ...attrs });
  const numero = campo(e.numero, { required: true, placeholder: "845/2026" });
  const juzgado = campo(e.juzgado, { required: true, placeholder: "Juzgado 3º Civil" });
  const materia = campo(e.materia, { placeholder: "Civil, Mercantil, Laboral, Amparo…" });
  const cliente = campo(e.cliente, { required: true });
  const contraparte = campo(e.contraparte);
  const resp = h("select", {}, h("option", { value: "" }, "Sin asignar"),
    S.abogados.filter((x) => x.activo).map((x) => h("option", { value: x.id }, x.nombre || x.email)));
  resp.value = e.responsable_id || S.perfil.id;
  const estado = h("select", {}, h("option", { value: "activo" }, "Activo"), h("option", { value: "archivado" }, "Archivado"));
  estado.value = e.estado || "activo";
  const notas = h("textarea", { rows: 3, value: e.notas || "" });
  const representa = h("select", {}, ["", "Actor", "Demandado", "Quejoso", "Tercero interesado", "Víctima / ofendido", "Imputado", "Trabajador", "Patrón", "Otro"]
    .map((x) => h("option", { value: x }, x || "— Seleccione —")));
  representa.value = e.representa || "";
  const tipoJuicio = campo(e.tipo_juicio, { placeholder: "Ordinario civil, Ejecutivo mercantil, Amparo indirecto…" });
  modal(e.id ? "Editar expediente" : "Nuevo expediente", [
    h("div", { class: "fila" }, h("label", {}, "Número de expediente", numero), h("label", {}, "Juzgado / Tribunal", juzgado)),
    h("div", { class: "fila" }, h("label", {}, "Cliente", cliente), h("label", {}, "Contraparte", contraparte)),
    h("div", { class: "fila" }, h("label", {}, "Materia", materia), h("label", {}, "Tipo de juicio / vía", tipoJuicio)),
    h("div", { class: "fila" }, h("label", {}, "Parte que representamos", representa), h("label", {}, "Responsable", resp)),
    e.id && h("label", {}, "Estado", estado),
    h("label", {}, "Notas", notas),
  ], async () => {
    if (!numero.value.trim() || !juzgado.value.trim() || !cliente.value.trim()) throw new Error("Número, juzgado y cliente son obligatorios.");
    await S.datos.guardarExpediente({
      ...(e.id ? { id: e.id } : {}),
      numero: numero.value.trim(), juzgado: juzgado.value.trim(), materia: materia.value.trim(),
      cliente: cliente.value.trim(), contraparte: contraparte.value.trim(),
      responsable_id: resp.value || null, estado: estado.value, notas: notas.value.trim(),
      representa: representa.value, tipo_juicio: tipoJuicio.value.trim(),
    });
  }, e.id ? "Expediente actualizado" : "Expediente creado");
}

// ---------------------------------------------------------- días inhábiles
function vistaInhabiles() {
  const esAdmin = S.perfil.rol === "admin";
  const fecha = h("input", { type: "date", required: true });
  const motivo = h("input", { placeholder: "Motivo (ej. vacaciones judiciales)", required: true });
  return [
    h("div", { class: "encabezado" }, h("h1", {}, "Días inhábiles")),
    h("p", { class: "tenue" }, "Sábados y domingos ya se excluyen automáticamente. Registre aquí los días festivos, vacaciones judiciales y suspensiones de labores del tribunal; se usan para calcular los vencimientos."),
    esAdmin && h("form", {
      class: "filtros",
      onsubmit: async (ev) => {
        ev.preventDefault();
        if (await intentar(() => S.datos.agregarInhabil(fecha.value, motivo.value.trim()), "Día inhábil agregado")) refrescar();
      },
    }, fecha, motivo, h("button", { class: "btn btn-primario" }, "Agregar")),
    h("div", { class: "tabla-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Fecha"), h("th", {}, "Motivo"), esAdmin && h("th", {}, ""))),
      h("tbody", {}, S.inhabiles.map((d) => h("tr", {},
        h("td", {}, fmt(d.fecha)), h("td", {}, d.motivo),
        esAdmin && h("td", {}, h("button", {
          class: "btn btn-chico",
          onclick: async () => {
            if (confirm(`¿Quitar ${fmt(d.fecha)}? Los acuerdos ya registrados no se recalculan.`)
              && await intentar(() => S.datos.quitarInhabil(d.fecha), "Día quitado")) refrescar();
          },
        }, "Quitar"))))))),
  ];
}

// ------------------------------------------------------------------- equipo
function vistaEquipo() {
  return [
    h("div", { class: "encabezado" }, h("h1", {}, "Equipo")),
    h("div", { class: "aviso-info" },
      h("strong", {}, "Para dar acceso a un abogado: "),
      "en Supabase → Authentication → Users → “Invite user”, escriba su correo. Recibirá un enlace para crear su contraseña y activar la verificación en dos pasos. Después actívelo aquí. ",
      "Para quitar el acceso, desactívelo: deja de ver la información de inmediato."),
    h("div", { class: "tabla-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Correo", "Nombre", "Rol", "Acceso"].map((t) => h("th", {}, t)))),
      h("tbody", {}, S.abogados.map((a) => {
        const yo = a.id === S.perfil.id;
        const nombre = h("input", { value: a.nombre, placeholder: "Lic. Nombre Apellido" });
        nombre.addEventListener("change", () => intentar(() => S.datos.actualizarAbogado(a.id, { nombre: nombre.value.trim() }), "Nombre guardado").then(refrescar));
        const rol = h("select", { disabled: yo }, h("option", { value: "abogado" }, "Abogado"), h("option", { value: "admin" }, "Administrador"));
        rol.value = a.rol;
        rol.addEventListener("change", () => intentar(() => S.datos.actualizarAbogado(a.id, { rol: rol.value }), "Rol actualizado").then(refrescar));
        return h("tr", {},
          h("td", {}, a.email, yo && h("span", { class: "tenue" }, " (usted)")),
          h("td", {}, nombre), h("td", {}, rol),
          h("td", {}, yo ? h("span", { class: "etiqueta etiqueta-activo" }, "activo") : h("button", {
            class: `btn btn-chico ${a.activo ? "" : "btn-ok"}`,
            onclick: () => {
              if (a.activo && !confirm(`¿Quitar el acceso a ${a.email}?`)) return;
              intentar(() => S.datos.actualizarAbogado(a.id, { activo: !a.activo }), a.activo ? "Acceso retirado" : "Acceso concedido").then(refrescar);
            },
          }, a.activo ? "Desactivar" : "Activar")));
      })))),
  ];
}

// ----------------------------------------------------------------- bitácora
function vistaBitacora() {
  const cont = h("div", {}, h("p", { class: "tenue" }, "Cargando…"));
  const acciones = { INSERT: "Alta", UPDATE: "Cambio", DELETE: "Baja" };
  const tablas = { acuerdos: "Acuerdo", expedientes: "Expediente", abogados: "Abogado", dias_inhabiles: "Día inhábil" };
  const resumen = (r) => {
    if (r.accion !== "UPDATE" || !r.antes || !r.despues) {
      const x = r.despues || r.antes || {};
      return x.descripcion || x.numero || x.email || x.motivo || "";
    }
    return Object.keys(r.despues)
      .filter((k) => !["actualizado_at"].includes(k) && JSON.stringify(r.antes[k]) !== JSON.stringify(r.despues[k]))
      .map((k) => `${k}: ${r.antes[k] ?? "∅"} → ${r.despues[k] ?? "∅"}`).join(" · ");
  };
  S.datos.bitacora().then((filas) => {
    cont.replaceChildren(filas.length ? h("div", { class: "tabla-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Fecha", "Usuario", "Qué", "Detalle"].map((t) => h("th", {}, t)))),
      h("tbody", {}, filas.map((r) => h("tr", {},
        h("td", { class: "nowrap" }, fmtHora(r.at)), h("td", {}, r.usuario_email || "sistema"),
        h("td", { class: "nowrap" }, `${acciones[r.accion] || r.accion} · ${tablas[r.tabla] || r.tabla}`),
        h("td", { class: "chico" }, resumen(r))))))) : h("p", { class: "vacio" }, "Sin movimientos."));
  }).catch((e) => cont.replaceChildren(h("p", { class: "error" }, e.message)));
  return [
    h("div", { class: "encabezado" }, h("h1", {}, "Bitácora de movimientos")),
    h("p", { class: "tenue" }, "Registro inalterable de cada alta, cambio o baja: quién, cuándo y qué cambió. Últimos 300 movimientos."),
    cont,
  ];
}

// -------------------------------------------------------------------- modal
function modal(titulo, campos, alGuardar, ok) {
  const msg = h("p", { class: "error", role: "alert" });
  const dlg = h("dialog", { class: "modal" },
    h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        msg.textContent = "";
        try {
          await alGuardar();
          dlg.close();
          aviso(ok);
          refrescar();
        } catch (err) {
          msg.textContent = err.message;
        }
      },
    },
    h("h2", {}, titulo), ...campos.filter(Boolean), msg,
    h("div", { class: "acciones" },
      h("button", { type: "button", class: "btn", onclick: () => dlg.close() }, "Cancelar"),
      h("button", { class: "btn btn-primario" }, "Guardar"))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

iniciar().catch((e) => pantallaCentrada(h("h1", {}, "Error"), h("p", { class: "error" }, e.message)));
