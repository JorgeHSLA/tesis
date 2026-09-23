// SimulatorIdle — Re-ejecutar (CU-04.1, 32.2, 32.3): el simulador recupera
// ejemplo, código, hilos y timeout de una ejecución histórica; avisa si el
// ejemplo cambió o ya no existe, y ajusta los hilos al máximo ANTES de lanzar.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ApiError } from '@/api/client'
import type { RerunState } from '@/lib/simConfig'
import { EXAMPLE_CONFIGURABLE, MODULES, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/system', () => ({ getSystem: vi.fn(), getHealth: vi.fn() }))
vi.mock('@/api/content', () => ({ getModules: vi.fn(), getExample: vi.fn() }))
vi.mock('@/api/jobs', () => ({ createJob: vi.fn() }))

import { getSystem } from '@/api/system'
import { getExample, getModules } from '@/api/content'
import { createJob } from '@/api/jobs'
import { loadSystemInfo } from '@/hooks/useSystemInfo'
import { SimulatorIdle } from '@/features/simulator/SimulatorIdle'

const getSystemMock = getSystem as Mock
const getExampleMock = getExample as Mock
const createJobMock = createJob as Mock

const JOB_CREATED = {
  job_id: 'newjob123',
  status: 'queued' as const,
  threads_effective: 4,
  threads_note: null,
  ws_url: '/ws/jobs/newjob123',
  href: '/api/v1/jobs/newjob123',
  created_at: '2026-07-12T15:04:05.123Z',
}

const RERUN: RerunState = {
  example_id: 'spmd',
  lesson_id: 'spmd',
  code: EXAMPLE_CONFIGURABLE.source_code,
  filename: 'piSpmd.py',
  threads: 6,
  timeout_s: 90,
  edited: false,
}

beforeEach(async () => {
  localStorage.clear()
  getSystemMock.mockReset().mockRejectedValue(new Error('reset'))
  await loadSystemInfo(true).catch(() => undefined)
  getSystemMock.mockReset().mockResolvedValue(SYSTEM_INFO)
  ;(getModules as Mock).mockReset().mockResolvedValue(MODULES)
  getExampleMock.mockReset().mockResolvedValue(EXAMPLE_CONFIGURABLE)
  createJobMock.mockReset().mockResolvedValue(JOB_CREATED)
})

function renderWith(state: RerunState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/simulador', state }]}>
      <SimulatorIdle />
    </MemoryRouter>,
  )
}

async function launch(): Promise<Record<string, unknown>> {
  await userEvent.click(await screen.findByRole('button', { name: /lanzar ejecución/i }))
  await waitFor(() => expect(createJobMock).toHaveBeenCalled())
  return createJobMock.mock.calls[0][0] as Record<string, unknown>
}

describe('Re-ejecutar recupera la ejecución histórica', () => {
  it('ejemplo sin cambios → carga el ejemplo y envía sus hilos y timeout', async () => {
    renderWith(RERUN)
    await waitFor(() => expect(getExampleMock).toHaveBeenCalledWith('spmd'))
    expect(await screen.findByText('6 hilos')).toBeInTheDocument()
    const arg = await launch()
    expect(arg.example_id).toBe('spmd')
    expect(arg).not.toHaveProperty('code')
    expect(arg.threads).toBe(6)
    expect(arg.timeout_s).toBe(90)
    expect(screen.queryByText(/el ejemplo cambió/i)).not.toBeInTheDocument()
  })

  it('ejemplo editado → conserva example_id (parser) y envía el código histórico', async () => {
    renderWith({ ...RERUN, code: 'print("editado")\n', edited: true })
    await screen.findByDisplayValue(/editado/)
    const arg = await launch()
    expect(arg.example_id).toBe('spmd')
    expect(arg.code).toBe('print("editado")\n')
    expect(screen.queryByText(/el ejemplo cambió/i)).not.toBeInTheDocument()
  })

  it('el ejemplo cambió desde esa ejecución → aviso y se usa el código histórico', async () => {
    renderWith({ ...RERUN, code: 'print("version vieja")\n' })
    expect(await screen.findByText(/el ejemplo cambió desde esa ejecución/i)).toBeInTheDocument()
    const arg = await launch()
    expect(arg.example_id).toBe('spmd')
    expect(arg.code).toBe('print("version vieja")\n')
  })

  it('el ejemplo ya no existe → código propio con aviso', async () => {
    getExampleMock.mockRejectedValue(new ApiError('EXAMPLE_NOT_FOUND', 'no existe', 404))
    renderWith({ ...RERUN, code: 'print("huérfano")\n' })
    expect(await screen.findByText(/ya no existe/i)).toBeInTheDocument()
    const arg = await launch()
    expect(arg).not.toHaveProperty('example_id')
    expect(arg.code).toBe('print("huérfano")\n')
    expect(arg.filename).toBe('piSpmd.py')
  })
})

describe('CU-32.3 — hilos nunca por encima de system.max_threads', () => {
  it('valor recuperado mayor que el máximo → se ajusta a la vista con aviso y se envía ese', async () => {
    renderWith({ ...RERUN, threads: 16 })
    expect(await screen.findByText(/16 hilos.*ajust/i)).toBeInTheDocument()
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('8')
    const arg = await launch()
    expect(arg.threads).toBe(8)
  })

  it('el valor por defecto se ajusta en silencio si el host tiene menos hilos', async () => {
    getSystemMock.mockResolvedValue({ ...SYSTEM_INFO, cores: 2, max_threads: 2 })
    render(
      <MemoryRouter initialEntries={['/simulador?ejemplo=spmd']}>
        <SimulatorIdle />
      </MemoryRouter>,
    )
    await screen.findByDisplayValue(/print\("hola"\)/)
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('2')
    const arg = await launch()
    expect(arg.threads).toBe(2)
  })
})
