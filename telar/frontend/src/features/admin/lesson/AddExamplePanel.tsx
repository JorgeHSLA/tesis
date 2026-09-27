// AddExamplePanel — sección «Ejemplo ejecutable» del editor de una lección ya
// creada (CU-18.2). Con ejemplo enlaza a su editor; sin él ofrece «Agregar
// ejemplo», que lo crea con POST /admin/lessons/{id}/example. Es un guardado
// propio (otro endpoint), independiente de la barra «Guardar lección».
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addLessonExample } from '../../../api/admin'
import type { AdminExampleDto } from '../../../api/admin-types'
import { Button } from '../../../components/ui/Button'
import {
  changedFields,
  clearFieldErrors,
  parseContentErrors,
  REVIEW_FIELDS_BANNER,
  saveErrorBanner,
  visibleBanner,
} from '../field-errors'
import { exampleIssues, withPrefix } from '../validation'
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
    // Editar un campo retira su error (y el resumen, si ya no queda ninguno).
    const changed = [
      ...changedFields(draft.example, next.example, 'example.'),
      ...(draft.source_code !== next.source_code ? ['source_code'] : []),
    ]
    setFieldErrors((prev) => clearFieldErrors(prev, changed))
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
    const { source_code: codeIssue, ...exampleOnly } = exampleIssues(draft.example, draft.source_code)
    const issues = { ...withPrefix(exampleOnly, 'example.'), ...(codeIssue ? { source_code: codeIssue } : null) }
    if (Object.keys(issues).length > 0) {
      setFieldErrors(issues)
      setBanner(REVIEW_FIELDS_BANNER)
      return
    }
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
      setBanner(saveErrorBanner(parsed, err, 'No se pudo agregar el ejemplo.'))
    } finally {
      setSaving(false)
    }
  }

  const shownBanner = visibleBanner(banner, fieldErrors)

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
          {shownBanner != null && (
            <p className="field-hint error" role="alert" style={{ margin: 0 }}>
              {shownBanner}
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
