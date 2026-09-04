/** Cálculos de presentación de la mesa. Sin reglas: eso vive en Postgres. */
import type { GameState, RecentMove, Seat, SeatInfo, TeamIndex } from './state'

/**
 * Los tres asientos que no son el tuyo, de izquierda a derecha:
 * el que juega después de ti, tu pareja al frente, y el que juega antes.
 */
export function otherSeats(mySeat: Seat | null, seats: SeatInfo[]): SeatInfo[] {
  if (mySeat === null) return seats
  return [1, 2, 3].map((d) => seats[((mySeat + d) % 4) as Seat])
}

export function partnerSeat(mySeat: Seat): Seat {
  return ((mySeat + 2) % 4) as Seat
}

/**
 * De qué lado de la pantalla está un asiento, visto desde el tuyo. Es la misma
 * vuelta horaria de `otherSeats`, y es lo que dice desde dónde entra volando una
 * ficha recién jugada. Sin asiento propio —un observador— todo llega de arriba.
 */
export function ladoDelAsiento(mySeat: Seat | null, seat: Seat): 'abajo' | 'izquierda' | 'arriba' | 'derecha' {
  if (mySeat === null) return 'arriba'
  return (['abajo', 'izquierda', 'arriba', 'derecha'] as const)[(seat - mySeat + 4) % 4]
}

/**
 * Estimación de emergencia mientras no se ha medido el tablero (primer render,
 * o un entorno sin layout como jsdom). El tamaño bueno lo da `tamanoTablero`.
 */
export function boardTileSize(count: number): number {
  return Math.round(Math.max(30, 56 - Math.max(0, count - 8) * 1.6))
}

export type Caja = { ancho: number; alto: number }

/**
 * Por debajo de esto la ficha deja de leerse en la mano —lo dijo el usuario
 * jugando, con las de 23px—; por encima, no crece más. Al llegar a este suelo la
 * cadena deja de encoger y empieza a doblar.
 */
export const FICHA_MIN = 28
export const FICHA_MAX = 64

/**
 * Lo que ocupa una ficha de lado largo `size`. Un doble va girado —así se pone
 * en la mesa de verdad— y por eso mide al revés que las demás.
 */
export function medidaFicha(size: number, doble: boolean): { ancho: number; alto: number } {
  const corto = Math.round(size / 2)
  return doble ? { ancho: corto, alto: size } : { ancho: size, alto: corto }
}

/** Por dónde avanza la cadena en cada momento. */
export type Sentido = 'arriba' | 'abajo' | 'izquierda' | 'derecha'

const DIR: Record<Sentido, { dx: number; dy: number }> = {
  arriba: { dx: 0, dy: -1 },
  abajo: { dx: 0, dy: 1 },
  izquierda: { dx: -1, dy: 0 },
  derecha: { dx: 1, dy: 0 },
}
const OPUESTO: Record<Sentido, Sentido> = {
  arriba: 'abajo', abajo: 'arriba', izquierda: 'derecha', derecha: 'izquierda',
}
const enVertical = (s: Sentido) => s === 'arriba' || s === 'abajo'

/** Dónde y cómo va pintada una ficha del tablero. */
export type Pieza = {
  /** Índice en `board`. */
  i: number
  /** Esquina superior izquierda dentro del acomodo, en px. */
  x: number
  y: number
  ancho: number
  alto: number
  /** Si la `Ficha` se pinta parada (lado largo vertical). */
  vertical: boolean
  /** Pips intercambiados: la cadena entra por el lado de abajo o de la derecha. */
  espejo: boolean
  /** Aquí la cadena dobló. */
  esquina: boolean
  /** Cada recta entre dos giros. */
  tramo: number
  sentido: Sentido
}

export type Acomodo = { piezas: Pieza[]; ancho: number; alto: number }

/**
 * Lo que una ficha AVANZA la cadena y lo que ocupa DE TRAVÉS.
 *
 * Un doble va cruzado —así se pone en la mesa de verdad—, así que avanza poco y
 * se ensancha; una normal se acuesta a lo largo de la línea y hace lo contrario.
 */
