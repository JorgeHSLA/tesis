// ContinueCard — "Continuar donde lo dejaste" (frontend-spec §6.5): título de
// progressStore.lastLessonId + meta módulo · ~est_run_seconds s + `Reanudar`.
// Sin progreso: `¿Qué es el paralelismo?` + `Empezar` → primerEjemplo (ID
// LITERAL del catálogo, jamás slugificar).
import { useNavigate } from 'react-router-dom'
import type { ExampleSummaryDto, ModuleDto } from '../../api/types'
import { IconLayers, IconPlay } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'

export interface ContinueCardProps {
  modules: ModuleDto[]
  lastLessonId: string | null
  /** Índice id→ejemplo (est_run_seconds); null mientras carga. */
  examplesIndex: Map<string, ExampleSummaryDto> | null
}

export function ContinueCard({ modules, lastLessonId, examplesIndex }: ContinueCardProps) {
  const navigate = useNavigate()

  const mod = lastLessonId ? modules.find((m) => m.lessons.some((l) => l.id === lastLessonId)) : undefined
  const lesson = mod?.lessons.find((l) => l.id === lastLessonId)
  const hasProgress = mod != null && lesson != null

  const targetId = hasProgress ? lesson.id : 'primerEjemplo'
  const title = hasProgress ? lesson.title : '¿Qué es el paralelismo?'
  const moduleTitle = hasProgress ? mod.title : 'Fundamentos'
  const exampleId = hasProgress ? lesson.example_id : 'primerEjemplo'
  const est = examplesIndex?.get(exampleId)?.est_run_seconds

  return (
    <div className="catalog-continue card">
      <div className="eyebrow">Continuar donde lo dejaste</div>
      <div className="continue-title">{title}</div>
      <div className="continue-meta mono-small">
        <IconLayers size={11} /> {moduleTitle} · <IconPlay size={9} /> {est != null ? `~${est}s` : '—'}
      </div>
      <Button variant="primary" size="sm" style={{ marginTop: 10 }} onClick={() => navigate(`/cursos/${targetId}`)}>
        <IconPlay size={13} /> {hasProgress ? 'Reanudar' : 'Empezar'}
      </Button>
    </div>
  )
}
