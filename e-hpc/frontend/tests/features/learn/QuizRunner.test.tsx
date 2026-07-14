// Suite 9 (frontend-spec §10): features/learn/QuizRunner.test.tsx
// Quiz MODELO SERVIDOR: GET quiz sin respuestas → responder todas → habilita
// Enviar → POST attempts → feedback por pregunta (correct_key/explanation),
// resumen score/total, applyAttemptResult llamado. La clave jamás viaja antes.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { QuizRunner } from '@/features/learn/QuizRunner'
import { useProgressStore } from '@/stores/progressStore'
import type { LessonProgressDto } from '@/api/types'
import { QUIZ, QUIZ_ATTEMPT_RESULT } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({
  getQuiz: vi.fn(),
  postQuizAttempt: vi.fn(),
}))

import { getQuiz, postQuizAttempt } from '@/api/content'

const getQuizMock = getQuiz as Mock
const postQuizAttemptMock = postQuizAttempt as Mock

const PROGRESS: LessonProgressDto = { viewed: true, completed: false, best_quiz_score: null, quiz_total: 5 }

let applyAttemptResult: Mock

beforeEach(() => {
  getQuizMock.mockReset().mockResolvedValue(QUIZ)
  postQuizAttemptMock.mockReset().mockResolvedValue(QUIZ_ATTEMPT_RESULT)
  applyAttemptResult = vi.fn()
  useProgressStore.setState({ applyAttemptResult })
})

function renderRunner() {
  return render(<QuizRunner lessonId="spmd" questionCount={2} progress={PROGRESS} />)
}

describe('flujo completo servidor', () => {
  it('teaser → GET quiz → responder todas → POST → feedback + resumen', async () => {
    const user = userEvent.setup()
    renderRunner()

    // 1. Teaser: no hay preguntas ni claves aún.
    expect(screen.getByRole('button', { name: /empezar quiz/i })).toBeInTheDocument()

    // 2. Empezar → carga preguntas (sin respuesta correcta).
    await user.click(screen.getByRole('button', { name: /empezar quiz/i }))
    await waitFor(() => expect(getQuizMock).toHaveBeenCalledWith('spmd'))
    expect(await screen.findByText(/¿Cómo reparte el trabajo/i)).toBeInTheDocument()

    // 3. Enviar deshabilitado hasta responder todas.
    const submit = screen.getByRole('button', { name: /enviar respuestas/i })
    expect(submit).toBeDisabled()

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(8) // 2 preguntas × 4 opciones
    await user.click(radios[1]) // q1 opción b
    expect(submit).toBeDisabled() // aún falta q2
    await user.click(radios[6]) // q2 opción c
    expect(submit).toBeEnabled()

    // 4. POST attempts → feedback y resumen.
    await user.click(submit)
    await waitFor(() => expect(postQuizAttemptMock).toHaveBeenCalledWith('spmd', expect.any(Object)))

    // Resumen score/total + aprobado.
    expect(await screen.findByText('2/2')).toBeInTheDocument()
    expect(screen.getByText('Aprobado')).toBeInTheDocument()
    // Explicaciones de results[] visibles.
    expect(screen.getByText(/reparto manual/i)).toBeInTheDocument()
    expect(screen.getByText(/cronómetro de OpenMP/i)).toBeInTheDocument()

    // 5. progressStore.applyAttemptResult llamado con la 201.
    expect(applyAttemptResult).toHaveBeenCalledWith(QUIZ_ATTEMPT_RESULT)
  })

  it('no existe botón «Comprobar» por pregunta (la clave no viaja antes)', async () => {
    const user = userEvent.setup()
    renderRunner()
    await user.click(screen.getByRole('button', { name: /empezar quiz/i }))
    await screen.findByText(/¿Cómo reparte el trabajo/i)
    expect(screen.queryByRole('button', { name: /comprobar/i })).not.toBeInTheDocument()
  })

  it('error del GET vuelve al teaser mostrando el fallo', async () => {
    getQuizMock.mockRejectedValueOnce(new Error('404 QUIZ_NOT_FOUND'))
    const user = userEvent.setup()
    renderRunner()
    await user.click(screen.getByRole('button', { name: /empezar quiz/i }))
    expect(await screen.findByText(/No se pudo cargar el quiz/i)).toBeInTheDocument()
  })
})
