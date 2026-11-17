// SimulatorLive — pantalla /simulador/:jobId (frontend-spec §6.3).
// LiveHeader (tabla fase→chip ÚNICA vía StatusChip, aria-live=polite),
// LiveMetricsRow (3 MetricCard con datos REALES del WS: tiempo, CPU, memoria),
// running-grid: «Hilos» (LiveTopology decorativa §5.4, rotulada una sola vez)
// + LiveTerminalCard (datos reales), y SweepProgressCard en los ejemplos sweep.
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
import { Help } from '../../components/ui/helpTexts'
import { MetricCard } from '../../components/ui/MetricCard'
import { StatusChip } from '../../components/ui/StatusChip'
import {
  IconArrowRight,
  IconClock,
  IconCluster,
  IconCpu,
  IconMemory,
  IconPlay,
  IconStop,
} from '../../components/icons/icons'
import { LiveTopology } from '../../components/viz/LiveTopology'
import { Sparkline } from '../../components/viz/Sparkline'
import { useJobSocket } from '../../hooks/useJobSocket'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useReplay } from '../../hooks/useReplay'
import { useSimulation } from '../../hooks/useSimulation'
import { fmtBytes, fmtTime } from '../../lib/format'
import { MASTER_COORDINATES_NOTE, masterCoordinates } from '../../lib/masterRole'
import { logsUntil, metricAt, metricsUntil, threadActivity, timelineOf } from '../../lib/replay'
import { isTerminalPhase, useJobStore } from '../../stores/jobStore'
import { useProgressStore } from '../../stores/progressStore'
import { isSweepParser } from './sweepParse'
import { LiveTerminalCard } from './LiveTerminalCard'
import { ReplayBar } from './ReplayBar'
import { RerunControls, useRerun } from './QuickRerun'
import { SweepProgressCard } from './SweepProgressCard'

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

  const { phase, logs, logsTruncated, logsGap, metrics, elapsedSec, wsError, cancelling, cancelError, cancel, retry } =
    useJobSocket(jobId)

  const [job, setJob] = useState<JobDetailDto | null>(null)
  const [jobError, setJobError] = useState<ApiError | null>(null)
  const [example, setExample] = useState<ExampleDetailDto | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  // Pausa de la ILUSTRACIÓN mientras el job corre (no del job: pausar el
  // contenedor falsearía los tiempos que mide el programa).
  const [paused, setPaused] = useState(false)

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
        // CU-07.4: al volver a un job activo, el cronómetro parte del
        // started_at real y no del instante en que se abrió esta vista.
        useJobStore.getState().setStartedAt(jobId, detail.started_at)
        setJob(detail)
      })
      .catch((err: unknown) => {
        if (alive) setJobError(err instanceof ApiError ? err : new ApiError('NETWORK_ERROR', String(err), 0))
      })
    return () => {
      alive = false
    }
  }, [jobId, navigate])

  // Perder la conexión descarta la confirmación de «Detener»: si solo se
  // ocultara, reaparecería sola al reconectar sin que nadie la pidiera.
  useEffect(() => {
    if (phase === 'lost') setConfirmStop(false)
  }, [phase])

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
      .catch(() => undefined) // metadata opcional: sin ella no hay tarjeta de barrido
    return () => {
      alive = false
    }
  }, [exampleId])

  // S2: un job con lección puede haberla completado (regla `run`) o haber
  // movido last_job_id; al terminar se refresca la caché de progreso.
  const lessonId = job?.lesson_id ?? null
  const terminalNow = isTerminalPhase(phase)
  useEffect(() => {
    if (terminalNow && lessonId != null) void useProgressStore.getState().hydrate(true)
  }, [terminalNow, lessonId])

  const filename = job?.filename ?? launchState?.filename ?? `job ${jobId.slice(0, 8)}`
  const threads = job?.threads ?? launchState?.threads ?? 4
  const timeoutS = job?.timeout_s ?? null
  const terminal = terminalNow

  // ── Reproductor (solo visual): primero corre de verdad; al terminar se puede
  // retroceder, pausar, saltar a un momento y cambiar la velocidad. Muestra de
  // nuevo lo que YA llegó por el WebSocket; no toca ninguna métrica real.
  const wallTimeMs = useJobStore((s) => s.wallTimeMs)
  const timeline = useMemo(
    () => (terminal ? timelineOf(logs, metrics, wallTimeMs) : { t0: 0, duration: 0 }),
    [terminal, logs, metrics, wallTimeMs],
  )
  const replay = useReplay(timeline.duration)
  const replaying = terminal && timeline.duration > 0
  const shownLogs = useMemo(
    () => (replaying ? logsUntil(logs, timeline.t0, replay.time) : logs),
    [replaying, logs, timeline.t0, replay.time],
  )
  const shownMetrics = useMemo(
    () => (replaying ? metricsUntil(metrics, timeline.t0, replay.time) : metrics),
    [replaying, metrics, timeline.t0, replay.time],
  )

  // Solo para la ESTRUCTURA de nodos (t0 maestro + resto); sin azar: la actividad es real.
  const sim = useSimulation({ threads, running: false, reducedMotion, paused: true, speed: 1 })
  // El anillo de cada hilo sigue la CPU REAL: la de la muestra más reciente en vivo, o la
  // de la muestra de ese instante al reproducir. (docker stats mide el contenedor entero,
  // así que se reparte a partes iguales: es la CPU media por hilo, no una medida por hilo.)
  const nodeCpu = replaying
    ? (metricAt(metrics, timeline.t0, replay.time)?.cpu_percent ?? null)
    : metrics.length > 0
      ? metrics[metrics.length - 1].cpu_percent
      : null
  const nodes = useMemo(
    () => sim.nodes.map((n) => ({ ...n, activity: threadActivity(nodeCpu, threads) })),
    [sim.nodes, nodeCpu, threads],
  )
  // El código del job separa a t0 del resto (if tid == 0 / else): se deduce leyéndolo.
  const sourceCode = job?.source_code ?? null
  const coordinates = useMemo(() => sourceCode != null && masterCoordinates(sourceCode), [sourceCode])

  const lastMetric = shownMetrics.length > 0 ? shownMetrics[shownMetrics.length - 1] : null
  const cpuSeries = useMemo(() => shownMetrics.slice(-60).map((m) => m.cpu_percent), [shownMetrics])
  // Con el reproductor en otro punto, el reloj muestra ese instante; al final, el tiempo real.
  const clockSec = replaying && !replay.atEnd ? replay.time / 1000 : elapsedSec

  // «Re-ejecutar este ejemplo» (cabecera) y el deslizante de hilos de abajo comparten estado.
  const rerun = useRerun(job, !terminal)
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
          <h2 className="display-lg">{filename}</h2>
          <div className="live-head-row">
            <span aria-live="polite">
              <StatusChip phase={phase} />
            </span>
            <span className="mono-small">
              job #{jobId.slice(0, 8)} · {threads} {threads === 1 ? 'hilo' : 'hilos'}
            </span>
          </div>
        </div>
        <div className="screen-actions">
          {!terminal &&
            (cancelling ? (
              <Button variant="outline" disabled>
                <IconStop size={14} /> Cancelando…
              </Button>
            ) : confirmStop && phase !== 'lost' ? (
              <>
                <span className="mono-small">¿Detener el job?</span>
                <Button
                  variant="outline"
                  onClick={() => {
                    void cancel()
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
              // CU-08.5: sin conexión no hay cómo saber si el job sigue vivo.
              <Button
                variant="outline"
                disabled={phase === 'lost'}
                title={phase === 'lost' ? 'Sin conexión con el backend' : undefined}
                onClick={() => setConfirmStop(true)}
              >
                <IconStop size={14} /> Detener
              </Button>
            ))}
          <Button variant="outline" onClick={() => void rerun.launch()} disabled={!rerun.canLaunch}>
            <IconPlay size={14} /> {rerun.launching ? 'Lanzando…' : job?.example_id != null ? 'Re-ejecutar este ejemplo' : 'Re-ejecutar'}
          </Button>
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

      {/* Hilos para repetir + reproductor de la ejecución, en una sola franja. */}
      <div className="live-controls">
        <RerunControls rerun={rerun} />
        <ReplayBar
          live={!terminal}
          empty={terminal && timeline.duration <= 0}
          time={terminal ? replay.time : elapsedSec * 1000}
          duration={terminal ? replay.duration : elapsedSec * 1000}
          playing={terminal ? replay.playing : !paused}
          speed={replay.speed}
          onToggle={terminal ? replay.toggle : () => setPaused((p) => !p)}
          onSeek={replay.seek}
          onStep={replay.step}
          onRestart={replay.restart}
          onSpeed={replay.setSpeed}
        />
      </div>
      {rerun.error != null && (
        <div className="field-hint error" role="alert">
          {rerun.error}
        </div>
      )}

      {launchState?.threadsNote != null && (
        <div className="threads-note" role="status">
          {launchState.threadsNote}
        </div>
      )}

      {cancelError != null && !terminal && (
        <ErrorState title="Cancelación no enviada" message={cancelError} onRetry={() => void cancel()} />
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
          value={fmtTime(clockSec)}
          hint={timeoutS == null ? ' ' : timeoutS === 0 ? 'sin límite' : `límite ${timeoutS}s`}
        />
        <MetricCard
          icon={<IconCpu size={16} />}
          label="CPU del contenedor"
          help={Help.cpu}
          value={lastMetric != null ? `${Math.round(lastMetric.cpu_percent)}%` : '—'}
          hint={
            <>
              {/* 100% = 1 núcleo; el % es agregado (docker stats), así que con
                  varios hilos supera 100%. Techo ≈ hilos·100 (--cpus). La
                  leyenda va en el tooltip: la tarjeta solo dice «de N%». */}
              <div title="100% = 1 núcleo; con varios hilos el total supera 100%">{`de ${Math.round(cpuMax)}%`}</div>
              {cpuSeries.length >= 2 && <Sparkline data={cpuSeries} max={cpuMax} />}
            </>
          }
        />
        <MetricCard
          icon={<IconMemory size={16} />}
          label="Memoria"
          help={Help.memoria}
          value={lastMetric != null ? fmtBytes(lastMetric.mem_used_bytes) : '—'}
          hint={lastMetric != null ? `de ${fmtBytes(lastMetric.mem_limit_bytes)}` : ' '}
          progressPct={lastMetric != null ? (lastMetric.mem_used_bytes / lastMetric.mem_limit_bytes) * 100 : undefined}
        />
      </div>

      <div className="running-grid">
        <Card>
          {/* Único rótulo de honestidad: la topología es didáctica, no una medida. */}
          <CardHead
            icon={<IconCluster size={16} />}
            title="Hilos"
            sub={nodeCpu != null ? `ilustración · el anillo = CPU media por hilo (${Math.round(nodeCpu / Math.max(1, threads))}%)` : 'ilustración · esperando la primera medida de CPU…'}
            right={Help.hilosIlustracion}
          />
          <div className="live-topology">
            <LiveTopology
              nodes={nodes}
              // En vivo: la ilustración corre mientras el job corre. Reproduciendo: solo mientras
              // avanza el reproductor (parada, queda el cuadro del instante elegido).
              running={replaying ? replay.playing : phase === 'running'}
              reducedMotion={reducedMotion}
              masterCoordinates={coordinates}
              paused={replaying ? !replay.playing : paused}
              speed={replay.speed}
            />
          </div>
          {coordinates && threads > 1 && <p className="field-hint live-topology-note">{MASTER_COORDINATES_NOTE}</p>}
        </Card>
        <LiveTerminalCard
          phase={phase}
          logs={shownLogs}
          logsTruncated={logsTruncated}
          logsGap={logsGap}
        />
      </div>

      {sweep && example != null && isSweepParser(example.parser_id) && (
        <SweepProgressCard logs={shownLogs} parserId={example.parser_id} phase={phase} />
      )}
    </section>
  )
}
