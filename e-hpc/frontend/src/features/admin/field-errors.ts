// features/admin/field-errors.ts — interpreta un `422 CONTENT_VALIDATION_ERROR`
// (api-contract §10: `details = [{field, reason}]`) para los editores de G2.
// Mapea cada `field` conocido a un mensaje de campo (field-hint) y deja el resto
// (o un error no-422) para el banner de la AdminSaveBar. El backend re-valida
// siempre; esto es solo para posicionar el error junto al control adecuado.
import { ApiError } from '../../api/client'

export interface ContentFieldError {
  field: string
  reason: string
}

export interface ParsedContentErrors {
  /** Mensaje por campo, indexado por el `field` que devuelve el backend. */
  byField: Readonly<Record<string, string>>
  /** Texto para el banner general, o `null` si todo se mapeó a un campo. */
  banner: string | null
}

const EMPTY: ParsedContentErrors = { byField: {}, banner: null }

/** Extrae la lista `[{field, reason}]` de `error.details` de forma defensiva. */
function coerceEntries(details: unknown): ContentFieldError[] {
  if (!Array.isArray(details)) return []
  const out: ContentFieldError[] = []
  for (const raw of details) {
    if (raw == null || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const field = rec.field
    const reason = typeof rec.reason === 'string' ? rec.reason : rec.message
    if (typeof field === 'string' && typeof reason === 'string') {
      out.push({ field, reason })
    }
  }
  return out
}

/**
 * @param err          error capturado al guardar (idealmente `ApiError`).
 * @param knownFields  campos que el editor sabe posicionar (el resto va al banner).
 */
export function parseContentErrors(
  err: unknown,
  knownFields: readonly string[],
): ParsedContentErrors {
  if (!(err instanceof ApiError)) {
    return { byField: {}, banner: 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.' }
  }
  const entries = coerceEntries(err.details)
  if (entries.length === 0) {
    return { byField: {}, banner: err.message }
  }
  const known = new Set(knownFields)
  const byField: Record<string, string> = {}
  const leftovers: string[] = []
  for (const { field, reason } of entries) {
    if (known.has(field) && byField[field] == null) byField[field] = reason
    else leftovers.push(reason)
  }
  return {
    byField,
    banner: leftovers.length > 0 ? leftovers.join(' · ') : null,
  }
}

export { EMPTY as EMPTY_CONTENT_ERRORS }
