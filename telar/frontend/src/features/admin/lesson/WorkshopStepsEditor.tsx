// WorkshopStepsEditor — sección «Pasos del taller» del editor de una lección
// que ya es taller (S6 · CU-28, api-contract §12.3). Añadir, editar, reordenar
// y borrar pasos, con ejemplo opcional («Abrir en el simulador» para el
// estudiante). Como AddExamplePanel, es un guardado PROPIO por operación
// (otros endpoints), independiente de la barra «Guardar lección».
//
// Guardas que respeta (las mismas del resto de Autoría):
// - Un borrador de paso abierto y tocado cuenta como cambio sin guardar
//   (`onDraftDirtyChange` alimenta el bloqueo de navegación del editor).
// - Mientras una operación está en vuelo, todo se deshabilita y el diálogo de
//   borrar no se cierra (ni con Escape ni con un clic fuera).
import { useEffect, useState } from 'react'
import { ApiError } from '../../../api/client'
import { addWorkshopStep, deleteWorkshopStep, reorderWorkshopSteps, updateWorkshopStep } from '../../../api/admin'
import type { AdminWorkshopStepDto, AdminWorkshopStepInputDto, AdminWorkshopStepsDto } from '../../../api/admin-types'
import { getExamples } from '../../../api/content'
import type { ExampleSummaryDto } from '../../../api/types'
import { ConfirmDialog } from '../../../components/admin/ConfirmDialog'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Field } from '../../../components/ui/Field'
import { IconPlus } from '../../../components/icons/icons'
import { parseContentErrors } from '../field-errors'

const STEP_FIELDS = ['title', 'body_markdown', 'example_id']

/** `order` para el PUT de reorden: el paso en `from` pasa a `to`. */
export function moveOrder(count: number, from: number, to: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  return order
}

interface Editing {
  /** `null` = paso nuevo (se añade al final). */
  idx: number | null
  draft: AdminWorkshopStepInputDto
  touched: boolean
}

const BLANK: AdminWorkshopStepInputDto = { title: '', body_markdown: '', example_id: null }

export interface WorkshopStepsEditorProps {
  lessonId: string
  steps: readonly AdminWorkshopStepDto[]
  /** La lista ya guardada tras cada operación (para mantener el detalle al día). */
  onStepsChange?: (steps: AdminWorkshopStepDto[]) => void
  /** Hay un borrador de paso abierto sin guardar (para el bloqueo de navegación). */
  onDraftDirtyChange?: (dirty: boolean) => void
}

