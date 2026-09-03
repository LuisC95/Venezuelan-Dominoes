import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import type { GameState } from '../game/state'

const REFRESH_DEBOUNCE_MS = 60

/**
 * Estado de la partida en vivo.
 *
 * Igual que en la sala: el evento de Realtime solo avisa que algo pasó y
 * volvemos a pedir el estado completo. Eso hace que reconectarse no tenga nada
 * de especial — es el mismo fetch de siempre — y que sea imposible quedar con
 * un tablero desincronizado del servidor.
 */
export function useGameState(matchId: string | null | undefined) {
  const [state, setState] = useState<GameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    if (!matchId) return
    try {
      setState(await api.getGameState(matchId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la mesa')
    } finally {
      setLoading(false)
    }
  }, [matchId])

  useEffect(() => {
    if (!matchId) { setLoading(false); return }
    setLoading(true)
    refresh()

    const scheduleRefresh = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(refresh, REFRESH_DEBOUNCE_MS)
    }

    const channel = supabase
      .channel(`match:${matchId}`)
      .on('broadcast', { event: '*' }, scheduleRefresh)
      .subscribe()

    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [matchId, refresh])

  return { state, loading, error, refresh }
}
