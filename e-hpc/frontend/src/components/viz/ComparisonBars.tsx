// ComparisonBars — resultados de ejemplos kind "pair" (frontend-spec §8.3).
// Reutiliza el layout del WorkDistributionChart del handoff (§6.3): filas
// grid label+track, track 26px radius 4, barras con transition width .4s
// var(--ease). Paleta de tokens.css: OpenMP var(--viz-cpu) (terracota),
// referencia var(--viz-mem) (naranja).
import { useEffect, useState } from 'react'

export interface ComparisonBarsProps {
  /** Shape de parsed_timings kind "pair". */
  parallel_time_s: number
  reference_time_s: number
  /** "numpy" | "blas" | "serial". */
  reference_label: string
}

interface Row {
  label: string
  time: number
  color: string
}

export function ComparisonBars({ parallel_time_s, reference_time_s, reference_label }: ComparisonBarsProps) {
  // Arranca en 0 y transiciona al ancho real (width .4s var(--ease)).
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const rows: Row[] = [
    { label: 'openmp', time: parallel_time_s, color: 'var(--viz-cpu)' },
    { label: reference_label, time: reference_time_s, color: 'var(--viz-mem)' },
  ]
  const maxTime = Math.max(...rows.map((r) => r.time), 1e-9)

  return (
    <div>
      <div className="legend-row">
        <span className="lg-dot" style={{ background: 'var(--viz-cpu)' }} /> OpenMP
        <span className="lg-dot" style={{ background: 'var(--viz-mem)', marginLeft: 14 }} /> {reference_label}
      </div>
      <div className="bar-chart" role="img" aria-label={`OpenMP ${parallel_time_s}s frente a ${reference_label} ${reference_time_s}s`}>
        {rows.map((r) => (
          <div key={r.label} className="bar-row">
            <span className="bar-label">{r.label}</span>
            <div className="bar-track">
              <div
                className="bar"
                style={{ width: grown ? `${(r.time / maxTime) * 100}%` : '0%', background: r.color }}
              >
                {r.time.toFixed(3)} s
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
