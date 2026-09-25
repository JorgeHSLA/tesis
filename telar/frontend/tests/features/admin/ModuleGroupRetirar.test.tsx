// S7d · CU-41.1 — «Retirar del catálogo» en Autoría.
//
// Lo que se fija: la acción solo aparece cuando hay algo publicado que retirar,
// pide confirmación diciendo QUÉ pasa (y qué no: no borra nada local ni quita
// el módulo a quien ya lo incorporó), y un fallo del bucket se dice sin tocar
// nada.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ApiError } from '@/api/client'

vi.mock('@/api/admin', () => ({
  deleteModule: vi.fn(),
  getPublishStatus: vi.fn(),
  unpublishModule: vi.fn(),
}))

import { getPublishStatus, unpublishModule } from '@/api/admin'
import { ModuleGroup } from '@/features/admin/dashboard/ModuleGroup'

const statusMock = getPublishStatus as Mock
const retirarMock = unpublishModule as Mock

const MODULE = {
  id: 'm1', order: 1, title: 'Fundamentos', description: '', level: 'Intro',
  version: 2, origin: 'local', update_available: null, lessons: [],
}

function renderGroup(onToast = vi.fn(), onReload = vi.fn()) {
  const noop = () => {}
  render(
    <MemoryRouter>
      <ModuleGroup
        module={MODULE as never}
        index={0}
        count={1}
        isDragging={false}
        isDropTarget={false}
        open={false}
        onToggle={noop}
        onReload={onReload}
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
  return { onToast, onReload }
}

function estado(state: string, published_version: number | null = 2) {
  return {
    module_id: 'm1', state, published_version, local_version: 2,
    content_hash: 'a'.repeat(64), reason: null,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('ModuleGroup · retirar del catálogo', () => {
  it.each(['unchanged', 'changed', 'out_of_sync'])('publicado (%s): ofrece retirar', async (state) => {
    statusMock.mockResolvedValue(estado(state))
    renderGroup()
    expect(await screen.findByRole('button', { name: 'Retirar del catálogo' })).toBeInTheDocument()
  })

  it.each(['never_published', 'unknown'])('con %s no hay nada que retirar', async (state) => {
    statusMock.mockResolvedValue(estado(state, null))
    renderGroup()
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Retirar del catálogo' })).toBeNull()
  })

  it('confirma antes, explica el alcance y no llama a la API si se cancela', async () => {
    statusMock.mockResolvedValue(estado('unchanged'))
    renderGroup()
    fireEvent.click(await screen.findByRole('button', { name: 'Retirar del catálogo' }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/v2/)
    expect(dialogo).toHaveTextContent(/no se borra/i)
    expect(dialogo).toHaveTextContent(/Ya no publicado/)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    expect(retirarMock).not.toHaveBeenCalled()
  })

  it('al confirmar retira, avisa y recarga (el estado pasa a nunca publicado)', async () => {
    statusMock.mockResolvedValue(estado('unchanged'))
    retirarMock.mockResolvedValue({ module_id: 'm1', retired_version: 2 })
    const { onToast, onReload } = renderGroup()
    fireEvent.click(await screen.findByRole('button', { name: 'Retirar del catálogo' }))
    const dialogo = await screen.findByRole('dialog')

    statusMock.mockResolvedValue(estado('never_published', null))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Retirar' }))

    await waitFor(() => expect(retirarMock).toHaveBeenCalledWith('m1'))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/retiró/)))
    expect(onReload).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retirar del catálogo' })).toBeNull(),
    )
  })

  it('si el bucket falla, lo dice y deja todo como estaba', async () => {
    statusMock.mockResolvedValue(estado('unchanged'))
    retirarMock.mockRejectedValue(
      new ApiError('CATALOG_UNAVAILABLE', 'caído', 503, null),
    )
    const { onToast, onReload } = renderGroup()
    fireEvent.click(await screen.findByRole('button', { name: 'Retirar del catálogo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Retirar' }))

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/No se pudo retirar/), 'error'),
    )
    expect(onReload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retirar del catálogo' })).toBeInTheDocument()
  })
})
