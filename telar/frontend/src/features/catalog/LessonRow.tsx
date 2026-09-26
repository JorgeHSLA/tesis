// LessonRow — fila de lección dentro del acordeón (frontend-spec §6.5). UNA
// fila por lección, con las metas de lo que contiene: el ejemplo
// (`Ejemplo · ~{n}s`) y, si lo tiene, el quiz (`Quiz · {n} preguntas`).
//
// F2 (2026-08): antes cada lección se pintaba DOS veces —una fila «Ejemplo» y
// otra «Quiz»— que iban a la misma pantalla y solo cambiaban el ancla. El acceso
// directo al quiz lo da ahora el filtro (`anchorQuiz`), sin duplicar nada.
//
// Estados done/current del handoff §7.5 (done = progress.completed).
import { useNavigate } from 'react-router-dom'
import type { ModuleLessonDto } from '../../api/types'
import { IconCheck, IconChevronRight, IconHelp, IconPlay } from '../../components/icons/icons'
import { Chip } from '../../components/ui/Chip'

export interface LessonRowProps {
  lesson: ModuleLessonDto
  /** Posición 1-based de la lección dentro del módulo. */
  index: number
  /** est_run_seconds del ejemplo asociado (índice de /examples). */
  estRunSeconds: number | undefined
  current: boolean
  /** Filas deshabilitadas (M8 sin GPU, frontend-spec §6.5). */
  disabled: boolean
  /** true → al abrir, anclar en la sección del quiz de la lección. */
  anchorQuiz?: boolean
}

export function LessonRow({
  lesson,
  index,
  estRunSeconds,
  current,
  disabled,
  anchorQuiz = false,
}: LessonRowProps) {
  const navigate = useNavigate()
  const done = lesson.progress.completed
  const cls = ['cat-lesson', current ? 'current' : '', done ? 'done' : ''].filter(Boolean).join(' ')
  const hasExample = lesson.example_id !== null

  const open = () => {
    navigate(`/aprender/${lesson.id}`, anchorQuiz ? { state: { anchor: 'quiz' } } : undefined)
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
      <span className={`cat-lesson-icon ${hasExample ? 'example' : 'quiz'}`}>
        {hasExample ? <IconPlay size={13} /> : <IconHelp size={13} />}
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
          {/* `~{n} min` es tiempo de LECTURA (estimated_minutes, C4);
              `~{n}s` es tiempo de EJECUCIÓN del ejemplo. No son lo mismo. */}
          ~{lesson.estimated_minutes} min
          {lesson.kind === 'taller' && <> · Taller</>}
          {hasExample && <> · Ejemplo · {estRunSeconds != null ? `~${estRunSeconds}s` : '—'}</>}
          {lesson.has_quiz && <> · Quiz · {lesson.quiz_question_count} preguntas</>}
          {done && <span className="done-mark"> · Completado</span>}
        </span>
      </span>
      <IconChevronRight size={14} className="muted" />
    </button>
  )
}
