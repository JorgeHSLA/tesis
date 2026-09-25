// LessonMetaFields — panel derecho del editor de lección (fase4-autoria §9.F.3):
// metadatos de la faceta lección (título, id, módulo, orden, minutos), cómo se
// completa (regla, video, habilitada) y las lecciones recomendadas. El `id` es
// de solo lectura al editar (patrón estable). El ejemplo + source_code viven en
// el contenedor.
import { useId } from 'react'
import type { AdminModuleDto, AdminRecommendedDto, CompletionRule } from '../../../api/admin-types'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { IconPlus } from '../../../components/icons/icons'

export interface LessonMeta {
  id: string
  module_id: string
  order: string
  title: string
  estimated_minutes: string
  /** Texto libre; vacío ⇒ `null` al guardar. El backend lo valida y normaliza. */
  video_url: string
  enabled: boolean
  completion_rule: CompletionRule
  recommended: AdminRecommendedDto[]
}

const RULE_OPTIONS: { id: CompletionRule; label: string }[] = [
  { id: 'quiz', label: 'Aprobar el quiz' },
  { id: 'viewed', label: 'Ver la lección' },
  { id: 'run', label: 'Ejecutar el ejemplo' },
]

export interface RuleIssue {
  /** `error` bloquea el guardado; `warning` solo avisa. */
  level: 'error' | 'warning'
  message: string
}

/**
 * CU-17.2 — ¿la regla se puede cumplir? `run` sin ejemplo es incoherente (el
 * backend también lo rechaza). `quiz` sin quiz es el estado normal mientras se
 * escribe la lección, así que solo avisa: el quiz se crea después.
 */
export function completionRuleIssue(
  rule: CompletionRule,
  { hasExample, hasQuiz }: { hasExample: boolean; hasQuiz: boolean },
): RuleIssue | null {
  if (rule === 'run' && !hasExample) {
    return {
      level: 'error',
      message: 'La regla «Ejecutar el ejemplo» exige que la lección tenga ejemplo ejecutable.',
    }
  }
  if (rule === 'quiz' && !hasQuiz) {
    return {
      level: 'warning',
      message: 'Esta lección aún no tiene quiz: crea el quiz después o elige otra regla.',
    }
  }
  return null
}

export interface LessonMetaFieldsProps {
  mode: 'create' | 'edit'
  value: LessonMeta
  modules: AdminModuleDto[]
  /** Para validar la regla de completitud. */
  hasExample: boolean
  hasQuiz: boolean
  errors?: Readonly<Record<string, string>>
  onChange: (patch: Partial<LessonMeta>) => void
}

