// tests/admin/AdminQuizEditor.test.tsx — editor de quiz: add/remove/reorder
// inmutables (recomputan order), radio de correct_key, y submit putAdminQuiz
// (reemplazo total con pass_threshold y order 1..N).
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getAdminQuiz: vi.fn(),
  putAdminQuiz: vi.fn(),
}))

import { getAdminQuiz, putAdminQuiz } from '@/api/admin'
import AdminQuizEditor from '@/features/admin/quiz/AdminQuizEditor'

const getAdminQuizMock = getAdminQuiz as Mock
const putAdminQuizMock = putAdminQuiz as Mock

const QUIZ = {
  lesson_id: 'lesson-1',
  question_count: 2,
  pass_threshold: 0.8,
  questions: [
    {
      id: 'q1', order: 1, text: 'Pregunta uno',
      options: [{ key: 'a', text: 'A1' }, { key: 'b', text: 'B1' }],
      correct_key: 'a', explanation: 'e1',
    },
    {
      id: 'q2', order: 2, text: 'Pregunta dos',
      options: [{ key: 'a', text: 'A2' }, { key: 'b', text: 'B2' }],
      correct_key: 'a', explanation: 'e2',
    },
  ],
}

function renderEditor() {
  const router = createMemoryRouter([{ path: '/admin/quiz/:lessonId', element: <AdminQuizEditor /> }], {
    initialEntries: ['/admin/quiz/lesson-1'],
  })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  getAdminQuizMock.mockResolvedValue(structuredClone(QUIZ))
  putAdminQuizMock.mockResolvedValue(structuredClone(QUIZ))
})

describe('AdminQuizEditor', () => {
  it('carga las preguntas y parte sin cambios', async () => {
    renderEditor()
    expect(await screen.findByText('Preguntas del quiz')).toBeInTheDocument()
    expect(screen.getByText('Pregunta 1')).toBeInTheDocument()
    expect(screen.getByText('Pregunta 2')).toBeInTheDocument()
    expect(screen.getByText('Todo guardado')).toBeInTheDocument()
  })

  it('añadir una pregunta la marca dirty y crece la lista', async () => {
    renderEditor()
    await screen.findByText('Preguntas del quiz')
    fireEvent.click(screen.getByRole('button', { name: 'Añadir pregunta' }))
    expect(await screen.findByText('Pregunta 3')).toBeInTheDocument()
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument()
  })

  it('borrar una pregunta reduce la lista', async () => {
    renderEditor()
    await screen.findByText('Preguntas del quiz')
    fireEvent.click(screen.getByRole('button', { name: 'Borrar pregunta 2' }))
    await waitFor(() => expect(screen.queryByText('Pregunta 2')).not.toBeInTheDocument())
  })

  it('reordenar intercambia el enunciado de la primera posición', async () => {
    renderEditor()
    await screen.findByText('Preguntas del quiz')
    const before = screen.getAllByLabelText('Enunciado') as HTMLTextAreaElement[]
    expect(before[0].value).toBe('Pregunta uno')

    fireEvent.click(screen.getByRole('button', { name: 'Bajar pregunta 1' }))
    await waitFor(() => {
      const after = screen.getAllByLabelText('Enunciado') as HTMLTextAreaElement[]
      expect(after[0].value).toBe('Pregunta dos')
    })
  })

  it('el radio fija correct_key y putAdminQuiz recibe el reemplazo total', async () => {
    renderEditor()
    await screen.findByText('Preguntas del quiz')

    fireEvent.click(screen.getAllByLabelText('Marcar opción B como correcta')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Guardar quiz' }))

    await waitFor(() => expect(putAdminQuizMock).toHaveBeenCalledTimes(1))
    const [lessonId, body] = putAdminQuizMock.mock.calls[0]
    expect(lessonId).toBe('lesson-1')
    expect(body.pass_threshold).toBeCloseTo(0.8)
    expect(body.questions).toHaveLength(2)
    expect(body.questions[0].correct_key).toBe('b')
    expect(body.questions.map((q: { order: number }) => q.order)).toEqual([1, 2])
  })
})
