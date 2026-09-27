// S6 · CU-28 — Autoría de pasos de un taller: añadir, editar, reordenar y
// borrar (con ejemplo opcional), el borrador cuenta como cambio sin guardar y el
// diálogo de borrar no se cierra con la operación en vuelo.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  addWorkshopStep: vi.fn(),
  updateWorkshopStep: vi.fn(),
  reorderWorkshopSteps: vi.fn(),
  deleteWorkshopStep: vi.fn(),
}))
vi.mock('@/api/content', () => ({ getExamples: vi.fn() }))

import { addWorkshopStep, deleteWorkshopStep, reorderWorkshopSteps, updateWorkshopStep } from '@/api/admin'
import type { AdminWorkshopStepDto } from '@/api/admin-types'
import { ApiError } from '@/api/client'
import { getExamples } from '@/api/content'
import { moveOrder, WorkshopStepsEditor } from '@/features/admin/lesson/WorkshopStepsEditor'

function paso(idx: number, over: Partial<AdminWorkshopStepDto> = {}): AdminWorkshopStepDto {
  return { idx, title: `Paso ${idx + 1}`, body_markdown: `Haz ${idx + 1}.`, example_id: null, ...over }
}

function respuesta(steps: AdminWorkshopStepDto[]) {
  return { lesson_id: 'tallerHilos', steps }
}

function montar(steps: AdminWorkshopStepDto[] = [paso(0), paso(1)]) {
  const onDirty = vi.fn()
  const onSteps = vi.fn()
  render(
    <WorkshopStepsEditor
      lessonId="tallerHilos"
      moduleId="m1"
      steps={steps}
      onDraftDirtyChange={onDirty}
      onStepsChange={onSteps}
    />,
  )
  return { onDirty, onSteps }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getExamples as Mock).mockResolvedValue({
    examples: [
      { id: 'primerEjemplo', title: 'Hola mundo paralelo', module_id: 'm1' },
      { id: 'otroModulo', title: 'De otro módulo', module_id: 'm2' },
    ],
  })
})

describe('moveOrder', () => {
  it('mueve un paso y devuelve la permutación para el PUT', () => {
    expect(moveOrder(3, 0, 1)).toEqual([1, 0, 2])
    expect(moveOrder(3, 2, 1)).toEqual([0, 2, 1])
  })
})

