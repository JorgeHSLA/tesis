// ResultsScreen — detalle /resultados/:jobId (frontend-spec §6.4).
// Métricas de metrics_summary (persistido; NUNCA de una serie no guardada),
// SpeedupChart/ComparisonBars/degradación, Observaciones (lib/observations)
// y Output con descarga vía GET /api/v1/jobs/{id}/output.
// Job aún no terminal → redirect a /simulador/{jobId}; 404 → ErrorState.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getJob, jobOutputUrl } from '../../api/jobs'
import type { JobDetailDto } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { ErrorState } from '../../components/ui/ErrorState'
import { MetricCard } from '../../components/ui/MetricCard'
import { Skeleton } from '../../components/ui/Skeleton'
import {
  IconCheck,
  IconClock,
  IconCpu,
  IconDownload,
  IconMemory,
  IconZap,
} from '../../components/icons/icons'
import { fmtBytes, fmtTimeMs } from '../../lib/format'
import { buildObservations } from '../../lib/observations'
import { bestSweepPoint } from '../../lib/speedup'
import { DistributionCard, ObservationsCard, OutputCard } from './ResultsCards'
import '../../styles/screens/results.css'

const TERMINAL = ['completed', 'failed', 'timeout', 'cancelled']

function HeaderChip({ job }: { job: JobDetailDto }) {
  switch (job.status) {
    case 'completed':
      return (
        <Chip tone="green">
          <IconCheck size={12} /> Exit 0 · éxito
        </Chip>
      )
    case 'failed':
      return <Chip tone="red">{job.oom_killed ? 'OOM · sin memoria' : `Exit ${job.exit_code ?? '?'} · error`}</Chip>
    case 'timeout':
      return <Chip tone="red">Timeout ({job.timeout_s}s)</Chip>
    case 'cancelled':
      return <Chip tone="amber">Cancelado</Chip>
    default:
      return null
  }
}

export default function ResultsScreen() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobDetailDto | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  const load = useCallback(() => {
    if (jobId == null) return
    setError(null)
    setJob(null)
    getJob(jobId)
      .then((detail) => {
        if (!TERMINAL.includes(detail.status)) {
          navigate(`/simulador/${jobId}`, { replace: true })
          return
        }
        setJob(detail)
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err : new ApiError('NETWORK_ERROR', String(err), 0)))
  }, [jobId, navigate])
  useEffect(load, [load])

  const observations = useMemo(() => (job != null ? buildObservations(job) : []), [job])

  if (error != null) {
    return (
      <section className="screen results-screen">
        <ErrorState
          title={error.code === 'JOB_NOT_FOUND' ? 'Job no encontrado' : 'Algo salió mal'}
          message={
            error.code === 'JOB_NOT_FOUND'
              ? 'Este job no existe o fue limpiado.'
              : 'No se pudieron cargar los resultados. ¿Está corriendo el backend E-HPC?'
          }
          detail={error.message}
          onRetry={error.code === 'JOB_NOT_FOUND' ? undefined : load}
        >
          <Link className="btn btn-primary btn-sm" to="/simulador">
            Ir al simulador
          </Link>
        </ErrorState>
      </section>
    )
  }

  if (job == null) {
    return (
      <section className="screen results-screen" aria-busy="true">
        <div className="screen-head">
          <div>
            <Skeleton width={110} height={12} style={{ marginBottom: 10 }} />
            <Skeleton width={420} height={30} />
          </div>
        </div>
        <div className="metrics-row">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={92} radius="var(--r-lg)" />
          ))}
        </div>
        <div className="two-col">
          <Skeleton height={320} radius="var(--r-lg)" />
          <Skeleton height={320} radius="var(--r-lg)" />
        </div>
      </section>
    )
  }

  const t = job.parsed_timings
  const best = t?.kind === 'sweep' ? bestSweepPoint(t) : null
  const speedupValue =
    t?.kind === 'sweep' && best != null
      ? `${best.speedup.toFixed(1)}×`
      : t?.kind === 'pair'
        ? `${t.speedup_vs_reference.toFixed(1)}×`
        : '—'
  const speedupHint =
    t?.kind === 'sweep' && best != null
      ? `eficiencia ${Math.round(best.efficiency * 100)}%`
      : t?.kind === 'pair'
        ? `vs ${t.reference_label}`
        : 'este ejemplo no auto-mide'
  const m = job.metrics_summary

  const rerun = () => {
    if (job.source_kind === 'example' && job.example_id != null) {
      navigate(`/simulador?ejemplo=${encodeURIComponent(job.example_id)}`)
    } else {
      navigate('/simulador', { state: { code: job.source_code, filename: job.filename } })
    }
  }

  return (
    <section className="screen results-screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Job completado</div>
          <h2 className="display-lg">Resultados · {job.filename}</h2>
          <div className="live-head-row">
            <HeaderChip job={job} />
            <span className="mono-small">
              job #{job.job_id.slice(0, 8)}
              {job.wall_time_ms != null ? ` · completado en ${fmtTimeMs(job.wall_time_ms)}` : ''} · {job.threads} hilos
            </span>
          </div>
        </div>
        <div className="screen-actions">
          <a className="btn btn-outline" href={jobOutputUrl(job.job_id)} download>
            <IconDownload size={14} /> Descargar output
          </a>
          <Button variant="outline" onClick={rerun}>
            Re-ejecutar
          </Button>
        </div>
      </header>

      <div className="metrics-row">
        <MetricCard
          icon={<IconClock size={16} />}
          label="Tiempo total"
          value={job.wall_time_ms != null ? fmtTimeMs(job.wall_time_ms) : '—'}
          hint="incluye compilación JIT"
        />
        <MetricCard icon={<IconZap size={16} />} label="Speedup observado" value={speedupValue} hint={speedupHint} />
        <MetricCard
          icon={<IconCpu size={16} />}
          label="CPU promedio"
          value={m != null ? `${Math.round(m.cpu_percent_avg)}%` : '—'}
          hint={m != null ? `pico ${Math.round(m.cpu_percent_max)}%` : 'sin muestras'}
        />
        <MetricCard
          icon={<IconMemory size={16} />}
          label="Memoria pico"
          value={m != null ? fmtBytes(m.mem_used_bytes_max) : '—'}
          hint={m != null ? `límite ${fmtBytes(m.mem_limit_bytes)}` : 'sin muestras'}
        />
      </div>

      <div className="two-col">
        <DistributionCard job={job} />
        <ObservationsCard observations={observations} />
      </div>

      <OutputCard job={job} />
    </section>
  )
}
