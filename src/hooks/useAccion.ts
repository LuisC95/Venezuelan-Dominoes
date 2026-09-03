import { useCallback, useState } from 'react'

/**
 * El patrón que repiten todas las pantallas que llaman RPCs: bloquear los
 * botones mientras la llamada va, mostrar el error si vuelve mal, y refrescar
 * el estado al terminar.
 *
 * El refresco explícito es cinturón y tirantes: el trigger ya manda el evento
 * de Realtime, pero quien acciona no debería depender de la campanita para ver
 * el resultado de su propio toque.
 */
export function useAccion(refresh?: () => Promise<unknown> | void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        await fn()
        await refresh?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Algo salió mal')
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  return { busy, error, run, setError }
}
