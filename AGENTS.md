# Dominó Venezolano Online — guía para el agente

PWA para jugar dominó venezolano en parejas, en tiempo real, desde el celular.
La usa un grupo de ~8 amigos. Todo el proyecto —código, comentarios, UI y
commits— está **en español**; mantenlo así.

Este archivo es el punto de entrada. Si vas a tocar algo, lee primero
"Arquitectura" y "Trampas ya pisadas": son las dos secciones que evitan romper
cosas que costaron trabajo.

---

## Estado actual

| Etapa | Qué es | Estado |
|---|---|---|
| 1 | Setup Vite + PWA + auth anónima | ✅ verificada |
| 2 | Esquema, RLS y motor completo en Postgres | ✅ verificada |
| 3 | Flujo de sala: crear / unirse / lobby en vivo | ✅ verificada |
| 4 | Mesa jugable: reparto, turnos, jugadas | ✅ verificada |
| 5 | Pantalla de fin de mano + marcador | ✅ verificada |
| 6 | Cola, rey de la cancha y jugadores sueltos (pantalla propia) | ✅ verificada |
| 7 | Reconexión con Presence | ✅ verificada |
| 8 | Mesa: fichas siempre visibles sin scroll | ✅ verificada |
| 9 | Chat y emotes en pantalla | ✅ verificada |
| 10 | Historial y estadísticas (pantalla de perfil) | ✅ verificada |
| 11 | Prueba con el grupo de 8 y ajustes | ⬜ |

Solo queda la etapa 11: probarlo con el grupo. El motor no necesita nada nuevo.

**El usuario pidió confirmar cada etapa antes de pasar a la siguiente.** Reporta
qué verificaste y espera el visto bueno.

---

## Documentos de referencia

- `../handoff/dominoe-venezolano-plan.md` — documento maestro: reglas del juego,
  decisiones de producto y modelo de datos original. **Las reglas de ahí son
  autoritativas; no inventes variantes.**
- `../references/Dominó (3).html` — prototipo visual de Claude Design. Es un
  *bundle*: el manifiesto (gzip+base64) está en la línea 382 y la plantilla en
  la 394. Para leerlo:

  ```python
  import json, base64, gzip
  lineas = open("../references/Dominó (3).html", encoding="utf-8").read().split("\n")
  plantilla = json.loads(lineas[393])          # HTML de las 7 pantallas
  manifiesto = json.loads(lineas[381])         # componentes, fuentes
  cuerpo = plantilla[plantilla.rindex("</style>") + 8:]
  ```

  Contiene las 7 pantallas (inicio, lobby, mesa, fin de mano, cola, fin de
  partida, perfil), el componente `Ficha` y un motor de juguete en JS. Los
  tokens de color ya están extraídos en `src/styles/theme.css`, y las
  fuentes en `public/fonts/`.
- `README.md` — cómo correr el proyecto y la tabla de RPCs.

---

## Arquitectura

**El motor del juego vive en Postgres**, en funciones `SECURITY DEFINER`. Esto
no es un capricho: el requisito de que nadie vea las fichas de los demás obliga
a que el reparto ocurra en el servidor. Si un cliente repartiera, ese cliente
conocería las 28 fichas.

De ahí salen tres reglas que **no debes romper**:

1. **El cliente no escribe en ninguna tabla de juego.** No hay políticas de
   `INSERT`/`UPDATE`/`DELETE` en ningún lado. Toda mutación es una RPC.
2. **El cliente lee con `get_game_state(match_id)` / `get_room_state(room_id)`**,
   que devuelven un `jsonb` recortado para quien llama: el tablero completo, el
   marcador, cuántas fichas le quedan a cada quien, y **solo tu propia mano**.
3. **Realtime es una campanita, no un transporte de estado.** Los triggers
   emiten un evento mínimo por Broadcast (`room:{id}` / `match:{id}`) y el
   cliente vuelve a pedir el estado completo. Nunca se aplican deltas. Esto hace
   que reconectarse sea el mismo fetch de siempre y que sea imposible quedar
   desincronizado.

   **La única excepción es Presence** (etapa 7), que sí lleva un dato por el
   canal: quién tiene la app abierta. Es liveness, no estado de juego, y está
   acotada — solo adelanta el cartel de "sin señal", que por `last_seen_at`
   tardaría 30s. La autoridad sigue siendo el servidor: lo que decide si
   `void_hand` procede es `last_seen_at`, nunca Presence. Y solo se le cree a
   Presence si el canal **nos ve a nosotros** en la lista; si no, es que el sync
   no ha llegado y declarar caído a alguien sería inventarse una desconexión.

