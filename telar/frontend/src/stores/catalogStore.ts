// stores/catalogStore.ts — TERCERA fuente de verdad del frontend, separada a
// propósito de `progressStore` («caché de la verdad del servidor local») y de
// `jobStore` («estado vivo»): el catálogo remoto tiene otra cadencia, otro modo
// de fallo (bucket caído ≠ backend caído) y un estado transitorio de descarga
// que no debe contaminar la caché de progreso.
//
// DOS REGLAS QUE GOBIERNAN ESTE ARCHIVO
//
// 1. **NADA se persiste.** No hay `persist` ni `localStorage`: el manifiesto de
//    qué está instalado y en qué versión vive en SQLite (`installed_modules`,
//    §11.0.3). Duplicarlo aquí crearía una segunda fuente de verdad que se
//    desincroniza al primer fallo a mitad de escritura.
// 2. **Todo `install`/`update`/`remove` con éxito invalida las DOS cachés de
//    contenido**: `useProgressStore.hydrate(true)` y `loadExamplesIndex(true)`.
//    La segunda es la que se olvida: es una promesa memoizada a nivel de módulo
//    ES (`api/content.ts`) que nadie más invalida, y sin ella los metas
//    `Ejemplo · ~{n}s` se quedan en `—` hasta recargar la app entera.
//
// Además, `/aprender` NO puede bloquearse por el bucket (§11.0.8): por eso los
// errores están separados —`statusError` jamás pinta un `ErrorState`, solo
// `remoteError` puede, y únicamente en `/modulos` (ver `shouldShowRemoteError`).
import { create } from 'zustand'
import {
  getCatalogStatus,
  getRemoteCatalog,
  installModule,
  refreshCatalog,
  uninstallModule,
  updateCatalogModule,
} from '../api/catalog'
import { ApiError } from '../api/client'
import { loadExamplesIndex } from '../api/content'
import { diffCatalog, type CatalogDiff } from '../lib/catalogDiff'
import { useProgressStore } from './progressStore'
import type {
  CatalogStatusResponseDto,
  InstallRequestDto,
  InstallResultDto,
  RemoteCatalogResponseDto,
  RemoteModuleSummaryDto,
  UpdateRequestDto,
} from '../api/catalog-types'

/** Operación en vuelo sobre un módulo: la tarjeta se deshabilita mientras dure. */
export type CatalogOp = 'installing' | 'updating' | 'removing'

/** Fallo con el `error.code` del contrato (§11.3) intacto, no solo el texto. */
export interface CatalogFailure {
  code: string
  message: string
}

export interface InstallOptions {
  /** Versión concreta. Por defecto se ancla la que el usuario VIO en pantalla. */
  version?: number
  /** sha256 esperado. Cierra el TOCTOU del bucket reescrito (§11.6.1). */
  expectedChecksum?: string
}

export interface UpdateOptions {
  toVersion?: number
  expectedChecksum?: string
}

export interface CatalogState {
  /** §11.4.1 — lo instalado según SQLite. Offline-safe: llega aunque no haya red. */
  status: CatalogStatusResponseDto | null
  /** §11.5.1 — lo publicado en el bucket. `null` = bucket DESCONOCIDO, no vacío. */
  remote: RemoteCatalogResponseDto | null
  /** Espejo de `remote.stale`: lo servido salió de la caché del backend (TTL vencido). */
  stale: boolean
  loadingStatus: boolean
  loadingRemote: boolean
  /** `POST /catalog/refresh` en vuelo (efecto NO bloqueante de `/aprender`). */
  refreshing: boolean
  /**
   * Fallo de `/status` o `/refresh`. **Diagnóstico, nunca un `ErrorState`**: si
   * el refresh falla solo significa «no hay chips de actualización» (§11.4.2).
   */
  statusError: CatalogFailure | null
  /** Fallo del catálogo remoto. Lo ÚNICO que puede pintar `ErrorState`, con `onRetry`. */
  remoteError: CatalogFailure | null
  /** Operación en curso por módulo (la tarjeta se deshabilita mientras exista). */
  ops: Record<string, CatalogOp>
  /** Último fallo de `install`/`update`/`remove`, por módulo. */
  opErrors: Record<string, CatalogFailure>

  /** `GET /catalog/status`. Dedupe de llamadas concurrentes; `force` re-consulta. */
  hydrateStatus: (force?: boolean) => Promise<void>
  /** `POST /catalog/refresh`. No bloqueante: un fallo NO rompe la pantalla. */
  refreshStatus: () => Promise<void>
  /** `GET /catalog/remote`. `force` ⇒ `?refresh=true` (salta el TTL del backend). */
  loadRemote: (force?: boolean) => Promise<void>
  /** §11.6.1. `true` si se instaló. Invalida las dos cachés de contenido. */
  install: (moduleId: string, opts?: InstallOptions) => Promise<boolean>
  /** §11.6.3. `true` si se actualizó. El progreso se conserva (default `archive`). */
  update: (moduleId: string, opts?: UpdateOptions) => Promise<boolean>
  /** §11.6.4. `true` si se quitó. El avance SIEMPRE sobrevive. */
  remove: (moduleId: string) => Promise<boolean>
  /** Descarta el error de un módulo (al cerrar el banner de la tarjeta). */
  clearOpError: (moduleId: string) => void
}

