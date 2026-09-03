/**
 * Etapa 8: que las fichas se vean sin scroll mientras se juega.
 *
 * jsdom no hace layout, así que no puede decirnos si algo desborda. Lo que sí
 * puede es **fingir la medida**: se le pone al felt y a la mano el tamaño de una
 * pantalla real, se dispara un resize, y se leen los px que la app decidió para
 * cada ficha. Con eso se simula el reparto en filas de flex-wrap y se comprueba
 * que la cadena entera cabe en la caja.
 *
 * Se prueba con la mesa llenándose de verdad, jugada a jugada, y en tres cajas:
 * un teléfono chico, uno grande y el peor caso (el chat abierto comiéndose el
 * alto del tablero).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/ui-ajuste.mjs
 */
import { bootApp, makePlayer, reporter, saveBrowserSession } from './jsdom-app.mjs'

const r = reporter()

/** Los mismos valores que Mesa.tsx usa para calcular. */
const HUECO_TABLERO = 3
const AIRE_TABLERO = 10
const HUECO_MANO = 8
const AIRE_MANO = 3

/** Cajas de felt plausibles: chico, grande, y con el chat abierto. */
const CAJAS = [
  { nombre: 'teléfono chico', ancho: 342, alto: 200 },
  { nombre: 'teléfono grande', ancho: 406, alto: 300 },
  { nombre: 'con el chat abierto', ancho: 342, alto: 110 },
]

const app = await bootApp({ as: 'Rafa' })
const { doc, text, until, byText, click, type, wait, window } = app

/*
 * jsdom no trae ResizeObserver, y sin él la app cae en el resize de ventana.
 * Le ponemos uno de mentira para ejercitar exactamente la rama que usa un
 * teléfono de verdad: llama al observar —como el real— y `remedir()` vuelve a
 * llamarlo cuando cambiamos la medida fingida.
 */
const observados = []
window.ResizeObserver = class {
  constructor(cb) { this.cb = cb }
  observe() { observados.push(this); this.cb() }
  disconnect() {
    const i = observados.indexOf(this)
    if (i >= 0) observados.splice(i, 1)
  }
}
const remedir = () => { for (const o of [...observados]) o.cb() }

function medirComo(el, ancho, alto) {
  el.getBoundingClientRect = () => ({
    width: ancho, height: alto, top: 0, left: 0, right: ancho, bottom: alto, x: 0, y: 0,
    toJSON() {},
  })
}

const px = (v) => Number.parseFloat(String(v).replace('px', '')) || 0

/** Las fichas del tablero, con los px que la app les puso. */
function fichasDelTablero() {
  const inner = doc.querySelector('[class*="boardInner"]')
  if (!inner) return []
  return [...inner.children].map((f) => ({ ancho: px(f.style.width), alto: px(f.style.height) }))
}

/** Reparte en filas como flex-wrap y devuelve el ancho de cada una y el alto total. */
function repartir(fichas, ancho, gap) {
  const filas = []
  let filaAncho = 0
  let filaAlto = 0
  let vacia = true
  for (const f of fichas) {
    if (!vacia && filaAncho + gap + f.ancho > ancho) {
      filas.push({ ancho: filaAncho, alto: filaAlto })
      filaAncho = f.ancho
      filaAlto = f.alto
    } else {
      filaAncho = vacia ? f.ancho : filaAncho + gap + f.ancho
      filaAlto = Math.max(filaAlto, f.alto)
      vacia = false
    }
  }
  if (!vacia) filas.push({ ancho: filaAncho, alto: filaAlto })
  const alto = filas.reduce((a, f) => a + f.alto, 0) + gap * Math.max(0, filas.length - 1)
  return { filas, alto }
}

// --- montar una partida ---------------------------------------------------
await until('inicio', () => /Sala de juego/.test(text()))
type(doc.querySelector('#nombre'), 'Rafa')
await wait(150)
click(byText('button', /Crear sala/))
await until('lobby', () => /Mesa · parejas cruzadas/.test(text()))
const code = window.location.pathname.split('/').pop()

r.head(`Sala ${code}`)
const otros = []
for (const [i, n] of ['Chuo', 'Marielba', 'Kike'].entries()) {
  const p = await makePlayer(n)
  const { data: room } = await p.sb.rpc('join_room', { p_code: code })
  await p.sb.rpc('take_seat', { p_room_id: room.id, p_seat: i + 1 })
  otros.push({ ...p, roomId: room.id })
}
const roomId = otros[0].roomId
await until('4/4', () => /4\/4/.test(text()))
click(byText('button', /^Iniciar partida$/))
r.check('la mesa arranca', await until('la mesa', () => /Mesa limpia|Puntas/.test(text())))

