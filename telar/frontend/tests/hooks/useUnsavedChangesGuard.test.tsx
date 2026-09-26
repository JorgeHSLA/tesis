// useUnsavedChangesGuard — una sola guarda de «cambios sin guardar» para toda
// la Autoría (CU-13.1, 14.1, 17.3, 18.4, 21.2, 39.4, 40.2): bloquea TODA
// navegación del router (también la que solo cambia la query), avisa al
// recargar/cerrar (beforeunload) y ofrece `confirm()` para cerrar un modal.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { createMemoryRouter, Link, RouterProvider, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'

function Editor({ onAction = () => {} }: { onAction?: () => void }) {
  const [dirty, setDirty] = useState(false)
  const guard = useUnsavedChangesGuard(dirty)
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <span data-testid="donde">{location.pathname + location.search}</span>
      <button onClick={() => setDirty(true)}>ensuciar</button>
      <button onClick={() => setDirty(false)}>limpiar</button>
      <Link to="/otra">a otra ruta</Link>
      <Link to="/editor?pestana=2">misma ruta, otra query</Link>
      <button onClick={() => guard.confirm(onAction)}>cerrar modal</button>
      <button
        onClick={() => {
          guard.allowNavigation()
          navigate('/otra')
        }}
      >
        guardar y salir
      </button>
      {guard.dialog}
    </div>
  )
}

function renderEditor(onAction?: () => void) {
  const router = createMemoryRouter(
    [
      { path: '/editor', element: <Editor onAction={onAction} /> },
      { path: '/otra', element: <div>OTRA</div> },
    ],
    { initialEntries: ['/editor'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

const dialogo = () => screen.queryByRole('dialog')

describe('useUnsavedChangesGuard · navegación', () => {
  it('sin cambios navega libremente', async () => {
    renderEditor()
    fireEvent.click(screen.getByText('a otra ruta'))
    expect(await screen.findByText('OTRA')).toBeInTheDocument()
  })

  it('con cambios bloquea y pregunta; «Seguir editando» se queda', async () => {
    renderEditor()
    fireEvent.click(screen.getByText('ensuciar'))
    fireEvent.click(screen.getByText('a otra ruta'))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Cambios sin guardar')
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(dialogo()).toBeNull())
    expect(screen.getByTestId('donde')).toHaveTextContent('/editor')
  })

  it('«Salir sin guardar» continúa la navegación', async () => {
    renderEditor()
    fireEvent.click(screen.getByText('ensuciar'))
    fireEvent.click(screen.getByText('a otra ruta'))
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }))
    expect(await screen.findByText('OTRA')).toBeInTheDocument()
  })

  it('bloquea también la navegación que solo cambia la query', async () => {
    renderEditor()
    fireEvent.click(screen.getByText('ensuciar'))
    fireEvent.click(screen.getByText('misma ruta, otra query'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('donde')).toHaveTextContent(/^\/editor$/)
  })

  it('bloquea el «atrás» del historial', async () => {
    const router = createMemoryRouter(
      [
        { path: '/antes', element: <div>ANTES</div> },
        { path: '/editor', element: <Editor /> },
      ],
      { initialEntries: ['/antes', '/editor'], initialIndex: 1 },
    )
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByText('ensuciar'))
    await act(async () => {
      await router.navigate(-1)
    })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('ANTES')).toBeNull()
  })

  it('allowNavigation deja pasar la siguiente navegación (guardar y salir)', async () => {
    renderEditor()
    fireEvent.click(screen.getByText('ensuciar'))
    fireEvent.click(screen.getByText('guardar y salir'))
    expect(await screen.findByText('OTRA')).toBeInTheDocument()
    expect(dialogo()).toBeNull()
  })
})

describe('useUnsavedChangesGuard · beforeunload', () => {
  const disparar = () => {
    const evento = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(evento)
    return evento
  }

  it('solo pide confirmación del navegador con cambios', async () => {
    renderEditor()
    expect(disparar().defaultPrevented).toBe(false)
    fireEvent.click(screen.getByText('ensuciar'))
    expect(disparar().defaultPrevented).toBe(true)
    fireEvent.click(screen.getByText('limpiar'))
    expect(disparar().defaultPrevented).toBe(false)
  })
})

describe('useUnsavedChangesGuard · confirm() para modales', () => {
  it('sin cambios ejecuta la acción al momento', () => {
    const accion = vi.fn()
    renderEditor(accion)
    fireEvent.click(screen.getByText('cerrar modal'))
    expect(accion).toHaveBeenCalledTimes(1)
    expect(dialogo()).toBeNull()
  })

  it('con cambios pregunta: cancelar no la ejecuta, confirmar sí', async () => {
    const accion = vi.fn()
    renderEditor(accion)
    fireEvent.click(screen.getByText('ensuciar'))
    fireEvent.click(screen.getByText('cerrar modal'))
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir editando' }))
    expect(accion).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('cerrar modal'))
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }))
    expect(accion).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(dialogo()).toBeNull())
  })
})

describe('useUnsavedChangesGuard · cierre de modal y navegación a la vez', () => {
  it('«Salir sin guardar» resuelve las dos de una vez', async () => {
    const accion = vi.fn()
    const router = renderEditor(accion)
    fireEvent.click(screen.getByText('ensuciar'))
    fireEvent.click(screen.getByText('cerrar modal'))
    await screen.findByRole('dialog')
    await act(async () => {
      void router.navigate('/otra')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }))
    expect(accion).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('OTRA')).toBeInTheDocument()
  })
})

