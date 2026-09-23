// stores/jobStore.ts — estado del job activo (frontend-spec §3.1).
// `phase` usa el VOCABULARIO EXACTO de api-contract §7.7 (8 fases) más 3
// estados locales del cliente: idle | connecting | lost.
// Caps: logs 1000 líneas (slice(-1000) en cada flush) · métricas 900 (~15 min).
// Las escrituras llegan desde JobSocket (fuera de React); los logs vienen ya
// batcheados por rAF desde el socket (§4.1).
//
// DECISIÓN (documentada): el store NO se resetea al desmontar el live —
// §6.4 exige que `jobStore.metrics` siga en memoria al navegar del live a
// Resultados (LiveMetricsChart). El reset TOTAL ocurre en `begin()` al conectar
// con un job (nuevo, o retry MANUAL del banner). La reconexión AUTOMÁTICA usa
// `beginReconnect()`: reset PARCIAL que vacía los logs (los re-puebla el backlog
// o el replay renumerado, BL-09/10) pero PRESERVA `metrics` y `startedAt` — el
// backend no replica métricas y el contador de tiempo no debe saltar por un blip.
import { create } from 'zustand'
import type { JobPhase, StatusDetailDto } from '../ws/messages'

/** Fases del contrato (8) + estados locales del cliente. */
export type UiPhase = 'idle' | 'connecting' | 'lost' | JobPhase

/** Modelo UI derivado 1:1 del mensaje WS `log` (una entrada por línea). */
export interface LogLine {
  seq: number
  ts: string
  stream: 'stdout' | 'stderr'
  text: string
}

/** Modelo UI derivado 1:1 del mensaje WS `metrics`. */
export interface MetricSample {
  ts: string
  cpu_percent: number
  online_cpus: number
  mem_used_bytes: number
  mem_limit_bytes: number
  pids: number
}

export const LOG_CAP = 1000
export const METRICS_CAP = 900

const TERMINAL_PHASES: ReadonlySet<UiPhase> = new Set(['completed', 'failed', 'timeout', 'cancelled'])

export function isTerminalPhase(phase: UiPhase): boolean {
  return TERMINAL_PHASES.has(phase)
}

export interface JobState {
  jobId: string | null
  phase: UiPhase
  /** De status.detail.exit_code (fase terminal). */
  exitCode: number | null
  /** De status.detail.error_detail. */
  errorDetail: string | null
  /** Epoch ms del inicio del contenedor: `started_at` real del servidor si se
   *  conoce (setStartedAt); si no, reloj local al recibir compiling/running. */
  startedAt: number | null
  /** De status.detail.wall_time_ms (congela el contador al terminar). */
  wallTimeMs: number | null
  logs: LogLine[]
  /** Cap local descartó líneas O eof.truncated / error OUTPUT_TRUNCATED. */
  logsTruncated: boolean
  metrics: MetricSample[]
  wsError: string | null
  /** El servidor emitió `eof` (cierre 1000 posterior = normal). */
  sawEof: boolean
  // Acciones llamadas por JobSocket (fuera de React):
  begin(jobId: string): void
  beginReconnect(jobId: string): void
  appendLogs(lines: LogLine[]): void
  appendMetric(m: MetricSample): void
  setPhase(p: UiPhase, detail?: StatusDetailDto | null): void
  /** `started_at` ISO de GET /jobs/{id} (CU-07.4): prevalece sobre el reloj local. */
  setStartedAt(iso: string | null): void
  markLogsTruncated(): void
  setWsError(msg: string | null): void
  markEof(truncated: boolean): void
  reset(): void
}

const INITIAL = {
  jobId: null as string | null,
  phase: 'idle' as UiPhase,
  exitCode: null as number | null,
  errorDetail: null as string | null,
  startedAt: null as number | null,
  wallTimeMs: null as number | null,
  logs: [] as LogLine[],
  logsTruncated: false,
  metrics: [] as MetricSample[],
  wsError: null as string | null,
  sawEof: false,
}

export const useJobStore = create<JobState>()((set) => ({
  ...INITIAL,

  begin: (jobId) => set({ ...INITIAL, jobId, phase: 'connecting' }),

  // Reset PARCIAL de la reconexión automática (BL-09/10): vacía los logs y el
  // wsError/sawEof de la sesión (el backlog/replay re-pueblan los logs; con
  // `lastLogSeq` reseteado en el socket no hay duplicados ni descartes) PERO
  // preserva `metrics` (el backend no los replica → no se pierde el
  // LiveMetricsChart), `startedAt`/`wallTimeMs`/`exitCode`/`errorDetail` (un
  // status de replay los reescribe si aplica) y `logsTruncated`: es un latch (el
  // resto de reducers hace `|| truncated`) y `OUTPUT_TRUNCATED` se señaliza UNA
  // vez (no viaja en el backlog), así que resetearlo perdería el banner de un job
  // ya truncado tras un blip.
  beginReconnect: (jobId) =>
    set({ jobId, phase: 'connecting', logs: [], wsError: null, sawEof: false }),

  appendLogs: (lines) =>
    set((s) => {
      if (lines.length === 0) return s
      const merged = s.logs.length === 0 ? lines : [...s.logs, ...lines]
      const trimmed = merged.length > LOG_CAP
      return {
        logs: trimmed ? merged.slice(-LOG_CAP) : merged,
        logsTruncated: s.logsTruncated || trimmed,
      }
    }),

  appendMetric: (m) =>
    set((s) => {
      const merged = [...s.metrics, m]
      return { metrics: merged.length > METRICS_CAP ? merged.slice(-METRICS_CAP) : merged }
    }),

  setPhase: (p, detail) =>
    set((s) => ({
      phase: p,
      // El cronómetro corre desde que arranca el contenedor (compiling), no
      // desde el primer byte de stdout (CU-07.1).
      startedAt: (p === 'compiling' || p === 'running') && s.startedAt == null ? Date.now() : s.startedAt,
      ...(detail != null
        ? {
            exitCode: detail.exit_code,
            errorDetail: detail.error_detail,
            wallTimeMs: detail.wall_time_ms,
            logsTruncated: s.logsTruncated || detail.output_truncated,
          }
        : null),
    })),

  setStartedAt: (iso) => {
    const ms = iso != null ? Date.parse(iso) : Number.NaN
    if (!Number.isNaN(ms)) set({ startedAt: ms })
  },

  markLogsTruncated: () => set({ logsTruncated: true }),

  setWsError: (msg) => set({ wsError: msg }),

  markEof: (truncated) => set((s) => ({ sawEof: true, logsTruncated: s.logsTruncated || truncated })),

  reset: () => set({ ...INITIAL }),
}))
