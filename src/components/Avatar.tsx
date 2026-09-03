type Props = {
  name: string | null | undefined
  size?: number
  variant?: 'gold' | 'red' | 'neutral'
  ring?: string
}

const BG = {
  gold: 'var(--gold-avatar)',
  red: 'var(--red-avatar)',
  neutral: 'var(--neutral-avatar)',
}

/** Círculo con la inicial. El prototipo no usa fotos: con la letra basta. */
export function Avatar({ name, size = 36, variant = 'gold', ring }: Props) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: BG[variant],
        border: ring ? `2px solid ${ring}` : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: Math.round(size * 0.42),
        color: 'var(--ink-deep)',
        flex: '0 0 auto',
      }}
    >
      {(name?.trim()[0] ?? '?').toUpperCase()}
    </div>
  )
}
