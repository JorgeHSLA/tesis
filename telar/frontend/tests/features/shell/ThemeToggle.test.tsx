// ThemeToggle — conmutador luna ⇄ sol del rail.
// Comprueba el contrato visible: icono correcto por tema, aria-pressed que
// refleja "modo oscuro activo", etiqueta que nombra la ACCIÓN, y el efecto
// real sobre <html data-theme>.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { useThemeStore } from '@/stores/themeStore'

beforeEach(() => {
  localStorage.clear()
  useThemeStore.setState({ theme: 'light' })
  document.documentElement.dataset.theme = 'light'
})

describe('ThemeToggle', () => {
  it('en claro ofrece pasar a oscuro (luna) y no está pulsado', () => {
    render(<ThemeToggle />)
    const btn = screen.getByRole('button', { name: 'Cambiar a modo oscuro' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    // La luna es un único <path>; el sol añade el círculo del disco.
    expect(btn.querySelector('circle')).toBeNull()
  })

  it('al pulsarlo pasa a oscuro: <html data-theme="dark"], icono sol y aria-pressed', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a modo oscuro' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    const btn = screen.getByRole('button', { name: 'Cambiar a modo claro' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn.querySelector('circle')).not.toBeNull()
  })

  it('vuelve a claro en la segunda pulsación', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a modo oscuro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a modo claro' }))

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('button', { name: 'Cambiar a modo oscuro' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('el estado sobrevive a un remontaje (viene del store persistido)', () => {
    const { unmount } = render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a modo oscuro' }))
    unmount()

    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Cambiar a modo claro' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('telar-theme')).toContain('dark')
  })
})