function medidas(size: number, doble: boolean) {
  const corto = Math.round(size / 2)
  return doble ? { avance: corto, cruce: size } : { avance: size, cruce: corto }
}

/** Largo que ocupa la cadena entera puesta en línea recta. */
export function largoDeCadena(dobles: boolean[], size: number, gap: number): number {
  if (dobles.length === 0) return 0
  return dobles.reduce((a, d) => a + medidas(size, d).avance, 0) + gap * (dobles.length - 1)
}

/**
 * Tiende la cadena por el paño y devuelve dónde va cada ficha.
 *
 * Es un recorrido con cursor y sentido, como se tiende una cadena en una mesa:
 * la salida ancla el centro y de ahí salen dos brazos —lo jugado por la derecha
 * hacia un lado, lo jugado por la izquierda hacia el otro—. Cuando un brazo
 * llega al borde, **dobla**: una ficha de canto hace la esquina, se corre de
 * lado lo justo para cambiar de carril y vuelve a doblar para seguir en
 * paralelo. Si hay un doble a mano cerca del borde, ese hace la esquina, que ya
 * va cruzado y queda natural; si no, dobla con la que toque.
 *
 * El eje principal es el lado largo del paño: en un teléfono de pie, el
 * vertical. Girar el teléfono no necesita código aparte.
 */
