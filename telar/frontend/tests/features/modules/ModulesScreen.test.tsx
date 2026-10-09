// tests/features/modules/ModulesScreen.test.tsx — la pantalla `/modulos`
// (CU-35 explorar · CU-36 incorporar · CU-39 actualizar y quitar).
//
// Lo que se verifica aquí no es «que pinte»: son las tres reglas de producto
// que hacen que el mecanismo del catálogo remoto sirva para algo.
//
//  1. La copy «Tu progreso se conserva» está en LAS DOS confirmaciones (la de
//     actualizar y la de quitar). Es la promesa de §11.6.2/§11.6.4: sin ella
//     nadie actualiza y el catálogo entero deja de tener sentido.
//  2. El modo sin red es un caso de uso: caché ⇒ tira informativa y tarjetas
//     vivas; sin bucket configurado ⇒ explicación, NO `ErrorState` con un
//     «Reintentar» que no arreglaría nada. El `ErrorState` queda para el único
//     caso que lo merece (bucket caído y sin caché previa), y con `onRetry`.
//  3. Lo local no se enseña aquí: `DELETE /catalog/modules/{id}` respondería
//     404 sobre un módulo `local_only`, así que ofrecer «Quitar» sería mentir.
//
// El bloque final cubre el item del rail, que es la otra mitad de la regla 3
// del encargo (sin bucket, el item se OCULTA) y no tiene archivo propio.
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import ModulesScreen from '@/features/modules/ModulesScreen'
import { Sidebar } from '@/components/shell/Sidebar'
import { ApiError } from '@/api/client'
import { useCatalogStore } from '@/stores/catalogStore'
import { useProgressStore } from '@/stores/progressStore'
import type {
  CatalogStatusResponseDto,
  InstallResultDto,
  ModuleUpdatePreviewDto,
  RemoteCatalogResponseDto,
  UninstallResultDto,
} from '@/api/catalog-types'

// Estado compartido con la factoría hoisted de `useSystemInfo` (bloque del rail).
const sys = vi.hoisted(() => ({ catalogEnabled: true }))

vi.mock('@/api/catalog', () => ({
  getCatalogStatus: vi.fn(),
  refreshCatalog: vi.fn(),
  getRemoteCatalog: vi.fn(),
  getUpdatePreview: vi.fn(),
  installModule: vi.fn(),
  updateCatalogModule: vi.fn(),
  uninstallModule: vi.fn(),
}))

vi.mock('@/api/content', () => ({
  loadExamplesIndex: vi.fn(),
  getModules: vi.fn(),
  putLessonProgress: vi.fn(),
}))

// El rail consulta `GET /system` (bloque `catalog`) y su footer sondea Docker:
// ni una cosa ni la otra son objeto de este test.
vi.mock('@/hooks/useSystemInfo', () => ({
  useSystemInfo: () => ({
    data: {
      cores: 8,
      max_threads: 8,
      runner_image: 'telar-runner:latest',
      runner_image_present: true,
      gpu_examples_enabled: false,
      versions: {},
      limits: {},
      catalog: {
        enabled: sys.catalogEnabled,
        bucket: sys.catalogEnabled ? 'telar-modulos' : null,
        mode: 'anonymous',
        last_checked_at: null,
      },
    },
    error: null,
    loading: false,
    retry: () => {},
  }),
  loadSystemInfo: vi.fn(),
}))

vi.mock('@/hooks/useDockerStatus', () => ({
  useDockerStatus: () => ({
    state: 'ok',
    containers: null,
    lifting: false,
    liftError: null,
    up: async () => {},
    refresh: () => {},
  }),
}))

import {
  getCatalogStatus,
  getRemoteCatalog,
  getUpdatePreview,
  installModule,
  refreshCatalog,
  uninstallModule,
  updateCatalogModule,
} from '@/api/catalog'
import { loadExamplesIndex } from '@/api/content'

const getCatalogStatusMock = getCatalogStatus as Mock
const getRemoteCatalogMock = getRemoteCatalog as Mock
const getUpdatePreviewMock = getUpdatePreview as Mock
const installModuleMock = installModule as Mock
const refreshCatalogMock = refreshCatalog as Mock
const uninstallModuleMock = uninstallModule as Mock
const updateCatalogModuleMock = updateCatalogModule as Mock
const loadExamplesIndexMock = loadExamplesIndex as Mock

