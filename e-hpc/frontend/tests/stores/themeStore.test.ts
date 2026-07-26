// Suite 5 (frontend-spec §10): stores/themeStore.test.ts
//
// Dos ejes independientes:
//  · data-variant  → FIJO en v2 (el switch v1/v2 se retiró en 2026-07); no se
//    lee ningún valor persistido (un 'v1' viejo debe quedar ignorado).
//  · data-theme    → claro/oscuro, persistido en 'ehpc-theme', con
//    prefers-color-scheme como valor por defecto.
//
// El eje de tema se prueba con `vi.resetModules()` + import dinámico porque el
// módulo tiene efectos de import a propósito (aplica el tema ANTES del primer
// render, que es lo que evita el destello).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXED_VARIANT, THEME_STORAGE_KEY, applyFixedVariant } from '@/stores/themeStore'

const realMatchMedia = window.matchMedia

/** Fuerza el valor de `prefers-color-scheme: dark` del sistema. */
function stubSystemDark(prefersDark: boolean): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes('prefers-color-scheme: dark') ? prefersDark : false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
}

/** Reimporta el módulo con sus efectos de import (aplica variante y tema). */
async function freshModule() {
  vi.resetModules()
  return await import('@/stores/themeStore')
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.variant
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeTransition
})

afterEach(() => {
  window.matchMedia = realMatchMedia
  vi.useRealTimers()
})

describe('themeStore · eje de variante (fija v2)', () => {
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

describe('themeStore · eje claro/oscuro (data-theme)', () => {
  it('systemTheme() lee prefers-color-scheme', async () => {
    stubSystemDark(true)
    const dark = await freshModule()
    expect(dark.systemTheme()).toBe('dark')

    stubSystemDark(false)
    const light = await freshModule()
    expect(light.systemTheme()).toBe('light')
  })

  it('sin nada persistido, el valor por defecto es el del SISTEMA (oscuro)', async () => {
    stubSystemDark(true)
    const { useThemeStore } = await freshModule()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('sin nada persistido y sistema claro, arranca en claro', async () => {
    stubSystemDark(false)
    const { useThemeStore } = await freshModule()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('lo persistido MANDA sobre la preferencia del sistema', async () => {
    stubSystemDark(false)
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ state: { theme: 'dark' }, version: 0 }))
    const { useThemeStore } = await freshModule()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('un valor persistido corrupto se descarta y cae al del sistema', async () => {
    stubSystemDark(false)
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ state: { theme: '<script>' }, version: 0 }))
    const { useThemeStore } = await freshModule()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('toggleTheme() alterna, escribe <html> y persiste bajo ehpc-theme', async () => {
    stubSystemDark(false)
    const { useThemeStore } = await freshModule()

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toContain('dark')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toContain('light')
  })

  it('setTheme() con el tema ya activo no reescribe el estado', async () => {
    stubSystemDark(false)
    const { useThemeStore } = await freshModule()
    const before = useThemeStore.getState()
    before.setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.themeTransition).toBeUndefined()
  })

  it('el cambio marca data-theme-transition y lo RETIRA al terminar la ventana', async () => {
    vi.useFakeTimers()
    stubSystemDark(false)
    const { useThemeStore } = await freshModule()

    useThemeStore.getState().toggleTheme()
    expect(document.documentElement.dataset.themeTransition).toBe('')

    vi.advanceTimersByTime(1000)
    expect(document.documentElement.dataset.themeTransition).toBeUndefined()
  })

  it('el eje de tema NO toca la variante (componen entre sí)', async () => {
    stubSystemDark(false)
    const { useThemeStore } = await freshModule()
    useThemeStore.getState().toggleTheme()
    expect(document.documentElement.dataset.variant).toBe('v2')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
