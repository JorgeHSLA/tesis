// MiniBar — port del handoff (§5.8): contenedor 18px (14px en v2) con fill
// coloreado y label del % dentro a la derecha. Colores de tokens:
// CPU var(--viz-cpu) (por defecto), memoria var(--viz-mem) donde aplique.
export interface MiniBarProps {
  /** 0..100. */
  pct: number
  color?: string
  /** Label dentro de la barra; por defecto `{n}%`. */
  label?: string
}

export function MiniBar({ pct, color = 'var(--viz-cpu)', label }: MiniBarProps) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div
      className="mini-bar"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <div className="mini-bar-fill" style={{ width: `${clamped}%`, background: color }} />
      <span className="mini-bar-label">{label ?? `${Math.round(clamped)}%`}</span>
    </div>
  )
}