export function LessonMetaFields({
  mode,
  value,
  modules,
  hasExample,
  hasQuiz,
  errors = {},
  onChange,
}: LessonMetaFieldsProps) {
  const uid = useId()
  const err = (field: string): string | undefined => errors[field]
  const ruleIssue = completionRuleIssue(value.completion_rule, { hasExample, hasQuiz })

  const setRec = (index: number, patch: Partial<AdminRecommendedDto>) => {
    onChange({
      recommended: value.recommended.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    })
  }
  const removeRec = (index: number) => {
    onChange({ recommended: value.recommended.filter((_, i) => i !== index) })
  }
  const addRec = () => {
    onChange({ recommended: [...value.recommended, { lesson_id: '', label: '', tag: '' }] })
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <Field label="Título" htmlFor={`${uid}-title`} error={err('title')}>
        <input
          id={`${uid}-title`}
          className="input"
          value={value.title}
          onChange={(e) => onChange({ title: e.currentTarget.value })}
        />
      </Field>

      <Field
        label="Identificador"
        htmlFor={`${uid}-id`}
        hint={mode === 'edit' ? 'No editable' : 'Ej.: intro-hilos (letras, números, - y _)'}
        error={err('id')}
      >
        <input
          id={`${uid}-id`}
          className="input"
          value={value.id}
          readOnly={mode === 'edit'}
          spellCheck={false}
          onChange={(e) => onChange({ id: e.currentTarget.value })}
        />
      </Field>

      <Field label="Módulo" htmlFor={`${uid}-module`} error={err('module_id')}>
        <select
          id={`${uid}-module`}
          className="select"
          value={value.module_id}
          onChange={(e) => onChange({ module_id: e.currentTarget.value })}
        >
          <option value="" disabled>
            Selecciona un módulo…
          </option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              #{m.order} · {m.title}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Orden" htmlFor={`${uid}-order`} error={err('order')}>
          <input
            id={`${uid}-order`}
            className="input"
            type="number"
            min={1}
            value={value.order}
            onChange={(e) => onChange({ order: e.currentTarget.value })}
          />
        </Field>
        <Field label="Minutos estimados" htmlFor={`${uid}-min`} error={err('estimated_minutes')}>
          <input
            id={`${uid}-min`}
            className="input"
            type="number"
            min={0}
            value={value.estimated_minutes}
            onChange={(e) => onChange({ estimated_minutes: e.currentTarget.value })}
          />
        </Field>
      </div>

      {/* ── Cómo se completa (CU-17.2) ───────────────────────────────────── */}
      <Field
        label="Regla de completitud"
        htmlFor={`${uid}-rule`}
        error={err('completion_rule') ?? (ruleIssue?.level === 'error' ? ruleIssue.message : undefined)}
        hint={
          ruleIssue?.level === 'warning' ? (
            <span className="admin-hint-warn" role="status">
              {ruleIssue.message}
            </span>
          ) : (
            'Qué debe hacer el estudiante para completarla.'
          )
        }
      >
        <select
          id={`${uid}-rule`}
          className="select"
          value={value.completion_rule}
          onChange={(e) => onChange({ completion_rule: e.currentTarget.value as CompletionRule })}
        >
          {RULE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Video (YouTube)"
        htmlFor={`${uid}-video`}
        hint="Opcional. Enlace de YouTube (puede ser no listado)."
        error={err('video_url')}
      >
        <input
          id={`${uid}-video`}
          className="input"
          type="url"
          value={value.video_url}
          placeholder="https://youtu.be/…"
          spellCheck={false}
          onChange={(e) => onChange({ video_url: e.currentTarget.value })}
        />
      </Field>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ enabled: e.currentTarget.checked })}
        />
        <span>Lección habilitada</span>
      </label>

      {/* ── Lecciones recomendadas ────────────────────────────────────────── */}
      <div role="group" aria-labelledby={`${uid}-rec`}>
        <div className="field-label" id={`${uid}-rec`}>
          Lecciones recomendadas
        </div>
        <div className="col" style={{ gap: 10 }}>
          {value.recommended.length === 0 && (
            <p className="mono-small muted" style={{ margin: 0 }}>
              Sin recomendaciones. Añade lecciones sugeridas al final.
            </p>
          )}
          {value.recommended.map((rec, index) => (
            <div key={index} className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  className="input"
                  value={rec.lesson_id}
                  placeholder="id de la lección"
                  aria-label={`Recomendada ${index + 1}: id`}
                  spellCheck={false}
                  onChange={(e) => setRec(index, { lesson_id: e.currentTarget.value })}
                />
                <input
                  className="input"
                  value={rec.tag}
                  placeholder="etiqueta (p. ej. Siguiente)"
                  aria-label={`Recomendada ${index + 1}: etiqueta`}
                  onChange={(e) => setRec(index, { tag: e.currentTarget.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  value={rec.label}
                  placeholder="texto visible"
                  aria-label={`Recomendada ${index + 1}: texto`}
                  onChange={(e) => setRec(index, { label: e.currentTarget.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="admin-btn-danger-ghost"
                  aria-label={`Quitar recomendada ${index + 1}`}
                  onClick={() => removeRec(index)}
                >
                  Quitar
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button variant="outline" size="sm" onClick={addRec}>
              <IconPlus size={14} />
              Añadir recomendada
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
