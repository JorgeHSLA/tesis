// tests/stores/catalogStore.test.ts — estado del catálogo remoto (§11.4-§11.6).
// Lo que se verifica aquí es lo que sostiene el mecanismo entero:
//  - dedupe de llamadas concurrentes (patrón de `progressStore.hydrate`),
//  - un fallo de red NO deja la tarjeta colgada en «instalando…»,
//  - todo éxito invalida LAS DOS cachés de contenido (progreso + índice de
//    ejemplos), porque la segunda es una promesa memoizada que nadie más toca,
//  - el store NO persiste nada: el manifiesto vive en SQLite,
//  - `/cursos` no se rompe porque el bucket esté caído.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ApiError } from '@/api/client'
import { selectCatalogDiff, shouldShowRemoteError, useCatalogStore } from '@/stores/catalogStore'
import { useProgressStore } from '@/stores/progressStore'
import type {
  CatalogStatusResponseDto,
  InstallResultDto,
  RemoteCatalogResponseDto,
  UninstallResultDto,
} from '@/api/catalog-types'

vi.mock('@/api/catalog', () => ({
  getCatalogStatus: vi.fn(),
  refreshCatalog: vi.fn(),
  getRemoteCatalog: vi.fn(),
  installModule: vi.fn(),
  updateCatalogModule: vi.fn(),
  uninstallModule: vi.fn(),
}))

vi.mock('@/api/content', () => ({
  loadExamplesIndex: vi.fn(),
  getModules: vi.fn(),
  putLessonProgress: vi.fn(),
}))

import {
  getCatalogStatus,
  getRemoteCatalog,
  installModule,
  refreshCatalog,
  uninstallModule,
  updateCatalogModule,
} from '@/api/catalog'
import { loadExamplesIndex } from '@/api/content'

const getCatalogStatusMock = getCatalogStatus as Mock
const refreshCatalogMock = refreshCatalog as Mock
const getRemoteCatalogMock = getRemoteCatalog as Mock
const installModuleMock = installModule as Mock
const updateCatalogModuleMock = updateCatalogModule as Mock
const uninstallModuleMock = uninstallModule as Mock
const loadExamplesIndexMock = loadExamplesIndex as Mock

// ── fixtures (§11.4.1 / §11.5.1) ────────────────────────────────────────────

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
      installed_version: null,
      installed_checksum: null,
      available_version: null,
      available_checksum: null,
      object_path: null,
      installed_at: null,
      updated_at: null,
      last_checked_at: null,
      lessons_total: 2,
      lessons_completed: 2,
    },
  ],
  summary: { modules_total: 2, installed: 1, updatable: 1, local_only: 1, never_checked: 0 },
}

const REMOTE: RemoteCatalogResponseDto = {
  bucket: 'telar-modulos',
  source: 'network',
  fetched_at: '2026-08-29T10:12:00.000Z',
  stale: false,
  unavailable_reason: null,
  modules: [
    {
      id: 'm2',
      title: 'Patrón SPMD y false sharing',
      description: 'Reparto manual del trabajo entre hilos.',
      level: 'Intermedio',
      order_hint: 2,
      version: 5,
      checksum: '1ab7',
      object_path: 'modulos/m2/v5.json',
      generation: 1712345678901234,
      size_bytes: 40960,
      published_at: '2026-08-20T18:40:00.000Z',
      author_label: 'Cátedra de HPC',
      lessons_count: 3,
      questions_count: 12,
      estimated_minutes_total: 45,
      requires_gpu: false,
      state: 'update_available',
      installed_version: 3,
      installed_checksum: '9f2c',
    },
    {
      id: 'm9',
      title: 'Tareas y dependencias',
      description: 'El modelo de tareas de OpenMP.',
      level: 'Avanzado',
      order_hint: 9,
      version: 2,
      checksum: 'ca11',
      object_path: 'modulos/m9/v2.json',
      generation: 1712345678905555,
      size_bytes: 51200,
      published_at: '2026-08-25T11:00:00.000Z',
      author_label: 'Cátedra de HPC',
      lessons_count: 4,
      questions_count: 18,
      estimated_minutes_total: 60,
      requires_gpu: false,
      state: 'available',
      installed_version: null,
      installed_checksum: null,
    },
  ],
}

