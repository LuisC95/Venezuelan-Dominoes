/**
 * Mano trancada por desconexión: el anfitrión la anula pasados 60s.
 * Tarda ~80 segundos a propósito (espera el umbral real, sin trampas).
 *
 *   node scripts/smoke-void.mjs
 */
import { makePlayer } from './players.mjs'

let failures = 0
const check = (l, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FALLO'} ${l}${x ? '  ' + x : ''}`); if (!ok) failures++ }

const rpc = async (p, fn, args = {}) => {
  const { data, error } = await p.sb.rpc(fn, args)
  if (error) throw new Error(`${p.name} ${fn}: ${error.message}`)
  return data
}

const ps = await Promise.all(['Rafa', 'Chuo', 'Marielba', 'Kike'].map(makePlayer))
const [rafa, ...resto] = ps
const room = await rpc(rafa, 'create_room', {})
for (const p of resto) await rpc(p, 'join_room', { p_code: room.code })
const match = await rpc(rafa, 'start_match', { p_room_id: room.id })
let st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
const starter = st.hand.starting_seat
console.log(`sala ${room.code} — mano 1, sale el asiento ${starter}`)

// Con todo el mundo recién conectado, anular debe estar prohibido.
{
  const { error } = await rafa.sb.rpc('void_hand', { p_hand_id: st.hand.id })
  check('no se anula con el jugador conectado', !!error, error?.message)
}
// Un jugador cualquiera tampoco puede anular, ni siquiera después.
{
  const { error } = await resto[0].sb.rpc('void_hand', { p_hand_id: st.hand.id })
  check('solo el anfitrión anula', !!error, error?.message)
}

console.log('  esperando 65s sin heartbeat (simula que se fue la señal)...')
await new Promise((r) => setTimeout(r, 65000))

const anulada = await rpc(rafa, 'void_hand', { p_hand_id: st.hand.id })
check('el anfitrión anula la mano trabada', anulada.end_type === 'anulada')
check('no reparte puntos', anulada.points_awarded === 0 && anulada.winner_team_id === null)

await rpc(rafa, 'start_next_hand', { p_match_id: match.id })
st = await rpc(rafa, 'get_game_state', { p_match_id: match.id })
check('tras anular sale el mismo (la mano no se jugó)', st.hand.starting_seat === starter,
  `${starter} -> ${st.hand.starting_seat}`)
check('marcador intacto', st.match.score_a === 0 && st.match.score_b === 0)

console.log(`\n${failures === 0 ? 'TODO EN ORDEN' : failures + ' FALLO(S)'}`)
process.exit(failures === 0 ? 0 : 1)
