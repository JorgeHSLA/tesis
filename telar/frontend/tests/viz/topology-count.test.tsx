// Regla OpenMP (CU-07.5): con N hilos hay EXACTAMENTE N figuras. t0 es el hilo
// maestro y también trabaja; t1..t{N-1} son el resto del equipo. No existe un
// hilo extra. Idle (ThreadTopology) y live (LiveTopology) deben coincidir.
import { render, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveTopology } from '../../src/components/viz/LiveTopology'
import { ThreadTopology } from '../../src/components/viz/ThreadTopology'
import { useSimulation } from '../../src/hooks/useSimulation'

const COUNTS = [1, 2, 4, 8] as const

function figureIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-thread]')).map((el) => el.getAttribute('data-thread') ?? '')
}

function renderLive(n: number, running = false) {
  const { result } = renderHook(() => useSimulation({ threads: n, running, reducedMotion: true }))
  return render(<LiveTopology nodes={result.current.nodes} running={running} reducedMotion />)
}

const expectedIds = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

describe.each(COUNTS)('topología con N = %i hilos', (n) => {
  it('idle dibuja N figuras t0..t{N-1}', () => {
    const { container } = render(<ThreadTopology threads={n} />)
    expect(figureIds(container)).toEqual(expectedIds(n))
  })

  it('live dibuja N figuras t0..t{N-1}', () => {
    const { container } = renderLive(n)
    expect(figureIds(container)).toEqual(expectedIds(n))
  })

  it('idle y live coinciden en figuras y en aria-label', () => {
    const idle = render(<ThreadTopology threads={n} />)
    const live = renderLive(n)
    expect(figureIds(idle.container)).toEqual(figureIds(live.container))
    const idleLabel = idle.container.querySelector('svg')?.getAttribute('aria-label')
    const liveLabel = live.container.querySelector('svg')?.getAttribute('aria-label')
    expect(idleLabel).toBe(liveLabel)
    expect(idleLabel).toContain(`${n} hilo`)
  })

  it('el maestro es uno de los N: exactamente un «t0 · maestro» y ningún nodo «master» aparte', () => {
    for (const { container } of [render(<ThreadTopology threads={n} />), renderLive(n)]) {
      expect(container.querySelectorAll('[data-master="true"]')).toHaveLength(1)
      expect(container.querySelector('[data-thread="t0"]')?.getAttribute('data-master')).toBe('true')
      expect(container.textContent).toContain('t0 · maestro')
      expect(container.textContent).not.toMatch(/\bmaster\b/)
    }
  })
})
