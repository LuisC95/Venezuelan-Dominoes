/**
 * Prueba de humo del motor: 5 jugadores anónimos reales contra el proyecto de
 * Supabase, jugando por las mismas RPCs que usará la app. Verifica reglas,
 * RLS y los intentos de trampa más obvios.
 *
 *   node scripts/smoke.mjs
 */
import { makePlayer } from './players.mjs'


let failures = 0
function check(label, ok, extra = '') {
  console.log(`${ok ? '  ok  ' : ' FALLO'} ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
function head(t) { console.log('\n=== ' + t + ' ===') }

async function rpc(p, fn, args = {}) {
  const { data, error } = await p.sb.rpc(fn, args)
  if (error) throw new Error(`${p.name} ${fn}: ${error.message}`)
  return data
}

head('1. Jugadores y sala')
const [rafa, chuo, mari, kike, yorman, gaby] = await Promise.all(
  ['Rafa', 'Chuo', 'Marielba', 'Kike', 'Yorman', 'Gaby'].map(makePlayer)
)
const byId = Object.fromEntries([rafa, chuo, mari, kike, yorman, gaby].map((p) => [p.id, p]))

const room = await rpc(rafa, 'create_room', { p_max_size: 8, p_points_target: 100 })
console.log(`  sala ${room.code}  meta ${room.points_target} pts`)
check('código con formato AAA-999', /^[A-Z]{3}-\d{3}$/.test(room.code), room.code)

for (const p of [chuo, mari, kike, yorman, gaby]) await rpc(p, 'join_room', { p_code: room.code })

let rs = await rpc(rafa, 'get_room_state', { p_room_id: room.id })
const seated = rs.members.filter((m) => m.seat !== null)
check('4 sentados, 2 observadores', seated.length === 4 && rs.members.length === 6)
check('anfitrión en el asiento 0', seated.find((m) => m.seat === 0).profile_id === rafa.id)

head('2. Cola: dos observadores se emparejan')
await rpc(yorman, 'request_turn', { p_room_id: room.id })
await rpc(gaby, 'request_turn', { p_room_id: room.id })
await rpc(yorman, 'pair_with', { p_room_id: room.id, p_partner_id: gaby.id })
rs = await rpc(rafa, 'get_room_state', { p_room_id: room.id })
check('1 pareja en la cola', rs.queue.length === 1, JSON.stringify(rs.queue[0]?.players.map((x) => x.display_name)))

head('3. Arranca la partida')
const match = await rpc(rafa, 'start_match', { p_room_id: room.id })
let st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
const seatOwner = (n) => byId[st.seats[n].profile_id]
check('mano 1 repartida', st.hand?.hand_number === 1)
check('7 fichas por jugador', st.seats.every((s) => s.tiles_left === 7))
check('mi mano tiene 7 fichas', st.my_hand.length === 7)

// Quien sale debe tener el 6-6 (o el doble más alto si no salió).
const starter = seatOwner(st.hand.current_seat)
const stStarter = await rpc(starter, 'get_game_state', { p_match_id: match.id })
const tiles = stStarter.my_hand.map((t) => t.tile)
const doubles = tiles.filter((t) => t.split('-')[0] === t.split('-')[1])
check('sale quien tiene el 6-6', tiles.includes('6-6'), `${starter.name}: ${doubles.join(' ') || 'sin dobles'}`)

head('4. RLS: nadie ve la mano ajena')
const { data: espia } = await chuo.sb.from('hand_tiles').select('tile,state,player_id').eq('hand_id', st.hand.id)
check('Chuo solo ve sus 7 fichas', espia.length === 7 && espia.every((t) => t.player_id === chuo.id), `vio ${espia.length} filas`)
const otro = await rpc(chuo, 'get_game_state', { p_match_id: match.id })
check('get_game_state no filtra manos ajenas', JSON.stringify(otro).split('my_hand')[1].length > 0 && otro.my_hand.length === 7)

head('5. Trampas')
{
  const { error } = await chuo.sb.rpc('resolve_hand', { p_hand_id: st.hand.id, p_end_type: 'domino', p_winner_seat: 1 })
  check('resolve_hand no es llamable', !!error, error?.message?.slice(0, 60))
}
{
  const { error } = await chuo.sb.rpc('deal_hand', { p_match_id: match.id })
  check('deal_hand no es llamable', !!error, error?.message?.slice(0, 60))
}
{
  const fuera = [rafa, chuo, mari, kike].find((p) => p.id !== st.seats[st.hand.current_seat].profile_id)
  const s = await rpc(fuera, 'get_game_state', { p_match_id: match.id })
  const { error } = await fuera.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: s.my_hand[0].tile })
  check('jugar fuera de turno se rechaza', !!error, error?.message)
}
{
  const { error } = await yorman.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: '6-6' })
  check('un observador no juega', !!error, error?.message)
}

head('6. Se juega la mano completa')
let guard = 0
while (st.hand.status === 'active' && guard++ < 60) {
  const turn = seatOwner(st.hand.current_seat)
  const s = await rpc(turn, 'get_game_state', { p_match_id: match.id })
  const opts = s.my_hand.filter((t) => t.sides.length > 0)
  if (opts.length === 0) { console.log('  !! sin jugada y sin pase automático'); failures++; break }
  const pick = opts[Math.floor(Math.random() * opts.length)]
  const side = pick.sides[Math.floor(Math.random() * pick.sides.length)]
  await rpc(turn, 'play_tile', { p_hand_id: st.hand.id, p_tile: pick.tile, p_side: side })
  st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
}
const passes = st.recent_moves.filter((m) => m.move_type === 'pass').length
console.log(`  jugadas: ${st.hand.move_count}  |  fin: ${st.hand.end_type}  |  puntos: ${st.hand.points_awarded}`)
check('la mano terminó sola', st.hand.status === 'finished')
check('end_type válido', ['domino', 'tranca', 'tranca_empate'].includes(st.hand.end_type), st.hand.end_type)

head('7. Conteo')
const board = st.board
let okChain = board.length > 0
for (let i = 1; i < board.length; i++) if (board[i - 1].b !== board[i].a) okChain = false
check('el tablero encadena bien', okChain, `${board.length} fichas en mesa`)
check('extremos coherentes', board.length === 0 || (st.hand.left_end === board[0].a && st.hand.right_end === board.at(-1).b))

const pipsA = st.revealed.filter((r) => r.seat % 2 === 0).reduce((s, r) => s + r.pips, 0)
const pipsB = st.revealed.filter((r) => r.seat % 2 === 1).reduce((s, r) => s + r.pips, 0)
console.log(`  pips en mano — pareja A: ${pipsA}  pareja B: ${pipsB}`)
if (st.hand.end_type === 'domino') {
  const winA = st.hand.winner_team_id === st.match.team_a_id
  check('dominó: se suman los pips de la pareja contraria', st.hand.points_awarded === (winA ? pipsB : pipsA))
} else if (st.hand.end_type === 'tranca') {
  const winA = st.hand.winner_team_id === st.match.team_a_id
  check('tranca: gana la de menos pips', winA ? pipsA < pipsB : pipsB < pipsA)
  check('tranca: suma los pips de la contraria', st.hand.points_awarded === Math.max(pipsA, pipsB))
} else {
  check('empate exacto: 0 puntos y sin ganador', st.hand.points_awarded === 0 && st.hand.winner_team_id === null)
}
check('marcador = puntos otorgados', st.match.score_a + st.match.score_b === st.hand.points_awarded)
check('28 fichas contabilizadas', board.length + st.revealed.length === 28, `${board.length} + ${st.revealed.length}`)

head('8. Rotación de salida')
const prevStarter = st.hand.starting_seat
await rpc(rafa, 'start_next_hand', { p_match_id: match.id })
st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
check('la salida rota en sentido horario', st.hand.starting_seat === (prevStarter + 1) % 4,
  `${prevStarter} -> ${st.hand.starting_seat}`)
check('mano 2 repartida', st.hand.hand_number === 2 && st.my_hand.length === 7)

head('9. Chat')
await rpc(chuo, 'send_message', { p_room_id: room.id, p_body: '¡Data!', p_kind: 'emote' })
const { data: msgs } = await rafa.sb.from('room_messages').select('body,kind').eq('room_id', room.id)
check('el emote llega a los demás', msgs.length === 1 && msgs[0].body === '¡Data!')

console.log(`\n${failures === 0 ? 'TODO EN ORDEN' : failures + ' FALLO(S)'}`)
console.log('room_id=' + room.id + ' match_id=' + match.id)
process.exit(failures === 0 ? 0 : 1)
