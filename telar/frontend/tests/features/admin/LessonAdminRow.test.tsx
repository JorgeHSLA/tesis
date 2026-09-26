// LessonAdminRow — el botón de ejemplo depende de si la lección lo tiene.
// Antes navegaba a /admin/ejemplos/null en una lección sin ejemplo (CU-18.2).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({ deleteLesson: vi.fn() }))

import { deleteLesson } from '@/api/admin'
import { LessonAdminRow } from '@/features/admin/dashboard/LessonAdminRow'

const borrarMock = deleteLesson as Mock

const LESSON = {
  id: 'hola', order: 1, title: 'Hola hilos', example_id: 'hola-ej', has_quiz: false,
  has_video: false, quiz_question_count: 0, estimated_minutes: 5, enabled: true,
  completion_rule: 'quiz' as const,
  progress: { completed: false, completed_at: null, best_score: null, quiz_attempts: 0 },
}

function Destino() {
  const loc = useLocation()
  return <div data-testid="destino">{loc.pathname + loc.search}</div>
}

function renderRow(
  lesson: typeof LESSON | (Omit<typeof LESSON, 'example_id'> & { example_id: null }),
  onReload = vi.fn(),
) {
  const router = createMemoryRouter(
    [
      { path: '/admin', element: <LessonAdminRow lesson={lesson as never} onReload={onReload} onToast={vi.fn()} /> },
      { path: '*', element: <Destino /> },
    ],
    { initialEntries: ['/admin'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('LessonAdminRow · ejemplo', () => {
  it('con ejemplo abre su editor', async () => {
    renderRow(LESSON)
    fireEvent.click(screen.getByRole('button', { name: 'Ejemplo' }))
    expect(await screen.findByTestId('destino')).toHaveTextContent('/admin/ejemplos/hola-ej')
  })

  it('sin ejemplo ofrece agregarlo en el editor de la lección', async () => {
    renderRow({ ...LESSON, example_id: null })
    expect(screen.queryByRole('button', { name: 'Ejemplo' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar ejemplo' }))
    const destino = await screen.findByTestId('destino')
    expect(destino).toHaveTextContent('/admin/lecciones/hola?ejemplo=nuevo')
    expect(destino).not.toHaveTextContent('null')
  })
})

// CU-20.1: la advertencia nombra solo lo que la lección tiene de verdad.
describe('LessonAdminRow · advertencia al borrar', () => {
  it.each([
    ['hola-ej', true, 'junto con su ejemplo y su quiz'],
    ['hola-ej', false, 'junto con su ejemplo y el progreso'],
    [null, true, 'junto con su quiz y el progreso'],
  ] as const)('ejemplo=%s quiz=%s → «%s»', async (example_id, has_quiz, texto) => {
    renderRow({ ...LESSON, example_id, has_quiz } as never)
    fireEvent.click(screen.getByRole('button', { name: /^Borrar/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(texto)
  })

  it('una lección sin ejemplo ni quiz no promete borrar ninguno', async () => {
    renderRow({ ...LESSON, example_id: null, has_quiz: false } as never)
    fireEvent.click(screen.getByRole('button', { name: /^Borrar/ }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).not.toHaveTextContent('ejemplo')
    expect(dialogo).not.toHaveTextContent('quiz')
    expect(dialogo).toHaveTextContent('Se eliminará "Hola hilos" y el progreso de los estudiantes en ella.')
  })
})

// «Borrar lección» — con el DELETE en vuelo, Escape y el fondo no cierran el
// diálogo (mismo patrón que «Borrar módulo» en ModuleGroup).
describe('LessonAdminRow · borrar con el DELETE en vuelo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Promesa controlable: el DELETE queda pendiente hasta que el test lo diga. */
  function pendiente() {
    let resolver!: (v: unknown) => void
    const promesa = new Promise((r) => {
      resolver = r
    })
    return { promesa, resolver }
  }

  async function abrirYConfirmar() {
    fireEvent.click(screen.getByRole('button', { name: /^Borrar$/ }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Borrar lección' }))
    await waitFor(() => expect(borrarMock).toHaveBeenCalledWith('hola'))
    return dialogo
  }

  it('Escape no cierra el diálogo mientras borra; al resolver, se cierra', async () => {
    const { promesa, resolver } = pendiente()
    borrarMock.mockReturnValue(promesa)
    const onReload = vi.fn()
    renderRow(LESSON, onReload)
    await abrirYConfirmar()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      resolver(undefined)
      await promesa
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onReload).toHaveBeenCalled()
  })

  it('el clic en el fondo tampoco lo cierra mientras borra', async () => {
    const { promesa, resolver } = pendiente()
    borrarMock.mockReturnValue(promesa)
    renderRow(LESSON)
    const dialogo = await abrirYConfirmar()

    fireEvent.mouseDown(dialogo.parentElement as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      resolver(undefined)
      await promesa
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin borrado en curso, Escape cancela como siempre', async () => {
    renderRow(LESSON)
    fireEvent.click(screen.getByRole('button', { name: /^Borrar$/ }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(borrarMock).not.toHaveBeenCalled()
  })
})
