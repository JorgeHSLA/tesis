// lib/simConfig — configuración recuperable del simulador: la que trae
// «Re-ejecutar» desde un job (CU-04.1, 32.2) y la de «Mis configuraciones»
// (CU-32.1). SimulatorIdle la aplica igual venga de donde venga.
import type { JobDetailDto } from '../api/types'

export interface SimConfig {
  /** null = código propio (sin ejemplo). */
  example_id: string | null
  code: string
  filename: string
  threads: number
  timeout_s: number
  /** Ejemplo editado: su código difiere del fixture a propósito (si no, una
   *  diferencia significa que el ejemplo cambió después). */
  edited: boolean
}

/** navigate-state de Re-ejecutar (ResultsScreen → /simulador). */
export interface RerunState extends SimConfig {
  lesson_id: string | null
}

export function configFromJob(job: JobDetailDto): RerunState {
  return {
    example_id: job.example_id,
    lesson_id: job.lesson_id,
    code: job.source_code,
    filename: job.filename,
    threads: job.threads,
    timeout_s: job.timeout_s,
    edited: job.source_kind === 'editor' && job.example_id != null,
  }
}

/** CU-32.3: el slider nunca muestra más que `max`. `clampedFrom` = valor
 *  recuperado que se ajustó (para avisar ANTES de ejecutar), o null. */
export function clampThreads(value: number, max: number): { threads: number; clampedFrom: number | null } {
  if (!Number.isFinite(value) || value < 1) return { threads: 1, clampedFrom: null }
  const n = Math.floor(value)
  return n > max ? { threads: max, clampedFrom: n } : { threads: n, clampedFrom: null }
}
