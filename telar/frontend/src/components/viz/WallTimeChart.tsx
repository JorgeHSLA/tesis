// WallTimeChart — comparación de ejecuciones (CU-30.3): tiempo total (wall
// time) frente a hilos. SVG a mano (frontend-spec §8: cero librerías), mismo
// lenguaje visual que SpeedupChart: serie var(--viz-observed), grid
// var(--viz-grid), ejes var(--viz-axis), labels var(--viz-label).
// Eje X lineal 0..máx hilos (varios jobs pueden compartir x); eje Y 0..máx ms.
import { fmtTimeMs } from '../../lib/format'

const W = 520
const H = 260
const PAD = { top: 22, right: 20, bottom: 34, left: 56 }

export interface WallTimePoint {
  id: string
  threads: number
  wallTimeMs: number
}

export function WallTimeChart({ points }: { points: readonly WallTimePoint[] }) {
  if (points.length === 0) return null
  const sorted = [...points].sort((a, b) => a.threads - b.threads || a.wallTimeMs - b.wallTimeMs)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const xMax = Math.max(1, ...sorted.map((p) => p.threads))
  const yMax = Math.max(1, ...sorted.map((p) => p.wallTimeMs))
  const x = (threads: number) => PAD.left + (threads / xMax) * innerW
  const y = (ms: number) => PAD.top + innerH - (ms / yMax) * innerH
  const line = sorted.map((p) => `${x(p.threads).toFixed(1)},${y(p.wallTimeMs).toFixed(1)}`).join(' ')
  const gridYs = [0, 0.5, 1].map((f) => ({ gy: PAD.top + innerH - f * innerH, value: f * yMax }))
  const xTicks = [...new Set(sorted.map((p) => p.threads))]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`Tiempo total frente a hilos: ${sorted
        .map((p) => `${p.threads} ${p.threads === 1 ? 'hilo' : 'hilos'} ${fmtTimeMs(p.wallTimeMs)}`)
        .join(', ')}`}
      style={{ display: 'block' }}
    >
      {gridYs.map(({ gy, value }) => (
        <g key={gy}>
          <line x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy} stroke="var(--viz-grid)" strokeWidth={1} />
          <text x={PAD.left - 8} y={gy + 3} textAnchor="end" fontSize={11} fill="var(--viz-label)" fontFamily="var(--font-mono)">
            {fmtTimeMs(value)}
          </text>
        </g>
      ))}
      {sorted.length > 1 && (
        <polyline points={line} fill="none" stroke="var(--viz-observed)" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {sorted.map((p) => (
        <circle key={p.id} cx={x(p.threads)} cy={y(p.wallTimeMs)} r={4.5} fill="var(--viz-observed)">
          <title>{`#${p.id.slice(0, 8)} · ${p.threads} hilos · ${fmtTimeMs(p.wallTimeMs)}`}</title>
        </circle>
      ))}
      {xTicks.map((t) => (
        <text key={t} x={x(t)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--viz-label)" fontFamily="var(--font-mono)">
          {t}
        </text>
      ))}
      <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={10} fill="var(--viz-label)" fontFamily="var(--font-mono)">
        hilos
      </text>
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="var(--viz-axis)" strokeWidth={1} />
    </svg>
  )
}
