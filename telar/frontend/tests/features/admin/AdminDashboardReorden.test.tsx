// CU-15.1 — reorden de módulos serializado: mientras un guardado está en vuelo
// «Subir»/«Bajar» se deshabilitan (un segundo clic no lanza otro PUT que
// compita), y el resultado sale de la respuesta del PUT, sin GET extra.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/content', () => ({ getModules: vi.fn() }))
vi.mock('@/api/admin', () => ({
  reorderModules: vi.fn(),
  getPublishStatus: vi.fn(),
  deleteModule: vi.fn(),
  unpublishModule: vi.fn(),
}))

import { getModules } from '@/api/content'
import { getPublishStatus, reorderModules } from '@/api/admin'
import AdminDashboard from '@/features/admin/AdminDashboard'

const modulo = (id: string, order: number) => ({
  id, order, title: `Módulo ${id}`, description: '', level: 'Intro',
  version: 1, origin: 'local', update_available: null, lessons: [],
})

function pendiente<T>() {
  let resolver!: (v: T) => void
  let rechazar!: (e: unknown) => void
  const promesa = new Promise<T>((r, j) => {
    resolver = r
    rechazar = j
  })
  return { promesa, resolver, rechazar }
}

function renderDashboard() {
  const router = createMemoryRouter([{ path: '/admin', element: <AdminDashboard /> }], {
    initialEntries: ['/admin'],
  })
  render(<RouterProvider router={router} />)
}

const titulos = () =>
  screen.getAllByText(/^Módulo [ABC]$/, { selector: '.admin-module-title' }).map((el) => el.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  ;(getModules as Mock).mockResolvedValue({ modules: [modulo('A', 1), modulo('B', 2), modulo('C', 3)] })
  ;(getPublishStatus as Mock).mockRejectedValue(new Error('sin red'))
})

describe('AdminDashboard · reorden de módulos (CU-15.1)', () => {
  it('con un guardado en vuelo los botones se deshabilitan y no sale otro PUT', async () => {
    const vuelo = pendiente<unknown>()
    ;(reorderModules as Mock).mockReturnValue(vuelo.promesa)
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Bajar el módulo Módulo A' }))
    expect(reorderModules).toHaveBeenCalledTimes(1)

    const mover = screen.getAllByRole('button', { name: /^(Subir|Bajar) el módulo/ })
    for (const b of mover) expect(b).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Bajar el módulo Módulo C' }))
    expect(reorderModules).toHaveBeenCalledTimes(1)

    await act(async () => {
      vuelo.resolver({ modules: [
        { ...modulo('B', 1), lessons: [] },
        { ...modulo('A', 2), lessons: [] },
        { ...modulo('C', 3), lessons: [] },
      ] })
      await vuelo.promesa
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bajar el módulo Módulo C' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Bajar el módulo Módulo A' })).toBeEnabled()
  })

  it('usa la respuesta del PUT: no vuelve a pedir GET /modules', async () => {
    ;(reorderModules as Mock).mockResolvedValue({ modules: [modulo('B', 1), modulo('A', 2), modulo('C', 3)] })
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Bajar el módulo Módulo A' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bajar el módulo Módulo A' })).toBeEnabled())
    expect(titulos()).toEqual(['Módulo B', 'Módulo A', 'Módulo C'])
    expect(getModules).toHaveBeenCalledTimes(1)
    const grupoA = screen.getByText('Módulo A', { selector: '.admin-module-title' }).closest('section') as HTMLElement
    expect(within(grupoA).getByText('#2')).toBeInTheDocument()
  })

  it('si el PUT falla, vuelve al orden anterior y reactiva los botones', async () => {
    ;(reorderModules as Mock).mockRejectedValue(new Error('caído'))
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Bajar el módulo Módulo A' }))
    expect(await screen.findByText('No se pudieron reordenar los módulos.')).toBeInTheDocument()
    expect(titulos()).toEqual(['Módulo A', 'Módulo B', 'Módulo C'])
    expect(screen.getByRole('button', { name: 'Bajar el módulo Módulo A' })).toBeEnabled()
  })
})
