// RecommendedCard — "Recomendado para ti" (frontend-spec §6.6): lecciones del
// campo `recommended[]` de GET /lessons/{id} (estáticas del catálogo). Si el
// array viene vacío, la card no se renderiza.
import { useNavigate } from 'react-router-dom'
import type { RecommendedLessonDto } from '../../api/types'
import { IconBook, IconChevronRight, IconPlay } from '../../components/icons/icons'
import { Card } from '../../components/ui/Card'

export interface RecommendedCardProps {
  recommended: RecommendedLessonDto[]
}

export function RecommendedCard({ recommended }: RecommendedCardProps) {
  const navigate = useNavigate()
  if (recommended.length === 0) return null

  return (
    <Card className="reco-card">
      <div className="reco-head">
        <div className="reco-eyebrow">
          <IconBook size={12} />
          <span>Recomendado para ti</span>
        </div>
        <h3 className="reco-title">Sigue explorando</h3>
      </div>
      <div className="reco-list">
        {recommended.map((r) => (
          <button key={r.lesson_id} type="button" className="reco-item" onClick={() => navigate(`/cursos/${r.lesson_id}`)}>
            <span className="reco-thumb">
              <IconPlay size={13} />
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span className="reco-item-title" style={{ display: 'block' }}>
                {r.label}
              </span>
              <span className="reco-item-meta">
                <span className={`reco-tag reco-tag-${r.tag.toLowerCase()}`}>{r.tag}</span>
              </span>
            </span>
            <IconChevronRight size={14} className="muted" />
          </button>
        ))}
      </div>
    </Card>
  )
}
