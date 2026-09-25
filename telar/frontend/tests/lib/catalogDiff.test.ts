// tests/lib/catalogDiff.test.ts — cruce PURO instalado ↔ bucket (§11.4.1 vs
// §11.5.1): al día / con actualización / disponible / **desaparecido del
// bucket** / solo local, más la distinción entre «bucket vacío» y «bucket
// desconocido», que es la que evita marcar medio catálogo como retirado cuando
// lo único que pasa es que no hay red.
import { describe, expect, it } from 'vitest'
import { diffCatalog, isInstalled, isLocalConflict, pendingUpdates } from '@/lib/catalogDiff'
import type { InstalledModuleStatusDto, RemoteModuleSummaryDto } from '@/api/catalog-types'

function instalado(over: Partial<InstalledModuleStatusDto> = {}): InstalledModuleStatusDto {
  return {
    module_id: 'm2',
    title: 'Patrón SPMD y false sharing',
    origin: 'remote',
    state: 'installed',
    installed_version: 3,
    installed_checksum: '9f2c',
    available_version: 3,
    available_checksum: '9f2c',
    object_path: 'modulos/m2/v3.json',
    installed_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-20T18:40:00.000Z',
    last_checked_at: '2026-08-29T10:12:00.000Z',
    lessons_total: 3,
    lessons_completed: 2,
    ...over,
  }
}

function publicado(over: Partial<RemoteModuleSummaryDto> = {}): RemoteModuleSummaryDto {
  return {
    id: 'm2',
    title: 'Patrón SPMD y false sharing',
    description: 'Reparto manual del trabajo entre hilos.',
    level: 'Intermedio',
    order_hint: 2,
    version: 3,
    checksum: '9f2c',
    object_path: 'modulos/m2/v3.json',
    generation: 1712345678901234,
    size_bytes: 40960,
    published_at: '2026-08-20T18:40:00.000Z',
    author_label: 'Cátedra de HPC',
    lessons_count: 3,
    questions_count: 12,
    estimated_minutes_total: 45,
    requires_gpu: false,
    state: 'installed',
    installed_version: 3,
    installed_checksum: '9f2c',
    ...over,
  }
}

describe('diffCatalog — clasificación', () => {
  it('al día: instalado del bucket en la última versión publicada', () => {
    const { byState } = diffCatalog([instalado()], [publicado()])
    expect(byState.up_to_date.map((e) => e.moduleId)).toEqual(['m2'])
    expect(byState.up_to_date[0].installedVersion).toBe(3)
    expect(byState.up_to_date[0].availableVersion).toBe(3)
  })

  it('con actualización: el bucket publica una versión mayor', () => {
    const { byState } = diffCatalog([instalado()], [publicado({ version: 5, checksum: '1ab7' })])
    expect(byState.update_available.map((e) => e.moduleId)).toEqual(['m2'])
    expect(byState.update_available[0].availableVersion).toBe(5)
    expect(byState.update_available[0].installedVersion).toBe(3)
  })

  it('el índice fresco manda sobre el `state` de SQLite (refresh viejo)', () => {
    // SQLite aún cree que hay actualización; el bucket ya publica la misma v3.
    const row = instalado({ state: 'update_available', available_version: 5 })
    const { byState } = diffCatalog([row], [publicado({ version: 3 })])
    expect(byState.update_available).toHaveLength(0)
    expect(byState.up_to_date.map((e) => e.moduleId)).toEqual(['m2'])
  })

  it('disponible: está en el bucket y no en el equipo', () => {
    const { byState } = diffCatalog([], [publicado({ id: 'm9', state: 'available', installed_version: null })])
    expect(byState.available.map((e) => e.moduleId)).toEqual(['m9'])
    expect(byState.available[0].installed).toBeNull()
    expect(byState.available[0].installedVersion).toBeNull()
  })

  it('DESAPARECIDO DEL BUCKET: instalado del catálogo y el índice ya no lo trae', () => {
    const { byState, entries } = diffCatalog([instalado({ module_id: 'm7', title: 'Tareas' })], [])
    expect(byState.unpublished.map((e) => e.moduleId)).toEqual(['m7'])
    // Sigue instalado y usable: el contenido vive en SQLite, no en el bucket.
    expect(entries[0].installed?.lessons_completed).toBe(2)
    expect(entries[0].remote).toBeNull()
    expect(isInstalled(entries[0])).toBe(true)
  })

  it('solo local: baseline o módulo del admin, ajeno al bucket', () => {
    const local = instalado({
      module_id: 'm1',
      origin: 'local',
      state: 'local_only',
      installed_version: null,
      available_version: null,
    })
    const { byState } = diffCatalog([local], [publicado({ id: 'm9', state: 'available' })])
    expect(byState.local_only.map((e) => e.moduleId)).toEqual(['m1'])
    expect(byState.unpublished).toHaveLength(0)
  })

  it('colisión de id: un módulo local que también está publicado sigue siendo local', () => {
    // Instalarlo daría 409 DUPLICATE_ID; la fila conserva el `remote` para que
    // la pantalla pueda explicarlo en vez de ofrecer un botón condenado.
    const local = instalado({ module_id: 'm1', origin: 'local', state: 'local_only' })
    const { entries, byState } = diffCatalog([local], [publicado({ id: 'm1' })])
    expect(byState.local_only).toHaveLength(1)
    expect(byState.available).toHaveLength(0)
    expect(entries[0].remote?.id).toBe('m1')
  })
})

