// api/client.ts — capa HTTP tipada (fetch nativo, sin axios).
// Desenvuelve el envelope {success,data,error,meta} de api-contract.md §1;
// !success → throw ApiError(error.code, error.message, status, details).
// (GET /health y /output son las dos excepciones sin envelope — api/system.ts
// y la descarga directa las manejan aparte.)
import { API_BASE } from '../config'
import type { ApiMetaDto, Envelope } from './types'

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(code: string, message: string, status: number, details: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export interface WithMeta<T> {
  data: T
  /** Solo poblado en listados paginados (api-contract §1). */
  meta: ApiMetaDto | null
}

function buildHeaders(init?: RequestInit): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // Content-Type solo para bodies JSON; FormData fija su propio boundary.
  if (typeof init?.body === 'string') headers['Content-Type'] = 'application/json'
  return { ...headers, ...init?.headers }
}

/** fetch + envelope, conservando `meta` (listados paginados). */
export async function fetchEnvelope<T>(path: string, init?: RequestInit): Promise<WithMeta<T>> {
  let res: Response
  try {
    res = await fetch(API_BASE + path, { ...init, headers: buildHeaders(init) })
  } catch {
    // Red caída / backend inalcanzable: código local (no es del contrato).
    throw new ApiError('NETWORK_ERROR', 'No se pudo contactar con el backend E-HPC.', 0)
  }

  let envelope: Envelope<T>
  try {
    envelope = (await res.json()) as Envelope<T>
  } catch {
    throw new ApiError('INVALID_RESPONSE', `Respuesta no válida del backend (HTTP ${res.status}).`, res.status)
  }

  if (!envelope.success || envelope.data === null) {
    const err = envelope.error
    throw new ApiError(
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? `Error HTTP ${res.status}`,
      res.status,
      err?.details ?? null,
    )
  }
  return { data: envelope.data, meta: envelope.meta }
}

/** Variante habitual: devuelve `data` ya desenvuelto. */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await fetchEnvelope<T>(path, init)
  return data
}
