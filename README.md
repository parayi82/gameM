# Despacho — control de expedientes y acuerdos

App web sencilla para que **no se pase ningún término** y todo quede en orden.
Acceso **solo para abogados del despacho**, con verificación en dos pasos
obligatoria.

## Qué hace

- **Agenda de términos**: todos los acuerdos pendientes ordenados por fecha
  de vencimiento, con semáforo: 🔴 vencido / vence hoy o mañana,
  🟠 ≤ 3 días hábiles, 🟢 con holgura. Filtro "Mis asuntos" / "Todo el despacho".
- **Cálculo automático del vencimiento** en días hábiles: excluye sábados,
  domingos y los días inhábiles registrados; opción de que la notificación
  surta efectos al día hábil siguiente (regla general). Muestra el cálculo
  antes de guardar para que el abogado lo confirme.
- **Expedientes**: número, juzgado, cliente, contraparte, materia,
  responsable; cada uno con su historial de acuerdos.
- **Marcar atendido** exige escribir qué se hizo (ej. "escrito presentado,
  folio 4587"); queda con fecha, hora y quién lo marcó.
- **Recordatorio diario por correo** (lun–vie 7:00 CDMX) a cada abogado con
  sus términos vencidos o próximos a vencer.
- **Bitácora inalterable**: cada alta, cambio o baja queda registrada (quién,
  cuándo, qué cambió). Nadie, ni el administrador, puede borrarla.
- **Exportar a CSV** (respaldo / Excel).

## Seguridad

| Medida | Cómo |
|---|---|
| Solo abogados autorizados | No hay registro público: se invita desde Supabase y un admin activa la cuenta. |
| Doble factor obligatorio | Sin código de app autenticadora (TOTP) la base de datos no entrega **nada** (regla `aal2` en RLS). |
| Protección en la base de datos | Row Level Security de Postgres: aunque alguien tenga la URL y la llave pública, no puede leer ni escribir. Prueba en `tests/rls.sql`. |
| Retiro de acceso inmediato | Al desactivar a un abogado deja de ver la información en su siguiente consulta. |
| Sesión corta | Cierre automático tras 20 min sin actividad; la sesión muere al cerrar el navegador. |
| Sin borrados accidentales | Solo un admin puede borrar; un admin no puede quitarse su propio rol. |
| Navegador blindado | CSP estricta, sin scripts externos (supabase-js va incluido), sin iframes, sin caché, `noindex`. |
| Cifrado | HTTPS (Netlify) y cifrado en reposo (Supabase). |

## Instalación (una sola vez, ~20 minutos)

### 1. Base de datos (Supabase)
1. Crear un proyecto **nuevo y exclusivo** en <https://supabase.com>
   (región más cercana, ej. `us-east`).
2. *SQL Editor* → pegar y ejecutar todo `supabase/schema.sql`.
3. *Authentication → Sign In / Providers → Email*: **desactivar
   "Allow new users to sign up"**. Activar "Confirm email".
4. *Authentication → Multi-Factor*: verificar que **TOTP** esté habilitado.
5. *Authentication → URL Configuration*: Site URL =
   `https://<su-sitio>.netlify.app/`, y agregarla también en
   Redirect URLs.
6. *Authentication → Users → Add user → Create new user*: crear la cuenta
   del **socio administrador** (el primer usuario queda como admin activo).
7. *Project Settings → API*: copiar `Project URL` y la llave `anon public`
   a `config.js`. (La llave anon es pública por diseño; la
   `service_role` **jamás** va en el navegador.)

### 2. Publicar (Netlify)
El repo ya está configurado (`netlify.toml`). La app queda en la raíz del sitio:
`https://<su-sitio>.netlify.app/`.

### 3. Recordatorios por correo (opcional, recomendado)
1. Crear cuenta en <https://resend.com>, verificar el dominio del despacho.
2. En Netlify → *Site configuration → Environment variables*:

   | Variable | Valor |
   |---|---|
   | `DESPACHO_SUPABASE_URL` | Project URL |
   | `DESPACHO_SUPABASE_SERVICE_ROLE_KEY` | llave `service_role` (secreta) |
   | `RESEND_API_KEY` | API key de Resend |
   | `DESPACHO_EMAIL_REMITENTE` | `Agenda <agenda@sudespacho.mx>` |
   | `DESPACHO_URL` | `https://<su-sitio>.netlify.app/` |
   | `DESPACHO_DIAS_AVISO` | días naturales de anticipación (default 5) |

### 4. Dar de alta abogados
1. Supabase → *Authentication → Users → Invite user* → correo del abogado.
2. El abogado abre el enlace, define su contraseña (mín. 12 caracteres) y
   activa la verificación en dos pasos con su celular.
3. El admin entra a **Equipo** y pulsa **Activar**.

## Uso diario
1. Al revisar el boletín / lista de acuerdos: **+ Registrar acuerdo**,
   elegir expediente, fecha de notificación, síntesis y días de término.
2. Revisar la **Agenda** cada mañana (y el correo de recordatorio).
3. Al presentar la promoción: **Marcar atendido** con la nota de lo hecho.
4. Mantener actualizados los **Días inhábiles** (vacaciones judiciales,
   suspensiones). Vienen precargados los festivos de 2026–2027.

> El cálculo de términos es una ayuda: siempre verifique contra la ley
> procesal y el calendario oficial del tribunal correspondiente.

## Probar sin instalar nada
Con `SUPABASE_URL` vacío en `config.js` la app arranca en **modo
demostración** (datos de ejemplo guardados solo en el navegador):

```bash
npm run dev   # y abrir http://localhost:8080/
```

## Pruebas
```bash
npm test
```

## Archivos
```
index.html, app.js, style.css   interfaz
plazos.js                        cálculo de días hábiles (probado)
data.js                          acceso a datos (Supabase / demo)
config.js                        configuración pública
vendor/                          supabase-js 2.45.4 (sin CDN)
supabase/schema.sql              tablas, RLS, triggers, bitácora
netlify/functions/despacho-recordatorios.mjs   correo diario
```
