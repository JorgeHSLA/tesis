// QuizResultAnimation — umbrales de variante y garantía de que la banda es
// DECORATIVA: nunca debe tapar ni duplicar el puntaje/veredicto que pinta
// QuizRunner justo debajo.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  HIGH_SCORE_RATIO,
  QuizResultAnimation,
  resolveQuizVariant,
} from '@/components/viz/QuizResultAnimation'

describe('resolveQuizVariant', () => {
  it('suspenso → «bad», sea cual sea el ratio', () => {
    expect(resolveQuizVariant(0, 4, false)).toBe('bad')
    expect(resolveQuizVariant(3, 4, false)).toBe('bad')
  })

  it('aprobado con ratio ≥ 0.9 → «celebration»', () => {
    expect(resolveQuizVariant(4, 4, true)).toBe('celebration')
    expect(resolveQuizVariant(9, 10, true)).toBe('celebration')
  })

  it('aprobado justo por debajo del umbral alto → «regular»', () => {
    expect(resolveQuizVariant(8, 10, true)).toBe('regular')
    expect(resolveQuizVariant(3, 4, true)).toBe('regular')
  })

  it('el borde exacto HIGH_SCORE_RATIO cuenta como celebración', () => {
    const total = 10
    expect(resolveQuizVariant(HIGH_SCORE_RATIO * total, total, true)).toBe('celebration')
  })

  it('total 0 no divide por cero: aprobado sin preguntas → «regular»', () => {
    expect(resolveQuizVariant(0, 0, true)).toBe('regular')
  })
})

describe('<QuizResultAnimation>', () => {
  it('expone un nombre accesible propio y NO repite el puntaje', () => {
    render(<QuizResultAnimation score={4} total={4} passed />)

    const anim = screen.getByRole('img', { name: /celebración/i })
    expect(anim).toBeInTheDocument()
    // El puntaje es responsabilidad del resumen de QuizRunner, no de la banda.
    expect(screen.queryByText('4/4')).not.toBeInTheDocument()
  })

  it('marca la variante en el DOM para que el CSS tinte el rótulo', () => {
    const { rerender } = render(<QuizResultAnimation score={4} total={4} passed />)
    expect(screen.getByTestId('quiz-result-anim')).toHaveAttribute('data-variant', 'celebration')

    rerender(<QuizResultAnimation score={3} total={4} passed />)
    expect(screen.getByTestId('quiz-result-anim')).toHaveAttribute('data-variant', 'regular')

    rerender(<QuizResultAnimation score={1} total={4} passed={false} />)
    expect(screen.getByTestId('quiz-result-anim')).toHaveAttribute('data-variant', 'bad')
  })

  it('rotula cada variante con su mensaje', () => {
    const { rerender } = render(<QuizResultAnimation score={4} total={4} passed />)
    expect(screen.getByText('¡Perfecto!')).toBeInTheDocument()

    rerender(<QuizResultAnimation score={3} total={4} passed />)
    expect(screen.getByText('¡Casi!')).toBeInTheDocument()

    rerender(<QuizResultAnimation score={1} total={4} passed={false} />)
    expect(screen.getByText('¡Otra vez!')).toBeInTheDocument()
  })
})
