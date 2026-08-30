// lib/catalogDiff.ts — cruce PURO entre el manifiesto local (§11.4.1
// `GET /catalog/status`, que lee SOLO SQLite y responde 200 siempre) y el
// índice del bucket (§11.5.1 `GET /catalog/remote`). Sin React, sin red y sin
// store: por eso se puede testear sin montar nada, y por eso vive en
// `src/lib/**` (cobertura ≥80 % obligatoria, `vitest.config.ts`).
//
// LA DISTINCIÓN QUE SOSTIENE TODO EL ARCHIVO: `remote = null` **no** significa
// «el bucket está vacío», significa «no sé qué hay en el bucket» (offline, o
// aún sin cargar). Solo con una lista REAL —aunque venga vacía— se puede
// afirmar que un módulo instalado dejó de estar publicado. Confundir las dos
// cosas haría que un corte de red marcara medio catálogo como retirado.
import type { InstalledModuleStatusDto, RemoteModuleSummaryDto } from '../api/catalog-types'

/**
 * Clasificación de un módulo tras cruzar lo instalado con lo publicado.
 *
 * - `up_to_date`       — instalado del bucket y en la última versión publicada.
 * - `update_available` — instalado del bucket y hay una versión mayor publicada.
 * - `available`        — está en el bucket y NO está instalado.
 * - `unpublished`      — instalado del bucket pero YA NO está en el bucket. El
 *   caso que se olvida: sigue funcionando en local (el contenido vive en
 *   SQLite), pero no habrá más actualizaciones y reinstalarlo es imposible.
 * - `local_only`       — módulo local (baseline sembrado o creado por el admin),
 *   ajeno al catálogo remoto: ni se actualiza ni se quita por §11.6.4.
 */
export type CatalogEntryState =
  | 'up_to_date'
  | 'update_available'
  | 'available'
  | 'unpublished'
  | 'local_only'

/** Una fila del cruce. Los DTO crudos van dentro para no perder información. */
export interface CatalogEntry {
  moduleId: string
  /** Título publicado si lo hay; si no, el instalado. */
  title: string
  state: CatalogEntryState
  /** Fila de `/catalog/status`. `null` ⇒ el módulo no está en este equipo. */
  installed: InstalledModuleStatusDto | null
  /** Entrada del índice del bucket. `null` ⇒ no está publicado (o no se sabe). */
  remote: RemoteModuleSummaryDto | null
  installedVersion: number | null
  /** Última versión conocida como publicada (del bucket, o la de SQLite). */
  availableVersion: number | null
}

export interface CatalogDiff {
  /**
   * Todas las filas, en orden determinista: primero las del bucket en el orden
   * del índice, y detrás lo instalado que el bucket no menciona (`unpublished`
   * y `local_only`). La UI reordena si quiere; aquí solo importa que sea estable.
   */
  entries: CatalogEntry[]
  /** Las mismas filas agrupadas. `byState.update_available.length` es el contador. */
  byState: Record<CatalogEntryState, CatalogEntry[]>
}

/** ¿Está en este equipo? Todo menos `available` lo está (incluido `local_only`). */
export function isInstalled(entry: CatalogEntry): boolean {
  return entry.state !== 'available'
}

/**
 * Cruza lo instalado con lo remoto y clasifica cada módulo. **Función pura**:
 * no muta las entradas y devuelve estructuras nuevas.
 *
 * @param installed filas de `/catalog/status`. `null`/`undefined` ⇒ aún sin cargar.
 * @param remote    módulos de `/catalog/remote`. **`null`/`undefined` ⇒ bucket
 *                  DESCONOCIDO** (offline o sin cargar): nada se marca como
 *                  `unpublished` y el «hay actualización» se toma del `state`
 *                  que ya calculó el backend en SQLite. Un array **vacío** sí
 *                  es una respuesta: el bucket no publica nada.
 */