const matchId = (await otros[0].sb.rpc('get_room_state', { p_room_id: roomId })).data.current_match_id
const leer = async () => (await otros[0].sb.rpc('get_game_state', { p_match_id: matchId })).data

// --- la mano propia -------------------------------------------------------
r.head('Tu mano, con las 7 fichas')
// OJO: [class*="hand"] también casa con .handNo de la barra superior. El
// contenedor bueno es el padre de los botones de ficha.
const mano = doc.querySelector('button[class*="tile"]').parentElement
r.check('hay 7 fichas repartidas', doc.querySelectorAll('button[class*="tile"]').length === 7)

for (const ancho of [320, 360, 430]) {
  medirComo(mano, ancho, 130)
  remedir()
  await wait(80)
  const botones = [...doc.querySelectorAll('button[class*="tile"]')]
  const usado = botones.reduce(
    (suma, b) => suma + px(b.firstElementChild.style.width) + AIRE_MANO * 2,
    0,
  ) + HUECO_MANO * (botones.length - 1)
  r.check(`las 7 fichas caben en ${ancho}px sin scroll`, usado <= ancho, `${Math.round(usado)}px usados`)
}

// --- el tablero, jugada a jugada -----------------------------------------
r.head('El tablero mientras se llena')
const felt = doc.querySelector('[class*="felt"]')
let st = await leer()
let revisiones = 0
let peorHolgura = Infinity
let masFichas = 0
let guard = 0
// Con sitio de sobra, ¿de qué tamaño quedan las fichas? Se anota dentro del
// bucle porque al terminar la mano la pantalla cambia y ya no hay tablero.
let ladoMedioJuego = Infinity
let fichasEntonces = 0
let siempreIguales = true

while (st.hand.status === 'active' && guard++ < 200) {
  const seat = st.hand.current_seat
  if (seat === 0) {
    if (!(await until('el turno propio', () => /Tu turno/.test(text()), 10000))) break
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
  } else {
    const p = otros[seat - 1]
    const suyo = (await p.sb.rpc('get_game_state', { p_match_id: matchId })).data
    const opt = suyo.my_hand.find((t) => t.sides.length > 0)
    if (!opt) break
    const antesDom = fichasDelTablero().length
    await p.sb.rpc('play_tile', { p_hand_id: st.hand.id, p_tile: opt.tile, p_side: opt.sides[0] })
    await until('el tablero', () => fichasDelTablero().length > antesDom
      || /Mano terminada|Dominó|Tranca|Capicúa/.test(text()), 6000)
    st = await leer()
  }

  if (st.hand.status !== 'active') break

  // Con la cadena como esté ahora mismo, ¿cabe en cada una de las cajas?
  for (const caja of CAJAS) {
    medirComo(felt, caja.ancho, caja.alto)
    remedir()
    await wait(60)

    const fichas = fichasDelTablero()
    if (fichas.length === 0) continue
    masFichas = Math.max(masFichas, fichas.length)

    const disponible = { ancho: caja.ancho - AIRE_TABLERO * 2, alto: caja.alto - AIRE_TABLERO * 2 }
    const { filas, alto } = repartir(fichas, disponible.ancho, HUECO_TABLERO)
    const masAncha = Math.max(...filas.map((f) => f.ancho))

    if (masAncha > disponible.ancho || alto > disponible.alto) {
      r.check(`cabe con ${fichas.length} fichas en ${caja.nombre}`, false,
        `alto ${alto}/${disponible.alto}, fila más ancha ${masAncha}/${disponible.ancho}`)
      revisiones = -1
      break
    }

    const lados = fichas.map((f) => Math.max(f.ancho, f.alto))
    if (new Set(lados).size !== 1) siempreIguales = false
    // El peor caso de media partida en la caja holgada: es donde la ficha tiene
    // que seguir leyéndose. Con una sola ficha en la mesa no prueba nada.
    if (caja.nombre === 'teléfono grande' && fichas.length >= 8 && fichas.length <= 14
        && lados[0] < ladoMedioJuego) {
      ladoMedioJuego = lados[0]
      fichasEntonces = fichas.length
    }

    peorHolgura = Math.min(peorHolgura, disponible.alto - alto)
    revisiones++
  }
  if (revisiones < 0) break
}

r.check('la cadena cupo sin scroll en todas las jugadas y todas las cajas',
  revisiones > 0, `${revisiones} comprobaciones, hasta ${masFichas} fichas, holgura mínima ${peorHolgura}px`)

r.head('Sin encoger de más')
r.check('a media partida la ficha sigue siendo legible', ladoMedioJuego >= 36,
  `${ladoMedioJuego}px de lado largo con ${fichasEntonces} fichas`)
r.check('todas las fichas del tablero miden igual', siempreIguales)

saveBrowserSession(window, 'Rafa')
window.close()
r.done('sala de prueba: ' + code)
