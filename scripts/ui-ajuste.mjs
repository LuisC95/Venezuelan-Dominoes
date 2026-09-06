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

/*
 * Cajas de paño plausibles. Ya no son el ancho de la pantalla: con un jugador a
 * cada lado, el paño pierde unos 104px (dos chips de 46 más los huecos). En una
 * pantalla de 320 quedan ~192; en una de 430, ~302.
 */
const CAJAS = [
  { nombre: 'teléfono chico', ancho: 296, alto: 430 },
  { nombre: 'teléfono grande', ancho: 366, alto: 560 },
  { nombre: 'apretado', ancho: 260, alto: 330 },
]
/* Lo que el paño se reserva para los chips de los jugadores y el chat, que van
   ENCIMA. Los mismos valores que Mesa.tsx. */
const MARGEN_ARRIBA = 62
const MARGEN_ABAJO = 44
const MARGEN_LADOS = 56
/** El suelo de legibilidad: la ficha no puede bajar de aquí. */
const FICHA_MIN = 28

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

/**
 * Las fichas que la app pintó, con la posición y los px que les puso. Se leen
 * del DOM en vez de volver a simular el acomodo: así se comprueba lo que se ve,
 * no una copia del cálculo.
 *
 * Ya no son filas de flex: cada ficha va colocada por su coordenada, y el giro
 * de línea lo hace una ficha puesta de canto (`data-codo`).
 */
function fichasDelTablero() {
  const inner = doc.querySelector('[class*="boardInner"]')
  if (!inner) return []
  return [...inner.children].map((el) => {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform)
    return {
      tramo: Number(el.dataset.tramo),
      dir: el.dataset.dir ?? '',
      esquina: el.dataset.esquina === '1',
      punta: el.dataset.punta ?? null,
      x: Number(m?.[1] ?? 0),
      y: Number(m?.[2] ?? 0),
      ancho: px(el.style.width),
      alto: px(el.style.height),
    }
  })
}

/** La caja que ocupa la cadena entera. */
function cajaDeCadena(fichas) {
  return {
    ancho: Math.max(...fichas.map((f) => f.x + f.ancho)) - Math.min(...fichas.map((f) => f.x)),
    alto: Math.max(...fichas.map((f) => f.y + f.alto)) - Math.min(...fichas.map((f) => f.y)),
  }
}

/** Distancia mínima entre dos fichas: 0 si se tocan o se pisan. */
function separacion(a, b) {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.ancho), b.x - (a.x + a.ancho)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.alto), b.y - (a.y + a.alto)))
  return Math.hypot(dx, dy)
}
const sePisan = (a, b) =>
  a.x < b.x + b.ancho - 0.5 && b.x < a.x + a.ancho - 0.5
  && a.y < b.y + b.alto - 0.5 && b.y < a.y + a.alto - 0.5

/**
 * LA invariante de la mesa: **la cadena se sigue**.
 *
 * Cada ficha toca a la siguiente y ninguna se pisa con ninguna. Es más fuerte
 * que contar filas y sentidos —que era lo que se miraba antes— y no depende de
 * cómo esté tendida: sirve igual para una recta, para un giro o para lo que
 * venga después.
 */
