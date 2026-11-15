// Suite 10 (frontend-spec §10): features/simulator/CodePanel.test.tsx
// CodePanel: rechaza .txt, rechaza >256 KB, acepta .py válido (onFile), chip
// `modificado` al editar, editor emite onCodeChange.
// SimulatorIdle: payload example_id solo / example_id+code / code solo (§7.1/§9).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CodePanel } from '@/features/simulator/CodePanel'
import { EXAMPLE_CONFIGURABLE, MODULES, SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/system', () => ({ getSystem: vi.fn(), getHealth: vi.fn() }))
vi.mock('@/api/content', () => ({ getModules: vi.fn(), getExample: vi.fn() }))
vi.mock('@/api/jobs', () => ({ createJob: vi.fn() }))

import { getSystem } from '@/api/system'
import { getExample, getModules } from '@/api/content'
import { createJob } from '@/api/jobs'
import { loadSystemInfo } from '@/hooks/useSystemInfo'
import { SimulatorIdle } from '@/features/simulator/SimulatorIdle'

const getSystemMock = getSystem as Mock
const getModulesMock = getModules as Mock
const getExampleMock = getExample as Mock
const createJobMock = createJob as Mock

// ─────────────────────────── CodePanel (aislado) ───────────────────────────

describe('CodePanel — dropzone y editor', () => {
  function setup(edited = false) {
    const onFile = vi.fn()
    const onCodeChange = vi.fn()
    render(
      <CodePanel filename="main.py" code={'print(1)\n'} edited={edited} onCodeChange={onCodeChange} onFile={onFile} />,
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    return { onFile, onCodeChange, input }
  }

  // El arrastre vive en toda la card: solo debe reaccionar a ARCHIVOS. Arrastrar
  // texto dentro del editor (o desde otra app) es del navegador: cancelarlo
  // con preventDefault impediría moverlo.
  it('soltar TEXTO sobre el editor no se cancela (el navegador lo inserta)', () => {
    const { onFile } = setup()
    const editor = screen.getByLabelText('Editor de código Python')
    const notCancelled = fireEvent.drop(editor, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(notCancelled).toBe(true)
    expect(onFile).not.toHaveBeenCalled()
  })

  it('arrastrar texto no marca la card como destino de archivo', () => {
    setup()
    const editor = screen.getByLabelText('Editor de código Python')
    fireEvent.dragOver(editor, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(document.querySelector('.code-upload.drag-over')).toBeNull()
  })

  it('soltar un ARCHIVO .py sobre la card lo procesa y marca el destino al arrastrar', async () => {
    const { onFile } = setup()
    const editor = screen.getByLabelText('Editor de código Python')
    const file = new File(['print("drag")\n'], 'arrastrado.py')
    fireEvent.dragOver(editor, { dataTransfer: { types: ['Files'], files: [file] } })
    expect(document.querySelector('.code-upload.drag-over')).not.toBeNull()
    const notCancelled = fireEvent.drop(editor, { dataTransfer: { types: ['Files'], files: [file] } })
    expect(notCancelled).toBe(false)
    await waitFor(() => expect(onFile).toHaveBeenCalledWith({ filename: 'arrastrado.py', code: 'print("drag")\n' }))
    expect(document.querySelector('.code-upload.drag-over')).toBeNull()
  })

  it('rechaza un archivo .txt', async () => {
    const { onFile, input } = setup()
    fireEvent.change(input, { target: { files: [new File(['x'], 'notas.txt', { type: 'text/plain' })] } })
    expect(await screen.findByText('Solo archivos .py')).toBeInTheDocument()
    expect(onFile).not.toHaveBeenCalled()
  })

  it('rechaza un .py de más de 256 KB', async () => {
    const { onFile, input } = setup()
    const big = new File([new Uint8Array(262145)], 'grande.py')
    fireEvent.change(input, { target: { files: [big] } })
    expect(await screen.findByText('El archivo supera 256 KB')).toBeInTheDocument()
    expect(onFile).not.toHaveBeenCalled()
  })

  it('acepta un .py válido y emite onFile con filename + code', async () => {
    const { onFile, input } = setup()
    fireEvent.change(input, { target: { files: [new File(['print("ok")\n'], 'exp.py')] } })
    await waitFor(() => expect(onFile).toHaveBeenCalledWith({ filename: 'exp.py', code: 'print("ok")\n' }))
  })

  it('muestra el chip `modificado` cuando edited=true', () => {
    setup(true)
    expect(screen.getByText('modificado')).toBeInTheDocument()
  })

  it('editar el textarea dispara onCodeChange', async () => {
    const { onCodeChange } = setup()
    const editor = screen.getByLabelText('Editor de código Python')
    await userEvent.type(editor, '#')
    expect(onCodeChange).toHaveBeenCalled()
  })
})

// ─────────────────── SimulatorIdle — payload del POST /jobs ─────────────────

const JOB_CREATED = {
  job_id: 'newjob123',
  status: 'queued' as const,
  threads_effective: 4,
  threads_note: null,
  ws_url: '/ws/jobs/newjob123',
  href: '/api/v1/jobs/newjob123',
  created_at: '2026-07-12T15:04:05.123Z',
}

describe('SimulatorIdle — payload según estado (§7.1/§9)', () => {
  beforeEach(async () => {
    getSystemMock.mockReset().mockRejectedValue(new Error('reset'))
    await loadSystemInfo(true).catch(() => undefined)
    getSystemMock.mockReset().mockResolvedValue(SYSTEM_INFO)
    getModulesMock.mockReset().mockResolvedValue(MODULES)
    getExampleMock.mockReset().mockResolvedValue(EXAMPLE_CONFIGURABLE)
    createJobMock.mockReset().mockResolvedValue(JOB_CREATED)
  })

  async function launch(): Promise<Record<string, unknown>> {
    const btn = await screen.findByRole('button', { name: /lanzar ejecución/i })
    await userEvent.click(btn)
    await waitFor(() => expect(createJobMock).toHaveBeenCalled())
    return createJobMock.mock.calls[0][0] as Record<string, unknown>
  }

  it('ejemplo sin editar → example_id + lesson_id + threads, SIN code', async () => {
    render(
      <MemoryRouter initialEntries={['/simulador?ejemplo=spmd']}>
        <SimulatorIdle />
      </MemoryRouter>,
    )
    await screen.findByDisplayValue(/print\("hola"\)/)
    const arg = await launch()
    expect(arg.example_id).toBe('spmd')
    expect(arg.lesson_id).toBe('spmd')
    expect(arg.threads).toBe(4) // configurable → se envía
    expect(arg).not.toHaveProperty('code')
  })

  it('ejemplo editado → example_id + code', async () => {
    render(
      <MemoryRouter initialEntries={['/simulador?ejemplo=spmd']}>
        <SimulatorIdle />
      </MemoryRouter>,
    )
    const editor = await screen.findByDisplayValue(/print\("hola"\)/)
    await userEvent.type(editor, '# editado')
    const arg = await launch()
    expect(arg.example_id).toBe('spmd')
    expect(typeof arg.code).toBe('string')
    expect(arg.code as string).toContain('# editado')
  })

  it('código propio (sin ejemplo) → filename + code, SIN example_id', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/simulador', state: { code: 'mi codigo propio', filename: 'mio.py' } }]}>
        <SimulatorIdle />
      </MemoryRouter>,
    )
    await screen.findByDisplayValue('mi codigo propio')
    const arg = await launch()
    expect(arg).not.toHaveProperty('example_id')
    expect(arg.filename).toBe('mio.py')
    expect(arg.code).toBe('mi codigo propio')
    expect(arg.threads).toBe(4)
  })
})