describe('WorkshopStepsEditor', () => {
  it('el selector de ejemplo solo ofrece los del módulo de la lección', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Añadir paso/ }))
    await screen.findByRole('option', { name: 'Hola mundo paralelo (primerEjemplo)' })
    expect(screen.queryByRole('option', { name: 'De otro módulo (otroModulo)' })).not.toBeInTheDocument()
  })

  it('vuelve a pedir la lista de ejemplos cuando cambia examplesVersion', async () => {
    const { rerender } = render(<WorkshopStepsEditor lessonId="tallerHilos" moduleId="m1" steps={[]} examplesVersion={0} />)
    await waitFor(() => expect(getExamples).toHaveBeenCalledTimes(1))
    ;(getExamples as Mock).mockResolvedValue({
      examples: [{ id: 'nuevo', title: 'Recién creado', module_id: 'm1' }],
    })
    rerender(<WorkshopStepsEditor lessonId="tallerHilos" moduleId="m1" steps={[]} examplesVersion={1} />)
    await waitFor(() => expect(getExamples).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: /Añadir paso/ }))
    expect(await screen.findByRole('option', { name: 'Recién creado (nuevo)' })).toBeInTheDocument()
  })

  it('sin pasos muestra un estado vacío', () => {
    montar([])
    expect(screen.getByText('Este taller aún no tiene pasos.')).toBeInTheDocument()
  })

  it('añade un paso con ejemplo opcional', async () => {
    ;(addWorkshopStep as Mock).mockResolvedValue(
      respuesta([paso(0), paso(1), paso(2, { title: 'Ejecuta', example_id: 'primerEjemplo' })]),
    )
    const { onDirty, onSteps } = montar()
    fireEvent.click(screen.getByRole('button', { name: /Añadir paso/ }))
    fireEvent.change(screen.getByLabelText('Título del paso'), { target: { value: 'Ejecuta' } })
    fireEvent.change(screen.getByLabelText('Instrucciones (Markdown)'), { target: { value: 'Pulsa **Ejecutar**.' } })
    await screen.findByRole('option', { name: 'Hola mundo paralelo (primerEjemplo)' })
    fireEvent.change(screen.getByLabelText('Ejemplo (opcional)'), { target: { value: 'primerEjemplo' } })
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true))

    fireEvent.click(screen.getByRole('button', { name: 'Guardar paso' }))

    await waitFor(() =>
      expect(addWorkshopStep).toHaveBeenCalledWith('tallerHilos', {
        title: 'Ejecuta',
        body_markdown: 'Pulsa **Ejecutar**.',
        example_id: 'primerEjemplo',
      }),
    )
    expect(await screen.findByText('Ejecuta')).toBeInTheDocument()
    expect(screen.getByText('ejemplo: primerEjemplo')).toBeInTheDocument()
    expect(onSteps).toHaveBeenCalled()
    await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false))
  })

  it('edita un paso existente', async () => {
    ;(updateWorkshopStep as Mock).mockResolvedValue(respuesta([paso(0), paso(1, { title: 'Otro título' })]))
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar paso 2' }))
    expect(screen.getByLabelText('Título del paso')).toHaveValue('Paso 2')
    fireEvent.change(screen.getByLabelText('Título del paso'), { target: { value: 'Otro título' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar paso' }))
    await waitFor(() =>
      expect(updateWorkshopStep).toHaveBeenCalledWith('tallerHilos', 1, {
        title: 'Otro título',
        body_markdown: 'Haz 2.',
        example_id: null,
      }),
    )
    expect(await screen.findByText('Otro título')).toBeInTheDocument()
  })

  it('reordena con Subir/Bajar', async () => {
    ;(reorderWorkshopSteps as Mock).mockResolvedValue(respuesta([paso(0, { title: 'Paso 2' }), paso(1, { title: 'Paso 1' })]))
    montar()
    expect(screen.getByRole('button', { name: 'Subir paso 1' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Bajar paso 1' }))
    await waitFor(() => expect(reorderWorkshopSteps).toHaveBeenCalledWith('tallerHilos', [1, 0]))
  })

  it('borra con confirmación y el diálogo no se cierra con la operación en vuelo', async () => {
    let resolver: (v: unknown) => void = () => {}
    ;(deleteWorkshopStep as Mock).mockReturnValue(new Promise((r) => (resolver = r)))
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar paso 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Borrar paso' }))
    expect(deleteWorkshopStep).toHaveBeenCalledWith('tallerHilos', 0)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => resolver(respuesta([paso(0, { title: 'Paso 2' })])))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Paso 1')).not.toBeInTheDocument()
  })

  it('un 422 del paso se muestra junto a su campo', async () => {
    ;(addWorkshopStep as Mock).mockRejectedValue(
      new ApiError('CONTENT_VALIDATION_ERROR', 'Contenido inválido', 422, [
        { field: 'body_markdown', reason: 'HTML no permitido' },
      ]),
    )
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Añadir paso/ }))
    fireEvent.change(screen.getByLabelText('Título del paso'), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText('Instrucciones (Markdown)'), { target: { value: '<b>x</b>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar paso' }))
    expect(await screen.findByText('HTML no permitido')).toBeInTheDocument()
    // El borrador sigue abierto: nada se perdió.
    expect(screen.getByLabelText('Título del paso')).toHaveValue('X')
  })
})

describe('WorkshopStepsEditor · borrador abierto', () => {
  it('con un paso en edición no se puede borrar ni mover otro (su idx quedaría desfasado)', () => {
    montar([paso(0), paso(1), paso(2)])
    fireEvent.click(screen.getByRole('button', { name: 'Editar paso 3' }))
    expect(screen.getByRole('button', { name: 'Borrar paso 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar paso 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Subir paso 2' })).toBeDisabled()
  })
})
