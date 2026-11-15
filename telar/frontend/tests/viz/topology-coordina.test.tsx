// Cuando el código separa a t0 del resto (if tid == 0 / else, ver lib/masterRole)
// la topología lo dice: «t0 · maestro · coordina». Sigue habiendo N figuras.
import { render, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveTopology } from '../../src/components/viz/LiveTopology'
import { ThreadTopology } from '../../src/components/viz/ThreadTopology'
import { useSimulation } from '../../src/hooks/useSimulation'

function renderLive(n: number, coordinates?: boolean) {
  const { result } = renderHook(() => useSimulation({ threads: n, running: false, reducedMotion: true }))
  return render(<LiveTopology nodes={result.current.nodes} running={false} reducedMotion masterCoordinates={coordinates} />)
}
const figures = (c: HTMLElement) => c.querySelectorAll('[data-thread]').length
const labelOf = (c: HTMLElement) => c.querySelector('svg')?.getAttribute('aria-label') ?? ''

describe.each([2, 4, 8] as const)('masterCoordinates con N = %i hilos', (n) => {
  it('idle: sigue habiendo N figuras y t0 se rotula «coordina»', () => {
    const { container } = render(<ThreadTopology threads={n} masterCoordinates />)
    expect(figures(container)).toBe(n)
    expect(container.textContent).toContain('t0 · maestro · coordina')
    expect(container.textContent?.match(/coordina/g)).toHaveLength(1)
    expect(labelOf(container)).toContain('coordina')
  })

  it('live: igual que idle (mismas figuras y mismo aria-label)', () => {
    const idle = render(<ThreadTopology threads={n} masterCoordinates />)
    const live = renderLive(n, true)
    expect(figures(live.container)).toBe(n)
    expect(live.container.textContent).toContain('t0 · maestro · coordina')
    expect(labelOf(live.container)).toBe(labelOf(idle.container))
  })
})

describe('sin separación (por defecto)', () => {
  it('idle y live no dicen «coordina»', () => {
    expect(render(<ThreadTopology threads={4} />).container.textContent).not.toContain('coordina')
    expect(renderLive(4).container.textContent).not.toContain('coordina')
    expect(renderLive(4, false).container.textContent).not.toContain('coordina')
  })
})

describe('1 hilo', () => {
  it('con un solo hilo no hay a quién coordinar: no dice «coordina»', () => {
    const { container } = render(<ThreadTopology threads={1} masterCoordinates />)
    expect(container.textContent).not.toContain('coordina')
    expect(labelOf(container)).not.toContain('coordina')
  })
})

// ── Posición: si t0 coordina va ARRIBA del equipo; si trabaja, dentro de la fila ──
const yOf = (c: HTMLElement, id: string): number => {
  const t = c.querySelector(`[data-thread="${id}"] > g[transform]`)?.getAttribute('transform') ?? ''
  const m = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(t)
  if (m == null) throw new Error(`sin translate para ${id}: «${t}»`)
  return Number(m[2])
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

describe.each([2, 3, 4, 8] as const)('posición de t0 con N = %i hilos', (n) => {
  it('idle: coordina → t0 arriba y t1..t{N-1} en una misma fila debajo', () => {
    const { container } = render(<ThreadTopology threads={n} masterCoordinates />)
    expect(figures(container)).toBe(n)
    const teamYs = ids(n).slice(1).map((id) => yOf(container, id))
    expect(new Set(teamYs).size).toBe(1)
    expect(yOf(container, 't0')).toBeLessThan(teamYs[0])
  })

  it('idle: trabaja (sin separación) → las N figuras en la MISMA fila', () => {
    const { container } = render(<ThreadTopology threads={n} />)
    expect(new Set(ids(n).map((id) => yOf(container, id))).size).toBe(1)
  })

  it('live: coordina → t0 arriba; no coordina → una sola fila', () => {
    const up = renderLive(n, true).container
    const teamYs = ids(n).slice(1).map((id) => yOf(up, id))
    expect(new Set(teamYs).size).toBe(1)
    expect(yOf(up, 't0')).toBeLessThan(teamYs[0])
    const flat = renderLive(n, false).container
    expect(new Set(ids(n).map((id) => yOf(flat, id))).size).toBe(1)
  })

  it('t0 queda centrado sobre su equipo', () => {
    const { container } = render(<ThreadTopology threads={n} masterCoordinates />)
    const x = (id: string) => Number(/translate\(([-\d.]+)/.exec(container.querySelector(`[data-thread="${id}"] > g[transform]`)?.getAttribute('transform') ?? '')?.[1])
    const team = ids(n).slice(1).map(x)
    expect(x('t0')).toBeCloseTo((Math.min(...team) + Math.max(...team)) / 2, 5)
  })
})

describe('1 hilo', () => {
  it('no hay equipo: una sola figura, sin subir a t0', () => {
    const { container } = render(<ThreadTopology threads={1} masterCoordinates />)
    expect(figures(container)).toBe(1)
  })
})
