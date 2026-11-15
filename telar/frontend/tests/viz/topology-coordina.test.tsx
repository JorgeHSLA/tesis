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
