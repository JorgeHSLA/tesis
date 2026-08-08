// SimulatorLive — pantalla /simulador/:jobId (frontend-spec §6.3).
// LiveHeader (tabla fase→chip ÚNICA vía StatusChip, aria-live=polite),
// LiveMetricsRow (4 MetricCard con datos REALES del WS), running-grid:
// LiveNodesCard (LiveTopology decorativa §5.4) + LiveTerminalCard (datos
// reales), y ThreadsTable / SweepProgressCard según flags del ejemplo.
// Datos: useJobSocket(jobId) + GET /api/v1/jobs/{jobId} al montar (filename/
// threads/example al llegar por URL directa; el backlog del WS cubre los logs).
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getExample } from '../../api/content'
import { getJob } from '../../api/jobs'
import type { ExampleDetailDto, JobDetailDto } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Card, CardHead } from '../../components/ui/Card'
import { ErrorState } from '../../components/ui/ErrorState'
import { MetricCard } from '../../components/ui/MetricCard'
import { StatusChip } from '../../components/ui/StatusChip'
import {
  IconArrowRight,
  IconClock,
  IconCluster,
  IconCpu,
  IconMemory,
  IconStop,
  IconZap,
} from '../../components/icons/icons'
import { LiveTopology } from '../../components/viz/LiveTopology'
import { Sparkline } from '../../components/viz/Sparkline'
import { useJobSocket } from '../../hooks/useJobSocket'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useSimulation } from '../../hooks/useSimulation'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { fmtBytes, fmtTime } from '../../lib/format'
import { isTerminalPhase } from '../../stores/jobStore'
import { isSweepParser } from './sweepParse'
import { LiveTerminalCard } from './LiveTerminalCard'
import { SweepProgressCard } from './SweepProgressCard'
import { ThreadsTable } from './ThreadsTable'

/** State opcional del navigate desde el idle (202 de POST /jobs). */
interface LaunchState {
  wsUrl?: string
  threadsNote?: string | null
  filename?: string
  threads?: number
}

export interface SimulatorLiveProps {
  jobId: string
}

