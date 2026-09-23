// §11.8 CU-38 — el diálogo de publicación.
//
// Lo que se fija aquí no es «el diálogo pinta»: es que **no se pueda publicar a
// ciegas**. Una versión publicada es inmutable, así que los dos comportamientos
// que sostienen todo lo demás son que el botón de publicar esté cerrado hasta
// haber visto el ensayo, y que el aviso de pérdida de avance se muestre.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PublishModuleDialog } from '@/features/admin/dashboard/PublishModuleDialog'
import { ApiError } from '@/api/client'
import type { ModuleDto } from '@/api/types'

vi.mock('@/api/admin', () => ({
  getCatalogCredentials: vi.fn(),
  getPublishStatus: vi.fn(),
  publishModule: vi.fn(),
}))

import { getCatalogCredentials, getPublishStatus, publishModule } from '@/api/admin'

const credencialesMock = getCatalogCredentials as Mock
const publicarMock = publishModule as Mock

const MODULO = {
  id: 'm9',
  order: 9,
  title: 'Tareas y dependencias',
  description: '',
  level: 'Avanzado',
  lesson_ids: [],
} as unknown as ModuleDto

const CREDENCIAL_OK = {
  configured: true,
  usable: true,
  client_email: 'publicador@proyecto.iam.gserviceaccount.com',
  project_id: 'proyecto',
  bucket: 'clasestelar',
  file_mode: '0600',
  probed: true,
  reason: null,
}

const ENSAYO = {
  published: false,
  module_id: 'm9',
  version: 3,
  checksum: 'a'.repeat(64),
  object_path: 'modulos/m9/v3.json',
  generation: null,
  bytes: 4096,
  published_at: '2026-08-30T12:00:00.000Z',
  index_updated: false,
  lesson_ids: ['task-intro', 'task-deps'],
  warnings: [],
  local_state_updated: true,
}

function montar(onPublished = vi.fn()) {
  render(
    <PublishModuleDialog
      module={MODULO}
      onClose={vi.fn()}
      onPublished={onPublished}
    />,
  )
  return { onPublished }
}

beforeEach(() => {
  vi.clearAllMocks()
  credencialesMock.mockResolvedValue(CREDENCIAL_OK)
  publicarMock.mockResolvedValue(ENSAYO)
  // S5 (D+): estos tests son del flujo ensayo → publicar; con cambios pendientes.
  ;(getPublishStatus as Mock).mockResolvedValue({
    module_id: 'm9', state: 'changed', published_version: 2, local_version: 2,
    content_hash: 'c'.repeat(64), reason: null,
  })
})

describe('PublishModuleDialog', () => {
  it('comprueba la credencial contra el bucket, no solo el archivo', async () => {
    montar()
    // `probe: true`. Sin salir a la red, «la clave existe y tiene 0600» no dice
    // nada sobre si la CUENTA puede escribir, y eso se descubriría al pulsar.
    await waitFor(() => expect(credencialesMock).toHaveBeenCalledWith(true))
    expect(
      await screen.findByText(/publicador@proyecto\.iam\.gserviceaccount\.com/),
    ).toBeInTheDocument()
  })

  it('sin credencial utilizable NO deja publicar, y dice por qué', async () => {
    credencialesMock.mockResolvedValue({
      ...CREDENCIAL_OK,
      usable: false,
      reason: 'insecure_mode',
      file_mode: '0644',
    })
    montar()

    // El motivo importa: manda al admin a los PERMISOS, no al contenido.
    expect(await screen.findByText(/permisos 0600/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ver qué se publicará/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Publicar/ })).toBeDisabled()
  })

  it('publicar está CERRADO hasta haber visto el ensayo', async () => {
    montar()
    await screen.findByText(/clasestelar/)

    // Este es el invariante del diálogo. Publicar es irreversible: llegar al
    // botón sin haber visto qué se retira es justo lo que hay que impedir.
    expect(screen.getByRole('button', { name: /^Publicar/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))
    await waitFor(() =>
      expect(publicarMock).toHaveBeenCalledWith('m9', { dry_run: true, notes: '' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Publicar/ })).toBeEnabled(),
    )
  })

  it('el ensayo NO escribe: solo pide dry_run', async () => {
    montar()
    await screen.findByText(/clasestelar/)
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))

    await waitFor(() => expect(publicarMock).toHaveBeenCalledTimes(1))
    expect(publicarMock.mock.calls[0][1].dry_run).toBe(true)
  })

  it('avisa de la pérdida de avance ANTES de que sea irreversible', async () => {
    publicarMock.mockResolvedValue({
      ...ENSAYO,
      warnings: [
        {
          code: 'LESSON_ID_REMOVED',
          lesson_id: 'task-viejo',
          message: 'quien actualice perderá su avance en ella.',
        },
      ],
    })
    montar()
    await screen.findByText(/clasestelar/)
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))

    expect(await screen.findByText(/Se retira una lección/)).toBeInTheDocument()
    expect(screen.getByText(/task-viejo/)).toBeInTheDocument()
    // La frase que sostiene la decisión. Sin ella el aviso es una nota al pie.
    expect(screen.getByText(/irreversible/)).toBeInTheDocument()
  })

  it('publica de verdad solo tras el ensayo, y avisa al terminar', async () => {
    const { onPublished } = montar()
    await screen.findByText(/clasestelar/)

    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Publicar/ })).toBeEnabled(),
    )

    publicarMock.mockResolvedValue({ ...ENSAYO, published: true, generation: 17 })
    fireEvent.click(screen.getByRole('button', { name: /^Publicar/ }))

    await waitFor(() =>
      expect(publicarMock).toHaveBeenLastCalledWith('m9', {
        dry_run: false,
        notes: '',
      }),
    )
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(expect.stringMatching(/v3/)))
  })

  it('una versión ya publicada se explica como inmutable, no como error genérico', async () => {
    montar()
    await screen.findByText(/clasestelar/)
    publicarMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', 'conflicto', 409, null),
    )
    fireEvent.click(screen.getByRole('button', { name: /Ver qué se publicará/ }))

    expect(await screen.findByText(/inmutables/)).toBeInTheDocument()
    // Y un ensayo fallido no puede dejar habilitado el botón de publicar: si no,
    // se publicaría apoyándose en un ensayo que ya no describe la realidad.
    expect(screen.getByRole('button', { name: /^Publicar/ })).toBeDisabled()
  })
})