// ── fixtures (§11.4.1 / §11.5.1 / §11.6.2) ──────────────────────────────────

/** Lo instalado en ESTE equipo: uno con actualización, uno local, uno retirado. */
const STATUS: CatalogStatusResponseDto = {
  catalog_enabled: true,
  bucket: 'telar-modulos',
  last_checked_at: '2026-08-29T10:12:00.000Z',
  modules: [
    {
      module_id: 'm2',
      title: 'Patrón SPMD y false sharing',
      origin: 'remote',
      state: 'update_available',
      installed_version: 3,
      installed_checksum: '9f2c',
      available_version: 5,
      available_checksum: '1ab7',
      object_path: 'modulos/m2/v5.json',
      installed_at: '2026-08-01T09:00:00.000Z',
      updated_at: '2026-08-20T18:40:00.000Z',
      last_checked_at: '2026-08-29T10:12:00.000Z',
      lessons_total: 3,
      lessons_completed: 2,
    },
    {
      module_id: 'm1',
      title: 'Primeros pasos con OpenMP',
      origin: 'local',
      state: 'local_only',
      installed_version: 1,
      installed_checksum: null,
      available_version: null,
      available_checksum: null,
      object_path: null,
      installed_at: '2026-06-01T09:00:00.000Z',
      updated_at: null,
      last_checked_at: null,
      lessons_total: 4,
      lessons_completed: 4,
    },
    {
      module_id: 'm7',
      title: 'Vectorización con SIMD',
      origin: 'remote',
      state: 'installed',
      installed_version: 1,
      installed_checksum: 'aa01',
      available_version: 1,
      available_checksum: 'aa01',
      object_path: 'modulos/m7/v1.json',
      installed_at: '2026-07-10T09:00:00.000Z',
      updated_at: null,
      last_checked_at: '2026-08-29T10:12:00.000Z',
      lessons_total: 2,
      lessons_completed: 0,
    },
  ],
  summary: { modules_total: 3, installed: 2, updatable: 1, local_only: 1, never_checked: 0 },
}

/** Lo publicado en el bucket. m7 NO está: es el caso `unpublished`. */
const REMOTE: RemoteCatalogResponseDto = {
  bucket: 'telar-modulos',
  source: 'network',
  fetched_at: '2026-08-29T10:12:00.000Z',
  stale: false,
  unavailable_reason: null,
  modules: [
    {
      id: 'm9',
      title: 'Tasks y dependencias',
      description: 'omp task, taskwait y el grafo de dependencias.',
      level: 'Avanzado',
      order_hint: 9,
      version: 2,
      checksum: '1ab7c0',
      object_path: 'modulos/m9/v2.json',
      generation: 1755001234567890,
      size_bytes: 48211,
      published_at: '2026-08-22T11:00:00.000Z',
      author_label: 'Curso Telar — UN',
      lessons_count: 4,
      questions_count: 18,
      estimated_minutes_total: 75,
      requires_gpu: false,
      state: 'available',
      installed_version: null,
      installed_checksum: null,
    },
    {
      id: 'm2',
      title: 'Patrón SPMD y false sharing',
      description: 'El patrón SPMD sin `parallel for` y el coste del false sharing.',
      level: 'Intermedio',
      order_hint: 2,
      version: 5,
      checksum: '1ab7',
      object_path: 'modulos/m2/v5.json',
      generation: 1755001234567891,
      size_bytes: 30120,
      published_at: '2026-08-25T11:00:00.000Z',
      author_label: 'Curso Telar — UN',
      lessons_count: 3,
      questions_count: 12,
      estimated_minutes_total: 45,
      requires_gpu: false,
      state: 'update_available',
      installed_version: 3,
      installed_checksum: '9f2c',
    },
  ],
}

/** `/status` DESPUÉS de incorporar m9: es lo que devuelve el backend real. */
const STATUS_TRAS_INSTALAR: CatalogStatusResponseDto = {
  ...STATUS,
  modules: [
    ...STATUS.modules,
    {
      module_id: 'm9',
      title: 'Tasks y dependencias',
      origin: 'remote',
      state: 'installed',
      installed_version: 2,
      installed_checksum: '1ab7c0',
      available_version: 2,
      available_checksum: '1ab7c0',
      object_path: 'modulos/m9/v2.json',
      installed_at: '2026-08-29T10:15:00.000Z',
      updated_at: null,
      last_checked_at: '2026-08-29T10:12:00.000Z',
      lessons_total: 4,
      lessons_completed: 0,
    },
  ],
}

