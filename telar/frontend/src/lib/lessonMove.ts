// lib/lessonMove.ts — recolocar lecciones al moverlas (CU-19.1). PURO: sin
// React ni red. El `order` de lección es único por módulo, así que mover una
// lección a una posición ocupada con su PUT da 409. En su lugar el cliente
// calcula el orden COMPLETO del módulo de origen y del de destino, y el lote va
// en un solo PUT /admin/lessons/reorder (una transacción en el servidor).
import type { AdminReorderItemDto } from '../api/admin-types'

export interface LessonSlot {
  id: string
  order: number
}

export interface ModuleLessons {
  id: string
  lessons: readonly LessonSlot[]
}

export interface LessonMovePlan {
  /** Lote para `reorderLessons`: origen y destino completos, con `module_id`. */
  items: AdminReorderItemDto[]
  /** Posición final de la lección (1-based), ya acotada al tamaño del destino. */
  order: number
}

function sortedIdsWithout(module: ModuleLessons | undefined, lessonId: string): string[] {
  if (module == null) return []
  return [...module.lessons]
    .sort((a, b) => a.order - b.order)
    .map((l) => l.id)
    .filter((id) => id !== lessonId)
}

function toItems(ids: readonly string[], moduleId: string): AdminReorderItemDto[] {
  return ids.map((id, index) => ({ id, order: index + 1, module_id: moduleId }))
}

/**
 * Coloca `lessonId` en la `position` (1-based) de `toModuleId` y recoloca las
 * demás: en el destino se corren una posición, y en el origen (si es otro
 * módulo) se cierra el hueco. Una posición más allá del final va al final.
 * Los órdenes resultantes son 1..N sin huecos en ambos módulos.
 */
export function planLessonMove(
  modules: readonly ModuleLessons[],
  lessonId: string,
  toModuleId: string,
  position: number,
): LessonMovePlan {
  const destino = modules.find((m) => m.id === toModuleId)
  if (destino == null) throw new Error(`No existe el módulo ${toModuleId}.`)
  const origen = modules.find((m) => m.lessons.some((l) => l.id === lessonId))

  const destinoIds = sortedIdsWithout(destino, lessonId)
  const index = Math.min(Math.max(position, 1), destinoIds.length + 1) - 1
  const nuevoDestino = [...destinoIds.slice(0, index), lessonId, ...destinoIds.slice(index)]

  const itemsOrigen =
    origen != null && origen.id !== toModuleId ? toItems(sortedIdsWithout(origen, lessonId), origen.id) : []
  return { items: [...itemsOrigen, ...toItems(nuevoDestino, toModuleId)], order: index + 1 }
}

/** ¿Otra lección (distinta de `exceptId`) ocupa esa posición en el módulo? */
export function isPositionTaken(
  modules: readonly ModuleLessons[],
  moduleId: string,
  position: number,
  exceptId?: string,
): boolean {
  const module = modules.find((m) => m.id === moduleId)
  return module?.lessons.some((l) => l.order === position && l.id !== exceptId) ?? false
}
