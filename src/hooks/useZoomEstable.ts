import { useEffect, useState } from 'react'
import type { Caja } from '../game/view'

/**
 * La vista se aleja, nunca se acerca.
 *
 * `tamanoTablero` busca el tamaño más grande que quepa, y al añadir una ficha el
 * acomodo se reequilibra: los brazos se reparten distinto y los giros caen en
 * otro sitio. A veces eso **libera** sitio y el tamaño sale mayor que antes —
 * medido, hasta 9px de golpe. Sería un tirón: la cadena entera pegando un salto
 * en mitad de la mano.
 *
 * Así que se ancla: mientras sea la misma mano y el paño mida lo mismo, el
 * tamaño solo puede bajar. Se suelta el ancla cuando cambia la mano (se reparte
 * de nuevo) o cuando el paño cambia de tamaño de verdad —girar el teléfono,
 * abrir el chat—, que ahí sí hay que recalcular de cero.
 */
export function useZoomEstable(handId: string | null, caja: Caja, size: number): number {
  const clave = `${caja.ancho}x${caja.alto}`
  const [ancla, setAncla] = useState({ handId, clave, size })

  useEffect(() => {
    const mismoSitio = ancla.handId === handId && ancla.clave === clave
    if (!mismoSitio || size < ancla.size) setAncla({ handId, clave, size })
  }, [handId, clave, size, ancla])

  const mismoSitio = ancla.handId === handId && ancla.clave === clave
  return mismoSitio ? Math.min(ancla.size, size) : size
}
