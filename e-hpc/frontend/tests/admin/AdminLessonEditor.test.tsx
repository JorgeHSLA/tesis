// tests/admin/AdminLessonEditor.test.tsx — editor de lección: dirty, preview
// WYSIWYG (renderMarkdown), submit create (createLesson con ejemplo pareado) vs
// submit edit (updateLesson solo la faceta lección).
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getAdminModules: vi.fn(),
  getAdminLesson: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
}))
vi.mock('@/api/system', () => ({ getSystem: vi.fn() }))

import { createLesson, getAdminLesson, getAdminModules, updateLesson } from '@/api/admin'
import { getSystem } from '@/api/system'
import AdminLessonEditor from '@/features/admin/lesson/AdminLessonEditor'

const getAdminModulesMock = getAdminModules as Mock
const getAdminLessonMock = getAdminLesson as Mock
const createLessonMock = createLesson as Mock
const updateLessonMock = updateLesson as Mock
const getSystemMock = getSystem as Mock

const MODULES = {
  modules: [{ id: 'm1', order: 1, title: 'Módulo 1', description: '', level: 'Intro', lessons: [] }],
}

const EXAMPLE_STUB = {
  id: 'ex-1', module_id: 'm1', order: 1, source_code: 'print(1)',
  title: 'Ej', filename: 'ej.py', difficulty: 1, teaches: '', directives: [],
  threads_configurable: true, fixed_threads: null, fixed_threads_note: null,
  sweeps_threads: false, self_measures: false, parser_id: 'none',
  default_timeout_s: 60, est_run_seconds: 5, enabled: true, requires_gpu: false,
  expected_output_note: '', takeaways: [],
}

const LESSON_DETAIL = {
  id: 'lesson-1', module_id: 'm1', order: 2, title: 'Lección Uno',
  estimated_minutes: 15, content_markdown: '# Hola', recommended: [],
  enabled: true, has_quiz: false, quiz_question_count: 0,
  prev_lesson_id: null, next_lesson_id: null, example: EXAMPLE_STUB,
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/admin', element: <div>PANEL</div> },
      { path: '/admin/lecciones/nueva', element: <AdminLessonEditor /> },
      { path: '/admin/lecciones/:lessonId', element: <AdminLessonEditor /> },
    ],
    { initialEntries: [path] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  getAdminModulesMock.mockResolvedValue(MODULES)
  getSystemMock.mockResolvedValue({ limits: { max_timeout_s: 120 } })
  getAdminLessonMock.mockResolvedValue(LESSON_DETAIL)
  createLessonMock.mockResolvedValue({ ...LESSON_DETAIL, id: 'nueva-1' })
  updateLessonMock.mockResolvedValue(LESSON_DETAIL)
})

describe('AdminLessonEditor · /nueva', () => {
  it('parte sin cambios y marca dirty al editar', async () => {
    renderAt('/admin/lecciones/nueva')
    expect(await screen.findByText('Nueva lección')).toBeInTheDocument()
    expect(screen.getByText('Todo guardado')).toBeInTheDocument()

    fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Mi lección' } })
    expect(await screen.findByText('Cambios sin guardar')).toBeInTheDocument()
  })

  it('la vista previa refleja el markdown (mismo renderMarkdown)', async () => {
    renderAt('/admin/lecciones/nueva')
    await screen.findByText('Nueva lección')
    const textarea = screen.getByLabelText('Contenido de la lección (Markdown)')
    fireEvent.change(textarea, { target: { value: '# Encabezado' } })
    await waitFor(() => {
      const preview = screen.getByTestId('markdown-preview')
      expect(preview.innerHTML).toContain('<h1>Encabezado</h1>')
    })
  })

  it('crea la lección con su ejemplo pareado y navega al panel', async () => {
    renderAt('/admin/lecciones/nueva')
    await screen.findByText('Nueva lección')

    fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Mi lección' } })
    fireEvent.change(screen.getByLabelText('Identificador'), { target: { value: 'mi-leccion' } })
    fireEvent.change(screen.getByLabelText('Módulo'), { target: { value: 'm1' } })
    fireEvent.change(screen.getByLabelText('Orden'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Minutos estimados'), { target: { value: '10' } })

    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))

    await waitFor(() => expect(createLessonMock).toHaveBeenCalledTimes(1))
    const body = createLessonMock.mock.calls[0][0]
    expect(body.id).toBe('mi-leccion')
    expect(body.module_id).toBe('m1')
    expect(body.order).toBe(1)
    expect(body.example).toBeDefined()
    expect(typeof body.source_code).toBe('string')
    expect(await screen.findByText('PANEL')).toBeInTheDocument()
  })
})

describe('AdminLessonEditor · edición', () => {
  it('carga la lección y updateLesson envía solo la faceta lección', async () => {
    renderAt('/admin/lecciones/lesson-1')
    const titleInput = (await screen.findByLabelText('Título')) as HTMLInputElement
    expect(titleInput.value).toBe('Lección Uno')

    fireEvent.change(titleInput, { target: { value: 'Lección Editada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1))
    const [id, body] = updateLessonMock.mock.calls[0]
    expect(id).toBe('lesson-1')
    expect(body.title).toBe('Lección Editada')
    expect(body).not.toHaveProperty('example')
    expect(body).not.toHaveProperty('source_code')
  })
})
