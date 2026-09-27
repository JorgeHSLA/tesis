// S6 · CU-28 — el editor de lección con el selector de tipo: un taller oculta
// regla y video, se guarda con kind='taller' (regla 'viewed', sin video), no se
// puede convertir con quiz, y una vez guardado muestra el editor de pasos.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getAdminModules: vi.fn(),
  getAdminLesson: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
  reorderLessons: vi.fn(),
  addLessonExample: vi.fn(),
  addWorkshopStep: vi.fn(),
  updateWorkshopStep: vi.fn(),
  reorderWorkshopSteps: vi.fn(),
  deleteWorkshopStep: vi.fn(),
}))
vi.mock('@/api/system', () => ({ getSystem: vi.fn() }))
vi.mock('@/api/content', () => ({ getExamples: vi.fn() }))

import { addLessonExample, getAdminLesson, getAdminModules, updateLesson } from '@/api/admin'
import { getExamples } from '@/api/content'
import { getSystem } from '@/api/system'
import AdminLessonEditor from '@/features/admin/lesson/AdminLessonEditor'

const MODULES = {
  modules: [{ id: 'm1', order: 1, title: 'Módulo 1', description: '', level: 'Intro', lessons: [] }],
}

const LECCION = {
  id: 'lesson-1', module_id: 'm1', order: 2, title: 'Lección Uno',
  estimated_minutes: 15, content_markdown: '# Hola', recommended: [],
  video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', completion_rule: 'quiz', archived: false,
  enabled: true, has_quiz: false, quiz_question_count: 0,
  prev_lesson_id: null, next_lesson_id: null, example: null, kind: 'leccion', steps: [],
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/admin', element: <div>PANEL</div> },
      { path: '/admin/lecciones/:lessonId', element: <AdminLessonEditor /> },
    ],
    { initialEntries: [path] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getAdminModules as Mock).mockResolvedValue(MODULES)
  ;(getSystem as Mock).mockResolvedValue({ limits: { max_timeout_s: 120 } })
  ;(getExamples as Mock).mockResolvedValue({ examples: [] })
})

describe('AdminLessonEditor · taller', () => {
  it('convertir en taller oculta regla y video y guarda kind=taller sin video', async () => {
    ;(getAdminLesson as Mock).mockResolvedValue(LECCION)
    ;(updateLesson as Mock).mockResolvedValue({ ...LECCION, kind: 'taller', completion_rule: 'viewed', video_url: null })
    renderAt('/admin/lecciones/lesson-1')
    await screen.findByLabelText('Tipo de lección')
    expect(screen.getByLabelText('Regla de completitud')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Tipo de lección'), { target: { value: 'taller' } })
    expect(screen.queryByLabelText('Regla de completitud')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Video (YouTube)')).not.toBeInTheDocument()
    expect(screen.getByText('Guarda la lección como taller para añadir sus pasos.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))
    await waitFor(() => expect(updateLesson).toHaveBeenCalledTimes(1))
    const body = (updateLesson as Mock).mock.calls[0][1]
    expect(body).toMatchObject({ kind: 'taller', completion_rule: 'viewed', video_url: null })
    expect(await screen.findByText('Pasos del taller')).toBeInTheDocument()
  })

  it('una lección con quiz no se puede convertir en taller', async () => {
    ;(getAdminLesson as Mock).mockResolvedValue({ ...LECCION, has_quiz: true, quiz_question_count: 3 })
    renderAt('/admin/lecciones/lesson-1')
    await screen.findByLabelText('Tipo de lección')
    fireEvent.change(screen.getByLabelText('Tipo de lección'), { target: { value: 'taller' } })
    expect(screen.getByText(/Un taller no lleva quiz/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))
    expect(await screen.findByText('Corrige el tipo de lección antes de guardar.')).toBeInTheDocument()
    expect(updateLesson).not.toHaveBeenCalled()
  })

  it('un taller guardado muestra sus pasos', async () => {
    ;(getAdminLesson as Mock).mockResolvedValue({
      ...LECCION,
      kind: 'taller',
      completion_rule: 'viewed',
      video_url: null,
      steps: [{ idx: 0, title: 'Lee el código', body_markdown: 'x', example_id: null }],
    })
    renderAt('/admin/lecciones/lesson-1')
    expect(await screen.findByText('Lee el código')).toBeInTheDocument()
    expect(screen.getByLabelText('Tipo de lección')).toHaveValue('taller')
  })

  it('el selector de pasos filtra por el módulo y ve el ejemplo recién agregado sin reabrir', async () => {
    ;(getAdminLesson as Mock).mockResolvedValue({ ...LECCION, kind: 'taller', completion_rule: 'viewed', video_url: null })
    ;(getExamples as Mock).mockResolvedValue({
      examples: [{ id: 'ajeno', title: 'De otro módulo', module_id: 'm2' }],
    })
    const creado = {
      id: 'mi-ejemplo', module_id: 'm1', order: 1, source_code: 'print(1)', title: 'Mi ejemplo',
      filename: 'mi.py', difficulty: 1, teaches: 'algo', directives: [], threads_configurable: true,
      fixed_threads: null, fixed_threads_note: null, sweeps_threads: false, self_measures: false,
      parser_id: 'none', default_timeout_s: 60, est_run_seconds: 5, enabled: true, requires_gpu: false,
      lesson_id: 'lesson-1', expected_output_note: '', takeaways: ['una idea'],
    }
    ;(addLessonExample as Mock).mockResolvedValue(creado)
    renderAt('/admin/lecciones/lesson-1')

    fireEvent.click(await screen.findByRole('button', { name: 'Agregar ejemplo' }))
    fireEvent.change(screen.getAllByLabelText('Título')[1], { target: { value: 'Mi ejemplo' } })
    fireEvent.change(screen.getByLabelText('Qué enseña'), { target: { value: 'algo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir aprendizaje' }))
    fireEvent.change(screen.getByLabelText('Lo que vas a aprender 1'), { target: { value: 'una idea' } })
    ;(getExamples as Mock).mockResolvedValue({
      examples: [
        { id: 'ajeno', title: 'De otro módulo', module_id: 'm2' },
        { id: 'mi-ejemplo', title: 'Mi ejemplo', module_id: 'm1' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))
    await screen.findByRole('button', { name: 'Editar ejemplo' })

    fireEvent.click(screen.getByRole('button', { name: /Añadir paso/ }))
    expect(await screen.findByRole('option', { name: 'Mi ejemplo (mi-ejemplo)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'De otro módulo (ajeno)' })).not.toBeInTheDocument()
  })
})
