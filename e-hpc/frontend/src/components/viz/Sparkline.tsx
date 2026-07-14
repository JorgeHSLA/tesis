// Sparkline — hint de la MetricCard CPU en el live (frontend-spec §8.1).
// Polilínea de las últimas 60 muestras, 120×28, stroke #3F7A2E 1.5, área
// rgba(63,122,46,.08). SIN ejes ni labels. Escala: max = threads_effective·100
// (fallback online_cpus·100) — cpu_percent puede superar 100, JAMÁS max=100 fijo.

const W = 120
const H = 28
const MAX_POINTS = 60

export interface SparklineProps {
  data: number[]
  /** Máximo del eje: threads_effective·100 (u online_cpus·100). */
  max: number
}

export function Sparkline({ data, max }: SparklineProps) {
  const points = data.slice(-MAX_POINTS)
  if (points.length < 2) return null
  const top = Math.max(1, max)
  const stepX = W / (points.length - 1)
  const coords = points.map((v, i) => {
    const x = i * stepX
    const y = H - 2 - Math.min(1, Math.max(0, v / top)) * (H - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const area = `M0,${H} L${coords.join(' L')} L${W},${H} Z`
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: 'block' }}>
      <path d={area} fill="rgba(63,122,46,.08)" stroke="none" />
      <polyline points={coords.join(' ')} fill="none" stroke="#3F7A2E" strokeWidth={1.5} />
    </svg>
  )
}
