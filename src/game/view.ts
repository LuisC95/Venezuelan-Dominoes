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

/** Una línea de la cadena: qué fichas lleva y cuánto ocupa. */
export type FilaCadena = { desde: number; hasta: number; ancho: number; alto: number }

/**
 * Reparte la cadena en líneas, igual que haría `flex-wrap`.
 *
 * Se simula en vez de estimarse porque los dobles miden distinto: contar
 * "fichas por fila" daría de más justo en las manos con muchos dobles, que son
 * las que peor caben. Y como devuelve los índices, es también lo que usa la
 * mesa para pintar cada línea por separado y hacerlas serpentear.
 */
export function filasDeCadena(dobles: boolean[], size: number, ancho: number, gap: number): FilaCadena[] {
  const filas: FilaCadena[] = []
  let fila: FilaCadena | null = null

  for (let i = 0; i < dobles.length; i++) {
    const m = medidaFicha(size, dobles[i])
    if (fila && fila.ancho + gap + m.ancho > ancho) {
      filas.push(fila)
      fila = null
    }
    if (!fila) {
      fila = { desde: i, hasta: i, ancho: m.ancho, alto: m.alto }
    } else {
      fila.hasta = i
      fila.ancho += gap + m.ancho
      fila.alto = Math.max(fila.alto, m.alto)
    }
  }
  if (fila) filas.push(fila)
  return filas
}

/** Alto total de la cadena, con los huecos entre filas. */
export function altoDeCadena(filas: FilaCadena[], gap: number): number {
  if (filas.length === 0) return 0
  return filas.reduce((a, f) => a + f.alto, 0) + gap * (filas.length - 1)
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
    const filas = filasDeCadena(dobles, size, caja.ancho, gap)
    if (altoDeCadena(filas, gap) <= caja.alto) return size
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