function installResult(over: Partial<InstallResultDto> = {}): InstallResultDto {
  return {
    module_id: 'm9',
    installed_version: 2,
    installed_checksum: 'ca11',
    object_path: 'modulos/m9/v2.json',
    local_order: 9,
    order_reassigned: false,
    lessons_added: ['task-intro'],
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
  module_id: 'm9',
  lessons_removed: 4,
  progress_purged: false,
  progress_archived: 4,
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let hydrateSpy: Mock

beforeEach(() => {
  localStorage.clear()
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
  // El progressStore real se sustituye por un espía: aquí solo importa QUE se
  // invalide su caché, no cómo la rellena.
  hydrateSpy = vi.fn(async () => {})
  useProgressStore.setState({ hydrate: hydrateSpy })

  for (const m of [
    getCatalogStatusMock,
    refreshCatalogMock,
    getRemoteCatalogMock,
    installModuleMock,
    updateCatalogModuleMock,
    uninstallModuleMock,
    loadExamplesIndexMock,
  ]) {
    m.mockReset()
  }
  getCatalogStatusMock.mockResolvedValue(structuredClone(STATUS))
  refreshCatalogMock.mockResolvedValue(structuredClone(STATUS))
  getRemoteCatalogMock.mockResolvedValue(structuredClone(REMOTE))
  installModuleMock.mockResolvedValue(installResult())
  updateCatalogModuleMock.mockResolvedValue(
    installResult({ module_id: 'm2', installed_version: 5, installed_checksum: '1ab7' }),
  )
  uninstallModuleMock.mockResolvedValue(UNINSTALL_RESULT)
  loadExamplesIndexMock.mockResolvedValue(new Map())
})

// ── §11.4 estado instalado ──────────────────────────────────────────────────

describe('hydrateStatus()', () => {
  it('puebla el estado instalado desde GET /catalog/status', async () => {
    await useCatalogStore.getState().hydrateStatus()
    const st = useCatalogStore.getState()
    expect(st.status?.modules).toHaveLength(2)
    expect(st.loadingStatus).toBe(false)
    expect(st.statusError).toBeNull()
  })

  it('dedupe de llamadas concurrentes: un solo GET', async () => {
    const a = useCatalogStore.getState().hydrateStatus()
    const b = useCatalogStore.getState().hydrateStatus()
    await Promise.all([a, b])
    expect(getCatalogStatusMock).toHaveBeenCalledTimes(1)
  })

  it('no re-consulta si ya hay caché (salvo force)', async () => {
    await useCatalogStore.getState().hydrateStatus()
    await useCatalogStore.getState().hydrateStatus()
    expect(getCatalogStatusMock).toHaveBeenCalledTimes(1)
    await useCatalogStore.getState().hydrateStatus(true)
    expect(getCatalogStatusMock).toHaveBeenCalledTimes(2)
  })

  it('un fallo queda anotado con su código, sin dejar `loading` colgado', async () => {
    getCatalogStatusMock.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'Backend inalcanzable.', 0))
    await useCatalogStore.getState().hydrateStatus()
    const st = useCatalogStore.getState()
    expect(st.statusError).toEqual({ code: 'NETWORK_ERROR', message: 'Backend inalcanzable.' })
    expect(st.loadingStatus).toBe(false)
    expect(st.status).toBeNull()
  })
})

describe('refreshStatus() — efecto NO bloqueante de /cursos', () => {
  it('éxito: reemplaza el estado y limpia el error', async () => {
    useCatalogStore.setState({ statusError: { code: 'CATALOG_UNAVAILABLE', message: 'x' } })
    await useCatalogStore.getState().refreshStatus()
    expect(useCatalogStore.getState().status?.bucket).toBe('telar-modulos')
    expect(useCatalogStore.getState().statusError).toBeNull()
    expect(useCatalogStore.getState().refreshing).toBe(false)
  })

  it('bucket caído: NO pinta ErrorState ni borra lo ya cargado (regla de /cursos)', async () => {
    useCatalogStore.setState({ status: structuredClone(STATUS) })
    refreshCatalogMock.mockRejectedValueOnce(
      new ApiError('CATALOG_UNAVAILABLE', 'El bucket no responde.', 503),
    )
    await useCatalogStore.getState().refreshStatus()
    const st = useCatalogStore.getState()
    expect(st.status?.modules).toHaveLength(2) // la pantalla sigue completa
    expect(st.remoteError).toBeNull() // lo único que podría pintar ErrorState
    expect(st.statusError?.code).toBe('CATALOG_UNAVAILABLE')
    expect(st.refreshing).toBe(false)
  })
})

// ── §11.5 catálogo remoto ───────────────────────────────────────────────────

