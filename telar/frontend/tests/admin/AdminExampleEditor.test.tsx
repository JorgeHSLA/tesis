// tests/admin/AdminExampleEditor.test.tsx — uploader/editor de ejemplo: el
// dropzone rechaza .txt y >256KB y acepta .py (lib/pyfile); submit discrimina
// updateExample (metadatos) vs uploadExampleCode (solo código); y "Probar en
// simulador" navega a #/simulador?ejemplo={id}.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getAdminExample: vi.fn(),
  updateExample: vi.fn(),
  uploadExampleCode: vi.fn(),
}))
vi.mock('@/api/system', () => ({ getSystem: vi.fn() }))

import { getAdminExample, updateExample, uploadExampleCode } from '@/api/admin'
import { getSystem } from '@/api/system'
import AdminExampleEditor from '@/features/admin/example/AdminExampleEditor'

const getAdminExampleMock = getAdminExample as Mock
const updateExampleMock = updateExample as Mock
const uploadExampleCodeMock = uploadExampleCode as Mock
const getSystemMock = getSystem as Mock

const EXAMPLE = {
  id: 'ex-1', module_id: 'm1', order: 1, source_code: 'print(1)\n',
  title: 'Hola', filename: 'hola.py', difficulty: 1, teaches: 'algo', directives: ['parallel'],
  threads_configurable: true, fixed_threads: null, fixed_threads_note: null,
  sweeps_threads: false, self_measures: false, parser_id: 'none',
  default_timeout_s: 60, est_run_seconds: 5, enabled: true, requires_gpu: false,
  expected_output_note: '', takeaways: ['t1'],
}

function SimSpy() {
  return <div>SIMULADOR{useLocation().search}</div>
}

function renderEditor() {
  const router = createMemoryRouter(
    [
      { path: '/admin/ejemplos/:exampleId', element: <AdminExampleEditor /> },
      { path: '/admin', element: <div>PANEL</div> },
      { path: '/simulador', element: <SimSpy /> },
    ],
    { initialEntries: ['/admin/ejemplos/ex-1'] },
  )
  return render(<RouterProvider router={router} />)
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]')
  if (el == null) throw new Error('no file input')
  return el as HTMLInputElement
}

beforeEach(() => {
  vi.clearAllMocks()
  getAdminExampleMock.mockResolvedValue(structuredClone(EXAMPLE))
  getSystemMock.mockResolvedValue({ limits: { max_timeout_s: 120 } })
  updateExampleMock.mockResolvedValue(structuredClone(EXAMPLE))
  uploadExampleCodeMock.mockResolvedValue({ example_id: 'ex-1', filename: 'hola.py', bytes: 10 })
})

describe('AdminExampleEditor · dropzone', () => {
  it('rechaza un archivo que no es .py', async () => {
    const { container } = renderEditor()
    await screen.findByText('Código del ejemplo')
    const file = new File(['hola'], 'notas.txt', { type: 'text/plain' })
    fireEvent.change(fileInput(container), { target: { files: [file] } })
    expect(await screen.findByText('Solo archivos .py')).toBeInTheDocument()
  })

  it('rechaza un .py que supera 256 KB', async () => {
    const { container } = renderEditor()
    await screen.findByText('Código del ejemplo')
    const big = new File([new Uint8Array(262145)], 'grande.py', { type: 'text/x-python' })
    fireEvent.change(fileInput(container), { target: { files: [big] } })
    expect(await screen.findByText('El archivo supera 256 KB')).toBeInTheDocument()
  })

  it('acepta un .py válido y carga su código en el editor', async () => {
    const { container } = renderEditor()
    await screen.findByText('Código del ejemplo')
    const file = new File(['print("nuevo")'], 'nuevo.py', { type: 'text/x-python' })
    fireEvent.change(fileInput(container), { target: { files: [file] } })
    await waitFor(() => {
      const editor = screen.getByLabelText('Editor de código Python del ejemplo') as HTMLTextAreaElement
      expect(editor.value).toBe('print("nuevo")')
    })
  })
})