Consecuencia práctica: **para agregar una acción de juego, escribe una RPC
nueva**, no una escritura desde el cliente.

### Proyecto Supabase

- Nombre `domino-venezolano`, ref **`yyprivbmkitbeselzonh`**, región us-east-1.
- URL y clave publicable están en `.env.local` (la clave es pública por
  diseño: la seguridad la da RLS).
- Auth **anónima** habilitada. Solo se pide nombre + avatar. La sesión persiste
  en `localStorage` bajo la clave `domino.auth`; por eso volver a abrir la app
  te devuelve la misma identidad, que es lo que permite reconectarse y acumular
  estadísticas.
- Migraciones: hay MCP de Supabase disponible (`apply_migration`, `execute_sql`,
  `get_advisors`). El espejo versionado está en `supabase/migrations/`.
  **Si aplicas una migración por MCP, guarda también el `.sql` en esa carpeta.**

---

## Estructura

Este repo es la app. Los dos documentos de referencia viven **fuera** de él, un
nivel más arriba, porque no son código: si clonaste solo el repo no los tienes.

```
app/                          este repo
├── AGENTS.md                 este archivo
├── src/
│   ├── components/           Ficha (puerto 1:1 del prototipo), Avatar, Chat
│   ├── game/
│   │   ├── tiles.ts          utilidades de fichas — ESPEJO, no autoridad
│   │   ├── state.ts          tipos exactos de get_game_state / get_room_state
│   │   └── view.ts           cálculos de presentación y acomodo de la mesa
│   ├── hooks/                useAuth, useRoom, useGameState, useAccion,
│   │                         useLatido, useMensajes, useTamano
│   ├── lib/                  supabase.ts (cliente), api.ts (RPCs tipadas)
│   ├── screens/              Inicio, Lobby, Mesa, Cola, FinPartida, Perfil
│   │                         (+ un .module.css cada una)
│   └── styles/               theme.css (tokens), fonts.css
├── scripts/                  pruebas contra el Supabase real (ver abajo)
└── supabase/migrations/      espejo versionado del esquema

../handoff/                   documento maestro (reglas y decisiones)
../references/                prototipo visual de Claude Design
```

---

## Reglas del juego (autoritativas)

- 4 jugadores, 2 parejas **cruzadas**: asientos 0 y 2 contra 1 y 3.
  El turno rota `(asiento + 1) % 4`, sentido horario.
- Juego de dobles: 28 fichas (0-0 a 6-6), 7 por jugador.
- **Primera mano:** sale quien tiene el 6-6; si no se repartió, el doble más alto.
- **Manos siguientes:** la salida rota a `(salida_anterior + 1) % 4`,
  **sin importar quién ganó**.
- **Pase automático:** si el de turno no tiene ficha que calce, el servidor
  registra un `pass` y sigue. Solo se detiene en alguien con jugada legal.
  4 pases seguidos ⇒ tranca.
- **Dominó:** el que se queda sin fichas ⇒ su pareja suma los pips de la
  **pareja contraria** (no los del compañero).
- **Capicúa:** cerrar con un doble que calzaba por las dos puntas.
  **No duplica puntos**, salvo que la sala tenga `capicua_doble = true`
  (por defecto `false`). Se guarda en `hands.was_capicua` para que la UI lo
  celebre.
- **Tranca:** gana la pareja con **menos** pips y suma los pips de la contraria.
- **Empate exacto en tranca:** mano anulada, 0 puntos, se reparte otra.
  `end_type = 'tranca_empate'`.
- **Partida:** primera pareja en llegar a `rooms.points_target` (100 por defecto).
- **Rey de la cancha:** al terminar, la pareja ganadora se queda; la perdedora
  sale al final de la cola y entra la siguiente pareja.

### Decisiones tomadas sobre casos que el spec no cubría

- Tras `tranca_empate` la salida **sí rota** (esa mano se jugó).
- Tras `anulada` (el anfitrión cortó por desconexión) sale **el mismo**
  (no se jugó nada). `end_type = 'anulada'` es una adición al spec.
- La pareja que pierde la partida **vuelve al final de la cola** automáticamente.
  Si la cola está vacía, se queda jugando.
