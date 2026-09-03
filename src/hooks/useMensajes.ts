import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { Mensaje, MessageKind } from '../game/state'

/** Cuántos se guardan; el chat de la mesa no es un historial. */
const LIMITE = 30

/**
 * El chat de la sala.
 *
 * No abre canal propio: se cuelga del `pulso` de `useRoom`, que sube con cada
 * evento de Realtime. Es la misma campanita de siempre —el evento no trae el
 * mensaje, solo avisa— y así el cliente no tiene que suscribirse dos veces al
 * mismo topic, que es algo que el servidor rechaza.
 */
export function useMensajes(roomId: string | null | undefined, pulso: number) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  /** Lo que le lleva el reloj del servidor a este dispositivo, en ms. */
  const [desfase, setDesfase] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!roomId) return
    let vivo = true

    api.getMessages(roomId, LIMITE).then(
      (r) => {
        if (!vivo) return
        setDesfase(Date.parse(r.now) - Date.now())
        setMensajes(r.messages)
      },
      // Un chat que no carga no debe tapar la mesa: se avisa y ya.
      (e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo leer el chat') },
    )

    return () => { vivo = false }
  }, [roomId, pulso])

  const enviar = useCallback(
    async (body: string, kind: MessageKind = 'chat') => {
      const texto = body.trim()
      if (!roomId || !texto || enviando) return false
      setEnviando(true)
      setError(null)
      try {
        await api.sendMessage(roomId, texto, kind)
        // No esperamos la campanita para vernos a nosotros mismos.
        const r = await api.getMessages(roomId, LIMITE)
        setDesfase(Date.parse(r.now) - Date.now())
        setMensajes(r.messages)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo enviar')
        return false
      } finally {
        setEnviando(false)
      }
    },
    [roomId, enviando],
  )

  return { mensajes, desfase, error, enviando, enviar }
}
