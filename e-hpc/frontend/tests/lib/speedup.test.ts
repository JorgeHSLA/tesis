// Suite 6a (frontend-spec §10): lib/speedup.test.ts — ley de Amdahl.
import { describe, expect, it } from 'vitest'
import {
  amdahlParallelFraction,
  amdahlPredictedSpeedup,
  bestSweepPoint,
  maxThreadsPoint,
} from '@/lib/speedup'
import { TIMINGS_SWEEP_TRANSPORTE } from '../fixtures/rest'
import type { ParsedTimingsSweepDto } from '@/api/types'

const EMPTY_SWEEP: ParsedTimingsSweepDto = {
  parser_id: 'sweep_pi',
  kind: 'sweep',
  series: [],
  extra: {},
  correct: null,
}

describe('amdahlParallelFraction', () => {
  it('null para n<=1 o speedup<=0 o no finitos', () => {
    expect(amdahlParallelFraction(2, 1)).toBeNull()
    expect(amdahlParallelFraction(0, 8)).toBeNull()
    expect(amdahlParallelFraction(Number.NaN, 8)).toBeNull()
    expect(amdahlParallelFraction(4, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('speedup casi ideal → fracción paralela cercana a 1', () => {
    const p = amdahlParallelFraction(7.98, 8)
    expect(p).not.toBeNull()
    expect(p as number).toBeGreaterThan(0.99)
    expect(p as number).toBeLessThanOrEqual(1)
  })

  it('clampa a [0,1] cuando el speedup es inferior al serial', () => {
    // s < 1 con n>1 produce p negativo → clamp a 0.
    expect(amdahlParallelFraction(0.5, 8)).toBe(0)
  })
})

describe('amdahlPredictedSpeedup', () => {
  it('p=1 predice speedup = n', () => {
    expect(amdahlPredictedSpeedup(1, 8)).toBeCloseTo(8, 5)
  })

  it('p=0 predice speedup 1 (serial)', () => {
    expect(amdahlPredictedSpeedup(0, 8)).toBeCloseTo(1, 5)
  })

  it('clampa p fuera de rango y evita división por 0 en threads', () => {
    expect(amdahlPredictedSpeedup(2, 0)).toBeCloseTo(1, 5) // p→1, n→max(1,0)=1
  })
})

describe('bestSweepPoint / maxThreadsPoint', () => {
  it('best = mayor speedup del barrido', () => {
    expect(bestSweepPoint(TIMINGS_SWEEP_TRANSPORTE)?.speedup).toBe(7.98)
  })

  it('maxThreads = punto de más hilos', () => {
    expect(maxThreadsPoint(TIMINGS_SWEEP_TRANSPORTE)?.threads).toBe(8)
  })

  it('serie vacía → null', () => {
    expect(bestSweepPoint(EMPTY_SWEEP)).toBeNull()
    expect(maxThreadsPoint(EMPTY_SWEEP)).toBeNull()
  })
})
