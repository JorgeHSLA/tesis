// ModuleFormDialog — errores por campo (CU-13.3, 14.3): las comprobaciones del
// cliente son las del schema y un 422 del backend (pydantic o de negocio) se
// muestra junto a su campo, no como el genérico «no son válidos».
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({ createModule: vi.fn(), updateModule: vi.fn() }))

import { createModule, updateModule } from '@/api/admin'
import { ApiError } from '@/api/client'
import { ModuleFormDialog } from '@/features/admin/dashboard/ModuleFormDialog'

const MODULE = {
  id: 'm1', order: 1, title: 'Fundamentos', description: 'd', level: 'Intro',
  version: 1, origin: 'local' as const, update_available: null, lessons: [],
}

function renderDialog(mode: 'create' | 'edit') {
  const dialogo =
    mode === 'edit' ? (
      <ModuleFormDialog mode="edit" initial={MODULE as never} onClose={vi.fn()} onSaved={vi.fn()} />
    ) : (
      <ModuleFormDialog mode="create" existingIds={[]} defaultOrder={2} onClose={vi.fn()} onSaved={vi.fn()} />
    )
  render(<RouterProvider router={createMemoryRouter([{ path: '/', element: dialogo }])} />)
}

beforeEach(() => vi.clearAllMocks())

describe('ModuleFormDialog · validación del cliente', () => {
  it('sin título ni nivel marca ambos campos y no envía', async () => {
    renderDialog('create')
    fireEvent.click(screen.getByRole('button', { name: 'Crear módulo' }))
    expect(await screen.findByText('Escribe un título.')).toBeInTheDocument()
    expect(screen.getByText('Escribe el nivel.')).toBeInTheDocument()
    expect(createModule).not.toHaveBeenCalled()
  })

  it('un orden decimal se marca en su campo', async () => {
    renderDialog('edit')
    fireEvent.change(screen.getByLabelText('Orden'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/El orden debe ser un número entero entre 1 y 10000/)).toBeInTheDocument()
    expect(updateModule).not.toHaveBeenCalled()
  })

  it('corregir el campo quita su error', async () => {
    renderDialog('edit')
    fireEvent.change(screen.getByLabelText('Nivel'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText('Escribe el nivel.')
    fireEvent.change(screen.getByLabelText('Nivel'), { target: { value: 'Avanzado' } })
    await waitFor(() => expect(screen.queryByText('Escribe el nivel.')).toBeNull())
  })
})

describe('ModuleFormDialog · corregir un campo no toca los demás', () => {
  it('escribir el título quita su error y deja el del nivel', async () => {
    renderDialog('create')
    fireEvent.click(screen.getByRole('button', { name: 'Crear módulo' }))
    await screen.findByText('Escribe un título.')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nuevo' } })
    expect(screen.queryByText('Escribe un título.')).toBeNull()
    expect(screen.getByText('Escribe el nivel.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nivel'), { target: { value: 'Intro' } })
    expect(screen.queryByText('Escribe el nivel.')).toBeNull()
  })
})

describe('ModuleFormDialog · errores del backend', () => {
  it('lee details de un 422 de pydantic y lo pone junto al campo', async () => {
    ;(updateModule as Mock).mockRejectedValue(
      new ApiError('VALIDATION_ERROR', 'El cuerpo o los parámetros de la petición no son válidos.', 422, [
        { type: 'string_too_long', loc: ['body', 'description'], msg: 'String should have at most 2000 characters' },
      ]),
    )
    renderDialog('edit')
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'otra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('El texto es demasiado largo.')).toBeInTheDocument()
    expect(screen.queryByText(/no son válidos/)).toBeNull()
  })

  it('ORDER_CONFLICT se marca en el campo Orden', async () => {
    ;(updateModule as Mock).mockRejectedValue(new ApiError('ORDER_CONFLICT', 'El order 3 ya está en uso.', 409))
    renderDialog('edit')
    fireEvent.change(screen.getByLabelText('Orden'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Ese número de orden ya está en uso por otro módulo.')).toBeInTheDocument()
  })
})
