// tests/admin/AdminQuizEditor.test.tsx — editor de quiz: add/remove/reorder
// inmutables (recomputan order), radio de correct_key, y submit putAdminQuiz
// (reemplazo total con pass_threshold y order 1..N).
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getAdminQuiz: vi.fn(),
  putAdminQuiz: vi.fn(),
  deleteAdminQuiz: vi.fn(),
}))

import { deleteAdminQuiz, getAdminQuiz, putAdminQuiz } from '@/api/admin'
import { ApiError } from '@/api/client'
import AdminQuizEditor from '@/features/admin/quiz/AdminQuizEditor'

const getAdminQuizMock = getAdminQuiz as Mock
const putAdminQuizMock = putAdminQuiz as Mock
const deleteAdminQuizMock = deleteAdminQuiz as Mock

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
  const router = createMemoryRouter([
    { path: '/admin/quiz/:lessonId', element: <AdminQuizEditor /> },
    { path: '/admin', element: <div>PANEL</div> },
  ], {
    initialEntries: ['/admin/quiz/lesson-1'],
  })
  return { ...render(<RouterProvider router={router} />), router }
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

  // BUG-01: crear el PRIMER quiz de una lección. El GET admin devuelve
  // 404 QUIZ_NOT_FOUND cuando la lección existe pero no tiene preguntas; eso NO
  // es un error a mostrar, sino el punto de partida para autorar (formulario vacío).
  it('lección sin quiz (404 QUIZ_NOT_FOUND) → formulario vacío editable, no ErrorState', async () => {
    getAdminQuizMock.mockRejectedValue(new ApiError('QUIZ_NOT_FOUND', 'La lección no tiene quiz.', 404))
    renderEditor()

    expect(await screen.findByText('Preguntas del quiz')).toBeInTheDocument()
    // Controles de autoría presentes (umbral + añadir pregunta):
    expect(screen.getByRole('spinbutton', { name: 'Umbral para aprobar' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Añadir pregunta' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Este quiz no tiene preguntas')).toBeInTheDocument()
    // NO se muestra el ErrorState:
    expect(screen.queryByText('No se pudo cargar el quiz.')).not.toBeInTheDocument()
    // Parte sin cambios (nada que guardar aún):
    expect(screen.getByText('Todo guardado')).toBeInTheDocument()
  })

  it('lección inexistente (404 LESSON_NOT_FOUND) → ErrorState, no formulario', async () => {
    getAdminQuizMock.mockRejectedValue(new ApiError('LESSON_NOT_FOUND', 'No existe la lección.', 404))
    renderEditor()

    expect(await screen.findByText('No se pudo cargar el quiz.')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Umbral para aprobar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Añadir pregunta' })).not.toBeInTheDocument()
  })

  it('otros errores (500 INTERNAL_ERROR) → ErrorState (solo QUIZ_NOT_FOUND es especial)', async () => {
    getAdminQuizMock.mockRejectedValue(new ApiError('INTERNAL_ERROR', 'Error del servidor.', 500))
    renderEditor()

    expect(await screen.findByText('No se pudo cargar el quiz.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Añadir pregunta' })).not.toBeInTheDocument()
  })

  it('desde el formulario vacío, añade una pregunta y guarda con un id de pregunta válido', async () => {
    const savedQuiz = {
      lesson_id: 'lesson-1',
      question_count: 1,
      pass_threshold: 0.6,
      questions: [
        {
          id: 'lesson-1-q-nueva', order: 1, text: 'P',
          options: [{ key: 'a', text: 'A' }, { key: 'b', text: 'B' }],
          correct_key: 'a', explanation: 'E',
        },
      ],
    }
    // Primera carga: sin quiz (404). Tras guardar, el reload ya ve el quiz creado.
    getAdminQuizMock.mockRejectedValueOnce(new ApiError('QUIZ_NOT_FOUND', 'La lección no tiene quiz.', 404))
    getAdminQuizMock.mockResolvedValue(structuredClone(savedQuiz))
    putAdminQuizMock.mockResolvedValue(structuredClone(savedQuiz))

    renderEditor()
    await screen.findByText('Preguntas del quiz')

    fireEvent.click(screen.getAllByRole('button', { name: 'Añadir pregunta' })[0])
    fireEvent.change(await screen.findByLabelText('Enunciado'), { target: { value: 'P' } })
    fireEvent.change(screen.getByLabelText('Texto de la opción A'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('Texto de la opción B'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('Explicación'), { target: { value: 'E' } })

    fireEvent.click(screen.getByRole('button', { name: 'Guardar quiz' }))

    await waitFor(() => expect(putAdminQuizMock).toHaveBeenCalledTimes(1))
    const [lessonId, body] = putAdminQuizMock.mock.calls[0]
    expect(lessonId).toBe('lesson-1')
    expect(body.pass_threshold).toBeCloseTo(0.6)
    expect(body.questions).toHaveLength(1)
    // El id de la pregunta nueva NO viaja vacío: cumple ^[A-Za-z0-9._-]{1,80}$ del contrato §10.6.
    expect(body.questions[0].id).not.toBe('')
    expect(body.questions[0].id).toMatch(/^[A-Za-z0-9._-]{1,80}$/)
    expect(body.questions[0].order).toBe(1)

    // Tras el reload (getAdminQuiz ya resuelve el quiz creado) → Todo guardado.
    await waitFor(() => expect(screen.getByText('Todo guardado')).toBeInTheDocument())
  })
})

describe('AdminQuizEditor · CU-18.3 eliminar quiz', () => {
  it('pide confirmación, avisa del progreso y borra el quiz', async () => {
    deleteAdminQuizMock.mockResolvedValue({ deleted: true, id: 'lesson-1' })
    getAdminQuizMock
      .mockResolvedValueOnce(structuredClone(QUIZ))
      .mockRejectedValue(new ApiError('QUIZ_NOT_FOUND', 'sin quiz', 404))
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar quiz' }))

    const dialogo = screen.getByRole('dialog')
    expect(dialogo).toHaveTextContent(/reinicia el progreso/)
    expect(deleteAdminQuizMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar quiz definitivamente' }))
    await waitFor(() => expect(deleteAdminQuizMock).toHaveBeenCalledWith('lesson-1'))
    expect(await screen.findByText('Este quiz no tiene preguntas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eliminar quiz' })).not.toBeInTheDocument()
  })

  it('cancelar no borra nada', async () => {
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(deleteAdminQuizMock).not.toHaveBeenCalled()
    expect(screen.getByText('Pregunta 1')).toBeInTheDocument()
  })

  it('un error al borrar se muestra y el quiz sigue ahí', async () => {
    deleteAdminQuizMock.mockRejectedValue(new ApiError('INTERNAL', 'falló el borrado', 500))
    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar quiz definitivamente' }))
    expect(await screen.findByText('falló el borrado')).toBeInTheDocument()
    expect(screen.getByText('Pregunta 1')).toBeInTheDocument()
  })

  it('sin quiz guardado no ofrece eliminarlo', async () => {
    getAdminQuizMock.mockRejectedValue(new ApiError('QUIZ_NOT_FOUND', 'sin quiz', 404))
    renderEditor()
    await screen.findByText('Este quiz no tiene preguntas')
    expect(screen.queryByRole('button', { name: 'Eliminar quiz' })).not.toBeInTheDocument()
  })
})

describe('AdminQuizEditor · cambios sin guardar', () => {
  it('navegar con cambios pide confirmación', async () => {
    const { router } = renderEditor()
    await screen.findByText('Preguntas del quiz')
    fireEvent.click(screen.getByRole('button', { name: 'Añadir pregunta' }))
    void router.navigate('/admin')
    expect(await screen.findByRole('dialog', { name: 'Cambios sin guardar' })).toBeInTheDocument()
    expect(screen.queryByText('PANEL')).toBeNull()
  })
})

