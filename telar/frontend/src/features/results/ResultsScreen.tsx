// ResultsScreen — detalle /resultados/:jobId (frontend-spec §6.4).
// Métricas de metrics_summary (persistido; NUNCA de una serie no guardada),
// SpeedupChart/ComparisonBars/degradación, Observaciones (lib/observations)
// y Output con descarga vía GET /api/v1/jobs/{id}/output.
// Job aún no terminal → redirect a /simulador/{jobId}; 404 → ErrorState.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getJob, jobOutputUrl } from '../../api/jobs'
import { useProgressStore } from '../../stores/progressStore'
import type { JobDetailDto } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Help } from '../../components/ui/helpTexts'
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
  IconPlay,
  IconZap,
} from '../../components/icons/icons'
import { fmtBytes, fmtTimeMs } from '../../lib/format'
import { downloadFile, saveBlob } from '../../lib/download'
import { jobExportBlob, jobExportFilename } from '../../lib/jobExport'
import { jobConfigParts, resultEyebrow } from '../../lib/jobCause'
import { buildObservations } from '../../lib/observations'
import { bestSweepPoint } from '../../lib/speedup'
import { DistributionCard, FailureCard, ObservationsCard, OutputCard } from './ResultsCards'
import '../../styles/screens/results.css'

const TERMINAL = ['completed', 'failed', 'timeout', 'cancelled']

const DOWNLOAD_ERROR = 'No fue posible descargar la salida. Inténtalo nuevamente.'
const EXPORT_ERROR = 'No fue posible exportar los resultados. Inténtalo nuevamente.'

/** Mismo nombre que el Content-Disposition de §7.6 (`<stem>-<job_id[:8]>.txt`):
 *  entre orígenes esa cabecera no es legible desde fetch, así que se reconstruye. */
function outputFilename(job: JobDetailDto): string {
  return `${job.filename.replace(/\.py$/, '')}-${job.job_id.slice(0, 8)}.txt`
}

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
        // S2: un job con lección puede haberla completado (regla `run`). Aquí
        // se llega también con el job ya terminal (F5, historial, enlace), sin
        // pasar por la vista en vivo: se refresca la caché de progreso.
        if (detail.lesson_id != null) void useProgressStore.getState().hydrate(true)
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err : new ApiError('NETWORK_ERROR', String(err), 0)))
  }, [jobId, navigate])
  useEffect(load, [load])

  const observations = useMemo(() => (job != null ? buildObservations(job) : []), [job])

  // CU-10.1: fetch → Blob (lib/download). Un fallo no oculta los resultados.
  // `downloading` bloquea los botones: un doble click no lanza dos descargas.
  const [downloadFailed, setDownloadFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const downloadOutput = useCallback(() => {
    if (job == null || downloading) return
    setDownloadFailed(false)
    setDownloading(true)
    downloadFile(jobOutputUrl(job.job_id), outputFilename(job))
      .catch(() => setDownloadFailed(true))
      .finally(() => setDownloading(false))
  }, [job, downloading])

  // CU-31: exportación JSON local (el job ya está en memoria: no hay red).
  const [exportFailed, setExportFailed] = useState(false)
  const exportJson = useCallback(() => {
    if (job == null) return
    try {
      saveBlob(jobExportBlob(job), jobExportFilename(job))
      setExportFailed(false)
    } catch {
      setExportFailed(true)
    }
  }, [job])

  if (error != null) {
    return (
      <section className="screen results-screen">
        <ErrorState
          title={error.code === 'JOB_NOT_FOUND' ? 'Job no encontrado' : 'Algo salió mal'}
          message={
            error.code === 'JOB_NOT_FOUND'
              ? 'Este job no existe o fue limpiado.'
              : 'No se pudieron cargar los resultados. ¿Está corriendo el backend Telar?'
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
      ? (
          <>
            a {best.threads} hilos · eficiencia {Math.round(best.efficiency * 100)}% {Help.eficiencia}
          </>
        )
      : t?.kind === 'pair'
        ? `contra ${t.reference_label}`
        : 'no aplica: este ejemplo no se compara contra 1 hilo'
  const m = job.metrics_summary

  // «Ejecutar otro ejemplo»: lleva al simulador SIN precargar nada para elegir uno nuevo.
  // (Repetir ESTE ejemplo con otros hilos se hace con el panel «Probar con otros hilos».)
  const runAnother = () => navigate('/simulador')

  return (
    <section className="screen results-screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">{resultEyebrow(job.status)}</div>
          <h2 className="display-lg">Resultados · {job.filename}</h2>
          <div className="live-head-row">
            <HeaderChip job={job} />
            <span className="mono-small">
              job #{job.job_id.slice(0, 8)}
              {job.wall_time_ms != null
                ? ` · ${job.status === 'completed' ? 'completado en' : 'duró'} ${fmtTimeMs(job.wall_time_ms)}`
                : ''}{' '}
              · {job.threads} hilos
            </span>
          </div>
          {/* CU-09.1: la configuración completa con la que corrió. */}
          <div className="mono-small muted results-config" role="note" aria-label="Configuración de la ejecución">
            {jobConfigParts(job).join(' · ')}
          </div>
        </div>
        <div className="screen-actions">
          <Button variant="outline" onClick={downloadOutput} disabled={downloading}>
            <IconDownload size={14} /> Descargar output
          </Button>
          <Button variant="outline" onClick={exportJson}>
            <IconDownload size={14} /> Exportar JSON
          </Button>
          <Button variant="outline" onClick={runAnother}>
            <IconPlay size={14} /> Ejecutar otro ejemplo
          </Button>
        </div>
      </header>

      {downloadFailed && (
        <ErrorState title="Descarga fallida" message={DOWNLOAD_ERROR} onRetry={downloadOutput} />
      )}

      {exportFailed && <ErrorState title="Exportación fallida" message={EXPORT_ERROR} onRetry={exportJson} />}

      <div className="metrics-row">
        <MetricCard
          icon={<IconClock size={16} />}
          label="Tiempo total"
          value={job.wall_time_ms != null ? fmtTimeMs(job.wall_time_ms) : '—'}
          hint="incluye compilación JIT"
          help={Help.tiempoTotal}
        />
        <MetricCard icon={<IconZap size={16} />} label="Speedup observado" value={speedupValue} hint={speedupHint} help={Help.speedup} />
        <MetricCard
          icon={<IconCpu size={16} />}
          label="CPU promedio"
          value={m != null ? `${Math.round(m.cpu_percent_avg)}%` : '—'}
          hint={m != null ? `pico ${Math.round(m.cpu_percent_max)}%` : 'sin muestras'}
          help={Help.cpu}
        />
        <MetricCard
          icon={<IconMemory size={16} />}
          label="Memoria pico"
          value={m != null ? fmtBytes(m.mem_used_bytes_max) : '—'}
          hint={m != null ? `límite ${fmtBytes(m.mem_limit_bytes)}` : 'sin muestras'}
          help={Help.memoria}
        />
      </div>

      <div className="two-col">
        <DistributionCard job={job} />
        <ObservationsCard observations={observations} />
      </div>

      <FailureCard job={job} />

      <OutputCard job={job} onDownload={downloadOutput} downloading={downloading} />
    </section>
  )
}
