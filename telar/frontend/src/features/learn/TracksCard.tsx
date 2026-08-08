// TracksCard — "Tu progreso" (frontend-spec §6.6): una fila por módulo con el
// % REAL derivado del `progress` fusionado de GET /modules.
import type { ModuleDto } from '../../api/types'
import { Card, CardPad } from '../../components/ui/Card'

export interface TracksCardProps {
  modules: ModuleDto[]
}

export function TracksCard({ modules }: TracksCardProps) {
  const sorted = [...modules].sort((a, b) => a.order - b.order)
  return (
    <Card className="tracks-card">
      <CardPad>
        <div className="eyebrow">Tu progreso</div>
        {sorted.map((mod) => {
          const total = mod.lessons.length
          const done = mod.lessons.filter((l) => l.progress.completed).length
          const pct = total > 0 ? Math.round((done / total) * 100) : 0
          return (
            <div key={mod.id} className="track-row">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{mod.title}</div>
                <span className="mono-small">{pct}%</span>
              </div>
              <div className="track-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="mono-small">
                {done} de {total} {total === 1 ? 'lección' : 'lecciones'}
              </div>
            </div>
          )
        })}
      </CardPad>
    </Card>
  )
}
