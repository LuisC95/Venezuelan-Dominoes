import { useEffect, useState } from 'react'
import type { Caja } from '../game/view'

/**
 * Mide un elemento y avisa cuando cambia de tamaño.
 *
 * Hace falta porque cuántas fichas caben en la mesa no se puede saber solo con
 * CSS: depende del número de fichas jugadas, de cuáles son dobles y del alto
 * que le quede al tablero, que cambia si se abre el chat o entra un aviso.
 *
 * Devuelve 0×0 mientras no haya medida. Los cálculos que la usan tratan ese
 * caso como "todavía no sé" y caen en una estimación, que es justamente lo que
 * pasa en jsdom: no hace layout, así que ahí nunca hay medida real.
 *
 * Lo que devuelve como ref es un **callback**, no un objeto: la mesa arranca en
 * "cargando" y el elemento a medir todavía no existe en el primer commit. Con
 * un `useRef` el efecto se ejecutaría una vez, con `current` en null, y no se
 * volvería a enganchar nunca — el tablero se quedaba para siempre con la
 * estimación en vez de la medida real.
 */
export function useTamano<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [caja, setCaja] = useState<Caja>({ ancho: 0, alto: 0 })

  useEffect(() => {
    if (!el) return

    const medir = () => {
      const r = el.getBoundingClientRect()
      const ancho = Math.round(r.width)
      const alto = Math.round(r.height)
      // Mismo tamaño ⇒ mismo objeto: si no, cada medida dispara un render.
      setCaja((prev) => (prev.ancho === ancho && prev.alto === alto ? prev : { ancho, alto }))
    }

    // ResizeObserver llama al observar, así que la primera medida ya viene.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(medir)
      ro.observe(el)
      return () => ro.disconnect()
    }

    // Sin ResizeObserver (jsdom) queda el resize de la ventana. El primer
    // disparo va en un timeout para no llamar a setState dentro del efecto.
    const t = setTimeout(medir, 0)
    window.addEventListener('resize', medir)
    return () => { clearTimeout(t); window.removeEventListener('resize', medir) }
  }, [el])

  return [setEl, caja] as const
}
