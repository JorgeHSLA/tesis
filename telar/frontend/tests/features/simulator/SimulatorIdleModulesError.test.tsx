// S7b · CU-05.1/06.2: si falla /modules, el editor y la subida siguen
// funcionando; solo el selector de ejemplos muestra el error.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { MODULES, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({ getModules: vi.fn(), getExample: vi.fn() }))
vi.mock('@/api/jobs', () => ({ createJob: vi.fn() }))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: SYSTEM_INFO, error: null, loading: false, retry: vi.fn() }),
}))

import { getModules } from '@/api/content'
import { createJob } from '@/api/jobs'
import { SimulatorIdle } from '@/features/simulator/SimulatorIdle'

function renderIdle() {
  const router = createMemoryRouter(
    [
      { path: '/simulador', element: <SimulatorIdle /> },
      { path: '/simulador/:jobId', element: <div>EN VIVO</div> },
    ],
    { initialEntries: ['/simulador'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getModules as Mock).mockRejectedValue(new Error('backend caído'))
  ;(createJob as Mock).mockResolvedValue({ job_id: 'j1', ws_url: '/ws/jobs/j1', threads_note: null, threads_effective: 4 })
})

describe('SimulatorIdle · /modules falla', () => {
  it('el editor propio sigue y se puede lanzar', async () => {
    renderIdle()
    const editor = await screen.findByRole('textbox', { name: 'Editor de código Python' })
    fireEvent.change(editor, { target: { value: 'print(1)\n' } })
    fireEvent.click(screen.getByRole('button', { name: /Lanzar ejecución/ }))
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1))
    expect((createJob as Mock).mock.calls[0][0].code).toBe('print(1)\n')
  })

  it('la subida de archivos sigue disponible', async () => {
    const { container } = renderIdle()
    await screen.findByRole('textbox', { name: 'Editor de código Python' })
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
  })

  it('solo el selector de ejemplos muestra el error, con reintento', async () => {
    renderIdle()
    expect(await screen.findByText(/No se pudieron cargar los ejemplos del curso/)).toBeInTheDocument()
    expect(screen.queryByText(/No se pudo cargar la configuración del simulador/)).toBeNull()
    ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.queryByText(/No se pudieron cargar los ejemplos/)).toBeNull())
    expect(getModules).toHaveBeenCalledTimes(2)
  })
})
