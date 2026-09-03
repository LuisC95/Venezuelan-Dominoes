/**
 * Etapa 10: historial y estadísticas.
 *
 * Cuatro jugadores terminan una partida por RPC —a 20 puntos, el mínimo que
 * acepta el esquema, para que no tarde minutos— y Rafa mira el resultado desde
 * el navegador. Lo que se comprueba no son números inventados sino que la
 * pantalla dice lo mismo que el servidor.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-perfil.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()

async function rpc(p, fn, args = {}) {
  const { data, error } = await p.sb.rpc(fn, args)
  if (error) throw new Error(`${p.name} ${fn}: ${error.message}`)
  return data
}

// --- una partida entera, por RPC ------------------------------------------
r.head('Cuatro juegan una partida completa')
const jugadores = await Promise.all(['Chuo', 'Marielba', 'Kike', 'Yorman'].map(makePlayer))
const [chuo] = jugadores
const porId = Object.fromEntries(jugadores.map((p) => [p.id, p]))

const room = await rpc(chuo, 'create_room', { p_max_size: 8, p_points_target: 20 })
for (const [i, p] of jugadores.slice(1).entries()) {
  await rpc(p, 'join_room', { p_code: room.code })
  await rpc(p, 'take_seat', { p_room_id: room.id, p_seat: i + 1 })
}
const match = await rpc(chuo, 'start_match', { p_room_id: room.id })

let st = await rpc(chuo, 'get_game_state', { p_match_id: match.id })
let guard = 0
while (st.match.status === 'active' && guard++ < 2000) {
  if (st.hand.status === 'finished') {
    await rpc(chuo, 'start_next_hand', { p_match_id: match.id })
    st = await rpc(chuo, 'get_game_state', { p_match_id: match.id })
    continue
  }
  const turno = porId[st.seats[st.hand.current_seat].profile_id]
  const suyo = await rpc(turno, 'get_game_state', { p_match_id: match.id })
  const opcion = suyo.my_hand.find((t) => t.sides.length > 0)
  if (!opcion) break
  await rpc(turno, 'play_tile', {
    p_hand_id: st.hand.id, p_tile: opcion.tile, p_side: opcion.sides[0],
  })
  st = await rpc(chuo, 'get_game_state', { p_match_id: match.id })
}
r.check('la partida terminó', st.match.status === 'finished', `${st.match.score_a} — ${st.match.score_b}`)

// Lo que el servidor dice de Chuo: es contra esto que se compara la pantalla.
const suyo = await rpc(chuo, 'get_profile_history', { p_profile_id: chuo.id, p_limit: 12 })
const ultima = suyo.matches[0]
r.check('el servidor ya tiene la partida en el historial', ultima?.room_code === room.code,
  `${ultima?.room_code} ${ultima?.score}`)

// --- la pantalla ----------------------------------------------------------
const app = await bootApp({ as: 'Rafa' })
const { doc, text, until, byText, click, type, wait, window } = app

r.head('Se llega al historial desde el avatar del inicio')
await until('inicio', () => /Sala de juego/.test(text()))
type(doc.querySelector('#nombre'), 'Rafa')
await wait(150)
// El avatar solo es un enlace cuando ya hay perfil guardado.
const avatar = doc.querySelector('button[class*="avatar"]')
r.check('el avatar del inicio lleva al historial', !!avatar)
if (avatar) {
  click(avatar)
  // "Historial" es el título de la cabecera y se pinta antes de que lleguen los
  // datos: hay que esperar a algo que solo exista con la respuesta cargada.
  r.check('abre la pantalla de historial',
    await until('el historial cargado', () => /Trancas ganadas/.test(text())))
  r.check('la URL es /perfil', window.location.pathname === '/perfil', window.location.pathname)
  r.check('muestra las cuatro estadísticas',
    /Partidas/.test(text()) && /Ganadas/.test(text())
    && /Manos ganadas/.test(text()) && /Trancas ganadas/.test(text()))
  r.check('muestra el nombre propio', /Rafa/.test(text()))
}

r.head('El historial de otro jugador')
window.history.pushState({}, '', `/perfil/${chuo.id}`)
window.dispatchEvent(new window.PopStateEvent('popstate'))
r.check('carga el perfil pedido por id',
  await until('el perfil de Chuo', () => /Chuo/.test(text()) && /Historial/.test(text())))

r.check('las partidas jugadas cuadran con el servidor',
  text().includes(String(suyo.stats.matches_played)), `${suyo.stats.matches_played} partidas`)
r.check('la partida recién jugada aparece en la lista',
  await until('la sala en la lista', () => text().includes(room.code)), room.code)
r.check('con su marcador', text().includes(ultima.score), ultima.score)
r.check('y diciendo si se ganó o se perdió',
  new RegExp(ultima.won ? 'Ganó' : 'Perdió').test(text()), ultima.won ? 'ganó' : 'perdió')
r.check('nombra a la pareja de esa partida',
  ultima.partner === null || text().includes(ultima.partner), ultima.partner ?? 'sin pareja')

r.head('La pareja frecuente')
const socio = suyo.top_partner
r.check('el servidor devuelve con quién más juega', !!socio, socio?.display_name)
if (socio) {
  const etiqueta = socio.is_frequent_pair ? 'Pareja frecuente' : 'Con quien más juegas'
  r.check(`la etiqueta corresponde al flag del servidor (${etiqueta})`, text().includes(etiqueta))
  const pct = Math.round((socio.won / socio.matches) * 100)
  r.check('muestra el porcentaje de partidas ganadas juntos',
    text().includes(`${pct}% ganadas`), `${pct}%`)

  const tarjeta = byText('button', new RegExp(`${socio.display_name} · \\d+% ganadas`))
  r.check('la tarjeta es tocable', !!tarjeta)
  if (tarjeta) {
    click(tarjeta)
    r.check('lleva al historial de esa pareja',
      await until('el perfil del socio', () => window.location.pathname === `/perfil/${socio.profile_id}`),
      window.location.pathname)
    r.check('y carga sus datos',
      await until('el nombre del socio', () => text().includes(socio.display_name)))
  }
}

r.head('Vuelta al inicio')
click(byText('button', /← Inicio/))
r.check('el botón de volver lleva al inicio',
  await until('el inicio', () => /Sala de juego/.test(text()) && window.location.pathname === '/'))

saveBrowserSession(window, 'Rafa')
window.close()
r.done('sala de prueba: ' + room.code)
