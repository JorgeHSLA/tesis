// features/catalog/ModuleAccordion.test.tsx — `visibleRows` es la lógica pura
// del catálogo: qué lecciones pinta un módulo según filtro y búsqueda.
//
// F2: antes cada lección producía DOS filas (una «Ejemplo» y otra «Quiz») que
// navegaban a la misma pantalla. Estos tests fijan la regla nueva: UNA fila por
// lección, y el filtro selecciona lecciones por lo que contienen.
import { describe, expect, it } from 'vitest'
import { visibleRows } from '@/features/catalog/ModuleAccordion'
import type { ModuleDto, ModuleLessonDto } from '@/api/types'
import { MODULES } from '../../fixtures/rest'

const BASE = MODULES.modules[0]

function lesson(overrides: Partial<ModuleLessonDto> = {}): ModuleLessonDto {
  return { ...BASE.lessons[0], ...overrides }
}

function moduleWith(lessons: ModuleLessonDto[], title = BASE.title): ModuleDto {
  return { ...BASE, title, lessons }
}

describe('visibleRows', () => {
  it('una fila por lección, no dos: el catálogo no se duplica', () => {
    const rows = visibleRows(BASE, 'all', '')
    expect(rows).toHaveLength(BASE.lessons.length)
    expect(rows.map((r) => r.lesson.id)).toEqual(['spmd', 'spmdCritical'])
  })

  it('ordena por `order` y numera 1-based dentro del módulo', () => {
    const desordenado = moduleWith([
      lesson({ id: 'b', order: 9 }),
      lesson({ id: 'a', order: 2 }),
    ])
    expect(visibleRows(desordenado, 'all', '')).toEqual([
      { lesson: expect.objectContaining({ id: 'a' }), index: 1 },
      { lesson: expect.objectContaining({ id: 'b' }), index: 2 },
    ])
  })

  it('filtro «quiz» deja fuera las lecciones sin quiz', () => {
    const mixto = moduleWith([
      lesson({ id: 'con-quiz', order: 1, has_quiz: true }),
      lesson({ id: 'sin-quiz', order: 2, has_quiz: false }),
    ])
    expect(visibleRows(mixto, 'quiz', '').map((r) => r.lesson.id)).toEqual(['con-quiz'])
  })

  it('filtro «example» deja fuera las lecciones sin ejemplo', () => {
    // Forward-compatible: hoy toda lección trae ejemplo, pero el modelo va a
    // admitir lecciones conceptuales sin código (E1 de la revisión).
    const mixto = moduleWith([
      lesson({ id: 'con-codigo', order: 1 }),
      lesson({ id: 'solo-teoria', order: 2, example_id: null as unknown as string }),
    ])
    expect(visibleRows(mixto, 'example', '').map((r) => r.lesson.id)).toEqual(['con-codigo'])
    // Sin filtro sí aparece: existe, solo que no se ejecuta.
    expect(visibleRows(mixto, 'all', '')).toHaveLength(2)
  })

  it('la búsqueda casa por título de lección', () => {
    expect(visibleRows(BASE, 'all', 'critical').map((r) => r.lesson.id)).toEqual(['spmdCritical'])
  })

  it('si casa el título del MÓDULO, se muestran todas sus lecciones', () => {
    expect(visibleRows(BASE, 'all', 'false sharing')).toHaveLength(2)
  })

  it('la búsqueda ignora mayúsculas y espacios sobrantes', () => {
    expect(visibleRows(BASE, 'all', '  CRITICAL  ').map((r) => r.lesson.id)).toEqual(['spmdCritical'])
  })

  it('sin coincidencias devuelve lista vacía (la UI pinta el estado vacío)', () => {
    expect(visibleRows(BASE, 'all', 'mandelbrot')).toEqual([])
  })

  it('filtro y búsqueda se combinan (AND, no OR)', () => {
    // Título de módulo que NO casa con la búsqueda, para aislar el match por
    // lección: si el módulo casara, mostraría todas sus lecciones (test anterior).
    const mixto = moduleWith(
      [
        lesson({ id: 'spmd', order: 1, title: 'π con SPMD', has_quiz: false }),
        lesson({ id: 'spmdCritical', order: 2, title: 'El arreglo: critical', has_quiz: true }),
      ],
      'Worksharing sobre arrays',
    )
    // 'spmd' casa con la primera lección, pero no tiene quiz → nada.
    expect(visibleRows(mixto, 'quiz', 'spmd')).toEqual([])
    expect(visibleRows(mixto, 'quiz', 'critical').map((r) => r.lesson.id)).toEqual(['spmdCritical'])
  })
})