const PREVIEW: ModuleUpdatePreviewDto = {
  module_id: 'm2',
  from_version: 3,
  to_version: 5,
  to_checksum: '1ab7',
  lessons: [
    { lesson_id: 'spmd', title: 'π con patrón SPMD', change: 'updated', progress: 'preserved', reason: null },
    { lesson_id: 'spmdCritical', title: 'El arreglo: critical', change: 'updated', progress: 'rescored', reason: 'QUIZ_CHANGED' },
    { lesson_id: 'false-sharing', title: 'False sharing en detalle', change: 'added', progress: 'none', reason: null },
    // Sin título resoluble: la fila cae al id, que es el respaldo.
    { lesson_id: 'spmdViejo', title: null, change: 'removed', progress: 'archived', reason: 'LESSON_ID_REMOVED' },
  ],
  progress_summary: { preserved: 1, rescored: 1, archived: 1, unaffected: 0 },
  warnings: [
    {
      code: 'LESSON_ID_REMOVED',
      lesson_id: 'spmdViejo',
      message: 'La versión 5 ya no incluye esta lección; tu avance en ella dejará de mostrarse.',
    },
  ],
}

function installResult(over: Partial<InstallResultDto> = {}): InstallResultDto {
  return {
    module_id: 'm9',
    installed_version: 2,
    installed_checksum: '1ab7c0',
    object_path: 'modulos/m9/v2.json',
    local_order: 9,
    order_reassigned: false,
    lessons_added: [],
    lessons_updated: [],
    lessons_removed: [],
    questions_total: 18,
    progress: { preserved: 0, rescored: 0, archived: 0, unaffected: 0 },
    installed_at: '2026-08-29T10:15:00.000Z',
    ...over,
  }
}

