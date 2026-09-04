/**
 * La mesa, jugada desde el navegador (jsdom) contra el Supabase real.
 * Rafa juega tocando fichas en la pantalla; los otros tres juegan por RPC,
 * así que también se verifica que la mesa se actualiza sola por Realtime.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-mesa.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()
const app = await bootApp({ as: 'Rafa' })
const { doc, text, until, byText, click, type, wait } = app

r.head('Sala lista')
await until('inicio', () => /Sala de juego/.test(text()))
type(doc.querySelector('#nombre'), 'Rafa')
await wait(150)
click(byText('button', /Crear sala/))
await until('lobby', () => /Mesa · parejas cruzadas/.test(text()))
const code = app.window.location.pathname.split('/').pop()

const otros = []
for (const n of ['Chuo', 'Marielba', 'Kike']) {
  const p = await makePlayer(n)
  const { data: room } = await p.sb.rpc('join_room', { p_code: code })
  otros.push({ ...p, roomId: room.id })
}
await until('mesa llena', () => /4\/4/.test(text()))
r.check('la sala se llenó en pantalla', /4\/4/.test(text()), code)

r.head('Arranca la partida desde el botón')
click(byText('button', /^Iniciar partida$/))
const enMesa = await until('la mesa', () => /Mesa limpia|Puntas/.test(text()))
r.check('el anfitrión pasa solo a la mesa', enMesa)
r.check('la URL es /sala/CODIGO/mesa', /\/mesa$/.test(app.window.location.pathname), app.window.location.pathname)
r.check('el tablero arranca vacío', /Mesa limpia/.test(text()))
r.check('marcador en 0 y mano 1', /Nosotros/.test(text()) && /Ellos/.test(text()))
r.check('tengo 7 fichas en la mano', doc.querySelectorAll('button[class*="tile"]').length === 7,
  String(doc.querySelectorAll('button[class*="tile"]').length))

// Un jugador de fuera lee el estado público para saber a quién le toca.
const espejo = otros[0]
const estado = async () => (await espejo.sb.rpc('get_game_state', { p_match_id: (await espejo.sb.rpc('get_room_state', { p_room_id: espejo.roomId })).data.current_match_id })).data
let st = await estado()
const matchId = st.match.id
const leer = async () => (await espejo.sb.rpc('get_game_state', { p_match_id: matchId })).data

r.head('Se juega la mano (Rafa toca, los demás por RPC)')
let clicksDeRafa = 0
let vioTableroCrecer = false
let vioSelectorDePuntas = false
let guard = 0

while (st.hand.status === 'active' && guard++ < 200) {
  const seat = st.hand.current_seat

  if (seat === 0) {
    const antes = st.board.length
    // Esperar a que el navegador se entere de que es su turno, no solo el servidor.
    const meToca = await until('que la pantalla diga "Tu turno"', () => /Tu turno/.test(text()), 8000)
    if (!meToca) { r.check('la pantalla anuncia el turno propio', false); break }
    if (clicksDeRafa === 0) r.check('la pantalla anuncia el turno propio', true)

    const botones = [...doc.querySelectorAll('button[class*="tile"]')].filter((b) => !b.disabled)
    if (botones.length === 0) { r.check('hay fichas jugables resaltadas', false); break }
    if (clicksDeRafa === 0) r.check('solo se pueden tocar las fichas que calzan', botones.length <= 7)

    click(botones[0])
    await wait(150)
    // Si la ficha calzaba por las dos puntas, la app pregunta por cuál.
    const punta = byText('button', /^Punta \d ▶$/)
    if (punta) { vioSelectorDePuntas = true; click(punta) }

    let intento = 0
    while (intento++ < 40) {
      st = await leer()
      if (st.board.length > antes || st.hand.status === 'finished') break
      await wait(150)
    }
    if (clicksDeRafa === 0) {
      r.check('tocar una ficha la pone en la mesa', st.board.length > antes, `${antes} → ${st.board.length}`)
    }
    clicksDeRafa++
  } else {
    const p = otros[seat - 1]
    const s = (await p.sb.rpc('get_game_state', { p_match_id: matchId })).data
    const opt = s.my_hand.find((t) => t.sides.length > 0)
    if (!opt) { r.check('el de turno tenía jugada', false); break }
    const antesDom = (doc.querySelector('[class*="boardInner"]')?.children.length) ?? 0
    await p.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
    // Sin recargar: la mesa de Rafa debe enterarse por Realtime.
    const actualizó = await until('el tablero de Rafa', () =>
      ((doc.querySelector('[class*="boardInner"]')?.children.length) ?? 0) > antesDom
      || /Mano terminada|Dominó|Tranca|Capicúa/.test(text()), 6000)
    if (actualizó) vioTableroCrecer = true
    st = await leer()
  }
}

r.check('Rafa jugó varias veces desde la UI', clicksDeRafa >= 2, `${clicksDeRafa} jugadas`)
if (vioSelectorDePuntas) r.check('apareció el selector de punta izquierda/derecha', true)
r.check('la mesa se actualiza sola cuando juegan los otros', vioTableroCrecer)
r.check('la mano terminó', st.hand.status === 'finished', st.hand.end_type)

r.head('Fin de mano en pantalla')
const overlay = await until('el resumen', () => /Dominó|Tranca|Capicúa|Mano anulada/.test(text()))
r.check('muestra cómo terminó', overlay, st.hand.end_type)
r.check('muestra los puntos', text().includes(String(st.hand.points_awarded)))

const siguiente = byText('button', /Siguiente mano|Ver resultado/)
r.check('ofrece seguir', !!siguiente, siguiente?.textContent ?? '')
if (siguiente && /Siguiente mano/.test(siguiente.textContent)) {
  click(siguiente)
  const nueva = await until('la mano 2', async () => {
    const s2 = await leer()
    return s2.hand.hand_number === 2
  })
  r.check('reparte la mano siguiente desde el botón', nueva)
  r.check('vuelve a haber 7 fichas', await until('7 fichas',
    () => doc.querySelectorAll('button[class*="tile"]').length === 7))
}


/*
 * Los tres gestos de la mano. Se prueban en la mano 2, ya repartida y con las
 * siete fichas puestas: aquí lo que importa no es el juego sino que tocar,
 * arrastrar y mantener pulsado hagan tres cosas distintas.
 */
