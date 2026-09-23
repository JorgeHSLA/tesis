// lib/simConfig — configuración recuperable del simulador (CU-04.1, 32.2, 32.3).
import { describe, expect, it } from 'vitest'
import { clampThreads, configFromJob } from '@/lib/simConfig'
import { JOB_BARE, JOB_SWEEP, jobDetail } from '../fixtures/rest'

describe('configFromJob (Re-ejecutar)', () => {
  it('lleva ejemplo, lección, código, archivo, hilos y timeout de la ejecución', () => {
    expect(configFromJob(JOB_SWEEP)).toEqual({
      example_id: 'transporteParticulas',
      lesson_id: 'transporteParticulas',
      code: JOB_SWEEP.source_code,
      filename: 'transporteMonteCarlo.py',
      threads: 8,
      timeout_s: 60,
      edited: false,
    })
  })

  it('un ejemplo editado conserva example_id (no pierde el parser)', () => {
    const cfg = configFromJob(jobDetail({ source_kind: 'editor', source_code: 'x = 1\n' }))
    expect(cfg.example_id).toBe('transporteParticulas')
    expect(cfg.code).toBe('x = 1\n')
    expect(cfg.edited).toBe(true)
  })

  it('código propio: example_id null', () => {
    expect(configFromJob(JOB_BARE).example_id).toBeNull()
  })
})

describe('clampThreads (CU-32.3)', () => {
  it('no toca un valor dentro del rango', () => {
    expect(clampThreads(4, 8)).toEqual({ threads: 4, clampedFrom: null })
  })

  it('ajusta al máximo y recuerda el valor original', () => {
    expect(clampThreads(16, 4)).toEqual({ threads: 4, clampedFrom: 16 })
  })

  it('valores no válidos caen a 1', () => {
    expect(clampThreads(0, 4).threads).toBe(1)
    expect(clampThreads(Number.NaN, 4).threads).toBe(1)
  })
})
