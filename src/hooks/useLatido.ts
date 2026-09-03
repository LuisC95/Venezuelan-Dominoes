import { useEffect, useState } from 'react'

/**
 * Devuelve el instante actual y lo refresca cada segundo mientras esté activo.
 * Es para las cuentas que corren en pantalla (los segundos sin señal antes de
 * poder anular la mano).
 *
 * Va con interruptor a propósito: la mesa no debe re-renderizarse cada segundo
 * cuando no hay nada contando. Móntalo dentro del componente que cuenta, no en
 * la pantalla entera.
 */
export function useLatido(activo: boolean, ms = 1000): number {
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    if (!activo) return
    // El primer tic va sin espera: si el interruptor se enciende mucho después
    // del montaje, el instante guardado ya estaría desfasado.
    const inmediato = setTimeout(() => setAhora(Date.now()), 0)
    const cada = setInterval(() => setAhora(Date.now()), ms)
    return () => { clearTimeout(inmediato); clearInterval(cada) }
  }, [activo, ms])

  return ahora
}
