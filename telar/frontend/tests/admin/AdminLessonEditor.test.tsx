// tests/admin/AdminLessonEditor.test.tsx — editor de lección: dirty, preview
// WYSIWYG (renderMarkdown), submit create (createLesson con ejemplo pareado) vs
// submit edit (updateLesson solo la faceta lección).
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getAdminModules: vi.fn(),
  getAdminLesson: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
  reorderLessons: vi.fn(),
  addLessonExample: vi.fn(),
}))
vi.mock('@/api/system', () => ({ getSystem: vi.fn() }))

import {
  addLessonExample,
  createLesson,
  getAdminLesson,
  getAdminModules,
  reorderLessons,
  updateLesson,
} from '@/api/admin'
import { getSystem } from '@/api/system'
import AdminLessonEditor from '@/features/admin/lesson/AdminLessonEditor'

const getAdminModulesMock = getAdminModules as Mock
const getAdminLessonMock = getAdminLesson as Mock
const createLessonMock = createLesson as Mock
const updateLessonMock = updateLesson as Mock
const getSystemMock = getSystem as Mock
const reorderLessonsMock = reorderLessons as Mock
const addLessonExampleMock = addLessonExample as Mock

const MODULES = {
  modules: [{ id: 'm1', order: 1, title: 'Módulo 1', description: '', level: 'Intro', lessons: [] }],
}

const EXAMPLE_STUB = {
  id: 'ex-1', module_id: 'm1', order: 1, source_code: 'print(1)',
  title: 'Ej', filename: 'ej.py', difficulty: 1, teaches: '', directives: [],
  threads_configurable: true, fixed_threads: null, fixed_threads_note: null,
  sweeps_threads: false, self_measures: false, parser_id: 'none',
  default_timeout_s: 60, est_run_seconds: 5, enabled: true, requires_gpu: false,
  expected_output_note: '', takeaways: [],
}

const LESSON_DETAIL = {
  id: 'lesson-1', module_id: 'm1', order: 2, title: 'Lección Uno',
  estimated_minutes: 15, content_markdown: '# Hola', recommended: [],
  video_url: null, completion_rule: 'quiz', archived: false,
  enabled: true, has_quiz: false, quiz_question_count: 0,
  prev_lesson_id: null, next_lesson_id: null, example: EXAMPLE_STUB,
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/admin', element: <div>PANEL</div> },
      { path: '/admin/lecciones/nueva', element: <AdminLessonEditor /> },
      { path: '/admin/lecciones/:lessonId', element: <AdminLessonEditor /> },
    ],
    { initialEntries: [path] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  getAdminModulesMock.mockResolvedValue(MODULES)
  getSystemMock.mockResolvedValue({ limits: { max_timeout_s: 120 } })
  getAdminLessonMock.mockResolvedValue(LESSON_DETAIL)
  createLessonMock.mockResolvedValue({ ...LESSON_DETAIL, id: 'nueva-1' })
  updateLessonMock.mockResolvedValue(LESSON_DETAIL)
  reorderLessonsMock.mockResolvedValue(MODULES)
  addLessonExampleMock.mockResolvedValue(EXAMPLE_STUB)
})

describe('AdminLessonEditor · /nueva', () => {
  it('parte sin cambios y marca dirty al editar', async () => {
    renderAt('/admin/lecciones/nueva')
    expect(await screen.findByText('Nueva lección')).toBeInTheDocument()
    expect(screen.getByText('Todo guardado')).toBeInTheDocument()

    fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Mi lección' } })
    expect(await screen.findByText('Cambios sin guardar')).toBeInTheDocument()
  })

  it('la vista previa refleja el markdown (mismo renderMarkdown)', async () => {
    renderAt('/admin/lecciones/nueva')
    await screen.findByText('Nueva lección')
    const textarea = screen.getByLabelText('Contenido de la lección (Markdown)')
    fireEvent.change(textarea, { target: { value: '# Encabezado' } })
    await waitFor(() => {
      const preview = screen.getByTestId('markdown-preview')
      expect(preview.innerHTML).toContain('<h1>Encabezado</h1>')
    })
  })

  it('crea la lección con su ejemplo pareado y navega al panel', async () => {
    renderAt('/admin/lecciones/nueva')
    await screen.findByText('Nueva lección')

    fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Mi lección' } })
    fireEvent.change(screen.getByLabelText('Identificador'), { target: { value: 'mi-leccion' } })
    fireEvent.change(screen.getByLabelText('Módulo'), { target: { value: 'm1' } })
    fireEvent.change(screen.getByLabelText('Orden'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Minutos estimados'), { target: { value: '10' } })
    fireEvent.click(screen.getByLabelText('Esta lección tiene ejemplo ejecutable'))

    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))

    await waitFor(() => expect(createLessonMock).toHaveBeenCalledTimes(1))
    const body = createLessonMock.mock.calls[0][0]
    expect(body.id).toBe('mi-leccion')
    expect(body.module_id).toBe('m1')
    expect(body.order).toBe(1)
    expect(body.example).not.toBeNull()
    expect(typeof body.source_code).toBe('string')
    expect(await screen.findByText('PANEL')).toBeInTheDocument()
  })
})

