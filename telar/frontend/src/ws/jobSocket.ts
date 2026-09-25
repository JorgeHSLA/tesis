// ws/jobSocket.ts — cliente del protocolo WS (espejo LITERAL de
// api-contract §8; tipos en ws/messages.ts, CONGELADOS).
//
// Reglas implementadas (frontend-spec §4.1):
// - URL: `ws_url` relativa del 202 (+ WS_BASE); fallback /ws/jobs/{id}.
// - onopen → phase 'connecting' hasta el primer `status` (snapshot).
// - Mensaje de `type` desconocido → se ignora con console.warn.
// - Logs: buffer local + flush a jobStore.appendLogs() máx. 1/rAF; el store
//   recorta a 1000 líneas. Dedupe por `seq` (el backlog re-usa los seq
//   originales — evita duplicados tras reconexión/StrictMode re-connect).
// - Métricas: appendMetric directo (1/s, sin batching).
// - onclose sin `eof` previo → phase 'lost' + backoff 1s/2s/4s (máx 3).
// - close 4404 → job inexistente (wsError 'JOB_NOT_FOUND', sin reintento).
// - NO existe 4409: job ya terminal = replay (status terminal + log·N + eof
//   + close 1000). Si nunca se vio una fase NO terminal en vivo →
//   onReplayTerminal (el hook redirige a /resultados/{jobId}).
// - error OUTPUT_TRUNCATED / eof.truncated → logsTruncated (banner §6.3.5).
// - CU-07.3: un salto de `seq` o un primer seq > 1 → logsGap (aviso).
// - cancel() envía {"type":"cancel"} (idempotente en el servidor) y dice si
//   pudo enviarlo; error CANCEL_FAILED → cancelError (CU-08.3).
import { WS_BASE } from '../config'
import { useJobStore, type LogLine } from '../stores/jobStore'
import type { ClientMsg, JobPhase, ServerMsg } from './messages'

const BACKOFF_MS = [1000, 2000, 4000] as const

/** Aviso único de CU-08.2/08.3 (REST caído o CANCEL_FAILED del servidor). */
export const CANCEL_FAILED_MESSAGE = 'No fue posible solicitar la cancelación. La ejecución puede continuar activa.'
const TERMINAL: ReadonlySet<JobPhase> = new Set(['completed', 'failed', 'timeout', 'cancelled'])

export interface JobSocketOptions {
  /** `ws_url` RELATIVA de la respuesta 202 de POST /api/v1/jobs. */
  wsUrl?: string | null
  /** Replay de job ya terminal (F5/historial) → redirigir a resultados. */
  onReplayTerminal?: (jobId: string) => void
  /** Cierre 4404: el job no existe o fue limpiado. */
  onNotFound?: (jobId: string) => void
}

export class JobSocket {
  readonly jobId: string

  private readonly opts: JobSocketOptions
  private ws: WebSocket | null = null
  private buffer: LogLine[] = []
  private rafId: number | null = null
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private closedByClient = false
  private sawEof = false
  private lastLogSeq = -1
  /** Se vio alguna fase NO terminal (job vivo) en esta sesión de socket. */
  private sawActivePhase = false
  private lastPhase: JobPhase | null = null

  constructor(jobId: string, opts: JobSocketOptions = {}) {
    this.jobId = jobId
    this.opts = opts
  }

  /** Inicia (o reinicia) la conexión. Resetea el store vía begin(). */
  connect(): void {
    this.closedByClient = false
    this.resetSession()
    useJobStore.getState().begin(this.jobId)
    this.open()
  }

  /** Reintento manual (banner «Reintentar conexión» del estado lost). */
  retry(): void {
    this.connect()
  }

  /** Envía el único comando del contrato (§8.3). `false` si el socket no
   *  está abierto: el llamador cae al REST (CU-08.2). */
  cancel(): boolean {
    if (this.ws == null || this.ws.readyState !== WebSocket.OPEN) return false
    const msg: ClientMsg = { type: 'cancel' }
    this.ws.send(JSON.stringify(msg))
    return true
  }

