// Opciones del selector de timeout: el tope del backend es OPCIONAL
// (limits.max_timeout_s = 0 ⇒ sin límite). La regresión que cubre este archivo:
// con 0, el filtro `t <= maxTimeoutS` vaciaba el <select> y la UI se quedaba
// sin nada seleccionable.
import { describe, expect, it } from 'vitest'

import { buildTimeoutOptions, TIMEOUT_CHOICES } from '../../src/features/simulator/AdvancedOptions'
import { effectiveTimeoutCap, TIMEOUT_MIN_S } from '../../src/features/admin/example/ExampleMetaFields'

describe('buildTimeoutOptions', () => {
  it('sin tope (0) ofrece la escalera de 4 valores', () => {
    expect(buildTimeoutOptions(0, null)).toEqual([...TIMEOUT_CHOICES])
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

  it('nunca ofrece por debajo del mínimo del backend (5 s)', () => {
    for (const max of [0, 10, 120]) {
      expect(Math.min(...buildTimeoutOptions(max, null))).toBeGreaterThanOrEqual(5)
    }
  })

  it('con un tope menor que toda la escalera sigue dando una opción usable', () => {
    const options = buildTimeoutOptions(10, null)
    expect(options.length).toBeGreaterThan(0)
    expect(Math.max(...options)).toBeLessThanOrEqual(10)
  })
})

describe('effectiveTimeoutCap (campo admin)', () => {
  it('sin tope cae al techo del CHECK de la DB, no a 0', () => {
    expect(effectiveTimeoutCap(0)).toBe(120)
    expect(effectiveTimeoutCap(-5)).toBe(120)
  })

  it('con tope usa el del backend', () => {
    expect(effectiveTimeoutCap(60)).toBe(60)
  })

  it('nunca supera el techo de la DB aunque el backend permita más', () => {
    expect(effectiveTimeoutCap(3600)).toBe(120)
  })

  it('el mínimo declarado coincide con el ge=5 del backend', () => {
    expect(TIMEOUT_MIN_S).toBe(5)
  })
})
