// LessonMetaFields — panel derecho del editor de lección (fase4-autoria §9.F.3):
// metadatos de la faceta lección (título, id, módulo, orden, minutos) y las
// lecciones recomendadas. El `id` es de solo lectura al editar (patrón estable).
// El ejemplo pareado + source_code viven en el contenedor (solo en /nueva).
import { useId } from 'react'
import type { AdminModuleDto, AdminRecommendedDto } from '../../../api/admin-types'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { IconPlus } from '../../../components/icons/icons'

export interface LessonMeta {
  id: string
  module_id: string
  order: string
  title: string
  estimated_minutes: string
  recommended: AdminRecommendedDto[]
}

export interface LessonMetaFieldsProps {
  mode: 'create' | 'edit'
  value: LessonMeta
  modules: AdminModuleDto[]
  errors?: Readonly<Record<string, string>>
  onChange: (patch: Partial<LessonMeta>) => void
}

export function LessonMetaFields({ mode, value, modules, errors = {}, onChange }: LessonMetaFieldsProps) {
  const uid = useId()
  const err = (field: string): string | undefined => errors[field]

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
