// CU-16.1/16.2 — borrar un módulo CON lecciones: el diálogo avisa de que se
// borran también sus lecciones y el DELETE va con ?cascade=true. Un módulo
// vacío sigue borrándose sin el parámetro (el 409 protege un listado viejo).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  deleteModule: vi.fn(),
  getPublishStatus: vi.fn(),
  unpublishModule: vi.fn(),
}))

import { deleteModule, getPublishStatus } from '@/api/admin'
import { ModuleGroup } from '@/features/admin/dashboard/ModuleGroup'

const statusMock = getPublishStatus as Mock
const borrarMock = deleteModule as Mock

function leccion(id: string, order: number) {
  return {
    id, order, title: `Lección ${id}`, example_id: null, has_quiz: false, has_video: false,
    quiz_question_count: 0, estimated_minutes: 5, enabled: true, completion_rule: 'viewed',
    progress: { viewed: false, completed: false, best_quiz_score: null, quiz_total: 0 },
  }
}

function renderGroup(lessons: unknown[]) {
  const noop = () => {}
  const onToast = vi.fn()
  render(
    <MemoryRouter>
      <ModuleGroup
        module={{
          id: 'm1', order: 1, title: 'Fundamentos', description: '', level: 'Intro',
          version: 1, origin: 'local', update_available: null, lessons,
        } as never}
        index={0}
        count={1}
        isDragging={false}
        isDropTarget={false}
        open={false}
        onToggle={noop}
        onReload={noop}
        onToast={onToast}
        onEdit={noop}
        onMove={noop}
        onReorderStart={noop}
        onReorderEnter={noop}
        onReorderDrop={noop}
        onReorderEnd={noop}
      />
    </MemoryRouter>,
  )
  return { onToast }
}

beforeEach(() => {
  vi.clearAllMocks()
  borrarMock.mockResolvedValue({ deleted: true, id: 'm1' })
  statusMock.mockResolvedValue({
    module_id: 'm1', state: 'never_published', published_version: null,
    local_version: 1, content_hash: 'a'.repeat(64), reason: null,
  })
})

describe('ModuleGroup · borrar con lecciones (CU-16)', () => {
  it('avisa de que se borrarán sus lecciones y borra en cascada', async () => {
    const { onToast } = renderGroup([leccion('a', 1), leccion('b', 2)])
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent('también sus 2 lecciones')
    expect(dialogo).not.toHaveTextContent('Debe estar vacío')

    fireEvent.click(screen.getByRole('button', { name: 'Borrar módulo y lecciones' }))
    await waitFor(() => expect(borrarMock).toHaveBeenCalledWith('m1', { cascade: true }))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Módulo "Fundamentos" eliminado con sus 2 lecciones.'))
  })

  it('con una sola lección usa el singular', async () => {
    renderGroup([leccion('a', 1)])
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('también su lección')
  })

  it('un módulo vacío se borra sin cascade y sin mencionar lecciones', async () => {
    renderGroup([])
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).not.toHaveTextContent('lecciones')
    fireEvent.click(screen.getByRole('button', { name: 'Borrar módulo' }))
    await waitFor(() => expect(borrarMock).toHaveBeenCalledWith('m1'))
  })
})
