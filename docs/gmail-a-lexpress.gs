/**
 * Lexpress — Envío automático de correos de notificación a la Bandeja.
 *
 * Se instala en https://script.google.com con la cuenta de Gmail donde llegan
 * las notificaciones (TJA, Portal de Servicios en Línea del PJF, juzgados).
 * Cada 15 minutos manda a Lexpress los correos que tengan la etiqueta
 * "Lexpress/Por enviar" y los pasa a "Lexpress/Enviado".
 *
 * Instalación paso a paso: docs/boletin-y-correos.md
 */

// Dirección de la función "buzon" de su proyecto de Supabase.
const LEXPRESS_URL = 'https://ybixdzawjblaofvxuzav.supabase.co/functions/v1/buzon';
const ETIQUETA_PENDIENTE = 'Lexpress/Por enviar';
const ETIQUETA_ENVIADO = 'Lexpress/Enviado';
const TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_ADJUNTO = 15 * 1024 * 1024;

function enviarALexpress() {
  const token = PropertiesService.getScriptProperties().getProperty('BUZON_TOKEN');
  if (!token) throw new Error('Falta BUZON_TOKEN en Configuración del proyecto → Propiedades de la secuencia de comandos');

  const pendiente = GmailApp.getUserLabelByName(ETIQUETA_PENDIENTE);
  if (!pendiente) return;
  const enviado = GmailApp.getUserLabelByName(ETIQUETA_ENVIADO) || GmailApp.createLabel(ETIQUETA_ENVIADO);

  for (const hilo of pendiente.getThreads(0, 10)) {
    const mensajes = hilo.getMessages().map(function (m) {
      return {
        id: m.getId(),
        de: m.getFrom(),
        asunto: m.getSubject(),
        fecha: m.getDate().toISOString(),
        texto: m.getPlainBody().slice(0, 20000),
        adjuntos: m.getAttachments({ includeInlineImages: false })
          .filter(function (a) { return TIPOS.indexOf(a.getContentType()) >= 0 && a.getSize() <= MAX_ADJUNTO; })
          .map(function (a) { return { nombre: a.getName(), mime: a.getContentType(), base64: Utilities.base64Encode(a.getBytes()) }; }),
      };
    });
    const respuesta = UrlFetchApp.fetch(LEXPRESS_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-lexpress-token': token },
      payload: JSON.stringify({ mensajes: mensajes }),
      muteHttpExceptions: true,
    });
    if (respuesta.getResponseCode() === 200) {
      hilo.removeLabel(pendiente);
      hilo.addLabel(enviado);
      console.log('Enviado: ' + hilo.getFirstMessageSubject() + ' → ' + respuesta.getContentText());
    } else {
      console.error('Error ' + respuesta.getResponseCode() + ': ' + respuesta.getContentText());
    }
  }
}

/**
 * Paso 1: ejecutar UNA vez. Crea una clave secreta aleatoria, la guarda en este
 * script y la muestra en el registro de ejecución para copiarla a Supabase
 * (Edge Functions → Secrets → BUZON_TOKEN). No la comparta con nadie.
 */
function generarClave() {
  const clave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('BUZON_TOKEN', clave);
  console.log('Copie esta clave a Supabase como BUZON_TOKEN: ' + clave);
}

/** Paso 2: ejecutar UNA vez para que corra solo cada 15 minutos. */
function instalarActivador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarALexpress') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarALexpress').timeBased().everyMinutes(15).create();
  GmailApp.getUserLabelByName(ETIQUETA_PENDIENTE) || GmailApp.createLabel(ETIQUETA_PENDIENTE);
  GmailApp.getUserLabelByName(ETIQUETA_ENVIADO) || GmailApp.createLabel(ETIQUETA_ENVIADO);
}
