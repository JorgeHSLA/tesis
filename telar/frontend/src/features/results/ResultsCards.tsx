// ResultsCards — cards del detalle de resultados (frontend-spec §6.4):
// «Distribución del trabajo» (SpeedupChart | ComparisonBars | LiveMetricsChart
// | resumen degradado), «Observaciones» (lib/observations) y «Output».
import { Card, CardHead, CardPad } from '../../components/ui/Card'
import { Terminal, TermLine } from '../../components/ui/Terminal'
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconLayers,
  IconTerminal,
  IconZap,
} from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import type { JobDetailDto } from '../../api/types'
import { ComparisonBars } from '../../components/viz/ComparisonBars'
import { LiveMetricsChart } from '../../components/viz/LiveMetricsChart'
import { SpeedupChart } from '../../components/viz/SpeedupChart'
import { fmtBytes } from '../../lib/format'
import type { Observation } from '../../lib/observations'
import { useJobStore } from '../../stores/jobStore'

// ─────────────────────── Distribución del trabajo ──────────────────────────

export function DistributionCard({ job }: { job: JobDetailDto }) {
  const t = job.parsed_timings
  // Serie del live SOLO si seguimos en memoria con ESTE job (el backend no
  // persiste muestras — data-model §3).
  const liveJobId = useJobStore((s) => s.jobId)
  const liveMetrics = useJobStore((s) => s.metrics)
  const hasLiveSeries = liveJobId === job.job_id && liveMetrics.length >= 2

  return (
    <Card>
      <CardHead icon={<IconLayers size={16} />} title="Distribución del trabajo" />
      <CardPad>
        {t?.kind === 'sweep' ? (
          <SpeedupChart series={t.series} />
        ) : t?.kind === 'pair' ? (
          <ComparisonBars
            parallel_time_s={t.parallel_time_s}
            reference_time_s={t.reference_time_s}
            reference_label={t.reference_label}
          />
        ) : hasLiveSeries ? (
          <LiveMetricsChart samples={liveMetrics} maxCpu={job.threads * 100} />
        ) : (
          <DegradedSummary job={job} />
        )}
      </CardPad>
    </Card>
  )
}

/** Degradación §6.4: sin parsed_timings ni serie en memoria → resumen estático. */
function DegradedSummary({ job }: { job: JobDetailDto }) {
  const m = job.metrics_summary
  if (m == null) {
    return <p className="muted">Este job no tiene métricas agregadas disponibles.</p>
  }
  return (
    <div>
      <div className="degraded-grid">
        <div>
          <div className="metric-label">CPU promedio</div>
          <div className="metric-value">{Math.round(m.cpu_percent_avg)}%</div>
          <div className="mono-small">pico {Math.round(m.cpu_percent_max)}%</div>
        </div>
        <div>
          <div className="metric-label">Memoria pico</div>
          <div className="metric-value">{fmtBytes(m.mem_used_bytes_max)}</div>
          <div className="mono-small">de {fmtBytes(m.mem_limit_bytes)}</div>
        </div>
        <div>
          <div
            className="metric-label"
            title="Máximo de tareas del cgroup del contenedor (tini, Python y los pools de Numba/OpenMP), no el número de hilos OpenMP del programa"
          >
            Tareas del contenedor
          </div>
          <div className="metric-value">{m.pids_max}</div>
          <div className="mono-small">{m.samples} muestras</div>
        </div>
      </div>
      <div className="field-hint" style={{ marginTop: 12 }}>
        las gráficas en vivo solo están disponibles durante la ejecución
      </div>
    </div>
  )
}

// ───────────────────────────── Observaciones ───────────────────────────────

const OBS_ICON = {
  warn: <IconAlert size={16} />,
  ok: <IconCheck size={16} />,
  info: <IconZap size={16} />,
} as const

export function ObservationsCard({ observations }: { observations: Observation[] }) {
  return (
    <Card>
      <CardHead icon={<IconAlert size={16} />} title="Observaciones" />
      <div className="observations">
        {observations.map((o, i) => (
          <div key={i} className={`obs obs-${o.kind}`}>
            <span className={`obs-icon obs-icon-${o.kind}`}>{OBS_ICON[o.kind]}</span>
            <div>
              <b>{o.title}</b>
              <p>{o.body}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ──────────────────────────────── Output ───────────────────────────────────

export function OutputCard({ job, onDownload }: { job: JobDetailDto; onDownload: () => void }) {
  const stdout = job.stdout ?? ''
  const lines = stdout === '' ? [] : stdout.replace(/\n$/, '').split('\n')
  return (
    <Card style={{ marginTop: 20 }}>
      <CardHead
        icon={<IconTerminal size={16} />}
        title={`Output (stdout · ${lines.length} ${lines.length === 1 ? 'línea' : 'líneas'})`}
        right={
          <Button variant="ghost" size="sm" onClick={onDownload}>
            <IconDownload size={12} /> descargar
          </Button>
        }
      />
      <CardPad>
        {job.output_truncated && (
          <div className="truncated-banner" role="status">
            Salida truncada a 256 KB
          </div>
        )}
        <Terminal dots={false} label="Output completo del job" bodyClassName="output-terminal-body">
          {lines.length === 0 ? (
            <TermLine tagClass="term-dim" tag="(sin salida en stdout)" />
          ) : (
            lines.map((line, i) => (
              <div key={i} className="term-line">
                <span>{line === '' ? ' ' : line}</span>
              </div>
            ))
          )}
        </Terminal>
      </CardPad>
    </Card>
  )
}