- **Pareja frecuente** = 3 o más partidas juntos, cruzando salas. Se marca por
  trigger al cerrar cada partida.
- En el lobby, **cambiarse de asiento es cómo eliges pareja** (`take_seat`).
- **Desconexión:** la mesa espera indefinidamente mostrando "sin señal". A los
  60s el anfitrión puede anular la mano con `void_hand`. **Nadie juega por otro**
  — esto lo decidió el usuario explícitamente; no lo cambies por un auto-play.

---

## Superficie de RPCs

Ejecutables por `authenticated`:

| Función | Quién | Qué hace |
|---|---|---|
| `ensure_profile(nombre, avatar)` | cualquiera | crea/actualiza el perfil |
| `create_room(max_size, points_target, capicua_doble)` | cualquiera | sala nueva, código `AAA-999` |
| `join_room(code)` | cualquiera | **idempotente**: si ya eras miembro, solo marca que volviste |
| `take_seat(room_id, seat)` | en el lobby | sentarse / intercambiar asiento |
| `leave_room` / `heartbeat` / `set_room_config` | miembros / anfitrión | |
| `request_turn` / `pair_with` / `leave_queue` | observadores | sueltos, parejas, cola |
| `start_match(room_id)` | anfitrión | reparte la primera mano |
| `play_tile(hand_id, tile, side)` | el de turno | valida, coloca y avanza el turno |
| `start_next_hand(match_id)` | miembros | siguiente mano, salida rotada |
| `void_hand(hand_id)` | anfitrión | anula mano trabada (>60s sin señal) |
| `next_match(room_id)` | anfitrión | rey de la cancha |
| `get_game_state` / `get_room_state` / `get_profile_history` | miembros | lectura |
| `send_message(room_id, body, kind)` | miembros | chat y emotes |
| `get_messages(room_id, limit)` | miembros | los últimos N mensajes de la sala |

**Internas, sin `EXECUTE` para nadie** (solo las llama el motor por dentro):
`deal_hand`, `resolve_hand`, `advance_turn`, `ensure_team`, `bump_player_stats`,
`gen_room_code`, `notify_room`, `notify_match`, `on_hand_finished`,
`on_match_finished`.

Formato de ficha: texto `"mayor-menor"`, ej. `"6-4"`, `"3-3"`.
Lados: `'l'` (izquierda) / `'r'` (derecha).

`get_game_state` devuelve además:

- `match_stats` — manos jugadas, dominós, trancas y capicúas de la partida
  entera; es lo que pinta la rejilla de fin de partida.
- `now` — el reloj del servidor al leer. **Cualquier cuenta contra
  `last_seen_at` o `turn_started_at` se hace con esta hora, no con la del
  navegador** (ver la trampa 6).

Las dos se añadieron con `create or replace` sobre la función que ya existía
—migraciones `20260903120000_match_stats_in_game_state.sql` y
`20260903130000_server_now_in_game_state.sql`— justamente para no crear
funciones nuevas que hubiera habido que blindar aparte.

### El tablero

Las fichas se ordenan por `hand_tiles.board_position` ascendente. La salida ancla
en 0; jugar por la derecha usa `max+1`, por la izquierda `min-1`.
Cada ficha guarda cómo quedó girada: `oriented_a` mira a la izquierda,
`oriented_b` a la derecha, de modo que `ficha[i].oriented_b = ficha[i+1].oriented_a`.
Los extremos abiertos están cacheados en `hands.left_end` / `hands.right_end`.

---

## Cómo correr y probar

```bash
npm install
npm run dev          # http://localhost:5173, también accesible desde la LAN
npm run build
npx tsc -b           # typecheck
```

### Pruebas del motor (contra el Supabase real, por las mismas RPCs que la app)

```bash
node scripts/smoke.mjs        # sala, cola, RLS, trampas, una mano completa
node scripts/smoke-match.mjs  # partida entera a 100 + rey de la cancha + estadísticas
node scripts/smoke-void.mjs   # anular mano por desconexión (tarda ~80s a propósito)
```

### Pruebas de UI (jsdom, porque no hay navegador)

