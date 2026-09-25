// ws/messages.ts — TRANSCRIPCIÓN LITERAL de api-contract.md §8.2-§8.3
// (espejo en frontend-spec.md §4.2). NO renombrar campos.
//
// Cierres: 1000 normal (tras eof) · 4404 job inexistente · 1011 error interno.
// NO existe 4409: "job terminal" = replay + status terminal + eof + close 1000.

/** Campos comunes de todo mensaje servidor → cliente. `ts` es ISO-8601 UTC. */
export interface WsBase {
  job_id: string
  ts: string
}

/** Las 8 fases del contrato (§7.7). */
export type JobPhase =
  | 'queued'
  | 'creating'
  | 'compiling'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'

/** `detail` de un `status` terminal (solo se puebla en fases terminales). */
export type StatusDetailDto = {
  exit_code: number | null
  oom_killed: boolean
  wall_time_ms: number | null
  output_truncated: boolean
  error_detail: string | null
}

/** Códigos de `error` no fatal del stream (§8.2). No cierran la conexión.
 *  CANCEL_FAILED: enmienda aditiva 2026-09-24 (CU-08.3). */
export type WsErrorCode = 'OUTPUT_TRUNCATED' | 'STREAM_ERROR' | 'BAD_CLIENT_MESSAGE' | 'CANCEL_FAILED'

export type ServerMsg =
  | (WsBase & {
      type: 'status'
      phase: JobPhase
      detail: StatusDetailDto | null // detail solo en terminales
    })
  | (WsBase & {
      type: 'log'
      stream: 'stdout' | 'stderr'
      /** 1..N líneas completas re-bufferizadas por \n en el backend. */
      lines: string[]
      /** Contador monótono por job (detección de huecos tras reconexión). */
      seq: number
    })
  | (WsBase & {
      type: 'metrics'
      /** Fórmula cgroups v2 — puede superar 100 (N hilos ≈ N·100). */
      cpu_percent: number
      online_cpus: number
      mem_used_bytes: number
      mem_limit_bytes: number
      mem_percent: number
      pids: number
      throttled_periods: number
    })
  | (WsBase & {
      type: 'error'
      code: WsErrorCode
      message: string
    })
  | (WsBase & {
      type: 'eof'
      total_log_bytes: number
      truncated: boolean
    })

/** Cliente → servidor: único comando soportado (§8.3). */
export type ClientMsg = { type: 'cancel' }