export function diffCatalog(
  installed: readonly InstalledModuleStatusDto[] | null | undefined,
  remote: readonly RemoteModuleSummaryDto[] | null | undefined,
): CatalogDiff {
  const bucketKnown = remote != null
  const installedById = new Map<string, InstalledModuleStatusDto>()
  for (const row of installed ?? []) {
    if (!installedById.has(row.module_id)) installedById.set(row.module_id, row)
  }

  const entries: CatalogEntry[] = []
  const seen = new Set<string>()

  // 1) El bucket manda el orden de la tienda.
  for (const mod of remote ?? []) {
    // El índice es ENTRADA NO CONFIABLE (§11.0.6): con ids repetidos gana el
    // primero, en vez de duplicar tarjetas o pisar la clasificación.
    if (seen.has(mod.id)) continue
    seen.add(mod.id)
    entries.push(buildEntry(installedById.get(mod.id) ?? null, mod, bucketKnown))
  }

  // 2) Y detrás, lo que hay en el equipo y el bucket no menciona.
  for (const row of installed ?? []) {
    if (seen.has(row.module_id)) continue
    seen.add(row.module_id)
    entries.push(buildEntry(row, null, bucketKnown))
  }

  const byState: Record<CatalogEntryState, CatalogEntry[]> = {
    up_to_date: [],
    update_available: [],
    available: [],
    unpublished: [],
    local_only: [],
  }
  for (const entry of entries) byState[entry.state].push(entry)

  return { entries, byState }
}

/**
 * Mapa `module_id → versión disponible` para los chips «Actualización · v{n}»
 * de `/cursos`. Se calcula SOLO con `/catalog/status`, que es offline-safe:
 * esa pantalla no puede depender del bucket ni bloquearse por él (§11.0.8).
 */
export function pendingUpdates(
  installed: readonly InstalledModuleStatusDto[] | null | undefined,
): Map<string, number> {
  const updates = new Map<string, number>()
  for (const row of installed ?? []) {
    if (row.state !== 'update_available' || row.available_version == null) continue
    // Defensa contra una fila incoherente: sin versión mayor no hay chip.
    if (row.installed_version != null && row.available_version <= row.installed_version) continue
    updates.set(row.module_id, row.available_version)
  }
  return updates
}

// ── interno ─────────────────────────────────────────────────────────────────

function buildEntry(
  installed: InstalledModuleStatusDto | null,
  remote: RemoteModuleSummaryDto | null,
  bucketKnown: boolean,
): CatalogEntry {
  const moduleId = remote?.id ?? installed?.module_id ?? ''
  return {
    moduleId,
    title: remote?.title ?? installed?.title ?? moduleId,
    state: classify(installed, remote, bucketKnown),
    installed,
    remote,
    installedVersion: installed?.installed_version ?? null,
    availableVersion: remote?.version ?? installed?.available_version ?? null,
  }
}

function classify(
  installed: InstalledModuleStatusDto | null,
  remote: RemoteModuleSummaryDto | null,
  bucketKnown: boolean,
): CatalogEntryState {
  // Sin fila local solo puede venir del bucket: es un módulo por incorporar.
  if (installed === null) return 'available'
  // `origin` es la definición del contrato de «vino del bucket» (§11.4.1). Un
  // módulo local que COLISIONA en id con uno publicado sigue siendo local: se
  // reconoce porque conserva `remote != null` (instalarlo daría DUPLICATE_ID).
  if (installed.origin !== 'remote') return 'local_only'
  if (remote !== null) {
    // Con el índice delante, la versión publicada manda sobre el `state` de
    // SQLite, que puede ser de un refresh viejo.
    return remote.version > (installed.installed_version ?? 0) ? 'update_available' : 'up_to_date'
  }
  // Sin índice no se puede afirmar que lo hayan despublicado: se respeta lo que
  // el backend ya dejó escrito en SQLite.
  if (!bucketKnown) return installed.state === 'update_available' ? 'update_available' : 'up_to_date'
  return 'unpublished'
}
