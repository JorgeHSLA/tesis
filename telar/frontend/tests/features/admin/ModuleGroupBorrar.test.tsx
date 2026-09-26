// «Borrar módulo» — con el DELETE en vuelo el diálogo no se cierra.
//
// El botón «Cancelar» ya queda deshabilitado mientras `busy`, pero Escape y el
// clic en el fondo llamaban a `onCancel` sin mirar si había un borrado en
// curso: el diálogo desaparecía y el resultado llegaba después sin contexto.
// Mismo patrón que «Retirar del catálogo» del mismo componente.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const MODULE = {
  id: 'm1', order: 1, title: 'Fundamentos', description: '', level: 'Intro',
  version: 1, origin: 'local', update_available: null, lessons: [],
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

/** Promesa controlable: el DELETE queda pendiente hasta que el test lo diga. */
function pendiente() {
  let resolver!: (v: unknown) => void
  const promesa = new Promise((r) => {
    resolver = r
  })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  statusMock.mockResolvedValue({
    module_id: 'm1', state: 'never_published', published_version: null,
    local_version: 1, content_hash: 'a'.repeat(64), reason: null,
  })
})

async function abrirYConfirmar() {
  fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
  const dialogo = await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Borrar módulo' }))
  await waitFor(() => expect(borrarMock).toHaveBeenCalledWith('m1'))
  return dialogo
}

describe('ModuleGroup · borrar con el DELETE en vuelo', () => {
  it('Escape no cierra el diálogo mientras borra; al resolver, se cierra', async () => {
    const { promesa, resolver } = pendiente()
    borrarMock.mockReturnValue(promesa)
    const { onReload } = renderGroup()
    await abrirYConfirmar()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      resolver(undefined)
      await promesa
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onReload).toHaveBeenCalled()
  })

  it('el clic en el fondo tampoco lo cierra mientras borra', async () => {
    const { promesa, resolver } = pendiente()
    borrarMock.mockReturnValue(promesa)
    renderGroup()
    const dialogo = await abrirYConfirmar()

    fireEvent.mouseDown(dialogo.parentElement as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      resolver(undefined)
      await promesa
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin borrado en curso, Escape cancela como siempre', async () => {
    renderGroup()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(borrarMock).not.toHaveBeenCalled()
  })
})