describe('loadRemote()', () => {
  it('puebla el listado y refleja `stale`', async () => {
    getRemoteCatalogMock.mockResolvedValueOnce({ ...structuredClone(REMOTE), stale: true, source: 'cache' })
    await useCatalogStore.getState().loadRemote()
    const st = useCatalogStore.getState()
    expect(st.remote?.modules).toHaveLength(2)
    expect(st.stale).toBe(true)
    expect(st.loadingRemote).toBe(false)
  })

  it('force ⇒ ?refresh=true, y dedupea las llamadas concurrentes', async () => {
    const a = useCatalogStore.getState().loadRemote()
    const b = useCatalogStore.getState().loadRemote()
    await Promise.all([a, b])
    expect(getRemoteCatalogMock).toHaveBeenCalledTimes(1)
    expect(getRemoteCatalogMock).toHaveBeenCalledWith(false)
    await useCatalogStore.getState().loadRemote(true)
    expect(getRemoteCatalogMock).toHaveBeenCalledWith(true)
  })

  it('con la lista ya en memoria no se vuelve al bucket (salvo force)', async () => {
    await useCatalogStore.getState().loadRemote()
    await useCatalogStore.getState().loadRemote()
    expect(getRemoteCatalogMock).toHaveBeenCalledTimes(1)
  })

  it('sin caché previa: ErrorState con su código (la ÚNICA pantalla que puede)', async () => {
    getRemoteCatalogMock.mockRejectedValueOnce(
      new ApiError('CATALOG_UNAVAILABLE', 'El bucket no responde.', 503),
    )
    await useCatalogStore.getState().loadRemote()
    const st = useCatalogStore.getState()
    expect(st.remoteError?.code).toBe('CATALOG_UNAVAILABLE')
    expect(shouldShowRemoteError(st)).toBe(true)
  })

  it('con caché previa: se conserva la lista y NO se pinta ErrorState', async () => {
    await useCatalogStore.getState().loadRemote()
    getRemoteCatalogMock.mockRejectedValueOnce(new ApiError('CATALOG_UNAVAILABLE', 'Caído.', 503))
    await useCatalogStore.getState().loadRemote(true)
    const st = useCatalogStore.getState()
    expect(st.remote?.modules).toHaveLength(2)
    expect(st.remoteError?.code).toBe('CATALOG_UNAVAILABLE')
    expect(shouldShowRemoteError(st)).toBe(false)
  })
})

// ── §11.6 instalar / actualizar / quitar ────────────────────────────────────