```bash
npm run build
npx vite preview --port 4173 &
node scripts/ui-check.mjs     # inicio → crear sala → lobby que se actualiza solo
node scripts/ui-mesa.mjs      # la mesa: tocar fichas y ver jugar a los otros en vivo
node scripts/ui-cola.mjs      # cola, sueltos, fin de partida y rey de la cancha
node scripts/ui-reconexion.mjs # overlay de reconexión y anular mano trabada
node scripts/ui-chat.mjs      # emotes, chat en vivo y freno del servidor
node scripts/ui-perfil.mjs    # historial, estadísticas y pareja frecuente
node scripts/ui-ajuste.mjs    # que las fichas quepan sin scroll, jugada a jugada
```

`ui-cola.mjs` levanta **dos** jsdom a la vez (Rafa juega, Gaby mira desde la
cola) y juega una partida entera a 100 puntos: tarda un par de minutos.

`ui-reconexion.mjs` simula la caída de red propia con los eventos
`offline`/`online` sobre `navigator.onLine` de jsdom, y usa a los jugadores por
RPC como desconectados de verdad: nadie llama `heartbeat` por ellos ni se
suscriben al canal, así que Presence no los ve y su `last_seen_at` envejece
solo. Tarda ~80s porque espera el umbral real de `void_hand`.

`scripts/jsdom-app.mjs` monta la app **compilada** dentro de jsdom.
`scripts/players.mjs` maneja las identidades de prueba.

### Limpieza entre corridas

```sql
delete from public.rooms;   -- cascadea a partidas, manos, fichas y mensajes
```

**No borres `auth.users`**: invalidarías las sesiones cacheadas y volverías a
chocar con el límite de registros (ver abajo).

---

## Trampas ya pisadas

Seis cosas que costaron tiempo. No las repitas.

1. **Supabase concede `EXECUTE` a `anon` y `authenticated` sobre toda función
   nueva de `public`**, vía `ALTER DEFAULT PRIVILEGES`. Un `revoke ... from
   public` **no** basta. Esto dejaba `resolve_hand()` llamable por REST:
   cualquiera se fabricaba una victoria. La migración
   `20260903025802_lock_down_function_grants.sql` revoca todo y concede una por
   una. **Si agregas una función, decide explícitamente si lleva `grant execute
   ... to authenticated` y corre `get_advisors(type:'security')` después.**

2. **Límite de registros anónimos: 30/hora por IP.** Una tanda de pruebas se lo
   come. Por eso las identidades de prueba se crean una vez y se cachean en
   `scripts/.test-sessions.json` (ignorado por git). Si el caché falta:
   `node scripts/seed-players.mjs` (reintenta con paciencia). Se puede subir el
   límite en Authentication → Rate Limits.

3. **Chromium no arranca en esta máquina**: faltan `libnspr4`, `libnss3`,
   `libnssutil3` y `libasound.so.2`, y no hay sudo. De ahí el arnés de jsdom.
   Si algún día se instalan (`sudo apt install libnspr4 libnss3 libasound2t64`),
   Playwright ya está en la caché de `~/.cache/ms-playwright` y se pueden tomar
   screenshots de verdad — que es lo que falta para verificar **fidelidad
   visual** contra el prototipo.

4. **jsdom no ejecuta `<script type="module">`** ni trae `fetch`/`WebSocket`.
   `bootApp()` evalúa el bundle a mano (neutralizando `import.meta`) e inyecta
   las APIs de red de Node. No "arregles" eso.

5. **`pkill -f vite` mata el propio shell del agente**: el patrón aparece en la
   línea de comandos del propio bash. `pgrep -f "vite preview" | xargs kill`
   falla igual, por lo mismo. Mata por puerto:

   ```bash
   PID=$(ss -lptn 'sport = :4173' | grep -oP 'pid=\K[0-9]+' | head -1)
   [ -n "$PID" ] && kill "$PID"
   ```

6. **El reloj del navegador no sirve para medir umbrales del servidor.** La
   cuenta de "segundos sin señal" que habilita el botón de anular la mano se
   comparaba con `Date.now()`. Como `last_seen_at` lo escribe Postgres,
   cualquier desfase de reloj corre la cuenta: en esta máquina son ~1,4s y ya
   bastaban para que el botón apareciera mientras `void_hand` seguía
   respondiendo *"el jugador de turno sigue conectado"*. Por eso
   `get_game_state` devuelve `now` y `useGameState` expone `desfase`
   (`servidor − dispositivo`). **Si añades otra cuenta contra una marca de
   tiempo del servidor, súmale el desfase.**

   El test que lo cubre (`ui-reconexion.mjs`) pulsa el botón **en cuanto la app
   lo ofrece**, sin esperar el umbral por su cuenta: es la única forma de que un
   adelanto de la cuenta haga fallar la prueba en vez de pasar desapercibido.

