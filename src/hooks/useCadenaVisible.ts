import { useEffect, useRef, useState } from 'react'
import type { BoardTile, RecentMove, Seat } from '../game/state'

/** Lo que tarda una jugada en aparecer después de la anterior. */
const PASO_MS = 500
/**
 * A partir de aquí no se reproduce: es ponerse al día (entraste a mitad de mano,
 * volviste de una desconexión) y verlo caer jugada a jugada sería una espera
 * tonta. `recent_moves` trae ocho como mucho, así que tampoco daría para más.
 */
const SALTO_MAXIMO = 4
/** Cuánto se queda marcada la jugada recién hecha. */
const DESTELLO_MS = 1400

export type Jugada =
  | { tipo: 'play'; seat: Seat; position: number }
  | { tipo: 'pass'; seat: Seat }

const tope = (moves: RecentMove[]) => moves.reduce((m, x) => Math.max(m, x.move_number), 0)

/**
 * Va soltando lo que pasó en la mesa **de una en una** en vez de de golpe.
 *
 * Hace falta porque los bots juegan dentro de la misma transacción que el
 * humano (`play_bots` al final de `play_tile`), así que dos o tres jugadas
 * llegan en un solo refresco y en pantalla aparecían todas a la vez: imposible
 * saber quién puso qué, ni que a alguien le tocó pasar por el medio.
 *
 * Se recorre `recent_moves`, que trae **jugadas y pases en el mismo orden**. Una
 * ficha se juega una sola vez por mano, así que su texto la identifica sin
 * ambigüedad y con eso se casa cada `play` con su sitio del tablero.
 *
 * Es solo presentación: el estado bueno es el del servidor y nada de esto lo
 * toca. Como mucho, el tablero va medio segundo por detrás.
 */
export function useColaDeJugadas(handId: string | null, board: BoardTile[], moves: RecentMove[]) {
  const [revelado, setRevelado] = useState(() => tope(moves))
  const [ultima, setUltima] = useState<Jugada | null>(null)
  // El id de la mano con el que se contó por última vez: cambiarlo es repartir
  // de nuevo, y ahí casi nunca hay nada que reproducir.
  const mano = useRef(handId)
  // Lo último que llegó vive en un ref para que el efecto dependa solo de cuánto
  // ha avanzado la cuenta. Si dependiera de los arrays, cada refresco —y hay uno
  // por evento del canal— reiniciaría la espera y el revelado no dispararía.
  const ultimo = useRef({ board, moves })
  useEffect(() => { ultimo.current = { board, moves } }, [board, moves])

  const hasta = tope(moves)

  useEffect(() => {
    if (mano.current !== handId) {
      mano.current = handId
      // Repartir deja la mesa en nada o casi nada (la salida puede venir ya
      // jugada por un bot): eso sí vale la pena verlo caer. Lo que no se
      // reproduce es una mano ya empezada, que es reconectarse.
      setRevelado(hasta > SALTO_MAXIMO ? hasta : 0)
      setUltima(null)
      return
    }
    if (hasta <= revelado || hasta - revelado > SALTO_MAXIMO) {
      if (hasta !== revelado) setRevelado(hasta)
      return
    }
    const t = setTimeout(() => {
      const siguiente = ultimo.current.moves
        .filter((m) => m.move_number > revelado)
        .reduce<RecentMove | null>((a, b) => (!a || b.move_number < a.move_number ? b : a), null)
      if (!siguiente) return
      if (siguiente.move_type === 'pass') {
        setUltima({ tipo: 'pass', seat: siguiente.seat })
      } else {
        const ficha = ultimo.current.board.find((f) => f.tile === siguiente.tile)
        setUltima(ficha ? { tipo: 'play', seat: siguiente.seat, position: ficha.position } : null)
      }
      setRevelado(siguiente.move_number)
    }, revelado === 0 ? 0 : PASO_MS)
    return () => clearTimeout(t)
  }, [handId, hasta, revelado])

  // El destello se apaga solo: si se quedara puesto, la ficha seguiría marcada
  // como "recién jugada" el resto de la mano.
  useEffect(() => {
    if (!ultima) return
    const t = setTimeout(() => setUltima(null), DESTELLO_MS)
    return () => clearTimeout(t)
  }, [ultima])

  /*
   * Qué fichas se pueden ver. Las que ya no están en la ventana de
   * `recent_moves` son viejas y se ven siempre; de las que sí están, solo las
   * que ya les tocó salir.
   */
  const cuando = new Map(
    moves.filter((m) => m.move_type === 'play' && m.tile).map((m) => [m.tile!, m.move_number]),
  )
  const visibles = board.filter((f) => (cuando.get(f.tile) ?? 0) <= revelado)

  return { visibles, ultima }
}
