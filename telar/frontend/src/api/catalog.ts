// api/catalog.ts — capa de datos del catálogo remoto de módulos (api-contract
// §11.4-§11.6): estado offline-safe, exploración del bucket, instalar,
// previsualizar la actualización, actualizar y quitar.
// Todos los endpoints usan el envelope (client.ts lo desenvuelve).
//
// El frontend NUNCA habla con GCS (§11.0.4): solo con estos ocho endpoints
// locales, que son los que validan el contenido no confiable del bucket.
import { fetchJson } from './client'
import type {
  CatalogStatusResponseDto,
  CourseSyncResultDto,
  InstallRequestDto,
  InstallResultDto,
  ModuleUpdatePreviewDto,
  RemoteCatalogResponseDto,
  RemoteModuleDetailDto,
  UninstallResultDto,
  UpdateRequestDto,
} from './catalog-types'

const P = '/api/v1/catalog'
const enc = encodeURIComponent

/** Añade `?a=b` solo si hay algo que añadir (evita `?` colgando). */
function withQuery(path: string, query: URLSearchParams): string {
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

// ── §11.4 Estado del catálogo (offline-safe) ────────────────────────────────

/**
 * §11.4.1 GET /api/v1/catalog/status — qué está instalado y qué tiene
 * actualización. **Lee SOLO SQLite y responde 200 SIEMPRE**: sin bucket
 * configurado devuelve `catalog_enabled=false`, no un error. Es la llamada
 * bloqueante que pinta `/aprender`.
 */
export function getCatalogStatus(): Promise<CatalogStatusResponseDto> {
  return fetchJson<CatalogStatusResponseDto>(`${P}/status`)
}

/**
 * §11.4.2 POST /api/v1/catalog/refresh — única vía que sale a la red desde
 * `/aprender`. Devuelve el MISMO shape que `/status`.
 *
 * Contrato de UI: se llama como efecto NO bloqueante después de
 * `getCatalogStatus()`. Si falla (503 `CATALOG_DISABLED`/`CATALOG_UNAVAILABLE`)
 * simplemente no hay chips de actualización: **no se pinta ningún ErrorState**.
 * Sin cuerpo, por contrato.
 */
export function refreshCatalog(): Promise<CatalogStatusResponseDto> {
  return fetchJson<CatalogStatusResponseDto>(`${P}/refresh`, { method: 'POST' })
}

// ── §11.5 CU-35 Explorar el catálogo remoto ─────────────────────────────────

/**
 * §11.5.1 GET /api/v1/catalog/remote — listado del bucket, ya cruzado con lo
 * instalado (`state`). Con `refresh=false` (default) sirve la caché de SQLite
 * si no ha vencido el TTL; `stale=true` avisa de que lo servido es caché.
 *
 * Es la ÚNICA pantalla que puede mostrar `ErrorState` por falta de red
 * (503 `CATALOG_UNAVAILABLE` **sin caché previa**), y siempre con `onRetry`.
 */
export function getRemoteCatalog(refresh = false): Promise<RemoteCatalogResponseDto> {
  const query = new URLSearchParams()
  if (refresh) query.set('refresh', 'true')
  return fetchJson<RemoteCatalogResponseDto>(withQuery(`${P}/remote`, query))
}

/**
 * §11.5.2 GET /api/v1/catalog/remote/{module_id} — detalle ANTES de instalar:
 * el servidor descarga y valida el bundle sin escribir nada en SQLite.
 * `version` opcional (default: la última del índice).
 */
export function getRemoteModule(
  moduleId: string,
  version?: number,
): Promise<RemoteModuleDetailDto> {
  const query = new URLSearchParams()
  if (version != null) query.set('version', String(version))
  return fetchJson<RemoteModuleDetailDto>(withQuery(`${P}/remote/${enc(moduleId)}`, query))
}

// ── §11.6 CU-36 / CU-39 Incorporar, actualizar y quitar ─────────────────────

/**
 * §11.6.1 POST /api/v1/catalog/install — incorporar un módulo (201).
 * `expected_checksum` es opcional pero cierra el TOCTOU: ancla lo que el
 * usuario VIO en pantalla, así que un bucket reescrito entre el listado y el
 * clic da `409 CHECKSUM_MISMATCH` en vez de instalar otra cosa.
 */
export function installModule(body: InstallRequestDto): Promise<InstallResultDto> {
  return fetchJson<InstallResultDto>(`${P}/install`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * POST /api/v1/catalog/sync — trae del catálogo los módulos que este equipo
 * aún no tiene. Idempotente: lo ya incorporado, o quitado a propósito, no se
 * repite. La app no trae contenido propio, así que se pide al arrancar.
 */
export function syncCourse(): Promise<CourseSyncResultDto> {
  return fetchJson<CourseSyncResultDto>(`${P}/sync`, { method: 'POST' })
}

/**
 * §11.6.2 GET /api/v1/catalog/modules/{module_id}/update/preview — «qué
 * conservo, qué pierdo» ANTES de escribir nada. Este endpoint sostiene la
 * promesa de producto: el diff va anclado en `lesson_id` y `progress_summary`
 * dice cuánto avance se preserva. `to_version` opcional.
 */
export function getUpdatePreview(
  moduleId: string,
  toVersion?: number,
): Promise<ModuleUpdatePreviewDto> {
  const query = new URLSearchParams()
  if (toVersion != null) query.set('to_version', String(toVersion))
  return fetchJson<ModuleUpdatePreviewDto>(
    withQuery(`${P}/modules/${enc(moduleId)}/update/preview`, query),
  )
}

/**
 * §11.6.3 POST /api/v1/catalog/modules/{module_id}/update — actualizar
 * conservando el progreso (200, mismo shape que instalar). `to_version` debe
 * ser `>` que `installed_version` (versión monótona) o el backend responde
 * `409 VERSION_CONFLICT`. `on_removed_lessons` solo admite `archive`: el avance
 * de las lecciones retiradas se CONSERVA siempre.
 */
export function updateCatalogModule(
  moduleId: string,
  body: UpdateRequestDto = {},
): Promise<InstallResultDto> {
  return fetchJson<InstallResultDto>(`${P}/modules/${enc(moduleId)}/update`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * §11.6.4 DELETE /api/v1/catalog/modules/{module_id} — quitar un módulo
 * incorporado. **100 % local: funciona sin red.**
 *
 * **El avance SIEMPRE sobrevive.** El contenido se borra pero las filas de
 * progreso quedan huérfanas y reinstalar las recupera, porque los `lesson_id`
 * son estables: es exactamente lo que la UI promete al pulsar el botón
 * («Quitar módulo — tu progreso se conserva»).
 *
 * La función tomaba un `purgeProgress` que mandaba `?purge_progress=true`. Se
 * quitó junto con el parámetro del backend: era una vía para que un cliente
 * del estudiante destruyera lo único que no se puede volver a bajar del bucket.
 */
export function uninstallModule(moduleId: string): Promise<UninstallResultDto> {
  return fetchJson<UninstallResultDto>(`${P}/modules/${enc(moduleId)}`, {
    method: 'DELETE',
  })
}