export function tenderCadena(
  dobles: boolean[],
  salida: number,
  size: number,
  caja: Caja,
  gap: number,
): Acomodo {
  if (dobles.length === 0) return { piezas: [], ancho: 0, alto: 0 }

  const vertical = caja.alto >= caja.ancho
  const eje = vertical ? caja.alto : caja.ancho
  const paso = size + gap
  const corto = Math.round(size / 2)
  const piezas: Pieza[] = []

  // La ficha de salida, centrada en el 0 y mirando por el eje principal. Da
  // igual que sea doble o no: lo único que cambia es cómo se acuesta.
  const mSal = medidas(size, dobles[salida])
  const salAncho = vertical ? mSal.cruce : mSal.avance
  const salAlto = vertical ? mSal.avance : mSal.cruce
  const mitad = (vertical ? salAlto : salAncho) / 2
  piezas.push({
    i: salida, x: -salAncho / 2, y: -salAlto / 2, ancho: salAncho, alto: salAlto,
    vertical: vertical !== dobles[salida],
    espejo: false, esquina: false, tramo: 0,
    sentido: vertical ? 'abajo' : 'derecha',
  })

  /*
   * Cuánto eje le toca a cada brazo. A medias desperdiciaría medio paño cuando
   * la mano se va toda para un lado; repartido por lo que mide cada brazo, los
   * dos llegan al borde a la vez y se usa el paño entero. Con una sola ficha en
   * mesa sale 50/50, que es el centro exacto.
   */
  const largoDe = (desde: number, hasta: number) =>
    desde > hasta ? 0 : largoDeCadena(dobles.slice(desde, hasta + 1), size, gap) + gap
  const largoA = largoDe(salida + 1, dobles.length - 1)
  const largoB = largoDe(0, salida - 1)
  const libre = Math.max(0, eje - mitad * 2)
  const sitioA = largoA + largoB === 0 ? libre / 2 : libre * (largoA / (largoA + largoB))
  // Los dos bordes del paño, en coordenadas relativas a la salida. Un brazo que
  // dobla y vuelve tiene por delante el borde contrario: por eso son dos y no
  // uno, y por eso viven fuera de `tender`.
  const bordes = { pos: mitad + sitioA, neg: -(mitad + (libre - sitioA)) }

  function tender(
    desde: number, hasta: number, avanza: 1 | -1,
    inicial: Sentido, lateral: Sentido, entradaEsA: boolean,
  ) {
    if (avanza === 1 ? desde > hasta : desde < hasta) return

    // Lo que queda de cadena por delante en cada punto: sirve para no doblar
    // por gusto cuando todavía cabe todo recto.
    const cola: number[] = []
    let acc = 0
    for (let i = hasta; avanza === 1 ? i >= desde : i <= desde; i -= avanza) {
      acc += medidas(size, dobles[i]).avance + gap
      // Menos el hueco de después de la última: `punto` ya viene pasado el
      // hueco de la primera. Con el hueco de más, la cuenta se pasa por un pelo
      // justo cuando la cadena cabe exacta, y doblaba sin necesidad.
      cola[i] = acc - gap
    }

    let sentido = inicial
    let previo = inicial
    let cruzePrevio = vertical ? salAncho : salAlto
    let tramo = 1
    const d0 = DIR[inicial]
    let punto = { x: d0.dx * (salAncho / 2 + gap), y: d0.dy * (salAlto / 2 + gap) }
    let carril: { desde: number; volverA: Sentido } | null = null

    const eneje = (p: { x: number; y: number }) => (vertical ? p.y : p.x)
    const encruce = (p: { x: number; y: number }) => (vertical ? p.x : p.y)
    const bordeDe = (s: Sentido) => (DIR[s].dx + DIR[s].dy > 0 ? bordes.pos : bordes.neg)

    for (let i = desde; avanza === 1 ? i <= hasta : i >= hasta; i += avanza) {
      const m = medidas(size, dobles[i])

      if (carril === null) {
        const dir = DIR[sentido]
        const signo = dir.dx + dir.dy
        const borde = bordeDe(sentido)
        const queda = Math.abs(borde - eneje(punto))
        // Solo se plantea doblar si lo que falta NO cabe recto. Si cabe, la
        // cadena sigue de largo aunque pase un doble cerca del borde.
        const apurado = cola[i] > queda
        const cabeza = eneje(punto) + signo * m.avance
        const noCabe = signo > 0 ? cabeza > borde : cabeza < borde
        /*
         * Mientras haya que doblar se guarda SIEMPRE una ficha de holgura por
         * delante. Es porque la esquina ocupa por el eje su lado de través, y el
         * de un doble es el largo entero: sin la holgura, la esquina se salía
         * del paño justo en las manos con dobles al final.
         */
        const apretado = apurado && queda - m.avance - gap < size
        // Y si hay que doblar, mejor en un doble: ya va cruzado, así que hace de
        // esquina sin que se note el remiendo. En el segundo giro —el que vuelve
        // a poner la cadena en paralelo— los dobles no tienen preferencia.
        const mejorAqui = apurado && dobles[i] && queda < paso * 3
        // Y nunca se doblar si la esquina no cabe: sería salirse igual.
        if ((noCabe || apretado || mejorAqui) && queda >= m.cruce) {
          carril = { desde: encruce(punto), volverA: OPUESTO[sentido] }
          sentido = lateral
          tramo++
        }
      }

      // Al doblar, el cursor se corre dos veces: media ficha por el sentido
      // viejo, para que la esquina caiga limpia detrás de la anterior; y medio
      // ancho de la anterior hacia atrás por el nuevo, que es lo que alinea las
      // dos como una L de verdad en vez de dejarlas montadas.
      if (sentido !== previo) {
        const v = DIR[previo]
        const n = DIR[sentido]
        punto = {
          x: punto.x + v.dx * (m.cruce / 2) - n.dx * (cruzePrevio / 2),
          y: punto.y + v.dy * (m.cruce / 2) - n.dy * (cruzePrevio / 2),
        }
      }

      const dir = DIR[sentido]
      const ancho = enVertical(sentido) ? m.cruce : m.avance
      const alto = enVertical(sentido) ? m.avance : m.cruce
      const entradaPrimero = sentido === 'abajo' || sentido === 'derecha'
      piezas.push({
        i,
        x: punto.x + (dir.dx > 0 ? 0 : dir.dx < 0 ? -ancho : -ancho / 2),
        y: punto.y + (dir.dy > 0 ? 0 : dir.dy < 0 ? -alto : -alto / 2),
        ancho, alto,
        vertical: enVertical(sentido) !== dobles[i],
        espejo: entradaEsA ? !entradaPrimero : entradaPrimero,
        esquina: sentido !== previo,
        tramo,
        sentido,
      })
      punto = { x: punto.x + dir.dx * (m.avance + gap), y: punto.y + dir.dy * (m.avance + gap) }
      previo = sentido
      cruzePrevio = m.cruce

      if (carril !== null) {
        // ¿Nos hemos corrido lo justo para que el carril nuevo no roce al viejo?
        // Se cuenta con media ficha estrecha de propina, que es lo que ocupará
        // de través la primera del tramo siguiente.
        if (Math.abs(encruce(punto) - carril.desde) + corto / 2 >= paso) {
          sentido = carril.volverA
          carril = null
          tramo++
        }
      }
    }
  }

  // Lo jugado por la derecha baja y se corre a la derecha; lo de la izquierda
  // sube y se corre a la izquierda. Así los dos brazos no se pisan nunca.
  tender(salida + 1, dobles.length - 1, 1,
    vertical ? 'abajo' : 'derecha', vertical ? 'derecha' : 'abajo', true)
  tender(salida - 1, 0, -1,
    vertical ? 'arriba' : 'izquierda', vertical ? 'izquierda' : 'arriba', false)

  piezas.sort((p, q) => p.i - q.i)
  const minX = Math.min(...piezas.map((p) => p.x))
  const minY = Math.min(...piezas.map((p) => p.y))
  const maxX = Math.max(...piezas.map((p) => p.x + p.ancho))
  const maxY = Math.max(...piezas.map((p) => p.y + p.alto))
  for (const p of piezas) { p.x -= minX; p.y -= minY }
  return { piezas, ancho: maxX - minX, alto: maxY - minY }
}