describe('install()', () => {
  beforeEach(() => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: structuredClone(REMOTE) })
  })

  it('ancla versión y checksum de lo que el usuario VIO (cierra el TOCTOU)', async () => {
    await expect(useCatalogStore.getState().install('m9')).resolves.toBe(true)
    expect(installModuleMock).toHaveBeenCalledWith({
      module_id: 'm9',
      version: 2,
      expected_checksum: 'ca11',
    })
  })

  it('invalida LAS DOS cachés de contenido y re-lee el manifiesto', async () => {
    await useCatalogStore.getState().install('m9')
    expect(hydrateSpy).toHaveBeenCalledWith(true)
    expect(loadExamplesIndexMock).toHaveBeenCalledWith(true)
    expect(getCatalogStatusMock).toHaveBeenCalledTimes(1) // hydrateStatus(true)
  })

  it('el índice de ejemplos caído no convierte una instalación buena en un fallo', async () => {
    loadExamplesIndexMock.mockRejectedValueOnce(new Error('sin red'))
    await expect(useCatalogStore.getState().install('m9')).resolves.toBe(true)
    expect(useCatalogStore.getState().opErrors.m9).toBeUndefined()
  })

  it('refleja el módulo instalado en la tarjeta sin volver al bucket', async () => {
    await useCatalogStore.getState().install('m9')
    const card = useCatalogStore.getState().remote?.modules.find((m) => m.id === 'm9')
    expect(card?.state).toBe('installed')
    expect(card?.installed_version).toBe(2)
  })

  it('una versión anterior a la publicada no arrastra el checksum ajeno y queda actualizable', async () => {
    installModuleMock.mockResolvedValueOnce(installResult({ installed_version: 1, installed_checksum: 'aa01' }))
    await useCatalogStore.getState().install('m9', { version: 1 })
    expect(installModuleMock).toHaveBeenCalledWith({ module_id: 'm9', version: 1 })
    expect(useCatalogStore.getState().remote?.modules.find((m) => m.id === 'm9')?.state).toBe(
      'update_available',
    )
  })

  it('sin catálogo cargado manda solo el id (el backend elige la última)', async () => {
    useCatalogStore.setState({ status: null, remote: null })
    await useCatalogStore.getState().install('m9')
    expect(installModuleMock).toHaveBeenCalledWith({ module_id: 'm9' })
  })

  it('instalar un módulo que no está en el índice cargado no inventa una tarjeta', async () => {
    installModuleMock.mockResolvedValueOnce(installResult({ module_id: 'm4', installed_version: 1 }))
    await expect(useCatalogStore.getState().install('m4')).resolves.toBe(true)
    expect(useCatalogStore.getState().remote?.modules.map((m) => m.id)).toEqual(['m2', 'm9'])
  })

  it('un rechazo que no es Error tampoco se traga', async () => {
    installModuleMock.mockRejectedValueOnce('sin conexión')
    await useCatalogStore.getState().install('m9')
    expect(useCatalogStore.getState().opErrors.m9).toEqual({ code: 'UNKNOWN', message: 'sin conexión' })
  })

  it('marca la operación en curso mientras vuela y la limpia al terminar', async () => {
    const d = deferred<InstallResultDto>()
    installModuleMock.mockReturnValueOnce(d.promise)
    const p = useCatalogStore.getState().install('m9')
    expect(useCatalogStore.getState().ops.m9).toBe('installing')
    d.resolve(installResult())
    await p
    expect(useCatalogStore.getState().ops.m9).toBeUndefined()
  })

  it('un fallo de red NO deja la operación colgada en «instalando»', async () => {
    installModuleMock.mockRejectedValueOnce(new ApiError('CATALOG_UNAVAILABLE', 'El bucket no responde.', 503))
    await expect(useCatalogStore.getState().install('m9')).resolves.toBe(false)
    const st = useCatalogStore.getState()
    expect(st.ops.m9).toBeUndefined()
    expect(st.opErrors.m9).toEqual({ code: 'CATALOG_UNAVAILABLE', message: 'El bucket no responde.' })
    // Nada que invalidar: no se escribió nada.
    expect(hydrateSpy).not.toHaveBeenCalled()
    expect(loadExamplesIndexMock).not.toHaveBeenCalled()
  })

  it('un error sin ApiError también se registra (nunca se traga)', async () => {
    installModuleMock.mockRejectedValueOnce(new Error('boom'))
    await useCatalogStore.getState().install('m9')
    expect(useCatalogStore.getState().opErrors.m9).toEqual({ code: 'UNKNOWN', message: 'boom' })
    useCatalogStore.getState().clearOpError('m9')
    expect(useCatalogStore.getState().opErrors.m9).toBeUndefined()
  })

  it('doble clic: la segunda llamada no dispara una segunda instalación', async () => {
    const d = deferred<InstallResultDto>()
    installModuleMock.mockReturnValueOnce(d.promise)
    const first = useCatalogStore.getState().install('m9')
    await expect(useCatalogStore.getState().install('m9')).resolves.toBe(false)
    expect(installModuleMock).toHaveBeenCalledTimes(1)
    d.resolve(installResult())
    await expect(first).resolves.toBe(true)
  })
})

describe('update()', () => {
  it('ancla `to_version` y checksum, y OMITE on_removed_lessons (el default conserva)', async () => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: structuredClone(REMOTE) })
    await expect(useCatalogStore.getState().update('m2')).resolves.toBe(true)
    expect(updateCatalogModuleMock).toHaveBeenCalledWith('m2', {
      to_version: 5,
      expected_checksum: '1ab7',
    })
    expect(useCatalogStore.getState().ops.m2).toBeUndefined()
  })

  it('sin catálogo remoto se ancla en lo que dijo SQLite (el caso de /cursos)', async () => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: null })
    await useCatalogStore.getState().update('m2')
    expect(updateCatalogModuleMock).toHaveBeenCalledWith('m2', {
      to_version: 5,
      expected_checksum: '1ab7',
    })
  })

  it('`purge` solo viaja si alguien lo pide explícitamente', async () => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: structuredClone(REMOTE) })
    await useCatalogStore.getState().update('m2', { onRemovedLessons: 'purge' })
    expect(updateCatalogModuleMock).toHaveBeenCalledWith('m2', {
      to_version: 5,
      expected_checksum: '1ab7',
      on_removed_lessons: 'purge',
    })
  })

  it('módulo desconocido: cuerpo vacío, el backend decide', async () => {
    await useCatalogStore.getState().update('mX')
    expect(updateCatalogModuleMock).toHaveBeenCalledWith('mX', {})
  })

  it('éxito: invalida las dos cachés y sube la versión de la tarjeta', async () => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: structuredClone(REMOTE) })
    await useCatalogStore.getState().update('m2')
    expect(hydrateSpy).toHaveBeenCalledWith(true)
    expect(loadExamplesIndexMock).toHaveBeenCalledWith(true)
    const card = useCatalogStore.getState().remote?.modules.find((m) => m.id === 'm2')
    expect(card?.state).toBe('installed')
    expect(card?.installed_version).toBe(5)
  })

  it('un 409 no deja la tarjeta colgada en «actualizando»', async () => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: structuredClone(REMOTE) })
    updateCatalogModuleMock.mockRejectedValueOnce(
      new ApiError('VERSION_CONFLICT', 'La versión pedida no es mayor que la instalada.', 409),
    )
    await expect(useCatalogStore.getState().update('m2')).resolves.toBe(false)
    expect(useCatalogStore.getState().ops.m2).toBeUndefined()
    expect(useCatalogStore.getState().opErrors.m2.code).toBe('VERSION_CONFLICT')
  })
})

