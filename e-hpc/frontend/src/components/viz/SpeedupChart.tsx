// SpeedupChart — resultados de ejemplos sweep (frontend-spec §8.2).
// SVG a mano (decisión §8: cero librerías), viewBox 520×260, mono 10-11px,
// colores exactos §1.6: ideal #D4C4A0 punteada, observado #F57324, grid #E9DFC9.
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

  const observed = points.map((p, i) => `${x(i).toFixed(1)},${y(p.speedup).toFixed(1)}`).join(' ')
  const ideal = points.map((p, i) => `${x(i).toFixed(1)},${y(p.threads).toFixed(1)}`).join(' ')
  const gridYs = Array.from({ length: 5 }, (_, i) => PAD.top + (i * innerH) / 4)
  const last = points[points.length - 1]

  return (
    <div>
      <div className="legend-row">
        <span className="lg-dot" style={{ background: '#F57324' }} /> observado
        <span className="lg-dot" style={{ background: '#D4C4A0', marginLeft: 14 }} /> ideal
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Curva de speedup: máximo ${Math.max(...points.map((p) => p.speedup)).toFixed(1)}x`}
        style={{ display: 'block' }}
      >
        {gridYs.map((gy) => (
          <line key={gy} x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy} stroke="#E9DFC9" strokeWidth={1} strokeDasharray="3 4" />
        ))}
        {/* Eje Y: labels de speedup */}
        {gridYs.map((gy, i) => (
          <text key={`yl${gy}`} x={PAD.left - 8} y={gy + 3} textAnchor="end" fontSize={10} fill="#A08B6E" fontFamily="var(--font-mono)">
            {(yMax - (i * yMax) / 4).toFixed(0)}×
          </text>
        ))}
        {/* Ideal: recta punteada #D4C4A0 */}
        <polyline points={ideal} fill="none" stroke="#D4C4A0" strokeWidth={1.5} strokeDasharray="3 4" />
        <text x={x(points.length - 1) - 8} y={y(last.threads) - 6} textAnchor="end" fontSize={10} fill="#A08B6E" fontFamily="var(--font-mono)">
          ideal
        </text>
        {/* Observado: polilínea naranja con puntos y valor sobre cada punto */}
        <polyline points={observed} fill="none" stroke="#F57324" strokeWidth={2} />
        {points.map((p, i) => (
          <g
            key={p.threads}
            style={{
              opacity: mounted ? 1 : 0,
              transition: 'opacity .4s var(--ease)',
              transitionDelay: `${i * 90}ms`,
            }}
          >
            <circle cx={x(i)} cy={y(p.speedup)} r={4} fill="#F57324" />
            <text x={x(i)} y={y(p.speedup) - 9} textAnchor="middle" fontSize={10} fill="#3D3125" fontFamily="var(--font-mono)">
              {p.speedup.toFixed(1)}×
            </text>
          </g>
        ))}
        {/* Eje X: hilos */}
        {points.map((p, i) => (
          <text key={`xl${p.threads}`} x={x(i)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="#5C4A39" fontFamily="var(--font-mono)">
            {p.threads} {p.threads === 1 ? 'hilo' : 'hilos'}
          </text>
        ))}
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="#D4C4A0" strokeWidth={1} />
      </svg>
      <div className="mono-small" style={{ marginTop: 6 }}>
        eficiencia a {last.threads} hilos: {Math.round(last.efficiency * 100)}%
      </div>
    </div>
  )
}