describe('diffCatalog — bucket vacío ≠ bucket desconocido', () => {
  const row = instalado({ state: 'update_available', available_version: 5 })

  it('remote = null (offline o sin cargar): NADA se marca como desaparecido', () => {
    const { byState } = diffCatalog([row], null)
    expect(byState.unpublished).toHaveLength(0)
    // Y el «hay actualización» sale del `state` que ya calculó el backend.
    expect(byState.update_available.map((e) => e.moduleId)).toEqual(['m2'])
    expect(byState.update_available[0].availableVersion).toBe(5)
  })

  it('remote = undefined se trata igual que null', () => {
    expect(diffCatalog([row], undefined).byState.unpublished).toHaveLength(0)
  })

  it('remote = [] (respuesta real del bucket) SÍ lo marca como desaparecido', () => {
    const { byState } = diffCatalog([row], [])
    expect(byState.unpublished.map((e) => e.moduleId)).toEqual(['m2'])
    expect(byState.update_available).toHaveLength(0)
  })

  it('sin índice, un módulo instalado y al día queda al día', () => {
    expect(diffCatalog([instalado()], null).byState.up_to_date).toHaveLength(1)
  })
})

describe('diffCatalog — orden, duplicados y robustez', () => {
  it('ordena por el índice del bucket y deja lo no publicado al final', () => {
    const installed = [instalado({ module_id: 'm7', title: 'Tareas' }), instalado()]
    const remote = [publicado({ id: 'm9', state: 'available' }), publicado()]
    const { entries } = diffCatalog(installed, remote)
    expect(entries.map((e) => e.moduleId)).toEqual(['m9', 'm2', 'm7'])
  })

  it('ids duplicados en el índice (entrada no confiable): gana el primero', () => {
    const remote = [publicado({ id: 'm9', version: 1 }), publicado({ id: 'm9', version: 2 })]
    const { entries } = diffCatalog([], remote)
    expect(entries).toHaveLength(1)
    expect(entries[0].availableVersion).toBe(1)
  })

  it('prefiere el título publicado y cae al instalado si no hay bucket', () => {
    const publicadoRenombrado = publicado({ title: 'SPMD (edición 2026)' })
    expect(diffCatalog([instalado()], [publicadoRenombrado]).entries[0].title).toBe('SPMD (edición 2026)')
    expect(diffCatalog([instalado()], null).entries[0].title).toBe('Patrón SPMD y false sharing')
  })

  it('no muta las entradas y devuelve estructuras nuevas', () => {
    const installed = [instalado()]
    const remote = [publicado({ version: 5 })]
    const copiaInstalled = structuredClone(installed)
    const copiaRemote = structuredClone(remote)
    const diff = diffCatalog(installed, remote)
    expect(installed).toEqual(copiaInstalled)
    expect(remote).toEqual(copiaRemote)
    expect(diff.entries).not.toBe(installed)
    expect(diff.entries[0].installed).toBe(installed[0]) // referencia, sin copia
  })

  it('module_id repetido en /status (defensa): una sola fila, gana el primero', () => {
    const filas = [instalado({ lessons_completed: 2 }), instalado({ lessons_completed: 0 })]
    const { entries } = diffCatalog(filas, null)
    expect(entries).toHaveLength(1)
    expect(entries[0].installed?.lessons_completed).toBe(2)
  })

  it('fila remota sin `installed_version` (manifiesto a medias): cualquier versión publicada actualiza', () => {
    const roto = instalado({ installed_version: null })
    expect(diffCatalog([roto], [publicado({ version: 1 })]).byState.update_available).toHaveLength(1)
  })

  it('entradas vacías → diff vacío con los cinco grupos presentes', () => {
    const { entries, byState } = diffCatalog(null, null)
    expect(entries).toEqual([])
    expect(Object.keys(byState).sort()).toEqual([
      'available',
      'local_only',
      'unpublished',
      'up_to_date',
      'update_available',
    ])
  })

  it('cada entrada aparece exactamente una vez en byState', () => {
    const installed = [instalado(), instalado({ module_id: 'm1', origin: 'local', state: 'local_only' })]
    const remote = [publicado({ version: 5 }), publicado({ id: 'm9', state: 'available' })]
    const { entries, byState } = diffCatalog(installed, remote)
    const agrupadas = Object.values(byState).flat()
    expect(agrupadas).toHaveLength(entries.length)
    expect(new Set(agrupadas.map((e) => e.moduleId)).size).toBe(entries.length)
  })
})

