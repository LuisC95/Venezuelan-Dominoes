import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import type { RoomState } from '../game/state'

const HEARTBEAT_MS = 20_000
/** Las ráfagas de eventos (4 personas entrando a la vez) se agrupan en un solo fetch. */
const REFRESH_DEBOUNCE_MS = 120

type Status = 'joining' | 'ready' | 'error'

/**
 * Entra a la sala por código y mantiene su estado al día.
 *
 * Realtime aquí es una campanita: el evento solo dice "algo cambió" y nosotros
 * volvemos a pedir el estado completo al servidor. Sale más barato de razonar
 * que ir aplicando deltas, y no hay forma de quedar desincronizado.
 */
export function useRoom(code: string | undefined) {
  const [state, setState] = useState<RoomState | null>(null)
  const [status, setStatus] = useState<Status>('joining')
  const [error, setError] = useState<string | null>(null)
  const roomId = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    if (!roomId.current) return
    try {
      setState(await api.getRoomState(roomId.current))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la sala')
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(refresh, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => {
    if (!code) return
    let alive = true

    async function enter() {
      try {
        // join_room es idempotente: si ya eras miembro solo marca que volviste.
        // Por eso recargar la página en medio de una partida no rompe nada.
        const room = await api.joinRoom(code!)
        if (!alive) return
        roomId.current = room.id
        await refresh()
        if (alive) setStatus('ready')
      } catch (e) {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'No se pudo entrar a la sala')
        setStatus('error')
      }
    }
    enter()
    return () => { alive = false }
  }, [code, refresh])

  useEffect(() => {
    const id = state?.room.id
    if (!id) return

    const channel = supabase
      .channel(`room:${id}`)
      .on('broadcast', { event: '*' }, scheduleRefresh)
      .subscribe()

    const beat = setInterval(() => { api.heartbeat(id).catch(() => {}) }, HEARTBEAT_MS)

    // Volver a la pestaña cuenta como señal de vida y como excusa para resincronizar.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        api.heartbeat(id).catch(() => {})
        refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(beat)
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [state?.room.id, scheduleRefresh, refresh])

  return { state, status, error, refresh }
}
