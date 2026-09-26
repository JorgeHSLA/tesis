// features/admin/field-errors.ts — interpreta un 422 para los editores de G2.
// Dos formatos: `CONTENT_VALIDATION_ERROR` (api-contract §10: `details =
// [{field, reason}]`) y el `VALIDATION_ERROR` de pydantic (`details = [{type,
// loc, msg}]`, CU-13.3/14.3/17.4/18.5/21.3), cuyo `msg` en inglés se cambia por
// un texto en español según `type`. Mapea cada campo conocido a un mensaje de
// campo (field-hint) y deja el resto (o un error no-422) para el banner de la
// AdminSaveBar. El backend re-valida siempre; esto solo posiciona el error.
import { ApiError } from '../../api/client'

export interface ContentFieldError {
  field: string
  reason: string
  /** Viene de pydantic: su texto es genérico y en el banner necesita el campo. */
  pydantic?: boolean
}

export interface ParsedContentErrors {
  /** Mensaje por campo, indexado por el `field` que devuelve el backend. */
  byField: Readonly<Record<string, string>>
  /** Texto para el banner general, o `null` si todo se mapeó a un campo. */
  banner: string | null
}

const EMPTY: ParsedContentErrors = { byField: {}, banner: null }

/** Texto en español por `type` de pydantic (el `ctx` con los límites no viaja: BL-22). */
const PYDANTIC_MESSAGES: Readonly<Record<string, string>> = {
  missing: 'Este campo es obligatorio.',
  string_too_short: 'Este campo no puede quedar vacío.',
  string_too_long: 'El texto es demasiado largo.',
  too_short: 'Debe tener al menos un elemento.',
  too_long: 'Tiene demasiados elementos.',
  greater_than_equal: 'El valor es menor que el mínimo permitido.',
  greater_than: 'El valor es menor que el mínimo permitido.',
  less_than_equal: 'El valor supera el máximo permitido.',
  less_than: 'El valor supera el máximo permitido.',
  int_parsing: 'Debe ser un número entero.',
  int_type: 'Debe ser un número entero.',
  int_from_float: 'Debe ser un número entero.',
  string_type: 'Debe ser un texto.',
  bool_type: 'Debe ser sí o no.',
  bool_parsing: 'Debe ser sí o no.',
  string_pattern_mismatch: 'El formato no es válido.',
  literal_error: 'Ese valor no está permitido.',
  enum: 'Ese valor no está permitido.',
}
const PYDANTIC_FALLBACK = 'El valor no es válido.'

/** `loc` → ruta de campo: sin el origen (`body`…) ni los índices de lista. */
function fieldFromLoc(loc: readonly unknown[]): string {
  const parts = loc.filter((p): p is string => typeof p === 'string')
  if (parts.length > 1 && ['body', 'query', 'path'].includes(parts[0])) parts.shift()
  return parts.join('.')
}

/** Extrae `[{field, reason}]` de `error.details` (ambos formatos) de forma defensiva. */
function coerceEntries(details: unknown): ContentFieldError[] {
  if (!Array.isArray(details)) return []
  const out: ContentFieldError[] = []
  for (const raw of details) {
    if (raw == null || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    if (Array.isArray(rec.loc) && typeof rec.type === 'string') {
      const field = fieldFromLoc(rec.loc)
      if (field !== '') out.push({ field, reason: PYDANTIC_MESSAGES[rec.type] ?? PYDANTIC_FALLBACK, pydantic: true })
      continue
    }
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
  for (const { field, reason, pydantic } of entries) {
    if (known.has(field) && byField[field] == null) byField[field] = reason
    // Un segundo error de pydantic en un campo ya marcado no aporta nada.
    else if (pydantic && known.has(field)) continue
    else leftovers.push(pydantic ? `${field}: ${reason}` : reason)
  }
  return {
    byField,
    banner: leftovers.length > 0 ? leftovers.join(' · ') : null,
  }
}

/**
 * Texto del banner de la AdminSaveBar tras un fallo al guardar: lo que no se
 * pudo anclar a un campo; si todo se ancló, un aviso de mirar los campos (el
 * genérico «no son válidos» del 422 no dice nada que no se vea ya).
 */
export function saveErrorBanner(parsed: ParsedContentErrors, err: unknown, fallback: string): string {
  if (parsed.banner != null) return parsed.banner
  if (Object.keys(parsed.byField).length > 0) return 'Revisa los campos marcados.'
  return err instanceof ApiError ? err.message : fallback
}

export { EMPTY as EMPTY_CONTENT_ERRORS }