describe('remove()', () => {
  beforeEach(() => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: structuredClone(REMOTE) })
  })

  it('por defecto NO purga el progreso («tu progreso se conserva»)', async () => {
    await expect(useCatalogStore.getState().remove('m9')).resolves.toBe(true)
    expect(uninstallModuleMock).toHaveBeenCalledWith('m9', false)
  })

  it('purga solo si se pide explícitamente', async () => {
    await useCatalogStore.getState().remove('m9', true)
    expect(uninstallModuleMock).toHaveBeenCalledWith('m9', true)
  })

  it('éxito: invalida las dos cachés y la tarjeta vuelve a «disponible»', async () => {
    await useCatalogStore.getState().remove('m2')
    expect(hydrateSpy).toHaveBeenCalledWith(true)
    expect(loadExamplesIndexMock).toHaveBeenCalledWith(true)
    const card = useCatalogStore.getState().remote?.modules.find((m) => m.id === 'm2')
    expect(card?.state).toBe('available')
    expect(card?.installed_version).toBeNull()
  })

  it('un fallo no deja la tarjeta colgada en «quitando»', async () => {
    uninstallModuleMock.mockRejectedValueOnce(new ApiError('MODULE_NOT_INSTALLED', 'No está instalado.', 404))
    await expect(useCatalogStore.getState().remove('m9')).resolves.toBe(false)
    expect(useCatalogStore.getState().ops.m9).toBeUndefined()
    expect(useCatalogStore.getState().opErrors.m9.code).toBe('MODULE_NOT_INSTALLED')
  })
})

// ── invariantes del store ───────────────────────────────────────────────────

describe('el store NO persiste nada', () => {
  it('instalar y quitar no escriben una sola clave en localStorage', async () => {
    useCatalogStore.setState({ status: structuredClone(STATUS), remote: structuredClone(REMOTE) })
    const antes = localStorage.length
    await useCatalogStore.getState().install('m9')
    await useCatalogStore.getState().remove('m2')
    // El manifiesto vive en SQLite: duplicarlo aquí sería una segunda fuente de verdad.
    expect(localStorage.length).toBe(antes)
    expect(localStorage.getItem('telar-catalog')).toBeNull()
  })
})

describe('selectCatalogDiff()', () => {
  it('cruza estado y bucket: al día, actualizable, disponible y solo local', async () => {
    await useCatalogStore.getState().hydrateStatus()
    await useCatalogStore.getState().loadRemote()
    const { byState } = selectCatalogDiff(useCatalogStore.getState())
    expect(byState.update_available.map((e) => e.moduleId)).toEqual(['m2'])
    expect(byState.available.map((e) => e.moduleId)).toEqual(['m9'])
    expect(byState.local_only.map((e) => e.moduleId)).toEqual(['m1'])
    expect(byState.unpublished).toHaveLength(0)
  })

  it('sin catálogo remoto cargado NADA se marca como desaparecido del bucket', async () => {
    await useCatalogStore.getState().hydrateStatus()
    const { byState } = selectCatalogDiff(useCatalogStore.getState())
    expect(byState.unpublished).toHaveLength(0)
    expect(byState.update_available.map((e) => e.moduleId)).toEqual(['m2'])
  })
})
