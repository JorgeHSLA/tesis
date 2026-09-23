// S5 · D+ — distintivo «cambios sin publicar» por módulo en el dashboard.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  deleteModule: vi.fn(),
  getPublishStatus: vi.fn(),
}))

import { getPublishStatus } from '@/api/admin'
import { ModuleGroup } from '@/features/admin/dashboard/ModuleGroup'

const statusMock = getPublishStatus as Mock

const MODULE = {
  id: 'm1', order: 1, title: 'Fundamentos', description: '', level: 'Intro',
  version: 1, origin: 'local', update_available: null, lessons: [],
}

function renderGroup() {
  const noop = () => {}
  return render(
    <MemoryRouter>
      <ModuleGroup
        module={MODULE as never}
        index={0}
        count={1}
        isDragging={false}
        isDropTarget={false}
        open={false}
        onToggle={noop}
        onReload={noop}
        onToast={noop}
        onEdit={noop}
        onMove={noop}
        onReorderStart={noop}
        onReorderEnter={noop}
        onReorderDrop={noop}
        onReorderEnd={noop}
      />
    </MemoryRouter>,
  )
}

function estado(state: string) {
  return {
    module_id: 'm1', state, published_version: 1, local_version: 1,
    content_hash: 'a'.repeat(64), reason: null,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('ModuleGroup · distintivo de cambios sin publicar', () => {
  it('con cambios, lo muestra', async () => {
    statusMock.mockResolvedValue(estado('changed'))
    renderGroup()
    expect(await screen.findByText('cambios sin publicar')).toBeInTheDocument()
    expect(statusMock).toHaveBeenCalledWith('m1')
  })

  it('en desfase también, porque falta completar la publicación', async () => {
    statusMock.mockResolvedValue(estado('out_of_sync'))
    renderGroup()
    expect(await screen.findByText('cambios sin publicar')).toBeInTheDocument()
  })

  it.each(['unchanged', 'never_published', 'unknown'])('con %s, no', async (state) => {
    statusMock.mockResolvedValue(estado(state))
    renderGroup()
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(screen.queryByText('cambios sin publicar')).not.toBeInTheDocument()
  })

  it('si la consulta falla, no pinta nada ni rompe la fila', async () => {
    statusMock.mockRejectedValue(new Error('sin red'))
    renderGroup()
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(screen.getByText('Fundamentos')).toBeInTheDocument()
    expect(screen.queryByText('cambios sin publicar')).not.toBeInTheDocument()
  })
})
