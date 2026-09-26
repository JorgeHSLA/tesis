// CU-05.2 / CU-22.3 — un ejemplo que llega TARDE no pisa lo elegido después.
// El contador de petición de SimulatorIdle (exampleReq) ya lo resolvía; esto lo
// fija: elegir A y luego «Código propio» (o B) y que A responda al final.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const pendientes = new Map<string, (v: unknown) => void>()

function renderIdle() {
  const router = createMemoryRouter([{ path: '/simulador', element: <SimulatorIdle /> }], {
    initialEntries: ['/simulador'],
  })
  render(<RouterProvider router={router} />)
}

const detalle = (id: string) => ({ ...EXAMPLE_CONFIGURABLE, id, source_code: `# ${id}\n` })

beforeEach(() => {
  vi.clearAllMocks()
  pendientes.clear()
  ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES))
  // Cada ejemplo responde cuando el test lo suelta.
  ;(getExample as Mock).mockImplementation(
    (id: string) => new Promise((r) => pendientes.set(id, () => r(detalle(id)))),
  )
})

async function soltar(id: string) {
  await act(async () => {
    pendientes.get(id)?.(undefined)
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('SimulatorIdle · respuestas tardías del selector', () => {
  it('«Código propio» elegido después no lo pisa el ejemplo que llega tarde (CU-05.2)', async () => {
    renderIdle()
    const [selector] = await screen.findAllByLabelText('Ejemplo del curso')
    await waitFor(() => expect(pendientes.size).toBe(1)) // autoselección inicial
    const primero = [...pendientes.keys()][0]
    fireEvent.change(selector, { target: { value: '' } })
    const editor = screen.getByRole('textbox', { name: 'Editor de código Python' })
    fireEvent.change(editor, { target: { value: 'mi_codigo = 1' } })

    await soltar(primero)
    expect(editor).toHaveValue('mi_codigo = 1')
    expect(selector).toHaveValue('')
  })

  it('A y luego B: si A responde después, se queda B (CU-22.3)', async () => {
    renderIdle()
    const [selector] = await screen.findAllByLabelText('Ejemplo del curso')
    await waitFor(() => expect(pendientes.size).toBe(1))
    const opciones = [...(selector as HTMLSelectElement).options].filter((o) => o.value !== '' && !o.disabled)
    const [a, b] = [opciones[1].value, opciones[0].value]
    fireEvent.change(selector, { target: { value: a } })
    fireEvent.change(selector, { target: { value: b } })

    await soltar(b)
    const editor = screen.getByRole('textbox', { name: 'Editor de código Python' })
    await waitFor(() => expect(editor).toHaveValue(`# ${b}\n`))
    await soltar(a)
    expect(editor).toHaveValue(`# ${b}\n`)
  })
})