const UNINSTALL_RESULT: UninstallResultDto = {
  removed: true,
  module_id: 'm7',
  lessons_removed: 2,
  progress_purged: false,
  progress_archived: 2,
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/modulos']}>
      <Routes>
        <Route path="/modulos" element={<ModulesScreen />} />
        <Route path="/aprender" element={<div>PANTALLA APRENDER</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Espera a que el catálogo esté pintado (se acabó el skeleton). */
async function renderCatalogo() {
  const view = renderScreen()
  await screen.findByText('Tasks y dependencias')
  return view
}

beforeEach(() => {
  localStorage.clear()
  sys.catalogEnabled = true
  useCatalogStore.setState({
    status: null,
    remote: null,
    stale: false,
    loadingStatus: false,
    loadingRemote: false,
    refreshing: false,
    statusError: null,
    remoteError: null,
    ops: {},
    opErrors: {},
  })
  // El progressStore real se sustituye por un espía: que su caché se invalide
  // ya está probado en tests/stores/catalogStore.test.ts.
  useProgressStore.setState({ hydrate: vi.fn(async () => {}) })

  for (const m of [
    getCatalogStatusMock,
    getRemoteCatalogMock,
    getUpdatePreviewMock,
    installModuleMock,
    refreshCatalogMock,
    uninstallModuleMock,
    updateCatalogModuleMock,
    loadExamplesIndexMock,
  ]) {
    m.mockReset()
  }
  getCatalogStatusMock.mockResolvedValue(structuredClone(STATUS))
  refreshCatalogMock.mockResolvedValue(structuredClone(STATUS))
  getRemoteCatalogMock.mockResolvedValue(structuredClone(REMOTE))
  getUpdatePreviewMock.mockResolvedValue(structuredClone(PREVIEW))
  installModuleMock.mockResolvedValue(installResult())
  updateCatalogModuleMock.mockResolvedValue(
    installResult({ module_id: 'm2', installed_version: 5, installed_checksum: '1ab7' }),
  )
  uninstallModuleMock.mockResolvedValue(UNINSTALL_RESULT)
  loadExamplesIndexMock.mockResolvedValue(new Map())
})

// ── CU-35 · explorar ────────────────────────────────────────────────────────

describe('CU-35 · explorar el catálogo', () => {
  it('mientras carga muestra el esqueleto, no una pantalla vacía', async () => {
    let soltar: (r: RemoteCatalogResponseDto) => void = () => {}
    getRemoteCatalogMock.mockReturnValue(
      new Promise<RemoteCatalogResponseDto>((res) => {
        soltar = res
      }),
    )
    const { container } = renderScreen()

    await waitFor(() => expect(container.querySelector('section[aria-busy="true"]')).not.toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()

    // Se libera la promesa: si quedara pendiente, el dedupe del store
    // (`remoteInflight`) la heredaría el test siguiente.
    await act(async () => {
      soltar(structuredClone(REMOTE))
    })
  })

  it('una tarjeta por módulo del catálogo, con sus metadatos', async () => {
    await renderCatalogo()

    expect(screen.getByText('omp task, taskwait y el grafo de dependencias.')).toBeInTheDocument()
    expect(screen.getByText('Avanzado')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('4 lecciones')).toBeInTheDocument()
    expect(screen.getByText('18 preguntas')).toBeInTheDocument()
    expect(screen.getByText('~75 min')).toBeInTheDocument()
    // `fmtBytes` de lib/format.ts: dos decimales por debajo de 10, uno
    // entre 10 y 100, ninguno por encima. Se reutiliza el formateador del
    // repo en vez de inventar otro, para que los tamaños se lean igual en
    // toda la app.
    expect(screen.getByText('47.1 KB')).toBeInTheDocument()
  })

  it('cada estado trae su chip y SOLO sus acciones', async () => {
    await renderCatalogo()

    expect(screen.getByText('Disponible')).toBeInTheDocument()
    expect(screen.getByText('Actualización · v5')).toBeInTheDocument()
    expect(screen.getByText('Ya no publicado')).toBeInTheDocument()

    // Disponible: se incorpora, no se quita.
    expect(screen.getByRole('button', { name: 'Incorporar Tasks y dependencias' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Quitar Tasks/ })).toBeNull()
    // Con actualización: ver, actualizar y quitar.
    expect(screen.getByRole('button', { name: /^Ver qué cambia en Patrón SPMD/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Actualizar Patrón SPMD/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Quitar Patrón SPMD/ })).toBeInTheDocument()
    // Despublicado: solo se puede quitar.
    expect(screen.getByRole('button', { name: 'Quitar Vectorización con SIMD' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actualizar Vectorización/ })).toBeNull()
  })

  it('los módulos LOCALES no aparecen: aquí no se pueden ni incorporar ni quitar', async () => {
    await renderCatalogo()

    // m1 es `origin: local` en /status y no está en el bucket (§11.6.4 daría
    // 404 MODULE_NOT_INSTALLED). Su sitio es /aprender, no esta pantalla.
    expect(screen.queryByText('Primeros pasos con OpenMP')).toBeNull()
  })

  it('CU-34.3: una publicación que choca con un módulo local SIGUE visible, marcada', async () => {
    const remoto = structuredClone(REMOTE)
    remoto.modules.push({
      ...structuredClone(REMOTE.modules[0]),
      id: 'm1',
      title: 'Primeros pasos con OpenMP (publicado)',
      object_path: 'modulos/m1/v3.json',
      version: 3,
    })
    getRemoteCatalogMock.mockResolvedValue(remoto)
    await renderCatalogo()

    const titulo = await screen.findByText('Primeros pasos con OpenMP (publicado)')
    const tarjeta = titulo.closest('section') as HTMLElement
    expect(within(tarjeta).getByText('Conflicto con un módulo local')).toBeInTheDocument()
    // Se puede mirar, pero no incorporar (daría DUPLICATE_ID) ni quitar (404).
    expect(within(tarjeta).getByRole('link', { name: /Ver detalle/ })).toBeInTheDocument()
    expect(within(tarjeta).queryByRole('button', { name: /^Incorporar/ })).toBeNull()
    expect(within(tarjeta).queryByRole('button', { name: /^Quitar/ })).toBeNull()
    // Y no se cuela en «Instalados»: allí no hay nada que hacer con ella.
    fireEvent.click(screen.getByRole('button', { name: /^Instalados/ }))
    expect(screen.queryByText('Primeros pasos con OpenMP (publicado)')).toBeNull()
  })

  it('el buscador filtra por título y descripción', async () => {
    await renderCatalogo()

    fireEvent.change(screen.getByLabelText('Buscar módulo por título o tema'), {
      target: { value: 'false sharing' },
    })

    expect(screen.getByText('Patrón SPMD y false sharing')).toBeInTheDocument()
    expect(screen.queryByText('Tasks y dependencias')).toBeNull()
  })

  it('el filtro «Con actualización» deja solo lo actualizable', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /Con actualización/ }))

    expect(screen.getByText('Patrón SPMD y false sharing')).toBeInTheDocument()
    expect(screen.queryByText('Tasks y dependencias')).toBeNull()
    expect(screen.queryByText('Vectorización con SIMD')).toBeNull()
  })

  it('«Actualizar lista» consulta el bucket Y refresca el estado de /aprender', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar lista' }))

    await waitFor(() => expect(getRemoteCatalogMock).toHaveBeenCalledWith(true))
    // §11.4.2: los chips «Actualización» de /aprender salen de SQLite, y solo
    // POST /catalog/refresh los pone al día. Un clic, las dos vistas.
    expect(refreshCatalogMock).toHaveBeenCalled()
  })
})