export function SimulatorLive({ jobId }: SimulatorLiveProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const launchState = (location.state as LaunchState | null) ?? null
  const reducedMotion = useReducedMotion()
  const { data: system } = useSystemInfo()

  const { phase, logs, logsTruncated, metrics, elapsedSec, wsError, cancel, retry } = useJobSocket(jobId)

  const [job, setJob] = useState<JobDetailDto | null>(null)
  const [jobError, setJobError] = useState<ApiError | null>(null)
  const [example, setExample] = useState<ExampleDetailDto | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)

  // GET del job al montar (recupera filename/threads/example por URL directa).
  useEffect(() => {
    let alive = true
    setJob(null)
    setJobError(null)
    getJob(jobId)
      .then((detail) => {
        if (!alive) return
        // Job ya terminal al llegar → directo a resultados (§6.3; el WS
        // replay dispara el mismo redirect — replace lo hace idempotente).
        if (['completed', 'failed', 'timeout', 'cancelled'].includes(detail.status)) {
          navigate(`/resultados/${jobId}`, { replace: true })
          return
        }
        setJob(detail)
      })
      .catch((err: unknown) => {
        if (alive) setJobError(err instanceof ApiError ? err : new ApiError('NETWORK_ERROR', String(err), 0))
      })
    return () => {
      alive = false
    }
  }, [jobId, navigate])

  const exampleId = job?.example_id ?? null
  useEffect(() => {
    if (exampleId == null) {
      setExample(null)
      return
    }
    let alive = true
    getExample(exampleId)
      .then((d) => {
        if (alive) setExample(d)
      })
      .catch(() => undefined) // metadata opcional: sin ella se muestra ThreadsTable
    return () => {
      alive = false
    }
  }, [exampleId])

  const filename = job?.filename ?? launchState?.filename ?? `job ${jobId.slice(0, 8)}`
  const threads = job?.threads ?? launchState?.threads ?? 4
  const timeoutS = job?.timeout_s ?? null
  const terminal = isTerminalPhase(phase)

  const { nodes } = useSimulation({ threads, running: phase === 'running', reducedMotion })

  const lastMetric = metrics.length > 0 ? metrics[metrics.length - 1] : null
  const cpuSeries = useMemo(() => metrics.slice(-60).map((m) => m.cpu_percent), [metrics])
  const cpuMax = threads * 100 || (lastMetric != null ? lastMetric.online_cpus * 100 : 100)
  const sweep = example != null && example.sweeps_threads && isSweepParser(example.parser_id)

  const notFound = wsError === 'JOB_NOT_FOUND' || jobError?.code === 'JOB_NOT_FOUND'
  if (notFound) {
    return (
      <section className="screen simulator-screen">
        <ErrorState
          title="Job no encontrado"
          message="Este job no existe o fue limpiado."
        >
          <Link className="btn btn-primary btn-sm" to="/simulador">
            Ir al simulador
          </Link>
        </ErrorState>
      </section>
    )
  }

  return (
    <section className="screen simulator-screen">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Ejecución en vivo</div>
          <h2 className="display-lg">{filename}</h2>
          <div className="live-head-row">
            <span aria-live="polite">
              <StatusChip phase={phase} />
            </span>
            <span className="mono-small">
              job #{jobId.slice(0, 8)} · {threads} hilos · OpenMP · PyOMP
            </span>
          </div>
        </div>
        <div className="screen-actions">
          {!terminal &&
            (confirmStop ? (
              <>
                <span className="mono-small">¿Detener el job?</span>
                <Button
                  variant="outline"
                  onClick={() => {
                    cancel()
                    setConfirmStop(false)
                  }}
                >
                  Sí, detener
                </Button>
                <Button variant="ghost" onClick={() => setConfirmStop(false)}>
                  No
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirmStop(true)}>
                <IconStop size={14} /> Detener
              </Button>
            ))}
          {terminal ? (
            <Button variant="primary" onClick={() => navigate(`/resultados/${jobId}`)}>
              Ver resultados <IconArrowRight size={14} />
            </Button>
          ) : (
            <Button variant="outline" disabled>
              Ver resultados <IconArrowRight size={14} />
            </Button>
          )}
        </div>
      </header>

      {launchState?.threadsNote != null && (
        <div className="threads-note" role="status">
          {launchState.threadsNote}
        </div>
      )}

      {phase === 'lost' && (
        <div className="lost-banner" role="alert">
          <b>Conexión perdida con el backend.</b> El job puede seguir corriendo; el historial de salida se recupera al
          reconectar.
          <Button variant="outline" size="sm" onClick={retry} style={{ marginLeft: 'auto' }}>
            Reintentar conexión
          </Button>
        </div>
      )}

      <div className="metrics-row">
        <MetricCard
          icon={<IconClock size={16} />}
          label="Tiempo transcurrido"
          value={fmtTime(elapsedSec)}
          hint={timeoutS == null ? ' ' : timeoutS === 0 ? 'sin límite' : `límite ${timeoutS}s`}
        />
        <MetricCard
          icon={<IconCpu size={16} />}
          label="CPU del contenedor"
          value={lastMetric != null ? `${Math.round(lastMetric.cpu_percent)}%` : '—'}
          hint={
            <>
              {/* 100% = 1 núcleo; el % es agregado (docker stats), así que con
                  varios hilos supera 100%. Techo ≈ hilos·100 (--cpus). */}
              <div>{`100% = 1 núcleo · tope ${Math.round(cpuMax)}%`}</div>
              {cpuSeries.length >= 2 && <Sparkline data={cpuSeries} max={cpuMax} />}
            </>
          }
        />
        <MetricCard
          icon={<IconMemory size={16} />}
          label="Memoria"
          value={lastMetric != null ? fmtBytes(lastMetric.mem_used_bytes) : '—'}
          hint={lastMetric != null ? `de ${fmtBytes(lastMetric.mem_limit_bytes)}` : ' '}
          progressPct={lastMetric != null ? (lastMetric.mem_used_bytes / lastMetric.mem_limit_bytes) * 100 : undefined}
        />
        <MetricCard
          icon={<IconZap size={16} />}
          label="Hilos"
          value={sweep ? '1·2·4·8' : threads}
          hint={sweep ? 'barrido 1/2/4/8' : system != null ? `de ${system.cores} núcleos` : ' '}
        />
      </div>

      <div className="running-grid">
        <Card>
          <CardHead
            icon={<IconCluster size={16} />}
            title="Hilos en vivo"
            right={<span className="mono-small">{sweep ? 'hasta 8' : threads} hilos · 1 contenedor</span>}
          />
          <div className="live-topology">
            <LiveTopology nodes={nodes} running={phase === 'running'} reducedMotion={reducedMotion} />
          </div>
          <div className="live-topology-foot mono-small">
            Animación ilustrativa del modelo fork-join — la salida real está a la derecha. ·{' '}
            <span className="muted">representación didáctica del fork-join</span>
          </div>
        </Card>
        <LiveTerminalCard jobId={jobId.slice(0, 8)} phase={phase} logs={logs} logsTruncated={logsTruncated} />
      </div>

      {sweep && example != null && isSweepParser(example.parser_id) ? (
        <SweepProgressCard logs={logs} parserId={example.parser_id} phase={phase} />
      ) : (
        <ThreadsTable nodes={nodes} phase={phase} />
      )}
    </section>
  )
}
