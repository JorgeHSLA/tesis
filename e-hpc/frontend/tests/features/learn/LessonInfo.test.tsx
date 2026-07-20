// features/learn/LessonInfo.test.tsx — la card "De qué va esta lección" nace
// COLAPSADA (rediseño 2026-07, Fix 3): sus tabs (Descripción/Código/Salida) y
// el CTA "Probar en el simulador" solo se montan al expandir. El botón conserva
// su semántica accesible (aria-expanded), de la que dependen los E2E.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LessonInfo } from '@/features/learn/LessonInfo'
import type { LessonDetailDto } from '@/api/types'
import { exampleDetail } from '../../fixtures/rest'

const LESSON: LessonDetailDto = {
  id: 'spmd',
  module_id: 'm2',
  order: 3,
  title: 'π con patrón SPMD',
  content_markdown: '# π con SPMD\n\nCalcula π sin `parallel for`.',
  example_id: 'spmd',
  has_quiz: true,
  quiz_question_count: 2,
  estimated_minutes: 20,
  enabled: true,
  prev_lesson_id: null,
  next_lesson_id: null,
  recommended: [],
  progress: { viewed: true, completed: false, best_quiz_score: null, quiz_total: 5 },
}

function renderInfo(runDisabled = false) {
  return render(
    <MemoryRouter>
      <LessonInfo lesson={LESSON} example={exampleDetail()} runDisabled={runDisabled} />
    </MemoryRouter>,
  )
}

const toggle = () => screen.getByRole('button', { name: /De qué va esta lección/ })

describe('LessonInfo — "De qué va esta lección"', () => {
  it('nace COLAPSADA: tabs y CTA no se montan hasta expandir', () => {
    renderInfo()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Descripción' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Probar en el simulador' })).not.toBeInTheDocument()
  })

  it('expande con click: muestra los tabs (Descripción por defecto) y el CTA', async () => {
    const user = userEvent.setup()
    renderInfo()

    await user.click(toggle())

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Descripción' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Probar en el simulador' })).toBeInTheDocument()
  })

  it('vuelve a colapsar con un segundo click (idempotente)', async () => {
    const user = userEvent.setup()
    renderInfo()

    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Descripción' })).not.toBeInTheDocument()
  })
})
