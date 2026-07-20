// Suite 5 (frontend-spec §10): stores/themeStore.test.ts
// La app quedó FIJA en la variante v2 (2026-07): el switch v1/v2 se retiró.
// applyFixedVariant() escribe data-variant="v2" en <html> y NO se lee ningún
// valor persistido (un 'v1' viejo en localStorage debe quedar ignorado).
import { beforeEach, describe, expect, it } from 'vitest'
import { FIXED_VARIANT, applyFixedVariant } from '@/stores/themeStore'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.variant
})

describe('themeStore (variante fija v2)', () => {
  it('la variante fija es v2', () => {
    expect(FIXED_VARIANT).toBe('v2')
  })

  it('applyFixedVariant() escribe data-variant="v2" en <html>', () => {
    applyFixedVariant()
    expect(document.documentElement.dataset.variant).toBe('v2')
  })

  it('ignora un valor v1 heredado en localStorage y aplica v2', () => {
    // Sesión previa con el switch: pudo quedar 'v1' persistido.
    localStorage.setItem('ehpc-variant', JSON.stringify({ state: { variant: 'v1' }, version: 0 }))
    applyFixedVariant()
    expect(document.documentElement.dataset.variant).toBe('v2')
  })

  it('es idempotente: reafirma v2 aunque el atributo se hubiera alterado', () => {
    document.documentElement.dataset.variant = 'v1'
    applyFixedVariant()
    expect(document.documentElement.dataset.variant).toBe('v2')
  })
})
