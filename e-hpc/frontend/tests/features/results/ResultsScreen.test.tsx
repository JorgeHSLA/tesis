// Suite 11 (frontend-spec §10): features/results/ResultsScreen.test.tsx
// parsed_timings kind sweep → SpeedupChart; kind pair → ComparisonBars;
// null + serie en memoria → LiveMetricsChart; null sin serie → resumen
// metrics_summary; 404 → ErrorState; job no-terminal → redirect a /simulador.
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import ResultsScreen from '@/features/results/ResultsScreen'
import { ApiError } from '@/api/client'
import { useJobStore, type MetricSample } from '@/stores/jobStore'
import { JOB_NO_TIMINGS, JOB_PAIR, JOB_SWEEP } from '../../fixtures/rest'

vi.mock('@/api/jobs', () => ({
  getJob: vi.fn(),
  jobOutputUrl: (id: string) => `/api/v1/jobs/${id}/output`,
}))
vi.mock('@/api/content', () => ({ getLesson: vi.fn() }))

import { getJob } from '@/api/jobs'
import { getLesson } from '@/api/content'

const getJobMock = getJob as Mock
const getLessonMock = getLesson as Mock

function renderAt(jobId: string) {
  return render(
    <MemoryRouter initialEntries={[`/resultados/${jobId}`]}>
      <Routes>
        <Route path="/resultados/:jobId" element={<ResultsScreen />} />
        <Route path="/simulador/:jobId" element={<div>REDIRIGIDO AL LIVE</div>} />
        <Route path="/simulador" element={<div>SIM</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function metric(i: number): MetricSample {
  return {
    ts: `2026-07-12T15:04:0${i}.000Z`,
    cpu_percent: 400 + i,
    online_cpus: 8,
    mem_used_bytes: 100000 + i,
    mem_limit_bytes: 536870912,
    pids: 8,
  }
}

beforeEach(() => {
  getJobMock.mockReset()
  getLessonMock.mockReset().mockResolvedValue({ next_lesson_id: null })
  useJobStore.getState().reset()
})

describe('selección de gráfica según parsed_timings', () => {
  it('kind sweep → SpeedupChart', async () => {
    getJobMock.mockResolvedValue(JOB_SWEEP)
    renderAt(JOB_SWEEP.job_id)
    expect(await screen.findByLabelText(/Curva de speedup/i)).toBeInTheDocument()
  })

  it('kind pair → ComparisonBars', async () => {
    getJobMock.mockResolvedValue(JOB_PAIR)
    renderAt(JOB_PAIR.job_id)
    expect(await screen.findByLabelText(/frente a serial/i)).toBeInTheDocument()
  })

  it('null + serie en memoria del live → LiveMetricsChart', async () => {
    useJobStore.setState({ jobId: JOB_NO_TIMINGS.job_id, metrics: [metric(1), metric(2), metric(3)] })
    getJobMock.mockResolvedValue(JOB_NO_TIMINGS)
    renderAt(JOB_NO_TIMINGS.job_id)
    expect(await screen.findByLabelText(/Serie temporal de CPU y memoria/i)).toBeInTheDocument()
  })

  it('null sin serie → resumen degradado de metrics_summary', async () => {
    getJobMock.mockResolvedValue(JOB_NO_TIMINGS) // store vacío (reset en beforeEach)
    renderAt(JOB_NO_TIMINGS.job_id)
    await screen.findByText(/las gráficas en vivo solo están disponibles/i)
    expect(screen.getAllByText('CPU promedio').length).toBeGreaterThan(0)
  })
})

describe('estados de error / redirect', () => {
  it('404 JOB_NOT_FOUND → ErrorState «Job no encontrado»', async () => {
    getJobMock.mockRejectedValue(new ApiError('JOB_NOT_FOUND', 'no existe', 404))
    renderAt('desconocido')
    expect(await screen.findByText('Job no encontrado')).toBeInTheDocument()
  })

  it('job no terminal → redirect a /simulador/{jobId}', async () => {
    getJobMock.mockResolvedValue({ ...JOB_SWEEP, status: 'running' })
    renderAt(JOB_SWEEP.job_id)
    expect(await screen.findByText('REDIRIGIDO AL LIVE')).toBeInTheDocument()
  })
})

describe('cabecera de resultados', () => {
  it('muestra filename, chip de éxito y métricas', async () => {
    getJobMock.mockResolvedValue(JOB_SWEEP)
    renderAt(JOB_SWEEP.job_id)
    await waitFor(() => expect(screen.getByText(/Resultados · transporteMonteCarlo\.py/)).toBeInTheDocument())
    expect(screen.getByText(/Exit 0 · éxito/)).toBeInTheDocument()
    // Speedup observado del mejor punto del sweep (7.98 → 8.0×); aparece en la
    // MetricCard y también rotulado sobre el punto del SpeedupChart.
    expect(screen.getAllByText('8.0×').length).toBeGreaterThan(0)
  })
})
