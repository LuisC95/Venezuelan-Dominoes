/**
 * Etapa 7: reconexión.
 *
 * Dos mitades, que se ven desde sitios distintos:
 *   a) se cae MI conexión  → overlay "Reconectando", y se va al volver la señal.
 *   b) se cae la del de TURNO → aviso de espera, cuenta atrás, y el anfitrión
 *      anula la mano al minuto.
 *
 * Los tres jugadores por RPC no laten nunca (nadie llama `heartbeat` por ellos)
 * ni se suscriben al canal, así que hacen de desconectados de verdad: Presence
 * no los ve al instante y su `last_seen_at` envejece solo. Eso permite medir si
 * el aviso llega por Presence (segundos) o por el servidor (30s).
 *
 * Tarda ~80s a propósito: espera el umbral real de `void_hand`.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-reconexion.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()
/** El mismo umbral que la app y que void_hand. */
const UMBRAL_S = 60

const app = await bootApp({ as: 'Rafa' })
const { doc, text, until, byText, click, type, wait, window } = app

const desconectar = () => {
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
  window.dispatchEvent(new window.Event('offline'))
}
const reconectar = () => {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  window.dispatchEvent(new window.Event('online'))
}

await until('inicio', () => /Sala de juego/.test(text()))
type(doc.querySelector('#nombre'), 'Rafa')
await wait(150)
click(byText('button', /Crear sala/))
await until('lobby', () => /Mesa · parejas cruzadas/.test(text()))
const code = window.location.pathname.split('/').pop()

r.head(`Sala ${code}: se sientan los cuatro`)
const otros = []
for (const [i, n] of ['Chuo', 'Marielba', 'Kike'].entries()) {
  const p = await makePlayer(n)
  const { data: room } = await p.sb.rpc('join_room', { p_code: code })
  await p.sb.rpc('take_seat', { p_room_id: room.id, p_seat: i + 1 })
  otros.push({ ...p, roomId: room.id })
}
const roomId = otros[0].roomId
r.check('la mesa se llenó', await until('4/4', () => /4\/4/.test(text())))

click(byText('button', /^Iniciar partida$/))
r.check('Rafa entra a la mesa', await until('la mesa', () => /Mesa limpia|Puntas/.test(text())))

const matchId = (await otros[0].sb.rpc('get_room_state', { p_room_id: roomId })).data.current_match_id
const leer = async () => (await otros[0].sb.rpc('get_game_state', { p_match_id: matchId })).data

// --- a) se cae mi propia conexión ----------------------------------------
r.head('Se cae mi conexión')
desconectar()
r.check('aparece el overlay "Reconectando"',
  await until('el overlay', () => /Reconectando/.test(text()), 8000))
r.check('explica que la mano queda guardada', /Tu mano y el turno quedan guardados/.test(text()))
r.check('ofrece reintentar', !!byText('button', /Reintentar ahora/))

reconectar()
r.check('al volver la señal el overlay se va',
  await until('el overlay fuera', () => !/Reconectando/.test(text()), 10000))
r.check('la mesa vuelve a estar a la vista', /Mesa limpia|Puntas/.test(text()))

// --- b) se cae la del de turno -------------------------------------------
r.head('Se cae la conexión del de turno')
// Si sale Rafa, juega para que el turno pase a alguien que no está latiendo.
let st = await leer()
let empujones = 0
while (st.hand.current_seat === 0 && empujones++ < 4) {
  await until('el turno propio', () => /Tu turno/.test(text()), 10000)
  const jugables = [...doc.querySelectorAll('button[class*="tile"]')].filter((b) => !b.disabled)
  if (jugables.length === 0) break
  const antes = st.board.length
  click(jugables[0])
  await wait(150)
  const punta = byText('button', /^Punta \d ▶$/)
  if (punta) click(punta)
  await until('la jugada', async () => {
    st = await leer()
    return st.board.length > antes
  }, 10000)
}
r.check('el turno está en alguien que no tiene señal', st.hand.current_seat !== 0,
  `asiento ${st.hand.current_seat}`)

const enTurno = st.seats[st.hand.current_seat]
const desde = Date.now()
const avisó = await until('el aviso de espera', () => /Sin señal/.test(text()), 15000)
const tardó = Math.round((Date.now() - desde) / 1000)
r.check('avisa que el de turno no tiene señal', avisó, `${tardó}s`)
// El servidor tarda 30s en marcarlo caído; si el aviso llegó antes, fue Presence.
r.check('el aviso llega por Presence, sin esperar los 30s del servidor', tardó < 25, `${tardó}s`)
r.check('nombra a quién se espera', text().includes(enTurno.display_name), enTurno.display_name)
r.check('el anfitrión ve cuánto falta para poder anular',
  /Podrás anular la mano en \d+ s/.test(text()))
r.check('todavía no ofrece anular', !byText('button', /Anular la mano/))

r.head('Se puede mirar el tablero mientras se espera')
click(byText('button', /Ver la mesa/))
r.check('el overlay se aparta', await until('el tablero', () => !/Reconectando/.test(text())
  && !/nadie juega por otro/.test(text()), 5000))
r.check('queda el aviso compacto con la cuenta', /Sin señal ·/.test(text()))
r.check('se puede volver al aviso', !!byText('button', /Ver aviso/))
click(byText('button', /Ver aviso/))
r.check('el overlay vuelve', await until('el overlay', () => /nadie juega por otro/.test(text()), 5000))

r.head(`Al minuto, el anfitrión anula la mano`)
// Nada de esperar el umbral por nuestra cuenta: se pulsa EN CUANTO la app
// ofrece el botón. Si la cuenta de la pantalla se adelantara al reloj del
// servidor —el bug del desfase—, void_hand respondería "el jugador de turno
// sigue conectado" y esto fallaría aquí mismo.
const desdeAviso = Date.now()
const puede = await until('el botón de anular', () => !!byText('button', /Anular la mano/), (UMBRAL_S + 30) * 1000)
r.check('aparece el botón de anular al pasar el umbral', puede,
  `${Math.round((Date.now() - desdeAviso) / 1000)}s`)
r.check('la cuenta en pantalla pasó de 60', /\b(6[0-9]|[7-9][0-9]|\d{3})\b/.test(text()))

if (puede) {
  const handId = st.hand.id
  click(byText('button', /Anular la mano/))
  const anulada = await until('la mano anulada', async () => {
    const s2 = await leer()
    return s2.hand.id === handId && s2.hand.status === 'finished'
  }, 20000)
  r.check('el servidor acepta la anulación en cuanto la UI la ofrece', anulada,
    doc.querySelector('[class*="error"]')?.textContent ?? '')

  st = await leer()
  r.check('el cierre es "anulada"', st.hand.end_type === 'anulada', st.hand.end_type)
  r.check('no reparte puntos', st.hand.points_awarded === 0 && st.hand.winner_team_id === null)
  r.check('marcador intacto', st.match.score_a === 0 && st.match.score_b === 0)
  r.check('la pantalla de fin de mano lo explica',
    await until('el fin de mano', () => /Se reparte de nuevo/.test(text()), 10000))
  r.check('ofrece repartir otra vez', !!byText('button', /Siguiente mano/))
}

saveBrowserSession(window, 'Rafa')
window.close()
r.done('sala de prueba: ' + code)
