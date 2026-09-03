/**
 * Torneo: los bots contra dos que juegan al azar (la primera ficha legal que
 * encuentran, que es exactamente lo que hacía smoke-match antes de que hubiera
 * heurística).
 *
 * No es un test de correctitud: es la regla para saber si mover los pesos de
 * `bot_elige` sirvió de algo. Sin esto, "el bot juega bien" es una impresión.
 *
 *   node scripts/bench-bots.mjs [manos]      (por defecto 24)
 */
import { makePlayer } from './players.mjs'

const MANOS = Number(process.argv[2] ?? 24)

async function rpc(p, fn, args = {}) {
  const { data, error } = await p.sb.rpc(fn, args)
  if (error) throw new Error(`${p.name} ${fn}: ${error.message}`)
  return data
}

const [rafa, chuo] = await Promise.all([makePlayer('Rafa'), makePlayer('Chuo')])

// Meta alta para que una sola partida dé para muchas manos.
const room = await rpc(rafa, 'create_room', { p_max_size: 8, p_points_target: 500 })
await rpc(chuo, 'join_room', { p_code: room.code })
await rpc(chuo, 'take_seat', { p_room_id: room.id, p_seat: 2 })
await rpc(rafa, 'add_bot', { p_room_id: room.id, p_seat: 1 })
await rpc(rafa, 'add_bot', { p_room_id: room.id, p_seat: 3 })

const match = await rpc(rafa, 'start_match', { p_room_id: room.id })
console.log(`sala ${room.code} — azar (0 y 2) contra bots (1 y 3), ${MANOS} manos\n`)

const humanos = { 0: rafa, 2: chuo }
// team_a son los asientos 0 y 2 (los del azar); team_b, los bots.
const marcador = { azar: 0, bots: 0 }
const manosGanadas = { azar: 0, bots: 0, nadie: 0 }
const pipsFinales = { azar: 0, bots: 0 }
const cierres = {}

let st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
let previoA = 0
let previoB = 0

for (let mano = 1; mano <= MANOS; mano++) {
  let guard = 0
  while (st.hand.status === 'active' && guard++ < 120) {
    const yo = humanos[st.hand.current_seat]
    if (!yo) break
    const suyo = await rpc(yo, 'get_game_state', { p_match_id: match.id })
    const opt = suyo.my_hand.find((t) => t.sides.length > 0)
    if (!opt) break
    await rpc(yo, 'play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
    st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
  }

  if (st.hand.status !== 'finished') { console.log('  la mano se atascó, se corta'); break }

  cierres[st.hand.end_type] = (cierres[st.hand.end_type] ?? 0) + 1
  if (st.hand.winner_team_id === st.match.team_a_id) manosGanadas.azar++
  else if (st.hand.winner_team_id === st.match.team_b_id) manosGanadas.bots++
  else manosGanadas.nadie++

  for (const t of st.revealed) {
    if (t.seat % 2 === 0) pipsFinales.azar += t.pips
    else pipsFinales.bots += t.pips
  }

  marcador.azar = st.match.score_a
  marcador.bots = st.match.score_b
  process.stdout.write(
    `  mano ${String(mano).padStart(2)}  ${st.hand.end_type.padEnd(14)}` +
    ` azar ${String(st.match.score_a).padStart(3)} · bots ${String(st.match.score_b).padStart(3)}` +
    `   (+${st.match.score_a - previoA}/+${st.match.score_b - previoB})\n`,
  )
  previoA = st.match.score_a
  previoB = st.match.score_b

  if (st.match.status !== 'active') { console.log('  la partida llegó a la meta'); break }
  await rpc(rafa, 'start_next_hand', { p_match_id: match.id })
  st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
}

const jugadas = manosGanadas.azar + manosGanadas.bots + manosGanadas.nadie
const pct = (n) => `${Math.round((n / Math.max(1, jugadas)) * 100)}%`

console.log(`\n${jugadas} manos jugadas`)
console.log(`  manos ganadas   azar ${manosGanadas.azar} (${pct(manosGanadas.azar)})` +
  ` · bots ${manosGanadas.bots} (${pct(manosGanadas.bots)})` +
  ` · anuladas ${manosGanadas.nadie}`)
console.log(`  puntos          azar ${marcador.azar} · bots ${marcador.bots}`)
console.log(`  pips que quedan azar ${pipsFinales.azar} · bots ${pipsFinales.bots}` +
  '   (menos es mejor: es lo que paga el que pierde)')
console.log(`  cierres         ${Object.entries(cierres).map(([k, v]) => `${k}:${v}`).join(' ')}`)
console.log('\nsala ' + room.code)
