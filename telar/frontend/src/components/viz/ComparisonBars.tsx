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
  /** Tinta del valor impreso DENTRO de la barra: depende del relleno de la
   *  serie, no del tema (los tokens ya se invierten solos). */
  ink: string
}

const REFERENCE_NAMES: Record<string, string> = {
  numpy: 'NumPy (referencia)',
  blas: 'BLAS (referencia)',
  serial: 'Serial (1 hilo)',
}

export function ComparisonBars({ parallel_time_s, reference_time_s, reference_label }: ComparisonBarsProps) {
  // Arranca en 0 y transiciona al ancho real (width .4s var(--ease)).
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Nombres que se entienden (antes «openmp» y «numpy» a secas).
  const refName = REFERENCE_NAMES[reference_label] ?? reference_label
  const rows: Row[] = [
    { label: 'OpenMP (paralelo)', time: parallel_time_s, color: 'var(--viz-cpu)', ink: 'var(--viz-cpu-ink)' },
    { label: refName, time: reference_time_s, color: 'var(--viz-mem)', ink: 'var(--viz-mem-ink)' },
  ]
  const times = parallel_time_s > 0 ? reference_time_s / parallel_time_s : 0
  const maxTime = Math.max(...rows.map((r) => r.time), 1e-9)

  return (
    <div>
      <div className="legend-row">
        <span className="lg-dot" style={{ background: 'var(--viz-cpu)' }} /> OpenMP (tu versión paralela)
        <span className="lg-dot" style={{ background: 'var(--viz-mem)', marginLeft: 14 }} /> {refName}
      </div>
      <div className="bar-chart" role="img" aria-label={`OpenMP ${parallel_time_s}s frente a ${reference_label} ${reference_time_s}s`}>
        {rows.map((r) => (
          <div key={r.label} className="bar-row">
            <span className="bar-label">{r.label}</span>
            <div className="bar-track">
              <div
                className="bar"
                style={{ width: grown ? `${(r.time / maxTime) * 100}%` : '0%', background: r.color, color: r.ink }}
              >
                {r.time.toFixed(3)} s
              </div>
            </div>
          </div>
        ))}
      </div>
      {times > 0 && (
        <p className="chart-takeaway">
          {times >= 1
            ? `OpenMP fue ${times.toFixed(1)}× más rápido que ${refName}.`
            : `OpenMP fue ${(1 / times).toFixed(1)}× más lento que ${refName}: con poco trabajo, crear el equipo de hilos cuesta más de lo que ahorra.`}
        </p>
      )}
    </div>
  )
}
