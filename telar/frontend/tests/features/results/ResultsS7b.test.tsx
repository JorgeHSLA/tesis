// S7b · Resultados: rótulo según el estado, configuración completa (09.1),
// causa + stderr completo (09.2) y paginación del historial (CU-11).
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { JobSummaryDto } from '@/api/types'
import { jobDetail, JOB_FAILED, JOB_SWEEP } from '../../fixtures/rest'

vi.mock('@/api/jobs', () => ({
  getJob: vi.fn(),
  listJobs: vi.fn(),
  jobOutputUrl: (id: string) => `/api/v1/jobs/${id}/output`,
}))
vi.mock('@/lib/download', () => ({ downloadFile: vi.fn(), saveBlob: vi.fn() }))

import { getJob, listJobs } from '@/api/jobs'
import ResultsList from '@/features/results/ResultsList'
import ResultsScreen from '@/features/results/ResultsScreen'

function renderDetail(jobId: string) {
  return render(
    <MemoryRouter initialEntries={[`/resultados/${jobId}`]}>
      <Routes>
        <Route path="/resultados/:jobId" element={<ResultsScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rótulo del encabezado', () => {
  it.each([
    ['completed', 'Job completado'],
    ['failed', 'Job fallido'],
    ['timeout', 'Job detenido por timeout'],
    ['cancelled', 'Job cancelado'],
  ] as const)('%s → «%s»', async (status, eyebrow) => {
    ;(getJob as Mock).mockResolvedValue(jobDetail({ status, parsed_timings: null }))
    renderDetail(JOB_SWEEP.job_id)
    expect(await screen.findByText(eyebrow)).toBeInTheDocument()
    if (status !== 'completed') expect(screen.queryByText('Job completado')).toBeNull()
  })
})

describe('CU-09.1 · configuración del job', () => {
  it('muestra timeout, origen, ejemplo y lección', async () => {
    ;(getJob as Mock).mockResolvedValue(JOB_SWEEP)
    renderDetail(JOB_SWEEP.job_id)
    const config = await screen.findByLabelText('Configuración de la ejecución')
    expect(config).toHaveTextContent('timeout 60 s')
    expect(config).toHaveTextContent('origen: ejemplo del curso')
    expect(config).toHaveTextContent('ejemplo transporteParticulas')
    expect(config).toHaveTextContent('lección transporteParticulas')
  })

  it('código propio sin límite de tiempo', async () => {
    ;(getJob as Mock).mockResolvedValue(
      jobDetail({ source_kind: 'editor', example_id: null, lesson_id: null, timeout_s: 0, parsed_timings: null }),
    )
    renderDetail(JOB_SWEEP.job_id)
    const config = await screen.findByLabelText('Configuración de la ejecución')
    expect(config).toHaveTextContent('sin límite de tiempo')
    expect(config).toHaveTextContent('origen: código propio')
    expect(config).not.toHaveTextContent('ejemplo ')
  })
})

describe('CU-09.2 · causa y stderr', () => {
  it('failed: stderr COMPLETO y exit code', async () => {
    const stderr = Array.from({ length: 12 }, (_, i) => `línea ${i + 1}`).join('\n')
    ;(getJob as Mock).mockResolvedValue({ ...JOB_FAILED, stderr })
    renderDetail(JOB_FAILED.job_id)
    const card = await screen.findByRole('region', { name: 'Causa y stderr' })
    expect(card).toHaveTextContent('El programa terminó con exit 1.')
    expect(card).toHaveTextContent('línea 1')
    expect(card).toHaveTextContent('línea 12')
  })

  it.each([
    ['sandbox_error', 'failed', /entorno de ejecución/],
    ['orphaned_on_restart', 'failed', /backend se reinició/],
    ['wall_timeout', 'timeout', /tiempo límite de 60 s/],
    [null, 'cancelled', /Cancelada a petición/],
  ] as const)('%s (%s) muestra la causa', async (detail, status, text) => {
    ;(getJob as Mock).mockResolvedValue(
      jobDetail({ status, error_detail: detail, exit_code: null, stderr: '', parsed_timings: null }),
    )
    renderDetail(JOB_SWEEP.job_id)
    const card = await screen.findByRole('region', { name: 'Causa y stderr' })
    expect(card).toHaveTextContent(text)
    expect(card).toHaveTextContent('(sin salida en stderr)')
  })

  it('completed no muestra la tarjeta', async () => {
    ;(getJob as Mock).mockResolvedValue(JOB_SWEEP)
    renderDetail(JOB_SWEEP.job_id)
    await screen.findByText('Job completado')
    expect(screen.queryByRole('region', { name: 'Causa y stderr' })).toBeNull()
  })
})

function summaries(from: number, n: number): JobSummaryDto[] {
  return Array.from({ length: n }, (_, i) => ({
    job_id: `job${String(from + i).padStart(4, '0')}`,
    filename: `f${from + i}.py`,
    source_kind: 'editor',
    example_id: null,
    lesson_id: null,
    status: 'completed',
    exit_code: 0,
    threads: 2,
    wall_time_ms: 10,
    created_at: '2026-07-12T15:04:05.123Z',
    finished_at: '2026-07-12T15:04:06.123Z',
  }))
}

describe('CU-11 · paginación del historial', () => {
  it('navega a la página siguiente con offset', async () => {
    ;(listJobs as Mock).mockImplementation(({ offset = 0 }: { offset?: number }) =>
      Promise.resolve({
        jobs: summaries(offset, offset === 0 ? 50 : 20),
        meta: { total: 70, limit: 50, offset },
      }),
    )
    render(
      <MemoryRouter>
        <ResultsList />
      </MemoryRouter>,
    )
    expect(await screen.findByText('1–50 de 70')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('51–70 de 70')).toBeInTheDocument()
    expect(listJobs).toHaveBeenLastCalledWith({ limit: 50, offset: 50 })
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    await waitFor(() => expect(listJobs).toHaveBeenLastCalledWith({ limit: 50, offset: 0 }))
  })

  it('sin más de una página no muestra la paginación', async () => {
    ;(listJobs as Mock).mockResolvedValue({ jobs: summaries(0, 3), meta: { total: 3, limit: 50, offset: 0 } })
    render(
      <MemoryRouter>
        <ResultsList />
      </MemoryRouter>,
    )
    await screen.findByText('f0.py')
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull()
  })
})
