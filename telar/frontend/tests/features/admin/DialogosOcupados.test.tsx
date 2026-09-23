// Los diálogos de Autoría no se cierran mientras su operación sigue en vuelo.
//
// Cerrar el de Publicar con un clic fuera dejaba la petición viva: al reabrirlo
// y publicar otra vez podían salir DOS versiones (publicar es irreversible), y
// el resultado de la primera llegaba tarde sobre un diálogo ya cerrado. El
// botón «Cancelar» ya se deshabilitaba; el fondo y Escape no.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getCatalogCredentials: vi.fn(),
  getPublishStatus: vi.fn(),
  publishModule: vi.fn(),
  importCatalogModule: vi.fn(),
  createModule: vi.fn(),
  updateModule: vi.fn(),
}))
vi.mock('@/api/catalog', () => ({ getRemoteCatalog: vi.fn() }))

import {
  createModule,
  getCatalogCredentials,
  getPublishStatus,
  importCatalogModule,
  publishModule,
} from '@/api/admin'
import { getRemoteCatalog } from '@/api/catalog'
import { ImportModuleDialog } from '@/features/admin/dashboard/ImportModuleDialog'
import { ModuleFormDialog } from '@/features/admin/dashboard/ModuleFormDialog'
import { PublishModuleDialog } from '@/features/admin/dashboard/PublishModuleDialog'

/** Una promesa que el test resuelve cuando quiere: la operación «en vuelo». */
function pendiente<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>((r) => {
    resolver = r
  })
  return { promesa, resolver }
}

const fondo = () => document.querySelector('.admin-modal-backdrop') as HTMLElement

const MODULE = {
  id: 'm1',
  order: 1,
  title: 'Fundamentos',
  description: '',
  level: 'Intro',
  version: 1,
  origin: 'local' as const,
  update_available: null,
  lessons: [{ id: 'hola', order: 1, title: 'Hola hilos', enabled: true, completed: false }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PublishModuleDialog en vuelo', () => {
  beforeEach(() => {
    ;(getCatalogCredentials as Mock).mockResolvedValue({
      configured: true, usable: true, client_email: 'x', project_id: 'p',
      bucket: 'b', file_mode: '0600', probed: true, reason: null,
    })
    ;(getPublishStatus as Mock).mockResolvedValue({
      module_id: 'm1', state: 'changed', published_version: 1, local_version: 1,
      content_hash: 'a'.repeat(64), reason: null,
    })
  })

  it('un clic fuera no lo cierra mientras publica, y sí cuando termina', async () => {
    const vuelo = pendiente<unknown>()
    ;(publishModule as Mock).mockReturnValue(vuelo.promesa)
    const onClose = vi.fn()
    render(<PublishModuleDialog module={MODULE as never} onClose={onClose} onPublished={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Ver qué se publicará/ }))
    fireEvent.mouseDown(fondo())
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => vuelo.resolver({ published: false, version: 2, warnings: [], lesson_ids: [] }))
    fireEvent.mouseDown(fondo())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('si se desmonta con la publicación en vuelo, no avisa tarde de éxito', async () => {
    const vuelo = pendiente<unknown>()
    ;(publishModule as Mock)
      .mockResolvedValueOnce({ published: false, version: 2, warnings: [], lesson_ids: [] })
      .mockReturnValueOnce(vuelo.promesa)
    const onPublished = vi.fn()
    const { unmount } = render(
      <PublishModuleDialog module={MODULE as never} onClose={vi.fn()} onPublished={onPublished} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Ver qué se publicará/ }))
    const publicar = await screen.findByRole('button', { name: /^Publicar v2/ })
    fireEvent.click(publicar)
    expect(publishModule).toHaveBeenLastCalledWith('m1', expect.objectContaining({ dry_run: false }))
    unmount()
    await act(async () => vuelo.resolver({ published: true, version: 2, local_state_updated: true }))
    expect(onPublished).not.toHaveBeenCalled()
  })
})

describe('ImportModuleDialog en vuelo', () => {
  it('un clic fuera no lo cierra mientras importa', async () => {
    ;(getRemoteCatalog as Mock).mockResolvedValue({
      source: 'network', stale: false,
      modules: [{ id: 'mF', title: 'Fundamentos de paralelismo', version: 2, lessons_count: 3, state: 'available' }],
    })
    ;(importCatalogModule as Mock).mockReturnValue(pendiente<unknown>().promesa)
    const onClose = vi.fn()
    render(<ImportModuleDialog existingIds={[]} onClose={onClose} onImported={vi.fn()} />)
    await screen.findByText(/Fundamentos de paralelismo/)
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    fireEvent.mouseDown(fondo())
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ModuleFormDialog en vuelo', () => {
  it('ni un clic fuera ni Escape lo cierran mientras guarda', async () => {
    ;(createModule as Mock).mockReturnValue(pendiente<unknown>().promesa)
    const onClose = vi.fn()
    render(
      <ModuleFormDialog mode="create" existingIds={[]} defaultOrder={1} onClose={onClose} onSaved={vi.fn()} />,
    )
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nuevo módulo' } })
    fireEvent.change(screen.getByLabelText('Nivel'), { target: { value: 'Intro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear módulo' }))
    expect(createModule).toHaveBeenCalled()

    fireEvent.mouseDown(fondo())
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
