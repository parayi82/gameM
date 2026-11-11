// Recordatorio diario por correo de términos del despacho.
// Corre de lunes a viernes a las 7:00 (hora de CDMX = 13:00 UTC).
// A cada abogado le llegan SUS acuerdos pendientes vencidos o que vencen en
// los próximos días; los acuerdos sin responsable se envían a los admins.
//
// Variables de entorno (Netlify, nunca en el navegador):
//   DESPACHO_SUPABASE_URL, DESPACHO_SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY, DESPACHO_EMAIL_REMITENTE (ej. "Agenda <agenda@sudespacho.mx>"),
//   DESPACHO_URL (enlace a la app), DESPACHO_DIAS_AVISO (opcional, default 5)
import { createClient } from "@supabase/supabase-js";

export const config = { schedule: "0 13 * * 1-5" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

function hoyCDMX() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

export default async () => {
  const env = process.env;
  const faltan = ["DESPACHO_SUPABASE_URL", "DESPACHO_SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "DESPACHO_EMAIL_REMITENTE"].filter((k) => !env[k]);
  if (faltan.length) {
    console.log("Recordatorios desactivados; faltan variables:", faltan.join(", "));
    return new Response("sin configurar", { status: 200 });
  }
  const sb = createClient(env.DESPACHO_SUPABASE_URL, env.DESPACHO_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const hoy = hoyCDMX();
  const limite = new Date(`${hoy}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + Number(env.DESPACHO_DIAS_AVISO || 5));
  const hasta = limite.toISOString().slice(0, 10);

  const [{ data: acuerdos, error: e1 }, { data: abogados, error: e2 }, { data: expedientes, error: e3 }] = await Promise.all([
    sb.from("acuerdos").select("id, expediente_id, descripcion, fecha_vencimiento, responsable_id")
      .eq("estado", "pendiente").not("fecha_vencimiento", "is", null).lte("fecha_vencimiento", hasta)
      .order("fecha_vencimiento"),
    sb.from("abogados").select("id, email, nombre, rol, activo").eq("activo", true),
    sb.from("expedientes").select("id, numero, juzgado, cliente"),
  ]);
  if (e1 || e2 || e3) throw new Error((e1 || e2 || e3).message);

  const exp = Object.fromEntries(expedientes.map((e) => [e.id, e]));
  const admins = abogados.filter((a) => a.rol === "admin");
  const porAbogado = new Map();
  for (const ac of acuerdos) {
    const dueño = abogados.find((a) => a.id === ac.responsable_id);
    const destinos = dueño ? [dueño] : admins;
    for (const d of destinos) {
      if (!porAbogado.has(d.id)) porAbogado.set(d.id, { abogado: d, lista: [] });
      porAbogado.get(d.id).lista.push(ac);
    }
  }

  let enviados = 0;
  for (const { abogado, lista } of porAbogado.values()) {
    const vencidos = lista.filter((a) => a.fecha_vencimiento < hoy).length;
    const deHoy = lista.filter((a) => a.fecha_vencimiento === hoy).length;
    const filas = lista.map((a) => {
      const e = exp[a.expediente_id] || {};
      const color = a.fecha_vencimiento <= hoy ? "#b42318" : "#1d232b";
      const etiqueta = a.fecha_vencimiento < hoy ? " (VENCIDO)" : a.fecha_vencimiento === hoy ? " (HOY)" : "";
      return `<tr><td style="padding:6px 10px;color:${color};white-space:nowrap"><b>${fmt(a.fecha_vencimiento)}${etiqueta}</b></td>
        <td style="padding:6px 10px">${esc(e.numero)}<br><small>${esc(e.juzgado)} · ${esc(e.cliente)}</small></td>
        <td style="padding:6px 10px">${esc(a.descripcion)}</td></tr>`;
    }).join("");
    const asunto = vencidos || deHoy
      ? `⚠ ${vencidos ? `${vencidos} vencido(s)` : ""}${vencidos && deHoy ? " y " : ""}${deHoy ? `${deHoy} vence(n) HOY` : ""} — agenda de términos`
      : `Agenda de términos: ${lista.length} próximo(s) vencimiento(s)`;
    const html = `<div style="font-family:system-ui,sans-serif;color:#1d232b">
      <p>Buen día ${esc(abogado.nombre || "")}, estos son sus términos pendientes al ${fmt(hoy)}:</p>
      <table style="border-collapse:collapse;border:1px solid #ddd">${filas}</table>
      ${env.DESPACHO_URL ? `<p><a href="${esc(env.DESPACHO_URL)}">Abrir la agenda</a></p>` : ""}
      <p style="color:#888;font-size:12px">Correo automático. Marque cada acuerdo como atendido en la app para dejar de recibirlo.</p></div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.DESPACHO_EMAIL_REMITENTE, to: [abogado.email], subject: asunto, html }),
    });
    if (r.ok) enviados++;
    else console.error("Fallo envío a", abogado.email, r.status, await r.text());
  }
  console.log(`Recordatorios: ${acuerdos.length} acuerdos, ${enviados} correos enviados`);
  return new Response(`ok ${enviados}`, { status: 200 });
};
