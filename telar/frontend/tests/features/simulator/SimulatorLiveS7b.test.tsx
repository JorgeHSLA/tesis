// S7b · la vista en vivo: Detener sin conexión (08.5), «Cancelando…» y aviso
// de fallo (08.2), hueco de salida (07.3) y tabla de hilos honesta (07.5).
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { jobDetail, SYSTEM_INFO } from '../../fixtures/rest'
import { logMsg, statusMsg } from '../../fixtures/ws'
import { FakeWebSocket } from '../../setup'

vi.mock('@/api/jobs', () => ({ getJob: vi.fn(), cancelJob: vi.fn() }))
vi.mock('@/api/content', () => ({ getExample: vi.fn() }))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: SYSTEM_INFO, error: null, loading: false, retry: vi.fn() }),
}))

import { cancelJob, getJob } from '@/api/jobs'
import { getExample } from '@/api/content'
import { SimulatorLive } from '@/features/simulator/SimulatorLive'
import { useJobStore } from '@/stores/jobStore'

const JOB = jobDetail({ status: 'running', example_id: null, lesson_id: null, threads: 4, finished_at: null })

function renderLive() {
  return render(
    <MemoryRouter initialEntries={[`/simulador/${JOB.job_id}`]}>
      <Routes>
        <Route path="/simulador/:jobId" element={<SimulatorLive jobId={JOB.job_id} />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openRunning(): Promise<FakeWebSocket> {
  renderLive()
  const ws = FakeWebSocket.last!
  act(() => {
    ws.open()
    ws.emit(statusMsg('running'))
  })
  await waitFor(() => expect(getJob).toHaveBeenCalled())
  return ws
}

beforeEach(() => {
  FakeWebSocket.reset()
  useJobStore.getState().reset()
  vi.clearAllMocks()
  ;(getJob as Mock).mockResolvedValue(JOB)
  ;(getExample as Mock).mockResolvedValue(null)
  vi.stubGlobal('requestAnimationFrame', undefined)
  vi.stubGlobal('cancelAnimationFrame', undefined)
})

describe('Detener', () => {
  it('queda deshabilitado con la conexión perdida', async () => {
    const ws = await openRunning()
    act(() => ws.serverClose(1006))
    expect(await screen.findByText(/Conexión perdida con el backend/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Detener/ })).toBeDisabled()
  })

  it('al confirmar muestra «Cancelando…» deshabilitado', async () => {
    const ws = await openRunning()
    fireEvent.click(screen.getByRole('button', { name: /Detener/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sí, detener/ }))
    expect(ws.sent).toEqual(['{"type":"cancel"}'])
    expect(await screen.findByRole('button', { name: /Cancelando…/ })).toBeDisabled()
  })

  it('si la cancelación no se pudo pedir avisa y permite reintentar', async () => {
    ;(cancelJob as Mock).mockRejectedValue(new Error('red caída'))
    renderLive() // socket sin abrir → REST
    await waitFor(() => expect(getJob).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Detener/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sí, detener/ }))
    const alert = await screen.findByText(/No fue posible solicitar la cancelación/)
    expect(alert).toHaveTextContent('La ejecución puede continuar activa.')
    expect(screen.getByRole('button', { name: /Detener/ })).toBeEnabled()
  })
})

describe('salida', () => {
  it('avisa si parte de la salida no se pudo recuperar', async () => {
    const ws = await openRunning()
    act(() => ws.emit(logMsg(40, ['línea tardía'])))
    expect(await screen.findByText(/Parte de la salida no se pudo recuperar/)).toBeInTheDocument()
  })
})

describe('Detalle por hilo', () => {
  it('pinta N filas (t0 = maestro) y marca el estado como ilustrativo', async () => {
    await openRunning()
    const table = await screen.findByRole('table', { name: 'Detalle por hilo' })
    await waitFor(() => expect(within(table).getAllByRole('row').slice(1)).toHaveLength(4))
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('t0')).toBeInTheDocument()
    expect(within(rows[0]).getByText('hilo maestro')).toBeInTheDocument()
    expect(within(table).queryByText('master')).toBeNull()
    expect(screen.getByText('actividad y estado ilustrativos')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Estado\s*ilustrativo/ })).toBeInTheDocument()
  })
})
