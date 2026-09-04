import { useEffect, useRef, useState } from 'react'
import type { BoardTile, Seat } from '../game/state'

/** Lo que tarda una ficha en aparecer después de la anterior. */
const PASO_MS = 500
/**
 * A partir de aquí no se reproduce: es ponerse al día (entraste a mitad de mano,
 * volviste de una desconexión) y verlo caer ficha a ficha sería una espera tonta.
 */
const SALTO_MAXIMO = 4
/** Cuánto se queda marcada la ficha recién puesta. */
const DESTELLO_MS = 1400

export type Entrando = { position: number; seat: Seat }

const ultimoOrden = (board: BoardTile[]) =>
  board.reduce((m, t) => Math.max(m, t.played_order), 0)

/**
 * Va soltando el tablero ficha a ficha en vez de de golpe.
 *
 * Hace falta porque los bots juegan **dentro de la misma transacción** que el
 * humano (`play_bots` al final de `play_tile`), así que dos o tres jugadas
 * llegan en un solo refresco y en pantalla aparecían todas a la vez: imposible
 * saber quién puso qué. Aquí se encolan y se sueltan una por una.
 *
 * Se cuenta por `played_order`, **no por posición en el array**: `board` va
 * ordenado por `board_position` y una jugada por la izquierda se mete al
 * principio, así que quedarse con "las primeras N" enseñaría la ficha nueva y
 * escondería la del otro extremo.
 *
 * Es solo presentación: el estado bueno es el del servidor y nada de esto lo
 * toca. Como mucho, el tablero va medio segundo por detrás.
 */
export function useCadenaVisible(handId: string | null, board: BoardTile[]) {
  const [revelado, setRevelado] = useState(() => ultimoOrden(board))
  const [entrando, setEntrando] = useState<Entrando | null>(null)
  // El id de la mano con el que se contó por última vez: cambiarlo es repartir
  // de nuevo, y ahí casi nunca hay nada que reproducir.
  const mano = useRef(handId)
  // El tablero vive en un ref para que el efecto dependa solo de cuánto ha
  // avanzado. Si dependiera del array, cada refresco —y hay uno por evento del
  // canal— reiniciaría la cuenta atrás y el revelado no llegaría a disparar.
  const ultimo = useRef(board)
  ultimo.current = board

  const tope = ultimoOrden(board)

  useEffect(() => {
    if (mano.current !== handId) {
      mano.current = handId
      // Repartir deja el tablero en nada o casi nada (la salida puede venir ya
      // jugada por un bot): eso sí vale la pena verlo caer. Lo que no se
      // reproduce es una mano ya empezada, que es reconectarse.
      setRevelado(tope > SALTO_MAXIMO ? tope : 0)
      setEntrando(null)
      return
    }
    if (tope <= revelado || tope - revelado > SALTO_MAXIMO) {
      // Encoger solo pasa al anular una mano; el salto grande, al reconectar.
      if (tope !== revelado) setRevelado(tope)
      return
    }
    const t = setTimeout(() => {
      const siguiente = ultimo.current
        .filter((f) => f.played_order > revelado)
        .reduce<BoardTile | null>((mejor, f) => (!mejor || f.played_order < mejor.played_order ? f : mejor), null)
      if (!siguiente) return
      setEntrando({ position: siguiente.position, seat: siguiente.seat })
      setRevelado(siguiente.played_order)
    }, revelado === 0 ? 0 : PASO_MS)
    return () => clearTimeout(t)
  }, [handId, tope, revelado])

  // El destello se apaga solo: si se quedara puesto, la ficha seguiría marcada
  // como "recién jugada" el resto de la mano.
  useEffect(() => {
    if (!entrando) return
    const t = setTimeout(() => setEntrando(null), DESTELLO_MS)
    return () => clearTimeout(t)
  }, [entrando])

  return { visibles: board.filter((f) => f.played_order <= revelado), entrando }
}
