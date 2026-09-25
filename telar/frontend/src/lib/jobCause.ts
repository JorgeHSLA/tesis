// lib/jobCause.ts — textos de Resultados que dependen del estado del job
// (S7b): rótulo del encabezado, causa del fin (CU-09.2) y la configuración
// con la que corrió (CU-09.1). Puro: sin React ni red.
import type { JobDetailDto, JobStatus, SourceKind } from '../api/types'

const EYEBROW: Partial<Record<JobStatus, string>> = {
  completed: 'Job completado',
  failed: 'Job fallido',
  timeout: 'Job detenido por timeout',
  cancelled: 'Job cancelado',
}

/** «Job completado» SOLO si el status es completed. */
export function resultEyebrow(status: JobStatus): string {
  return EYEBROW[status] ?? 'Job'
}

export const SOURCE_LABEL: Record<SourceKind, string> = {
  example: 'ejemplo del curso',
  editor: 'código propio',
  upload: 'archivo subido',
}

/** Por qué terminó un job no exitoso (null si completó). */
export function jobCause(job: JobDetailDto): string | null {
  if (job.status === 'completed') return null
  switch (job.error_detail) {
    case 'wall_timeout':
      return `Se alcanzó el tiempo límite de ${job.timeout_s} s y se detuvo el programa.`
    case 'output_limit_exceeded':
      return 'La salida superó el límite de 256 KB y se detuvo el programa.'
    case 'oom':
      return 'El programa se quedó sin memoria (límite del contenedor) y se detuvo.'
    case 'orphaned_on_restart':
      return 'El backend se reinició durante la ejecución; el job no pudo terminar.'
    case 'sandbox_error':
      return 'Falló el entorno de ejecución (Docker), no tu programa. Inténtalo de nuevo.'
    default:
      break
  }
  if (job.status === 'cancelled') return 'Cancelada a petición del usuario.'
  if (job.status === 'timeout') return `Se alcanzó el tiempo límite de ${job.timeout_s} s.`
  return job.exit_code != null ? `El programa terminó con exit ${job.exit_code}.` : 'El programa terminó con error.'
}

/** Piezas de la configuración de la ejecución, en orden de lectura. */
export function jobConfigParts(job: JobDetailDto): string[] {
  const parts = [
    job.timeout_s === 0 ? 'sin límite de tiempo' : `timeout ${job.timeout_s} s`,
    `origen: ${SOURCE_LABEL[job.source_kind]}`,
  ]
  if (job.example_id != null) parts.push(`ejemplo ${job.example_id}`)
  if (job.lesson_id != null) parts.push(`lección ${job.lesson_id}`)
  return parts
}
