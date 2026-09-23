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

  it('reintenta solo, sin retry() manual, si /system falla al montar (backend arrancando)', async () => {
    vi.useFakeTimers()
    // 4 fallos (~20s de reintentos) antes de responder: el caso real que
    // rompió el primer intento de este arreglo, con el backend tardando 24s.
    getSystemMock
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue(SYSTEM_INFO)
    const { result } = renderHook(() => useSystemInfo())
    await vi.waitFor(() => expect(result.current.error).not.toBeNull())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000 * 4)
    })

    expect(result.current.data?.cores).toBe(8)
    expect(result.current.error).toBeNull()
  })

  it('deja de reintentar solo tras el tope, y no sondea para siempre', async () => {
    vi.useFakeTimers()
    getSystemMock.mockRejectedValue(new Error('backend caído de verdad'))
    renderHook(() => useSystemInfo())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000 * 61) // más que MAX_AUTO_RETRIES * delay
    })

    // 1 intento inicial + 60 reintentos = 61 llamadas, ni una más.
    expect(getSystemMock).toHaveBeenCalledTimes(61)
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

  // §2.3 #23 del informe: un /health 200 con Docker caído ponía el pie verde.
  it('down con /health 200 pero Docker caído, y lo explica', async () => {
    getHealthMock.mockResolvedValue({ status: 'ok', checks: { db: true, docker: false, runner_image: null } })
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('down'))
    expect(result.current.statusError).toMatch(/Docker no responde/)
  })

  it('down si falta la imagen del runner', async () => {
    getHealthMock.mockResolvedValue({ status: 'ok', checks: { db: true, docker: true, runner_image: false } })
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('down'))
    expect(result.current.statusError).toMatch(/imagen del runner/)
  })

  it('down si la imagen no se pudo comprobar (null)', async () => {
    getHealthMock.mockResolvedValue({ status: 'ok', checks: { db: true, docker: true, runner_image: null } })
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('down'))
    expect(result.current.statusError).toMatch(/no se pudo comprobar/i)
  })

  it('ok sin statusError cuando todo está bien', async () => {
    getHealthMock.mockResolvedValue({ status: 'ok', checks: { db: true, docker: true, runner_image: true } })
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    expect(result.current.statusError).toBeNull()
  })
})

const BACKEND_OK = { service: 'backend', state: 'running', health: 'healthy' }

