// GlobalSearch — la paleta de búsqueda de TODO Telar: se abre, carga sus
// fuentes, filtra, se recorre con teclado y lleva a donde corresponde.
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/content', () => ({
  getModules: vi.fn(),
  loadExamplesIndex: vi.fn(),
}))
vi.mock('@/api/jobs', () => ({ listJobs: vi.fn() }))
vi.mock('@/api/catalog', () => ({ getRemoteCatalog: vi.fn() }))
vi.mock('@/api/system', () => ({
  getSystem: vi.fn().mockResolvedValue({ cores: 8, catalog: { enabled: true } }),
  getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}))

import { getRemoteCatalog } from '@/api/catalog'
import { getModules, loadExamplesIndex } from '@/api/content'
import { listJobs } from '@/api/jobs'
import { GlobalSearch } from '@/components/shell/GlobalSearch'

const modules = {
  modules: [
    {
      id: 'm1',
      title: 'Primeros pasos',
      description: 'Región paralela',
      level: 'Básico',
      lessons: [
        { id: 'l1', order: 1, title: 'Hola mundo paralelo', example_id: 'hello', has_quiz: true, has_video: false, enabled: true },
        { id: 'l2', order: 2, title: 'Barreras y sincronización', example_id: null, has_quiz: true, has_video: true, enabled: true },
      ],
    },
  ],
  summary: {},
}
const examples = new Map([
  ['hello', { id: 'hello', title: 'Hola mundo paralelo', teaches: 'Una región paralela', filename: 'hello.py', directives: ['parallel'], enabled: true }],
])
const jobs = {
  jobs: [
    { job_id: 'job-1', filename: 'suma_vectores.py', example_id: null, status: 'completed', threads: 4, created_at: '2026-11-16T14:30:00Z' },
  ],
  meta: null,
}

function Probe() {
  const { pathname, search } = useLocation()
  return <span data-testid="at">{pathname + search}</span>
}

function setup(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <GlobalSearch open onClose={onClose} />
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
  return { onClose, input: screen.getByRole('combobox') }
}

beforeEach(() => {
  vi.mocked(getModules).mockResolvedValue(modules as never)
  vi.mocked(loadExamplesIndex).mockResolvedValue(examples as never)
  vi.mocked(listJobs).mockResolvedValue(jobs as never)
  vi.mocked(getRemoteCatalog).mockResolvedValue({
    modules: [{ id: 'mRend', title: 'Rendimiento', description: 'Medir speedup', level: 'Intermedio', lessons_count: 5, version: 2 }],
  } as never)
})

describe('GlobalSearch', () => {
  it('cerrado no pinta nada', () => {
    render(
      <MemoryRouter>
        <GlobalSearch open={false} onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('abre con el foco en el campo y, sin escribir, ofrece las páginas', () => {
    const { input } = setup()
    expect(screen.getByRole('dialog', { name: 'Buscar en Telar' })).toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(screen.getByRole('option', { name: /Simulador/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Resultados/ })).toBeInTheDocument()
  })

  it('encuentra lecciones, ejemplos, ejecuciones y módulos disponibles en una sola búsqueda', async () => {
    const { input } = setup()
    // Espera a que lleguen las fuentes (la ejecución solo existe tras la carga).
    fireEvent.change(input, { target: { value: 'suma' } })
    expect(await screen.findByRole('option', { name: /suma_vectores\.py/ })).toBeInTheDocument()
    expect(screen.getByText('Ejecuciones')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'paralelo' } })
    await waitFor(() => expect(screen.getByText('Lecciones')).toBeInTheDocument())
    expect(screen.getByText('Ejemplos del simulador')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'rendimiento' } })
    expect(await screen.findByText('Módulos disponibles', { selector: '.gsearch-group' })).toBeInTheDocument()
  })

  it('no distingue tildes: «sincronizacion» encuentra «sincronización»', async () => {
    const { input } = setup()
    await screen.findByRole('option', { name: /Simulador/ })
    await waitFor(() => expect(vi.mocked(listJobs)).toHaveBeenCalled())
    fireEvent.change(input, { target: { value: 'sincronizacion' } })
    expect(await screen.findByRole('option', { name: /Barreras y sincronización/ })).toBeInTheDocument()
  })

  it('Enter abre el resultado activo y cierra; ↓ cambia de resultado', async () => {
    const { input, onClose } = setup()
    fireEvent.change(input, { target: { value: 'simulador' } })
    // 1.º: la página Simulador. ↓ → pasa al siguiente resultado (el ejemplo, si ya cargó).
    const first = await screen.findByRole('option', { name: /Simulador/ })
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('at')).toHaveTextContent('/simulador')
  })

  it('un ejemplo lleva al simulador con ?ejemplo=', async () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: 'hola mundo' } })
    const option = await screen.findByRole('option', { name: /Una región paralela/ })
    fireEvent.click(option)
    expect(screen.getByTestId('at')).toHaveTextContent('/simulador?ejemplo=hello')
  })

  it('una ejecución terminada lleva a sus resultados', async () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: 'suma_vectores' } })
    fireEvent.click(await screen.findByRole('option', { name: /suma_vectores\.py/ }))
    expect(screen.getByTestId('at')).toHaveTextContent('/resultados/job-1')
  })

  it('flechas recorren con vuelta circular y Escape cierra', async () => {
    const { input, onClose } = setup()
    await screen.findByRole('option', { name: /Simulador/ })
    const options = () => screen.getAllByRole('option')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options()[options().length - 1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('sin coincidencias lo dice', async () => {
    const { input } = setup()
    await waitFor(() => expect(vi.mocked(getModules)).toHaveBeenCalled())
    fireEvent.change(input, { target: { value: 'zzzxqw' } })
    expect(await screen.findByText(/No encontramos nada para «zzzxqw»/)).toBeInTheDocument()
  })

  it('si una fuente falla, las demás siguen sirviendo y se avisa', async () => {
    vi.mocked(listJobs).mockRejectedValue(new Error('sin red'))
    const { input } = setup()
    fireEvent.change(input, { target: { value: 'barreras' } })
    expect(await screen.findByRole('option', { name: /Barreras y sincronización/ })).toBeInTheDocument()
    expect(await screen.findByText(/pueden estar incompletos/)).toBeInTheDocument()
  })

  it('clic fuera (en el fondo) cierra', () => {
    const { onClose } = setup()
    fireEvent.mouseDown(document.querySelector('.gsearch-backdrop') as Element)
    expect(onClose).toHaveBeenCalled()
  })
})
