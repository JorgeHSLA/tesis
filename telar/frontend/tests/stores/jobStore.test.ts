// Suite 2 (frontend-spec §10): stores/jobStore.test.ts
// UiPhase, caps de buffer (logs 1000, métricas 900), batching (1 notificación
// por flush), reset() y setPhase con detail terminal.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isTerminalPhase,
  LOG_CAP,
  METRICS_CAP,
  useJobStore,
  type LogLine,
  type MetricSample,
} from '@/stores/jobStore'
import { COMPLETED_DETAIL } from '../fixtures/ws'

function makeLogs(n: number, from = 0): LogLine[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: from + i,
    ts: '2026-07-12T15:04:08.101Z',
    stream: 'stdout' as const,
    text: `linea ${from + i}`,
  }))
}

function makeMetric(i: number): MetricSample {
  return {
    ts: `2026-07-12T15:04:${String(i % 60).padStart(2, '0')}.000Z`,
    cpu_percent: 100 + i,
    online_cpus: 8,
    mem_used_bytes: 1000 + i,
    mem_limit_bytes: 536870912,
    pids: 4,
  }
}

beforeEach(() => {
  useJobStore.getState().reset()
})

describe('begin() / reset()', () => {
  it('begin() limpia todo y deja phase connecting con el jobId', () => {
    const s = useJobStore.getState()
    s.appendLogs(makeLogs(3))
    s.begin('nuevo-job')
    const st = useJobStore.getState()
    expect(st.jobId).toBe('nuevo-job')
    expect(st.phase).toBe('connecting')
    expect(st.logs).toHaveLength(0)
    expect(st.metrics).toHaveLength(0)
    expect(st.logsTruncated).toBe(false)
    expect(st.sawEof).toBe(false)
  })

  it('reset() vuelve al estado inicial (idle, sin jobId)', () => {
    const s = useJobStore.getState()
    s.begin('job')
    s.setPhase('running')
    s.reset()
    const st = useJobStore.getState()
    expect(st.phase).toBe('idle')
    expect(st.jobId).toBeNull()
    expect(st.startedAt).toBeNull()
  })
})

describe('cap de logs (1000) + flag truncated', () => {
  it('recorta a LOG_CAP y activa logsTruncated cuando se supera', () => {
    const s = useJobStore.getState()
    s.appendLogs(makeLogs(1500))
    const st = useJobStore.getState()
    expect(st.logs).toHaveLength(LOG_CAP)
    expect(st.logsTruncated).toBe(true)
    // conserva las ÚLTIMAS líneas (slice(-1000)).
    expect(st.logs[st.logs.length - 1].text).toBe('linea 1499')
    expect(st.logs[0].text).toBe('linea 500')
  })

  it('por debajo del cap no marca truncado', () => {
    useJobStore.getState().appendLogs(makeLogs(10))
    expect(useJobStore.getState().logsTruncated).toBe(false)
  })

  it('appendLogs([]) es no-op', () => {
    const s = useJobStore.getState()
    s.appendLogs(makeLogs(2))
    const before = useJobStore.getState().logs
    s.appendLogs([])
    expect(useJobStore.getState().logs).toBe(before)
  })
})

describe('batching: 1 notificación por flush', () => {
  it('un appendLogs con N líneas notifica UNA sola vez', () => {
    const listener = vi.fn()
    const unsub = useJobStore.subscribe(listener)
    useJobStore.getState().appendLogs(makeLogs(50))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(useJobStore.getState().logs).toHaveLength(50)
    unsub()
  })

  it('dos flushes separados notifican dos veces (acumulando)', () => {
    const listener = vi.fn()
    const unsub = useJobStore.subscribe(listener)
    useJobStore.getState().appendLogs(makeLogs(3, 0))
    useJobStore.getState().appendLogs(makeLogs(3, 3))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(useJobStore.getState().logs).toHaveLength(6)
    unsub()
  })
})

describe('cap de métricas (900)', () => {
  it('recorta a METRICS_CAP conservando las últimas', () => {
    const s = useJobStore.getState()
    for (let i = 0; i < METRICS_CAP + 50; i++) s.appendMetric(makeMetric(i))
    const st = useJobStore.getState()
    expect(st.metrics).toHaveLength(METRICS_CAP)
    expect(st.metrics[st.metrics.length - 1].cpu_percent).toBe(100 + (METRICS_CAP + 49))
  })
})

describe('setPhase con detail terminal', () => {
  it('running fija startedAt una sola vez', () => {
    const s = useJobStore.getState()
    s.setPhase('running')
    const first = useJobStore.getState().startedAt
    expect(first).not.toBeNull()
    s.setPhase('running')
    expect(useJobStore.getState().startedAt).toBe(first)
  })

  it('fase terminal con detail puebla exitCode/errorDetail/wallTime', () => {
    useJobStore.getState().setPhase('completed', COMPLETED_DETAIL)
    const st = useJobStore.getState()
    expect(st.exitCode).toBe(0)
    expect(st.errorDetail).toBeNull()
    expect(st.wallTimeMs).toBe(8727)
  })

  it('detail.output_truncated propaga logsTruncated', () => {
    useJobStore.getState().setPhase('failed', {
      exit_code: 1,
      oom_killed: false,
      wall_time_ms: 1200,
      output_truncated: true,
      error_detail: 'output_limit_exceeded',
    })
    const st = useJobStore.getState()
    expect(st.logsTruncated).toBe(true)
    expect(st.errorDetail).toBe('output_limit_exceeded')
    expect(st.exitCode).toBe(1)
  })

  it('setPhase sin detail no toca exitCode', () => {
    const s = useJobStore.getState()
    s.setPhase('completed', COMPLETED_DETAIL)
    s.setPhase('compiling')
    expect(useJobStore.getState().exitCode).toBe(0)
  })
})

describe('acciones auxiliares', () => {
  it('markLogsTruncated / setWsError / markEof', () => {
    const s = useJobStore.getState()
    s.markLogsTruncated()
    expect(useJobStore.getState().logsTruncated).toBe(true)
    s.setWsError('boom')
    expect(useJobStore.getState().wsError).toBe('boom')
    s.markEof(true)
    expect(useJobStore.getState().sawEof).toBe(true)
    expect(useJobStore.getState().logsTruncated).toBe(true)
  })
})

describe('isTerminalPhase', () => {
  it('reconoce las 4 fases terminales del contrato', () => {
    for (const p of ['completed', 'failed', 'timeout', 'cancelled'] as const) {
      expect(isTerminalPhase(p)).toBe(true)
    }
    for (const p of ['idle', 'connecting', 'lost', 'queued', 'creating', 'compiling', 'running'] as const) {
      expect(isTerminalPhase(p)).toBe(false)
    }
  })
})
