// MetricCard — port del handoff (§5.6): icono 32×32 orange-50, label mono
// uppercase, value Fraunces 22, hint mono-small y barra .metric-progress
// opcional (transición width .6s var(--ease)).
import type { ReactNode } from 'react'

export interface MetricCardProps {
  icon: ReactNode
  label: ReactNode
  value: ReactNode
  /** Hint bajo el value (mono-small) — texto o nodo (p. ej. Sparkline). */
  hint?: ReactNode
  /** 0..100 → renderiza la barra .metric-progress. */
  progressPct?: number
}

export function MetricCard({ icon, label, value, hint, progressPct }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        {hint != null && <div className="mono-small">{hint}</div>}
        {progressPct != null && (
          <div className="metric-progress">
            <div style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
