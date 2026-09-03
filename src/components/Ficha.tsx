import type { CSSProperties } from 'react'
import type { Pip } from '../game/tiles'

/** Posiciones de los pips en una grilla 3x3, tal cual el componente del prototipo. */
const PIPS: Record<Pip, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

type Props = {
  top: Pip
  bottom: Pip
  /** Lado largo de la ficha, en px. */
  size?: number
  vertical?: boolean
  flat?: boolean
  face?: string
  pip?: string
  style?: CSSProperties
}

function Half({ value, dot, pad, color }: { value: Pip; dot: number; pad: number; color: string }) {
  const on = PIPS[value]
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        placeItems: 'center',
        padding: pad,
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          {on.includes(i) && (
            <div style={{ width: dot, height: dot, borderRadius: '50%', background: color }} />
          )}
        </div>
      ))}
    </div>
  )
}

export function Ficha({
  top,
  bottom,
  size = 96,
  vertical = false,
  flat = false,
  face = 'var(--tile-face)',
  pip = 'var(--tile-pip)',
  style,
}: Props) {
  const dot = Math.max(3, Math.round(size * 0.078))
  const pad = Math.max(2, Math.round(size * 0.05))
  const radius = Math.max(3, Math.round(size * 0.08))

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        width: vertical ? Math.round(size / 2) : size,
        height: vertical ? size : Math.round(size / 2),
        background: `linear-gradient(160deg, var(--tile-face-hi), ${face})`,
        borderRadius: radius,
        boxShadow: flat ? 'inset 0 0 0 1px rgba(0,0,0,.15)' : 'var(--shadow-tile)',
        overflow: 'hidden',
        flex: '0 0 auto',
        ...style,
      }}
    >
      <Half value={top} dot={dot} pad={pad} color={pip} />
      <div
        style={{
          background: 'rgba(26,35,56,.35)',
          width: vertical ? '100%' : 1,
          height: vertical ? 1 : '100%',
          flex: '0 0 auto',
        }}
      />
      <Half value={bottom} dot={dot} pad={pad} color={pip} />
    </div>
  )
}
