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
    equipo: vistaEquipo, bitacora: vistaBitacora, expediente: vistaDetalleExpediente,
  }[S.vista]();

  raiz.replaceChildren(
    S.datos.demo && h("div", { class: "banda-demo" },
      "MODO DEMOSTRACIÓN — los datos se guardan solo en este navegador. No capture información real de clientes. ",
      h("button", { class: "btn-link", onclick: () => { S.datos.reiniciar(); refrescar(); } }, "Reiniciar demo")),
    h("header", { class: "barra" },
      h("div", { class: "marca" }, h("span", { class: "sello" }, "§"), CFG.NOMBRE_DESPACHO || "Despacho"),
      h("nav", {}, pestañas.map(([id, txt]) =>
        h("button", {
          class: `tab ${S.vista === id || (id === "expedientes" && S.vista === "expediente") ? "activa" : ""}`,
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
          h("button", { class: "btn-link", onclick: () => { S.expedienteSel = e.id; S.vista = "expediente"; render(); } }, e.numero || "—"),
          h("div", { class: "tenue chico" }, e.cliente), h("div", { class: "tenue chico" }, e.juzgado)),
        h("td", {}, a.descripcion,
          h("div", { class: "tenue chico" }, `Notificado ${fmt(a.fecha_notificacion)}`, a.dias_termino ? ` · término ${a.dias_termino} días hábiles` : ""),
          a.nota_atencion && h("div", { class: "nota" }, "✔ ", a.nota_atencion)),
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
  modo.value = a.id ? (a.dias_termino ? "dias" : a.fecha_vencimiento ? "fecha" : "ninguno") : "dias";
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
    });
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
        return h("tr", { class: "clic", onclick: () => { S.expedienteSel = e.id; S.vista = "expediente"; render(); } },
          h("td", {}, h("strong", {}, e.numero)), h("td", {}, e.juzgado), h("td", {}, e.cliente), h("td", {}, e.materia),
          h("td", {}, nombreAbogado(e.responsable_id)),
          h("td", {}, p.length ? [h("span", { class: `punto punto-${peor}` }), p.length] : "—"),
          h("td", {}, h("span", { class: `etiqueta etiqueta-${e.estado}` }, e.estado)));
      })))) : h("p", { class: "vacio" }, "Aún no hay expedientes."),
  ];
}

function vistaDetalleExpediente() {
  const e = expediente(S.expedienteSel);
  if (!e) { S.vista = "expedientes"; return vistaExpedientes(); }
  const acs = S.acuerdos.filter((a) => a.expediente_id === e.id)
    .sort((x, y) => (x.estado === y.estado ? 0 : x.estado === "pendiente" ? -1 : 1) || (y.fecha_notificacion || "").localeCompare(x.fecha_notificacion || ""));
  return [
    h("button", { class: "btn-link", onclick: () => { S.vista = "expedientes"; render(); } }, "← Expedientes"),
    h("div", { class: "encabezado" },
      h("h1", {}, `Expediente ${e.numero}`),
      h("div", { class: "acciones" },
        h("button", { class: "btn", onclick: () => formExpediente(e) }, "Editar"),
        h("button", { class: "btn btn-primario", onclick: () => formAcuerdo({}, e.id) }, "+ Registrar acuerdo"))),
    h("dl", { class: "ficha" },
      ...[["Juzgado", e.juzgado], ["Materia", e.materia], ["Cliente", e.cliente], ["Contraparte", e.contraparte],
        ["Responsable", nombreAbogado(e.responsable_id)], ["Estado", e.estado], ["Notas", e.notas]]
        .flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v || "—")])),
    h("h2", {}, "Acuerdos"),
    acs.length ? tablaAcuerdos(acs, false) : h("p", { class: "vacio" }, "Sin acuerdos registrados."),
  ];
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
  modal(e.id ? "Editar expediente" : "Nuevo expediente", [
    h("div", { class: "fila" }, h("label", {}, "Número de expediente", numero), h("label", {}, "Juzgado / Tribunal", juzgado)),
    h("div", { class: "fila" }, h("label", {}, "Cliente", cliente), h("label", {}, "Contraparte", contraparte)),
    h("div", { class: "fila" }, h("label", {}, "Materia", materia), h("label", {}, "Responsable", resp)),
    e.id && h("label", {}, "Estado", estado),
    h("label", {}, "Notas", notas),
  ], async () => {
    if (!numero.value.trim() || !juzgado.value.trim() || !cliente.value.trim()) throw new Error("Número, juzgado y cliente son obligatorios.");
    await S.datos.guardarExpediente({
      ...(e.id ? { id: e.id } : {}),
      numero: numero.value.trim(), juzgado: juzgado.value.trim(), materia: materia.value.trim(),
      cliente: cliente.value.trim(), contraparte: contraparte.value.trim(),
      responsable_id: resp.value || null, estado: estado.value, notas: notas.value.trim(),
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
