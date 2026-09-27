// S6 · CU-28 — la vista de pasos del taller: retomar en el primer paso sin
// marcar, casilla optimista que se revierte si el guardado falla, avance y
// «Taller completado» cuando el servidor lo confirma.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LessonDetailDto, WorkshopStepDto } from '@/api/types'
import { MODULES_CON_LECTURA, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({
  getLesson: vi.fn(),
  getExample: vi.fn(),
  loadExamplesIndex: vi.fn(),
  getModules: vi.fn(),
  putLessonProgress: vi.fn(),
  putWorkshopStep: vi.fn(),
}))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: SYSTEM_INFO, error: null, loading: false, retry: vi.fn() }),
}))

import { getLesson, getModules, loadExamplesIndex, putLessonProgress, putWorkshopStep } from '@/api/content'
import LearnScreen from '@/features/learn/LearnScreen'
import { firstPending, WorkshopSteps } from '@/features/learn/WorkshopSteps'
import { useProgressStore } from '@/stores/progressStore'

function pasos(...hechos: boolean[]): WorkshopStepDto[] {
  return hechos.map((done, idx) => ({
    idx,
    title: `Paso ${idx + 1}`,
    body_markdown: `Instrucción ${idx + 1}.`,
    example_id: idx === 0 ? 'primerEjemplo' : null,
    done,
  }))
}

function montarPasos(steps: WorkshopStepDto[], over: { completed?: boolean; countsForProgress?: boolean } = {}) {
  const router = createMemoryRouter(
    [
      {
        path: '/aprender/:leccionId',
        element: (
          <WorkshopSteps
            lessonId="tallerHilos"
            steps={steps}
            completed={over.completed ?? false}
            countsForProgress={over.countsForProgress ?? true}
          />
        ),
      },
      { path: '/simulador', element: <p>simulador abierto</p> },
    ],
    { initialEntries: ['/aprender/tallerHilos'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

function resultado(idx: number, done: boolean, stepsDone: number, total: number, completed = false) {
  return { lesson_id: 'tallerHilos', idx, done, steps_done: stepsDone, steps_total: total, completed }
}

beforeEach(() => {
  vi.clearAllMocks()
  useProgressStore.setState({ modules: null, summary: null, lastLessonId: null, loading: false, error: null })
  ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES_CON_LECTURA))
  ;(loadExamplesIndex as Mock).mockResolvedValue(new Map())
  ;(putLessonProgress as Mock).mockResolvedValue({})
})

describe('firstPending', () => {
  it('es el primer paso sin marcar, o el último si están todos', () => {
    expect(firstPending(pasos(true, false, false))).toBe(1)
    expect(firstPending(pasos(true, true))).toBe(1)
    expect(firstPending([])).toBe(0)
  })
})

describe('WorkshopSteps', () => {
  it('al volver se abre en el primer paso sin marcar', () => {
    montarPasos(pasos(true, false, false))
    expect(screen.getByRole('heading', { name: 'Paso 2 de 3' })).toBeInTheDocument()
    expect(screen.getByText('Instrucción 2.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Avance del taller' })).toHaveAttribute('aria-valuenow', '1')
  })

  it('marcar guarda la casilla y avanza al siguiente paso pendiente', async () => {
    ;(putWorkshopStep as Mock).mockResolvedValue(resultado(0, true, 1, 3))
    montarPasos(pasos(false, false, false))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lo hice' }))
    expect(putWorkshopStep).toHaveBeenCalledWith('tallerHilos', 0, true)
    expect(await screen.findByRole('heading', { name: 'Paso 2 de 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paso 1: Paso 1 (hecho)' })).toBeInTheDocument()
    expect(screen.getByText('1/3 pasos')).toBeInTheDocument()
  })

  it('si falla el guardado, la casilla se desmarca y aparece un aviso', async () => {
    ;(putWorkshopStep as Mock).mockRejectedValue(new Error('red caída'))
    montarPasos(pasos(false, false))
    const casilla = screen.getByRole('checkbox', { name: 'Lo hice' })
    fireEvent.click(casilla)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el paso 1')
    expect(screen.getByRole('checkbox', { name: 'Lo hice' })).not.toBeChecked()
    expect(screen.getByText('0/2 pasos')).toBeInTheDocument()
    expect(screen.queryByText('Taller completado.')).not.toBeInTheDocument()
  })

  it('mientras se guarda, la casilla no se puede volver a pulsar', async () => {
    let resolver: (v: unknown) => void = () => {}
    ;(putWorkshopStep as Mock).mockReturnValue(new Promise((r) => (resolver = r)))
    montarPasos(pasos(false, false))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lo hice' }))
    expect(screen.getByRole('checkbox', { name: 'Guardando…' })).toBeDisabled()
    await act(async () => resolver(resultado(0, true, 1, 2)))
    expect(putWorkshopStep).toHaveBeenCalledTimes(1)
  })

  it('al marcar el último paso muestra «Taller completado» y refresca el progreso', async () => {
    ;(putWorkshopStep as Mock).mockResolvedValue(resultado(1, true, 2, 2, true))
    montarPasos(pasos(true, false))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lo hice' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Taller completado.')
    await waitFor(() => expect(getModules).toHaveBeenCalled())
  })

  it('desmarcar no descompleta: el aviso de completado se mantiene', async () => {
    ;(putWorkshopStep as Mock).mockResolvedValue(resultado(1, false, 1, 2, true))
    montarPasos(pasos(true, true), { completed: true })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lo hice' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Lo hice' })).not.toBeChecked())
    expect(screen.getByRole('status')).toHaveTextContent('Taller completado.')
    // Completar no se pierde, pero se dice cuántos pasos quedan marcados ahora.
    expect(screen.getByRole('status')).toHaveTextContent('Ahora tienes 1/2 pasos marcados.')
  })

  it('un paso con ejemplo ofrece «Abrir en el simulador»', async () => {
    const { router } = montarPasos(pasos(false, false))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir en el simulador' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/simulador'))
    expect(router.state.location.search).toBe('?ejemplo=primerEjemplo')
  })

  it('un paso sin ejemplo no ofrece el simulador', () => {
    montarPasos(pasos(true, false))
    expect(screen.queryByRole('button', { name: 'Abrir en el simulador' })).not.toBeInTheDocument()
  })

  it('se puede navegar entre pasos desde la lista', () => {
    montarPasos(pasos(false, false, false))
    fireEvent.click(screen.getByRole('button', { name: 'Paso 3: Paso 3' }))
    expect(screen.getByRole('heading', { name: 'Paso 3 de 3' })).toBeInTheDocument()
  })

  it('un taller no disponible avisa de que no cuenta', () => {
    montarPasos(pasos(false), { countsForProgress: false })
    expect(screen.getByText(/no cuenta para tu progreso/)).toBeInTheDocument()
  })

  it('un taller sin pasos muestra un estado vacío', () => {
    montarPasos([])
    expect(screen.getByText('Este taller todavía no tiene pasos.')).toBeInTheDocument()
  })
})

