import { useLatido } from '../hooks/useLatido'

/** A partir de aquí el anillo avisa; no habilita nada. */
const TIBIO_S = 30
const CALIENTE_S = 60

/**
 * Cuánto lleva pensando quien tiene el turno.
 *
 * **Cuenta hacia arriba y no echa a nadie.** La regla del juego es que la mesa
 * espera indefinidamente y nadie juega por otro, así que un límite duro se
 * pelearía con ella: esto informa, y ya. El color es presión social.
 *
 * La cuenta va contra `turn_started_at`, que lo escribe Postgres, así que se
 * mide con el reloj del SERVIDOR: `ahora + desfase`. Es la trampa 6 de
 * AGENTS.md; con el reloj del teléfono la cuenta se corre varios segundos.
 *
 * El tic de un segundo vive aquí dentro a propósito. `useLatido` re-renderiza a
 * quien lo monta: en la mesa entera repintaría el tablero cada segundo.
 */
export function RelojTurno({
  desde,
  desfase,
  size = 34,
  activo = true,
}: {
  /** `hand.turn_started_at`. */
  desde: string
  /** Lo que le lleva el reloj del servidor a este dispositivo, en ms. */
  desfase: number
  size?: number
  activo?: boolean
}) {
  const ahora = useLatido(activo)
  const segundos = Math.max(0, Math.floor((ahora + desfase - Date.parse(desde)) / 1000))

  const radio = size / 2 - 1.5
  const vuelta = 2 * Math.PI * radio
  // Una vuelta entera del anillo es un minuto; a partir de ahí se queda lleno.
  const parte = Math.min(1, segundos / 60)
  const color = segundos >= CALIENTE_S ? 'var(--lose)' : segundos >= TIBIO_S ? 'var(--gold)' : 'var(--ok)'

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', transform: 'rotate(-90deg)' }}
      aria-hidden
    >
      <circle
        cx={size / 2} cy={size / 2} r={radio}
        fill="none" stroke="rgba(242,234,216,.14)" strokeWidth={2}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radio}
        fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
        strokeDasharray={vuelta}
        strokeDashoffset={vuelta * (1 - parte)}
        style={{ transition: 'stroke-dashoffset .9s linear, stroke .4s' }}
      />
    </svg>
  )
}

/** Los segundos en texto, para ponerlos al lado del nombre. */
export function SegundosTurno({ desde, desfase, activo = true }: {
  desde: string
  desfase: number
  activo?: boolean
}) {
  const ahora = useLatido(activo)
  const s = Math.max(0, Math.floor((ahora + desfase - Date.parse(desde)) / 1000))
  return <>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</>
}
