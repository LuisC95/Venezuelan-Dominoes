/**
 * Bots: que se sienten, que jueguen solos y que no rompan nada.
 *
 * Dos humanos (asientos 0 y 2) contra dos bots (1 y 3) — el caso real: somos
 * dos y faltan dos. Los humanos juegan por RPC; los bots deben jugar sin que
 * nadie los llame.
 *
 *   node scripts/smoke-bots.mjs
 */
import { makePlayer } from './players.mjs'

let failures = 0
const check = (l, ok, x = '') => {
  console.log(`${ok ? '  ok  ' : ' FALLO'} ${l}${x ? '  ' + x : ''}`)
  if (!ok) failures++
}
const head = (t) => console.log('\n=== ' + t + ' ===')

async function rpc(p, fn, args = {}) {
  const { data, error } = await p.sb.rpc(fn, args)
  if (error) throw new Error(`${p.name} ${fn}: ${error.message}`)
  return data
}
const falla = async (p, fn, args = {}) => (await p.sb.rpc(fn, args)).error

const [rafa, chuo] = await Promise.all([makePlayer('Rafa'), makePlayer('Chuo')])

head('Sentar bots')
const room = await rpc(rafa, 'create_room', { p_max_size: 8, p_points_target: 100 })
console.log(`  sala ${room.code}`)

await rpc(rafa, 'add_bot', { p_room_id: room.id, p_seat: 1 })
await rpc(rafa, 'add_bot', { p_room_id: room.id, p_seat: 2 })
check('el anfitrión sienta dos bots', true)

const tercero = await falla(rafa, 'add_bot', { p_room_id: room.id, p_seat: 3 })
check('el tercer bot se rechaza', /máximo dos bots/.test(tercero?.message ?? ''), tercero?.message)

const ajeno = await falla(chuo, 'add_bot', { p_room_id: room.id, p_seat: 3 })
check('solo el anfitrión pone bots', !!ajeno, ajeno?.message)

await rpc(rafa, 'remove_bot', { p_room_id: room.id, p_seat: 2 })
check('se puede quitar un bot', true)

await rpc(chuo, 'join_room', { p_code: room.code })
await rpc(chuo, 'take_seat', { p_room_id: room.id, p_seat: 2 })
await rpc(rafa, 'add_bot', { p_room_id: room.id, p_seat: 3 })

const sala = await rpc(rafa, 'get_room_state', { p_room_id: room.id })
const bots = sala.members.filter((m) => m.is_bot)
check('la sala marca cuáles son bots', bots.length === 2, bots.map((b) => b.display_name).join(' y '))
check('los bots cuentan como conectados', bots.every((b) => b.connected))
check('los cuatro asientos están ocupados',
  sala.members.filter((m) => m.seat !== null).length === 4)

head('Se juega una mano')
const match = await rpc(rafa, 'start_match', { p_room_id: room.id })
let st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })

const asientoBot = (s) => st.seats[s].is_bot
check('el estado de la mesa marca los bots', st.seats.filter((s) => s.is_bot).length === 2)
check('los bots aparecen conectados en la mesa',
  st.seats.filter((s) => s.is_bot).every((s) => s.connected))
check('el turno nunca queda en un bot',
  st.hand.status !== 'active' || !asientoBot(st.hand.current_seat),
  `turno del asiento ${st.hand.current_seat}`)

// Si la salida le tocó a un bot, ya jugó: el tablero no está vacío.
const salioBot = [1, 3].includes(st.hand.starting_seat)
if (salioBot) {
  check('el bot que sale ya jugó sin que nadie lo llame', st.board.length > 0,
    `${st.board.length} fichas en mesa`)
}

const humanos = { 0: rafa, 2: chuo }
let jugadasHumanas = 0
let jugadasBot = 0
let guard = 0

while (st.hand.status === 'active' && guard++ < 100) {
  const seat = st.hand.current_seat
  const yo = humanos[seat]
  if (!yo) { check('el turno se quedó en un bot', false, `asiento ${seat}`); break }

  const suyo = await rpc(yo, 'get_game_state', { p_match_id: match.id })
  const opt = suyo.my_hand.find((t) => t.sides.length > 0)
  if (!opt) { check('el de turno tenía jugada', false); break }

  const antes = st.board.length
  await rpc(yo, 'play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
  jugadasHumanas++

  st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
  // Todo lo que creció el tablero por encima de mi propia ficha lo pusieron los bots.
  jugadasBot += Math.max(0, st.board.length - antes - 1)
}

check('la mano terminó', st.hand.status === 'finished', st.hand.end_type)
check('los humanos jugaron', jugadasHumanas > 0, `${jugadasHumanas} jugadas`)
check('los bots jugaron solos', jugadasBot > 0, `${jugadasBot} jugadas`)

head('Trampas')
// Las internas del bot no las puede llamar nadie desde REST. Si alguna se
// pudiera, un jugador podría mover ficha por otro (apply_play) o preguntarle al
// motor qué jugaría el rival (bot_elige). Ver la trampa 1 de AGENTS.md.
// Con los argumentos DE VERDAD: llamarlas mal daría "no existe esa función" y el
// check pasaría aunque estuvieran abiertas de par en par.
const internas = [
  ['apply_play', { p_hand_id: st.hand.id, p_seat: 0, p_player_id: rafa.id, p_tile: '6-6', p_side: 'r' }],
  ['bot_elige', { p_hand_id: st.hand.id, p_seat: 1 }],
  ['play_bots', { p_hand_id: st.hand.id }],
  ['puntas_tras', { p_tile: '6-5', p_side: 'r', p_left: 6, p_right: 5 }],
]
for (const [fn, args] of internas) {
  const { error } = await chuo.sb.rpc(fn, args)
  check(`${fn} no es llamable`, /permission denied/i.test(error?.message ?? ''),
    error?.message?.slice(0, 70) ?? 'SIN ERROR: está abierta')
}

head('El tablero quedó coherente')
const tablero = st.board
let encadena = true
for (let i = 1; i < tablero.length; i++) {
  if (tablero[i - 1].b !== tablero[i].a) encadena = false
}
check('la cadena encaja punta con punta', encadena, `${tablero.length} fichas`)
check('28 fichas contabilizadas',
  tablero.length + st.revealed.length === 28, `${tablero.length} + ${st.revealed.length}`)

head('Memoria de los pases')
const { data: pases } = await rafa.sb
  .from('hand_moves')
  .select('seat, move_type, left_end, right_end')
  .eq('hand_id', st.hand.id)
  .eq('move_type', 'pass')
check('los pases guardan las puntas del momento',
  pases === null || pases.length === 0 || pases.every((p) => p.left_end !== null && p.right_end !== null),
  `${pases?.length ?? 0} pases`)

console.log(`\n${failures === 0 ? 'TODO EN ORDEN' : failures + ' FALLO(S)'}`)
console.log('sala ' + room.code)
process.exit(failures === 0 ? 0 : 1)
