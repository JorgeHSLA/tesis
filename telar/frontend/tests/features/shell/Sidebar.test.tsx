// Sidebar con un backend MÁS VIEJO que el frontend (hallazgo del 22-09 en
// Electron): un /system sin el bloque `catalog` tumbaba TODA la app con
// «Cannot read properties of undefined (reading 'enabled')».
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/system', () => ({
  getSystem: vi.fn(),
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', checks: { db: true, docker: true, runner_image: true } }),
}))

import { getSystem } from '@/api/system'
import { Sidebar } from '@/components/shell/Sidebar'
import { loadSystemInfo } from '@/hooks/useSystemInfo'

afterEach(() => {
  vi.clearAllMocks()
})

describe('Sidebar con un /system sin catalog', () => {
  it('renderiza el rail sin «Módulos disponibles»', async () => {
    const { catalog: _omit, ...viejo } = SYSTEM_INFO
    ;(getSystem as ReturnType<typeof vi.fn>).mockResolvedValue(viejo)
    await loadSystemInfo(true)

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    await waitFor(() => expect(getSystem).toHaveBeenCalled())
    expect(await screen.findByRole('link', { name: 'Inicio' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Módulos disponibles' })).toBeNull()
  })
})

function CurrentRoute() {
  return <output aria-label="Ruta actual">{useLocation().pathname}</output>
}

describe('Sidebar expandible', () => {
  async function renderSidebar() {
    ;(getSystem as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...SYSTEM_INFO,
      catalog: { enabled: true },
    })
    await loadSystemInfo(true)
    const view = render(
      <MemoryRouter initialEntries={['/aprender']}>
        <Sidebar />
        <CurrentRoute />
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: 'Módulos disponibles' })
    return view
  }

  it('inicia contraído, alterna sin navegar y conserva la sección activa', async () => {
    await renderSidebar()
    const toggle = screen.getByRole('button', { name: 'Expandir menú' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', screen.getByRole('navigation').id)

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Contraer menú' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/aprender')
    expect(screen.getByRole('link', { name: 'Aprender' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(toggle)
    expect(toggle).toHaveAccessibleName('Expandir menú')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/aprender')
  })

  it('mantiene el orden, los destinos y el enlace activo en ambos estados', async () => {
    await renderSidebar()
    const destinations = [
      ['Inicio', '/'],
      ['Simulador', '/simulador'],
      ['Resultados', '/resultados'],
      ['Aprender', '/aprender'],
      ['Módulos disponibles', '/modulos'],
    ]
    const nav = within(screen.getByRole('navigation'))
    for (const expanded of [false, true]) {
      if (expanded) fireEvent.click(screen.getByRole('button', { name: 'Expandir menú' }))
      expect(nav.getAllByRole('link').map((link) => link.getAttribute('aria-label')))
        .toEqual(destinations.map(([label]) => label))
      for (const [label, path] of destinations) {
        const link = nav.getByRole('link', { name: label })
        fireEvent.click(link)
        expect(screen.getByLabelText('Ruta actual').textContent).toBe(path)
        expect(link).toHaveAttribute('aria-current', 'page')
        expect(link).toHaveClass('active')
      }
    }
  })
})
