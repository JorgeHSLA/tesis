// EmptyState — ÚNICA forma permitida de estado vacío (frontend-spec §6).
// El texto específico lo aporta cada pantalla.
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  /** Texto secundario opcional. */
  body?: ReactNode
  /** CTA (link o botón). */
  action?: ReactNode
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon != null && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {body != null && <p className="empty-state-body">{body}</p>}
      {action}
    </div>
  )
}
