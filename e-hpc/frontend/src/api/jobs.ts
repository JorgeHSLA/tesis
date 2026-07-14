// api/jobs.ts — capa HTTP de jobs (api-contract §7): createJob, uploadJobFile,
// getJob, listJobs, cancelJob + URL de descarga de output (§7.6, sin envelope).
import { API_BASE } from '../config'
import { fetchEnvelope, fetchJson } from './client'
import type {
  ApiMetaDto,
  JobCancelDto,
  JobCreatedDto,
  JobCreateRequestDto,
  JobDetailDto,
  JobsListDto,
  JobStatus,
  JobSummaryDto,
} from './types'

/** §7.1 POST /api/v1/jobs — crear job (editor o preset). Respuesta 202. */
export function createJob(req: JobCreateRequestDto): Promise<JobCreatedDto> {
  return fetchJson<JobCreatedDto>('/api/v1/jobs', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface UploadJobOptions {
  threads?: number
  timeout_s?: number
  lesson_id?: string
}

/** §7.2 POST /api/v1/jobs/upload — multipart (validación por chunks en backend). */
export function uploadJobFile(file: File, opts: UploadJobOptions = {}): Promise<JobCreatedDto> {
  const form = new FormData()
  form.append('file', file)
  if (opts.threads != null) form.append('threads', String(opts.threads))
  if (opts.timeout_s != null) form.append('timeout_s', String(opts.timeout_s))
  if (opts.lesson_id != null) form.append('lesson_id', opts.lesson_id)
  return fetchJson<JobCreatedDto>('/api/v1/jobs/upload', { method: 'POST', body: form })
}

/** §7.4 GET /api/v1/jobs/{job_id} — detalle y resultados. */
export function getJob(jobId: string): Promise<JobDetailDto> {
  return fetchJson<JobDetailDto>(`/api/v1/jobs/${encodeURIComponent(jobId)}`)
}

export interface ListJobsParams {
  limit?: number
  offset?: number
  status?: JobStatus
}

export interface JobsPage {
  jobs: JobSummaryDto[]
  meta: ApiMetaDto | null
}

/** §7.3 GET /api/v1/jobs — listado reciente (conserva `meta` de paginación). */
export async function listJobs(params: ListJobsParams = {}): Promise<JobsPage> {
  const query = new URLSearchParams()
  if (params.limit != null) query.set('limit', String(params.limit))
  if (params.offset != null) query.set('offset', String(params.offset))
  if (params.status != null) query.set('status', params.status)
  const qs = query.toString()
  const { data, meta } = await fetchEnvelope<JobsListDto>(`/api/v1/jobs${qs ? `?${qs}` : ''}`)
  return { jobs: data.jobs, meta }
}

/** §7.5 POST /api/v1/jobs/{job_id}/cancel — equivalente REST del WS cancel. */
export function cancelJob(jobId: string): Promise<JobCancelDto> {
  return fetchJson<JobCancelDto>(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  })
}

/** §7.6 GET /api/v1/jobs/{job_id}/output — descarga directa (sin envelope). */
export function jobOutputUrl(jobId: string, stream?: 'combined' | 'stdout' | 'stderr'): string {
  const base = `${API_BASE}/api/v1/jobs/${encodeURIComponent(jobId)}/output`
  return stream != null && stream !== 'combined' ? `${base}?stream=${stream}` : base
}
