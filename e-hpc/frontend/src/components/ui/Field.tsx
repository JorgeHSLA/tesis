// Field — label + control + hint (handoff §2.5). `value` renderiza la fila
// label/valor mono del prototipo (.field-row + .mono-small).
import type { ReactNode } from 'react'

export interface FieldProps {
  label: ReactNode
  /** Valor mono a la derecha del label (p. ej. `4 hilos`). */
  value?: ReactNode
  hint?: ReactNode
  /** Mensaje de error: sustituye al hint, en rojo. */
  error?: ReactNode
  htmlFor?: string
  children?: ReactNode
}

export function Field({ label, value, hint, error, htmlFor, children }: FieldProps) {
  const labelEl = (
    <label className="field-label" htmlFor={htmlFor} style={value != null ? { marginBottom: 0 } : undefined}>
      {label}
    </label>
  )
  return (
    <div>
      {value != null ? (
        <div className="field-row">
          {labelEl}
          <span className="mono-small">{value}</span>
        </div>
      ) : (
        labelEl
      )}
      {children}
      {error != null ? (
        <div className="field-hint error" role="alert">{error}</div>
      ) : hint != null ? (
        <div className="field-hint">{hint}</div>
      ) : null}
    </div>
  )
}
