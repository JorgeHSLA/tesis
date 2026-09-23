// ModuleFormDialog — alta/edición de un módulo (modal). En ALTA el `id` (PK =
// nombre de carpeta) ya NO se escribe a mano: se DERIVA del título con
// `slugify` + `uniqueSlug` (deduplicado contra los módulos existentes) y se
// muestra como preview de solo lectura. El «Orden» viene prellenado con
// maxOrden+1. En EDICIÓN el `id` es de solo lectura (es PK). Mapea los errores
// del backend (409 DUPLICATE_ID/ORDER_CONFLICT, 422) a un banner del diálogo.
// fase4-autoria-design §9.F(2).
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../../../api/client'
import { createModule, updateModule } from '../../../api/admin'
import type { ModuleDto } from '../../../api/types'
import { slugify, uniqueSlug } from '../../../lib/slug'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'

export interface ModuleFormDialogProps {
  mode: 'create' | 'edit'
  /** Valores iniciales (obligatorio en modo edición). */
  initial?: ModuleDto
  /** Ids de módulos existentes — para deduplicar el slug autogenerado (crear). */
  existingIds?: readonly string[]
  /** Orden sugerido al crear (maxOrden + 1); ignorado en edición. */
  defaultOrder?: number
  onClose: () => void
  /** Invocado tras guardar con éxito; recibe un texto para el toast. */
  onSaved: (message: string) => void
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'DUPLICATE_ID')
      return 'Ya existe un módulo con ese identificador. Cambia el título para generar otro.'
    if (err.code === 'ORDER_CONFLICT') return 'Ese número de orden ya está en uso por otro módulo.'
    return err.message
  }
  return 'No se pudo guardar el módulo.'
}

export function ModuleFormDialog({
  mode,
  initial,
  existingIds,
  defaultOrder,
  onClose,
  onSaved,
}: ModuleFormDialogProps) {
  const [order, setOrder] = useState(
    String(mode === 'create' ? (defaultOrder ?? 1) : (initial?.order ?? '')),
  )
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [level, setLevel] = useState(initial?.level ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Identificador: en edición es la PK inmutable; en creación se DERIVA del
  // título en cada render (barato) y se deduplica contra los existentes.
  const trimmedTitle = title.trim()
  const generatedId =
    mode === 'create' && trimmedTitle !== ''
      ? uniqueSlug(slugify(trimmedTitle), existingIds ?? [])
      : ''
  const shownId = mode === 'edit' ? (initial?.id ?? '') : generatedId

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const orderNum = Number(order)
    if (!Number.isInteger(orderNum) || orderNum < 1) {
      setError('El orden debe ser un entero mayor o igual que 1.')
      return
    }
    if (mode === 'create' && generatedId === '') {
      setError('Escribe un título para generar el identificador.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createModule({
          id: generatedId,
          order: orderNum,
          title: trimmedTitle,
          description,
          level: level.trim(),
        })
        onSaved(`Módulo "${trimmedTitle}" creado.`)
      } else {
        await updateModule(initial!.id, {
          order: orderNum,
          title: trimmedTitle,
          description,
          level: level.trim(),
        })
        onSaved(`Módulo "${trimmedTitle}" actualizado.`)
      }
    } catch (err) {
      setError(messageFor(err))
      setSaving(false)
    }
  }

  return (
    <div className="admin-modal-backdrop" onMouseDown={saving ? undefined : onClose}>
      <form
        className="admin-modal admin-modal-form card"
        aria-labelledby="module-form-title"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <h3 id="module-form-title" className="display-md">
          {mode === 'create' ? 'Nuevo módulo' : 'Editar módulo'}
        </h3>

        {error != null && (
          <div className="field-hint error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        {mode === 'edit' ? (
          <div className="admin-form-grid">
            <Field label="Identificador" htmlFor="module-id" hint="No editable">
              <input id="module-id" className="input" value={shownId} readOnly spellCheck={false} />
            </Field>
            <Field label="Orden" htmlFor="module-order">
              <input
                id="module-order"
                className="input"
                type="number"
                min={1}
                value={order}
                onChange={(e) => setOrder(e.currentTarget.value)}
              />
            </Field>
          </div>
        ) : (
          <Field label="Orden" htmlFor="module-order">
            <input
              id="module-order"
              className="input"
              type="number"
              min={1}
              value={order}
              onChange={(e) => setOrder(e.currentTarget.value)}
            />
          </Field>
        )}

        <Field label="Título" htmlFor="module-title">
          <input id="module-title" className="input" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        </Field>

        {mode === 'create' && (
          <p className="admin-slug-preview" aria-live="polite">
            {generatedId !== '' ? (
              <>
                Se creará como: <code className="mono-small">{generatedId}</code>
              </>
            ) : (
              <span className="muted">El identificador se generará a partir del título.</span>
            )}
          </p>
        )}

        <Field label="Nivel" htmlFor="module-level" hint="Ej.: Introductorio, Intermedio, Avanzado">
          <input id="module-level" className="input" value={level} onChange={(e) => setLevel(e.currentTarget.value)} />
        </Field>

        <Field label="Descripción" htmlFor="module-description">
          <textarea
            id="module-description"
            className="textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </Field>

        <div className="admin-modal-actions">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? 'Guardando…' : mode === 'create' ? 'Crear módulo' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </div>
  )
}
