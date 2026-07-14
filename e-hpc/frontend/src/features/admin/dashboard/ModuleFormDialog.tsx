// ModuleFormDialog — alta/edición de un módulo (modal). En alta pide `id`
// (patrón estable = nombre de carpeta); en edición el `id` es de solo lectura.
// Mapea los errores del backend (409 DUPLICATE_ID/ORDER_CONFLICT, 422) a un
// banner dentro del diálogo. fase4-autoria-design §9.F(2).
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../../../api/client'
import { createModule, updateModule } from '../../../api/admin'
import type { ModuleDto } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'

export interface ModuleFormDialogProps {
  mode: 'create' | 'edit'
  /** Valores iniciales (obligatorio en modo edición). */
  initial?: ModuleDto
  onClose: () => void
  /** Invocado tras guardar con éxito; recibe un texto para el toast. */
  onSaved: (message: string) => void
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'DUPLICATE_ID') return 'Ya existe un módulo con ese identificador.'
    if (err.code === 'ORDER_CONFLICT') return 'Ese número de orden ya está en uso por otro módulo.'
    return err.message
  }
  return 'No se pudo guardar el módulo.'
}

export function ModuleFormDialog({ mode, initial, onClose, onSaved }: ModuleFormDialogProps) {
  const [id, setId] = useState(initial?.id ?? '')
  const [order, setOrder] = useState(String(initial?.order ?? ''))
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [level, setLevel] = useState(initial?.level ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const orderNum = Number(order)
    if (!Number.isInteger(orderNum) || orderNum < 1) {
      setError('El orden debe ser un entero mayor o igual que 1.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createModule({ id: id.trim(), order: orderNum, title: title.trim(), description, level: level.trim() })
        onSaved(`Módulo "${title.trim()}" creado.`)
      } else {
        await updateModule(initial!.id, { order: orderNum, title: title.trim(), description, level: level.trim() })
        onSaved(`Módulo "${title.trim()}" actualizado.`)
      }
    } catch (err) {
      setError(messageFor(err))
      setSaving(false)
    }
  }

  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose}>
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

        <div className="admin-form-grid">
          <Field label="Identificador" htmlFor="module-id" hint={mode === 'edit' ? 'No editable' : 'Ej.: intro, spmd (letras, números, - y _)'}>
            <input
              id="module-id"
              className="input"
              value={id}
              readOnly={mode === 'edit'}
              spellCheck={false}
              onChange={(e) => setId(e.currentTarget.value)}
            />
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

        <Field label="Título" htmlFor="module-title">
          <input id="module-title" className="input" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        </Field>

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
