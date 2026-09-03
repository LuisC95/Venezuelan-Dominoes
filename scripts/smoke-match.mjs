/**
 * Partida completa a 100 puntos + rey de la cancha.
 * Juega solo (elige jugadas legales al azar) y verifica el ciclo entero.
 *
 *   node scripts/smoke-match.mjs
 */
import { makePlayer } from './players.mjs'


let failures = 0
const check = (l, ok, x = '') => { console.log(`${ok ? '  ok  ' : ' FALLO'} ${l}${x ? '  ' + x : ''}`); if (!ok) failures++ }
const head = (t) => console.log('\n=== ' + t + ' ===')

async function rpc(p, fn, args = {}) {
  const { data, error } = await p.sb.rpc(fn, args)
  if (error) throw new Error(`${p.name} ${fn}: ${error.message}`)
  return data
}

const names = ['Rafa', 'Chuo', 'Marielba', 'Kike', 'Yorman', 'Gaby']
const ps = await Promise.all(names.map(makePlayer))
const [rafa, , , , yorman, gaby] = ps
const byId = Object.fromEntries(ps.map((p) => [p.id, p]))

const room = await rpc(rafa, 'create_room', { p_max_size: 8, p_points_target: 100 })
for (const p of ps.slice(1)) await rpc(p, 'join_room', { p_code: room.code })
await rpc(yorman, 'request_turn', { p_room_id: room.id })
await rpc(gaby, 'request_turn', { p_room_id: room.id })
await rpc(yorman, 'pair_with', { p_room_id: room.id, p_partner_id: gaby.id })
console.log(`sala ${room.code} — 4 en mesa, Yorman & Gaby en la cola`)

async function jugarPartida(matchId, etiqueta) {
  head(etiqueta)
  let st = await rpc(rafa, 'get_game_state', { p_match_id: matchId })
  const tally = { domino: 0, tranca: 0, tranca_empate: 0, pases: 0, capicua: 0, manos: 0 }
  let guard = 0

  while (st.match.status === 'active' && guard++ < 2000) {
    if (st.hand.status === 'finished') {
      await rpc(rafa, 'start_next_hand', { p_match_id: matchId })
      st = await rpc(rafa, 'get_game_state', { p_match_id: matchId })
      continue
    }
    const turn = byId[st.seats[st.hand.current_seat].profile_id]
    const s = await rpc(turn, 'get_game_state', { p_match_id: matchId })
    const opts = s.my_hand.filter((t) => t.sides.length > 0)
    if (!opts.length) { check('había jugada legal para el de turno', false); break }
    const pick = opts[Math.floor(Math.random() * opts.length)]
    await rpc(turn, 'play_tile', {
      p_hand_id: st.hand.id, p_tile: pick.tile,
      p_side: pick.sides[Math.floor(Math.random() * pick.sides.length)],
    })
    const prev = st.hand.id
    st = await rpc(rafa, 'get_game_state', { p_match_id: matchId })

    if (st.hand.id === prev && st.hand.status === 'finished') {
      tally.manos++
      tally[st.hand.end_type]++
      if (st.hand.was_capicua) tally.capicua++
      const total = st.board.length + st.revealed.length
      if (total !== 28) check(`mano ${st.hand.hand_number}: 28 fichas contabilizadas`, false, String(total))
      console.log(`  mano ${st.hand.hand_number}: ${st.hand.end_type}${st.hand.was_capicua ? ' (capicúa)' : ''} ` +
                  `+${st.hand.points_awarded}  →  ${st.match.score_a}–${st.match.score_b}`)
    }
  }

  const { data: moves } = await rafa.sb.from('hand_moves').select('move_type').eq('move_type', 'pass')
  tally.pases = moves?.length ?? 0
  return { st, tally }
}

const m1 = await rpc(rafa, 'start_match', { p_room_id: room.id })
const { st, tally } = await jugarPartida(m1.id, 'Partida 1')

check('la partida terminó', st.match.status === 'finished')
check('alguien llegó a 100', Math.max(st.match.score_a, st.match.score_b) >= 100,
  `${st.match.score_a}–${st.match.score_b}`)
check('el ganador es el de más puntos', st.match.winner_team_id ===
  (st.match.score_a > st.match.score_b ? st.match.team_a_id : st.match.team_b_id))
check('hubo pases automáticos registrados', tally.pases > 0, `${tally.pases} pases`)
console.log(`  manos: ${tally.manos}  dominós: ${tally.domino}  trancas: ${tally.tranca}  empates: ${tally.tranca_empate}`)

head('Rey de la cancha')
const perdedoraEraA = st.match.winner_team_id !== st.match.team_a_id
const asientosSalientes = perdedoraEraA ? [0, 2] : [1, 3]
const salieron = asientosSalientes.map((i) => st.seats[i].profile_id)

const m2 = await rpc(rafa, 'next_match', { p_room_id: room.id })
const st2 = await rpc(rafa, 'get_game_state', { p_match_id: m2.id })
const rs = await rpc(rafa, 'get_room_state', { p_room_id: room.id })
const enMesa = st2.seats.map((s) => s.profile_id)

const asientosGanadores = perdedoraEraA ? [1, 3] : [0, 2]
const sequedaron = asientosGanadores.map((i) => st.seats[i].profile_id)
check('la pareja ganadora se queda', sequedaron.every((id) => enMesa.includes(id)),
  sequedaron.map((id) => byId[id].name).join(' y '))
check('la pareja perdedora sale', salieron.every((id) => !enMesa.includes(id)),
  salieron.map((id) => byId[id].name).join(' y '))
check('entra la pareja de la cola', [yorman.id, gaby.id].every((id) => enMesa.includes(id)))
check('la perdedora queda al final de la cola',
  rs.queue.length === 1 && rs.queue[0].players.every((p) => salieron.includes(p.profile_id)),
  rs.queue[0]?.players.map((p) => p.display_name).join(' y '))
check('marcador nuevo en 0', st2.match.score_a === 0 && st2.match.score_b === 0)
check('mano 1 de la partida nueva repartida', st2.hand.hand_number === 1)

head('Estadísticas')
const hist = await rpc(rafa, 'get_profile_history', {})
console.log('  Rafa:', JSON.stringify(hist.stats))
check('se contó la partida jugada', hist.stats.matches_played === 1)
check('se contaron manos ganadas', hist.stats.hands_won >= 1)
check('aparece en el historial', hist.matches.length === 1, hist.matches[0]?.score)
check('sabe con quién jugó', !!hist.top_partner, hist.top_partner?.display_name)

console.log(`\n${failures === 0 ? 'TODO EN ORDEN' : failures + ' FALLO(S)'}`)
process.exit(failures === 0 ? 0 : 1)
