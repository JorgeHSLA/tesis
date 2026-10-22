// «Publicar todo»: revisa y publica de una vez los módulos con cambios.
// Lo que se defiende:
//  - solo se marcan los módulos con algo que publicar (los «al día» no);
//  - publicar exige revisar antes (el ensayo es obligatorio, como en uno solo);
//  - se publica en serie y un fallo no detiene a los demás;
//  - al cerrar, el resumen dice cuántos se publicaron.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ApiError } from '@/api/client'

vi.mock('@/api/admin', () => ({
  getCatalogCredentials: vi.fn(),
  getPublishStatus: vi.fn(),
  publishModule: vi.fn(),
}))

import { getCatalogCredentials, getPublishStatus, publishModule } from '@/api/admin'
import { PublishAllDialog } from '@/features/admin/dashboard/PublishAllDialog'

const modulo = (id: string, title: string) => ({
  id,
  order: 1,
  title,
  description: '',
  level: 'Básico',
  version: 1,
  origin: 'local' as const,
  update_available: null,
  lessons: [],
})

const MODULES = [modulo('mA', 'Módulo A'), modulo('mB', 'Módulo B'), modulo('mC', 'Módulo C')]

const ESTADOS: Record<string, string> = { mA: 'never_published', mB: 'unchanged', mC: 'changed' }

const resultado = (id: string, dry: boolean) => ({
  published: !dry,
  module_id: id,
  version: 2,
  checksum: 'a'.repeat(64),
  object_path: `modulos/${id}/v2.json`,
  generation: null,
  bytes: 100,
  published_at: '2026-10-21T00:00:00.000Z',
  index_updated: !dry,
  lesson_ids: ['l1'],
  warnings: [],
  local_state_updated: true,
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCatalogCredentials as Mock).mockResolvedValue({
    configured: true, usable: true, client_email: 'x', project_id: 'p',
    bucket: 'clasestelar', file_mode: '0600', probed: true, reason: null,
  })
  ;(getPublishStatus as Mock).mockImplementation(async (id: string) => ({
    module_id: id, state: ESTADOS[id], published_version: 1, local_version: 1,
    content_hash: 'a'.repeat(64), reason: null,
  }))
  ;(publishModule as Mock).mockImplementation(async (id: string, body: { dry_run?: boolean }) =>
    resultado(id, body.dry_run === true),
  )
})

function abrir() {
  const onDone = vi.fn()
  const onClose = vi.fn()
  render(<PublishAllDialog modules={MODULES as never} onClose={onClose} onDone={onDone} />)
  return { onDone, onClose }
}

describe('PublishAllDialog', () => {
  it('marca solo los módulos con cambios y exige revisar antes de publicar', async () => {
    abrir()
    await screen.findByText('Al día (v1)')
    const casillas = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(casillas.map((c) => c.checked)).toEqual([true, false, true])
    expect(casillas[1].disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Publicar 0 módulos/ })).toBeDisabled()
  })

  it('revisa, publica en serie los marcados y resume al cerrar', async () => {
    const { onDone } = abrir()
    await screen.findByText('Al día (v1)')

    fireEvent.click(screen.getByRole('button', { name: /Revisar qué se publicará/ }))
    const publicar = await screen.findByRole('button', { name: 'Publicar 2 módulos' })
    await waitFor(() => expect(publicar).toBeEnabled())
    fireEvent.click(publicar)

    await screen.findByRole('button', { name: 'Cerrar' })
    const reales = (publishModule as Mock).mock.calls.filter(([, b]) => !b.dry_run).map(([id]) => id)
    expect(reales).toEqual(['mA', 'mC'])
    expect(screen.getAllByText('Publicado como v2')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onDone).toHaveBeenCalledWith('Se publicaron 2 módulos.')
  })

  it('un fallo al publicar no detiene a los demás', async () => {
    ;(publishModule as Mock).mockImplementation(async (id: string, body: { dry_run?: boolean }) => {
      if (id === 'mA' && !body.dry_run) throw new ApiError('CATALOG_UNAVAILABLE', 'caído', 503)
      return resultado(id, body.dry_run === true)
    })
    const { onDone } = abrir()
    await screen.findByText('Al día (v1)')
    fireEvent.click(screen.getByRole('button', { name: /Revisar qué se publicará/ }))
    const publicar = await screen.findByRole('button', { name: 'Publicar 2 módulos' })
    await waitFor(() => expect(publicar).toBeEnabled())
    fireEvent.click(publicar)

    await screen.findByText('No se pudo contactar con el bucket.')
    expect(screen.getByText('Publicado como v2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onDone).toHaveBeenCalledWith('Se publicó «Módulo C».')
  })

  it('sin nada que publicar, cerrar no anuncia nada', async () => {
    ;(getPublishStatus as Mock).mockImplementation(async (id: string) => ({
      module_id: id, state: 'unchanged', published_version: 1, local_version: 1,
      content_hash: 'a'.repeat(64), reason: null,
    }))
    const { onDone, onClose } = abrir()
    await screen.findByText('No hay módulos con cambios sin publicar.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
})
