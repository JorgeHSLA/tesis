// api/system.ts — GET /api/v1/system y GET /health (api-contract §2).
import { API_BASE } from '../config'
import { ApiError, fetchJson } from './client'
import type { HealthDto, SystemInfoDto } from './types'

/** §2.2 GET /api/v1/system — info para la UI (envelope). */
export function getSystem(): Promise<SystemInfoDto> {
  return fetchJson<SystemInfoDto>('/api/v1/system')
}

/** §2.1 GET /health — SIN envelope (excepción documentada del contrato). */
export async function getHealth(): Promise<HealthDto> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/health`, { headers: { Accept: 'application/json' } })
  } catch {
    throw new ApiError('NETWORK_ERROR', 'No se pudo contactar con el backend Telar.', 0)
  }
  if (!res.ok) {
    throw new ApiError('HEALTH_UNAVAILABLE', `Healthcheck no disponible (HTTP ${res.status}).`, res.status)
  }
  return (await res.json()) as HealthDto
}
