// MarkReadCard — «Marcar como leída» (S2 · CU-02.4). Solo se monta en lecciones
// con completion_rule 'viewed' que cuentan para el progreso: es la única vía
// que las completa. PUT {viewed:true, completed:true} → hydrate (progressStore).
import { useState } from 'react'
import { IconCheck } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Card, CardPad } from '../../components/ui/Card'
import { useProgressStore } from '../../stores/progressStore'

export interface MarkReadCardProps {
  lessonId: string
  completed: boolean
}

export function MarkReadCard({ lessonId, completed }: MarkReadCardProps) {
  const markRead = useProgressStore((s) => s.markRead)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const onClick = () => {
    if (saving) return
    setSaving(true)
    setFailed(false)
    markRead(lessonId)
      .catch(() => setFailed(true))
      .finally(() => setSaving(false))
  }

  return (
    <Card className="mark-read-card">
      <CardPad>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>
            {completed
              ? 'Lección completada.'
              : 'Esta lección se completa al leerla. Márcala cuando termines.'}
          </span>
          {completed ? (
            <span className="mono-small row" style={{ gap: 6 }}>
              <IconCheck size={12} /> Leída
            </span>
          ) : (
            <Button variant="primary" size="sm" disabled={saving} onClick={onClick}>
              {saving ? 'Guardando…' : 'Marcar como leída'}
            </Button>
          )}
        </div>
        {failed && (
          <p role="alert" className="mono-small" style={{ margin: '8px 0 0', color: 'var(--danger-ink)' }}>
            No se pudo guardar. Comprueba la conexión e inténtalo de nuevo.
          </p>
        )}
      </CardPad>
    </Card>
  )
}
