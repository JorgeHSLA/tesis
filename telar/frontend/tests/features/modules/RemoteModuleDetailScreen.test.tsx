// S5 · CU-34.1 — detalle de una publicación (getRemoteModule): cargando, error
// con reintento y «ya no está disponible» con volver.
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/catalog', () => ({ getRemoteModule: vi.fn() }))

import { getRemoteModule } from '@/api/catalog'
import { ApiError } from '@/api/client'
import RemoteModuleDetailScreen from '@/features/modules/RemoteModuleDetailScreen'

const detalleMock = getRemoteModule as Mock

const DETALLE = {
  id: 'mx',
  title: 'Tareas',
  description: 'Módulo sobre task.',
  level: 'Avanzado',
  order_hint: 9,
  version: 3,
  checksum: 'c'.repeat(64),
  object_path: 'modulos/mx/v3.json',
  generation: null,
  size_bytes: 1234,
  published_at: '2026-09-20T10:00:00.000Z',
  author_label: 'Curso Telar',
  lessons_count: 2,
  questions_count: 5,
  estimated_minutes_total: 35,
  requires_gpu: false,
  state: 'available',
  installed_version: null,
  installed_checksum: null,
  lessons: [
    {
      lesson_id: 'task-intro', order: 1, title: 'La directiva task', estimated_minutes: 20,
      has_example: true, has_quiz: true, quiz_question_count: 5, requires_gpu: false,
      completion_rule: 'quiz', status: 'new',
    },
    {
      lesson_id: 'task-deps', order: 2, title: 'Dependencias', estimated_minutes: 15,
      has_example: false, has_quiz: false, quiz_question_count: 0, requires_gpu: false,
      completion_rule: 'viewed', status: 'new',
    },
  ],
  content_warnings: [],
}

function renderAt(path = '/modulos/mx') {
  const router = createMemoryRouter(
    [
      { path: '/modulos', element: <div>LISTA</div> },
      { path: '/modulos/:moduleId', element: <RemoteModuleDetailScreen /> },
    ],
    { initialEntries: [path] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => vi.clearAllMocks())

describe('RemoteModuleDetailScreen', () => {
  it('muestra un esqueleto mientras carga y luego las lecciones', async () => {
    let resolver: (v: unknown) => void = () => {}
    detalleMock.mockReturnValue(new Promise((r) => (resolver = r)))
    renderAt()
    expect(screen.getByTestId('remote-detail-loading')).toBeInTheDocument()

    resolver(DETALLE)
    expect(await screen.findByRole('heading', { name: 'Tareas' })).toBeInTheDocument()
    expect(detalleMock).toHaveBeenCalledWith('mx')
    expect(screen.getByText('La directiva task')).toBeInTheDocument()
    expect(screen.getByText('Dependencias')).toBeInTheDocument()
    expect(screen.getByText(/v3/)).toBeInTheDocument()
  })

  it('publicación retirada: «ya no está disponible» y volver a la lista', async () => {
    detalleMock.mockRejectedValue(
      new ApiError('REMOTE_MODULE_NOT_FOUND', 'No está.', 404),
    )
    renderAt()
    expect(await screen.findByText(/ya no está disponible/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Volver/ }))
    expect(await screen.findByText('LISTA')).toBeInTheDocument()
  })

  it('error de red: ErrorState con Reintentar que vuelve a pedir', async () => {
    detalleMock
      .mockRejectedValueOnce(new ApiError('CATALOG_UNAVAILABLE', 'Sin red.', 503))
      .mockResolvedValueOnce(DETALLE)
    renderAt()
    const reintentar = await screen.findByRole('button', { name: /Reintentar/ })
    fireEvent.click(reintentar)
    expect(await screen.findByRole('heading', { name: 'Tareas' })).toBeInTheDocument()
    expect(detalleMock).toHaveBeenCalledTimes(2)
  })
})
