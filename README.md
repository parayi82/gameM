# Lexpress — control de expedientes, acuerdos y escritos

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

## Asistente con IA (documentos, etapa del juicio y escritos)

Dentro de cada expediente:

1. **Documentos escaneados** — suba PDF o fotos (acuerdos, demanda,
   contestación…). Se guardan cifrados en un almacenamiento **privado**.
2. **Lectura automática** — al subirlos, la IA (agente *lector*) lee el
   documento y **propone** los acuerdos con sus fechas, término y acción
   requerida. El abogado compara contra el original y pulsa *Registrar este
   acuerdo*: el vencimiento lo calcula la app con los días inhábiles.
3. **Análisis del juicio** — el agente *analista procesal* revisa acuerdos y
   documentos y determina tipo de juicio, etapa actual, mapa de etapas,
   siguiente paso, acciones priorizadas, riesgos y qué escrito corresponde.
4. **Escritos** — el agente *redactor* elabora el borrador completo (rubro,
   proemio, cuerpo, fundamentos, petitorios). Marca con `[COMPLETAR]` lo que
   falta y con `[VERIFICAR]` las citas dudosas.
5. **Visto bueno** — el abogado revisa y edita. No se puede dar visto bueno
   mientras quede algún `[COMPLETAR]`. Con visto bueno el texto queda
   bloqueado (para corregirlo hay que regresarlo a borrador, y queda en
   bitácora). Después: **Imprimir**, **Descargar Word**, firmar, presentar y
   **Marcar presentado**.

La IA **nunca** registra acuerdos ni presenta nada por sí sola: todo pasa por
el abogado. Los documentos se envían a la API de Anthropic solo cuando se pide
leer, analizar o redactar; Anthropic no usa los datos de la API para entrenar
sus modelos.

### Instalación de la IA (una sola vez)

1. **Tablas y almacenamiento**: Supabase → *SQL Editor* → pegar y ejecutar
   todo `supabase/002_documentos_ia.sql`.
2. **Llave de Anthropic**: en <https://platform.claude.com> → *API Keys* →
   *Create Key* (requiere método de pago). En Supabase → *Edge Functions* →
   *Secrets* → agregar `ANTHROPIC_API_KEY` con esa llave. **Nunca** se pone en
   `config.js` ni en el repositorio.
3. **Función**: Supabase → *Edge Functions* → *Deploy a new function* → *Via
   Editor* → nombre **`ia`** → borrar el ejemplo, pegar todo
   `supabase/functions/ia/index.ts` → *Deploy*. (Con la CLI:
   `supabase functions deploy ia`.) Deje activada la verificación de JWT.

Modelo: Claude Opus 5.5 (`claude-opus-5-5`), con respaldo automático del
servidor si el modelo declina una solicitud. Costo estimado (depende del
número de páginas): ≈ 0.10–0.30 USD por documento leído y ≈ 0.50–1.50 USD
por análisis o escrito, porque estos releen hasta 6 documentos recientes del
expediente. Revise el consumo real en platform.claude.com → *Usage*.

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
npm test          # cálculo de plazos
npm run test:ia   # función de IA con Supabase y Claude simulados (requiere Deno)
# permisos (RLS) en un Postgres local:
#   psql -d prueba -f tests/supabase-stub.sql -f supabase/schema.sql \
#        -f supabase/002_documentos_ia.sql -f tests/rls.sql -f tests/rls-ia.sql
```

## Archivos
```
index.html, app.js, style.css   interfaz
plazos.js                        cálculo de días hábiles (probado)
data.js                          acceso a datos (Supabase / demo)
config.js                        configuración pública
vendor/                          supabase-js 2.45.4 (sin CDN)
supabase/schema.sql              tablas, RLS, triggers, bitácora
supabase/002_documentos_ia.sql   documentos, análisis, escritos y almacenamiento
supabase/functions/ia/index.ts   agentes de IA (lector, analista, redactor)
netlify/functions/despacho-recordatorios.mjs   correo diario
```