/**
 * Por debajo del suelo cómodo solo se baja si no hay más remedio. Es el último
 * recurso: peor que una ficha pequeña es una cadena que se sale del paño.
 */
export const FICHA_APURO = 18

/**
 * De qué tamaño se pintan las fichas.
 *
 * Tres escalones, en este orden:
 *
 * 1. **Lo más grande que quepa en una sola recta** por el lado largo del paño.
 *    Es la vista alejándose conforme la cadena crece, sin doblar nunca.
 * 2. Si ni al suelo cómodo (`FICHA_MIN`) cabe recta, se planta ahí y **dobla**.
 *    Ese es el trato: alejar hasta el límite y a partir de ahí girar.
 * 3. Y si ni doblando cabe —paño diminuto con la mesa llena— se sigue encogiendo
 *    por debajo del suelo, porque salirse del paño es peor.
 *
 * Si la caja todavía no está medida (0×0) devuelve la estimación de siempre;
 * es lo que ve jsdom, que no hace layout.
 */
export function tamanoTablero(
  dobles: boolean[],
  salida: number,
  caja: Caja,
  gap: number,
): number {
  if (caja.ancho <= 0 || caja.alto <= 0) return boardTileSize(dobles.length)
  if (dobles.length === 0) return FICHA_MAX

  const eje = Math.max(caja.ancho, caja.alto)
  const cruce = Math.min(caja.ancho, caja.alto)
  for (let size = FICHA_MAX; size >= FICHA_MIN; size--) {
    // Un doble cruzado mide `size` de través: más ancho que la caja no cabe.
    if (size > cruce) continue
    if (largoDeCadena(dobles, size, gap) <= eje) return size
  }

  const cabeDoblando = (size: number) => {
    const a = tenderCadena(dobles, salida, size, caja, gap)
    return a.ancho <= caja.ancho + 0.5 && a.alto <= caja.alto + 0.5
  }
  if (cabeDoblando(FICHA_MIN)) return FICHA_MIN
  for (let size = FICHA_MIN - 1; size > FICHA_APURO; size--) {
    if (cabeDoblando(size)) return size
  }
  return FICHA_APURO
}

/**
 * Lo mismo para tu propia mano, que va en una sola fila de fichas verticales:
 * ahí no hay que simular nada, se despeja.
 */
