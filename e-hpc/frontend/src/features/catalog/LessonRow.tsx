// LessonRow — fila de lección dentro del acordeón (frontend-spec §6.5): por
// lección hay DOS filas — ejemplo (`Ejemplo · ~{n}s`) y quiz
// (`Quiz · {n} preguntas`). Estados done/current del handoff §7.5 con el fix
// `--success` (done = progress.completed). Click → /cursos/{id} (el quiz
// ancla a la sección quiz).
import { useNavigate } from 'react-router-dom'
import type { ModuleLessonDto } from '../../api/types'
import { IconCheck, IconChevronRight, IconHelp, IconPlay } from '../../components/icons/icons'
import { Chip } from '../../components/ui/Chip'

export interface LessonRowProps {
  lesson: ModuleLessonDto
  kind: 'example' | 'quiz'
  /** Posición 1-based de la lección dentro del módulo. */
  index: number
  /** est_run_seconds del ejemplo asociado (índice de /examples). */
  estRunSeconds: number | undefined
  current: boolean
  /** Filas deshabilitadas (M8 sin GPU, frontend-spec §6.5). */
  disabled: boolean
}

export function LessonRow({ lesson, kind, index, estRunSeconds, current, disabled }: LessonRowProps) {
  const navigate = useNavigate()
  const done = lesson.progress.completed
  const cls = ['cat-lesson', current ? 'current' : '', done ? 'done' : ''].filter(Boolean).join(' ')

  const open = () => {
    navigate(`/cursos/${lesson.id}`, kind === 'quiz' ? { state: { anchor: 'quiz' } } : undefined)
  }

  return (
    <button type="button" className={cls} onClick={open} disabled={disabled} aria-disabled={disabled}>
      <span className="cat-lesson-num">
        {done ? (
          <span className="num-badge done">
            <IconCheck size={11} />
          </span>
        ) : (
          <span className={`num-badge ${current ? 'current' : ''}`}>
            <span className="mono-small">{String(index).padStart(2, '0')}</span>
          </span>
        )}
      </span>
      <span className={`cat-lesson-icon ${kind}`}>
        {kind === 'example' ? <IconPlay size={13} /> : <IconHelp size={13} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span className="cat-lesson-title" style={{ display: 'block' }}>
          {lesson.title}
          {current && (
            <Chip tone="orange" style={{ marginLeft: 8, fontSize: 10 }}>
              En curso
            </Chip>
          )}
        </span>
        <span className="cat-lesson-meta mono-small" style={{ display: 'block' }}>
          {kind === 'example' ? (
            <>Ejemplo · {estRunSeconds != null ? `~${estRunSeconds}s` : '—'}</>
          ) : (
            <>Quiz · {lesson.quiz_question_count} preguntas</>
          )}
          {done && <span className="done-mark"> · Completado</span>}
        </span>
      </span>
      <IconChevronRight size={14} className="muted" />
    </button>
  )
}
