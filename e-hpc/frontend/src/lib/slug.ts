// lib/slug.ts — deriva el identificador (PK) de un módulo a partir de su título.
// El backend valida el `id` con `^[A-Za-z][A-Za-z0-9_-]{0,63}$` (letra inicial,
// máx 64, alfanumérico + `-`/`_`); `slugify` GARANTIZA ese patrón y `uniqueSlug`
// deduplica contra los ids ya existentes. Sin dependencias — puro y testeable.

/** Longitud máxima del id (coincide con el `{0,63}` del patrón backend → 64). */
const MAX_LEN = 64
/** Prefijo cuando el título no aporta ninguna letra inicial (p. ej. «123»). */
const FALLBACK_PREFIX = 'm-'
/** Patrón EXACTO del backend; se usa como aserción defensiva final. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/**
 * Normaliza un título a un identificador válido:
 * - quita acentos/diacríticos (`NFD` + rango combinante),
 * - pasa a minúsculas,
 * - todo lo no alfanumérico → `-`, colapsa `-` repetidos y recorta los bordes,
 * - garantiza que empiece por letra (si no, antepone `m-`),
 * - recorta a 64 y vuelve a limpiar el borde derecho.
 *
 * Siempre devuelve una cadena que cumple `^[A-Za-z][A-Za-z0-9_-]{0,63}$`.
 */
export function slugify(title: string): string {
  const base = (title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas diacríticas combinantes (NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // no-alfanumérico → separador
    .replace(/-+/g, '-') // colapsa separadores repetidos
    .replace(/^-+|-+$/g, '') // recorta separadores de los bordes

  // Si el título no aportó nada utilizable (vacío, solo símbolos), usa 'modulo'.
  if (base === '') return 'modulo'

  // Garantiza letra inicial: si empieza por dígito, antepone `m-`.
  const withLetter = /^[a-z]/.test(base) ? base : `${FALLBACK_PREFIX}${base}`

  // Recorta a MAX_LEN y limpia un posible `-` colgando tras el corte.
  const clipped = withLetter.slice(0, MAX_LEN).replace(/-+$/g, '')

  // Red de seguridad: si algo dejó una cadena inválida (todo vacío), usa 'modulo'.
  return ID_PATTERN.test(clipped) ? clipped : 'modulo'
}

/**
 * Devuelve `base` si no colisiona con `existing`; si colisiona, sufija
 * `-2`, `-3`, … hasta encontrar un id libre (respetando el máximo de 64).
 * La comparación es exacta (los ids del backend son sensibles a mayúsculas,
 * pero `slugify` ya entrega minúsculas).
 */
export function uniqueSlug(base: string, existing: readonly string[]): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`
    const trimmed = base.slice(0, MAX_LEN - suffix.length).replace(/-+$/g, '')
    const candidate = `${trimmed}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}
