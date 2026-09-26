// ModuleFormDialog — cambios sin guardar (CU-13.1, 14.1, 39.4, 40.2): Escape,
// clic fuera y Cancelar preguntan antes de descartar lo escrito; sin cambios
// cierran al momento. La guarda de «operación en vuelo» se mantiene aparte
// (DialogosOcupados.test.tsx).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/admin', () => ({ createModule: vi.fn(), updateModule: vi.fn() }))

import { ModuleFormDialog } from '@/features/admin/dashboard/ModuleFormDialog'

const MODULE = {
  id: 'm1', order: 1, title: 'Fundamentos', description: 'd', level: 'Intro',
  version: 1, origin: 'local' as const, update_available: null, lessons: [],
}

function renderDialog(mode: 'create' | 'edit' = 'edit') {
  const onClose = vi.fn()
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element:
          mode === 'edit' ? (
            <ModuleFormDialog mode="edit" initial={MODULE as never} onClose={onClose} onSaved={vi.fn()} />
          ) : (
            <ModuleFormDialog mode="create" existingIds={[]} defaultOrder={2} onClose={onClose} onSaved={vi.fn()} />
          ),
      },
      { path: '/otra', element: <div>OTRA</div> },
    ],
    { initialEntries: ['/admin'] },
  )
  render(<RouterProvider router={router} />)
  return { onClose, router }
}

const fondo = () => document.querySelector('.admin-modal-backdrop') as HTMLElement
const pregunta = () => screen.queryByRole('dialog', { name: 'Cambios sin guardar' })

beforeEach(() => vi.clearAllMocks())

describe('ModuleFormDialog · sin cambios', () => {
  it('Escape, clic fuera y Cancelar cierran al momento', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(fondo())
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(pregunta()).toBeNull()
  })
})

describe('ModuleFormDialog · con cambios', () => {
  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['clic fuera', () => fireEvent.mouseDown(fondo())],
    ['Cancelar', () => fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))],
  ])('%s pregunta antes de cerrar', async (_nombre, cerrar) => {
    const { onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Otro título' } })
    cerrar()
    expect(await screen.findByRole('dialog', { name: 'Cambios sin guardar' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('«Seguir editando» conserva lo escrito; «Salir sin guardar» cierra', async () => {
    const { onClose } = renderDialog('create')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Borrador' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(pregunta()).toBeNull())
    expect(screen.getByLabelText('Título')).toHaveValue('Borrador')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape con la pregunta abierta solo cierra la pregunta', async () => {
    const { onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('Nivel'), { target: { value: 'Avanzado' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    await screen.findByRole('dialog', { name: 'Cambios sin guardar' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(pregunta()).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nivel')).toHaveValue('Avanzado')
  })

  it('clic en el fondo de la pregunta no reabre ni cierra el formulario', async () => {
    const { onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'X' } })
    fireEvent.mouseDown(fondo())
    const dialogo = await screen.findByRole('dialog', { name: 'Cambios sin guardar' })
    fireEvent.mouseDown(dialogo.parentElement as HTMLElement)
    await waitFor(() => expect(pregunta()).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('también bloquea la navegación del router', async () => {
    const { router } = renderDialog()
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'X' } })
    void router.navigate('/otra')
    expect(await screen.findByRole('dialog', { name: 'Cambios sin guardar' })).toBeInTheDocument()
    expect(screen.queryByText('OTRA')).toBeNull()
  })
})
