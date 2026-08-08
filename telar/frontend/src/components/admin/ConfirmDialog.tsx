// ConfirmDialog — diálogo modal de confirmación accesible (role="dialog",
// aria-modal). Escape y click en el backdrop cancelan; el botón de confirmar
// recibe el foco al abrir. `position: fixed` (admin.css) escapa cualquier
// contexto de apilamiento. Reutilizado por los CRUD destructivos del admin.
import { useEffect, type ReactNode } from 'react'
import { Button } from '../ui/Button'

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` tiñe el botón de confirmar (acciones destructivas). */
  tone?: 'default' | 'danger'
  /** Deshabilita las acciones mientras la operación está en curso. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="admin-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="admin-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title" className="display-md">
          {title}
        </h3>
        {body != null && (
          <p className="muted" style={{ margin: '10px 0 0' }}>
            {body}
          </p>
        )}
        <div className="admin-modal-actions">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'default' : 'primary'}
            size="sm"
            className={tone === 'danger' ? 'admin-btn-danger' : undefined}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Procesando…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
