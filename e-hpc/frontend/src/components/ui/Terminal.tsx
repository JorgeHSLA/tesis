// Terminal — marco del handoff (§2.6): SIEMPRE oscuro (tokens --term-* en
// components.css) en ambas variantes; header con los 3 dots mac icónicos.
// El cuerpo expone `bodyRef` para el auto-scroll de WP6 y usa role="log" (a11y).
import { forwardRef, type CSSProperties, type ReactNode } from 'react'

// Dots mac (rojo/ámbar/verde) — icónicos del sistema, pero definidos en
// tokens.css (--term-dot-*) para que ningún componente lleve hex suelto.
const DOT_COLORS = [
  'var(--term-dot-red)',
  'var(--term-dot-amber)',
  'var(--term-dot-green)',
] as const

export interface TerminalProps {
  /** Título del header (p. ej. `docker logs -f ehpc-job-…`). */
  title?: ReactNode
  /** false → sin header de dots (card Output de resultados). */
  dots?: boolean
  className?: string
  bodyClassName?: string
  bodyStyle?: CSSProperties
  /** aria-label del log (a11y). */
  label?: string
  children?: ReactNode
}

export const Terminal = forwardRef<HTMLDivElement, TerminalProps>(function Terminal(
  { title, dots = true, className, bodyClassName, bodyStyle, label, children },
  bodyRef,
) {
  const showHeader = dots || title != null
  return (
    <div className={['terminal', className].filter(Boolean).join(' ')}>
      {showHeader && (
        <div className="terminal-header">
          {dots &&
            DOT_COLORS.map((c) => (
              <span key={c} className="terminal-dot" style={{ background: c }} aria-hidden="true" />
            ))}
          {title != null && <span style={{ marginLeft: dots ? 8 : 0 }}>{title}</span>}
        </div>
      )}
      <div
        ref={bodyRef}
        className={['terminal-body', bodyClassName].filter(Boolean).join(' ')}
        style={bodyStyle}
        role="log"
        aria-label={label ?? 'Salida de la ejecución'}
      >
        {children}
      </div>
    </div>
  )
})

/** Línea de terminal con timestamp y tag coloreado (formato del handoff §5.7). */
export interface TermLineProps {
  time?: string
  /** Clase de color del tag: term-dim | term-green | term-orange | term-red | term-blue | term-amber. */
  tagClass?: string
  tag?: ReactNode
  children?: ReactNode
}

export function TermLine({ time, tagClass, tag, children }: TermLineProps) {
  return (
    <div className="term-line">
      {time != null && <span className="term-dim">[{time}]</span>}{' '}
      {tag != null && <span className={tagClass}>{tag}</span>}{' '}
      <span>{children}</span>
    </div>
  )
}
