// Suite 11 (frontend-spec §10): features/results/ResultsScreen.test.tsx
// parsed_timings kind sweep → SpeedupChart; kind pair → ComparisonBars;
// null + serie en memoria → LiveMetricsChart; null sin serie → resumen
// metrics_summary; 404 → ErrorState; job no-terminal → redirect a /simulador.
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import ResultsScreen from '@/features/results/ResultsScreen'
import { ApiError } from '@/api/client'
import { useJobStore, type MetricSample } from '@/stores/jobStore'
import { useProgressStore } from '@/stores/progressStore'
import { JOB_BARE, JOB_NO_TIMINGS, JOB_PAIR, JOB_SWEEP } from '../../fixtures/rest'

vi.mock('@/api/jobs', () => ({
  getJob: vi.fn(),
  jobOutputUrl: (id: string) => `/api/v1/jobs/${id}/output`,
}))

vi.mock('@/lib/download', () => ({ downloadFile: vi.fn(), saveBlob: vi.fn() }))

import { getJob } from '@/api/jobs'
import { downloadFile, saveBlob } from '@/lib/download'
const downloadMock = downloadFile as Mock
const saveBlobMock = saveBlob as Mock

const getJobMock = getJob as Mock

function renderAt(jobId: string) {
  return render(
    <MemoryRouter initialEntries={[`/resultados/${jobId}`]}>
      <Routes>
        <Route path="/resultados/:jobId" element={<ResultsScreen />} />
        <Route path="/simulador/:jobId" element={<div>REDIRIGIDO AL LIVE</div>} />
        <Route path="/simulador" element={<SimProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

function SimProbe() {
  const location = useLocation()
  return <pre data-testid="sim-state">{JSON.stringify(location.state)}</pre>
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
  downloadMock.mockReset()
  saveBlobMock.mockReset()
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
    // CU-09.4: pids_stats cuenta TODAS las tareas del cgroup, no los hilos OpenMP.
    const rotulo = screen.getByText('Tareas del contenedor')
    expect(rotulo).toHaveAttribute('title', expect.stringMatching(/cgroup.*no .*hilos OpenMP/i))
    expect(screen.queryByText('Hilos (PIDs)')).not.toBeInTheDocument()
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

describe('Speedup observado: la eficiencia nombra su N (auditoría de métricas, E1)', () => {
  // Saturación típica: el mejor speedup es a 4 hilos y a 8 baja. La card toma
  // el MEJOR punto y la gráfica rotula el ÚLTIMO; ambos deben decir a cuántos
  // hilos se refiere su eficiencia, o dos números de la misma pantalla se
  // contradicen sin explicación.
  const base = JOB_SWEEP.parsed_timings
  if (base?.kind !== 'sweep') throw new Error('fixture JOB_SWEEP debe ser sweep')
  const saturado = {
    ...JOB_SWEEP,
    parsed_timings: {
      ...base,
      series: [
        { threads: 1, time_s: 1.0, speedup: 1.0, efficiency: 1.0 },
        { threads: 2, time_s: 0.526, speedup: 1.9, efficiency: 0.95 },
        { threads: 4, time_s: 0.286, speedup: 3.5, efficiency: 0.88 },
        { threads: 8, time_s: 0.3125, speedup: 3.2, efficiency: 0.4 },
      ],
    },
  }

  it('la card dice «a 4 hilos» junto a la eficiencia del mejor punto', async () => {
    getJobMock.mockResolvedValue(saturado)
    renderAt(saturado.job_id)
    expect((await screen.findAllByText('3.5×')).length).toBeGreaterThan(0)
    expect(screen.getByText('a 4 hilos · eficiencia 88%')).toBeInTheDocument()
  })

  it('la gráfica sigue rotulando su propio N (último punto)', async () => {
    getJobMock.mockResolvedValue(saturado)
    renderAt(saturado.job_id)
    expect(await screen.findByText(/eficiencia a 8 hilos: 40%/)).toBeInTheDocument()
  })
})

describe('descarga de la salida (CU-10.1)', () => {
  it('bloquea los botones mientras descarga (sin descargas duplicadas)', async () => {
    getJobMock.mockResolvedValue(JOB_SWEEP)
    let terminar: () => void = () => undefined
    downloadMock.mockReturnValue(new Promise<void>((r) => (terminar = r)))
    renderAt(JOB_SWEEP.job_id)
    const boton = await screen.findByRole('button', { name: /Descargar output/i })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(downloadMock).toHaveBeenCalledTimes(1)
    expect(boton).toBeDisabled()
    expect(screen.getByRole('button', { name: /descargar$/i })).toBeDisabled()
    terminar()
    await waitFor(() => expect(boton).not.toBeDisabled())
  })

  it('descarga vía fetch con el nombre del contrato (stem-jobid8.txt)', async () => {
    getJobMock.mockResolvedValue(JOB_SWEEP)
    downloadMock.mockResolvedValue(undefined)
    renderAt(JOB_SWEEP.job_id)
    fireEvent.click(await screen.findByRole('button', { name: /Descargar output/i }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1))
    expect(downloadMock).toHaveBeenCalledWith(
      `/api/v1/jobs/${JOB_SWEEP.job_id}/output`,
      `transporteMonteCarlo-${JOB_SWEEP.job_id.slice(0, 8)}.txt`,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('si falla muestra el error, mantiene los resultados y permite reintentar', async () => {
    getJobMock.mockResolvedValue(JOB_SWEEP)
    downloadMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(undefined)
    renderAt(JOB_SWEEP.job_id)
    fireEvent.click(await screen.findByRole('button', { name: /descargar$/i }))
    expect(
      await screen.findByText('No fue posible descargar la salida. Inténtalo nuevamente.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Resultados · transporteMonteCarlo\.py/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByText(/No fue posible descargar la salida/)).not.toBeInTheDocument(),
    )
  })
})

describe('Re-ejecutar (CU-04.1, 32.2)', () => {
  it('navega al simulador con ejemplo, lección, código, archivo, hilos y timeout del job', async () => {
    const editado = { ...JOB_SWEEP, source_kind: 'editor' as const, source_code: 'x = 1\n', threads: 6, timeout_s: 90 }
    getJobMock.mockResolvedValue(editado)
    renderAt(editado.job_id)
    fireEvent.click(await screen.findByRole('button', { name: /Re-ejecutar/i }))
    const state = JSON.parse((await screen.findByTestId('sim-state')).textContent ?? 'null') as Record<string, unknown>
    expect(state).toEqual({
      example_id: 'transporteParticulas',
      lesson_id: 'transporteParticulas',
      code: 'x = 1\n',
      filename: 'transporteMonteCarlo.py',
      threads: 6,
      timeout_s: 90,
      edited: true,
    })
  })
})

describe('Exportar JSON (CU-31)', () => {
  it('descarga {format, exported_at, job} con nombre stem-jobid8.json', async () => {
    getJobMock.mockResolvedValue(JOB_BARE)
    renderAt(JOB_BARE.job_id)
    fireEvent.click(await screen.findByRole('button', { name: /Exportar JSON/i }))
    expect(saveBlobMock).toHaveBeenCalledTimes(1)
    const [blob, name] = saveBlobMock.mock.calls[0] as [Blob, string]
    expect(name).toBe(`transporteMonteCarlo-${JOB_BARE.job_id.slice(0, 8)}.json`)
    const data = JSON.parse(await blob.text()) as { format: string; exported_at: string; job: Record<string, unknown> }
    expect(data.format).toBe('telar-job-export/1')
    expect(typeof data.exported_at).toBe('string')
    expect(data.job.job_id).toBe(JOB_BARE.job_id)
    // CU-31.2: lo ausente va como null, nunca 0.
    expect(data.job.metrics_summary).toBeNull()
    expect(data.job.parsed_timings).toBeNull()
  })

  it('si falla muestra el error y permite reintentar', async () => {
    getJobMock.mockResolvedValue(JOB_SWEEP)
    saveBlobMock
      .mockImplementationOnce(() => {
        throw new Error('bloqueado')
      })
      .mockImplementationOnce(() => undefined)
    renderAt(JOB_SWEEP.job_id)
    fireEvent.click(await screen.findByRole('button', { name: /Exportar JSON/i }))
    expect(await screen.findByText(/No fue posible exportar/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }))
    expect(saveBlobMock).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByText(/No fue posible exportar/i)).not.toBeInTheDocument())
  })
})

describe('ResultsScreen · progreso (S2)', () => {
  it('un job con lesson_id refresca la caché de progreso (puede haber completado una lección run)', async () => {
    const hydrate = vi.fn().mockResolvedValue(undefined)
    useProgressStore.setState({ hydrate })
    getJobMock.mockResolvedValue({ ...JOB_SWEEP, lesson_id: 'transporteParticulas' })
    renderAt(JOB_SWEEP.job_id)
    await waitFor(() => expect(hydrate).toHaveBeenCalledWith(true))
  })

  it('un job sin lesson_id no toca el progreso', async () => {
    const hydrate = vi.fn().mockResolvedValue(undefined)
    useProgressStore.setState({ hydrate })
    getJobMock.mockResolvedValue({ ...JOB_SWEEP, lesson_id: null })
    renderAt(JOB_SWEEP.job_id)
    await screen.findByText(/Resultados ·/)
    expect(hydrate).not.toHaveBeenCalled()
  })
})