Además, al escribir pruebas contra la UI: **espera a que el DOM refleje el
cambio**, no a que el servidor lo tenga. Leer el estado desde otro cliente y
asumir que el navegador ya se enteró produce fallos intermitentes que parecen
bugs de la app y no lo son.

---

## Convenciones

- **Español** en todo: comentarios, UI, mensajes de error de las RPCs, commits.
- **Ningún hex suelto en los componentes.** Todos los colores salen de las
  variables de `src/styles/theme.css`, extraídas del prototipo. Si necesitas un
  color nuevo, agrégalo como token.
- **CSS Modules por pantalla** (`Pantalla.module.css`). Sin Tailwind — fue una
  decisión explícita del usuario.
- Tipografías: `Bodoni Moda` para números y títulos, `Jost` para la UI.
  Los labels van en versalitas: `Jost 500 9–10px`, `letter-spacing .18–.3em`,
  `text-transform: uppercase` (hay una clase `.label` global).
- Las utilidades de `src/game/tiles.ts` son **espejo para pintar**, no autoridad.
  El servidor revalida todo. No muevas reglas al cliente.
- Mobile-first, dark-only. Respeta `env(safe-area-inset-*)`.
- Comentarios: explica **por qué**, no qué. Los archivos existentes marcan el tono.

---

## Navegación entre pantallas

```
/                          Inicio
/sala/:code                Lobby       (antes de arrancar)
/sala/:code/mesa           Mesa        (los 4 sentados)
/sala/:code/cola           Cola        (todos los demás, con la partida en curso)
/sala/:code/resultado/:id  FinPartida  (rey de la cancha)
/perfil/:id?              Perfil      (sin id, el tuyo)
```

Quién se mueve solo, y cuándo:

- **Lobby → mesa/cola** en la **transición** `lobby → playing`, y solo ahí. El
  lobby distingue "todavía no leí la sala" (`null`) de "no está jugando":
  redirigir en cada render dejaba el botón "volver a la sala" de la mesa
  rebotando de vuelta, sin forma de mirar los asientos con la partida en curso.
- **Cola → mesa** cuando `next_match` te sienta.
- **FinPartida → mesa/cola** cuando el `current_match_id` de la sala deja de
  coincidir con el de la ruta: esa es la señal de que ya arrancó la siguiente.
  Por eso el id de la partida va **en la URL** y no se lee del estado de la
  sala; si se leyera de ahí, el resumen se reemplazaría por la partida nueva
  justo cuando lo estás leyendo, y recargar mostraría el resultado equivocado.

---

## Reconexión (etapa 7, ya hecha)

Tres señales, de la más rápida a la más lenta, todas en `useRoom`:

1. `navigator.onLine` con los eventos `online`/`offline`.
2. El estado del canal de Realtime (`CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`).
3. Dos latidos seguidos sin respuesta. Tras un fallo el latido se reintenta a
   los 4s en vez de a los 20, que es lo que hace que el overlay salga cuando de
   verdad se cayó la red.

Con cualquiera de las tres, `conexion.perdida` es `true` y la mesa muestra el
overlay **Reconectando** (con "Reintentar ahora", que late y resincroniza).

Cuando el que se cae es **el de turno**, la mesa lo espera indefinidamente
—*nadie juega por otro*— y muestra la cuenta de segundos. A los 60 el anfitrión
puede anular (`void_hand`). El aviso se puede apartar con "Ver la mesa" y queda
como una línea compacta sobre el tablero que **conserva el botón de anular**:
descartarlo no debe dejar al anfitrión sin la única salida.

---

## Chat y emotes (etapa 9, ya hecha)

Vive en `components/Chat.tsx`, dentro de la mesa, entre el tablero y la mano.

- **Los cuatro emotes del prototipo** (`¡Ahí va!`, `¡Data!`, `Tranquilo`,
  `¡Se pegó!`) están fijos a propósito: la gracia es tocarlos sin pensar y sin
  dejar de mirar las fichas.
- **Lo que se ve por defecto son burbujas que se apagan solas** — 6s un emote,
  12s una frase escrita, y como mucho tres a la vez. Un historial siempre
  abierto le comería la pantalla al tablero. El historial existe, detrás de
  "Escribir".
