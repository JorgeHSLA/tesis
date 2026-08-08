// ErrorState — ÚNICA forma permitida de estado de error (frontend-spec §6):
// card con IconAlert, mensaje amable, detalle técnico colapsado y Reintentar.
// `children` permite CTAs extra (p. ej. `Revisar servicios Docker` en desktop).
import type { ReactNode } from 'react'
import { IconAlert } from '../icons/icons'
import { Button } from './Button'

export interface ErrorStateProps {
  title?: ReactNode
  /** Mensaje amable para el usuario. */
  message: ReactNode
  /** Detalle técnico (colapsado en <details>). */
  detail?: string
  onRetry?: () => void
  /** CTAs adicionales junto a Reintentar. */
  children?: ReactNode
}

export function ErrorState({ title = 'Algo salió mal', message, detail, onRetry, children }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <div className="error-state-head">
        <IconAlert size={16} />
        <span>{title}</span>
      </div>
      <p className="error-state-msg">{message}</p>
      {detail != null && detail !== '' && (
        <details>
          <summary>Detalle técnico</summary>
          <pre>{detail}</pre>
        </details>
      )}
      {(onRetry || children) && (
        <div className="error-state-actions">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Reintentar
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  )
}