type SetState = (partial: Partial<CatalogState>) => void
type GetState = () => CatalogState

// Dedupe de llamadas concurrentes, mismo patrón que `progressStore.hydrate`.
let statusInflight: Promise<void> | null = null
let remoteInflight: Promise<void> | null = null

export const useCatalogStore = create<CatalogState>()((set, get) => ({
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

  hydrateStatus: (force = false) => {
    if (statusInflight && !force) return statusInflight
    if (!force && get().status !== null) return Promise.resolve()
    set({ loadingStatus: true, statusError: null })
    statusInflight = getCatalogStatus()
      .then((status) => {
        set({ status, loadingStatus: false, statusError: null })
      })
      .catch((err: unknown) => {
        // `/status` responde 200 siempre: si falla, el backend entero está
        // caído y de eso ya informa `progressStore`. Aquí solo se anota.
        set({ loadingStatus: false, statusError: toFailure(err) })
      })
      .finally(() => {
        statusInflight = null
      })
    return statusInflight
  },

  refreshStatus: async () => {
    set({ refreshing: true })
    try {
      set({ status: await refreshCatalog(), statusError: null })
    } catch (err: unknown) {
      // §11.4.2: bucket caído ⇒ sin chips de actualización y punto. No se toca
      // `remoteError` ni se borra el `status` ya cargado.
      set({ statusError: toFailure(err) })
    } finally {
      set({ refreshing: false })
    }
  },

  loadRemote: (force = false) => {
    if (remoteInflight && !force) return remoteInflight
    if (!force && get().remote !== null) return Promise.resolve()
    set({ loadingRemote: true, remoteError: null })
    remoteInflight = getRemoteCatalog(force)
      .then((remote) => {
        set({ remote, stale: remote.stale, loadingRemote: false, remoteError: null })
      })
      .catch((err: unknown) => {
        // La lista previa NO se borra: con caché en mano se sigue enseñando el
        // catálogo y el error queda para una tira de aviso (§11.5.1).
        set({ loadingRemote: false, remoteError: toFailure(err) })
      })
      .finally(() => {
        remoteInflight = null
      })
    return remoteInflight
  },

  install: (moduleId, opts = {}) => {
    const anchor = resolveAnchor(anchorOf(get(), moduleId), opts.version, opts.expectedChecksum)
    const body: InstallRequestDto = {
      module_id: moduleId,
      ...(anchor.version != null ? { version: anchor.version } : {}),
      ...(anchor.checksum != null ? { expected_checksum: anchor.checksum } : {}),
    }
    return runModuleOp(set, get, moduleId, 'installing', () => installModule(body), (result) => {
      set({ remote: patchRemote(get().remote, moduleId, (mod) => withInstall(mod, result)) })
    })
  },

  update: (moduleId, opts = {}) => {
    const anchor = resolveAnchor(anchorOf(get(), moduleId), opts.toVersion, opts.expectedChecksum)
    const body: UpdateRequestDto = {
      ...(anchor.version != null ? { to_version: anchor.version } : {}),
      ...(anchor.checksum != null ? { expected_checksum: anchor.checksum } : {}),
      // `on_removed_lessons` no se manda: la ruta del estudiante solo admite
      // `archive`, que es lo que sostiene la copy «Tu progreso se conserva».
      // La opción existía y se quitó — ver §11.6.3.
    }
    return runModuleOp(
      set,
      get,
      moduleId,
      'updating',
      () => updateCatalogModule(moduleId, body),
      (result) => {
        set({ remote: patchRemote(get().remote, moduleId, (mod) => withInstall(mod, result)) })
      },
    )
  },

  remove: (moduleId) =>
    runModuleOp(
      set,
      get,
      moduleId,
      'removing',
      () => uninstallModule(moduleId),
      () => {
        set({
          remote: patchRemote(get().remote, moduleId, (mod) => ({
            ...mod,
            state: 'available',
            installed_version: null,
            installed_checksum: null,
          })),
        })
      },
    ),

  clearOpError: (moduleId) => {
    set({ opErrors: withFailure(get().opErrors, moduleId, null) })
  },
}))

// ── selectores derivados ────────────────────────────────────────────────────

/**
 * Cruce instalado ↔ remoto. **No usar como selector de zustand**
 * (`useCatalogStore(selectCatalogDiff)`): devuelve un objeto nuevo en cada
 * llamada y v5 entraría en bucle. Se envuelve en `useMemo` sobre
 * `[status, remote]`, que sí son referencias estables.
 */
export function selectCatalogDiff(state: Pick<CatalogState, 'status' | 'remote'>): CatalogDiff {
  // `?? null` deliberado: sin respuesta, el bucket es DESCONOCIDO, no vacío.
  return diffCatalog(state.status?.modules ?? null, state.remote?.modules ?? null)
}

/**
 * `ErrorState` solo cuando no queda NADA que enseñar. Con una lista previa en
 * memoria se sigue pintando el catálogo, aunque el último refresh fallara.
 */
