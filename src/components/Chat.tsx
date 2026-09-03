/**
 * Chat flotante con emotes rápidos, sobre la mesa.
 *
 * Los emotes son los cuatro del prototipo y no son configurables: la gracia es
 * que se toquen sin pensar, en un dedo, sin dejar de mirar el tablero.
 *
 * Lo que se ve por defecto son burbujas que se apagan solas — un chat con
 * historial siempre abierto le comería la pantalla a las fichas. El historial
 * está, pero detrás de "Escribir".
 */
import { useState } from 'react'
import { useLatido } from '../hooks/useLatido'
import type { Mensaje, MessageKind } from '../game/state'
import s from './Chat.module.css'

/** Los cuatro del prototipo, en su orden. */
const EMOTES = ['¡Ahí va!', '¡Data!', 'Tranquilo', '¡Se pegó!']

/** Un emote se lee de un vistazo; una frase escrita necesita más tiempo. */
const VISIBLE_MS: Record<MessageKind, number> = { emote: 6_000, chat: 12_000 }
/** Más de tres burbujas a la vez tapan la mesa. */
const BURBUJAS = 3
/** El mismo límite que el check de la tabla. */
const MAX_LARGO = 140

export function Chat({
  mensajes,
  desfase,
  error,
  enviando,
  onEnviar,
}: {
  mensajes: Mensaje[]
  /** Lo que le lleva el reloj del servidor a este dispositivo, en ms. */
  desfase: number
  error: string | null
  enviando: boolean
  onEnviar: (body: string, kind: MessageKind) => Promise<boolean>
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')

  // Se cuenta contra el reloj del servidor: `created_at` lo pone Postgres.
  const ahora = useLatido(mensajes.length > 0) + desfase
  const vivas = mensajes
    .filter((m) => ahora - Date.parse(m.created_at) < VISIBLE_MS[m.kind])
    .slice(-BURBUJAS)

  async function enviarTexto() {
    if (await onEnviar(texto, 'chat')) setTexto('')
  }

  return (
    <div className={s.chat}>
      {abierto && (
        <div className={s.historial}>
          {mensajes.length === 0 ? (
            <div className={s.vacio}>Todavía nadie ha dicho nada.</div>
          ) : (
            mensajes.slice(-8).map((m) => (
              <div key={m.id} className={`${s.linea} ${m.mine ? s.lineaMia : ''}`}>
                <span className={s.lineaQuien}>{m.mine ? 'Tú' : m.display_name}</span>
                <span className={s.lineaTexto}>{m.body}</span>
              </div>
            ))
          )}
        </div>
      )}

      {!abierto && vivas.length > 0 && (
        <div className={s.burbujas}>
          {vivas.map((m) => (
            <div key={m.id} className={`${s.burbuja} ${m.mine ? s.burbujaMia : ''}`}>
              {!m.mine && <span className={s.burbujaQuien}>{m.display_name}</span>}
              {m.body}
            </div>
          ))}
        </div>
      )}

      {error && <div className={s.error}>{error}</div>}

      {abierto ? (
        <div className={s.escribir}>
          <input
            id="mensaje"
            className={s.input}
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, MAX_LARGO))}
            onKeyDown={(e) => { if (e.key === 'Enter') enviarTexto() }}
            placeholder="Escribe algo"
            maxLength={MAX_LARGO}
            autoComplete="off"
          />
          <button
            className={s.enviar}
            disabled={enviando || texto.trim().length === 0}
            onClick={enviarTexto}
          >
            Enviar
          </button>
          <button className={s.cerrar} onClick={() => setAbierto(false)}>✕</button>
        </div>
      ) : (
        <div className={s.pills}>
          {EMOTES.map((e) => (
            <button
              key={e}
              className={s.pill}
              disabled={enviando}
              onClick={() => onEnviar(e, 'emote')}
            >
              {e}
            </button>
          ))}
          <button className={`${s.pill} ${s.pillEscribir}`} onClick={() => setAbierto(true)}>
            Escribir
          </button>
        </div>
      )}
    </div>
  )
}
