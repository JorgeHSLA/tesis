// SweepProgressCard — solo en ejemplos sweep
// (frontend-spec §6.3): lista `hilos = 1 · ✓ 0.726 s`, `hilos = 2 · …`
// parseada EN VIVO de los logs con los regex de architecture.md §7.2.
// Datos 100 % reales (el parsed_timings autoritativo llega del backend al final).
import { Card, CardHead } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { IconLayers } from '../../components/icons/icons'
import type { LogLine, UiPhase } from '../../stores/jobStore'
import { isTerminalPhase } from '../../stores/jobStore'
import { parseSweepTimes, SWEEP_CASES, type SweepParserId } from './sweepParse'

export interface SweepProgressCardProps {
  logs: LogLine[]
  parserId: SweepParserId
  phase: UiPhase
}

export function SweepProgressCard({ logs, parserId, phase }: SweepProgressCardProps) {
  const stdout = logs.filter((l) => l.stream === 'stdout').map((l) => l.text)
  const times = parseSweepTimes(stdout, parserId)
  const terminal = isTerminalPhase(phase)
  // El caso «en curso» es el primero sin tiempo (solo mientras corre).
  const currentCase = SWEEP_CASES.find((n) => !times.has(n))

  return (
    <Card style={{ marginTop: 'var(--sp-5)' }}>
      <CardHead
        icon={<IconLayers size={16} />}
        title="Barrido de hilos"
        right={<span className="mono-small">medido por el propio script · 1/2/4/8 hilos</span>}
      />
      <div className="sweep-progress">
        {SWEEP_CASES.map((n) => {
          const t = times.get(n)
          const isCurrent = !terminal && phase === 'running' && currentCase === n
          return (
            <div key={n} className={['sweep-case', isCurrent ? 'current' : ''].filter(Boolean).join(' ')}>
              <span className="mono-small">hilos = {n}</span>
              <span className="sweep-case-value mono-small">
                {t != null ? (
                  <>
                    <span className="sweep-check">✓</span> {t.toFixed(3)} s
                  </>
                ) : isCurrent ? (
                  // Medición en curso = progreso → --primary (la terracota, para CTAs/logro).
                  <Chip tone="green" dot="var(--primary)">
                    midiendo…
                  </Chip>
                ) : terminal ? (
                  '—'
                ) : (
                  '…'
                )}
              </span>
            </div>
          )
        })}
        <div className="field-hint" style={{ marginTop: 6 }}>
          Cada caso se mide tras un calentamiento. Al terminar verás la curva de speedup en Resultados.
        </div>
      </div>
    </Card>
  )
}