export function shouldShowRemoteError(
  state: Pick<CatalogState, 'remote' | 'remoteError'>,
): boolean {
  return state.remoteError !== null && state.remote === null
}

// ── interno ─────────────────────────────────────────────────────────────────

/**
 * Esqueleto común de `install`/`update`/`remove`: marca la operación, la limpia
 * SIEMPRE (el `finally` es lo que impide que un fallo de red deje la tarjeta
 * colgada en «instalando…») e invalida las dos cachés tras el éxito.
 */
async function runModuleOp<T>(
  set: SetState,
  get: GetState,
  moduleId: string,
  op: CatalogOp,
  call: () => Promise<T>,
  onSuccess: (result: T) => void,
): Promise<boolean> {
  // Doble clic o dos tarjetas del mismo módulo: una operación a la vez.
  if (get().ops[moduleId]) return false
  set({
    ops: withOp(get().ops, moduleId, op),
    opErrors: withFailure(get().opErrors, moduleId, null),
  })
  try {
    onSuccess(await call())
    await invalidateContentCaches()
    // El manifiesto cambió: `/status` es la única verdad de qué hay instalado.
    await get().hydrateStatus(true)
    return true
  } catch (err: unknown) {
    set({ opErrors: withFailure(get().opErrors, moduleId, toFailure(err)) })
    return false
  } finally {
    set({ ops: withOp(get().ops, moduleId, null) })
  }
}

/**
 * Las DOS cachés de contenido, juntas y siempre (regla 2 de la cabecera).
 * `hydrate` no rechaza nunca (captura dentro); `loadExamplesIndex` SÍ, y un
 * índice de ejemplos caído no puede convertir una instalación exitosa en un
 * fallo: como mucho deja los metas en `—`.
 */
async function invalidateContentCaches(): Promise<void> {
  await Promise.all([
    useProgressStore.getState().hydrate(true),
    loadExamplesIndex(true).catch(() => undefined),
  ])
}

interface VersionAnchor {
  version: number | null
  checksum: string | null
}

/** Ancla lo que el usuario VIO: el bucket si se conoce, si no lo de SQLite. */
function anchorOf(state: CatalogState, moduleId: string): VersionAnchor {
  const published = state.remote?.modules.find((mod) => mod.id === moduleId)
  if (published) return { version: published.version, checksum: published.checksum }
  const row = state.status?.modules.find((mod) => mod.module_id === moduleId)
  if (row?.available_version != null) {
    return { version: row.available_version, checksum: row.available_checksum }
  }
  return { version: null, checksum: null }
}

/**
 * Un override de versión INVALIDA el checksum heredado: sería el sha256 de otra
 * versión y el backend respondería `409 CHECKSUM_MISMATCH` sobre un bundle
 * perfectamente sano. Versión y checksum viajan siempre en pareja.
 */
function resolveAnchor(
  anchor: VersionAnchor,
  version?: number,
  checksum?: string,
): VersionAnchor {
  const finalVersion = version ?? anchor.version
  const inherited = finalVersion === anchor.version ? anchor.checksum : null
  return { version: finalVersion, checksum: checksum ?? inherited }
}

/** Copia inmutable del listado remoto con UNA entrada transformada. */
function patchRemote(
  remote: RemoteCatalogResponseDto | null,
  moduleId: string,
  fn: (mod: RemoteModuleSummaryDto) => RemoteModuleSummaryDto,
): RemoteCatalogResponseDto | null {
  if (!remote) return remote
  let touched = false
  const modules = remote.modules.map((mod) => {
    if (mod.id !== moduleId) return mod
    touched = true
    return fn(mod)
  })
  return touched ? { ...remote, modules } : remote
}

/**
 * Refleja en la tarjeta lo que acaba de instalarse/actualizarse sin volver al
 * bucket. Si se instaló una versión anterior a la publicada, la tarjeta queda
 * en `update_available`, que es la verdad.
 */
function withInstall(mod: RemoteModuleSummaryDto, result: InstallResultDto): RemoteModuleSummaryDto {
  return {
    ...mod,
    state: mod.version > result.installed_version ? 'update_available' : 'installed',
    installed_version: result.installed_version,
    installed_checksum: result.installed_checksum,
  }
}

function withOp(
  ops: Record<string, CatalogOp>,
  moduleId: string,
  op: CatalogOp | null,
): Record<string, CatalogOp> {
  const next = { ...ops }
  if (op === null) delete next[moduleId]
  else next[moduleId] = op
  return next
}

function withFailure(
  errors: Record<string, CatalogFailure>,
  moduleId: string,
  failure: CatalogFailure | null,
): Record<string, CatalogFailure> {
  if (failure === null && !(moduleId in errors)) return errors
  const next = { ...errors }
  if (failure === null) delete next[moduleId]
  else next[moduleId] = failure
  return next
}

/** Conserva el `error.code` del contrato: la UI necesita distinguir 503 de 409. */
function toFailure(err: unknown): CatalogFailure {
  if (err instanceof ApiError) return { code: err.code, message: err.message }
  return { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
}