// ── CU-36 · incorporar ──────────────────────────────────────────────────────

describe('CU-36 · incorporar un módulo', () => {
  it('ancla la versión y el checksum que el usuario VIO (cierra el TOCTOU)', async () => {
    getCatalogStatusMock
      .mockResolvedValueOnce(structuredClone(STATUS))
      .mockResolvedValue(structuredClone(STATUS_TRAS_INSTALAR))
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: 'Incorporar Tasks y dependencias' }))

    await waitFor(() =>
      expect(installModuleMock).toHaveBeenCalledWith({
        module_id: 'm9',
        version: 2,
        expected_checksum: '1ab7c0',
      }),
    )
    // La tarjeta cuenta la verdad nueva sin recargar la pantalla.
    expect(await screen.findByText('Instalado')).toBeInTheDocument()
    expect(await screen.findByText(/ya está en tu equipo/)).toBeInTheDocument()
  })

  it('un fallo del contrato se explica en la tarjeta y se puede descartar', async () => {
    installModuleMock.mockRejectedValue(
      new ApiError('CHECKSUM_MISMATCH', 'sha256 mismatch for modulos/m9/v2.json', 409),
    )
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: 'Incorporar Tasks y dependencias' }))

    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent(/cambió mientras lo mirabas/)

    fireEvent.click(screen.getByRole('button', { name: 'Descartar el aviso de Tasks y dependencias' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('«Descargar todo»', () => {
  it('incorpora SOLO los que faltan: ni los instalados ni los conflictos locales', async () => {
    const remoto = structuredClone(REMOTE)
    remoto.modules.push(
      {
        ...structuredClone(REMOTE.modules[0]),
        id: 'm10',
        title: 'Límites de PyOMP',
        object_path: 'modulos/m10/v1.json',
        version: 1,
        checksum: 'cc10',
      },
      // Choca con el m1 local (CU-34.3): incorporarlo daría DUPLICATE_ID.
      { ...structuredClone(REMOTE.modules[0]), id: 'm1', title: 'Primeros pasos (publicado)' },
    )
    getRemoteCatalogMock.mockResolvedValue(remoto)
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /Descargar todo/ }))

    expect(await screen.findByText(/Se incorporaron 2 módulos/)).toBeInTheDocument()
    expect(installModuleMock.mock.calls.map(([body]) => body.module_id)).toEqual(['m9', 'm10'])
  })

  it('si ya está todo descargado lo dice y no llama a la API', async () => {
    const remoto = structuredClone(REMOTE)
    remoto.modules = remoto.modules.filter((m) => m.state !== 'available')
    getRemoteCatalogMock.mockResolvedValue(remoto)
    renderScreen()
    await screen.findByText('Patrón SPMD y false sharing')

    fireEvent.click(screen.getByRole('button', { name: /Descargar todo/ }))

    expect(await screen.findByText(/Ya tienes todos los módulos del catálogo/)).toBeInTheDocument()
    expect(installModuleMock).not.toHaveBeenCalled()
  })

  it('cuenta los fallos sin detener el resto', async () => {
    const remoto = structuredClone(REMOTE)
    remoto.modules.push({
      ...structuredClone(REMOTE.modules[0]),
      id: 'm10',
      title: 'Límites de PyOMP',
      object_path: 'modulos/m10/v1.json',
    })
    getRemoteCatalogMock.mockResolvedValue(remoto)
    installModuleMock
      .mockRejectedValueOnce(new ApiError('CATALOG_UNAVAILABLE', 'down', 503))
      .mockResolvedValue(installResult({ module_id: 'm10' }))
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /Descargar todo/ }))

    expect(await screen.findByText(/Se incorporó 1 módulo; 1 no se pudo incorporar/)).toBeInTheDocument()
    expect(installModuleMock).toHaveBeenCalledTimes(2)
  })
})