export function tamanoMano(
  cuantas: number,
  ancho: number,
  gap: number,
  aire: number,
  max: number,
): number {
  if (cuantas <= 0 || ancho <= 0) return max
  // Se despeja el lado CORTO —que es lo que ocupa de ancho una ficha vertical— y
  // el largo es su doble. Al revés no vale: `Ficha` pinta el corto como
  // `round(size / 2)`, así que un lado largo impar se redondea hacia arriba y
  // cada ficha se pasa medio píxel. Con siete, eso ya son 3px de scroll.
  const corto = Math.floor((ancho - gap * (cuantas - 1)) / cuantas) - aire * 2
  return Math.max(FICHA_MIN, Math.min(max, corto * 2))
}

/**
 * "Chuo y Marielba pasaron" — los pases del final de la lista de jugadas.
 * Como el pase es automático, es la única forma de que se note en pantalla.
 */
export function trailingPasses(moves: RecentMove[], seats: SeatInfo[]): string | null {
  const tail: string[] = []
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].move_type !== 'pass') break
    const name = seats[moves[i].seat]?.display_name
    if (name) tail.unshift(name)
  }
  if (tail.length === 0) return null
  if (tail.length === 1) return `${tail[0]} pasó`
  return `${tail.slice(0, -1).join(', ')} y ${tail.at(-1)} pasaron`
}

/** Nombres del marcador según de qué lado estés sentado. */
export function teamNames(state: GameState): [string, string] {
  const mine = state.me.team_index
  if (mine === null) return ['Pareja 1', 'Pareja 2']
  return mine === 0 ? ['Nosotros', 'Ellos'] : ['Ellos', 'Nosotros']
}

/** 0 si el equipo es el de los asientos 0 y 2; 1 si es el de los 1 y 3. */
export function teamIndexOf(state: GameState, teamId: string | null): TeamIndex | null {
  if (teamId === null) return null
  if (teamId === state.match.team_a_id) return 0
  if (teamId === state.match.team_b_id) return 1
  return null
}

/** "Rafa & Marielba" — los dos que ocupan los asientos de esa pareja. */
export function pairNames(state: GameState, team: TeamIndex): string {
  const nombres = state.seats
    .filter((s) => s.team_index === team)
    .map((s) => s.display_name)
    .filter((n): n is string => !!n)
  return nombres.length > 0 ? nombres.join(' & ') : team === 0 ? 'Pareja 1' : 'Pareja 2'
}

/**
 * Nombres del marcador para quien mira desde fuera: un observador no tiene
 * "nosotros", así que ve a las dos parejas por su nombre.
 */
export function teamLabels(state: GameState): [string, string] {
  if (state.me.team_index === null) return [pairNames(state, 0), pairNames(state, 1)]
  return teamNames(state)
}

/**
 * Quién no tiene señal.
 *
 * Un bot nunca: no late ni se suscribe al canal, así que Presence no lo ve y
 * sin esta salida temprana la mesa lo daría por caído a los pocos segundos.
 *
 * Para los demás manda el servidor: `connected` sale de `last_seen_at` con 30s
 * de margen.
 * Presence del canal lo detecta al instante cuando alguien cierra la app, así
 * que se usa para adelantar el aviso — pero solo si el canal **nos ve a
 * nosotros**. Si no aparecemos en la lista es que el sync todavía no llegó, y
 * ahí declarar caído a nadie sería inventarse una desconexión.
 */
export function hacerSinSeñal(presentes: string[], miId: string) {
  const confiable = presentes.includes(miId)
  return (p: { profile_id: string; connected: boolean; is_bot?: boolean }) =>
    !p.is_bot && (!p.connected || (confiable && !presentes.includes(p.profile_id)))
}

/** Segundos que lleva callado alguien, o null si nunca dio señales. */
export function segundosSinSeñal(lastSeenAt: string | null, ahora: number): number | null {
  if (!lastSeenAt) return null
  return Math.max(0, Math.floor((ahora - Date.parse(lastSeenAt)) / 1000))
}
