// AddExamplePanel — sección «Ejemplo ejecutable» del editor de una lección ya
// creada (CU-18.2). Con ejemplo enlaza a su editor; sin él ofrece «Agregar
// ejemplo», que lo crea con POST /admin/lessons/{id}/example. Es un guardado
// propio (otro endpoint), independiente de la barra «Guardar lección».
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../../api/client'
import { addLessonExample } from '../../../api/admin'
import type { AdminExampleDto } from '../../../api/admin-types'
import { Button } from '../../../components/ui/Button'
import { parseContentErrors } from '../field-errors'
import { blankDraft, EXAMPLE_FIELDS, type ExampleDraft } from './exampleDraft'
import { ExampleDraftFields } from './ExampleDraftFields'

export interface AddExamplePanelProps {
  lessonId: string
  /** Id del ejemplo actual, o `null` si la lección no tiene. */
  exampleId: string | null
  maxTimeoutS: number
  /** Abrir el formulario de entrada (p. ej. llegando desde el panel). */
  startOpen?: boolean
  onAdded: (example: AdminExampleDto) => void
  /** Hay un borrador abierto sin guardar (para el bloqueo de navegación). */
  onDraftDirtyChange?: (dirty: boolean) => void
}

const KNOWN_FIELDS = [...EXAMPLE_FIELDS.map((f) => `example.${f}`), 'source_code']

export function AddExamplePanel({
  lessonId,
  exampleId,
  maxTimeoutS,
  startOpen = false,
  onAdded,
  onDraftDirtyChange,
}: AddExamplePanelProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(startOpen)
  const [draft, setDraft] = useState<ExampleDraft>(blankDraft)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  const draftDirty = open && touched
  useEffect(() => {
    onDraftDirtyChange?.(draftDirty)
  }, [draftDirty, onDraftDirtyChange])

  const edit = (next: ExampleDraft) => {
    setDraft(next)
    setTouched(true)
  }
  const close = () => {
    setOpen(false)
    setDraft(blankDraft())
    setTouched(false)
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setBanner(null)
    setFieldErrors({})
    try {
      const created = await addLessonExample(lessonId, draft)
      close()
      onAdded(created)
    } catch (err) {
      const parsed = parseContentErrors(err, KNOWN_FIELDS)
      setFieldErrors(parsed.byField)
      setBanner(parsed.banner ?? (err instanceof ApiError ? err.message : 'No se pudo agregar el ejemplo.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="section-head" style={{ margin: 0 }}>
        <h3 className="display-md">Ejemplo ejecutable</h3>
        <p className="mono-small muted" style={{ margin: '4px 0 0' }}>
          {exampleId != null ? 'Esta lección tiene ejemplo.' : 'Esta lección no tiene ejemplo: es solo teoría.'}
        </p>
      </div>

      {exampleId != null ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/ejemplos/${encodeURIComponent(exampleId)}`)}>
            Editar ejemplo
          </Button>
        </div>
      ) : !open ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Agregar ejemplo
          </Button>
        </div>
      ) : (
        <>
          <ExampleDraftFields value={draft} onChange={edit} maxTimeoutS={maxTimeoutS} errors={fieldErrors} />
          {banner != null && (
            <p className="field-hint error" role="alert" style={{ margin: 0 }}>
              {banner}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="sm" onClick={save} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar ejemplo'}
            </Button>
            <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
