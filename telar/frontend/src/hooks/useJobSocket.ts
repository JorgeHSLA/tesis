// hooks/useJobSocket.ts — ciclo de vida del JobSocket (frontend-spec §4.3).
// Crea el socket al montar con jobId definido; close() al desmontar o cambiar
// de job. Idempotente ante StrictMode: cada setup crea su instancia y su
// cleanup la cierra (el backend hace fan-out, la conexión duplicada breve es
// inocua — api-contract §8.1). El store NO se resetea al desmontar (decisión
// en jobStore.ts: §6.4 necesita metrics en memoria al navegar a resultados).
// Replay de job terminal (F5/historial) → redirect a /resultados/{jobId}.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { cancelJob } from '../api/jobs'
import { isTerminalPhase, useJobStore, type LogLine, type MetricSample, type UiPhase } from '../stores/jobStore'
import { CANCEL_FAILED_MESSAGE, JobSocket } from '../ws/jobSocket'

export interface JobSocketState {
  phase: UiPhase
  exitCode: number | null
  errorDetail: string | null
  logs: LogLine[]
  logsTruncated: boolean
  /** CU-07.3: faltan líneas de salida (hueco de seq). */
  logsGap: boolean
  metrics: MetricSample[]
  /** Derivado de startedAt con un tick propio de 1 s (congelado al terminar). */
  elapsedSec: number
  /** wsError local ('JOB_NOT_FOUND' en close 4404, STREAM_ERROR…). */
  wsError: string | null
  /** CU-08.2: cancelación pedida, esperando el estado terminal. */
  cancelling: boolean
  /** CU-08.2/08.3: la cancelación no se pudo pedir. */
  cancelError: string | null
  /** WS si está abierto; si no, POST /cancel (CU-08.2). */
  cancel: () => Promise<void>
  /** Reintento manual desde el banner de conexión perdida. */
  retry: () => void
}

export function useJobSocket(jobId: string | undefined): JobSocketState {
  const navigate = useNavigate()
  const location = useLocation()
  // ws_url relativa del 202 (pasada por navigate state desde el idle).
  const wsUrl = (location.state as { wsUrl?: string } | null)?.wsUrl ?? null
  const socketRef = useRef<JobSocket | null>(null)

  const phase = useJobStore((s) => s.phase)
  const exitCode = useJobStore((s) => s.exitCode)
  const errorDetail = useJobStore((s) => s.errorDetail)
  const logs = useJobStore((s) => s.logs)
  const logsTruncated = useJobStore((s) => s.logsTruncated)
  const logsGap = useJobStore((s) => s.logsGap)
  const cancelling = useJobStore((s) => s.cancelling)
  const cancelError = useJobStore((s) => s.cancelError)
  const metrics = useJobStore((s) => s.metrics)
  const wsError = useJobStore((s) => s.wsError)
  const startedAt = useJobStore((s) => s.startedAt)
  const wallTimeMs = useJobStore((s) => s.wallTimeMs)

  useEffect(() => {
    if (jobId == null || jobId === '') return
    const socket = new JobSocket(jobId, {
      wsUrl,
      onReplayTerminal: (id) => navigate(`/resultados/${id}`, { replace: true }),
    })
    socketRef.current = socket
    socket.connect()
    return () => {
      if (socketRef.current === socket) socketRef.current = null
      socket.close()
    }
    // wsUrl solo cambia junto con jobId (nueva navegación) — no re-conectar por él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, navigate])

  // Tick de 1 s propio mientras el job corre (frontend-spec §4.3).
  const [nowMs, setNowMs] = useState(() => Date.now())
  const running = startedAt != null && !isTerminalPhase(phase)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const elapsedSec =
    isTerminalPhase(phase) && wallTimeMs != null
      ? wallTimeMs / 1000
      : startedAt != null
        ? Math.max(0, (nowMs - startedAt) / 1000)
        : 0

  const cancel = useCallback(async () => {
    if (jobId == null || jobId === '') return
    const store = useJobStore.getState()
    store.setCancelError(null)
    store.setCancelling(true)
    if (socketRef.current?.cancel() === true) return
    try {
      await cancelJob(jobId)
    } catch (err: unknown) {
      store.setCancelling(false)
      // 409: el job ya terminó; el estado terminal llega al reconectar.
      if (err instanceof ApiError && err.code === 'JOB_NOT_CANCELLABLE') return
      store.setCancelError(CANCEL_FAILED_MESSAGE)
    }
  }, [jobId])
  const retry = useCallback(() => socketRef.current?.retry(), [])

  return {
    phase,
    exitCode,
    errorDetail,
    logs,
    logsTruncated,
    logsGap,
    metrics,
    elapsedSec,
    wsError,
    cancelling,
    cancelError,
    cancel,
    retry,
  }
}
