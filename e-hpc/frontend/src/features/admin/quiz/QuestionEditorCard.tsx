// QuestionEditorCard — una pregunta del quiz en el editor de autoría (§9.F.4):
// enunciado, 2–4 opciones con un radio que marca la `correct_key`, explicación,
// reordenar (▲▼) y borrar. No muta: cada cambio delega en `onChange` con el
// parche correspondiente; el padre recompone la lista inmutable.
import { useId } from 'react'
import type { AdminQuizOptionDto, AdminQuizQuestionDto } from '../../../api/admin-types'
import type { QuizOptionKey } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { IconChevronRight, IconPlus } from '../../../components/icons/icons'

const KEYS: QuizOptionKey[] = ['a', 'b', 'c', 'd']

/** Recalcula las claves a|b|c|d por posición tras añadir/quitar opciones. */
function reKey(options: AdminQuizOptionDto[]): AdminQuizOptionDto[] {
  return options.map((opt, i) => ({ ...opt, key: KEYS[i] }))
}

export interface QuestionEditorCardProps {
  question: AdminQuizQuestionDto
  index: number
  total: number
  onChange: (patch: Partial<AdminQuizQuestionDto>) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}

export function QuestionEditorCard({
  question,
  index,
  total,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QuestionEditorCardProps) {
  const uid = useId()
  const { options } = question

  const setOptionText = (optIndex: number, text: string) => {
    onChange({ options: options.map((o, i) => (i === optIndex ? { ...o, text } : o)) })
  }
  const addOption = () => {
    if (options.length >= 4) return
    onChange({ options: reKey([...options, { key: 'a', text: '' }]) })
  }
  const removeOption = (optIndex: number) => {
    if (options.length <= 2) return
    const next = reKey(options.filter((_, i) => i !== optIndex))
    // La `correct_key` se reajusta al recompactar claves: si se borró la
    // opción correcta recae en la primera; si no, sigue a su opción original.
    let correct_key: QuizOptionKey
    if (options[optIndex].key === question.correct_key) {
      correct_key = next[0].key
    } else {
      const oldIdx = options.findIndex((o) => o.key === question.correct_key)
      const newIdx = oldIdx > optIndex ? oldIdx - 1 : oldIdx
      correct_key = next[newIdx]?.key ?? next[0].key
    }
    onChange({ options: next, correct_key })
  }

  return (
    <article className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="mono-small muted">Pregunta {index + 1}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Subir pregunta ${index + 1}`}
            disabled={index === 0}
            onClick={onMoveUp}
          >
            <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }} aria-hidden="true">
              <IconChevronRight size={14} />
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Bajar pregunta ${index + 1}`}
            disabled={index === total - 1}
            onClick={onMoveDown}
          >
            <span style={{ display: 'inline-flex', transform: 'rotate(90deg)' }} aria-hidden="true">
              <IconChevronRight size={14} />
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="admin-btn-danger-ghost"
            aria-label={`Borrar pregunta ${index + 1}`}
            onClick={onRemove}
          >
            Borrar
          </Button>
        </div>
      </div>

      <Field label="Enunciado" htmlFor={`${uid}-text`}>
        <textarea
          id={`${uid}-text`}
          className="textarea"
          rows={2}
          value={question.text}
          onChange={(e) => onChange({ text: e.currentTarget.value })}
        />
      </Field>

      <div role="radiogroup" aria-label={`Opciones de la pregunta ${index + 1}`}>
        <div className="field-label">Opciones (marca la correcta)</div>
        <div className="col" style={{ gap: 8 }}>
          {options.map((opt, optIndex) => (
            <div key={opt.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="radio"
                name={`${uid}-correct`}
                checked={question.correct_key === opt.key}
                aria-label={`Marcar opción ${opt.key.toUpperCase()} como correcta`}
                onChange={() => onChange({ correct_key: opt.key })}
              />
              <span className="mono-small" style={{ width: 16 }}>
                {opt.key})
              </span>
              <input
                className="input"
                value={opt.text}
                aria-label={`Texto de la opción ${opt.key.toUpperCase()}`}
                onChange={(e) => setOptionText(optIndex, e.currentTarget.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="admin-btn-danger-ghost"
                disabled={options.length <= 2}
                aria-label={`Quitar opción ${opt.key.toUpperCase()}`}
                onClick={() => removeOption(optIndex)}
              >
                Quitar
              </Button>
            </div>
          ))}
        </div>
        {options.length < 4 && (
          <div style={{ marginTop: 8 }}>
            <Button variant="outline" size="sm" onClick={addOption}>
              <IconPlus size={14} />
              Añadir opción
            </Button>
          </div>
        )}
      </div>

      <Field label="Explicación" htmlFor={`${uid}-exp`} hint="Se muestra tras el intento del estudiante.">
        <textarea
          id={`${uid}-exp`}
          className="textarea"
          rows={2}
          value={question.explanation}
          onChange={(e) => onChange({ explanation: e.currentTarget.value })}
        />
      </Field>
    </article>
  )
}
