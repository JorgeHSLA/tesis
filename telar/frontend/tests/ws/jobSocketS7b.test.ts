// S7b · CU-07.3 (huecos de salida) y CU-08.2/08.3 (cancelar sin socket o
// con el kill fallido) en el cliente WS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANCEL_FAILED_MESSAGE, JobSocket } from '@/ws/jobSocket'
import { useJobStore } from '@/stores/jobStore'
import { FakeWebSocket } from '../setup'
import { errorMsg, JOB_ID, logMsg, statusMsg } from '../fixtures/ws'

function store() {
  return useJobStore.getState()
}

beforeEach(() => {
  FakeWebSocket.reset()
  useJobStore.getState().reset()
  vi.stubGlobal('requestAnimationFrame', undefined)
  vi.stubGlobal('cancelAnimationFrame', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function connectOpen(): { socket: JobSocket; ws: FakeWebSocket } {
  const socket = new JobSocket(JOB_ID)
  socket.connect()
  const ws = FakeWebSocket.last!
  ws.open()
  return { socket, ws }
}

describe('CU-07.3 · huecos de seq', () => {
  it('seq consecutivos desde 1: sin aviso', () => {
    const { ws } = connectOpen()
    ws.emit(logMsg(1, ['a']))
    ws.emit(logMsg(2, ['b']))
    expect(store().logsGap).toBe(false)
  })

  it('un salto de seq marca el hueco', () => {
    const { ws } = connectOpen()
    ws.emit(logMsg(1, ['a']))
    ws.emit(logMsg(3, ['c']))
    expect(store().logsGap).toBe(true)
    expect(store().logs.map((l) => l.text)).toEqual(['a', 'c'])
  })

  it('un seq inicial > 1 (el anillo ya descartó líneas) marca el hueco', () => {
    const { ws } = connectOpen()
    ws.emit(logMsg(7, ['g']))
    expect(store().logsGap).toBe(true)
  })

  it('una conexión nueva empieza sin aviso', () => {
    const { socket, ws } = connectOpen()
    ws.emit(logMsg(5, ['e']))
    expect(store().logsGap).toBe(true)
    socket.retry()
    expect(store().logsGap).toBe(false)
  })
})

describe('CU-08.2/08.3 · cancel()', () => {
  it('devuelve true si envió el frame y false si el socket no está abierto', () => {
    const { socket } = connectOpen()
    expect(socket.cancel()).toBe(true)
    const closed = new JobSocket(JOB_ID)
    closed.connect() // CONNECTING
    expect(closed.cancel()).toBe(false)
  })

  it('error CANCEL_FAILED quita el «Cancelando…» y deja el aviso', () => {
    const { ws } = connectOpen()
    ws.emit(statusMsg('running'))
    store().setCancelling(true)
    ws.emit(errorMsg('CANCEL_FAILED', 'kill falló'))
    expect(store().cancelling).toBe(false)
    expect(store().cancelError).toBe(CANCEL_FAILED_MESSAGE)
    expect(store().wsError).toBeNull()
  })
})
