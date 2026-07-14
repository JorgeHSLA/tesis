// SuggestedLessons — card "Lecciones sugeridas" del Home (frontend-spec §6.1):
// 3 lecciones derivadas del `progress` FUSIONADO de GET /modules — la primera
// con viewed && !completed y las 2 siguientes no completadas. Vacío imposible
// (contenido estático del backend).
import { useNavigate } from 'react-router-dom'
import type { ModuleDto, ModuleLessonDto } from '../../api/types'
import { IconBook, IconChevronRight, IconPlay } from '../../components/icons/icons'
import { Card, CardHead } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'

interface Suggested {
  lesson: ModuleLessonDto
  moduleTitle: string
}

/** 1ª: viewed && !completed; luego las siguientes no completadas (orden del curso). */
export function suggestLessons(modules: ModuleDto[]): Suggested[] {
  const flat: Suggested[] = [...modules]
    .sort((a, b) => a.order - b.order)
    .flatMap((mod) =>
      [...mod.lessons]
        .sort((a, b) => a.order - b.order)
        .filter((l) => l.enabled)
        .map((lesson) => ({ lesson, moduleTitle: mod.title })),
    )
  const started = flat.find((s) => s.lesson.progress.viewed && !s.lesson.progress.completed)
  const rest = flat.filter((s) => !s.lesson.progress.completed && s.lesson.id !== started?.lesson.id)
  return [...(started ? [started] : []), ...rest].slice(0, 3)
}

export interface SuggestedLessonsProps {
  modules: ModuleDto[] | null
}

export function SuggestedLessons({ modules }: SuggestedLessonsProps) {
  const navigate = useNavigate()
  const suggestions = modules ? suggestLessons(modules) : null

  return (
    <Card>
      <CardHead icon={<IconBook size={16} />} title="Lecciones sugeridas" />
      <div className="lesson-list">
        {suggestions === null && (
          <div className="col" style={{ gap: 8, padding: 8 }} aria-hidden="true">
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        )}
        {suggestions?.map(({ lesson, moduleTitle }) => (
          <button
            key={lesson.id}
            type="button"
            className="lesson-row"
            onClick={() => navigate(`/cursos/${lesson.id}`)}
          >
            <span className="lesson-thumb">
              <span className="lesson-thumb-play">
                <IconPlay size={12} />
              </span>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="lesson-title" style={{ display: 'block' }}>
                {lesson.title}
              </span>
              <span className="mono-small">
                {moduleTitle} · {lesson.estimated_minutes} min
              </span>
            </span>
            <IconChevronRight size={16} className="muted" />
          </button>
        ))}
      </div>
    </Card>
  )
}