export function WorkshopStepsEditor({ lessonId, steps: initial, onStepsChange, onDraftDirtyChange }: WorkshopStepsEditorProps) {
  const [steps, setSteps] = useState<AdminWorkshopStepDto[]>(() => [...initial])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [examples, setExamples] = useState<ExampleSummaryDto[] | null>(null)

  const draftDirty = editing != null && editing.touched
  useEffect(() => {
    onDraftDirtyChange?.(draftDirty)
  }, [draftDirty, onDraftDirtyChange])

  useEffect(() => {
    let alive = true
    getExamples()
      .then((res) => alive && setExamples(res.examples))
      .catch(() => alive && setExamples([])) // sin lista: solo «Sin ejemplo» o el actual
    return () => {
      alive = false
    }
  }, [])

  /** Ejecuta una operación de pasos con la guarda de «en vuelo» y el manejo de 422. */
  const run = async (op: () => Promise<AdminWorkshopStepsDto>, onOk?: () => void): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setBanner(null)
    setFieldErrors({})
    try {
      const res = await op()
      setSteps(res.steps)
      onStepsChange?.(res.steps)
      onOk?.()
      return true
    } catch (err) {
      const parsed = parseContentErrors(err, STEP_FIELDS)
      setFieldErrors(parsed.byField)
      setBanner(parsed.banner ?? (err instanceof ApiError ? err.message : 'No se pudo guardar el paso.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const edit = (patch: Partial<AdminWorkshopStepInputDto>) =>
    setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch }, touched: true } : prev))

  const saveDraft = () => {
    if (editing == null) return
    const body: AdminWorkshopStepInputDto = {
      title: editing.draft.title.trim(),
      body_markdown: editing.draft.body_markdown,
      example_id: editing.draft.example_id || null,
    }
    const { idx } = editing
    void run(
      () => (idx == null ? addWorkshopStep(lessonId, body) : updateWorkshopStep(lessonId, idx, body)),
      () => setEditing(null),
    )
  }

  const move = (from: number, to: number) => void run(() => reorderWorkshopSteps(lessonId, moveOrder(steps.length, from, to)))

  const remove = () => {
    if (confirmDelete == null) return
    const idx = confirmDelete
    void run(
      () => deleteWorkshopStep(lessonId, idx),
      () => {
        setConfirmDelete(null)
        if (editing?.idx === idx) setEditing(null)
      },
    )
  }

  const exampleOptions = examples ?? []
  const currentExample = editing?.draft.example_id ?? null
  const missingCurrent = currentExample != null && !exampleOptions.some((e) => e.id === currentExample)

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="section-head" style={{ margin: 0 }}>
        <h3 className="display-md">Pasos del taller</h3>
        <p className="mono-small muted" style={{ margin: '4px 0 0' }}>
          El estudiante marca «Lo hice» en cada paso; al marcarlos todos, completa el taller. Cada cambio se guarda al
          momento.
        </p>
      </div>

      {steps.length === 0 ? (
        <EmptyState title="Este taller aún no tiene pasos." body="Añade el primero para que se pueda completar." />
      ) : (
        <ol className="admin-steps" aria-label="Pasos del taller">
          {steps.map((s, i) => (
            <li key={s.idx} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="mono-small">{i + 1}.</span>
                <strong style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{s.title}</strong>
                {s.example_id != null && <span className="mono-small muted">ejemplo: {s.example_id}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button variant="ghost" size="sm" disabled={busy || editing != null || i === 0} aria-label={`Subir paso ${i + 1}`} onClick={() => move(i, i - 1)}>
                  Subir
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || editing != null || i === steps.length - 1}
                  aria-label={`Bajar paso ${i + 1}`}
                  onClick={() => move(i, i + 1)}
                >
                  Bajar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || editing != null}
                  aria-label={`Editar paso ${i + 1}`}
                  onClick={() =>
                    setEditing({
                      idx: s.idx,
                      draft: { title: s.title, body_markdown: s.body_markdown, example_id: s.example_id },
                      touched: false,
                    })
                  }
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="admin-btn-danger-ghost"
                  // Con un borrador abierto no se renumera nada: su idx dejaría
                  // de apuntar al paso que se está editando.
                  disabled={busy || editing != null}
                  aria-label={`Borrar paso ${i + 1}`}
                  onClick={() => setConfirmDelete(s.idx)}
                >
                  Borrar
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {editing == null ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setEditing({ idx: null, draft: { ...BLANK }, touched: false })}
          >
            <IconPlus size={14} /> Añadir paso
          </Button>
        </div>
      ) : (
        <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
          <strong>{editing.idx == null ? 'Nuevo paso' : `Editar paso ${editing.idx + 1}`}</strong>
          <Field label="Título del paso" htmlFor="step-title" error={fieldErrors.title}>
            <input
              id="step-title"
              className="input"
              value={editing.draft.title}
              maxLength={160}
              onChange={(e) => edit({ title: e.currentTarget.value })}
            />
          </Field>
          <Field
            label="Instrucciones (Markdown)"
            htmlFor="step-body"
            hint="El mismo subset de Markdown que el contenido de la lección."
            error={fieldErrors.body_markdown}
          >
            <textarea
              id="step-body"
              className="input"
              rows={6}
              value={editing.draft.body_markdown}
              onChange={(e) => edit({ body_markdown: e.currentTarget.value })}
            />
          </Field>
          <Field
            label="Ejemplo (opcional)"
            htmlFor="step-example"
            hint="Si eliges uno, el paso ofrece «Abrir en el simulador»."
            error={fieldErrors.example_id}
          >
            <select
              id="step-example"
              className="select"
              value={currentExample ?? ''}
              onChange={(e) => edit({ example_id: e.currentTarget.value || null })}
            >
              <option value="">Sin ejemplo</option>
              {missingCurrent && <option value={currentExample!}>{currentExample}</option>}
              {exampleOptions.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.id})
                </option>
              ))}
            </select>
          </Field>
          {banner != null && (
            <p className="field-hint error" role="alert" style={{ margin: 0 }}>
              {banner}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={saveDraft}
              disabled={busy || editing.draft.title.trim() === '' || editing.draft.body_markdown.trim() === ''}
            >
              {busy ? 'Guardando…' : 'Guardar paso'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {editing == null && banner != null && (
        <p className="field-hint error" role="alert" style={{ margin: 0 }}>
          {banner}
        </p>
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        tone="danger"
        title="Borrar paso"
        body="El paso se quita del taller y los demás se renumeran. Las casillas ya marcadas de ese paso se pierden."
        confirmLabel={busy ? 'Borrando…' : 'Borrar paso'}
        busy={busy}
        onConfirm={remove}
        onCancel={() => {
          if (!busy) setConfirmDelete(null) // no se cierra con la operación en vuelo
        }}
      />
    </div>
  )
}
