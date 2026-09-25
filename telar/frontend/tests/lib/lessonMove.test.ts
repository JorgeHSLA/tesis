// tests/lib/lessonMove.test.ts — recolocar lecciones al moverlas (CU-19.1).
// El cliente calcula el orden COMPLETO del módulo de origen y del de destino,
// y el lote va en un solo PUT /admin/lessons/reorder: así se puede insertar en
// una posición ocupada sin el 409 ORDER_CONFLICT del PUT de una lección.
import { describe, expect, it } from 'vitest'
import { isPositionTaken, planLessonMove, type ModuleLessons } from '@/lib/lessonMove'

const MODULES: ModuleLessons[] = [
  {
    id: 'm1',
    lessons: [
      { id: 'C', order: 3 },
      { id: 'A', order: 1 },
      { id: 'B', order: 2 },
    ],
  },
  {
    id: 'm2',
    lessons: [
      { id: 'X', order: 1 },
      { id: 'Y', order: 2 },
    ],
  },
]

describe('planLessonMove', () => {
  it('A,B,C: mover C a la posición 2 deja A,C,B', () => {
    const plan = planLessonMove(MODULES, 'C', 'm1', 2)
    expect(plan.order).toBe(2)
    expect(plan.items).toEqual([
      { id: 'A', order: 1, module_id: 'm1' },
      { id: 'C', order: 2, module_id: 'm1' },
      { id: 'B', order: 3, module_id: 'm1' },
    ])
  })

  it('mover a otro módulo en una posición ocupada recoloca origen y destino', () => {
    const plan = planLessonMove(MODULES, 'B', 'm2', 1)
    expect(plan.order).toBe(1)
    expect(plan.items).toEqual([
      { id: 'A', order: 1, module_id: 'm1' },
      { id: 'C', order: 2, module_id: 'm1' },
      { id: 'B', order: 1, module_id: 'm2' },
      { id: 'X', order: 2, module_id: 'm2' },
      { id: 'Y', order: 3, module_id: 'm2' },
    ])
  })

  it('una posición más allá del final coloca la lección al final', () => {
    const plan = planLessonMove(MODULES, 'A', 'm2', 99)
    expect(plan.order).toBe(3)
    expect(plan.items.filter((i) => i.module_id === 'm2')).toEqual([
      { id: 'X', order: 1, module_id: 'm2' },
      { id: 'Y', order: 2, module_id: 'm2' },
      { id: 'A', order: 3, module_id: 'm2' },
    ])
  })

  it('compacta los huecos del módulo', () => {
    const conHuecos: ModuleLessons[] = [
      { id: 'm1', lessons: [{ id: 'A', order: 2 }, { id: 'B', order: 7 }] },
    ]
    expect(planLessonMove(conHuecos, 'B', 'm1', 1).items).toEqual([
      { id: 'B', order: 1, module_id: 'm1' },
      { id: 'A', order: 2, module_id: 'm1' },
    ])
  })

  it('no muta la entrada', () => {
    const copia = structuredClone(MODULES)
    planLessonMove(MODULES, 'C', 'm2', 1)
    expect(MODULES).toEqual(copia)
  })

  it('falla si el módulo de destino no existe', () => {
    expect(() => planLessonMove(MODULES, 'A', 'nope', 1)).toThrow()
  })
})

describe('isPositionTaken', () => {
  it('dice si otra lección ocupa esa posición en el módulo', () => {
    expect(isPositionTaken(MODULES, 'm1', 2)).toBe(true)
    expect(isPositionTaken(MODULES, 'm1', 4)).toBe(false)
    expect(isPositionTaken(MODULES, 'm1', 2, 'B')).toBe(false)
    expect(isPositionTaken(MODULES, 'otro', 1)).toBe(false)
  })
})