describe('isLocalConflict — CU-34.3', () => {
  it('solo es conflicto un local que el bucket TAMBIÉN publica', () => {
    const local = instalado({ module_id: 'm1', origin: 'local', state: 'local_only' })
    const otroLocal = instalado({ module_id: 'm8', origin: 'local', state: 'local_only' })
    const { entries } = diffCatalog([local, otroLocal], [publicado({ id: 'm1' }), publicado({ id: 'm9' })])
    const porId = new Map(entries.map((e) => [e.moduleId, e]))
    expect(isLocalConflict(porId.get('m1')!)).toBe(true)
    // Local puro: no está en el catálogo, no hay nada que enseñar.
    expect(isLocalConflict(porId.get('m8')!)).toBe(false)
    // Publicado y ausente aquí: disponible, no conflicto.
    expect(isLocalConflict(porId.get('m9')!)).toBe(false)
  })
})

describe('isInstalled', () => {
  it('todo menos `available` está en el equipo', () => {
    const { byState } = diffCatalog(
      [instalado(), instalado({ module_id: 'm1', origin: 'local', state: 'local_only' })],
      [publicado(), publicado({ id: 'm9', state: 'available' })],
    )
    expect(byState.up_to_date.every(isInstalled)).toBe(true)
    expect(byState.local_only.every(isInstalled)).toBe(true)
    expect(byState.available.some(isInstalled)).toBe(false)
  })
})

describe('pendingUpdates — chips de /aprender (solo SQLite, offline-safe)', () => {
  it('mapea module_id → versión disponible de los actualizables', () => {
    const filas = [
      instalado({ state: 'update_available', available_version: 5 }),
      instalado({ module_id: 'm7', state: 'installed' }),
      instalado({ module_id: 'm1', origin: 'local', state: 'local_only', available_version: null }),
    ]
    expect(Object.fromEntries(pendingUpdates(filas))).toEqual({ m2: 5 })
  })

  it('ignora filas incoherentes: sin `available_version` o sin versión mayor', () => {
    const filas = [
      instalado({ module_id: 'a', state: 'update_available', available_version: null }),
      instalado({ module_id: 'b', state: 'update_available', installed_version: 5, available_version: 5 }),
    ]
    expect(pendingUpdates(filas).size).toBe(0)
  })

  it('sin datos devuelve un mapa vacío', () => {
    expect(pendingUpdates(null).size).toBe(0)
    expect(pendingUpdates(undefined).size).toBe(0)
  })
})
