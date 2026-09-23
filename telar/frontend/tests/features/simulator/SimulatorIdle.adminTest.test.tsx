// S2 · CU-22.2 — la prueba desde Autoría (?ejemplo=…&prueba=admin) ejecuta el
// ejemplo SIN lesson_id, así nunca toca el progreso de la lección.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { EXAMPLE_CONFIGURABLE, MODULES, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({ getModules: vi.fn(), getExample: vi.fn() }))
vi.mock('@/api/jobs', () => ({ createJob: vi.fn() }))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: SYSTEM_INFO, error: null, loading: false, retry: vi.fn() }),
}))

import { getExample, getModules } from '@/api/content'
import { createJob } from '@/api/jobs'
import { SimulatorIdle } from '@/features/simulator/SimulatorIdle'

const createJobMock = createJob as Mock
const EXAMPLE = { ...EXAMPLE_CONFIGURABLE, id: 'spmd', lesson_id: 'spmd' }

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/simulador', element: <SimulatorIdle /> },
      { path: '/simulador/:jobId', element: <div>EN VIVO</div> },
    ],
    { initialEntries: [path] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES))
  ;(getExample as Mock).mockResolvedValue(EXAMPLE)
  createJobMock.mockResolvedValue({ job_id: 'j1', ws_url: '/ws/jobs/j1', threads_note: null, threads_effective: 4 })
})

async function lanzar() {
  const btn = await screen.findByRole('button', { name: /Lanzar ejecución/ })
  await waitFor(() => expect(getExample).toHaveBeenCalled())
  await waitFor(() => expect(btn).toBeEnabled())
  fireEvent.click(btn)
  await waitFor(() => expect(createJobMock).toHaveBeenCalledTimes(1))
  return createJobMock.mock.calls[0][0]
}

describe('SimulatorIdle · lesson_id', () => {
  it('desde una lección envía el lesson_id del ejemplo', async () => {
    renderAt('/simulador?ejemplo=spmd')
    const req = await lanzar()
    expect(req.example_id).toBe('spmd')
    expect(req.lesson_id).toBe('spmd')
  })

  it('con &prueba=admin NO envía lesson_id', async () => {
    renderAt('/simulador?ejemplo=spmd&prueba=admin')
    const req = await lanzar()
    expect(req.example_id).toBe('spmd')
    expect(req).not.toHaveProperty('lesson_id')
  })
})
