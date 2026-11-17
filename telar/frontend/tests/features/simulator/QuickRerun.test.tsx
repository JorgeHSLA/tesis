// QuickRerun — «Probar con otros hilos»: repetir una ejecución con otros hilos
// sin volver a la pantalla inicial del simulador.
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/content', () => ({ getExample: vi.fn() }))
vi.mock('@/api/jobs', () => ({ createJob: vi.fn() }))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: { max_threads: 8, cores: 8 }, error: null, loading: false, retry: vi.fn() }),
}))

import { ApiError } from '@/api/client'
import { getExample } from '@/api/content'
import { createJob } from '@/api/jobs'
import { RerunControls, rerunRequest, useRerun, type RerunSource } from '@/features/simulator/QuickRerun'

/** Deslizante + botón, como los usa la pantalla de ejecución (ahí el botón va en la cabecera). */
function QuickRerun({ job, running = false }: { job: RerunSource; running?: boolean }) {
  const rerun = useRerun(job, running)
  return <RerunControls rerun={rerun} showButton />
}

const BASE: RerunSource = {
  example_id: 'hello',
  lesson_id: 'l1',
  source_code: 'print("hi")',
  source_kind: 'example',
  filename: 'hello.py',
  threads: 1,
  timeout_s: 60,
}

describe('rerunRequest', () => {
  it('ejemplo sin editar: manda su id y la lección, NO el código', () => {
    expect(rerunRequest(BASE, 2)).toEqual({ example_id: 'hello', lesson_id: 'l1', threads: 2, timeout_s: 60 })
  })

  it('ejemplo editado: manda también el código', () => {
    expect(rerunRequest({ ...BASE, source_kind: 'editor' }, 4)).toMatchObject({
      example_id: 'hello',
      code: 'print("hi")',
      threads: 4,
    })
  })

  it('código propio: filename + código, sin example_id', () => {
    const req = rerunRequest({ ...BASE, example_id: null, lesson_id: null, source_kind: 'upload' }, 3)
    expect(req).toEqual({ filename: 'hello.py', code: 'print("hi")', threads: 3, timeout_s: 60 })
  })

  it('«sin límite» (0) no se reenvía: el POST exige 5..120', () => {
    expect(rerunRequest({ ...BASE, timeout_s: 0 }, 2)).not.toHaveProperty('timeout_s')
  })
})

function Probe() {
  const { pathname, state } = useLocation()
  return (
    <div>
      <span data-testid="at">{pathname}</span>
      <span data-testid="state">{JSON.stringify(state)}</span>
    </div>
  )
}

function setup(props: Partial<React.ComponentProps<typeof QuickRerun>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/resultados/j1']}>
      <QuickRerun job={BASE} {...props} />
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(getExample).mockReset()
  vi.mocked(getExample).mockResolvedValue({ id: 'hello', threads_configurable: true } as never)
  vi.mocked(createJob).mockReset()
})

describe('QuickRerun', () => {
  it('parte de los hilos del job; repetir con los mismos también se puede (ver la variación)', async () => {
    setup()
    const slider = await screen.findByRole('slider')
    expect(slider).toHaveValue('1')
    expect(screen.getByRole('button', { name: /Ejecutar con 1 hilo/ })).toBeEnabled()

    fireEvent.change(slider, { target: { value: '4' } })
    expect(screen.getByRole('button', { name: 'Ejecutar con 4 hilos' })).toBeEnabled()
  })

  it('lanza el job nuevo y va a su pantalla en vivo, sin pasar por «Configurar»', async () => {
    vi.mocked(createJob).mockResolvedValue({
      job_id: 'nuevo-1',
      ws_url: '/ws/jobs/nuevo-1',
      threads_effective: 2,
      threads_note: null,
    } as never)
    setup()
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar con 2 hilos' }))

    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/simulador/nuevo-1'))
    expect(createJob).toHaveBeenCalledWith({ example_id: 'hello', lesson_id: 'l1', threads: 2, timeout_s: 60 })
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toMatchObject({
      wsUrl: '/ws/jobs/nuevo-1',
      filename: 'hello.py',
      threads: 2,
    })
  })

  it('si el lanzamiento falla, lo dice y deja reintentar', async () => {
    vi.mocked(createJob).mockRejectedValue(new ApiError('DOCKER_UNAVAILABLE', 'Docker no está disponible', 503))
    setup()
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar con 2 hilos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Docker no está disponible')
    expect(screen.getByRole('button', { name: 'Ejecutar con 2 hilos' })).toBeEnabled()
    expect(screen.getByTestId('at')).toHaveTextContent('/resultados/j1')
  })

  it('mientras el job original corre, espera a que termine', async () => {
    setup({ running: true })
    fireEvent.change(await screen.findByRole('slider'), { target: { value: '3' } })
    expect(screen.getByRole('button', { name: 'Ejecutar con 3 hilos' })).toBeDisabled()
    expect(screen.getByText(/cuando esta ejecución termine/)).toBeInTheDocument()
  })

  it('si el ejemplo fija sus hilos (o barre 1·2·4·8) no se muestra: no cambiaría nada', async () => {
    vi.mocked(getExample).mockResolvedValue({ id: 'hello', threads_configurable: false } as never)
    setup()
    await waitFor(() => expect(getExample).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('slider')).toBeNull())
  })

  it('código propio: no consulta ningún ejemplo y aparece directo', async () => {
    setup({ job: { ...BASE, example_id: null, lesson_id: null, source_kind: 'upload' } })
    expect(await screen.findByRole('slider')).toBeInTheDocument()
    expect(getExample).not.toHaveBeenCalled()
  })

  it('el control no pasa del máximo de hilos del equipo', async () => {
    setup()
    expect(await screen.findByRole('slider')).toHaveAttribute('max', '8')
  })
})