// ── CU-39 · actualizar y quitar ─────────────────────────────────────────────

describe('CU-39 · actualizar', () => {
  it('«Ver qué cambia» lista lección por lección qué se conserva y qué se archiva', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /^Ver qué cambia en Patrón SPMD/ }))

    const dialogo = await screen.findByRole('dialog')
    // Se pide el diff de la versión que la tarjeta enseñaba (§11.6.2).
    expect(getUpdatePreviewMock).toHaveBeenCalledWith('m2', 5)

    const filas = within(dialogo).getByRole('list', { name: 'Cambios lección por lección' })
    // La fila dice el TÍTULO, no el id: el diálogo existe para que el estudiante
    // entienda qué cambia, y `spmd` no le comunica nada.
    expect(within(filas).getByText('π con patrón SPMD')).toBeInTheDocument()
    expect(within(filas).getByText('False sharing en detalle')).toBeInTheDocument()
    // Y cuando el servidor no pudo resolver el título, la fila cae al id.
    expect(within(filas).getByText('spmdViejo')).toBeInTheDocument()
    expect(within(filas).getByText('Tu avance se conserva')).toBeInTheDocument()
    expect(within(filas).getByText('Retirada')).toBeInTheDocument()
    expect(within(filas).getByText('Se archiva: tu avance se guarda')).toBeInTheDocument()
    // `rescored` NO es «pierdes la nota»: el contrato prohíbe revocar un aprobado.
    // CU-38.3: y se dice en futuro, porque es lo que HARÁ la actualización.
    expect(within(filas).getByText(/Se recalificará/)).toBeInTheDocument()
    expect(within(filas).getByText(/lo aprobado no se revoca/)).toBeInTheDocument()
    expect(dialogo).toHaveTextContent(/se recalificarán?/)
    // El aviso no bloqueante del preview llega íntegro.
    expect(dialogo).toHaveTextContent(/ya no incluye esta lección/)
  })

  it('la confirmación de actualizar DICE que el progreso se conserva', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /^Ver qué cambia en Patrón SPMD/ }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(/Tu progreso se conserva/)
  })

  it('«Actualizar» desde la tarjeta también confirma (y también lo dice)', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /^Actualizar Patrón SPMD/ }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/Tu progreso se conserva/)
    // No se ha escrito nada todavía: el botón de la tarjeta abre, no actualiza.
    expect(updateCatalogModuleMock).not.toHaveBeenCalled()
    // Y el diff solo se pide cuando se pide: aquí aún no.
    expect(getUpdatePreviewMock).not.toHaveBeenCalled()
    expect(within(dialogo).getByRole('button', { name: 'Ver qué cambia' })).toBeInTheDocument()
  })

  it('confirmar actualiza a la versión previsualizada y cierra el diálogo', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /^Ver qué cambia en Patrón SPMD/ }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }))

    await waitFor(() =>
      expect(updateCatalogModuleMock).toHaveBeenCalledWith('m2', {
        to_version: 5,
        expected_checksum: '1ab7',
      }),
    )
    // `on_removed_lessons` NO viaja: el default del backend (`archive`) es el
    // que sostiene la copy. Mandar `purge` sin pedirlo sería romper la promesa.
    expect(updateCatalogModuleMock.mock.calls[0][1]).not.toHaveProperty('on_removed_lessons')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText(/está actualizado\. Tu progreso se conserva/)).toBeInTheDocument()
  })

  it('si la actualización falla, el diálogo sigue abierto con el motivo', async () => {
    updateCatalogModuleMock.mockRejectedValue(
      new ApiError('VERSION_CONFLICT', 'to_version 5 <= installed_version 5', 409),
    )
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /^Actualizar Patrón SPMD/ }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }))

    // Hay dos alertas en pantalla: la del diálogo y la de la tarjeta. Se
    // consulta la del DIÁLOGO, que es la que el estudiante está mirando.
    const dialogo = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dialogo).getByRole('alert')).toHaveTextContent(
        /versión igual o más nueva/,
      ),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Escape cierra el diálogo sin escribir nada', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: /^Actualizar Patrón SPMD/ }))
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(updateCatalogModuleMock).not.toHaveBeenCalled()
  })
})