function cadenaRota(fichas, gap) {
  for (let i = 0; i + 1 < fichas.length; i++) {
    const d = separacion(fichas[i], fichas[i + 1])
    if (d > gap + 1.5) return `la ${i} y la ${i + 1} se separan ${d.toFixed(1)}px`
  }
  for (let i = 0; i < fichas.length; i++) {
    for (let j = i + 1; j < fichas.length; j++) {
      if (sePisan(fichas[i], fichas[j])) return `la ${i} y la ${j} se pisan`
    }
  }
  return null
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
// [class*="hand"] también casaría con .handNo de la barra superior, y el padre
// del botón es ahora el envoltorio que escucha los gestos. La mano se marca.
const mano = doc.querySelector('[data-mano]')
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
// El peor caso de toda la corrida: la ficha más pequeña que llegó a pintarse.
let ladoMinimo = Infinity
let cajaMinima = ''
let fichasMinimo = 0
let siempreIguales = true

while (st.hand.status === 'active' && guard++ < 200) {
  const seat = st.hand.current_seat
  if (seat === 0) {
/*
 * Esperar a que la MANO esté tocable, no solo a que la pantalla diga "Tu turno".
 *
 * Entre medias hay una rendija de milisegundos: `startNext()` hace
 * `startNextHand` → `refresh()` → y solo entonces suelta `busy`, así que la mano
 * nueva llega a pintarse con las fichas todavía deshabilitadas. Consultar ahí y
 * rendirse al primer intento cortaba la partida a mitad. Es la trampa de
 * siempre: se espera al DOM, no al servidor.
 */
    const tocable = () =>
      [...doc.querySelectorAll('button[class*="tile"]')].filter((b) => !b.disabled)
    if (!(await until('la mano tocable',
      () => /Tu turno/.test(text()) && tocable().length > 0, 10000))) break
    const jugables = tocable()
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

  // Antes de medir, esperar a que la pantalla se haya enterado de la última
  // jugada. Comparar el DOM contra lo que ya sabe el servidor sin esperar es la
  // receta para fallos intermitentes que parecen bugs y no lo son.
  await until('que el tablero muestre todas las fichas',
    () => fichasDelTablero().length === st.board.length, 8000)

  // Con la cadena como esté ahora mismo, ¿cabe en cada una de las cajas?
  for (const caja of CAJAS) {
    medirComo(felt, caja.ancho, caja.alto)
    remedir()
    await wait(60)

    const fichas = fichasDelTablero()
    if (fichas.length === 0) continue
    masFichas = Math.max(masFichas, fichas.length)

    const disponible = {
      ancho: caja.ancho - AIRE_TABLERO * 2 - MARGEN_LADOS * 2,
      alto: caja.alto - AIRE_TABLERO * 2 - MARGEN_ARRIBA - MARGEN_ABAJO,
    }
    const ocupa = cajaDeCadena(fichas)

    if (ocupa.ancho > disponible.ancho + 1 || ocupa.alto > disponible.alto + 1) {
      r.check(`cabe con ${fichas.length} fichas en ${caja.nombre}`, false,
        `${Math.round(ocupa.ancho)}×${Math.round(ocupa.alto)} en ${disponible.ancho}×${disponible.alto}`)
      revisiones = -1
      break
    }

    const rota = cadenaRota(fichas, HUECO_TABLERO)
    if (rota) {
      r.check('la cadena se sigue de una ficha a la siguiente', false, rota)
      revisiones = -1
      break
    }

    /*
     * El suelo que pidió el usuario. Es una preferencia, no una promesa: en un
     * paño diminuto con la mesa llena se baja de ahí, porque salirse del paño
     * es peor que una ficha pequeña. Lo que sí se comprueba es que solo se baje
     * cuando de verdad no cabía.
     */
    const lado = Math.max(...fichas.map((f) => Math.max(f.ancho, f.alto)))
    if (lado < FICHA_MIN && caja.nombre !== 'apretado') {
      r.check('la ficha no baja del suelo salvo en el paño más apretado',
        false, `${lado}px < ${FICHA_MIN}px en ${caja.nombre}`)
      revisiones = -1
      break
    }

    // Las dos puntas de juego, marcadas: una al principio y otra al final.
    const puntas = fichas.filter((f) => f.punta).map((f) => f.punta).join('')
    if (fichas.length > 1 && puntas !== 'lr') {
      r.check('las dos puntas están marcadas en el tablero', false, `puntas: "${puntas}"`)
      revisiones = -1
      break
    }

    if (fichas.length !== st.board.length) {
      r.check('las filas llevan todas las fichas y ninguna de más', false,
        `${fichas.length} pintadas / ${st.board.length} en el servidor`)
      revisiones = -1
      break
    }

    const lados = fichas.map((f) => Math.max(f.ancho, f.alto))
    if (new Set(lados).size !== 1) siempreIguales = false
    if (lados[0] < ladoMinimo) {
      ladoMinimo = lados[0]
      cajaMinima = caja.nombre
      fichasMinimo = fichas.length
    }
    // El peor caso de media partida en la caja holgada: es donde la ficha tiene
    // que seguir leyéndose. Con una sola ficha en la mesa no prueba nada.
    if (caja.nombre === 'teléfono grande' && fichas.length >= 8 && fichas.length <= 14
        && lados[0] < ladoMedioJuego) {
      ladoMedioJuego = lados[0]
      fichasEntonces = fichas.length
    }

    peorHolgura = Math.min(peorHolgura, disponible.alto - ocupa.alto)
    revisiones++
  }
  if (revisiones < 0) break
}

r.check('la cadena cupo, se siguió entera y no perdió fichas ni legibilidad',
  revisiones > 0, `${revisiones} comprobaciones, hasta ${masFichas} fichas, holgura mínima ${peorHolgura}px`)

console.log(`  la más pequeña que se llegó a pintar: ${ladoMinimo}px de lado largo` +
  ` (${fichasMinimo} fichas, ${cajaMinima})`)

r.head('Sin encoger de más')
r.check('a media partida la ficha se sigue leyendo', ladoMedioJuego >= FICHA_MIN,
  `${ladoMedioJuego}px de lado largo con ${fichasEntonces} fichas`)
r.check('todas las fichas del tablero miden igual', siempreIguales)

saveBrowserSession(window, 'Rafa')
window.close()
r.done('sala de prueba: ' + code)
