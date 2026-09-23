// ContinueCard — "Continuar donde lo dejaste" (frontend-spec §6.5): título de
// la lección destino + meta módulo · ~est_run_seconds s + `Reanudar`/`Empezar`.
// S2: el destino es la última visitada si sigue disponible y, si no, la primera
// disponible del curso (lessonTarget); nunca un id fijo.
import { useNavigate } from 'react-router-dom'
import type { ExampleSummaryDto, ModuleDto } from '../../api/types'
import { IconLayers, IconPlay } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { lessonTarget } from '../../stores/progressStore'

export interface ContinueCardProps {
  modules: ModuleDto[]
  lastLessonId: string | null
  /** Índice id→ejemplo (est_run_seconds); null mientras carga. */
  examplesIndex: Map<string, ExampleSummaryDto> | null
}

export function ContinueCard({ modules, lastLessonId, examplesIndex }: ContinueCardProps) {
  const navigate = useNavigate()
  const target = lessonTarget(modules, lastLessonId)
  if (target == null) return null // catálogo sin lecciones disponibles

  const { module, lesson, resumed } = target
  // E1: una lección conceptual no tiene ejemplo, así que tampoco tiene tiempo
  // de ejecución que anunciar.
  const est = lesson.example_id != null ? examplesIndex?.get(lesson.example_id)?.est_run_seconds : undefined

  return (
    <div className="catalog-continue card">
      <div className="eyebrow">{resumed ? 'Continuar donde lo dejaste' : 'Empieza por aquí'}</div>
      <div className="continue-title">{lesson.title}</div>
      <div className="continue-meta mono-small">
        <IconLayers size={11} /> {module.title} · <IconPlay size={9} /> {est != null ? `~${est}s` : '—'}
      </div>
      <Button variant="primary" size="sm" style={{ marginTop: 10 }} onClick={() => navigate(`/aprender/${lesson.id}`)}>
        <IconPlay size={13} /> {resumed ? 'Reanudar' : 'Empezar'}
      </Button>
    </div>
  )
}
