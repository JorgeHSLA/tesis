// LiveMetricsChart — SOLO con la serie en memoria del live (frontend-spec §8.4).
// Doble serie temporal 520×200: CPU% (#3F7A2E, eje izq 0..maxCpu =
// threads_effective·100) y memoria (#F57324, eje der 0..límite del contenedor).
// Grid horizontal #E9DFC9 dash; labels min/max mono 10. Máx ~900 puntos →
// decimación a 260 (media por bucket, decimate de lib/format).
// Fuente EXCLUSIVA: jobStore.metrics — el backend no persiste la serie.
import { decimate } from '../../lib/format'
import { fmtBytes } from '../../lib/format'
import type { MetricSample } from '../../stores/jobStore'

const W = 520
const H = 200
const PAD = { top: 14, right: 44, bottom: 20, left: 44 }
const TARGET_POINTS = 260
const DEFAULT_MEM_MAX = 512 * 1024 * 1024

export interface LiveMetricsChartProps {
  samples: MetricSample[]
  /** threads_effective·100 (fallback online_cpus·100). */
  maxCpu: number
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function LiveMetricsChart({ samples, maxCpu }: LiveMetricsChartProps) {
  if (samples.length < 2) return null
  const points = decimate(samples, TARGET_POINTS, (bucket) => ({
    ...bucket[bucket.length - 1],
    cpu_percent: avg(bucket.map((b) => b.cpu_percent)),
    mem_used_bytes: avg(bucket.map((b) => b.mem_used_bytes)),
  }))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const cpuMax = Math.max(1, maxCpu)
  const memMax = points[points.length - 1].mem_limit_bytes || DEFAULT_MEM_MAX

  const x = (i: number) => PAD.left + (i * innerW) / (points.length - 1)
  const yCpu = (v: number) => PAD.top + innerH - Math.min(1, Math.max(0, v / cpuMax)) * innerH
  const yMem = (v: number) => PAD.top + innerH - Math.min(1, Math.max(0, v / memMax)) * innerH

  const cpuLine = points.map((p, i) => `${x(i).toFixed(1)},${yCpu(p.cpu_percent).toFixed(1)}`).join(' ')
  const memLine = points.map((p, i) => `${x(i).toFixed(1)},${yMem(p.mem_used_bytes).toFixed(1)}`).join(' ')
  const gridYs = Array.from({ length: 4 }, (_, i) => PAD.top + (i * innerH) / 3)

  return (
    <div>
      <div className="legend-row">
        <span className="lg-dot" style={{ background: '#3F7A2E' }} /> CPU %
        <span className="lg-dot" style={{ background: '#F57324', marginLeft: 14 }} /> memoria
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Serie temporal de CPU y memoria del contenedor" style={{ display: 'block' }}>
        {gridYs.map((gy) => (
          <line key={gy} x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy} stroke="#E9DFC9" strokeWidth={1} strokeDasharray="3 4" />
        ))}
        {/* Labels min/max de ambos ejes (mono 10) */}
        <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" fontSize={10} fill="#3F7A2E" fontFamily="var(--font-mono)">
          {Math.round(cpuMax)}%
        </text>
        <text x={PAD.left - 6} y={PAD.top + innerH + 4} textAnchor="end" fontSize={10} fill="#A08B6E" fontFamily="var(--font-mono)">
          0
        </text>
        <text x={W - PAD.right + 6} y={PAD.top + 4} fontSize={10} fill="#F57324" fontFamily="var(--font-mono)">
          {fmtBytes(memMax)}
        </text>
        <text x={W - PAD.right + 6} y={PAD.top + innerH + 4} fontSize={10} fill="#A08B6E" fontFamily="var(--font-mono)">
          0
        </text>
        <polyline points={cpuLine} fill="none" stroke="#3F7A2E" strokeWidth={1.5} />
        <polyline points={memLine} fill="none" stroke="#F57324" strokeWidth={1.5} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={W - PAD.right} y2={PAD.top + innerH} stroke="#D4C4A0" strokeWidth={1} />
      </svg>
      <div className="mono-small" style={{ marginTop: 6 }}>
        {samples.length} muestras · ~1/s · serie en memoria del live (no se persiste)
      </div>
    </div>
  )
}
