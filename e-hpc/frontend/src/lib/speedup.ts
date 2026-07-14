// lib/speedup.ts — ley de Amdahl para las Observaciones (frontend-spec §6.4).
// speedup(n) = t(1)/t(n) y eficiencia los calcula el BACKEND (parsed_timings);
// aquí solo se derivan lecturas didácticas de esos números.
import type { ParsedTimingsSweepDto, SweepPointDto } from '../api/types'

/**
 * Fracción paralelizable estimada invirtiendo Amdahl a partir de un speedup
 * observado: s = 1 / ((1-p) + p/n)  →  p = (1 - 1/s) / (1 - 1/n).
 * null si no es derivable (n=1 o valores no positivos).
 */
export function amdahlParallelFraction(speedup: number, threads: number): number | null {
  if (!Number.isFinite(speedup) || !Number.isFinite(threads)) return null
  if (threads <= 1 || speedup <= 0) return null
  const p = (1 - 1 / speedup) / (1 - 1 / threads)
  if (!Number.isFinite(p)) return null
  return Math.min(1, Math.max(0, p))
}

/** Speedup que predice Amdahl para fracción paralela p con n hilos. */
export function amdahlPredictedSpeedup(p: number, threads: number): number {
  const clamped = Math.min(1, Math.max(0, p))
  return 1 / (1 - clamped + clamped / Math.max(1, threads))
}

/** Punto del barrido con mayor speedup (para la métrica «Speedup observado»). */
export function bestSweepPoint(timings: ParsedTimingsSweepDto): SweepPointDto | null {
  if (timings.series.length === 0) return null
  return timings.series.reduce((best, p) => (p.speedup > best.speedup ? p : best))
}

/** Punto de más hilos del barrido (para la regla de escalado de §6.4). */
export function maxThreadsPoint(timings: ParsedTimingsSweepDto): SweepPointDto | null {
  if (timings.series.length === 0) return null
  return timings.series.reduce((top, p) => (p.threads > top.threads ? p : top))
}
