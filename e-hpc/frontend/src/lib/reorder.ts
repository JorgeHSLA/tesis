// lib/reorder.ts — utilidades PURAS para reordenar listas con campo `order`
// (1-based). Las usa el dashboard de autoría para el drag-and-drop de módulos y
// para los botones «Subir»/«Bajar». Sin React ni efectos: fáciles de testear.

/** Elemento mínimo reordenable: un id y su `order` global (≥1). */
export interface Orderable {
  id: string
  order: number
}

/**
 * Mueve el elemento del índice `from` al índice `to` devolviendo un NUEVO array
 * (nunca muta la entrada). Si los índices están fuera de rango o son iguales,
 * devuelve una copia intacta.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const n = items.length
  const next = items.slice()
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return next
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Reasigna `order = índice + 1` a cada elemento devolviendo objetos NUEVOS
 * (inmutable). El orden del array es la fuente de verdad tras un reordenamiento.
 */
export function resequence<T extends Orderable>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ ...item, order: index + 1 }))
}

/**
 * Deriva los pares `{id, order}` (1-based) que consume el endpoint de reorden.
 * `order` sale del índice, así que refleja el orden actual del array.
 */
export function toReorderItems(items: readonly { id: string }[]): Orderable[] {
  return items.map((item, index) => ({ id: item.id, order: index + 1 }))
}
