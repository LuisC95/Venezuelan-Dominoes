import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HandTile } from '../game/state'
import type { Tile } from '../game/tiles'

const PREFIJO = 'domino.mano.'

type Preferencia = { orden: Tile[]; volteadas: Tile[] }

const VACIA: Preferencia = { orden: [], volteadas: [] }

/**
 * localStorage puede no estar (modo privado, navegador con el sitio capado).
 * Nada de esto es estado de juego: si falla, se juega igual con el orden del
 * servidor.
 */
function leer(handId: string): Preferencia {
  try {
    const crudo = localStorage.getItem(PREFIJO + handId)
    if (!crudo) return VACIA
    const p = JSON.parse(crudo) as Partial<Preferencia>
    return {
      orden: Array.isArray(p.orden) ? p.orden : [],
      volteadas: Array.isArray(p.volteadas) ? p.volteadas : [],
    }
  } catch {
    return VACIA
  }
}

function guardar(handId: string, p: Preferencia) {
  try {
    localStorage.setItem(PREFIJO + handId, JSON.stringify(p))
    // Cada mano deja una entrada; sin esto se acumularían para siempre.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIJO) && k !== PREFIJO + handId) localStorage.removeItem(k)
    }
  } catch {
    // Sin sitio donde guardar, el orden dura lo que dure la pantalla.
  }
}

export type FichaMano = HandTile & { volteada: boolean }

/**
 * El orden y el volteo de **tus** fichas, que es cosa tuya y de nadie más.
 *
 * El servidor manda `my_hand` en su propio orden y no sabe nada de esto: voltear
 * es puramente cosmético (el `6-2` se ve `2-6`) y jugar sigue mandando la ficha
 * en formato canónico. Se guarda por mano en localStorage para que recargar o
 * reconectarse no te deshaga la mano que ya habías acomodado.
 */
export function useMano(handId: string | null, myHand: HandTile[]) {
  const [pref, setPref] = useState<Preferencia>(VACIA)

  useEffect(() => {
    setPref(handId ? leer(handId) : VACIA)
  }, [handId])

  const escribir = useCallback((cambio: (p: Preferencia) => Preferencia) => {
    setPref((p) => {
      const siguiente = cambio(p)
      if (handId) guardar(handId, siguiente)
      return siguiente
    })
  }, [handId])

  /*
   * Se reconcilia contra lo que manda el servidor, que es la autoridad de qué
   * fichas te quedan: se respeta tu orden para las que siguen en mano, se caen
   * las jugadas, y cualquiera que no estuviera en la lista entra al final.
   */
  const fichas = useMemo<FichaMano[]>(() => {
    const porTile = new Map(myHand.map((t) => [t.tile, t]))
    const ordenadas: HandTile[] = []
    for (const tile of pref.orden) {
      const t = porTile.get(tile)
      if (t) { ordenadas.push(t); porTile.delete(tile) }
    }
    for (const t of myHand) if (porTile.has(t.tile)) ordenadas.push(t)
    return ordenadas.map((t) => ({ ...t, volteada: pref.volteadas.includes(t.tile) }))
  }, [myHand, pref])

  const voltear = useCallback((tile: Tile) => {
    escribir((p) => ({
      orden: p.orden,
      volteadas: p.volteadas.includes(tile)
        ? p.volteadas.filter((t) => t !== tile)
        : [...p.volteadas, tile],
    }))
  }, [escribir])

  /** Mueve la ficha que está en `desde` a la posición `hasta`. */
  const mover = useCallback((desde: number, hasta: number) => {
    if (desde === hasta) return
    escribir((p) => {
      // El orden guardado puede estar incompleto o traer fichas ya jugadas: lo
      // que manda es la lista que se está viendo, así que se reescribe entera.
      const orden = fichas.map((f) => f.tile)
      const [ficha] = orden.splice(desde, 1)
      if (ficha === undefined) return p
      orden.splice(hasta, 0, ficha)
      return { orden, volteadas: p.volteadas }
    })
  }, [escribir, fichas])

  return { fichas, voltear, mover }
}