describe('CU-39 · quitar', () => {
  it('pide confirmación, promete conservar el progreso y NO purga', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Vectorización con SIMD' }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/¿Quitar «Vectorización con SIMD»\?/)
    expect(dialogo).toHaveTextContent(/Tu progreso se conserva/)
    expect(uninstallModuleMock).not.toHaveBeenCalled()

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar módulo' }))

    // El avance sobrevive huérfano y reinstalar lo recupera (§11.6.4). La
    // llamada sale con UN solo argumento: desde que se quitó `purge_progress`
    // no existe forma de pedir el borrado, así que la copy de arriba dejó de
    // ser una promesa del cliente y pasó a ser una propiedad de la API.
    await waitFor(() => expect(uninstallModuleMock).toHaveBeenCalledWith('m7'))
    expect(await screen.findByText(/se quitó de este equipo/)).toBeInTheDocument()
  })

  it('cancelar no llama a la API', async () => {
    await renderCatalogo()

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Vectorización con SIMD' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(uninstallModuleMock).not.toHaveBeenCalled()
  })
})

// ── §11.9 · sin red ─────────────────────────────────────────────────────────

describe('modo sin red (§11.9)', () => {
  it('bucket caído SIN caché: ErrorState con Reintentar (la única pantalla que puede)', async () => {
    getRemoteCatalogMock.mockRejectedValue(
      new ApiError('CATALOG_UNAVAILABLE', 'bucket unreachable', 503),
    )
    renderScreen()

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(/No se pudo consultar el catálogo/)
    expect(error).toHaveTextContent(/Revisa tu conexión/)

    getRemoteCatalogMock.mockResolvedValue(structuredClone(REMOTE))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Tasks y dependencias')).toBeInTheDocument()
  })

  it('respuesta de caché (`stale`): aviso informativo, NUNCA un error', async () => {
    getRemoteCatalogMock.mockResolvedValue({
      ...structuredClone(REMOTE),
      source: 'cache',
      stale: true,
      unavailable_reason: 'bucket unreachable',
    })
    await renderCatalogo()

    const aviso = screen.getByRole('status')
    expect(aviso).toHaveTextContent(/última lista guardada/)
    // Ni `role="alert"` ni pantalla bloqueada: las tarjetas siguen ahí.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Incorporar Tasks y dependencias' })).toBeInTheDocument()
  })

  it('sin bucket configurado: se explica, no se ofrece «Reintentar»', async () => {
    getRemoteCatalogMock.mockRejectedValue(new ApiError('CATALOG_DISABLED', 'no bucket', 503))
    renderScreen()

    expect(await screen.findByText('Este equipo no tiene catálogo de módulos')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })

  it('bucket vacío: estado vacío, que no es lo mismo que un fallo', async () => {
    getRemoteCatalogMock.mockResolvedValue({ ...structuredClone(REMOTE), modules: [] })
    getCatalogStatusMock.mockResolvedValue({
      ...structuredClone(STATUS),
      // Solo queda lo local: nada que el bucket publique ni haya publicado.
      modules: STATUS.modules.filter((m) => m.origin === 'local'),
    })
    renderScreen()

    expect(await screen.findByText('El catálogo todavía no publica módulos')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ── el item del rail (§11.12.A) ─────────────────────────────────────────────

describe('item «Módulos disponibles» del rail', () => {
  function renderRail() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    )
  }

  it('con bucket configurado aparece, y con NOMBRE accesible', () => {
    sys.catalogEnabled = true
    renderRail()

    const item = screen.getByRole('link', { name: 'Módulos disponibles' })
    expect(item).toHaveAttribute('href', '/modulos')
    // El rail mide 56px: `.nav-label` está en display:none y el tooltip es un
    // ::after. Sin `aria-label` el enlace no tendría nombre (WCAG 2.4.4/4.1.2).
    expect(item).toHaveAttribute('aria-label', 'Módulos disponibles')
  })

  it('sin bucket configurado se OCULTA (no se muestra roto)', () => {
    sys.catalogEnabled = false
    renderRail()

    expect(screen.queryByRole('link', { name: 'Módulos disponibles' })).toBeNull()
    // El resto del rail sigue intacto: apagar el catálogo no apaga la app.
    expect(screen.getByRole('link', { name: 'Aprender' })).toBeInTheDocument()
  })
})
