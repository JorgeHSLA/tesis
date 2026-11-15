// Pasar a «Código propio» tras tener un ejemplo cargado: el nombre de archivo
// vuelve al valor por defecto del simulador (el de abrirlo en blanco) y el
// código escrito no se toca.
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

beforeEach(() => {
  vi.clearAllMocks()
  ;(getModules as Mock).mockResolvedValue(structuredClone(MODULES))
  ;(getExample as Mock).mockResolvedValue({
    ...EXAMPLE_CONFIGURABLE,
    filename: 'helloOpenMP.py',
    source_code: '# hola\n',
  })
})

describe('SimulatorIdle · «Código propio»', () => {
  it('vuelve al nombre de archivo por defecto sin tocar el código', async () => {
    const router = createMemoryRouter([{ path: '/simulador', element: <SimulatorIdle /> }], {
      initialEntries: ['/simulador'],
    })
    render(<RouterProvider router={router} />)
    const [selector] = await screen.findAllByLabelText('Ejemplo del curso')
    await waitFor(() => expect(screen.getAllByText('helloOpenMP.py').length).toBeGreaterThan(0))
    const editor = screen.getByRole('textbox', { name: 'Editor de código Python' })
    await waitFor(() => expect(editor).toHaveValue('# hola\n'))

    fireEvent.change(selector, { target: { value: '' } })

    expect(screen.queryAllByText('helloOpenMP.py')).toHaveLength(0)
    expect(screen.getAllByText('main.py').length).toBeGreaterThan(0)
    expect(editor).toHaveValue('# hola\n')
  })

  it('si el código separa a t0 del resto (if tid == 0 / else), lo dice; si no, calla', async () => {
    const router = createMemoryRouter([{ path: '/simulador', element: <SimulatorIdle /> }], {
      initialEntries: ['/simulador'],
    })
    render(<RouterProvider router={router} />)
    const editor = await screen.findByRole('textbox', { name: 'Editor de código Python' })
    await waitFor(() => expect(editor).toHaveValue('# hola\n'))
    expect(screen.queryByText(/t0 coordina y el resto trabaja/)).toBeNull()

    const separa = ['tid = omp_get_thread_num()', 'if tid == 0:', '    coordinar()', 'else:', '    trabajar()'].join('\n')
    fireEvent.change(editor, { target: { value: separa } })
    expect(await screen.findByText(/t0 coordina y el resto trabaja/)).toBeInTheDocument()
    expect(document.querySelector('.topology-viz')?.textContent).toContain('t0 · maestro · coordina')

    fireEvent.change(editor, { target: { value: 'print(1)\n' } })
    await waitFor(() => expect(screen.queryByText(/t0 coordina y el resto trabaja/)).toBeNull())
  })
})
