// Opciones del selector de timeout: el tope del backend es OPCIONAL
// (limits.max_timeout_s = 0 ⇒ sin límite). La regresión que cubre este archivo:
// con 0, el filtro `t <= maxTimeoutS` vaciaba el <select> y la UI se quedaba
// sin nada seleccionable.
import { describe, expect, it } from 'vitest'

import { buildTimeoutOptions, NO_TIMEOUT, TIMEOUT_CHOICES } from '../../src/features/simulator/AdvancedOptions'
import { effectiveTimeoutCap, TIMEOUT_MIN_S } from '../../src/features/admin/example/ExampleMetaFields'

describe('buildTimeoutOptions', () => {
  it('incluye el valor actual recuperado aunque no esté en la escalera', () => {
    expect(buildTimeoutOptions(0, null, 45)).toContain(45)
    expect(buildTimeoutOptions(60, null, 90)).not.toContain(90) // por encima del tope
  })

  it('sin tope ofrece «Sin timeout» + la escalera de 4 valores', () => {
    expect(buildTimeoutOptions(0, null)).toEqual([NO_TIMEOUT, ...TIMEOUT_CHOICES])
  })

  it('«Sin timeout» va primero y solo aparece sin tope', () => {
    expect(buildTimeoutOptions(0, null)[0]).toBe(NO_TIMEOUT)
    expect(buildTimeoutOptions(120, null)).not.toContain(NO_TIMEOUT)
  })

  it('sin tope NUNCA devuelve lista vacía (regresión del select en blanco)', () => {
    for (const max of [0, -1]) {
      expect(buildTimeoutOptions(max, null).length).toBeGreaterThan(0)
    }
  })

  it('con tope acota la escalera y no ofrece nada por encima', () => {
    const options = buildTimeoutOptions(60, null)
    expect(options).toEqual([30, 60])
    expect(Math.max(...options)).toBeLessThanOrEqual(60)
  })

  it('incluye el default del ejemplo aunque no esté en la escalera', () => {
    expect(buildTimeoutOptions(0, 45)).toContain(45)
  })

  it('salvo el centinela 0, nunca ofrece por debajo del mínimo (5 s)', () => {
    for (const max of [0, 10, 120]) {
      const reales = buildTimeoutOptions(max, null).filter((t) => t !== NO_TIMEOUT)
      expect(Math.min(...reales)).toBeGreaterThanOrEqual(5)
    }
  })

  it('con un tope menor que toda la escalera sigue dando una opción usable', () => {
    const options = buildTimeoutOptions(10, null)
    expect(options.length).toBeGreaterThan(0)
    expect(Math.max(...options)).toBeLessThanOrEqual(10)
  })
})

describe('effectiveTimeoutCap (campo admin)', () => {
  it('sin tope no impone techo (null), y desde luego no 0', () => {
    expect(effectiveTimeoutCap(0)).toBeNull()
    expect(effectiveTimeoutCap(-5)).toBeNull()
  })

  it('con tope usa el del backend', () => {
    expect(effectiveTimeoutCap(60)).toBe(60)
  })

  it('ya no hay techo de 120: la migration 4 levantó el CHECK', () => {
    expect(effectiveTimeoutCap(3600)).toBe(3600)
  })

  it('el mínimo declarado coincide con el ge=5 del backend', () => {
    expect(TIMEOUT_MIN_S).toBe(5)
  })
})