describe('AdminExampleEditor · guardar', () => {
  it('editar metadatos llama updateExample y no uploadExampleCode', async () => {
    renderEditor()
    const title = (await screen.findByLabelText('Título')) as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Hola 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))

    await waitFor(() => expect(updateExampleMock).toHaveBeenCalledTimes(1))
    const [id, meta] = updateExampleMock.mock.calls[0]
    expect(id).toBe('ex-1')
    expect(meta.title).toBe('Hola 2')
    expect(uploadExampleCodeMock).not.toHaveBeenCalled()
  })

  it('editar solo el código llama uploadExampleCode y no updateExample', async () => {
    renderEditor()
    await screen.findByText('Código del ejemplo')
    const editor = screen.getByLabelText('Editor de código Python del ejemplo')
    fireEvent.change(editor, { target: { value: 'print(2)\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))

    await waitFor(() => expect(uploadExampleCodeMock).toHaveBeenCalledTimes(1))
    const [id, body] = uploadExampleCodeMock.mock.calls[0]
    expect(id).toBe('ex-1')
    expect(body).toEqual({ filename: 'hola.py', source_code: 'print(2)\n' })
    expect(updateExampleMock).not.toHaveBeenCalled()
  })
})

describe('AdminExampleEditor · probar en simulador', () => {
  it('navega a #/simulador?ejemplo={id}&prueba=admin cuando está habilitado y sin cambios', async () => {
    renderEditor()
    const btn = await screen.findByRole('button', { name: 'Probar en simulador' })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    // S2 (CU-22.2): la prueba del autor no envía lesson_id → no toca progreso.
    expect(await screen.findByText('SIMULADOR?ejemplo=ex-1&prueba=admin')).toBeInTheDocument()
  })
})

describe('AdminExampleEditor · cambios sin guardar (CU-21.2)', () => {
  it('salir con cambios pide confirmación', async () => {
    renderEditor()
    await screen.findByText('Código del ejemplo')
    fireEvent.change(screen.getByLabelText('Editor de código Python del ejemplo'), { target: { value: 'print(2)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Volver al panel' }))
    expect(await screen.findByRole('dialog', { name: 'Cambios sin guardar' })).toBeInTheDocument()
    expect(screen.queryByText('PANEL')).toBeNull()
  })

  it('sin cambios sale directamente', async () => {
    renderEditor()
    await screen.findByText('Código del ejemplo')
    fireEvent.click(screen.getByRole('button', { name: 'Volver al panel' }))
    expect(await screen.findByText('PANEL')).toBeInTheDocument()
  })
})

describe('AdminExampleEditor · validar antes de guardar (CU-21.1, 21.3)', () => {
  it('un nombre inválido se marca y NO se guarda nada (ni los metadatos)', async () => {
    renderEditor()
    await screen.findByText('Código del ejemplo')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Otro título' } })
    fireEvent.change(screen.getByLabelText('Nombre de archivo'), { target: { value: 'mal nombre.py' } })
    fireEvent.change(screen.getByLabelText('Editor de código Python del ejemplo'), { target: { value: 'print(2)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))
    expect(await screen.findByText(/^El nombre debe terminar en \.py/)).toBeInTheDocument()
    expect(updateExampleMock).not.toHaveBeenCalled()
    expect(uploadExampleCodeMock).not.toHaveBeenCalled()
  })

  it('código vacío se marca y no se guardan los metadatos', async () => {
    renderEditor()
    await screen.findByText('Código del ejemplo')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Otro título' } })
    fireEvent.change(screen.getByLabelText('Editor de código Python del ejemplo'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))
    expect(await screen.findByText('El código no puede quedar vacío.')).toBeInTheDocument()
    expect(updateExampleMock).not.toHaveBeenCalled()
  })

  it('si los metadatos se guardan y el código falla, solo el código queda pendiente', async () => {
    uploadExampleCodeMock.mockRejectedValue(new Error('red caída'))
    renderEditor()
    await screen.findByText('Código del ejemplo')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Otro título' } })
    fireEvent.change(screen.getByLabelText('Editor de código Python del ejemplo'), { target: { value: 'print(2)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))
    await waitFor(() => expect(uploadExampleCodeMock).toHaveBeenCalledTimes(1))
    expect(updateExampleMock).toHaveBeenCalledTimes(1)

    uploadExampleCodeMock.mockResolvedValue({ example_id: 'ex-1', filename: 'hola.py', bytes: 8 })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))
    await waitFor(() => expect(uploadExampleCodeMock).toHaveBeenCalledTimes(2))
    // Los metadatos ya estaban guardados: no se reenvían.
    expect(updateExampleMock).toHaveBeenCalledTimes(1)
  })
})

