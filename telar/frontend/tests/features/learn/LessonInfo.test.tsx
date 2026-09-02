// features/learn/LessonInfo.test.tsx — la card "De qué va esta lección" nace
// ABIERTA (C1, 2026-08): al entrar en la lección, el markdown, el código y la
// salida esperada están a la vista. Sigue siendo plegable, y el botón conserva
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
  video_url: null,
  completion_rule: 'quiz',
  archived: false,
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
  it('nace ABIERTA: tabs (Descripción por defecto) y CTA visibles sin interactuar', () => {
    renderInfo()
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Descripción' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Probar en el simulador' })).toBeInTheDocument()
  })

  it('el markdown de la lección se ve al entrar, sin abrir nada', () => {
    const { container } = renderInfo()
    expect(container.querySelector('.markdown')?.textContent).toContain('Calcula π sin')
  })

  it('se pliega con click y se vuelve a abrir (idempotente)', async () => {
    const user = userEvent.setup()
    renderInfo()

    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Descripción' })).not.toBeInTheDocument()

    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Descripción' })).toBeInTheDocument()
  })
})

// ── E1: la lección conceptual ────────────────────────────────────────────────

const LECCION_TEORICA: LessonDetailDto = {
  ...LESSON,
  id: 'queEsUnHilo',
  title: '¿Qué es un hilo?',
  content_markdown: '# ¿Qué es un hilo?\n\nUna unidad de ejecución dentro de un proceso.',
  example_id: null,
  has_quiz: false,
  quiz_question_count: 0,
  completion_rule: 'viewed',
}

describe('LessonInfo — lección sin ejemplo (E1)', () => {
  function renderTeorica() {
    return render(
      <MemoryRouter>
        <LessonInfo lesson={LECCION_TEORICA} example={null} runDisabled={false} />
      </MemoryRouter>,
    )
  }

  it('muestra el contenido sin tira de tabs: no hay Código ni Salida', () => {
    const { container } = renderTeorica()
    expect(container.querySelector('.markdown')?.textContent).toContain(
      'Una unidad de ejecución',
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('no ofrece ejecutar ni descargar: no hay código, no hay botón', () => {
    renderTeorica()
    // La clave es que NO estén, no que estén deshabilitados: ofrecer un botón
    // muerto sugiere que falta algo cuando en realidad la lección está completa.
    expect(screen.queryByRole('button', { name: 'Probar en el simulador' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Descargar/ })).not.toBeInTheDocument()
  })

  it('no pinta dificultad ni directivas, que viven en el ejemplo', () => {
    const { container } = renderTeorica()
    expect(container.querySelector('.lesson-facts')).toBeNull()
  })
})