  /** Cierre iniciado por el cliente (unmount/cambio de job): sin reintentos. */
  close(): void {
    this.closedByClient = true
    this.clearRetryTimer()
    this.flushLogs()
    if (this.ws != null) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000)
      }
      this.ws = null
    }
  }

  // ───────────────────────────── internos ──────────────────────────────

  /**
   * Estado de dedupe/buffer que debe empezar de cero con CADA (re)conexión y
   * su `begin()` del store (BL-09/10): el buffer pendiente, el dedupe por `seq`,
   * `sawEof` y la última fase. Si no, el backlog —o el replay renumerado desde
   * DB (§8.2)— llega con `seq` que el filtro descarta y la terminal queda vacía.
   *
   * NO incluye `retries` (presupuesto de backoff: se agota a lo largo de varias
   * reconexiones automáticas) ni `sawActivePhase` (ámbito de la INSTANCIA = esta
   * visita a la pantalla, no la conexión): éste distingue «aterricé en un job ya
   * terminado» —F5/historial, redirigir a resultados— de «lo vi correr y se
   * completó mientras reconectaba», donde el usuario se queda en el live
   * re-poblado.
   */
  private resetDedupe(): void {
    this.cancelPendingFlush()
    this.buffer = []
    this.lastLogSeq = -1
    this.sawEof = false
    this.lastPhase = null
  }

  /**
   * Reinicio de sesión COMPLETO (conexión/retry manual): además del dedupe,
   * pone a cero el presupuesto de backoff. Va emparejado con `begin()`.
   */
  private resetSession(): void {
    this.resetDedupe()
    this.retries = 0
    this.clearRetryTimer()
  }

  private cancelPendingFlush(): void {
    if (this.rafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId)
    }
    this.rafId = null
  }

  private wsPath(): string {
    const rel = this.opts.wsUrl
    return rel != null && rel !== '' ? rel : `/ws/jobs/${this.jobId}`
  }

  private open(): void {
    let ws: WebSocket
    try {
      ws = new WebSocket(WS_BASE + this.wsPath())
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      // 'connecting' hasta el primer status (snapshot) — §4.1.
      useJobStore.getState().setPhase('connecting')
    }
    ws.onmessage = (ev) => this.handleMessage(ev)
    ws.onclose = (ev) => this.handleClose(ev)
    // onerror siempre viene seguido de onclose: la lógica vive en onclose.
    ws.onerror = null
  }

  private handleMessage(ev: MessageEvent): void {
    let msg: ServerMsg
    try {
      msg = JSON.parse(String(ev.data)) as ServerMsg
    } catch {
      console.warn('[JobSocket] mensaje no-JSON ignorado')
      return
    }
    const store = useJobStore.getState()
    switch (msg.type) {
      case 'status': {
        this.lastPhase = msg.phase
        if (!TERMINAL.has(msg.phase)) this.sawActivePhase = true
        store.setPhase(msg.phase, msg.detail)
        break
      }
      case 'log': {
        // Dedupe del backlog tras reconexión (los seq originales se re-usan).
        if (msg.seq <= this.lastLogSeq) return
        // CU-07.3: seq empieza en 1 y crece de 1 en 1; un salto significa que
        // el anillo del backend o la cola lossy descartaron mensajes.
        if (msg.seq > (this.lastLogSeq < 0 ? 1 : this.lastLogSeq + 1)) store.markLogsGap()
        this.lastLogSeq = msg.seq
        for (const text of msg.lines) {
          this.buffer.push({ seq: msg.seq, ts: msg.ts, stream: msg.stream, text })
        }
        this.scheduleFlush()
        break
      }
      case 'metrics': {
        store.appendMetric({
          ts: msg.ts,
          cpu_percent: msg.cpu_percent,
          online_cpus: msg.online_cpus,
          mem_used_bytes: msg.mem_used_bytes,
          mem_limit_bytes: msg.mem_limit_bytes,
          pids: msg.pids,
        })
        break
      }
      case 'error': {
        // No cierra la conexión (§8.2). OUTPUT_TRUNCATED → banner del terminal.
        if (msg.code === 'OUTPUT_TRUNCATED') store.markLogsTruncated()
        else if (msg.code === 'CANCEL_FAILED') {
          store.setCancelling(false)
          store.setCancelError(CANCEL_FAILED_MESSAGE)
        } else store.setWsError(msg.message)
        break
      }
      case 'eof': {
        this.sawEof = true
        this.flushLogs()
        store.markEof(msg.truncated)
        // Replay de job terminal (F5/historial): status terminal + logs + eof
        // sin haber pasado por ninguna fase viva → redirigir a resultados.
        if (this.lastPhase != null && TERMINAL.has(this.lastPhase) && !this.sawActivePhase) {
          this.opts.onReplayTerminal?.(this.jobId)
        }
        break
      }
      default:
        console.warn('[JobSocket] tipo de mensaje desconocido ignorado', msg)
    }
  }

  private handleClose(ev: CloseEvent): void {
    this.flushLogs()
    if (this.closedByClient) return
    if (ev.code === 4404) {
      // Job inexistente: sin reintentos (no va a aparecer).
      useJobStore.getState().setWsError('JOB_NOT_FOUND')
      this.opts.onNotFound?.(this.jobId)
      return
    }
    if (this.sawEof) return // cierre 1000 normal tras eof
    // Cierre sin eof: conexión perdida → backoff 1s/2s/4s (máx 3).
    useJobStore.getState().setPhase('lost')
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.closedByClient || this.retries >= BACKOFF_MS.length) return
    const delay = BACKOFF_MS[this.retries]
    this.retries += 1
    this.clearRetryTimer()
    this.retryTimer = setTimeout(() => {
      if (this.closedByClient) return
      // BL-09/10: la reconexión AUTOMÁTICA resetea el dedupe (`lastLogSeq`) y
      // vacía los logs del store vía `beginReconnect()` — para aceptar tanto el
      // backlog retenido (seq reales, dentro de la ventana de retención) como el
      // replay renumerado desde DB (§8.2) si la ventana expiró, sin duplicar ni
      // descartar. Reset PARCIAL a propósito: `beginReconnect` PRESERVA `metrics`
      // (el backend no los replica) y `startedAt` (el contador no salta por un
      // blip). Preserva además `retries` (presupuesto de backoff) y
      // `sawActivePhase` (ámbito de la visita, no de la conexión).
      this.resetDedupe()
      useJobStore.getState().beginReconnect(this.jobId)
      this.open()
    }, delay)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /** Flush batched: máx. una escritura al store por animation frame (§4.1). */
  private scheduleFlush(): void {
    if (this.rafId != null) return
    // rAF en navegador; fallback inmediato en entornos sin rAF (tests node).
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null
        this.flushLogs()
      })
    } else {
      this.flushLogs()
    }
  }

  private flushLogs(): void {
    this.cancelPendingFlush()
    if (this.buffer.length === 0) return
    const lines = this.buffer
    this.buffer = []
    useJobStore.getState().appendLogs(lines)
  }
}
