// AdminSaveBar — barra sticky de guardado para los editores (lección, quiz,
// ejemplo). Muestra el estado dirty, un posible error de validación (422) y
// las acciones Descartar / Guardar. La consumen los editores de G2.
import type { ReactNode } from 'react'
import { Button } from '../ui/Button'

export interface AdminSaveBarProps {
  /** Hay cambios sin guardar. */
  dirty: boolean
  /** Envío en curso (deshabilita las acciones). */
  saving?: boolean
  /** Mensaje de error general (los errores por campo van en cada Field). */
  error?: ReactNode
  onSave: () => void
  onDiscard: () => void
  /** Etiqueta del botón primario (verbo + objeto). */
  saveLabel?: string
}

export function AdminSaveBar({
  dirty,
  saving = false,
  error,
  onSave,
  onDiscard,
  saveLabel = 'Guardar cambios',
}: AdminSaveBarProps) {
  return (
    <div className="admin-savebar" role="region" aria-label="Guardar cambios">
      <div className="admin-savebar-status">
        {error != null ? (
          <span className="field-hint error" role="alert">
            {error}
          </span>
        ) : dirty ? (
          <span className="mono-small">Cambios sin guardar</span>
        ) : (
          <span className="mono-small muted">Todo guardado</span>
        )}
      </div>
      <div className="admin-savebar-actions">
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={!dirty || saving}>
          Descartar
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Guardando…' : saveLabel}
        </Button>
      </div>
    </div>
  )
}
