// SpeedupChart — resultados de ejemplos sweep (frontend-spec §8.2).
// SVG a mano (decisión §8: cero librerías), viewBox 520×260.
// Paleta de gráficas de tokens.css: observado var(--viz-observed) con área
// suave bajo la curva, ideal var(--viz-ideal) punteada, grid de 3 líneas
// sólidas var(--viz-grid) (0 / mitad / máx), labels var(--viz-label).
// Entrada escalonada de puntos con transition opacity .4s var(--ease)
// (suprimida globalmente con prefers-reduced-motion en base.css).
import { useEffect, useState } from 'react'
import type { SweepPointDto } from '../../api/types'

const W = 520
const H = 260
const PAD = { top: 18, right: 16, bottom: 34, left: 36 }

export interface SpeedupChartProps {
  /** Shape literal de parsed_timings.series (speedup/eficiencia del backend). */
  series: SweepPointDto[]
}

export function SpeedupChart({ series }: SpeedupChartProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  if (series.length === 0) return null
  const points = [...series].sort((a, b) => a.threads - b.threads)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  // Eje X categórico equiespaciado (1/2/4/8); eje Y speedup 0..8 (o el máx real).
  const yMax = Math.max(8, Math.ceil(Math.max(...points.map((p) => p.speedup), ...points.map((p) => p.threads))))
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1))
  const y = (v: number) => PAD.top + innerH - (Math.min(v, yMax) / yMax) * innerH

  const observedPts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.speedup).toFixed(1)}`)
  const observed = observedPts.join(' ')
  const ideal = points.map((p, i) => `${x(i).toFixed(1)},${y(p.threads).toFixed(1)}`).join(' ')
  // Grid mínimo (de-junk): 3 líneas sólidas = 0 / mitad / máx.
  const gridYs = Array.from({ length: 3 }, (_, i) => PAD.top + (i * innerH) / 2)
  const last = points[points.length - 1]
  // Área bajo la curva observada, cerrada contra el eje X.
  const baseline = (PAD.top + innerH).toFixed(1)
  const area = `M${x(0).toFixed(1)},${baseline} L${observedPts.join(' L')} L${x(points.length - 1).toFixed(1)},${baseline} Z`

  return (
    <div>
      <div className="legend-row">
        <span className="lg-dot" style={{ background: 'var(--viz-observed)' }} /> observado
        <span className="lg-dot" style={{ background: 'var(--viz-ideal)', marginLeft: 14 }} /> ideal
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Curva de speedup: máximo ${Math.max(...points.map((p) => p.speedup)).toFixed(1)}x`}
        style={{ display: 'block' }}
      >
        {gridYs.map((gy) => (
          <line key={gy} x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy} stroke="var(--viz-grid)" strokeWidth={1} />
        ))}
        {/* Eje Y: labels de speedup (0 / mitad / máx) */}
        {gridYs.map((gy, i) => (
          <text key={`yl${gy}`} x={PAD.left - 8} y={gy + 3} textAnchor="end" fontSize={11} fill="var(--viz-label)" fontFamily="var(--font-mono)">
            {(yMax - (i * yMax) / 2).toFixed(0)}×
          </text>
        ))}
        {/* Área bajo la curva observada (refuerzo sutil de la serie protagonista) */}
        <path d={area} fill="var(--viz-observed)" opacity={0.09} stroke="none" />
        {/* Ideal: recta punteada de referencia */}
        <polyline points={ideal} fill="none" stroke="var(--viz-ideal)" strokeWidth={1.6} strokeDasharray="3 4" />
        <text x={x(points.length - 1) - 8} y={y(last.threads) - 6} textAnchor="end" fontSize={10} fill="var(--viz-label)" fontFamily="var(--font-mono)">
          ideal
        </text>
        {/* Observado: polilínea protagonista con puntos y valor sobre cada punto */}
        <polyline points={observed} fill="none" stroke="var(--viz-observed)" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g
            key={p.threads}
            style={{
              opacity: mounted ? 1 : 0,
              transition: 'opacity .4s var(--ease)',
              transitionDelay: `${i * 90}ms`,
            }}
          >
            <circle cx={x(i)} cy={y(p.speedup)} r={i === points.length - 1 ? 5.5 : 4.5} fill="var(--viz-observed)" />
            <text x={x(i)} y={y(p.speedup) - 9} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text)" fontFamily="var(--font-mono)">
              {p.speedup.toFixed(1)}×
            </text>
          </g>
        ))}
        {/* Eje X: hilos */}
        {points.map((p, i) => (
          <text key={`xl${p.threads}`} x={x(i)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--viz-label)" fontFamily="var(--font-mono)">
            {p.threads} {p.threads === 1 ? 'hilo' : 'hilos'}
          </text>
        ))}
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="var(--viz-axis)" strokeWidth={1} />
      </svg>
      <div className="mono-small" style={{ marginTop: 6 }}>
        eficiencia a {last.threads} hilos: {Math.round(last.efficiency * 100)}%
      </div>
    </div>
  )
}
