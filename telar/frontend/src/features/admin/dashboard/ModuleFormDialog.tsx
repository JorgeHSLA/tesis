// ModuleFormDialog — alta/edición de un módulo (modal). En ALTA el `id` (PK =
// nombre de carpeta) ya NO se escribe a mano: se DERIVA del título con
// `slugify` + `uniqueSlug` (deduplicado contra los módulos existentes) y se
// muestra como preview de solo lectura. El «Orden» viene prellenado con
// maxOrden+1. En EDICIÓN el `id` es de solo lectura (es PK). Valida en el
// cliente con las reglas del schema y muestra cada error junto a su campo,
// también los del backend (422 de pydantic o de negocio, 409 ORDER_CONFLICT);
// DUPLICATE_ID y el resto van al banner (CU-13.3, 14.3).
// Con cambios, Escape / clic fuera / Cancelar preguntan antes de descartarlos
// (useUnsavedChangesGuard); con un guardado en vuelo no se cierra. §9.F(2).
import { useEffect, useState, type FormEvent } from 'react'
import { useUnsavedChangesGuard } from '../../../hooks/useUnsavedChangesGuard'
import { ApiError } from '../../../api/client'
import { createModule, updateModule } from '../../../api/admin'
import { parseContentErrors } from '../field-errors'
import { moduleIssues, type FieldIssues } from '../validation'
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

const MODULE_FIELDS = ['order', 'title', 'description', 'level'] as const
type ModuleField = (typeof MODULE_FIELDS)[number]

/** Traduce el error del backend a {errores por campo, banner}. */
function errorsFor(err: unknown): { byField: FieldIssues; banner: string | null } {
  if (err instanceof ApiError && err.code === 'DUPLICATE_ID')
    return { byField: {}, banner: 'Ya existe un módulo con ese identificador. Cambia el título para generar otro.' }
  if (err instanceof ApiError && err.code === 'ORDER_CONFLICT')
    return { byField: { order: 'Ese número de orden ya está en uso por otro módulo.' }, banner: null }
  if (!(err instanceof ApiError)) return { byField: {}, banner: 'No se pudo guardar el módulo.' }
  const parsed = parseContentErrors(err, MODULE_FIELDS)
  return { byField: { ...parsed.byField }, banner: parsed.banner }
}

export function ModuleFormDialog({
  mode,
  initial,
  existingIds,
  defaultOrder,
  onClose,
  onSaved,
}: ModuleFormDialogProps) {
  const [start] = useState(() => ({
    order: String(mode === 'create' ? (defaultOrder ?? 1) : (initial?.order ?? '')),
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    level: initial?.level ?? '',
  }))
  const [order, setOrder] = useState(start.order)
  const [title, setTitle] = useState(start.title)
  const [description, setDescription] = useState(start.description)
  const [level, setLevel] = useState(start.level)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldIssues>({})
  const [saving, setSaving] = useState(false)

  /** Cambia un campo y retira su error: ya no describe lo que hay escrito. */
  const edit = (field: ModuleField, set: (value: string) => void) => (value: string) => {
    set(value)
    setFieldErrors(({ [field]: _quitado, ...rest }) => rest)
  }

  const dirty =
    order !== start.order || title !== start.title || description !== start.description || level !== start.level
  const guard = useUnsavedChangesGuard(dirty)
  // Con un guardado en vuelo no se cierra; con cambios, se pregunta antes.
  const requestClose = () => {
    if (!saving) guard.confirm(onClose)
  }

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
      // Con la pregunta abierta, Escape es suyo (la cierra ella).
      if (e.key === 'Escape' && !guard.asking) requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const issues = moduleIssues({ order, title, level, description })
    if (mode === 'create' && trimmedTitle !== '' && generatedId === '') {
      issues.title = 'Usa letras o números en el título para generar el identificador.'
    }
    if (Object.keys(issues).length > 0) {
      setFieldErrors(issues)
      setError(null)
      return
    }
    const orderNum = Number(order.trim()) // ya validado por moduleIssues
    setSaving(true)
    setError(null)
    setFieldErrors({})
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
      const { byField, banner } = errorsFor(err)
      setFieldErrors(byField)
      setError(banner)
      setSaving(false)
    }
  }

  return (
    <>
      <div className="admin-modal-backdrop" onMouseDown={requestClose}>
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
              <Field label="Orden" htmlFor="module-order" error={fieldErrors.order}>
                <input
                  id="module-order"
                  className="input"
                  type="number"
                  min={1}
                  value={order}
                  onChange={(e) => edit('order', setOrder)(e.currentTarget.value)}
                />
              </Field>
            </div>
          ) : (
            <Field label="Orden" htmlFor="module-order" error={fieldErrors.order}>
              <input
                id="module-order"
                className="input"
                type="number"
                min={1}
                value={order}
                onChange={(e) => edit('order', setOrder)(e.currentTarget.value)}
              />
            </Field>
          )}

          <Field label="Título" htmlFor="module-title" error={fieldErrors.title}>
            <input id="module-title" className="input" value={title} onChange={(e) => edit('title', setTitle)(e.currentTarget.value)} />
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

          <Field
            label="Nivel"
            htmlFor="module-level"
            hint="Ej.: Introductorio, Intermedio, Avanzado"
            error={fieldErrors.level}
          >
            <input id="module-level" className="input" value={level} onChange={(e) => edit('level', setLevel)(e.currentTarget.value)} />
          </Field>

          <Field label="Descripción" htmlFor="module-description" error={fieldErrors.description}>
            <textarea
              id="module-description"
              className="textarea"
              rows={3}
              value={description}
              onChange={(e) => edit('description', setDescription)(e.currentTarget.value)}
            />
          </Field>

          <div className="admin-modal-actions">
            <Button variant="ghost" size="sm" onClick={requestClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Guardando…' : mode === 'create' ? 'Crear módulo' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </div>
      {/* Fuera del fondo: un clic en el de la pregunta no debe llegar al del formulario. */}
      {guard.dialog}
    </>
  )
}
