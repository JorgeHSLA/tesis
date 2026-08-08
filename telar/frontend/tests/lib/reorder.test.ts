// tests/lib/reorder.test.ts — utilidades puras del reordenamiento de módulos.
import { describe, expect, it } from 'vitest'
import { moveItem, resequence, toReorderItems } from '@/lib/reorder'

describe('moveItem', () => {
  it('mueve un elemento hacia abajo devolviendo un NUEVO array', () => {
    const src = ['a', 'b', 'c', 'd']
    const out = moveItem(src, 0, 2)
    expect(out).toEqual(['b', 'c', 'a', 'd'])
    expect(src).toEqual(['a', 'b', 'c', 'd']) // no muta la entrada
    expect(out).not.toBe(src)
  })

  it('mueve un elemento hacia arriba', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('es no-op (copia intacta) con índices iguales o fuera de rango', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], -1, 2)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['a', 'b', 'c'])
  })
})

describe('resequence', () => {
  it('reasigna order = índice + 1 con objetos nuevos', () => {
    const src = [
      { id: 'b', order: 5 },
      { id: 'a', order: 9 },
      { id: 'c', order: 1 },
    ]
    const out = resequence(src)
    expect(out).toEqual([
      { id: 'b', order: 1 },
      { id: 'a', order: 2 },
      { id: 'c', order: 3 },
    ])
    expect(out[0]).not.toBe(src[0]) // inmutable
    expect(src[0].order).toBe(5) // no muta la entrada
  })
})

describe('toReorderItems', () => {
  it('deriva {id, order} 1-based en el orden del array', () => {
    expect(toReorderItems([{ id: 'x' }, { id: 'y' }, { id: 'z' }])).toEqual([
      { id: 'x', order: 1 },
      { id: 'y', order: 2 },
      { id: 'z', order: 3 },
    ])
  })

  it('array vacío → []', () => {
    expect(toReorderItems([])).toEqual([])
  })
})