describe('AdminLessonEditor · edición', () => {
  it('carga la lección y updateLesson envía solo la faceta lección', async () => {
    renderAt('/admin/lecciones/lesson-1')
    const titleInput = (await screen.findByLabelText('Título')) as HTMLInputElement
    expect(titleInput.value).toBe('Lección Uno')

    fireEvent.change(titleInput, { target: { value: 'Lección Editada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1))
    const [id, body] = updateLessonMock.mock.calls[0]
    expect(id).toBe('lesson-1')
    expect(body.title).toBe('Lección Editada')
    expect(body).not.toHaveProperty('example')
    expect(body).not.toHaveProperty('source_code')
  })

  it('editar solo el título conserva video, regla y enabled (CU-18.1)', async () => {
    getAdminLessonMock.mockResolvedValue({
      ...LESSON_DETAIL,
      video_url: 'https://www.youtube.com/watch?v=abc123',
      completion_rule: 'viewed',
      enabled: false,
    })
    renderAt('/admin/lecciones/lesson-1')
    const titleInput = (await screen.findByLabelText('Título')) as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: 'Solo el título' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1))
    const [, body] = updateLessonMock.mock.calls[0]
    expect(body.title).toBe('Solo el título')
    expect(body.video_url).toBe('https://www.youtube.com/watch?v=abc123')
    expect(body.completion_rule).toBe('viewed')
    expect(body.enabled).toBe(false)
  })
})

// ── S3: autoría completa de la lección ─────────────────────────────────────

/** Rellena los campos mínimos de una lección nueva en m1. */
async function rellenarNueva(order = '1') {
  renderAt('/admin/lecciones/nueva')
  await screen.findByText('Nueva lección')
  fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Mi lección' } })
  fireEvent.change(screen.getByLabelText('Identificador'), { target: { value: 'mi-leccion' } })
  fireEvent.change(screen.getByLabelText('Módulo'), { target: { value: 'm1' } })
  fireEvent.change(screen.getByLabelText('Orden'), { target: { value: order } })
  fireEvent.change(screen.getByLabelText('Minutos estimados'), { target: { value: '10' } })
}

describe('AdminLessonEditor · CU-17.1 lección sin ejemplo', () => {
  it('la casilla de ejemplo nace desmarcada y sin ejemplo envía example y source_code null', async () => {
    await rellenarNueva()
    const casilla = screen.getByLabelText('Esta lección tiene ejemplo ejecutable') as HTMLInputElement
    expect(casilla.checked).toBe(false)
    expect(screen.queryByText(/Toda lección nace con su ejemplo/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre de archivo')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))

    await waitFor(() => expect(createLessonMock).toHaveBeenCalledTimes(1))
    const body = createLessonMock.mock.calls[0][0]
    expect(body.example).toBeNull()
    expect(body.source_code).toBeNull()
  })
})

describe('AdminLessonEditor · CU-17.2 regla, video y habilitada', () => {
  it('envía la regla, el video y enabled elegidos', async () => {
    await rellenarNueva()
    fireEvent.change(screen.getByLabelText('Regla de completitud'), { target: { value: 'viewed' } })
    fireEvent.change(screen.getByLabelText('Video (YouTube)'), {
      target: { value: '  https://youtu.be/abc123  ' },
    })
    fireEvent.click(screen.getByLabelText('Lección habilitada'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))

    await waitFor(() => expect(createLessonMock).toHaveBeenCalledTimes(1))
    const body = createLessonMock.mock.calls[0][0]
    expect(body.completion_rule).toBe('viewed')
    expect(body.video_url).toBe('https://youtu.be/abc123')
    expect(body.enabled).toBe(false)
  })

  it('un video vacío viaja como null', async () => {
    await rellenarNueva()
    fireEvent.change(screen.getByLabelText('Regla de completitud'), { target: { value: 'viewed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))
    await waitFor(() => expect(createLessonMock).toHaveBeenCalledTimes(1))
    expect(createLessonMock.mock.calls[0][0].video_url).toBeNull()
  })

  it('«run» sin ejemplo no se envía y explica por qué', async () => {
    await rellenarNueva()
    fireEvent.change(screen.getByLabelText('Regla de completitud'), { target: { value: 'run' } })
    expect(screen.getByText(/exige que la lección tenga ejemplo ejecutable/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(createLessonMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Esta lección tiene ejemplo ejecutable'))
    expect(screen.queryByText(/exige que la lección tenga ejemplo ejecutable/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))
    await waitFor(() => expect(createLessonMock).toHaveBeenCalledTimes(1))
    expect(createLessonMock.mock.calls[0][0].completion_rule).toBe('run')
  })

  it('«quiz» sin quiz avisa, pero deja guardar', async () => {
    await rellenarNueva()
    fireEvent.change(screen.getByLabelText('Regla de completitud'), { target: { value: 'quiz' } })
    expect(screen.getByText(/crea el quiz después o elige otra regla/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))
    await waitFor(() => expect(createLessonMock).toHaveBeenCalledTimes(1))
  })

  it('«quiz» con quiz no avisa', async () => {
    getAdminLessonMock.mockResolvedValue({ ...LESSON_DETAIL, has_quiz: true, quiz_question_count: 3 })
    renderAt('/admin/lecciones/lesson-1')
    await screen.findByLabelText('Regla de completitud')
    expect(screen.queryByText(/crea el quiz después/)).not.toBeInTheDocument()
  })
})

describe('AdminLessonEditor · CU-19.3 posición entera', () => {
  it.each(['2.5', '0', '-1', 'abc'])('rechaza la posición %s', async (orden) => {
    await rellenarNueva(orden)
    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))
    expect(await screen.findByText(/entero mayor o igual que 1/)).toBeInTheDocument()
    expect(createLessonMock).not.toHaveBeenCalled()
  })
})

const MODULES_CON_LECCIONES = {
  modules: [
    {
      id: 'm1', order: 1, title: 'Módulo 1', description: '', level: 'Intro',
      lessons: [
        { id: 'A', order: 1, title: 'A', enabled: true, has_quiz: false, quiz_question_count: 0 },
        { id: 'B', order: 2, title: 'B', enabled: true, has_quiz: false, quiz_question_count: 0 },
        { id: 'C', order: 3, title: 'C', enabled: true, has_quiz: false, quiz_question_count: 0 },
      ],
    },
    {
      id: 'm2', order: 2, title: 'Módulo 2', description: '', level: 'Intro',
      lessons: [
        { id: 'X', order: 1, title: 'X', enabled: true, has_quiz: false, quiz_question_count: 0 },
      ],
    },
  ],
}

describe('AdminLessonEditor · CU-19.1 mover recoloca', () => {
  beforeEach(() => {
    getAdminModulesMock.mockResolvedValue(MODULES_CON_LECCIONES)
    reorderLessonsMock.mockResolvedValue(MODULES_CON_LECCIONES)
    getAdminLessonMock.mockResolvedValue({ ...LESSON_DETAIL, id: 'C', order: 3, title: 'C' })
  })

  it('A,B,C: mover C a 2 manda el orden completo y guarda en la posición 2', async () => {
    renderAt('/admin/lecciones/C')
    fireEvent.change(await screen.findByLabelText('Orden'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1))
    expect(reorderLessonsMock).toHaveBeenCalledWith([
      { id: 'A', order: 1, module_id: 'm1' },
      { id: 'C', order: 2, module_id: 'm1' },
      { id: 'B', order: 3, module_id: 'm1' },
    ])
    expect(reorderLessonsMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateLessonMock.mock.invocationCallOrder[0],
    )
    expect(updateLessonMock.mock.calls[0][1]).toMatchObject({ module_id: 'm1', order: 2 })
  })

  it('mover a otro módulo en una posición ocupada recoloca ambos módulos', async () => {
    renderAt('/admin/lecciones/C')
    fireEvent.change(await screen.findByLabelText('Módulo'), { target: { value: 'm2' } })
    fireEvent.change(screen.getByLabelText('Orden'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1))
    expect(reorderLessonsMock).toHaveBeenCalledWith([
      { id: 'A', order: 1, module_id: 'm1' },
      { id: 'B', order: 2, module_id: 'm1' },
      { id: 'C', order: 1, module_id: 'm2' },
      { id: 'X', order: 2, module_id: 'm2' },
    ])
    expect(updateLessonMock.mock.calls[0][1]).toMatchObject({ module_id: 'm2', order: 1 })
  })

  it('sin mover no llama al reorden', async () => {
    renderAt('/admin/lecciones/C')
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Otra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))
    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1))
    expect(reorderLessonsMock).not.toHaveBeenCalled()
  })

  it('crear en una posición ocupada crea al final y luego inserta', async () => {
    await rellenarNueva('2')
    fireEvent.click(screen.getByRole('button', { name: 'Crear lección' }))

    await waitFor(() => expect(reorderLessonsMock).toHaveBeenCalledTimes(1))
    expect(createLessonMock.mock.calls[0][0].order).toBe(4)
    expect(reorderLessonsMock).toHaveBeenCalledWith([
      { id: 'A', order: 1, module_id: 'm1' },
      { id: 'mi-leccion', order: 2, module_id: 'm1' },
      { id: 'B', order: 3, module_id: 'm1' },
      { id: 'C', order: 4, module_id: 'm1' },
    ])
  })
})

describe('AdminLessonEditor · CU-18.2 agregar ejemplo', () => {
  it('una lección sin ejemplo ofrece «Agregar ejemplo» y lo crea con POST', async () => {
    getAdminLessonMock.mockResolvedValue({ ...LESSON_DETAIL, example: null })
    renderAt('/admin/lecciones/lesson-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar ejemplo' }))

    fireEvent.change(screen.getAllByLabelText('Título')[1], { target: { value: 'Mi ejemplo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ejemplo' }))

    await waitFor(() => expect(addLessonExampleMock).toHaveBeenCalledTimes(1))
    const [id, body] = addLessonExampleMock.mock.calls[0]
    expect(id).toBe('lesson-1')
    expect(body.example.title).toBe('Mi ejemplo')
    expect(typeof body.source_code).toBe('string')
    expect(await screen.findByRole('button', { name: 'Editar ejemplo' })).toBeInTheDocument()
    expect(updateLessonMock).not.toHaveBeenCalled()
  })

  it('?ejemplo=nuevo abre el formulario directamente', async () => {
    getAdminLessonMock.mockResolvedValue({ ...LESSON_DETAIL, example: null })
    renderAt('/admin/lecciones/lesson-1?ejemplo=nuevo')
    expect(await screen.findByRole('button', { name: 'Guardar ejemplo' })).toBeInTheDocument()
  })

  it('una lección con ejemplo enlaza a su editor', async () => {
    renderAt('/admin/lecciones/lesson-1')
    expect(await screen.findByRole('button', { name: 'Editar ejemplo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar ejemplo' })).not.toBeInTheDocument()
  })
})

describe('AdminLessonEditor · lección archivada', () => {
  it('muestra que está archivada', async () => {
    getAdminLessonMock.mockResolvedValue({ ...LESSON_DETAIL, archived: true })
    renderAt('/admin/lecciones/lesson-1')
    expect(await screen.findByText('Archivada')).toBeInTheDocument()
  })

  it('no lo muestra si no lo está', async () => {
    renderAt('/admin/lecciones/lesson-1')
    await screen.findByLabelText('Título')
    expect(screen.queryByText('Archivada')).not.toBeInTheDocument()
  })
})

describe('AdminLessonEditor · fallos parciales y borradores (revisión)', () => {
  it('si el reorden sale bien y el PUT falla, avisa de que ya se movió', async () => {
    getAdminModulesMock.mockResolvedValue(MODULES_CON_LECCIONES)
    reorderLessonsMock.mockResolvedValue(MODULES_CON_LECCIONES)
    getAdminLessonMock.mockResolvedValue({ ...LESSON_DETAIL, id: 'C', order: 3, title: 'C' })
    updateLessonMock.mockRejectedValue(new Error('red caída'))
    renderAt('/admin/lecciones/C')
    fireEvent.change(await screen.findByLabelText('Orden'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'C2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))

    expect(await screen.findByText(/ya se movió a la posición 2/)).toBeInTheDocument()
    // Reintentar no vuelve a mover: la posición ya es la guardada.
    updateLessonMock.mockResolvedValue(LESSON_DETAIL)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar lección' }))
    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(2))
    expect(reorderLessonsMock).toHaveBeenCalledTimes(1)
  })

  it('salir con un ejemplo a medio escribir pide confirmación', async () => {
    getAdminLessonMock.mockResolvedValue({ ...LESSON_DETAIL, example: null })
    renderAt('/admin/lecciones/lesson-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar ejemplo' }))
    fireEvent.change(screen.getAllByLabelText('Título')[1], { target: { value: 'Borrador' } })
    fireEvent.click(screen.getByRole('button', { name: 'Volver al panel' }))
    expect(await screen.findByText('Cambios sin guardar', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.queryByText('PANEL')).not.toBeInTheDocument()
  })
})
