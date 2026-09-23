// Suite 3 (frontend-spec §10): hooks/useJobSocket.test.tsx
// Ciclo de vida: monta/desmonta cierra socket; cambio de jobId reconecta;
// StrictMode no deja conexiones duplicadas vivas; elapsedSec avanza con timers.
import { StrictMode, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useJobSocket } from '@/hooks/useJobSocket'
import { useJobStore } from '@/stores/jobStore'
import { FakeWebSocket } from '../setup'
import { statusMsg } from '../fixtures/ws'

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

function strictWrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <MemoryRouter>{children}</MemoryRouter>
    </StrictMode>
  )
}

beforeEach(() => {
  FakeWebSocket.reset()
  useJobStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('montaje / desmontaje', () => {
  it('crea el socket al montar y lo cierra al desmontar', () => {
    const { unmount } = renderHook(() => useJobSocket('j1'), { wrapper })
    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.last!
    unmount()
    expect(ws.clientClose).not.toBeNull()
  })

  it('jobId undefined no abre socket', () => {
    renderHook(() => useJobSocket(undefined), { wrapper })
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('cambiar de jobId cierra el viejo y reconecta al nuevo', () => {
    const { rerender } = renderHook(({ id }: { id: string }) => useJobSocket(id), {
      wrapper,
      initialProps: { id: 'j1' },
    })
    const ws1 = FakeWebSocket.last!
    rerender({ id: 'j2' })
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(ws1.clientClose).not.toBeNull()
    expect(FakeWebSocket.last!.url).toContain('j2')
  })
})

describe('StrictMode', () => {
  it('deja exactamente UNA conexión viva (el doble-mount cierra la primera)', () => {
    renderHook(() => useJobSocket('j1'), { wrapper: strictWrapper })
    const live = FakeWebSocket.instances.filter((w) => w.clientClose === null)
    expect(live).toHaveLength(1)
  })
})

describe('elapsedSec', () => {
  it('avanza con timers falsos mientras el job corre', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    const ws = FakeWebSocket.last!
    act(() => {
      ws.open()
      ws.emit(statusMsg('running'))
    })
    expect(result.current.phase).toBe('running')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.elapsedSec).toBeGreaterThanOrEqual(3)
  })

  it('corre también durante compiling (sin salida aún) — CU-07.1', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    const ws = FakeWebSocket.last!
    act(() => {
      ws.open()
      ws.emit(statusMsg('compiling'))
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.elapsedSec).toBeGreaterThanOrEqual(2)
  })

  it('al volver a un job activo muestra el tiempo real desde started_at — CU-07.4', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    const ws = FakeWebSocket.last!
    act(() => {
      ws.open()
      ws.emit(statusMsg('running'))
      useJobStore.getState().setStartedAt(new Date(Date.now() - 90_000).toISOString())
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.elapsedSec).toBeGreaterThanOrEqual(90)
    expect(result.current.elapsedSec).toBeLessThan(93)
  })

  it('congela elapsedSec con wall_time_ms al terminar', () => {
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    const ws = FakeWebSocket.last!
    act(() => {
      ws.open()
      ws.emit(statusMsg('running'))
      ws.emit(
        statusMsg('completed', {
          exit_code: 0,
          oom_killed: false,
          wall_time_ms: 8727,
          output_truncated: false,
          error_detail: null,
        }),
      )
    })
    expect(result.current.phase).toBe('completed')
    expect(result.current.elapsedSec).toBeCloseTo(8.727, 3)
  })
})

describe('cancel / retry expuestos', () => {
  it('cancel() envía el frame por el socket vivo', () => {
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    const ws = FakeWebSocket.last!
    act(() => {
      ws.open()
    })
    act(() => {
      result.current.cancel()
    })
    expect(ws.sent).toEqual(['{"type":"cancel"}'])
  })
})
