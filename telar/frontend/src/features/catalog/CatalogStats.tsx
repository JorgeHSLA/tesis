// CatalogStats — strip de 4 stats COMPUTADAS del `summary` de GET /modules
// (frontend-spec §6.5): jamás hardcodeadas.
import type { ModulesSummaryDto } from '../../api/types'

export interface CatalogStatsProps {
  summary: ModulesSummaryDto
  moduleCount: number
}

export function CatalogStats({ summary, moduleCount }: CatalogStatsProps) {
  const stats: Array<{ n: string; label: string }> = [
    { n: `${summary.lessons_completed}/${summary.lessons_total}`, label: 'Lecciones completadas' },
    { n: String(summary.lessons_total), label: 'Ejemplos' },
    { n: String(summary.quizzes_total), label: 'Quizzes' },
    { n: String(moduleCount), label: 'Módulos' },
  ]
  return (
    <div className="catalog-stats">
      {stats.map((s) => (
        <div key={s.label} className="cstat">
          <div className="cstat-n">{s.n}</div>
          <div className="cstat-l">{s.label}</div>
        </div>
      ))}
    </div>
  )
}
