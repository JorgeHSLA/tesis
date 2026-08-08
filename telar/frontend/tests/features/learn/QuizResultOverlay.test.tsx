// QuizResultOverlay — umbrales de variante y contrato del overlay modal:
// la tarjeta refleja los aciertos REALES, se puede saltar y se cierra con Escape.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  HIGH_SCORE_RATIO,
  QuizResultOverlay,
  resolveQuizVariant,
} from '@/components/viz/QuizResultOverlay'

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

interface OverlayOverrides {
  score?: number
  total?: number
  passed?: boolean
  lessonTitle?: string
  marks?: readonly boolean[]
}

function renderOverlay(over: OverlayOverrides = {}) {
  const onClose = vi.fn()
  const view = render(
    <QuizResultOverlay
      score={over.score ?? 3}
      total={over.total ?? 4}
      passed={over.passed ?? true}
      lessonTitle={over.lessonTitle ?? 'Hola mundo paralelo'}
      marks={over.marks ?? [true, true, false, true]}
      onClose={onClose}
    />,
  )
  return { onClose, ...view }
}

describe('<QuizResultOverlay>', () => {
  it('es un diálogo modal cuyo nombre accesible lleva el puntaje real', () => {
    renderOverlay()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Resultado del quiz: 3 de 4. Aprobado.')
  })

  it('dice «No aprobado» cuando el intento no pasa', () => {
    renderOverlay({ score: 1, total: 4, passed: false, marks: [false, true, false, false] })

    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Resultado del quiz: 1 de 4. No aprobado.',
    )
  })

  it('la tarjeta muestra el título de la lección y el puntaje REAL, no las cifras del bundle', () => {
    renderOverlay()

    expect(screen.getByText(/Hola mundo paralelo/)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('/4')).toBeInTheDocument()
    // Las cifras inventadas del bundle original NO deben aparecer nunca.
    expect(screen.queryByText(/UNIDAD 04/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/02:14/)).not.toBeInTheDocument()
    expect(screen.queryByText('/10')).not.toBeInTheDocument()
  })

  it('pinta una fila por pregunta, con acierto/fallo según los datos reales', () => {
    renderOverlay({ marks: [true, false, true, true, false] })

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    expect(rows.filter((r) => r.classList.contains('is-ok'))).toHaveLength(3)
    expect(rows.filter((r) => r.classList.contains('is-bad'))).toHaveLength(2)
  })

  it('marca la variante en el DOM y rotula acorde', () => {
    const { unmount } = renderOverlay({ score: 4, total: 4, marks: [true, true, true, true] })
    expect(screen.getByTestId('quiz-result-overlay')).toHaveAttribute('data-variant', 'celebration')
    expect(screen.getByText('¡Perfecto!')).toBeInTheDocument()
    unmount()

    renderOverlay({ score: 1, total: 4, passed: false, marks: [false, false, false, true] })
    expect(screen.getByTestId('quiz-result-overlay')).toHaveAttribute('data-variant', 'bad')
    expect(screen.getByText('¡Otra vez!')).toBeInTheDocument()
  })

  it('el botón «Saltar» recibe el foco al abrir y cierra al pulsarlo', async () => {
    const user = userEvent.setup()
    const { onClose } = renderOverlay()

    const skip = screen.getByRole('button', { name: 'Saltar' })
    expect(skip).toHaveFocus()

    await user.click(skip)
    // El cierre espera al desvanecido: se comprueba con espera, no al instante.
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
  })

  it('Escape también cierra', async () => {
    const user = userEvent.setup()
    const { onClose } = renderOverlay()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
  })

  it('cierra UNA sola vez aunque se pulsen Saltar y Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = renderOverlay()

    await user.click(screen.getByRole('button', { name: 'Saltar' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('bloquea el scroll del fondo mientras está abierto y lo restaura al desmontar', () => {
    const { unmount } = renderOverlay({ marks: [true] })
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