describe('useDockerStatus (desktop)', () => {
  it('cuenta contenedores running y ok; up() invoca dockerUp()', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({
      ok: true,
      services: [BACKEND_OK, { service: 'web', state: 'running' }, { service: 'runner', state: 'exited' }],
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
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [BACKEND_OK] })
    const dockerUp = vi.fn().mockRejectedValue(new Error('spawn ENOENT'))
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    await act(async () => {
      await result.current.up()
    })
    expect(result.current.liftError).toBe('spawn ENOENT')
  })

  it('stop() invoca dockerStop() y re-comprueba el estado', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [BACKEND_OK] })
    const dockerStop = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp: vi.fn(), dockerStop }

    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    const callsBefore = dockerStatus.mock.calls.length

    await act(async () => {
      await result.current.stop()
    })
    expect(dockerStop).toHaveBeenCalled()
    expect(dockerStatus.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(result.current.liftError).toBeNull()
  })

  it('stop() con dockerStop {ok:false} expone liftError', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [BACKEND_OK] })
    const dockerStop = vi.fn().mockResolvedValue({ ok: false, error: 'no se pudo detener' })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp: vi.fn(), dockerStop }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    await act(async () => {
      await result.current.stop()
    })
    expect(result.current.liftError).toBe('no se pudo detener')
  })

  // ── Autoarranque (2026-08-28) ──────────────────────────────────────────
  it('AUTOARRANQUE: con los servicios caídos levanta solo al montar', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [] })
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop: vi.fn() }

    renderHook(() => useDockerStatus())
    await waitFor(() => expect(dockerUp).toHaveBeenCalledTimes(1))
  })

  it('AUTOARRANQUE: NO se dispara si los servicios ya están arriba', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [BACKEND_OK] })
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop: vi.fn() }

    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    expect(dockerUp).not.toHaveBeenCalled()
  })

  it('AUTOARRANQUE: NO se dispara si Docker no está disponible (ok:false)', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: false, services: [] })
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop: vi.fn() }

    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('down'))
    expect(dockerUp).not.toHaveBeenCalled() // levantar sin daemon sólo daría error
  })

  // El guard que hace ÚTIL al botón Detener: sin él, el sondeo de 10 s
  // relanzaría lo que el usuario acaba de parar.
  it('AUTOARRANQUE: es de una sola vez — tras stop() no relanza en el siguiente sondeo', async () => {
    let running = [BACKEND_OK] as { state: string }[]
    const dockerStatus = vi.fn().mockImplementation(async () => ({ ok: true, services: running }))
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    const dockerStop = vi.fn().mockImplementation(async () => {
      running = [] // los servicios quedan caídos, como tras un `compose stop`
      return { ok: true }
    })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop }

    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))

    await act(async () => {
      await result.current.stop()
    })
    await waitFor(() => expect(result.current.state).toBe('down'))

    // Varias rondas del sondeo: el estado sigue 'down' y nadie llamó a up().
    await act(async () => {
      await result.current.refresh()
      await result.current.refresh()
    })
    expect(dockerUp).not.toHaveBeenCalled()
    expect(result.current.state).toBe('down')
  })

  // ── CU-27.1: «listo» = backend healthy, no «algún contenedor corriendo» ──
  it('LISTO: un servicio cualquiera corriendo sin backend NO es ok', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [{ service: 'web', state: 'running' }] })
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop: vi.fn() }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(dockerUp).toHaveBeenCalledTimes(1)) // prepara lo que falta
    expect(result.current.state).toBe('down')
  })

  it('LISTO: backend corriendo pero aún «starting» se muestra como verificando, sin autoarranque', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({
      ok: true,
      services: [{ service: 'backend', state: 'running', health: 'starting' }],
    })
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop: vi.fn() }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(dockerStatus).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current.state).toBe('checking')
    expect(dockerUp).not.toHaveBeenCalled()
  })

  it('LISTO: backend «unhealthy» es down', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({
      ok: true,
      services: [{ service: 'backend', state: 'running', health: 'unhealthy' }],
    })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp: vi.fn().mockResolvedValue({ ok: true }), dockerStop: vi.fn() }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('down'))
  })

  // ── CU-27.4: la causa real llega a la UI ──
  it('dockerStatus {ok:false, error} expone statusError', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({
      ok: false,
      services: [],
      error: 'Docker no está instalado o no está en el PATH',
    })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp: vi.fn(), dockerStop: vi.fn() }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.statusError).toBe('Docker no está instalado o no está en el PATH'))
    expect(result.current.state).toBe('down')
  })

  // ── CU-27.2: autoarranque pendiente hasta que aparezca Docker ──
  it('AUTOARRANQUE PENDIENTE: si Docker no estaba, se reanuda cuando aparece', async () => {
    let daemon = false
    const dockerStatus = vi.fn().mockImplementation(async () =>
      daemon ? { ok: true, services: [] } : { ok: false, services: [], error: 'daemon parado' },
    )
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop: vi.fn() }

    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.statusError).toBe('daemon parado'))
    expect(dockerUp).not.toHaveBeenCalled()

    daemon = true // el usuario abre Docker Desktop
    await act(async () => {
      await result.current.refresh()
    })
    await waitFor(() => expect(dockerUp).toHaveBeenCalledTimes(1))
    expect(result.current.statusError).toBeNull()

    // Y no se repite en las siguientes comprobaciones.
    await act(async () => {
      await result.current.refresh()
    })
    expect(dockerUp).toHaveBeenCalledTimes(1)
  })

  it('AUTOARRANQUE PENDIENTE: el sondeo periódico también lo reanuda', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let daemon = false
    const dockerStatus = vi.fn().mockImplementation(async () =>
      daemon ? { ok: true, services: [] } : { ok: false, services: [] },
    )
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop: vi.fn() }

    renderHook(() => useDockerStatus())
    await waitFor(() => expect(dockerStatus).toHaveBeenCalledTimes(1))
    daemon = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await waitFor(() => expect(dockerUp).toHaveBeenCalledTimes(1))
  })

  it('AUTOARRANQUE PENDIENTE: «Detener» del usuario lo cancela', async () => {
    let status: { ok: boolean; services: unknown[] } = { ok: true, services: [BACKEND_OK] }
    const dockerStatus = vi.fn().mockImplementation(async () => status)
    const dockerUp = vi.fn().mockResolvedValue({ ok: true })
    const dockerStop = vi.fn().mockImplementation(async () => {
      status = { ok: false, services: [] } // p.ej. además se cerró Docker
      return { ok: true }
    })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp, dockerStop }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    await act(async () => {
      await result.current.stop()
    })
    status = { ok: true, services: [] } // Docker vuelve, servicios parados
    await act(async () => {
      await result.current.refresh()
    })
    expect(dockerUp).not.toHaveBeenCalled()
  })

  it('refresh() vuelve a comprobar el estado', async () => {
    const dockerStatus = vi.fn().mockResolvedValue({ ok: true, services: [BACKEND_OK] })
    ;(window as { telar?: unknown }).telar = { dockerStatus, dockerUp: vi.fn() }
    const { result } = renderHook(() => useDockerStatus())
    await waitFor(() => expect(result.current.state).toBe('ok'))
    await act(async () => {
      await result.current.refresh()
    })
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
