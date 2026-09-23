// Comparar ejecuciones (CU-30.1–30.4): selección múltiple en el historial,
// reglas de comparabilidad, tabla + gráfica wall time vs. hilos, enlaces al
// detalle y ErrorState por job con «Reintentar» / «Quitar de la comparación».
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ApiError } from '@/api/client'
import type { JobDetailDto, JobSummaryDto } from '@/api/types'
import { JOB_BARE, JOB_PAIR, jobDetail } from '../../fixtures/rest'

vi.mock('@/api/jobs', () => ({ getJob: vi.fn(), listJobs: vi.fn() }))

import { getJob, listJobs } from '@/api/jobs'
import ResultsCompare from '@/features/results/ResultsCompare'
import ResultsList from '@/features/results/ResultsList'

const getJobMock = getJob as Mock

const A = jobDetail({ job_id: 'aaaaaaaa1111', threads: 1, wall_time_ms: 4000 })
const B = jobDetail({ job_id: 'bbbbbbbb2222', threads: 4, wall_time_ms: 1500, metrics_summary: null })
const C = jobDetail({ job_id: 'cccccccc3333', threads: 8, wall_time_ms: null, parsed_timings: null })
const BY_ID: Record<string, JobDetailDto> = { [A.job_id]: A, [B.job_id]: B, [C.job_id]: C }

function Probe() {
  const location = useLocation()
  return <div data-testid="loc">{location.pathname + location.search}</div>
}

function renderCompare(ids: string[]) {
  return render(
    <MemoryRouter initialEntries={[`/resultados/comparar?ids=${ids.join(',')}`]}>
      <Routes>
        <Route
          path="/resultados/comparar"
          element={
            <>
              <ResultsCompare />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getJobMock.mockReset().mockImplementation((id: string) =>
    BY_ID[id] != null ? Promise.resolve(BY_ID[id]) : Promise.reject(new ApiError('JOB_NOT_FOUND', 'no', 404)),
  )
})

describe('selección en el historial (CU-30.1)', () => {
  const summary = (j: JobDetailDto): JobSummaryDto => ({
    job_id: j.job_id,
    filename: j.filename,
    source_kind: j.source_kind,
    example_id: j.example_id,
    lesson_id: j.lesson_id,
    status: j.status,
    exit_code: j.exit_code,
    threads: j.threads,
    wall_time_ms: j.wall_time_ms,
    created_at: j.created_at,
    finished_at: j.finished_at,
  })

  it('«Comparar (n)» se activa con ≥2 y navega a /resultados/comparar?ids=…', async () => {
    ;(listJobs as Mock).mockResolvedValue({ jobs: [summary(A), summary(B)], meta: null })
    render(
      <MemoryRouter initialEntries={['/resultados']}>
        <Routes>
          <Route path="/resultados" element={<ResultsList />} />
          <Route path="/resultados/comparar" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    )
    const boxes = await screen.findAllByRole('checkbox')
    const btn = screen.getByRole('button', { name: /Comparar \(0\)/ })
    expect(btn).toBeDisabled()
    await userEvent.click(boxes[0])
    expect(screen.getByRole('button', { name: /Comparar \(1\)/ })).toBeDisabled()
    await userEvent.click(boxes[1])
    const enabled = screen.getByRole('button', { name: /Comparar \(2\)/ })
    expect(enabled).not.toBeDisabled()
    await userEvent.click(enabled)
    expect(screen.getByTestId('loc')).toHaveTextContent(`/resultados/comparar?ids=${A.job_id},${B.job_id}`)
  })
})

describe('vista de comparación (CU-30.3)', () => {
  it('tabla por job con «—» en lo que falta, enlace al detalle y gráfica', async () => {
    renderCompare([A.job_id, B.job_id, C.job_id])
    const table = await screen.findByRole('table', { name: /comparación/i })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', `/resultados/${A.job_id}`)
    expect(within(rows[0]).getByText('8.0×')).toBeInTheDocument() // speedup del sweep
    // B sin metrics_summary → CPU y memoria «—»; C sin wall time ni speedup.
    expect(within(rows[1]).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(within(rows[2]).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('img', { name: /tiempo total frente a hilos/i })).toBeInTheDocument()
  })
})

describe('comparabilidad (CU-30.2)', () => {
  it('ejemplos distintos → explica por qué y deja quitar jobs', async () => {
    getJobMock.mockImplementation((id: string) => Promise.resolve(id === A.job_id ? A : { ...JOB_PAIR, job_id: id }))
    renderCompare([A.job_id, 'pair1', 'pair2'])
    expect(await screen.findByText(/ejemplos distintos/i)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /tiempo total frente a hilos/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: `Quitar ${A.job_id.slice(0, 8)}` }))
    await waitFor(() => expect(screen.queryByText(/ejemplos distintos/i)).not.toBeInTheDocument())
    expect(screen.getByTestId('loc')).toHaveTextContent('ids=pair1,pair2')
  })

  it('código propio distinto → no comparables', async () => {
    const x = { ...JOB_BARE, job_id: 'x1', source_code: 'a' }
    const y = { ...JOB_BARE, job_id: 'y1', source_code: 'b' }
    getJobMock.mockImplementation((id: string) => Promise.resolve(id === 'x1' ? x : y))
    renderCompare(['x1', 'y1'])
    expect(await screen.findByText(/código distinto/i)).toBeInTheDocument()
  })
})

describe('errores y navegación (CU-30.4)', () => {
  it('un job que falla → ErrorState con Reintentar y Quitar de la comparación', async () => {
    getJobMock.mockImplementation((id: string) =>
      id === 'roto' ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve(BY_ID[id]),
    )
    renderCompare([A.job_id, B.job_id, 'roto'])
    expect(await screen.findByText(/No se pudo cargar la ejecución/i)).toBeInTheDocument()

    getJobMock.mockImplementation((id: string) => Promise.resolve(id === 'roto' ? { ...C, job_id: 'roto' } : BY_ID[id]))
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }))
    await waitFor(() => expect(screen.queryByText(/No se pudo cargar la ejecución/i)).not.toBeInTheDocument())
    expect(getJobMock).toHaveBeenCalledWith('roto')
  })

  it('Quitar de la comparación saca el job de la URL', async () => {
    renderCompare([A.job_id, B.job_id, 'noexiste'])
    await screen.findByText(/No se pudo cargar la ejecución/i)
    await userEvent.click(screen.getByRole('button', { name: /Quitar de la comparación/i }))
    expect(screen.getByTestId('loc')).toHaveTextContent(`ids=${A.job_id},${B.job_id}`)
  })

  it('menos de dos ejecuciones → EmptyState con enlace al historial', async () => {
    renderCompare([A.job_id])
    expect(await screen.findByText(/al menos dos ejecuciones/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ir al historial/i })).toHaveAttribute('href', '/resultados')
  })

  it('solo pide GET /jobs/{id} una vez por job', async () => {
    renderCompare([A.job_id, B.job_id])
    await screen.findByRole('table', { name: /comparación/i })
    expect(getJobMock).toHaveBeenCalledTimes(2)
  })
})
