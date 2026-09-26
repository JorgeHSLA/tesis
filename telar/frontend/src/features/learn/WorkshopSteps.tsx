// WorkshopSteps — la guía de pasos de un taller (S6 · CU-28, api-contract §12).
// Estilo Unity Learn: paso actual con sus instrucciones, lista de pasos, barra
// de avance y una casilla «Lo hice» por paso. Al marcar todos, el servidor
// completa el taller (y cuenta en el progreso del módulo como cualquier lección).
//
// Reglas de la vista:
// - Al entrar (o volver) se abre en el PRIMER paso sin marcar.
// - La casilla es optimista, pero nunca da por hecho lo que no se guardó: si el
//   PUT falla, se desmarca (vuelve a su estado) y aparece un aviso.
// - Mientras un paso se guarda, su casilla queda deshabilitada (sin carreras).
// - `completed` es monótono: desmarcar un paso no «descompleta» el taller.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { putWorkshopStep } from '../../api/content'
import type { WorkshopStepDto } from '../../api/types'
import { IconCheck, IconChevronLeft, IconChevronRight, IconPlay } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Card, CardPad } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { renderMarkdown } from '../../lib/markdown'
import { useProgressStore } from '../../stores/progressStore'

export interface WorkshopStepsProps {
  lessonId: string
  steps: readonly WorkshopStepDto[]
  /** Progreso del servidor al cargar la lección. */
  completed: boolean
  /** Deshabilitado o archivado: las casillas se guardan pero no completan. */
  countsForProgress: boolean
}

/** Índice (en la lista) del primer paso sin marcar; el último si están todos. */
export function firstPending(steps: readonly Pick<WorkshopStepDto, 'done'>[]): number {
  const i = steps.findIndex((s) => !s.done)
  return i === -1 ? Math.max(0, steps.length - 1) : i
}

export function WorkshopSteps({ lessonId, steps: initialSteps, completed: initialCompleted, countsForProgress }: WorkshopStepsProps) {
  const navigate = useNavigate()
  const hydrate = useProgressStore((s) => s.hydrate)
  const [steps, setSteps] = useState<WorkshopStepDto[]>(() => initialSteps.map((s) => ({ ...s })))
  const [current, setCurrent] = useState(() => firstPending(initialSteps))
  const [completed, setCompleted] = useState(initialCompleted)
  const [saving, setSaving] = useState<ReadonlySet<number>>(() => new Set())
  const [failure, setFailure] = useState<string | null>(null)

  const step = steps[current]
  const bodyHtml = useMemo(() => (step ? renderMarkdown(step.body_markdown) : ''), [step])

  if (steps.length === 0) {
    return <EmptyState title="Este taller todavía no tiene pasos." />
  }

  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / steps.length) * 100)

  const setDone = (idx: number, done: boolean) =>
    setSteps((prev) => prev.map((s) => (s.idx === idx ? { ...s, done } : s)))

  const toggle = (target: WorkshopStepDto, done: boolean) => {
    if (saving.has(target.idx)) return
    const position = steps.findIndex((s) => s.idx === target.idx)
    setFailure(null)
    setDone(target.idx, done)
    setSaving((prev) => new Set(prev).add(target.idx))
    putWorkshopStep(lessonId, target.idx, done)
      .then((res) => {
        setDone(res.idx, res.done)
        if (res.completed && !completed) {
          setCompleted(true)
          void hydrate(true) // el módulo y los contadores reflejan el taller hecho
        }
        // Avanza al siguiente paso pendiente tras marcar el actual.
        if (res.done && position === current) {
          const next = steps.findIndex((s, i) => i > position && !s.done)
          if (next !== -1) setCurrent(next)
        }
      })
      .catch(() => {
        setDone(target.idx, !done) // nunca se da por hecho lo que no se guardó
        setFailure(
          `No se pudo guardar el paso ${position + 1}. Comprueba la conexión e inténtalo de nuevo.`,
        )
      })
      .finally(() =>
        setSaving((prev) => {
          const next = new Set(prev)
          next.delete(target.idx)
          return next
        }),
      )
  }

  return (
    <Card className="workshop">
      <CardPad>
        <div className="workshop-head">
          <div>
            <div className="eyebrow">Taller guiado</div>
            <h3 className="display-md" style={{ margin: '4px 0 0' }}>
              Paso {current + 1} de {steps.length}
            </h3>
          </div>
          <span className="mono-small">
            {doneCount}/{steps.length} pasos
          </span>
        </div>
        <div
          className="workshop-bar"
          role="progressbar"
          aria-label="Avance del taller"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
        >
          <div style={{ width: `${pct}%` }} />
        </div>

        {completed && (
          <p className="workshop-done" role="status">
            <IconCheck size={14} /> Taller completado.
          </p>
        )}
        {!completed && !countsForProgress && (
          <p className="mono-small muted" style={{ margin: '8px 0 0' }}>
            Tus casillas se guardan, pero este taller no está disponible y no cuenta para tu progreso.
          </p>
        )}

        <div className="workshop-grid">
          <ol className="workshop-list" aria-label="Pasos del taller">
            {steps.map((s, i) => (
              <li key={s.idx}>
                <button
                  type="button"
                  className={`workshop-item${i === current ? ' current' : ''}${s.done ? ' done' : ''}`}
                  aria-current={i === current ? 'step' : undefined}
                  aria-label={`Paso ${i + 1}: ${s.title}${s.done ? ' (hecho)' : ''}`}
                  onClick={() => setCurrent(i)}
                >
                  <span className="workshop-num" aria-hidden="true">
                    {s.done ? <IconCheck size={11} /> : i + 1}
                  </span>
                  <span className="workshop-item-title">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>

          {step && (
            <section className="workshop-step" aria-label={`Paso ${current + 1}: ${step.title}`}>
              <h4 className="workshop-step-title">{step.title}</h4>
              {/* Markdown generado por lib/markdown.ts: subset seguro que escapa todo el texto. */}
              <div className="markdown" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              {step.example_id != null && (
                <Button
                  variant="outline"
                  size="sm"
                  style={{ marginTop: 12 }}
                  onClick={() => navigate(`/simulador?ejemplo=${encodeURIComponent(step.example_id!)}`)}
                >
                  <IconPlay size={14} /> Abrir en el simulador
                </Button>
              )}
              <label className="workshop-check">
                <input
                  type="checkbox"
                  checked={step.done}
                  disabled={saving.has(step.idx)}
                  onChange={(e) => toggle(step, e.currentTarget.checked)}
                />
                <span>{saving.has(step.idx) ? 'Guardando…' : 'Lo hice'}</span>
              </label>
              {failure && (
                <p role="alert" className="mono-small" style={{ margin: '8px 0 0', color: 'var(--danger-ink)' }}>
                  {failure}
                </p>
              )}
              <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: 'space-between' }}>
                <Button variant="ghost" size="sm" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>
                  <IconChevronLeft size={14} /> Paso anterior
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={current === steps.length - 1}
                  onClick={() => setCurrent((c) => c + 1)}
                >
                  Paso siguiente <IconChevronRight size={14} />
                </Button>
              </div>
            </section>
          )}
        </div>
      </CardPad>
    </Card>
  )
}
