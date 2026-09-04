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

/** Por debajo de esto la ficha deja de leerse; por encima, no crece más. */
export const FICHA_MIN = 22
export const FICHA_MAX = 64

/**
 * Lo que ocupa una ficha de lado largo `size`. Un doble va girado —así se pone
 * en la mesa de verdad— y por eso mide al revés que las demás.
 */
export function medidaFicha(size: number, doble: boolean): { ancho: number; alto: number } {
  const corto = Math.round(size / 2)
  return doble ? { ancho: corto, alto: size } : { ancho: size, alto: corto }
}

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
  /** Tramo que va hacia la izquierda: los pips van intercambiados. */
  espejo: boolean
  /** La ficha del giro, girada 90° respecto a su tramo. */
  codo: boolean
  fila: number
  /** +1 el tramo avanza hacia la derecha, -1 hacia la izquierda. */
  sentido: 1 | -1
}

export type Acomodo = { piezas: Pieza[]; ancho: number; alto: number }

/**
 * Reparte la cadena por el paño, serpenteando, y devuelve la posición exacta de
 * cada ficha.
 *
 * Antes esto eran filas de `flex-wrap` alternando el sentido, y el giro **no
 * cuadraba**: el reparto es codicioso, así que a cada fila le sobra un trozo
 * distinto, y la fila par pegaba a la izquierda mientras la impar pegaba a la
 * derecha. El punto de unión se corría hasta un ancho de ficha y la seguidilla
 * se perdía — es lo que el usuario reportó jugando.
 *
 * Aquí el giro lo hace una ficha **puesta de canto**, como en una mesa de
 * verdad: la última de la fila se gira 90° y la fila siguiente arranca pegada a
 * su borde exterior. Así la unión cuadra por construcción, no por suerte.
 */
export function acomodarCadena(dobles: boolean[], size: number, ancho: number, gap: number): Acomodo {
  const corto = Math.round(size / 2)
  // En el tramo, la normal va acostada y el doble de canto. En el codo, al revés.
  const enTramo = (doble: boolean) => (doble ? { ancho: corto, alto: size } : { ancho: size, alto: corto })
  const enCodo = (doble: boolean) => (doble ? { ancho: size, alto: corto } : { ancho: corto, alto: size })

  const piezas: Pieza[] = []
  let sentido: 1 | -1 = 1
  // Borde por donde avanza la cadena: el derecho si va hacia la derecha.
  let borde = 0
  let fila = 0
  let y = 0
  let altoFila = 0
  let primeraDeFila = true

  /** Hueco que queda por delante en esta fila. */
  const libre = () => (sentido === 1 ? ancho - borde : borde)

  const colocar = (i: number, m: { ancho: number; alto: number }, codo: boolean) => {
    const sep = primeraDeFila ? 0 : gap
    const x = sentido === 1 ? borde + sep : borde - sep - m.ancho
    piezas.push({
      i, x, y, ancho: m.ancho, alto: m.alto,
      vertical: codo ? !dobles[i] : dobles[i],
      espejo: sentido === -1 && !codo,
      codo, fila, sentido,
    })
    borde = sentido === 1 ? x + m.ancho : x
    altoFila = Math.max(altoFila, m.alto)
    primeraDeFila = false
  }

  const girar = () => {
    y += altoFila + gap
    fila++
    altoFila = 0
    sentido = (sentido === 1 ? -1 : 1) as 1 | -1
    primeraDeFila = true
    // `borde` no se toca: la fila nueva arranca justo donde terminó el codo, que
    // es lo que hace que la ficha de abajo quede debajo de él.
  }

  for (let i = 0; i < dobles.length; i++) {
    const tramo = enTramo(dobles[i])
    const sep = primeraDeFila ? 0 : gap
    if (libre() >= sep + tramo.ancho) {
      colocar(i, tramo, false)
      continue
    }
    const codo = enCodo(dobles[i])
    if (!primeraDeFila && libre() >= gap + codo.ancho) {
      // Cabe de canto: esta es la ficha del giro.
      colocar(i, codo, true)
      girar()
      continue
    }
    // Ni de canto cabe (fila recién abierta en un paño angustiosamente estrecho):
    // se cierra la fila y la ficha abre la siguiente, como hacía el flex-wrap.
    if (primeraDeFila) {
      colocar(i, tramo, false)
      continue
    }
    girar()
    // Tras girar, el borde es el mismo; la fila nueva empieza con esta ficha.
    colocar(i, enTramo(dobles[i]), false)
  }

  if (piezas.length === 0) return { piezas, ancho: 0, alto: 0 }
  // Si la última ficha fue un codo, `girar()` ya abrió una fila que nadie usó:
  // su hueco no cuenta para el alto.
  const alto = altoFila > 0 ? y + altoFila : y - gap

  // Se normaliza a un origen en 0,0: el acomodo puede haber caminado hacia la
  // izquierda del arranque y lo que le importa a la mesa es la caja que ocupa.
  const minX = Math.min(...piezas.map((p) => p.x))
  const maxX = Math.max(...piezas.map((p) => p.x + p.ancho))
  for (const p of piezas) p.x -= minX
  return { piezas, ancho: maxX - minX, alto }
}

/**
 * El tamaño de ficha más grande con el que la cadena entera **cabe sin scroll**
 * en la caja dada. Se prueba de mayor a menor: son 40 tanteos como mucho sobre
 * 28 fichas, nada que se note.
 *
 * Si la caja todavía no está medida (0×0) devuelve la estimación de siempre;
 * es lo que ve jsdom, que no hace layout.
 */
export function tamanoTablero(dobles: boolean[], caja: Caja, gap: number): number {
  if (caja.ancho <= 0 || caja.alto <= 0) return boardTileSize(dobles.length)
  if (dobles.length === 0) return FICHA_MAX

  for (let size = FICHA_MAX; size > FICHA_MIN; size--) {
    // Una ficha normal mide `size` de ancho: más ancha que la caja no cabe ni sola.
    if (size > caja.ancho) continue
    const acomodo = acomodarCadena(dobles, size, caja.ancho, gap)
    if (acomodo.alto <= caja.alto && acomodo.ancho <= caja.ancho) return size
  }
  return FICHA_MIN
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
