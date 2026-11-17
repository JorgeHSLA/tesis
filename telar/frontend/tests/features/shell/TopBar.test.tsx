// TopBar — los dos botones de la derecha DEJARON DE SER MAQUETA (2026-07-26).
// Se verifica que cada uno lleva a algo real y que no queda ningún control
// del shell sin handler.
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// El buscador global pide sus datos al abrir: aquí no importa qué haya.
vi.mock('@/api/content', () => ({
  getModules: vi.fn().mockResolvedValue({ modules: [], summary: {} }),
  loadExamplesIndex: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/api/jobs', () => ({ listJobs: vi.fn().mockResolvedValue({ jobs: [], meta: null }) }))
vi.mock('@/api/catalog', () => ({ getRemoteCatalog: vi.fn().mockResolvedValue({ modules: [] }) }))
vi.mock('@/api/system', () => ({
  getSystem: vi.fn().mockResolvedValue({ cores: 8, catalog: { enabled: false } }),
  getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}))
import { TopBar, historyAvailability, type CatalogNavState } from '@/components/shell/TopBar'
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
  it('«Buscar» abre el buscador global (no navega) y Escape lo cierra devolviendo el foco', () => {
    renderTopBar('/')
    const button = screen.getByRole('button', { name: /Buscar/i })
    fireEvent.click(button)

    expect(screen.getByRole('dialog', { name: 'Buscar en Telar' })).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/') // sigue donde estaba

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Buscar en Telar' })).toBeNull()
    expect(button).toHaveFocus()
  })

  it('Ctrl+K abre el buscador desde cualquier pantalla', () => {
    renderTopBar('/resultados')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Buscar en Telar' })).toBeInTheDocument()
  })

  it('el botón de ayuda abre el diálogo «Acerca de» y lo cierra', () => {
    renderTopBar('/')
    const help = screen.getByRole('button', { name: 'Acerca de Telar' })
    expect(help).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(help)
    const dialog = screen.getByRole('dialog', { name: 'Acerca de Telar' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el diálogo se cierra con Escape', () => {
    renderTopBar('/')
    fireEvent.click(screen.getByRole('button', { name: 'Acerca de Telar' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('el «Acerca de» muestra versión y NO enlaza a ningún destino de red', () => {
    renderTopBar('/')
    fireEvent.click(screen.getByRole('button', { name: 'Acerca de Telar' }))

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

describe('historyAvailability', () => {
  it('atrás desde la segunda entrada; adelante solo si ya se llegó más lejos', () => {
    expect(historyAvailability(0, 0)).toEqual({ canBack: false, canForward: false })
    expect(historyAvailability(2, 2)).toEqual({ canBack: true, canForward: false })
    expect(historyAvailability(1, 3)).toEqual({ canBack: true, canForward: true })
    expect(historyAvailability(0, 3)).toEqual({ canBack: false, canForward: true })
  })
})

describe('TopBar · flechas de historial', () => {
  const setHistory = (idx: number, _length = 0) => {
    vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx })
  }
  afterEach(() => vi.restoreAllMocks())

  function renderAt(entries: string[], index: number) {
    return render(
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <TopBar />
        <Routes>
          <Route path="*" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('hay dos flechas con nombre accesible, antes de las migas de pan', () => {
    renderAt(['/'], 0)
    const group = screen.getByRole('group', { name: 'Navegación del historial' })
    expect(within(group).getByRole('button', { name: 'Volver a la pantalla anterior' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Avanzar a la pantalla siguiente' })).toBeInTheDocument()
    const crumb = document.querySelector('.topbar-crumb') as Element
    expect(group.compareDocumentPosition(crumb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('en la primera pantalla no hay a dónde volver ni avanzar', () => {
    setHistory(0, 1)
    renderAt(['/'], 0)
    expect(screen.getByRole('button', { name: 'Volver a la pantalla anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Avanzar a la pantalla siguiente' })).toBeDisabled()
  })

  it('con pantallas anteriores se puede volver, pero adelante sigue apagado hasta volver atrás', () => {
    setHistory(2)
    renderAt(['/', '/simulador', '/resultados'], 2)
    expect(screen.getByRole('button', { name: 'Volver a la pantalla anterior' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Avanzar a la pantalla siguiente' })).toBeDisabled()
  })

  it('volver navega de verdad hacia atrás', () => {
    setHistory(1)
    renderAt(['/', '/simulador', '/resultados'], 1)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/simulador')
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la pantalla anterior' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/)
  })
})
