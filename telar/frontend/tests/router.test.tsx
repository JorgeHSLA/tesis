// Suite 12 (frontend-spec §10): router.test.tsx (smoke)
// Cada ruta lazy renderiza su skeleton (Suspense) y luego la pantalla con la
// API mockeada (fetch stub que sirve los fixtures del contrato). El primer
// render suspende → ScreenSkeleton (role status); luego aparece la pantalla.
import { RouterProvider } from 'react-router-dom'
import { act, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { router } from '@/router'
import type { LessonDetailDto } from '@/api/types'
import {
  EXAMPLE_CONFIGURABLE,
  JOB_SWEEP,
  MODULES,
  QUIZ,
  SYSTEM_INFO,
  envelope,
  jsonResponse,
} from './fixtures/rest'

const LESSON: LessonDetailDto = {
  id: 'spmd',
  module_id: 'm2',
  order: 3,
  title: 'π con patrón SPMD (false sharing)',
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

// fetch stub: enruta por URL a los fixtures del contrato (con envelope).
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input)
  if (url.endsWith('/health')) {
    return Promise.resolve(jsonResponse({ status: 'ok', checks: { db: true, docker: true, runner_image: true } }))
  }
  if (url.endsWith('/api/v1/system')) return Promise.resolve(jsonResponse(envelope(SYSTEM_INFO)))
  if (url.endsWith('/api/v1/modules')) return Promise.resolve(jsonResponse(envelope(MODULES)))
  if (url.endsWith('/api/v1/examples')) return Promise.resolve(jsonResponse(envelope({ examples: [] })))
  if (url.includes('/api/v1/examples/')) return Promise.resolve(jsonResponse(envelope(EXAMPLE_CONFIGURABLE)))
  if (url.includes('/quiz')) return Promise.resolve(jsonResponse(envelope(QUIZ)))
  if (url.includes('/api/v1/lessons/')) return Promise.resolve(jsonResponse(envelope(LESSON)))
  if (/\/api\/v1\/jobs\/[^/?]+$/.test(url.split('?')[0])) {
    return Promise.resolve(jsonResponse(envelope(JOB_SWEEP)))
  }
  if (url.includes('/api/v1/jobs')) {
    return Promise.resolve(
      jsonResponse({ success: true, data: { jobs: [] }, error: null, meta: { total: 0, limit: 50, offset: 0 } }),
    )
  }
  return Promise.resolve(jsonResponse(envelope(null)))
}

const originalFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = fakeFetch as typeof fetch
})
afterAll(() => {
  globalThis.fetch = originalFetch
})

async function goto(path: string): Promise<void> {
  await act(async () => {
    await router.navigate(path)
  })
}

describe('router (smoke de las 7 rutas)', () => {
  it('índice: skeleton de Suspense y luego HomeScreen', async () => {
    await goto('/')
    render(<RouterProvider router={router} />)
    // Primer render suspende → ScreenSkeleton.
    expect(screen.getByRole('status', { name: /Cargando pantalla/i })).toBeInTheDocument()
    expect(await screen.findByText(/Aprende programación paralela/, undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('/simulador → SimulatorScreen (idle)', async () => {
    render(<RouterProvider router={router} />)
    await goto('/simulador')
    expect(await screen.findByText('Configura y lanza tu ejecución', undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('/resultados → ResultsList', async () => {
    render(<RouterProvider router={router} />)
    await goto('/resultados')
    expect(await screen.findByText('Historial de ejecuciones', undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('/resultados/:jobId → ResultsScreen (detalle)', async () => {
    render(<RouterProvider router={router} />)
    await goto(`/resultados/${JOB_SWEEP.job_id}`)
    expect(await screen.findByText(/Resultados · transporteMonteCarlo\.py/, undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('/aprender → CatalogScreen', async () => {
    render(<RouterProvider router={router} />)
    await goto('/aprender')
    expect(await screen.findByText('Catálogo de contenidos', undefined, { timeout: 8000 })).toBeInTheDocument()
  })

  it('/aprender/:leccionId → LearnScreen', async () => {
    render(<RouterProvider router={router} />)
    await goto('/aprender/spmd')
    expect(await screen.findByRole('heading', { name: /π con patrón SPMD/ }, { timeout: 8000 })).toBeInTheDocument()
  })

  it('ruta desconocida redirige a la Home', async () => {
    render(<RouterProvider router={router} />)
    await goto('/no-existe')
    expect(await screen.findByText(/Aprende programación paralela/, undefined, { timeout: 8000 })).toBeInTheDocument()
  })
})