- La cuenta para apagarlas va contra `created_at`, que lo escribe Postgres, así
  que **se mide con el reloj del servidor** (`get_messages` devuelve `now`).
  Ver la trampa 6.
- `useMensajes` **no abre canal propio**: se cuelga del `pulso` que expone
  `useRoom` y que sube con cada evento del canal. El mismo cliente no puede
  suscribirse dos veces al mismo topic, y de paso el chat sigue el patrón de
  siempre — el evento avisa, el cliente relee.
- El freno de `send_message` (8 mensajes por 10s) se muestra tal cual llega del
  servidor; no hay throttling en el cliente que lo esconda.

Falta, si algún día se quiere: el mismo componente en la pantalla de cola, para
que los que esperan turno también hablen. Es enchufarlo, no hay backend nuevo.

---

## Perfil (etapa 10, ya hecha)

`get_profile_history(profile_id, limit)` acepta un perfil ajeno a propósito: las
estadísticas son públicas entre jugadores y es lo que da sentido al badge de
pareja frecuente. Por eso la ruta lleva id opcional — sin id, el tuyo — y la
tarjeta de pareja frecuente enlaza al historial de esa persona.

Dos detalles que no son evidentes:

- **`stats.hands_won` cuenta toda mano ganada, dominós y trancas.** El prototipo
  rotulaba esa casilla "Dominós"; sería mentira, así que en la app dice "Manos
  ganadas". Las trancas tienen su propia casilla.
- La etiqueta de la tarjeta sale del flag del servidor: "Pareja frecuente" con
  `is_frequent_pair` (3 partidas juntos o más), "Con quien más juegas" si no.
- El "hoy / ayer" del historial usa el reloj local **a propósito**: es una
  etiqueta de día, no un umbral que el servidor vaya a revalidar, así que la
  trampa 6 no aplica.

Se entra por el avatar del inicio (como en el prototipo) y por el enlace de fin
de partida.

---

## La mesa cabe sin scroll (etapa 8, ya hecha)

**Requisito del usuario: las fichas se ven sin hacer scroll mientras se juega.**
Eso descarta la idea que este documento sugería antes (una fila con scroll
horizontal que respetara la cadena): el scroll es justo lo que no puede haber.

No se puede resolver solo con CSS, porque el tamaño que cabe depende de cuántas
fichas hay, de cuáles son dobles —van girados y miden al revés— y del alto que
le quede al tablero, que cambia si se abre el chat o entra un aviso de espera.
Así que se **mide y se calcula**:

- `useTamano` mide el felt y la mano con `ResizeObserver`.
- `tamanoTablero` **simula el reparto en filas de `flex-wrap`** para cada tamaño
  candidato, de 64px hacia abajo, y se queda con el mayor que quepa entero. Se
  simula en vez de estimarse porque contar "fichas por fila" se queda corto
  justo en las cadenas con muchos dobles, que son las que peor caben.
- `tamanoMano` despeja el ancho de una fila de siete fichas verticales.

Tres cosas que hay que respetar si se toca esto:

1. **Las medidas del acomodo (huecos, aire, padding) viven en `Mesa.tsx` y se
   aplican en línea, no en el CSS.** El cálculo las necesita; tenerlas en dos
   sitios es tenerlas mal en uno de los dos.
2. **`useTamano` devuelve un ref callback, no un `useRef`.** La mesa arranca en
   "cargando" y el elemento a medir no existe en el primer commit; con un ref de
   objeto el efecto corría una vez con `current` en null y no volvía a
   engancharse nunca, dejando el tablero con la estimación para siempre.
3. **El lado corto se despeja primero, y el largo es su doble.** `Ficha` pinta el
   corto como `round(size / 2)`: un lado largo impar se redondea hacia arriba y
   cada ficha se pasa medio píxel — con siete en la mano, 3px de scroll.

Lo que queda fuera del arnés: jsdom no hace layout, así que la prueba finge la
medida y comprueba los px que la app decidió. La fidelidad visual de verdad
—colores, sombras, cómo se ve en la mano— sigue necesitando abrirlo en un
teléfono (`npm run dev` y entrar por la LAN).

---

## Lo que queda (etapa 11)

Las etapas 1 a 10 están cerradas y verificadas. Queda probarlo con el grupo.
