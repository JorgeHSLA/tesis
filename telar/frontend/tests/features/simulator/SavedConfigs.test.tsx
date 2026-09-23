// «Mis configuraciones» en el simulador (CU-32.1): guardar sin ejecutar,
// cargar, renombrar y borrar, todo en localStorage. Cargar y luego editar no
// modifica la configuración guardada.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { listSavedConfigs, saveConfig } from '@/lib/savedConfigs'
import { EXAMPLE_CONFIGURABLE, MODULES, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/system', () => ({ getSystem: vi.fn(), getHealth: vi.fn() }))
vi.mock('@/api/content', () => ({ getModules: vi.fn(), getExample: vi.fn() }))
vi.mock('@/api/jobs', () => ({ createJob: vi.fn() }))

import { getSystem } from '@/api/system'
import { getExample, getModules } from '@/api/content'
import { createJob } from '@/api/jobs'
import { loadSystemInfo } from '@/hooks/useSystemInfo'
import { SimulatorIdle } from '@/features/simulator/SimulatorIdle'

const createJobMock = createJob as Mock

beforeEach(async () => {
  localStorage.clear()
  ;(getSystem as Mock).mockReset().mockRejectedValue(new Error('reset'))
  await loadSystemInfo(true).catch(() => undefined)
  ;(getSystem as Mock).mockReset().mockResolvedValue(SYSTEM_INFO)
  ;(getModules as Mock).mockReset().mockResolvedValue(MODULES)
  ;(getExample as Mock).mockReset().mockResolvedValue(EXAMPLE_CONFIGURABLE)
  createJobMock.mockReset().mockResolvedValue({
    job_id: 'j1',
    status: 'queued',
    threads_effective: 2,
    threads_note: null,
    ws_url: '/ws/jobs/j1',
    href: '/api/v1/jobs/j1',
    created_at: '2026-07-12T15:04:05.123Z',
  })
})
afterEach(() => vi.restoreAllMocks())

function renderSim() {
  return render(
    <MemoryRouter initialEntries={['/simulador?ejemplo=spmd']}>
      <SimulatorIdle />
    </MemoryRouter>,
  )
}

function card() {
  return screen.getByRole('region', { name: /mis configuraciones/i })
}

describe('guardar sin ejecutar', () => {
  it('guarda nombre, código, archivo, hilos, timeout y ejemplo', async () => {
    renderSim()
    await screen.findByDisplayValue(/print\("hola"\)/)
    await userEvent.type(within(card()).getByLabelText(/nombre/i), 'Prueba 1')
    await userEvent.click(within(card()).getByRole('button', { name: /guardar configuración/i }))
    expect(within(card()).getByText('Prueba 1')).toBeInTheDocument()
    expect(listSavedConfigs()[0]).toMatchObject({
      name: 'Prueba 1',
      example_id: 'spmd',
      code: EXAMPLE_CONFIGURABLE.source_code,
      filename: 'piSpmd.py',
      threads: 4,
      timeout_s: 60,
      edited: false,
    })
    expect(createJobMock).not.toHaveBeenCalled()
  })

  it('si el almacenamiento falla, muestra el error', async () => {
    renderSim()
    await screen.findByDisplayValue(/print\("hola"\)/)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    await userEvent.click(within(card()).getByRole('button', { name: /guardar configuración/i }))
    expect(within(card()).getByRole('alert')).toHaveTextContent(/no se pudo guardar/i)
  })
})

describe('cargar, renombrar y borrar', () => {
  const SAVED = {
    name: 'Mía',
    example_id: null,
    code: 'print("guardado")\n',
    filename: 'mio.py',
    threads: 2,
    timeout_s: 90,
    edited: false,
  }

  it('cargar pone la configuración y lanzar envía sus valores', async () => {
    saveConfig(SAVED)
    renderSim()
    await screen.findByDisplayValue(/print\("hola"\)/)
    await userEvent.click(within(card()).getByRole('button', { name: /cargar mía/i }))
    await screen.findByDisplayValue(/guardado/)
    await userEvent.click(screen.getByRole('button', { name: /lanzar ejecución/i }))
    await waitFor(() => expect(createJobMock).toHaveBeenCalled())
    const arg = createJobMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).toMatchObject({ code: SAVED.code, filename: 'mio.py', threads: 2, timeout_s: 90 })
    expect(arg).not.toHaveProperty('example_id')
  })

  it('cargar y luego editar no modifica la configuración guardada', async () => {
    saveConfig(SAVED)
    renderSim()
    await screen.findByDisplayValue(/print\("hola"\)/)
    await userEvent.click(within(card()).getByRole('button', { name: /cargar mía/i }))
    const editor = await screen.findByDisplayValue(/guardado/)
    await userEvent.type(editor, '# cambio')
    expect(listSavedConfigs()[0].code).toBe(SAVED.code)
  })

  it('renombrar y borrar', async () => {
    saveConfig(SAVED)
    renderSim()
    await screen.findByDisplayValue(/print\("hola"\)/)
    await userEvent.click(within(card()).getByRole('button', { name: /renombrar mía/i }))
    const input = within(card()).getByLabelText(/nuevo nombre/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'Renombrada{Enter}')
    expect(within(card()).getByText('Renombrada')).toBeInTheDocument()
    expect(listSavedConfigs()[0].name).toBe('Renombrada')

    await userEvent.click(within(card()).getByRole('button', { name: /borrar renombrada/i }))
    expect(within(card()).queryByText('Renombrada')).not.toBeInTheDocument()
    expect(listSavedConfigs()).toEqual([])
  })
})
