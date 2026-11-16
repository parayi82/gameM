# Boletín y correos → Bandeja de publicaciones

Lexpress reúne en la **Bandeja** los acuerdos publicados de sus expedientes,
ya vinculados al expediente correcto. Hay dos vías de entrada:

| Vía | Para qué fuentes | Cómo llega |
|---|---|---|
| **Pegar o subir el boletín** | Boletín Judicial de Jalisco, juzgados laborales, listas de acuerdos del PJF, Boletín Electrónico del TJA | Cada mañana pega el texto o sube el PDF del día; la app encuentra sola sus expedientes. |
| **Correos de notificación** | TJA (avisa por correo antes de publicar), Portal de Servicios en Línea del PJF y cualquier tribunal que notifique por correo | Un script en su Gmail los manda a Lexpress cada 15 minutos, con el PDF adjunto si lo trae. |

> ¿Por qué no se descargan solos de los sitios web? Varios tribunales bloquean
> expresamente los accesos automáticos (el TJA de Jalisco lo hace) y otros piden
> usuario (SISE del CJF). Lexpress respeta esas reglas. Si algún tribunal
> autoriza o publica un servicio de consulta, se puede agregar después.

## Cómo reconoce sus expedientes
- Busca el **número/año** de cada expediente activo (acepta variantes:
  `0845/2026`, `845/26`, `845-2026`, `L-845/2026`).
- Como el mismo número existe en muchos juzgados, lo confirma con el
  **encabezado del juzgado** más cercano (ordinal y materia) y con los
  **nombres de las partes**.
- Si el número aparece en **otro juzgado**, lo descarta.
- Cada publicación indica su **confianza** (alta / media) y el motivo. Nada
  entra a la agenda hasta que usted pulsa **Registrar acuerdo**.
- La misma publicación nunca se duplica, aunque pegue el boletín dos veces.

---

## Instalación (una sola vez, ~20 minutos)

### 1. Base de datos
Supabase → **SQL Editor** → **New query** → pegar todo
`supabase/003_publicaciones.sql` → **Run**.

> Con esto ya funciona la vía de **pegar o subir el boletín**. Los pasos 2 a 5
> son solo para los **correos**.

### 2. Función `buzon` en Supabase
1. **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: **`buzon`**.
3. Borre el ejemplo y pegue todo `supabase/functions/buzon/index.ts`
   (el archivo generado, no `fuente.ts`) → **Deploy**.
4. En la función → **Settings** → **apague** "Verify JWT" → **Save changes**.
   (Gmail no tiene sesión de Supabase; la protección es la clave secreta del paso 4.)

### 3. Etiqueta y filtro en Gmail
1. En Gmail, en la barra de búsqueda pulse el ícono de **filtros** (⚙ a la derecha).
2. En **De** escriba los remitentes de los tribunales, por ejemplo:
   `@pjf.gob.mx OR @cjf.gob.mx OR @tjajal.gob.mx OR @cjj.gob.mx OR @stjjalisco.gob.mx`
   (ajústelo a las direcciones de las que realmente le llegan notificaciones).
3. **Crear filtro** → marque **Aplicar la etiqueta** → **Etiqueta nueva**:
   `Lexpress/Por enviar` → **Crear filtro**.

### 4. Script en Google (gratis)
1. Entre a **https://script.google.com** con esa misma cuenta de Gmail →
   **Nuevo proyecto** → nómbrelo "Lexpress".
2. Borre el contenido y pegue todo `docs/gmail-a-lexpress.gs` → **Guardar** (💾).
3. Arriba, en el selector de funciones, elija **`generarClave`** → **Ejecutar**.
   Google le pedirá permisos (Gmail y conexión externa): **Revisar permisos** →
   su cuenta → **Avanzado** → **Ir a Lexpress** → **Permitir**.
4. Abajo, en **Registro de ejecución**, copie la clave que aparece.
5. En Supabase → **Edge Functions** → **Secrets** → **Add new secret**:
   - Name: `BUZON_TOKEN`
   - Value: la clave copiada → **Save**.

### 5. Activar el envío automático
1. En el script, elija la función **`instalarActivador`** → **Ejecutar**.
2. Listo: cada 15 minutos los correos con la etiqueta *Lexpress/Por enviar*
   se mandan a la Bandeja y pasan a *Lexpress/Enviado*.

**Para probar**: aplique a mano la etiqueta *Lexpress/Por enviar* a una
notificación que ya tenga, elija **`enviarALexpress`** → **Ejecutar**, y revise
la **Bandeja** de Lexpress.

---

## Uso diario
1. **Boletín**: Bandeja → *Importar boletín o lista de acuerdos del día* →
   elija la fecha y el boletín → pegue el texto (o **Subir PDF**) →
   **Buscar mis expedientes** → **Agregar a la bandeja**.
   (Si el PDF es una imagen escaneada no tiene texto: copie el texto desde el
   sitio del tribunal.)
2. **Revise la Bandeja** (la pestaña muestra cuántas hay por revisar; la
   agenda también le avisa y el correo diario de recordatorios las incluye).
3. En cada publicación: **Registrar acuerdo** → ajuste fecha de notificación
   y término → **Guardar**. El acuerdo entra a la agenda y la publicación queda
   como *Registrada*. Si no es relevante: **Descartar**.
4. Los correos que no se pudieron vincular aparecen como **Sin vincular**:
   elija el expediente en la lista y luego regístrelo.
