// Chip — .chip y tonos del handoff (§2.4). `dot` añade el status-dot
// (pulsante por CSS; color opcional inline como en el prototipo).
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export type ChipTone = 'neutral' | 'green' | 'orange' | 'red' | 'amber' | 'blue'

export interface ChipProps extends ComponentPropsWithoutRef<'span'> {
  tone?: ChipTone
  /** true → dot con color por defecto; string → color CSS del dot. */
  dot?: boolean | string
  /** false → dot estático (sin animación pulse). */
  dotPulse?: boolean
  children?: ReactNode
}

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: '',
  green: 'chip-green',
  orange: 'chip-orange',
  red: 'chip-red',
  amber: 'chip-amber',
  blue: 'chip-blue',
}

export function Chip({ tone = 'neutral', dot, dotPulse = true, className, children, ...rest }: ChipProps) {
  const cls = ['chip', TONE_CLASS[tone], className].filter(Boolean).join(' ')
  return (
    <span className={cls} {...rest}>
      {dot != null && dot !== false && (
        <span
          className="status-dot"
          aria-hidden="true"
          style={{
            ...(typeof dot === 'string' ? { background: dot } : null),
            ...(dotPulse ? null : { animation: 'none' }),
          }}
        />
      )}
      {children}
    </span>
  )
}