describe('LearnScreen · taller', () => {
  function taller(over: Partial<LessonDetailDto> = {}): LessonDetailDto {
    return {
      id: 'tallerHilos',
      module_id: 'f1',
      order: 2,
      title: 'Taller: tus primeros hilos',
      content_markdown: '# Introducción\n\nSigue los pasos.',
      video_url: null,
      example_id: null,
      has_quiz: false,
      quiz_question_count: 0,
      estimated_minutes: 20,
      enabled: true,
      completion_rule: 'viewed',
      archived: false,
      prev_lesson_id: null,
      next_lesson_id: null,
      recommended: [],
      progress: { viewed: false, completed: false, best_quiz_score: null, quiz_total: 0 },
      kind: 'taller',
      steps: pasos(false, false),
      ...over,
    }
  }

  function montar() {
    const router = createMemoryRouter([{ path: '/aprender/:leccionId', element: <LearnScreen /> }], {
      initialEntries: ['/aprender/tallerHilos'],
    })
    return render(<RouterProvider router={router} />)
  }

  it('muestra los pasos, el chip «Taller» y no el botón de leída', async () => {
    ;(getLesson as Mock).mockResolvedValue(taller())
    montar()
    expect(await screen.findByRole('heading', { name: 'Paso 1 de 2' })).toBeInTheDocument()
    expect(screen.getByText('Taller')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar como completada' })).not.toBeInTheDocument()
  })

  it('una lección normal no muestra pasos', async () => {
    ;(getLesson as Mock).mockResolvedValue(taller({ kind: undefined, steps: undefined }))
    montar()
    await screen.findByRole('heading', { name: 'Taller: tus primeros hilos' })
    expect(screen.queryByRole('checkbox', { name: 'Lo hice' })).not.toBeInTheDocument()
  })
})

describe('WorkshopSteps · respuestas que llegan tarde', () => {
  it('no devuelve al estudiante al paso que marcó si navegó a otro mientras se guardaba', async () => {
    let resolver: (v: unknown) => void = () => {}
    ;(putWorkshopStep as Mock).mockReturnValue(new Promise((r) => (resolver = r)))
    montarPasos(pasos(false, false, false))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lo hice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Paso 3: Paso 3' }))
    await act(async () => resolver(resultado(0, true, 1, 3)))
    expect(screen.getByRole('heading', { name: 'Paso 3 de 3' })).toBeInTheDocument()
  })
})
