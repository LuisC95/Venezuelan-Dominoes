# Dominó Venezolano Online

PWA para jugar dominó venezolano en parejas, en tiempo real, con los panas.
Reglas y decisiones: `../handoff/dominoe-venezolano-plan.md`.
Referencia visual: `../references/Dominó (3).html` (prototipo de Claude Design).

## Correr en local

```bash
npm install
cp .env.example .env.local   # ya viene lleno para el proyecto domino-venezolano
npm run dev                  # http://localhost:5173 (también accesible desde el celular en la LAN)
```

## Arquitectura

- **Frontend:** Vite + React + TypeScript, PWA instalable (`vite-plugin-pwa`), dark-only.
- **Backend:** Supabase (proyecto `domino-venezolano`, ref `yyprivbmkitbeselzonh`).
- **Auth:** anónima. Solo nombre + avatar; la sesión persiste en el navegador.
- **El motor del juego vive en Postgres**, en funciones `SECURITY DEFINER`. El cliente no
  escribe en ninguna tabla de juego: solo llama RPCs y lee `get_game_state()`. Esto es lo que
  permite que nadie vea las fichas de los demás (RLS) y que reconectarse sea una sola llamada.
- **Realtime** se usa como campanita: avisa "algo cambió" y el cliente hace pull del estado.

## Pruebas del motor

Corren contra el proyecto real, con jugadores anónimos de verdad y por las mismas
RPCs que usa la app.

Los seis jugadores de prueba (Rafa, Chuo, Marielba, Kike, Yorman, Gaby) se crean
una sola vez y sus sesiones quedan en `scripts/.test-sessions.json` (ignorado por
git). Supabase corta los registros anónimos a 30/hora por IP y una tanda de
pruebas se los comía; reutilizando las sesiones no se crea ningún usuario nuevo.
Para limpiar entre corridas basta `delete from public.rooms;` — cascadea a
partidas, manos, fichas y mensajes, y deja intactas las identidades.

```bash
node scripts/smoke.mjs        # sala, cola, RLS, trampas, una mano completa
node scripts/smoke-match.mjs  # partida entera a 100 + rey de la cancha + estadísticas
node scripts/smoke-void.mjs   # anular una mano por desconexión (tarda ~80s a propósito)

npm run build && npx vite preview --port 4173 &   # y en otra terminal:
node scripts/ui-check.mjs      # inicio → crear sala → lobby que se actualiza solo
node scripts/ui-mesa.mjs       # la mesa: tocar fichas, ver jugar a los otros en vivo
node scripts/ui-cola.mjs       # cola, sueltos, fin de partida y rey de la cancha
node scripts/ui-reconexion.mjs # overlay de reconexión y anular mano por desconexión
node scripts/ui-chat.mjs       # emotes, chat en vivo y freno del servidor
node scripts/ui-perfil.mjs     # historial, estadísticas y pareja frecuente
node scripts/ui-ajuste.mjs     # que las fichas quepan sin scroll, jugada a jugada
```

`ui-check` existe porque en esta máquina falta `libnspr4`/`libnss3` y Chromium no
arranca. jsdom no pinta píxeles, pero verifica que los componentes renderizan, que
la navegación funciona y que el lobby se actualiza solo cuando entra alguien. Para
revisar el diseño de verdad: `npm run dev` y abrirlo desde el celular en la LAN.

## Estructura

```
src/
  components/   piezas reutilizables (Ficha)
  game/         tipos y utilidades de dominó (espejo de las reglas, solo para pintar)
  hooks/        useAuth (sesión anónima + perfil)
  lib/          cliente de Supabase
  screens/      una pantalla del prototipo por archivo (Inicio, Lobby, Mesa, Cola, FinPartida)
  styles/       theme.css (tokens) + fonts.css (Bodoni Moda + Jost self-hosted)
supabase/migrations/   espejo versionado de lo aplicado en el proyecto remoto
scripts/               pruebas de humo del motor contra Supabase
```

## Superficie del motor (RPCs)

| Función | Quién | Qué hace |
|---|---|---|
| `ensure_profile` | cualquiera | crea/actualiza nombre y avatar |
| `create_room` / `join_room` | cualquiera | sala nueva con código, o entrar por código |
| `take_seat` | en el lobby | cambiarse de asiento = elegir pareja (0-2 vs 1-3) |
| `request_turn` / `pair_with` / `leave_queue` | observadores | sueltos, parejas y cola |
| `start_match` | anfitrión | reparte la primera mano (sale el 6-6) |
| `play_tile` | quien tiene el turno | valida, coloca, y pasa turno (con pase automático) |
| `start_next_hand` | cualquiera de la sala | siguiente mano, salida rotada |
| `void_hand` | anfitrión | anula una mano trabada por desconexión (>60s) |
| `next_match` | anfitrión | rey de la cancha: ganadores se quedan, entra la cola |
| `get_game_state` / `get_room_state` | miembros | todo lo que esa persona puede ver |
| `get_profile_history` | cualquiera | estadísticas e historial de un jugador |
| `send_message` / `get_messages` | miembros | chat y emotes de la sala |
| `heartbeat` | miembros | presencia, cada ~20s |

Las internas (`deal_hand`, `resolve_hand`, `advance_turn`, `ensure_team`,
`bump_player_stats`, `notify_*`) **no** tienen `EXECUTE` para nadie: solo las llama
el motor desde dentro. Es lo que impide fabricarse una victoria por REST.

## Estado

- [x] Etapa 1 — setup + PWA + auth anónima
- [x] Etapa 2 — esquema + RLS + RPCs del motor
- [x] Etapa 3 — flujo de sala (crear / unirse / lobby en vivo)
- [x] Etapa 4 — mesa jugable (reparto, turnos, jugadas)
- [x] Etapa 5 — pantalla de fin de mano + marcador
- [x] Etapa 6 — cola, sueltos, fin de partida y rey de la cancha
- [x] Etapa 7 — reconexión (Presence, overlay y anular mano trabada)
- [x] Etapa 9 — chat y emotes en la mesa
- [x] Etapa 10 — perfil: historial y estadísticas
- [x] Etapa 8 — mesa: fichas siempre visibles sin scroll

Guía completa para retomar el trabajo (o para otro agente): `AGENTS.md`
- [ ] Etapa 11 — probarlo con el grupo
>>>>>>> e4c8596 (first commit)
