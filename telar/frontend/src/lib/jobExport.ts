// lib/jobExport — «Exportar JSON» de resultados (CU-31.1, 31.2).
// Formato estable {format, exported_at, job: JobDetailDto}. Todos los campos
// del DTO se emiten SIEMPRE: un dato ausente va como null (jamás 0 ni omitido,
// que JSON.stringify haría con undefined).
import type { JobDetailDto } from '../api/types'

export const JOB_EXPORT_FORMAT = 'telar-job-export/1'

export interface JobExport {
  format: typeof JOB_EXPORT_FORMAT
  exported_at: string
  job: JobDetailDto
}

// Record<keyof JobDetailDto, true>: si el contrato añade un campo, tsc obliga
// a listarlo aquí y la exportación no lo pierde en silencio.
const JOB_FIELDS: Record<keyof JobDetailDto, true> = {
  job_id: true,
  filename: true,
  source_kind: true,
  example_id: true,
  lesson_id: true,
  source_code: true,
  status: true,
  exit_code: true,
  oom_killed: true,
  error_detail: true,
  threads: true,
  timeout_s: true,
  created_at: true,
  started_at: true,
  finished_at: true,
  wall_time_ms: true,
  stdout: true,
  stderr: true,
  output_truncated: true,
  metrics_summary: true,
  parsed_timings: true,
}

export function buildJobExport(job: JobDetailDto, now: Date = new Date()): JobExport {
  const src = job as unknown as Record<string, unknown>
  const normalized = Object.fromEntries(Object.keys(JOB_FIELDS).map((k) => [k, src[k] ?? null]))
  return { format: JOB_EXPORT_FORMAT, exported_at: now.toISOString(), job: normalized as unknown as JobDetailDto }
}

/** `<stem>-<job_id[:8]>.json`, en paralelo al nombre de la salida (§7.6). */
export function jobExportFilename(job: JobDetailDto): string {
  return `${job.filename.replace(/\.py$/, '')}-${job.job_id.slice(0, 8)}.json`
}

export function jobExportBlob(job: JobDetailDto, now: Date = new Date()): Blob {
  return new Blob([JSON.stringify(buildJobExport(job, now), null, 2)], { type: 'application/json' })
}
