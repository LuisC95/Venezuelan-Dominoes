import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import type { RoomState } from '../game/state'

const HEARTBEAT_MS = 20_000
/**
 * Tras un latido fallido se reintenta en segundos, no en 20: es lo que hace que
 * el overlay de "reconectando" aparezca cuando de verdad se cayó la red y no
 * medio minuto después.
 */
const HEARTBEAT_REINTENTO_MS = 4_000
/** Las ráfagas de eventos (4 personas entrando a la vez) se agrupan en un solo fetch. */
const REFRESH_DEBOUNCE_MS = 120
/** Un bache suelto no cuenta; dos latidos seguidos sin respuesta sí. */
const FALLOS_PARA_DARSE_POR_CAIDO = 2

type Status = 'joining' | 'ready' | 'error'

export type Conexion = {
  /** Nos quedamos sin red, sin canal, o el servidor dejó de contestar. */
  perdida: boolean
  /** Latir y resincronizar ahora mismo, sin esperar al próximo intento. */
  reintentar: () => Promise<void>
}

/**
 * Entra a la sala por código y mantiene su estado al día.
 *
 * Realtime aquí es una campanita: el evento solo dice "algo cambió" y nosotros
 * volvemos a pedir el estado completo al servidor. Sale más barato de razonar
 * que ir aplicando deltas, y no hay forma de quedar desincronizado.
 *
 * La excepción es Presence, que sí lleva información por el canal: quién tiene
 * la app abierta. Se usa solo para pintar "sin señal" al instante en vez de
 * esperar los 30s del `last_seen_at`; la autoridad sobre quién está conectado
 * —y lo único que mira `void_hand`— sigue siendo el servidor.
 */
export function useRoom(code: string | undefined) {
  const [state, setState] = useState<RoomState | null>(null)
  const [status, setStatus] = useState<Status>('joining')
  const [error, setError] = useState<string | null>(null)
  const roomId = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Señales de conexión propia, de la más rápida a la más lenta.
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  const [canalCaido, setCanalCaido] = useState(false)
  const [fallos, setFallos] = useState(0)
  /** profile_id de quienes tienen la app abierta en esta sala, según Presence. */
  const [presentes, setPresentes] = useState<string[]>([])
  /**
   * Sube con cada evento del canal. Es la campanita, expuesta: quien necesite
   * releer otra cosa de la sala (el chat, por ejemplo) se cuelga de este número
   * en vez de abrir un segundo canal — el mismo cliente no puede suscribirse
   * dos veces al mismo topic.
   */
  const [pulso, setPulso] = useState(0)

  const refresh = useCallback(async () => {
    if (!roomId.current) return
    try {
      setState(await api.getRoomState(roomId.current))
      setError(null)
      setFallos(0)
    } catch (e) {
      setFallos((n) => n + 1)
      setError(e instanceof Error ? e.message : 'No se pudo leer la sala')
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    setPulso((n) => n + 1)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(refresh, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  const reintentar = useCallback(async () => {
    const id = roomId.current
    if (!id) return
    try {
      await api.heartbeat(id)
      setFallos(0)
      await refresh()
    } catch {
      setFallos((n) => n + 1)
    }
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

  // El navegador avisa de la red antes que cualquier timeout nuestro.
  useEffect(() => {
    const subió = () => { setEnLinea(true); reintentar() }
    const cayó = () => setEnLinea(false)
    window.addEventListener('online', subió)
    window.addEventListener('offline', cayó)
    return () => {
      window.removeEventListener('online', subió)
      window.removeEventListener('offline', cayó)
    }
  }, [reintentar])

  // Latido con intervalo adaptativo: se autoprograma en vez de usar setInterval.
  useEffect(() => {
    const id = state?.room.id
    if (!id) return
    let vivo = true
    let t: ReturnType<typeof setTimeout> | null = null

    async function latir() {
      try {
        await api.heartbeat(id!)
        if (!vivo) return
        setFallos(0)
        t = setTimeout(latir, HEARTBEAT_MS)
      } catch {
        if (!vivo) return
        setFallos((n) => n + 1)
        t = setTimeout(latir, HEARTBEAT_REINTENTO_MS)
      }
    }
    latir()

    return () => { vivo = false; if (t) clearTimeout(t) }
  }, [state?.room.id])

  const miId = state?.me.profile_id ?? null

  useEffect(() => {
    const id = state?.room.id
    if (!id || !miId) return

    // La clave de Presence es el profile_id: así el estado del canal se lee
    // directo como "quiénes están", sin tener que mapear ids de socket.
    const channel = supabase.channel(`room:${id}`, { config: { presence: { key: miId } } })

    channel
      .on('broadcast', { event: '*' }, scheduleRefresh)
      .on('presence', { event: 'sync' }, () => setPresentes(Object.keys(channel.presenceState())))
      .subscribe((estado) => {
        setCanalCaido(estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED')
        if (estado === 'SUBSCRIBED') channel.track({ desde: Date.now() })
      })

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
      document.removeEventListener('visibilitychange', onVisible)
      setPresentes([])
      if (timer.current) clearTimeout(timer.current)
    }
  }, [state?.room.id, miId, scheduleRefresh, refresh])

  const conexion = useMemo<Conexion>(
    () => ({
      perdida: !enLinea || canalCaido || fallos >= FALLOS_PARA_DARSE_POR_CAIDO,
      reintentar,
    }),
    [enLinea, canalCaido, fallos, reintentar],
  )

  return { state, status, error, refresh, conexion, presentes, pulso }
}
