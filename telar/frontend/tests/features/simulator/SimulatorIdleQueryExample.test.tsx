// CU-05.1 · `?ejemplo=X` con /modules caído.
//
// Fija un comportamiento que ya es correcto: el ejemplo pedido por URL no
// depende del catálogo (se carga con GET /examples/X aunque /modules falle), y
// recuperar /modules con «Reintentar» no autoselecciona otro ejemplo ni pisa
// el código que hay en el editor.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { EXAMPLE_CONFIGURABLE, MODULES, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({ getModules: vi.fn(), getExample: vi.fn() }))
vi.mock('@/api/jobs', () => ({ createJob: vi.fn() }))
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({ data: SYSTEM_INFO, error: null, loading: false, retry: vi.fn() }),
}))

import { getExample, getModules } from '@/api/content'
import { SimulatorIdle } from '@/features/simulator/SimulatorIdle'

// En MODULES el primer ejemplo habilitado es `spmd`: pedir otro por URL
// distingue «respeta la URL» de «autoselecciona el primero».
const PEDIDO = 'spmdCritical'
const CODIGO_PEDIDO = '# spmdCritical\n'

function renderIdle() {
  const router = createMemoryRouter(
    [
      { path: '/simulador', element: <SimulatorIdle /> },
      { path: '/simulador/:jobId', element: <div>EN VIVO</div> },
    ],
    { initialEntries: [`/simulador?ejemplo=${PEDIDO}`] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getModules as Mock).mockRejectedValue(new Error('backend caído'))
  ;(getExample as Mock).mockImplementation((id: string) =>
    Promise.resolve({
      ...EXAMPLE_CONFIGURABLE,
      id,
      source_code: id === PEDIDO ? CODIGO_PEDIDO : `# ${id}\n`,
    }),
  )
})

async function editorConElPedido() {
  const editor = await screen.findByRole('textbox', { name: 'Editor de código Python' })
  await waitFor(() => expect(editor).toHaveValue(CODIGO_PEDIDO))
  expect(await screen.findByText(/No se pudieron cargar los ejemplos del curso/)).toBeInTheDocument()
  return editor
}

async function reintentarModulos() {
  ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES))
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
  await waitFor(() => expect(screen.queryByText(/No se pudieron cargar los ejemplos/)).toBeNull())
  expect(getModules).toHaveBeenCalledTimes(2)
}

describe('SimulatorIdle · ?ejemplo=X con /modules caído', () => {
  it('carga el ejemplo de la URL aunque /modules falle', async () => {
    renderIdle()
    await editorConElPedido()
    expect(getExample).toHaveBeenCalledTimes(1)
    expect(getExample).toHaveBeenCalledWith(PEDIDO)
  })

  it('al recuperar /modules no autoselecciona otro ejemplo', async () => {
    renderIdle()
    const editor = await editorConElPedido()
    await reintentarModulos()
    expect(getExample).toHaveBeenCalledTimes(1)
    expect(getExample).not.toHaveBeenCalledWith('spmd')
    expect(editor).toHaveValue(CODIGO_PEDIDO)
  })

  it('al recuperar /modules no pisa el código editado sobre el ejemplo', async () => {
    renderIdle()
    const editor = await editorConElPedido()
    fireEvent.change(editor, { target: { value: 'MI VERSION\n' } })
    await reintentarModulos()
    const after = screen.getByRole('textbox', { name: 'Editor de código Python' })
    expect(after).toBe(editor)
    expect(after).toHaveValue('MI VERSION\n')
    expect(getExample).toHaveBeenCalledTimes(1)
  })
})
