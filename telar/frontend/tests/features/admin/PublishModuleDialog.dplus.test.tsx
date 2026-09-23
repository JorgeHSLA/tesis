// S5 · PublishModuleDialog — D+ (¿hay cambios sin publicar?), errores de
// validación por lección (CU-37.1) y publicado-sin-estado-local (CU-37.4).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  getCatalogCredentials: vi.fn(),
  getPublishStatus: vi.fn(),
  publishModule: vi.fn(),
}))

import { getCatalogCredentials, getPublishStatus, publishModule } from '@/api/admin'
import { ApiError } from '@/api/client'
import { PublishModuleDialog } from '@/features/admin/dashboard/PublishModuleDialog'

const statusMock = getPublishStatus as Mock
const publishMock = publishModule as Mock

const MODULE = {
  id: 'm1',
  order: 1,
  title: 'Fundamentos',
  description: '',
  level: 'Intro',
  version: 1,
  origin: 'local' as const,
  update_available: null,
  lessons: [
    { id: 'hola', order: 1, title: 'Hola hilos', enabled: true, completed: false },
  ],
}

const CREDENCIAL = {
  configured: true,
  usable: true,
  client_email: 'pub@x.iam.gserviceaccount.com',
  project_id: 'p',
  bucket: 'telar-modulos',
  file_mode: '0600',
  probed: true,
  reason: null,
}

function estado(state: string, extra: Record<string, unknown> = {}) {
  return {
    module_id: 'm1',
    state,
    published_version: state === 'never_published' || state === 'unknown' ? null : 1,
    local_version: 1,
    content_hash: 'a'.repeat(64),
    reason: null,
    ...extra,
  }
}

function resultado(extra: Record<string, unknown> = {}) {
  return {
    published: true,
    module_id: 'm1',
    version: 2,
    checksum: 'b'.repeat(64),
    object_path: 'modulos/m1/v2.json',
    generation: null,
    bytes: 100,
    published_at: '2026-09-23T00:00:00.000Z',
    index_updated: true,
    lesson_ids: ['hola'],
    warnings: [],
    local_state_updated: true,
    ...extra,
  }
}

function renderDialog() {
  const onPublished = vi.fn()
  const onClose = vi.fn()
  render(<PublishModuleDialog module={MODULE as never} onClose={onClose} onPublished={onPublished} />)
  return { onPublished, onClose }
}

const botonPublicar = () => screen.getByRole('button', { name: /^Publicar/ })

beforeEach(() => {
  vi.clearAllMocks()
  ;(getCatalogCredentials as Mock).mockResolvedValue(CREDENCIAL)
})

describe('PublishModuleDialog · detección de cambios (D+)', () => {
  it('sin cambios: lo dice y deja Publicar deshabilitado aunque se ensaye', async () => {
    statusMock.mockResolvedValue(estado('unchanged'))
    publishMock.mockResolvedValue(resultado({ published: false }))
    renderDialog()

    expect(await screen.findByText(/No hay cambios respecto a v1/)).toBeInTheDocument()
    expect(statusMock).toHaveBeenCalledWith('m1')
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))
    await screen.findByText(/Se publicará como/)
    expect(botonPublicar()).toBeDisabled()
  })

  it('con cambios: «Tienes cambios sin publicar» y se puede publicar tras ensayar', async () => {
    statusMock.mockResolvedValue(estado('changed'))
    publishMock.mockResolvedValue(resultado({ published: false }))
    renderDialog()

    expect(await screen.findByText(/Tienes cambios sin publicar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))
    await screen.findByText(/Se publicará como/)
    expect(botonPublicar()).toBeEnabled()
  })

  it('sin red: «No se pudo comprobar» y no bloquea la publicación', async () => {
    statusMock.mockResolvedValue(estado('unknown', { reason: 'network' }))
    publishMock.mockResolvedValue(resultado({ published: false }))
    renderDialog()

    expect(await screen.findByText(/No se pudo comprobar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))
    await screen.findByText(/Se publicará como/)
    expect(botonPublicar()).toBeEnabled()
  })

  it('si falla la propia consulta de estado, también es «No se pudo comprobar»', async () => {
    statusMock.mockRejectedValue(new Error('boom'))
    renderDialog()
    expect(await screen.findByText(/No se pudo comprobar/)).toBeInTheDocument()
  })

  it('desfase: explica y «Reintentar» reconcilia publicando sin ensayo', async () => {
    statusMock.mockResolvedValue(estado('out_of_sync', { local_version: null }))
    publishMock.mockResolvedValue(resultado({ version: 1 }))
    const { onPublished } = renderDialog()

    expect(
      await screen.findByText(/Publicado en la nube; no se pudo actualizar el estado local/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
    await waitFor(() => expect(onPublished).toHaveBeenCalled())
    expect(publishMock).toHaveBeenCalledWith('m1', { dry_run: false, notes: '' })
  })
})

describe('PublishModuleDialog · resultado', () => {
  it('errores de validación: se listan por lección y campo, sin publicar', async () => {
    statusMock.mockResolvedValue(estado('changed'))
    publishMock.mockRejectedValue(
      new ApiError('CONTENT_VALIDATION_ERROR', 'El contenido no cumple.', 422, [
        { field: 'lessons[0].completion_rule', reason: "'quiz' exige quiz", lesson_id: 'hola' },
      ]),
    )
    renderDialog()
    await screen.findByText(/Tienes cambios sin publicar/)
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))

    const item = await screen.findByText(/'quiz' exige quiz/)
    expect(item.closest('li')).toHaveTextContent('Hola hilos')
    expect(item.closest('li')).toHaveTextContent('completion_rule')
    expect(botonPublicar()).toBeDisabled()
  })

  it('publicado sin estado local: avisa y no cierra', async () => {
    statusMock.mockResolvedValue(estado('changed'))
    publishMock
      .mockResolvedValueOnce(resultado({ published: false }))
      .mockResolvedValueOnce(resultado({ local_state_updated: false }))
    const { onPublished } = renderDialog()
    await screen.findByText(/Tienes cambios sin publicar/)
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))
    await screen.findByText(/Se publicará como/)
    fireEvent.click(botonPublicar())

    expect(
      await screen.findByText(/Publicado en la nube; no se pudo actualizar el estado local/),
    ).toBeInTheDocument()
    expect(onPublished).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeEnabled()
  })
})

describe('PublishModuleDialog · credencial', () => {
  it('si la consulta de credencial falla, lo dice una vez y deja volver a comprobar', async () => {
    statusMock.mockResolvedValue(estado('changed'))
    ;(getCatalogCredentials as Mock)
      .mockRejectedValueOnce(new Error('sin red'))
      .mockResolvedValueOnce(CREDENCIAL)
    renderDialog()

    expect(await screen.findByText(/No se pudo comprobar la credencial/)).toBeInTheDocument()
    expect(screen.queryByText(/Comprobando la credencial/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Volver a comprobar/ }))
    expect(await screen.findByText(/telar-modulos/)).toBeInTheDocument()
  })
})
