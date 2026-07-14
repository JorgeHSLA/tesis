// Suite 6b (frontend-spec §10): lib/observations.test.ts — motor de reglas.
import { describe, expect, it } from 'vitest'
import { buildObservations } from '@/lib/observations'
import {
  jobDetail,
  JOB_FAILED,
  JOB_PAIR,
  JOB_SWEEP,
  TIMINGS_PAIR_NUMPY_SLOW,
  TIMINGS_SWEEP_SPMD_FLAT,
} from '../fixtures/rest'

describe('sweep near-linear (transporte)', () => {
  it('genera obs ok «escala casi lineal» + info de Amdahl', () => {
    const obs = buildObservations(JOB_SWEEP)
    expect(obs.some((o) => o.kind === 'ok' && /casi lineal/i.test(o.title))).toBe(true)
    expect(obs.some((o) => o.kind === 'info' && /Amdahl/.test(o.body))).toBe(true)
  })

  it('orden estable warn → ok → info', () => {
    const kinds = buildObservations(JOB_SWEEP).map((o) => o.kind)
    const rank = { warn: 0, ok: 1, info: 2 } as const
    const ranks = kinds.map((k) => rank[k])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})

describe('sweep plano de piSpmd (false sharing)', () => {
  const job = jobDetail({
    example_id: 'spmd',
    parsed_timings: TIMINGS_SWEEP_SPMD_FLAT,
    stdout: 'x',
  })

  it('dispara warn de bajo speedup con la plantilla de false sharing', () => {
    const obs = buildObservations(job)
    const warn = obs.find((o) => o.kind === 'warn' && /casi no hay speedup/i.test(o.title))
    expect(warn).toBeDefined()
    expect(warn?.body).toMatch(/false sharing/i)
  })

  it('correct=false añade warn «NO coincide con la referencia»', () => {
    const obs = buildObservations(job)
    expect(obs.some((o) => o.kind === 'warn' && /no coincide/i.test(o.title))).toBe(true)
  })
})

describe('job fallido con stderr', () => {
  it('warn con las últimas líneas de stderr', () => {
    const obs = buildObservations(JOB_FAILED)
    const warn = obs.find((o) => o.kind === 'warn')
    expect(warn?.body).toMatch(/ZeroDivisionError/)
  })

  it('OOM cambia el título del warn', () => {
    const obs = buildObservations(jobDetail({ status: 'failed', oom_killed: true, stderr: '', parsed_timings: null }))
    expect(obs.some((o) => /OOM/i.test(o.title))).toBe(true)
  })
})

describe('pair', () => {
  it('speedup<1 → warn «más lento» + info', () => {
    const job = jobDetail({ parsed_timings: TIMINGS_PAIR_NUMPY_SLOW, threads: 8 })
    const obs = buildObservations(job)
    expect(obs.some((o) => o.kind === 'warn' && /más lento/i.test(o.title))).toBe(true)
    expect(obs.some((o) => o.kind === 'info')).toBe(true)
  })

  it('correct=true → obs ok «Resultado validado»', () => {
    const obs = buildObservations(JOB_PAIR)
    expect(obs.some((o) => o.kind === 'ok' && /validado/i.test(o.title))).toBe(true)
  })
})

describe('timeout y degradación', () => {
  it('timeout → warn con el límite', () => {
    const obs = buildObservations(jobDetail({ status: 'timeout', parsed_timings: null, timeout_s: 60 }))
    expect(obs.some((o) => o.kind === 'warn' && /límite de 60s/.test(o.title))).toBe(true)
  })

  it('sin timings ni error → info «no auto-mide»', () => {
    const obs = buildObservations(jobDetail({ status: 'completed', parsed_timings: null, stderr: '' }))
    expect(obs).toHaveLength(1)
    expect(obs[0]).toMatchObject({ kind: 'info' })
    expect(obs[0].title).toMatch(/no auto-mide/i)
  })
})
