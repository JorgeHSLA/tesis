// LessonSidebar — lecciones del módulo actual (frontend-spec §6.6): estados
// done/current del `progress` de /modules, meta ~est_run_seconds s /
// {n} preguntas, now-dot pulsante en la lección actual.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ExampleSummaryDto, ModuleDto } from '../../api/types'
import { IconCheck, IconChevronRight, IconHelp, IconLayers, IconPlay } from '../../components/icons/icons'
import { Card } from '../../components/ui/Card'

export interface LessonSidebarProps {
  module: ModuleDto
  currentLessonId: string
  examplesIndex: Map<string, ExampleSummaryDto> | null
}

export function LessonSidebar({ module, currentLessonId, examplesIndex }: LessonSidebarProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const lessons = [...module.lessons].sort((a, b) => a.order - b.order)
  const done = lessons.filter((l) => l.progress.completed).length
  const pct = lessons.length > 0 ? Math.round((done / lessons.length) * 100) : 0

  return (
    <Card className="module-card">
      <button
        type="button"
        className={`module-head module-head-btn ${open ? 'open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span className="module-eyebrow">
            <IconLayers size={12} />
            <span>
              Módulo {module.order} · {lessons.length} {lessons.length === 1 ? 'lección' : 'lecciones'}
            </span>
          </span>
          <h3 className="module-title">{module.title}</h3>
          <span className="module-progress-row">
            <span className="module-progress-bar">
              <span style={{ display: 'block', width: `${pct}%`, height: '100%' }} />
            </span>
            <span className="mono-small">
              {done}/{lessons.length}
            </span>
          </span>
        </span>
        <IconChevronRight size={18} className="module-chev" />
      </button>
      {open && (
        <div className="lesson-sidebar">
          {lessons.map((lesson, i) => {
            const current = lesson.id === currentLessonId
            const isDone = lesson.progress.completed
            const est =
              lesson.example_id != null
                ? examplesIndex?.get(lesson.example_id)?.est_run_seconds
                : undefined
            return (
              <button
                key={lesson.id}
                type="button"
                className={`lesson-side ${current ? 'current' : ''}${isDone ? ' done' : ''}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => navigate(`/cursos/${lesson.id}`)}
              >
                <span className="lesson-num-badge">
                  {isDone ? <IconCheck size={11} /> : <span className="mono">{String(i + 1).padStart(2, '0')}</span>}
                </span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span className="lesson-side-title" style={{ display: 'block' }}>
                    {lesson.title}
                  </span>
                  <span className="lesson-side-meta mono-small">
                    <IconPlay size={9} /> {est != null ? `~${est}s` : '—'}
                    {lesson.has_quiz && (
                      <>
                        {' · '}
                        <IconHelp size={9} /> {lesson.quiz_question_count} preguntas
                      </>
                    )}
                  </span>
                </span>
                {current && <span className="now-dot" />}
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}
