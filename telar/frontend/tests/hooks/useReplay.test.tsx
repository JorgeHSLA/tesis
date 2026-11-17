// useReplay — el reloj del reproductor: parte AL FINAL (muestra lo real completo),
// «Reproducir» desde el final empieza de cero, la velocidad escala el avance y
// nada se pasa de [0, duración].
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReplay } from '@/hooks/useReplay'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})
afterEach(() => vi.useRealTimers())

const run = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('useReplay', () => {
  it('arranca parado y al FINAL, mostrando el resultado real completo', () => {
    const { result } = renderHook(() => useReplay(4000))
    expect(result.current.time).toBe(4000)
    expect(result.current.atEnd).toBe(true)
    expect(result.current.playing).toBe(false)
  })

  it('«reproducir» desde el final vuelve a empezar y avanza con el reloj', () => {
    const { result } = renderHook(() => useReplay(4000))
    act(() => result.current.play())
    expect(result.current.playing).toBe(true)
    expect(result.current.time).toBe(0)
    run(1000)
    expect(result.current.time).toBeGreaterThan(800)
    expect(result.current.time).toBeLessThan(1200)
  })

  it('al llegar al final se detiene solo', () => {
    const { result } = renderHook(() => useReplay(1000))
    act(() => result.current.play())
    run(3000)
    expect(result.current.time).toBe(1000)
    expect(result.current.playing).toBe(false)
  })

  it('la velocidad escala el avance (2× recorre el doble)', () => {
    const { result } = renderHook(() => useReplay(20_000))
    act(() => result.current.setSpeed(2))
    act(() => result.current.play())
    run(1000)
    expect(result.current.time).toBeGreaterThan(1700)
    expect(result.current.time).toBeLessThan(2300)
  })

  it('más lento (0.25×) recorre la cuarta parte', () => {
    const { result } = renderHook(() => useReplay(20_000))
    act(() => result.current.setSpeed(0.25))
    act(() => result.current.play())
    run(2000)
    expect(result.current.time).toBeGreaterThan(400)
    expect(result.current.time).toBeLessThan(600)
  })

  it('pausar congela el instante', () => {
    const { result } = renderHook(() => useReplay(20_000))
    act(() => result.current.play())
    run(500)
    act(() => result.current.pause())
    const frozen = result.current.time
    run(2000)
    expect(result.current.time).toBe(frozen)
  })

  it('seek, step y restart se acotan a [0, duración]', () => {
    const { result } = renderHook(() => useReplay(4000))
    act(() => result.current.seek(1500))
    expect(result.current.time).toBe(1500)
    act(() => result.current.step(-1000))
    expect(result.current.time).toBe(500)
    act(() => result.current.step(-5000))
    expect(result.current.time).toBe(0)
    act(() => result.current.step(99_999))
    expect(result.current.time).toBe(4000)
    act(() => result.current.seek(-10))
    expect(result.current.time).toBe(0)
    act(() => result.current.seek(10_000))
    expect(result.current.time).toBe(4000)
    act(() => result.current.restart())
    expect(result.current.time).toBe(0)
  })

  it('mientras la ejecución crece sigue el final; al elegir un momento deja de seguirlo', () => {
    const { result, rerender } = renderHook(({ d }) => useReplay(d), { initialProps: { d: 0 } })
    rerender({ d: 1500 })
    expect(result.current.time).toBe(1500)
    act(() => result.current.seek(300))
    rerender({ d: 2500 })
    expect(result.current.time).toBe(300) // ya es decisión de la persona
  })

  it('toggle alterna reproducir/pausar', () => {
    const { result } = renderHook(() => useReplay(5000))
    act(() => result.current.toggle())
    expect(result.current.playing).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.playing).toBe(false)
  })
})
