// Suite 1 (frontend-spec §10): ws/jobSocket.test.ts
// Protocolo WS de 8 fases: parse de los 5 tipos de mensaje del contrato,
// mensajes malformados ignorados, cancel(), close sin eof → 'lost', backoff
// con timers falsos, eof → sin reintento, replay terminal → redirect.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobSocket } from '@/ws/jobSocket'
import { useJobStore } from '@/stores/jobStore'
import { FakeWebSocket } from '../setup'
import {
  COMPLETED_DETAIL,
  eofMsg,
  errorMsg,
  JOB_ID,
  logMsg,
  metricsMsg,
  statusMsg,
} from '../fixtures/ws'

function store() {
  return useJobStore.getState()
}

beforeEach(() => {
  FakeWebSocket.reset()
  useJobStore.getState().reset()
  // rAF ausente → JobSocket.flushLogs() se ejecuta de forma síncrona (§4.1).
  vi.stubGlobal('requestAnimationFrame', undefined)
  vi.stubGlobal('cancelAnimationFrame', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Conecta y devuelve el socket + su FakeWebSocket ya abierto. */
function connectOpen(opts = {}): { socket: JobSocket; ws: FakeWebSocket } {
  const socket = new JobSocket(JOB_ID, opts)
  socket.connect()
  const ws = FakeWebSocket.last!
  ws.open()
  return { socket, ws }
}

describe('URL de conexión', () => {
  it('usa ws_url relativa del 202 cuando está presente', () => {
    const socket = new JobSocket(JOB_ID, { wsUrl: `/ws/jobs/${JOB_ID}?token=x` })
    socket.connect()
    expect(FakeWebSocket.last!.url).toMatch(new RegExp(`/ws/jobs/${JOB_ID}\\?token=x$`))
  })

  it('cae al path /ws/jobs/{id} sin ws_url', () => {
    const socket = new JobSocket(JOB_ID)
    socket.connect()
    expect(FakeWebSocket.last!.url).toMatch(new RegExp(`/ws/jobs/${JOB_ID}$`))
  })

  it('begin() resetea el store y pone phase connecting', () => {
    const socket = new JobSocket(JOB_ID)
    socket.connect()
    expect(store().jobId).toBe(JOB_ID)
    expect(store().phase).toBe('connecting')
    FakeWebSocket.last!.open()
    expect(store().phase).toBe('connecting') // sigue connecting hasta el 1er status
  })
})

describe('parse de los 5 tipos de mensaje', () => {
  it('status no terminal actualiza la fase', () => {
    const { ws } = connectOpen()
    ws.emit(statusMsg('running'))
    expect(store().phase).toBe('running')
    expect(store().startedAt).not.toBeNull()
  })

  it('status terminal con detail puebla exitCode/wallTime', () => {
    const { ws } = connectOpen()
    ws.emit(statusMsg('completed', COMPLETED_DETAIL))
    expect(store().phase).toBe('completed')
    expect(store().exitCode).toBe(0)
    expect(store().wallTimeMs).toBe(8727)
  })

  it('log agrega una entrada por línea (lines[] + seq)', () => {
    const { ws } = connectOpen()
    ws.emit(logMsg(1, ['linea a', 'linea b'], 'stdout'))
    expect(store().logs).toHaveLength(2)
    expect(store().logs[0]).toMatchObject({ seq: 1, stream: 'stdout', text: 'linea a' })
    expect(store().logs[1].text).toBe('linea b')
  })

  it('log dedupe por seq: seq <= último visto se ignora (backlog reconexión)', () => {
    const { ws } = connectOpen()
    ws.emit(logMsg(1, ['a']))
    ws.emit(logMsg(1, ['duplicado']))
    ws.emit(logMsg(2, ['b']))
    expect(store().logs.map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('metrics con cpu_percent > 100 se agrega tal cual', () => {
    const { ws } = connectOpen()
    ws.emit(metricsMsg({ cpu_percent: 792.4 }))
    expect(store().metrics).toHaveLength(1)
    expect(store().metrics[0].cpu_percent).toBe(792.4)
    expect(store().metrics[0].online_cpus).toBe(8)
  })

  it('error OUTPUT_TRUNCATED marca logsTruncated (banner) sin cerrar', () => {
    const { ws } = connectOpen()
    ws.emit(errorMsg('OUTPUT_TRUNCATED'))
    expect(store().logsTruncated).toBe(true)
    expect(store().wsError).toBeNull()
  })

  it('error STREAM_ERROR guarda wsError', () => {
    const { ws } = connectOpen()
    ws.emit(errorMsg('STREAM_ERROR', 'fallo leyendo logs'))
    expect(store().wsError).toBe('fallo leyendo logs')
  })

  it('eof marca sawEof y truncated', () => {
    const { ws } = connectOpen()
    ws.emit(eofMsg(true))
    expect(store().sawEof).toBe(true)
    expect(store().logsTruncated).toBe(true)
  })
})

describe('mensajes malformados', () => {
  it('un frame no-JSON se ignora con warn (no lanza)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ws } = connectOpen()
    expect(() => ws.emit('esto no es json {')).not.toThrow()
    expect(warn).toHaveBeenCalled()
    expect(store().logs).toHaveLength(0)
  })

  it('un type desconocido se ignora con warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ws } = connectOpen()
    ws.emit({ type: 'bogus', job_id: JOB_ID, ts: 'x' })
    expect(warn).toHaveBeenCalled()
  })
})

describe('cancel()', () => {
  it('envía exactamente {"type":"cancel"} con el socket abierto', () => {
    const { socket, ws } = connectOpen()
    socket.cancel()
    expect(ws.sent).toEqual(['{"type":"cancel"}'])
  })

  it('no envía nada si el socket no está OPEN', () => {
    const socket = new JobSocket(JOB_ID)
    socket.connect()
    const ws = FakeWebSocket.last! // aún CONNECTING (no open())
    socket.cancel()
    expect(ws.sent).toEqual([])
  })
})

describe('cierre y backoff', () => {
  it('close del servidor sin eof → phase lost + reintento con backoff', () => {
    vi.useFakeTimers()
    const { ws } = connectOpen()
    ws.emit(statusMsg('running'))
    ws.serverClose(1006) // cierre anómalo, sin eof
    expect(store().phase).toBe('lost')

    // Backoff 1s → reconexión (nueva instancia de WebSocket).
    const before = FakeWebSocket.instances.length
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances.length).toBe(before + 1)
    expect(store().phase).toBe('connecting')
  })

  it('backoff se agota tras 3 reintentos (1s/2s/4s)', () => {
    vi.useFakeTimers()
    const { ws } = connectOpen()
    let current = ws
    const delays = [1000, 2000, 4000]
    for (let attempt = 0; attempt < 3; attempt++) {
      current.serverClose(1006)
      const before = FakeWebSocket.instances.length
      vi.advanceTimersByTime(delays[attempt])
      expect(FakeWebSocket.instances.length).toBe(before + 1)
      current = FakeWebSocket.last!
    }
    // 4º cierre: ya no hay más reintentos.
    current.serverClose(1006)
    const after = FakeWebSocket.instances.length
    vi.advanceTimersByTime(10000)
    expect(FakeWebSocket.instances.length).toBe(after)
  })

  it('eof previo → close 1000 NO reintenta', () => {
    vi.useFakeTimers()
    const { ws } = connectOpen()
    ws.emit(statusMsg('completed', COMPLETED_DETAIL))
    ws.emit(eofMsg(false))
    const before = FakeWebSocket.instances.length
    ws.serverClose(1000)
    vi.advanceTimersByTime(10000)
    expect(FakeWebSocket.instances.length).toBe(before) // sin reconexión
    expect(store().phase).toBe('completed') // no pasa a 'lost'
  })

  it('close 4404 → wsError JOB_NOT_FOUND + onNotFound, sin reintento', () => {
    vi.useFakeTimers()
    const onNotFound = vi.fn()
    const { ws } = connectOpen({ onNotFound })
    const before = FakeWebSocket.instances.length
    ws.serverClose(4404, 'job not found')
    expect(store().wsError).toBe('JOB_NOT_FOUND')
    expect(onNotFound).toHaveBeenCalledWith(JOB_ID)
    vi.advanceTimersByTime(10000)
    expect(FakeWebSocket.instances.length).toBe(before)
  })

  it('retry() manual reconecta reseteando el backoff', () => {
    vi.useFakeTimers()
    const { socket, ws } = connectOpen()
    ws.serverClose(1006)
    const before = FakeWebSocket.instances.length
    socket.retry()
    expect(FakeWebSocket.instances.length).toBe(before + 1)
  })

  it('close() del cliente no dispara reintentos', () => {
    vi.useFakeTimers()
    const { socket, ws } = connectOpen()
    const before = FakeWebSocket.instances.length
    socket.close()
    expect(ws.clientClose?.code).toBe(1000)
    vi.advanceTimersByTime(10000)
    expect(FakeWebSocket.instances.length).toBe(before)
  })
})

describe('BL-10: retry() resetea el estado de dedupe (sesión nueva)', () => {
  it('el replay renumerado tras retry() re-puebla los logs (no se descarta)', () => {
    vi.useFakeTimers()
    const { socket, ws } = connectOpen()
    ws.emit(statusMsg('running'))
    ws.emit(logMsg(5, ['linea vieja']))
    ws.serverClose(1006) // conexión perdida sin eof (fuerza el flush)
    expect(store().logs).toHaveLength(1)
    expect(store().phase).toBe('lost')

    socket.retry()
    const ws2 = FakeWebSocket.last!
    ws2.open()
    expect(store().logs).toHaveLength(0) // begin() vació el store
    // el job terminó durante la desconexión: replay desde DB con seq
    // renumerado desde 1 (≤ lastLogSeq=5 de la sesión anterior)
    ws2.emit(statusMsg('completed', COMPLETED_DETAIL))
    ws2.emit(logMsg(1, ['salida completa']))
    ws2.emit(eofMsg(false))
    // sin el reset del dedupe, la terminal quedaba VACÍA (auditoría BL-10)
    expect(store().logs.map((l) => l.text)).toEqual(['salida completa'])
  })

  it('el job completado durante la desconexión NO expulsa del live', () => {
    vi.useFakeTimers()
    const onReplayTerminal = vi.fn()
    const { socket, ws } = connectOpen({ onReplayTerminal })
    ws.emit(statusMsg('running')) // el usuario SÍ lo vio correr
    ws.serverClose(1006)

    socket.retry()
    const ws2 = FakeWebSocket.last!
    ws2.open()
    ws2.emit(statusMsg('completed', COMPLETED_DETAIL))
    ws2.emit(eofMsg(false))
    // sawActivePhase es de la INSTANCIA (esta visita), no de la conexión:
    // se queda en el live ya re-poblado, igual que si nunca se hubiera caído.
    expect(onReplayTerminal).not.toHaveBeenCalled()
    expect(store().phase).toBe('completed')
  })

  it('sin fase viva en toda la visita, el replay tras retry() sí redirige', () => {
    vi.useFakeTimers()
    const onReplayTerminal = vi.fn()
    const { socket, ws } = connectOpen({ onReplayTerminal })
    ws.serverClose(1006) // aterrizaje fallido, nunca se vio el job vivo

    socket.retry()
    const ws2 = FakeWebSocket.last!
    ws2.open()
    ws2.emit(statusMsg('completed', COMPLETED_DETAIL))
    ws2.emit(eofMsg(false))
    expect(onReplayTerminal).toHaveBeenCalledWith(JOB_ID)
  })

  it('retry() resetea también el backoff (el banner siempre reconecta)', () => {
    vi.useFakeTimers()
    const { socket, ws } = connectOpen()
    let current = ws
    for (const delay of [1000, 2000, 4000]) {
      current.serverClose(1006)
      vi.advanceTimersByTime(delay)
      current = FakeWebSocket.last!
    }
    current.serverClose(1006) // backoff agotado
    const before = FakeWebSocket.instances.length
    socket.retry() // connect() es autocontenido: reintentos a cero
    expect(FakeWebSocket.instances.length).toBe(before + 1)
    FakeWebSocket.last!.serverClose(1006)
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances.length).toBe(before + 2)
  })

  it('el sawEof de una sesión anterior no suprime el backoff de la nueva', () => {
    vi.useFakeTimers()
    const { socket, ws } = connectOpen()
    ws.emit(statusMsg('completed', COMPLETED_DETAIL))
    ws.emit(eofMsg(false))
    ws.serverClose(1000) // cierre normal de la sesión 1

    socket.retry() // el usuario relanza la conexión (sesión 2)
    const ws2 = FakeWebSocket.last!
    ws2.open()
    const before = FakeWebSocket.instances.length
    ws2.serverClose(1006) // la sesión 2 cae SIN eof propio
    expect(store().phase).toBe('lost')
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances.length).toBe(before + 1) // sí reintenta
  })
})

describe('replay terminal (F5 / historial)', () => {
  it('status terminal + eof SIN fase viva previa dispara onReplayTerminal', () => {
    const onReplayTerminal = vi.fn()
    const { ws } = connectOpen({ onReplayTerminal })
    ws.emit(statusMsg('completed', COMPLETED_DETAIL))
    ws.emit(logMsg(1, ['hilos = 1 | tiempo = 0.726 s']))
    ws.emit(eofMsg(false))
    expect(onReplayTerminal).toHaveBeenCalledWith(JOB_ID)
  })

  it('si se vio una fase viva (running), el eof NO redirige', () => {
    const onReplayTerminal = vi.fn()
    const { ws } = connectOpen({ onReplayTerminal })
    ws.emit(statusMsg('running'))
    ws.emit(statusMsg('completed', COMPLETED_DETAIL))
    ws.emit(eofMsg(false))
    expect(onReplayTerminal).not.toHaveBeenCalled()
  })
})
