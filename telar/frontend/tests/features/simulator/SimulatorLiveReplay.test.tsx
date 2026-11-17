// La vista en vivo: «Re-ejecutar este ejemplo» en la cabecera y el reproductor de
// la ejecución. Primero corre de verdad; solo al terminar se puede retroceder,
// y retroceder NO cambia lo medido: vuelve a mostrar lo que ya había llegado.
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { jobDetail, SYSTEM_INFO } from '../../fixtures/rest'
import { COMPLETED_DETAIL, logMsg, metricsMsg, statusMsg } from '../../fixtures/ws'
import { FakeWebSocket } from '../../setup'

vi.mock('@/api/jobs', () => ({ getJob: vi.fn(), cancelJob: vi.fn(), createJob: vi.fn() }))
vi.mock('@/api/content', () => ({ getExample: vi.fn() }))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: SYSTEM_INFO, error: null, loading: false, retry: vi.fn() }),
}))

import { createJob, getJob } from '@/api/jobs'
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

/** El «en vivo» que importa es el de la barra del reproductor (hay otros textos parecidos en la pantalla). */
const replayBar = () => within(screen.getByRole('region', { name: 'Reproductor de la ejecución' }))

const finish = (ws: FakeWebSocket) =>
  act(() => {
    ws.emit(logMsg(1, ['Hola desde el hilo 0']))
    ws.emit(metricsMsg())
    ws.emit(statusMsg('completed', COMPLETED_DETAIL))
  })

describe('«Re-ejecutar» en la cabecera', () => {
  it('está a la izquierda de «Ver resultados» y espera a que el job termine', async () => {
    const ws = await openRunning()
    const rerun = screen.getByRole('button', { name: 'Re-ejecutar' })
    const results = screen.getByRole('button', { name: /Ver resultados/ })
    expect(rerun).toBeDisabled()
    // Orden en el DOM: Re-ejecutar ANTES de Ver resultados.
    expect(rerun.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    finish(ws)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-ejecutar' })).toBeEnabled())
  })

  it('al pulsarlo lanza el job nuevo con los mismos datos y va a su pantalla', async () => {
    ;(createJob as Mock).mockResolvedValue({ job_id: 'nuevo-1', ws_url: '/ws/jobs/nuevo-1', threads_effective: 4, threads_note: null })
    const ws = await openRunning()
    finish(ws)
    const rerun = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'Re-ejecutar' })
      expect(b).toBeEnabled()
      return b
    })
    fireEvent.click(rerun)
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1))
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ code: JOB.source_code, threads: 4 }))
  })

  it('el deslizante de hilos queda solo: ya no tiene su propio botón de ejecutar', async () => {
    const ws = await openRunning()
    finish(ws)
    expect(await screen.findByRole('slider', { name: /Probar con otros hilos|Hilos/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ejecutar con \d+ hilos?/ })).toBeNull()
  })
})

describe('Reproductor de la ejecución', () => {
  it('mientras corre: «en vivo», línea de tiempo bloqueada; la velocidad sí se controla', async () => {
    await openRunning()
    expect(replayBar().getByText(/en vivo/)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Momento de la ejecución' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Velocidad de la ilustración' })).toBeEnabled()
  })

  it('al terminar se desbloquea y queda AL FINAL, mostrando todo lo real', async () => {
    const ws = await openRunning()
    finish(ws)
    const timeline = await waitFor(() => {
      const s = screen.getByRole('slider', { name: 'Momento de la ejecución' })
      expect(s).toBeEnabled()
      return s
    })
    expect(replayBar().queryByText(/en vivo/)).toBeNull()
    expect(timeline).toHaveValue(timeline.getAttribute('max'))
    expect(screen.getByText('Hola desde el hilo 0')).toBeInTheDocument()
    expect(screen.getByText('792%')).toBeInTheDocument() // CPU real de la muestra
  })

  it('volver al principio muestra el estado de entonces; volver al final, el real otra vez', async () => {
    const ws = await openRunning()
    finish(ws)
    const timeline = await waitFor(() => {
      const s = screen.getByRole('slider', { name: 'Momento de la ejecución' })
      expect(s).toBeEnabled()
      return s
    })
    const end = timeline.getAttribute('max') as string

    fireEvent.change(timeline, { target: { value: '0' } })
    // La muestra de CPU llegó después del instante 0: todavía no se ve.
    expect(screen.queryByText('792%')).toBeNull()

    fireEvent.change(timeline, { target: { value: end } })
    expect(screen.getByText('792%')).toBeInTheDocument()
    expect(screen.getByText('Hola desde el hilo 0')).toBeInTheDocument()
  })

  it('retroceder no toca ninguna medida real del job (solo lo que se muestra)', async () => {
    const ws = await openRunning()
    finish(ws)
    const timeline = await waitFor(() => {
      const s = screen.getByRole('slider', { name: 'Momento de la ejecución' })
      expect(s).toBeEnabled()
      return s
    })
    const before = JSON.stringify({
      logs: useJobStore.getState().logs,
      metrics: useJobStore.getState().metrics,
      wall: useJobStore.getState().wallTimeMs,
    })
    fireEvent.change(timeline, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ir al principio' }))
    const after = JSON.stringify({
      logs: useJobStore.getState().logs,
      metrics: useJobStore.getState().metrics,
      wall: useJobStore.getState().wallTimeMs,
    })
    expect(after).toBe(before)
  })
})
