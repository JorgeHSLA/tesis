// Suite «hooks» (frontend-spec §10) + cobertura de src/hooks:
// useReducedMotion, usePlatform, useSystemInfo, useDockerStatus, useSimulation.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { setReducedMotion } from '../setup'
import { SYSTEM_INFO } from '../fixtures/rest'

vi.mock('@/api/system', () => ({
  getSystem: vi.fn(),
  getHealth: vi.fn(),
}))

import { getHealth, getSystem } from '@/api/system'
import { getPlatform, usePlatform } from '@/hooks/usePlatform'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { loadSystemInfo, useSystemInfo } from '@/hooks/useSystemInfo'
import { useDockerStatus } from '@/hooks/useDockerStatus'
import { useSimulation } from '@/hooks/useSimulation'

const getSystemMock = getSystem as Mock
const getHealthMock = getHealth as Mock

afterEach(() => {
  setReducedMotion(false)
  delete (window as { telar?: unknown }).telar
  vi.useRealTimers()
})

// ───────────────────────────── useReducedMotion ────────────────────────────

describe('useReducedMotion', () => {
  it('false por defecto', () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('true si prefers-reduced-motion está activo al montar', () => {
    setReducedMotion(true)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('reacciona al evento change del media query', () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => setReducedMotion(true))
    expect(result.current).toBe(true)
  })
})

// ───────────────────────────────── usePlatform ─────────────────────────────

describe('usePlatform', () => {
  it('web cuando no hay window.telar', () => {
    expect(getPlatform()).toBe('web')
    const { result } = renderHook(() => usePlatform())
    expect(result.current).toBe('web')
  })

  it('desktop cuando window.telar está inyectado', () => {
    ;(window as { telar?: unknown }).telar = {}
    expect(getPlatform()).toBe('desktop')
  })
})

// ──────────────────────────────── useSystemInfo ────────────────────────────

describe('useSystemInfo', () => {
  beforeEach(async () => {
    // Resetea la promise memoizada a nivel de módulo (cached → null).
    getSystemMock.mockReset()
    getSystemMock.mockRejectedValue(new Error('reset'))
    await loadSystemInfo(true).catch(() => undefined)
    getSystemMock.mockReset()
  })

  it('carga y expone los datos de /system', async () => {
    getSystemMock.mockResolvedValue(SYSTEM_INFO)
    const { result } = renderHook(() => useSystemInfo())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.cores).toBe(8)
    expect(result.current.error).toBeNull()
  })

  it('expone el error si /system falla', async () => {
    getSystemMock.mockRejectedValue(new Error('503 docker'))
    const { result } = renderHook(() => useSystemInfo())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.data).toBeNull()
  })

  it('retry() vuelve a consultar (force)', async () => {
    getSystemMock.mockRejectedValueOnce(new Error('temporal'))
    getSystemMock.mockResolvedValue(SYSTEM_INFO)
    const { result } = renderHook(() => useSystemInfo())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.data?.cores).toBe(8))
  })
})

// ──────────────────────────────── useDockerStatus ──────────────────────────

describe('useDockerStatus (web)', () => {
  it('ok cuando /health responde; containers null en web', async () => {
    getHealthMock.mockResolvedValue({ status: 'ok', checks: { db: true, docker: true, runner_image: true } })
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    expect(result.current.containers).toBeNull()
  })

  it('down cuando /health falla', async () => {
    getHealthMock.mockRejectedValue(new Error('caído'))
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('down'))
  })
})

describe('useDockerStatus (desktop)', () => {
  it('cuenta contenedores running y ok; up() invoca dockerUp()', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({
      ok: true,
      services: [{ state: 'running' }, { state: 'running' }, { state: 'exited' }],
    })
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp }

    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    expect(result.current.containers).toBe(2)

    await act(async () => {
      await result.current.up()
    })
    expect(dockerUp).toHaveBeenCalled()
  })

  it('up() con dockerUp {ok:false} expone liftError', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: false, services: [] })
    const dockerUp = vi.fn().mockResolvedValue({ ok: false, error: 'daemon caído' })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('down'))
    await act(async () => {
      await result.current.up()
    })
    expect(result.current.liftError).toBe('daemon caído')
  })

  it('up() propaga la excepción de dockerUp a liftError', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [{ state: 'running' }] })
    const dockerUp = vi.fn().mockRejectedValue(new Error('spawn ENOENT'))
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    await act(async () => {
      await result.current.up()
    })
    expect(result.current.liftError).toBe('spawn ENOENT')
  })

  it('refresh() vuelve a comprobar el estado', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [{ state: 'running' }] })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp: vi.fn() }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    act(() => result.current.refresh())
    await waitFor(() => expect(dockerStatus.mock.calls.length).toBeGreaterThan(1))
  })
})

// ───────────────────────────────── useSimulation ───────────────────────────

describe('useSimulation', () => {
  it('genera master + N workers', () => {
    const { result } = renderHook(() => useSimulation({ threads: 4, running: false, reducedMotion: false }))
    expect(result.current.nodes).toHaveLength(5) // 1 master + 4 threads
    expect(result.current.nodes[0].kind).toBe('master')
    expect(result.current.nodes.filter((n) => n.kind === 'thread')).toHaveLength(4)
  })

  it('reconstruye los nodos al cambiar threads', () => {
    const { result, rerender } = renderHook((props: { threads: number }) => useSimulation({ threads: props.threads, running: false, reducedMotion: false }), {
      initialProps: { threads: 2 },
    })
    expect(result.current.nodes).toHaveLength(3)
    rerender({ threads: 8 })
    expect(result.current.nodes).toHaveLength(9)
  })

  it('con reducedMotion NO hay tick (nodos congelados)', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSimulation({ threads: 4, running: true, reducedMotion: true }))
    const before = result.current.nodes
    act(() => vi.advanceTimersByTime(2100))
    expect(result.current.nodes).toBe(before) // sin re-render por tick
  })

  it('running=true anima (el estado cambia por jitter)', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSimulation({ threads: 4, running: true, reducedMotion: false }))
    act(() => vi.advanceTimersByTime(2100)) // 3 ticks
    // sigue habiendo master + 4 threads tras el jitter
    expect(result.current.nodes).toHaveLength(5)
  })
})
