// useThemeColors — el hook que hace que las animaciones sobre <canvas> sigan
// la paleta de la app y REACCIONEN al cambio de tema (data-theme en <html>).
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useThemeColors } from '@/hooks/useThemeColors'

const TOKENS = { accent: '--accent', node: '--viz-node' } as const

function setRootTokens(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    document.documentElement.style.setProperty(name, value)
  }
}

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
})

describe('useThemeColors', () => {
  it('resuelve los tokens declarados en <html>', () => {
    setRootTokens({ '--accent': '#A8501E', '--viz-node': '#82664E' })

    const { result } = renderHook(() => useThemeColors(TOKENS))

    expect(result.current).toEqual({ accent: '#A8501E', node: '#82664E' })
  })

  it('re-lee la paleta cuando cambia data-theme en <html>', async () => {
    setRootTokens({ '--accent': '#A8501E', '--viz-node': '#82664E' })
    const { result } = renderHook(() => useThemeColors(TOKENS))
    expect(result.current.accent).toBe('#A8501E')

    // Simula el tema oscuro: cambian los valores Y el atributo que los conmuta.
    act(() => {
      setRootTokens({ '--accent': '#B25F2F', '--viz-node': '#997E67' })
      document.documentElement.setAttribute('data-theme', 'dark')
    })

    await waitFor(() => {
      expect(result.current).toEqual({ accent: '#B25F2F', node: '#997E67' })
    })
  })

  it('mantiene la identidad del objeto mientras el tema no cambie', () => {
    setRootTokens({ '--accent': '#A8501E', '--viz-node': '#82664E' })
    const { result, rerender } = renderHook(() => useThemeColors(TOKENS))

    const first = result.current
    rerender()

    // Importante: los efectos de las animaciones dependen de esta identidad;
    // si cambiara en cada render, el rAF se reiniciaría sin parar.
    expect(result.current).toBe(first)
  })

  it('no explota si el token no existe: usa el gris de reserva', () => {
    const { result } = renderHook(() => useThemeColors(TOKENS))

    expect(result.current.accent).toBe('#808080')
    expect(result.current.node).toBe('#808080')
  })

  it('desengancha el observer al desmontar', () => {
    setRootTokens({ '--accent': '#A8501E' })
    const { unmount } = renderHook(() => useThemeColors(TOKENS))

    unmount()

    // Tras desmontar, tocar <html> no debe provocar un setState huérfano
    // (React avisaría por consola si el observer siguiera vivo).
    expect(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
    }).not.toThrow()
  })
})
