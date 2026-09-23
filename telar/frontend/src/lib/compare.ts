// lib/compare — comparación de ejecuciones (CU-30). Solo lee JobDetailDto
// (GET /jobs/{id} ×N): no hay endpoint propio.
import type { JobDetailDto } from '../api/types'
import { bestSweepPoint } from './speedup'

export type Comparability = { ok: true } | { ok: false; reason: string }

/** `?ids=a,b,c` → ids únicos, sin vacíos, en orden. */
export function parseCompareIds(raw: string | null): string[] {
  if (raw == null) return []
  const ids = raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
  return [...new Set(ids)]
}

/** Comparables = mismo example_id o, sin ejemplo, el mismo código. */
export function checkComparable(jobs: readonly JobDetailDto[]): Comparability {
  if (jobs.length < 2) return { ok: true }
  const examples = new Set(jobs.map((j) => j.example_id))
  if (examples.size > 1) {
    return examples.has(null)
      ? { ok: false, reason: 'Mezclas ejecuciones de un ejemplo con ejecuciones de código propio.' }
      : { ok: false, reason: 'Son ejecuciones de ejemplos distintos: sus tiempos no miden lo mismo.' }
  }
  if (jobs[0].example_id != null) return { ok: true }
  const codes = new Set(jobs.map((j) => j.source_code))
  return codes.size === 1
    ? { ok: true }
    : { ok: false, reason: 'Son ejecuciones de código propio con código distinto.' }
}

/** Speedup del job si su parser lo mide (sweep: mejor punto; pair: vs referencia). */
export function jobSpeedup(job: JobDetailDto): number | null {
  const t = job.parsed_timings
  if (t == null) return null
  if (t.kind === 'pair') return t.speedup_vs_reference
  return bestSweepPoint(t)?.speedup ?? null
}
