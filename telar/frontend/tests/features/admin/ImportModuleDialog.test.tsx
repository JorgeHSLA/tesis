// §11.7 CU-37 — el diálogo de importación.
//
// Lo que se fija no es que pinte una lista: es que el admin pueda **entender la
// diferencia entre los dos modos antes de elegir**, porque elegir mal no
// produce un error — produce un comportamiento distinto meses después (el
// vinculado recibe actualizaciones que pisan lo editado; la copia no).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ImportModuleDialog } from '@/features/admin/dashboard/ImportModuleDialog'
import { ApiError } from '@/api/client'

vi.mock('@/api/admin', () => ({ importCatalogModule: vi.fn() }))
vi.mock('@/api/catalog', () => ({ getRemoteCatalog: vi.fn() }))

import { importCatalogModule } from '@/api/admin'
import { getRemoteCatalog } from '@/api/catalog'

const importarMock = importCatalogModule as Mock
const catalogoMock = getRemoteCatalog as Mock

const REMOTO = {
  source: 'network',
  stale: false,
  modules: [
    {
      id: 'mFundamentos',
      title: 'Fundamentos de paralelismo',
      version: 2,
      lessons_count: 3,
      state: 'available',
    },
    {
      id: 'mExtra',
      title: 'Módulo extra',
      version: 1,
      lessons_count: 1,
      state: 'installed',
    },
  ],
}

function montar(existingIds: string[] = [], onImported = vi.fn()) {
  render(
    <ImportModuleDialog
      existingIds={existingIds}
      onClose={vi.fn()}
      onImported={onImported}
    />,
  )
  return { onImported }
}

beforeEach(() => {
  vi.clearAllMocks()
  catalogoMock.mockResolvedValue(REMOTO)
  importarMock.mockResolvedValue({
    mode: 'linked',
    module: { id: 'mFundamentos', title: 'Fundamentos de paralelismo', lessons: [] },
    base_version: 2,
    id_remap: null,
  })
})

describe('ImportModuleDialog', () => {
  it('lista lo publicado, forzando una lectura fresca del bucket', async () => {
    montar()
    // `true`: el admin abre esto justo para ver lo que hay AHORA; servirle la
    // caché sería enseñarle un catálogo que puede tener minutos de retraso.
    await waitFor(() => expect(catalogoMock).toHaveBeenCalledWith(true))
    expect(await screen.findByText(/Fundamentos de paralelismo/)).toBeInTheDocument()
  })

  it('explica los dos modos, no los esconde tras una casilla', async () => {
    montar()
    await screen.findByText(/Fundamentos de paralelismo/)

    // El texto ES el control: sin él, «vinculado» y «copia» son dos palabras.
    expect(screen.getByText(/te llegarán sus actualizaciones/)).toBeInTheDocument()
    expect(screen.getByText(/no recibe actualizaciones/)).toBeInTheDocument()
  })

  it('por defecto importa VINCULADO: sin as_module_id, y la versión que VIO', async () => {
    const { onImported } = montar()
    await screen.findByText(/Fundamentos de paralelismo/)

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    // CU-36.2: la versión elegida viaja; si cambió, el backend da 404 en vez de
    // sustituirla en silencio por otra.
    await waitFor(() =>
      expect(importarMock).toHaveBeenCalledWith({ module_id: 'mFundamentos', version: 2 }),
    )
    await waitFor(() => expect(onImported).toHaveBeenCalled())
  })

  it('en modo copia enseña el id que saldrá ANTES de importar', async () => {
    montar()
    await screen.findByText(/Fundamentos de paralelismo/)

    fireEvent.click(screen.getByRole('radio', { name: /copia independiente/i }))

    // Sin un ejemplo concreto, «se prefijan los ids» no significa nada.
    const campo = await screen.findByLabelText(/Identificador de la copia/i)
    expect((campo as HTMLInputElement).value).not.toBe('')
    expect(screen.getByText(/<id-de-lección>/)).toBeInTheDocument()
  })

  it('manda as_module_id al importar una copia', async () => {
    montar()
    await screen.findByText(/Fundamentos de paralelismo/)
    fireEvent.click(screen.getByRole('radio', { name: /copia independiente/i }))

    const campo = await screen.findByLabelText(/Identificador de la copia/i)
    fireEvent.change(campo, { target: { value: 'miVersion' } })
    // `slugify` lo normaliza: el id acaba siendo una ruta del bucket, así que el
    // diálogo no puede dejar pasar mayúsculas ni acentos.
    expect((campo as HTMLInputElement).value).toBe('miversion')

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    await waitFor(() =>
      expect(importarMock).toHaveBeenCalledWith({
        module_id: 'mFundamentos',
        version: 2,
        as_module_id: 'miversion',
      }),
    )
  })

  it('avisa del choque de id ANTES de enviar, y bloquea el botón', async () => {
    montar(['miversion'])
    await screen.findByText(/Fundamentos de paralelismo/)
    fireEvent.click(screen.getByRole('radio', { name: /copia independiente/i }))

    const campo = await screen.findByLabelText(/Identificador de la copia/i)
    fireEvent.change(campo, { target: { value: 'miVersion' } })

    expect(await screen.findByText(/Ya existe un módulo con ese identificador/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
    expect(importarMock).not.toHaveBeenCalled()
  })

  it('un módulo ya incorporado no se puede volver a vincular, y dice la salida', async () => {
    montar()
    await screen.findByText(/Fundamentos de paralelismo/)

    // `mExtra` viene con state 'installed'.
    fireEvent.change(screen.getByLabelText(/Módulo del catálogo/i), {
      target: { value: 'mExtra' },
    })

    // No basta con bloquear: hay que decir qué hacer en su lugar. Se mira el
    // AVISO concreto y no cualquier texto que diga «copia independiente», que
    // también está en la etiqueta del propio modo.
    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent(/ya está incorporado/i)
    expect(aviso).toHaveTextContent(/copia independiente/i)
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
  })

  it('traduce el 409 de id duplicado a algo accionable', async () => {
    montar()
    await screen.findByText(/Fundamentos de paralelismo/)
    importarMock.mockRejectedValue(new ApiError('DUPLICATE_ID', 'dup', 409, null))

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByText(/Elige otro para la copia/)).toBeInTheDocument()
  })

  it('si la versión elegida ya no es la publicada, lo dice claro (CU-36.2)', async () => {
    montar()
    await screen.findByText(/Fundamentos de paralelismo/)
    importarMock.mockRejectedValue(
      new ApiError('REMOTE_MODULE_NOT_FOUND', 'La versión 2 no está', 404, null),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent(/v2/)
    expect(aviso).toHaveTextContent(/ya no está publicada/i)
    expect(aviso).toHaveTextContent(/Actualiza la lista/i)
  })
})