r.head('Ordenar y voltear tu propia mano')

const { window: win } = app
/** El envoltorio que escucha los gestos: el botón va `disabled` y no los recibe. */
const slots = () => [...doc.querySelectorAll('[data-mano] > *')]
/** Cómo se ve cada ficha ahora mismo: "arriba-abajo", en el orden de la mano. */
/* Cada mitad de la ficha es una rejilla de 9 huecos y entre las dos hay un
   divisor, que no es una mitad: se distinguen por tener 9 hijos. */
const leerFicha = (sl) => {
  const mitades = [...(sl.querySelector('button > div')?.children ?? [])]
    .filter((h) => h.children.length === 9)
  return mitades.map((m) => [...m.children].filter((h) => h.children.length).length).join('-')
}
const pintadas = () => slots().map(leerFicha)

const puntero = (el, tipo, x, y) => el.dispatchEvent(
  new win.PointerEvent(tipo, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
)

const antesDeOrdenar = pintadas()
r.check('la mano se lee entera', antesDeOrdenar.length === 7, antesDeOrdenar.join(' '))

// --- arrastrar: la primera ficha se va al tercer puesto ---
const paso = 60
const primera = slots()[0]
puntero(primera, 'pointerdown', 0, 0)
puntero(primera, 'pointermove', paso * 2, 0)
puntero(primera, 'pointerup', paso * 2, 0)
await wait(120)
const trasArrastrar = pintadas()
r.check('arrastrar cambia el orden de la mano',
  trasArrastrar.join(' ') !== antesDeOrdenar.join(' ')
  && trasArrastrar.includes(antesDeOrdenar[0]),
  `${antesDeOrdenar.join(' ')} → ${trasArrastrar.join(' ')}`)
r.check('arrastrar no juega la ficha', doc.querySelectorAll('[data-mano] > *').length === 7)

// --- pulsación larga: la ficha se voltea ---
// Un doble no sirve de prueba: se ve igual del derecho que del revés.
const iVoltear = pintadas().findIndex((f) => f.split('-')[0] !== f.split('-')[1])
const objetivo = slots()[iVoltear]
const antesDeVoltear = pintadas()[iVoltear]
puntero(objetivo, 'pointerdown', 0, 0)
await wait(650)
puntero(objetivo, 'pointerup', 0, 0)
await wait(120)
const trasVoltear = pintadas()[iVoltear]
const alReves = antesDeVoltear.split('-').reverse().join('-')
r.check('mantener pulsado voltea la ficha', trasVoltear === alReves,
  `${antesDeVoltear} → ${trasVoltear}`)
r.check('voltear tampoco la juega', doc.querySelectorAll('[data-mano] > *').length === 7)

// --- y todo eso sobrevive a recargar ---
const guardado = win.localStorage.getItem('domino.mano.' + (await leer()).hand.id)
r.check('el orden y el volteo quedan guardados por mano', !!guardado, guardado ?? '')
const orden = pintadas()

const manoId = (await leer()).hand.id
const app2 = await bootApp({
  as: 'Rafa',
  url: `http://localhost:4173/sala/${code}/mesa`,
  seed: { ['domino.mano.' + manoId]: guardado },
})
await app2.until('la mesa otra vez', () => /Puntas|Mesa limpia/.test(app2.text()))
const pintadas2 = () => [...app2.doc.querySelectorAll('[data-mano] > *')].map(leerFicha)
await app2.until('las 7 fichas', () => pintadas2().length === 7)
r.check('al recargar, la mano sigue como la dejaste',
  pintadas2().join(' ') === orden.join(' '), `${orden.join(' ')} vs ${pintadas2().join(' ')}`)
app2.window.close()

saveBrowserSession(app.window, 'Rafa')
app.window.close()
r.done('sala de prueba: ' + code)
