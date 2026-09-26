// S2 · LearnScreen: aviso de lección archivada (CU-38.1) y «Marcar como leída»
// solo en lecciones con regla `viewed` (CU-02.4).
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LessonDetailDto } from '@/api/types'
import { MODULES_CON_LECTURA, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({
  getLesson: vi.fn(),
  getExample: vi.fn(),
  loadExamplesIndex: vi.fn(),
  getModules: vi.fn(),
  putLessonProgress: vi.fn(),
}))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: SYSTEM_INFO, error: null, loading: false, retry: vi.fn() }),
}))

import { getLesson, getModules, loadExamplesIndex, putLessonProgress } from '@/api/content'
import LearnScreen from '@/features/learn/LearnScreen'
import { useProgressStore } from '@/stores/progressStore'

function leccion(over: Partial<LessonDetailDto> = {}): LessonDetailDto {
  return {
    id: 'queEsUnHilo',
    module_id: 'f1',
    order: 1,
    title: '¿Qué es un hilo?',
    content_markdown: '# Hilos',
    video_url: null,
    example_id: null,
    has_quiz: false,
    quiz_question_count: 0,
    estimated_minutes: 5,
    enabled: true,
    completion_rule: 'viewed',
    archived: false,
    prev_lesson_id: null,
    next_lesson_id: null,
    recommended: [],
    progress: { viewed: false, completed: false, best_quiz_score: null, quiz_total: 0 },
    ...over,
  }
}

function montar() {
  const router = createMemoryRouter([{ path: '/aprender/:leccionId', element: <LearnScreen /> }], {
    initialEntries: ['/aprender/queEsUnHilo'],
  })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  useProgressStore.setState({ modules: null, summary: null, lastLessonId: null, loading: false, error: null })
  ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES_CON_LECTURA))
  ;(loadExamplesIndex as Mock).mockResolvedValue(new Map())
  ;(putLessonProgress as Mock).mockResolvedValue({})
})

describe('LearnScreen · S2', () => {
  it('lección viewed: muestra «Marcar como leída»', async () => {
    ;(getLesson as Mock).mockResolvedValue(leccion())
    montar()
    expect(await screen.findByRole('button', { name: 'Marcar como leída' })).toBeInTheDocument()
  })

  it('lección quiz: no hay botón de leída', async () => {
    ;(getLesson as Mock).mockResolvedValue(leccion({ completion_rule: 'quiz' }))
    montar()
    await screen.findByRole('heading', { name: '¿Qué es un hilo?' })
    expect(screen.queryByRole('button', { name: 'Marcar como leída' })).not.toBeInTheDocument()
  })

  it('lección archivada abierta por URL: aviso y sin botón de leída', async () => {
    ;(getLesson as Mock).mockResolvedValue(leccion({ archived: true }))
    montar()
    expect(await screen.findByText(/fue retirada de su módulo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar como leída' })).not.toBeInTheDocument()
  })
})

// CU-12.3: la lección dice qué hace falta para completarla según su regla.
describe('LearnScreen · requisito para completar', () => {
  it.each([
    ['viewed', /márcala como leída/],
    ['quiz', /aprueba su quiz/],
  ] as const)('regla %s', async (completion_rule, texto) => {
    ;(getLesson as Mock).mockResolvedValue(leccion({ completion_rule, has_quiz: completion_rule === 'quiz' }))
    montar()
    expect(await screen.findByTestId('requisito-completar')).toHaveTextContent(texto)
  })

  it('lección archivada: no muestra requisito', async () => {
    ;(getLesson as Mock).mockResolvedValue(leccion({ archived: true }))
    montar()
    await screen.findByText(/fue retirada de su módulo/)
    expect(screen.queryByTestId('requisito-completar')).toBeNull()
  })
})

