/**
 * Bots desde la pantalla: rellenar la mesa, quitarlos, y que jueguen solos sin
 * que la mesa los dé por desconectados.
 *
 * Ese último punto es el que importa: un bot no late ni se suscribe al canal,
 * así que sin las excepciones de la etapa 7 la mesa lo pintaría "sin señal" y
 * le ofrecería al anfitrión anular la mano por culpa de alguien que está bien.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-bots.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()
const app = await bootApp({ as: 'Rafa' })
const { doc, text, until, byText, click, type, wait, window } = app

/**
 * Pulsa un botón cuando de verdad se pueda. Mientras una acción está en vuelo
 * la pantalla deshabilita los botones, y un clic sobre un botón deshabilitado
 * no hace nada ni avisa: el test se queda esperando algo que nunca pasa.
 */
async function pulsar(re, etiqueta = String(re)) {
  const listo = await until(`el botón ${etiqueta}`, () => {
    const b = byText('button', re)
    return !!b && !b.disabled
  })
  if (!listo) return false
  click(byText('button', re))
  return true
}

await until('inicio', () => /Sala de juego/.test(text()))
type(doc.querySelector('#nombre'), 'Rafa')
await wait(150)
click(byText('button', /Crear sala/))
await until('lobby', () => /Mesa · parejas cruzadas/.test(text()))
const code = window.location.pathname.split('/').pop()

r.head(`Sala ${code}: entra un pana y faltan dos`)
const chuo = await makePlayer('Chuo')
const { data: sala } = await chuo.sb.rpc('join_room', { p_code: code })
await chuo.sb.rpc('take_seat', { p_room_id: sala.id, p_seat: 2 })
r.check('la mesa va por 2/4', await until('2/4', () => /2\/4/.test(text())))

r.head('Rellenar con bots')
const rellenar = await until('el botón de rellenar', () => !!byText('button', /Rellenar con/))
r.check('el anfitrión ve el botón de rellenar', rellenar,
  byText('button', /Rellenar con/)?.textContent ?? '')

r.check('se puede pulsar rellenar', await pulsar(/Rellenar con/, 'rellenar'))
r.check('la mesa se llena', await until('4/4', () => /4\/4/.test(text())))
r.check('los asientos de bot se marcan como tales',
  (text().match(/bot/gi) ?? []).length >= 2)
r.check('ya no ofrece rellenar', !byText('button', /Rellenar con/))
r.check('ahora sí se puede arrancar', !!byText('button', /^Iniciar partida$/))

r.head('Se puede quitar uno')
// Mientras la acción anterior está en vuelo los asientos quedan deshabilitados;
// hay que esperar a que vuelvan, o el clic se pierde en silencio.
const botQuitable = () => [...doc.querySelectorAll('button[class*="seat"]')]
  .find((b) => /bot · quitar/i.test(b.textContent ?? '') && !b.disabled)
r.check('el asiento del bot invita a quitarlo', await until('un bot quitable', () => !!botQuitable()))
const asientoBot = botQuitable()
if (asientoBot) {
  click(asientoBot)
  const bajo = await until('3/4', () => /3\/4/.test(text()))
  r.check('al quitarlo la mesa baja a 3/4', bajo,
    bajo ? '' : (doc.querySelector('[class*="error"]')?.textContent ?? 'sin error en pantalla'))
  const otraVez = await until('el botón otra vez', () => !!byText('button', /Rellenar con un bot/))
  r.check('vuelve a ofrecer rellenar', otraVez)
  if (otraVez) {
    await pulsar(/Rellenar con un bot/, 'rellenar otra vez')
    r.check('se vuelve a llenar', await until('4/4 otra vez', () => /4\/4/.test(text())))
  }
}

r.head('Los bots juegan solos')
r.check('se puede arrancar la partida', await pulsar(/^Iniciar partida$/, 'iniciar'))
r.check('Rafa entra a la mesa', await until('la mesa', () => /Mesa limpia|Puntas/.test(text())))
r.check('los rivales bot se ven marcados', /· bot/.test(text()))

const matchId = (await chuo.sb.rpc('get_room_state', { p_room_id: sala.id })).data.current_match_id
const leer = async () => (await chuo.sb.rpc('get_game_state', { p_match_id: matchId })).data
let st = await leer()

r.check('el estado marca dos bots sentados', st.seats.filter((x) => x.is_bot).length === 2)
r.check('el turno no se queda en un bot', !st.seats[st.hand.current_seat].is_bot,
  `asiento ${st.hand.current_seat}`)

let misJugadas = 0
let deLosBots = 0
let guard = 0
while (st.hand.status === 'active' && guard++ < 60 && misJugadas < 4) {
  const seat = st.hand.current_seat
  if (seat === 0) {
    if (!(await until('mi turno', () => /Tu turno/.test(text()), 10000))) break
    const jugables = [...doc.querySelectorAll('button[class*="tile"]')].filter((b) => !b.disabled)
    if (jugables.length === 0) break
    const antes = st.board.length
    click(jugables[0])
    await wait(150)
    const punta = byText('button', /^Punta \d ▶$/)
    if (punta) click(punta)
    await until('la jugada', async () => {
      st = await leer()
      return st.board.length > antes || st.hand.status === 'finished'
    }, 10000)
    misJugadas++
    // Lo que creció por encima de mi ficha lo pusieron los bots (y Chuo no juega).
    deLosBots += Math.max(0, st.board.length - antes - 1)
  } else if (seat === 2) {
    const suyo = (await chuo.sb.rpc('get_game_state', { p_match_id: matchId })).data
    const opt = suyo.my_hand.find((t) => t.sides.length > 0)
    if (!opt) break
    await chuo.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
    st = await leer()
  } else {
    r.check('el turno se quedó parado en un bot', false, `asiento ${seat}`)
    break
  }
}

r.check('los bots jugaron sin que nadie los llame', deLosBots > 0, `${deLosBots} fichas suyas`)

// Chuo sí aparece sin señal, y está bien: en la prueba juega por RPC, no late
// ni se suscribe al canal. Lo que se comprueba aquí es que a los BOTS no les
// pase lo mismo, que es lo que rompería la mesa.
// OJO: [class*="rival"] casa también con el contenedor .rivals, que lleva
// dentro los tres chips. El contenedor es el único cuya clase dice "rivals".
const chipsBot = [...(doc.querySelector('div[class*="rivals"]')?.children ?? [])]
  .filter((c) => /· bot/.test(c.textContent ?? ''))
r.check('los dos bots están en la mesa', chipsBot.length === 2, `${chipsBot.length} chips`)
r.check('ningún bot aparece sin señal',
  chipsBot.every((c) => !/sin señal/i.test(c.textContent ?? '')),
  chipsBot.map((c) => c.textContent).join(' | '))
r.check('a los bots se les ven las fichas que les quedan',
  chipsBot.every((c) => /\d+ fichas/.test(c.textContent ?? '')))
r.check('nunca ofrece anular la mano', !byText('button', /Anular la mano/))
r.check('la mesa sigue viva', /Puntas|Tu turno|Juega/.test(text()))

saveBrowserSession(window, 'Rafa')
window.close()
r.done('sala de prueba: ' + code)
