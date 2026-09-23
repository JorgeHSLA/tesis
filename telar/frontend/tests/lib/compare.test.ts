// lib/compare — reglas de comparación de ejecuciones (CU-30.2, 30.3).
import { describe, expect, it } from 'vitest'
import { checkComparable, jobSpeedup, parseCompareIds } from '@/lib/compare'
import { JOB_BARE, JOB_NO_TIMINGS, JOB_PAIR, JOB_SWEEP, jobDetail } from '../fixtures/rest'

describe('parseCompareIds', () => {
  it('separa por comas, quita vacíos y duplicados', () => {
    expect(parseCompareIds('a,b,,a, c ')).toEqual(['a', 'b', 'c'])
    expect(parseCompareIds(null)).toEqual([])
  })
})

describe('checkComparable', () => {
  it('mismo example_id → comparables', () => {
    const a = jobDetail({ job_id: 'a', threads: 2 })
    const b = jobDetail({ job_id: 'b', threads: 4, source_kind: 'editor', source_code: 'otro' })
    expect(checkComparable([a, b])).toEqual({ ok: true })
  })

  it('sin ejemplo y mismo código → comparables', () => {
    const a = jobDetail({ ...JOB_BARE, job_id: 'a' })
    const b = jobDetail({ ...JOB_BARE, job_id: 'b', threads: 2 })
    expect(checkComparable([a, b]).ok).toBe(true)
  })

  it('ejemplos distintos → no comparables con motivo', () => {
    const res = checkComparable([JOB_SWEEP, JOB_PAIR])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/ejemplos distintos/i)
  })

  it('código propio distinto → no comparables', () => {
    const a = jobDetail({ ...JOB_BARE, job_id: 'a', source_code: 'x=1' })
    const b = jobDetail({ ...JOB_BARE, job_id: 'b', source_code: 'x=2' })
    const res = checkComparable([a, b])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/código/i)
  })

  it('mezcla de ejemplo y código propio → no comparables', () => {
    const res = checkComparable([JOB_SWEEP, JOB_BARE])
    expect(res.ok).toBe(false)
  })
})

describe('jobSpeedup', () => {
  it('sweep → mejor punto; pair → speedup vs referencia; sin parser → null', () => {
    expect(jobSpeedup(JOB_SWEEP)).toBeCloseTo(7.98, 1)
    expect(jobSpeedup(JOB_PAIR)).toBe(JOB_PAIR.parsed_timings?.kind === 'pair' ? JOB_PAIR.parsed_timings.speedup_vs_reference : -1)
    expect(jobSpeedup(JOB_NO_TIMINGS)).toBeNull()
  })
})
