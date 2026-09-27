// S2 · disponibilidad y completitud en la vista de lección:
// - LessonSidebar: una lección deshabilitada no se abre; denominador = habilitadas.
// - TracksCard: mismo denominador.
// - MarkReadCard: «Marcar como completada» → PUT {viewed, completed}.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ModuleDto } from '@/api/types'
import { MODULES, MODULES_CON_LECTURA } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({ getModules: vi.fn(), putLessonProgress: vi.fn() }))

import { getModules, putLessonProgress } from '@/api/content'
import { LessonSidebar } from '@/features/learn/LessonSidebar'
import { MarkReadCard } from '@/features/learn/MarkReadCard'
import { TracksCard } from '@/features/learn/TracksCard'
import { useProgressStore } from '@/stores/progressStore'

function moduloConDeshabilitada(): ModuleDto {
  const mod = structuredClone(MODULES.modules[0])
  mod.lessons[0].progress.completed = true
  mod.lessons[1].enabled = false
  return mod
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES_CON_LECTURA))
  ;(putLessonProgress as Mock).mockResolvedValue({})
  useProgressStore.setState({ modules: structuredClone(MODULES_CON_LECTURA.modules), summary: null })
})

describe('LessonSidebar', () => {
  it('la lección deshabilitada no se puede abrir y no cuenta en el total', () => {
    render(
      <MemoryRouter>
        <LessonSidebar module={moduloConDeshabilitada()} currentLessonId="spmd" examplesIndex={null} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /El arreglo: critical/ })).toBeDisabled()
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})

describe('TracksCard', () => {
  it('el denominador son las lecciones habilitadas', () => {
    render(<TracksCard modules={[moduloConDeshabilitada()]} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('1 de 1 lección')).toBeInTheDocument()
  })
})

describe('MarkReadCard', () => {
  it('«Marcar como completada» envía {viewed:true, completed:true} y refresca', async () => {
    render(<MarkReadCard lessonId="queEsUnHilo" completed={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como completada' }))
    await waitFor(() =>
      expect(putLessonProgress).toHaveBeenCalledWith('queEsUnHilo', { viewed: true, completed: true }),
    )
    await waitFor(() => expect(getModules).toHaveBeenCalledTimes(1))
  })

  it('si el PUT falla muestra el error y deja reintentar', async () => {
    ;(putLessonProgress as Mock).mockRejectedValueOnce(new Error('red caída'))
    render(<MarkReadCard lessonId="queEsUnHilo" completed={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como completada' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar')
    expect(screen.getByRole('button', { name: 'Marcar como completada' })).toBeEnabled()
  })

  it('completada: sin botón', () => {
    render(<MarkReadCard lessonId="queEsUnHilo" completed />)
    expect(screen.queryByRole('button', { name: 'Marcar como completada' })).not.toBeInTheDocument()
    expect(screen.getByText('Lección completada.')).toBeInTheDocument()
  })
})
