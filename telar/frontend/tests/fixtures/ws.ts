// tests/fixtures/ws.ts — mensajes WS COPIADOS LITERALMENTE de api-contract §8.2
// (mismos nombres snake_case, envelope de mensaje con job_id/ts, 8 fases).
// Un test que pase contra un shape inventado no vale (frontend-spec §10).
import type { JobPhase, ServerMsg, StatusDetailDto, WsErrorCode } from '@/ws/messages'

export const JOB_ID = '01a2b3c4d5e64f789a0b1c2d3e4f5061'

/** status — cambio de fase (detail null salvo terminales). §8.2 */
export function statusMsg(phase: JobPhase, detail: StatusDetailDto | null = null): ServerMsg {
  return { type: 'status', job_id: JOB_ID, ts: '2026-07-12T15:04:05.610Z', phase, detail }
}

/** detail de un status terminal exitoso (copiado del contrato). */
export const COMPLETED_DETAIL: StatusDetailDto = {
  exit_code: 0,
  oom_killed: false,
  wall_time_ms: 8727,
  output_truncated: false,
  error_detail: null,
}

/** log — 1..N líneas completas + seq monótono. §8.2 */
export function logMsg(
  seq: number,
  lines: string[],
  stream: 'stdout' | 'stderr' = 'stdout',
): ServerMsg {
  return { type: 'log', job_id: JOB_ID, ts: '2026-07-12T15:04:08.101Z', stream, lines, seq }
}

/** metrics — muestra de docker stats (cpu_percent puede superar 100). §8.2 */
export function metricsMsg(overrides: Partial<Extract<ServerMsg, { type: 'metrics' }>> = {}): ServerMsg {
  return {
    type: 'metrics',
    job_id: JOB_ID,
    ts: '2026-07-12T15:04:09.000Z',
    cpu_percent: 792.4,
    online_cpus: 8,
    mem_used_bytes: 231211008,
    mem_limit_bytes: 536870912,
    mem_percent: 43.1,
    pids: 12,
    throttled_periods: 0,
    ...overrides,
  }
}

/** error — no fatal, no cierra la conexión. §8.2 */
export function errorMsg(
  code: WsErrorCode,
  message = 'Salida cortada a 262144 bytes; el job será terminado.',
): ServerMsg {
  return { type: 'error', job_id: JOB_ID, ts: '2026-07-12T15:04:10.000Z', code, message }
}

/** eof — último mensaje antes del close 1000. §8.2 */
export function eofMsg(truncated = false, totalLogBytes = 5122): ServerMsg {
  return { type: 'eof', job_id: JOB_ID, ts: '2026-07-12T15:04:14.400Z', total_log_bytes: totalLogBytes, truncated }
}
