// ResultsCards — cards del detalle de resultados (frontend-spec §6.4):
// «Distribución del trabajo» (SpeedupChart | ComparisonBars | LiveMetricsChart
// | resumen degradado), «Observaciones» (lib/observations), «Causa y stderr»
// (CU-09.2, solo si no completó) y «Output».
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
import { Help } from '../../components/ui/helpTexts'
import type { JobDetailDto } from '../../api/types'
import { ComparisonBars } from '../../components/viz/ComparisonBars'
import { LiveMetricsChart } from '../../components/viz/LiveMetricsChart'
import { SpeedupChart } from '../../components/viz/SpeedupChart'
import { fmtBytes } from '../../lib/format'
import { jobCause } from '../../lib/jobCause'
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
  // El título dice lo que de verdad se ve (antes siempre «Distribución del trabajo»).
  const heading =
    t?.kind === 'sweep'
      ? { title: 'Cómo escala con los hilos', sub: 'speedup medido contra el ideal', help: Help.graficaSpeedup }
      : t?.kind === 'pair'
        ? { title: 'Paralelo contra referencia', sub: 'tiempo de cada versión', help: Help.graficaPar }
        : hasLiveSeries
          ? { title: 'CPU y memoria durante la ejecución', sub: 'lo que usó mientras corría', help: Help.graficaEnVivo }
          : { title: 'Resumen de recursos', sub: 'CPU, memoria y tareas', help: undefined }

  return (
    <Card>
      <CardHead icon={<IconLayers size={16} />} title={heading.title} sub={heading.sub} right={heading.help} />
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
          <div className="metric-label">
            Tareas del contenedor
            <span className="metric-help">{Help.tareasContenedor}</span>
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
      <CardHead icon={<IconAlert size={16} />} title="Observaciones" right={Help.observaciones} />
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

// ─────────────────────────── Causa y stderr ────────────────────────────────

/** CU-09.2: causa del fin y stderr COMPLETO (Observaciones solo cita 3 líneas). */
export function FailureCard({ job }: { job: JobDetailDto }) {
  const cause = jobCause(job)
  if (cause == null) return null
  const stderr = (job.stderr ?? '').replace(/\n$/, '')
  return (
    <Card style={{ marginTop: 20 }} aria-label="Causa y stderr">
      <CardHead icon={<IconAlert size={16} />} title="Causa y stderr" />
      <CardPad>
        <p className="failure-cause">{cause}</p>
        <Terminal dots={false} label="stderr completo del job" bodyClassName="output-terminal-body">
          {stderr === '' ? (
            <TermLine tagClass="term-dim" tag="(sin salida en stderr)" />
          ) : (
            stderr.split('\n').map((line, i) => (
              <div key={i} className="term-line">
                <span>{line === '' ? ' ' : line}</span>
              </div>
            ))
          )}
        </Terminal>
      </CardPad>
    </Card>
  )
}

// ──────────────────────────────── Output ───────────────────────────────────

export function OutputCard({
  job,
  onDownload,
  downloading,
}: {
  job: JobDetailDto
  onDownload: () => void
  downloading: boolean
}) {
  const stdout = job.stdout ?? ''
  const lines = stdout === '' ? [] : stdout.replace(/\n$/, '').split('\n')
  return (
    <Card style={{ marginTop: 20 }}>
      <CardHead
        icon={<IconTerminal size={16} />}
        title={`Output (stdout · ${lines.length} ${lines.length === 1 ? 'línea' : 'líneas'})`}
        right={
          <>
            {Help.salida}
            <Button variant="ghost" size="sm" onClick={onDownload} disabled={downloading}>
              <IconDownload size={12} /> descargar
            </Button>
          </>
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
