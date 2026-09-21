# La Cabaña — novela interactiva room-escape

Motor genérico en HTML/JS vanilla que lee **nodos de escena desde JSON**
(`/chapters/*.json`); ninguna lógica de escena está hardcodeada en el motor.

## Estructura

```
/engine/          motor genérico (estado, timer, acciones, render, orquestador)
/chapters/        manifest.json + un JSON por capítulo (datos, no código)
/assets/          fondos e iconos (placeholders SVG hasta correr el pipeline de arte)
/supabase/        schema.sql + notas de setup
/netlify/functions/  Stripe Checkout + webhook (paywall por capítulo)
/scripts/         pipeline offline de generación de arte (Nano Banana)
index.html, style.css, config.js   shell de la app + configuración pública
```

## Cómo jugar en local

```bash
npm run dev     # sirve el directorio en http://localhost:8080
```

Sin configurar Supabase/Stripe, el juego funciona igual: el progreso se
guarda en `localStorage` y los capítulos marcados `"free": true` en
`chapters/manifest.json` se juegan sin paywall (capítulos 1 y 2).

## Modelo de datos de un nodo

Cada nodo = fondo + texto + hotspots. El motor resuelve las acciones de
hotspot **por tipo**, nunca por id de escena:

- `reveal_item` — revela un ítem al inventario
- `set_flag` — marca una bandera de estado (puede detener el timer con `stopsTimer`)
- `requires_item` — exige un ítem en inventario; `onSuccess`/`onFail` como
  `"next_node:ID"` o `"text:mensaje"`
- `requires_flag` — igual pero contra una bandera (usado para gatear el
  final verdadero)
- `goto` — navegación directa incondicional

Ver `chapters/ch1.json` para el capítulo de referencia completo (cajón →
llave → puerta, con timer de tensión por la ventana, y 4 finales:
trágico ×2, agridulce, verdadero).

## Minijuego: búsqueda a contrarreloj

Un nodo con `"type": "minigame"` se resuelve con una rama de motor separada
(`GameEngine._handleMinigameHotspot`), pero por **tipo de nodo**, no por
escena — el patrón es el mismo que `actions.js`. Estructura:

```json
{
  "type": "minigame",
  "timer": { "seconds": 20, "onExpire": "nodo_si_se_acaba_el_tiempo" },
  "minigame": {
    "pointsPerFind": 10,
    "timeBonusPerSecond": 2,
    "decoyPenalty": 5,
    "onComplete": "nodo_si_encuentra_todo"
  },
  "hotspots": [
    { "id": "pista_1", "coords": [x, y, w, h], "kind": "target" },
    { "id": "trasto_1", "coords": [x, y, w, h], "kind": "decoy" }
  ]
}
```

Cada hotspot es `"target"` (suma puntos, cuenta para completar) o `"decoy"`
(resta puntos, no cuenta). Al encontrar todos los targets se suma un bono
por segundos restantes y se avanza a `minigame.onComplete`; si se acaba el
tiempo primero, avanza a `timer.onExpire` con el puntaje parcial ya sumado.
Ver `minigame_pasillo` en `chapters/ch1.json` (entre `cabana_intro` y
`pasillo_ch2`: 3 pistas ocultas entre trastos, 20 segundos).

El puntaje (`state.score`) se persiste junto al resto del progreso — en
Supabase requiere la columna `score` en `progress`
(`supabase/migrations/002_add_score.sql` si ya corriste el schema base).

## Personajes, sonido y animación

- **Retrato de personaje**: campo opcional `node.character = {name, portrait}`.
  Se muestra junto al texto (pensamientos/diálogo de la protagonista), con
  una animación de entrada y un leve movimiento idle en CSS.
- **Sonido**: sintetizado en runtime con Web Audio API (`engine/audio.js`) —
  sin archivos de audio que mantener. El motor elige el sonido **por tipo de
  acción/resultado** (recoger ítem, click, fallo, desbloqueo, final) igual
  que resuelve la lógica en `actions.js`. Sonido ambiente por nodo vía
  `node.ambient` (`"wind"`, `"hum"` o ausente = silencio); se activa con el
  primer gesto del usuario (política de autoplay de los navegadores) y se
  puede silenciar con el botón "Sonido" en pantalla.
- **Animación**: transición de fundido entre fondos, texto que entra con
  fade, vignette pulsante cuando el timer baja de 10s, y feedback visual en
  los hotspots al hacer click — todo CSS, sin librerías.

## Ramificación y finales

- Los nodos marcados `"decisionPoint": true` guardan un snapshot de
  flags/inventario. Al llegar a un final, el jugador puede **rebobinar a la
  última decisión** en vez de reiniciar el capítulo completo.
- Cada capítulo declara sus finales en `endings` (`tragico` / `agridulce` /
  `verdadero`) y la pantalla de final muestra "X de Y finales desbloqueados".

## Supabase

Ver `supabase/README.md`. Tablas: `progress` (nodo actual, flags,
inventario, finales, último punto de decisión) y `purchases` (solo
escrita por el webhook de Stripe). Con `SUPABASE_URL`/`SUPABASE_ANON_KEY`
vacíos en `config.js`, el motor cae automáticamente a `localStorage`.

## Paywall (Stripe)

Modelo elegido para el MVP: **compra por capítulo individual** (no
suscripción) — capítulos 1-2 gratis, el resto de pago, precio en
`chapters/manifest.json` (`priceUSD`). `netlify/functions/create-checkout-session.js`
crea la Stripe Checkout Session; `stripe-webhook.js` confirma el pago y
registra la compra en Supabase. Variables de entorno necesarias en
Netlify: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SITE_URL`.

Una suscripción mensual puede añadirse después como un segundo modo de
Checkout sin tocar el motor del juego.

## Pipeline de arte (Nano Banana)

Offline, separado del motor — nunca se llama en runtime:

```bash
GEMINI_API_KEY=... node scripts/generate-art.js
```

Lee `scripts/art-manifest.json` (prompt + ruta de salida por asset) y
genera PNGs con `gemini-3.1-flash-image-preview`. Los assets actuales en
`/assets` son placeholders SVG generados localmente para poder probar el
motor sin depender de la API; al reemplazarlos por PNGs reales, actualizar
las extensiones referenciadas en `chapters/*.json`.

## Despliegue (Netlify)

1. Conectar el repo en Netlify (publish dir: `.`, functions dir:
   `netlify/functions` — ya configurado en `netlify.toml`)
2. Configurar las variables de entorno listadas arriba
3. En Stripe, apuntar el webhook `checkout.session.completed` a
   `https://<tu-sitio>.netlify.app/.netlify/functions/stripe-webhook`
