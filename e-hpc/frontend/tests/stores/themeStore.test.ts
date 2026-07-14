// Suite 5 (frontend-spec §10): stores/themeStore.test.ts
// Theming unificado (decisión §5.1): default v1; setVariant escribe
// data-variant en <html> y localStorage 'ehpc-variant'; hidratación persistida.
import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '@/stores/themeStore'

beforeEach(() => {
  localStorage.clear()
  useThemeStore.setState({ variant: 'v1' })
  delete document.documentElement.dataset.variant
})

describe('themeStore', () => {
  it('el valor por defecto es v1', () => {
    expect(useThemeStore.getState().variant).toBe('v1')
  })

  it('setVariant(v2) escribe data-variant en <html> y persiste', () => {
    useThemeStore.getState().setVariant('v2')
    expect(useThemeStore.getState().variant).toBe('v2')
    expect(document.documentElement.dataset.variant).toBe('v2')
    const raw = localStorage.getItem('ehpc-variant')
    expect(JSON.parse(raw as string).state.variant).toBe('v2')
  })

  it('setVariant(v1) revierte data-variant a v1', () => {
    useThemeStore.getState().setVariant('v2')
    useThemeStore.getState().setVariant('v1')
    expect(document.documentElement.dataset.variant).toBe('v1')
  })

  it('rehidrata desde un valor persistido aplicando la variante', async () => {
    localStorage.setItem('ehpc-variant', JSON.stringify({ state: { variant: 'v2' }, version: 0 }))
    await useThemeStore.persist.rehydrate()
    expect(useThemeStore.getState().variant).toBe('v2')
    expect(document.documentElement.dataset.variant).toBe('v2')
  })
})
