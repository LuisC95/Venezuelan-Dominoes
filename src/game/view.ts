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

/** Las fichas encogen cuando la fila crece, para que quepa sin hacer scroll. */
export function boardTileSize(count: number): number {
  return Math.round(Math.max(30, 56 - Math.max(0, count - 8) * 1.6))
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
