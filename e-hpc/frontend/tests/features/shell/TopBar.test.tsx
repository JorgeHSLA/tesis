// TopBar — los dos botones de la derecha DEJARON DE SER MAQUETA (2026-07-26).
// Se verifica que cada uno lleva a algo real y que no queda ningún control
// del shell sin handler.
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TopBar, type CatalogNavState } from '@/components/shell/TopBar'
import { APP_VERSION } from '@/config'

/** Espía de ruta: publica pathname y state para poder asertarlos. */
function RouteProbe() {
  const { pathname, state } = useLocation()
  return (
    <div>
      <span data-testid="pathname">{pathname}</span>
      <span data-testid="focus-search">{String((state as CatalogNavState | null)?.focusSearch ?? false)}</span>
    </div>
  )
}

function renderTopBar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TopBar />
      <Routes>
        <Route path="*" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TopBar', () => {
  it('«Buscar» navega al catálogo pidiendo el foco de su buscador', () => {
    renderTopBar('/')
    expect(screen.getByTestId('pathname')).toHaveTextContent('/')

    fireEvent.click(screen.getByRole('button', { name: /Buscar/i }))

    expect(screen.getByTestId('pathname')).toHaveTextContent('/cursos')
    expect(screen.getByTestId('focus-search')).toHaveTextContent('true')
  })

  it('el botón de ayuda abre el diálogo «Acerca de» y lo cierra', () => {
    renderTopBar('/')
    const help = screen.getByRole('button', { name: 'Acerca de E-HPC' })
    expect(help).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(help)
    const dialog = screen.getByRole('dialog', { name: 'Acerca de E-HPC' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el diálogo se cierra con Escape', () => {
    renderTopBar('/')
    fireEvent.click(screen.getByRole('button', { name: 'Acerca de E-HPC' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el «Acerca de» muestra versión y NO enlaza a ningún destino de red', () => {
    renderTopBar('/')
    fireEvent.click(screen.getByRole('button', { name: 'Acerca de E-HPC' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Versión/)
    expect(dialog).toHaveTextContent(APP_VERSION)
    // El define de vite/vitest tiene que estar puesto: si falta, APP_VERSION
    // cae al valor de emergencia y eso significa build mal configurado.
    expect(APP_VERSION).not.toBe('0.0.0-dev')
    // Requisito OFFLINE: ningún <a href> con esquema http(s) en el diálogo.
    for (const a of dialog.querySelectorAll('a[href]')) {
      expect(a.getAttribute('href')).not.toMatch(/^https?:/i)
    }
  })

  it('ningún botón del TopBar se queda sin handler (cero maqueta)', () => {
    const { container } = renderTopBar('/')
    const buttons = container.querySelectorAll<HTMLButtonElement>('header.topbar > button')
    expect(buttons.length).toBe(2)
    for (const btn of buttons) {
      expect(btn).toBeEnabled()
      expect(btn).toHaveAccessibleName()
    }
  })
})
