// api/catalog-types.ts — DTOs de §11 Catálogo remoto (Fase 5).
// TRANSCRIPCIÓN LITERAL de docs/architecture/api-contract.md §11.11.3 (snake_case).
// Espejo de backend/app/schemas/catalog.py. Los tipos de LECTURA de contenido
// (ModuleDto, LessonDetailDto…) siguen en types.ts y NO se duplican aquí.
//
// CONGELADO: no añadir, quitar ni renombrar campos sin actualizar el contrato
// primero. El código se adapta al contrato, nunca al revés.

/**
 * Fase 5 (E4) — qué cuenta como completar una lección.
 * El contrato lo declara en LOS DOS espejos (§4.1 en `types.ts`, §11.11.3
 * aquí): son la misma unión literal, así que son mutuamente asignables.
 */
export type CompletionRule = 'quiz' | 'viewed' | 'run'
export type ModuleOrigin = 'local' | 'remote'
export type RemoteState = 'available' | 'installed' | 'update_available'
export type InstalledState = 'local_only' | 'installed' | 'update_available'
export type CatalogSource = 'network' | 'cache'
/**
 * §11.6.2 — `archived` y `rescored`, NO «huérfano» ni «reset»: una lección
 * retirada conserva su fila y su avance, y una nota se RECALCULA sin que un
 * aprobado ya ganado se revoque jamás. Es la promesa que sostiene CU-39.
 */
export type ProgressEffect = 'preserved' | 'rescored' | 'archived' | 'none'
export type LessonChange = 'added' | 'updated' | 'unchanged' | 'removed'

export interface ContentWarningDto {
  code: string
  message: string
  lesson_id: string | null
}

/** §11.5.1 GET /api/v1/catalog/remote */
export interface RemoteModuleSummaryDto {
  id: string
  title: string
  description: string
  level: string
  order_hint: number
  version: number
  checksum: string
  object_path: string
  generation: number | null
  size_bytes: number
  published_at: string
  author_label: string
  lessons_count: number
  questions_count: number
  estimated_minutes_total: number
  requires_gpu: boolean
  state: RemoteState
  installed_version: number | null
  installed_checksum: string | null
}

export interface RemoteCatalogResponseDto {
  bucket: string | null
  source: CatalogSource
  fetched_at: string | null
  stale: boolean
  unavailable_reason: string | null
  modules: RemoteModuleSummaryDto[]
}

/** §11.5.2 GET /api/v1/catalog/remote/{module_id} */
export interface RemoteLessonPreviewDto {
  lesson_id: string
  order: number
  title: string
  estimated_minutes: number
  has_example: boolean
  has_quiz: boolean
  quiz_question_count: number
  requires_gpu: boolean
  completion_rule: CompletionRule
  status: 'new' | 'present' | 'changed'
}

export interface RemoteModuleDetailDto extends RemoteModuleSummaryDto {
  lessons: RemoteLessonPreviewDto[]
  content_warnings: ContentWarningDto[]
}

/** §11.4 Estado del catálogo — OFFLINE-SAFE, solo SQLite. */
export interface InstalledModuleStatusDto {
  module_id: string
  title: string
  origin: ModuleOrigin
  state: InstalledState
  installed_version: number | null
  installed_checksum: string | null
  available_version: number | null
  available_checksum: string | null
  object_path: string | null
  installed_at: string | null
  updated_at: string | null
  last_checked_at: string | null
  lessons_total: number
  lessons_completed: number
}

export interface CatalogStatusSummaryDto {
  modules_total: number
  installed: number
  updatable: number
  local_only: number
  never_checked: number
}

export interface CatalogStatusResponseDto {
  catalog_enabled: boolean
  bucket: string | null
  last_checked_at: string | null
  modules: InstalledModuleStatusDto[]
  summary: CatalogStatusSummaryDto
}

/** §11.6 Instalar / actualizar / desinstalar. */
export interface InstallRequestDto {
  module_id: string
  version?: number | null
  expected_checksum?: string | null
}

export interface UpdateRequestDto {
  to_version?: number | null
  expected_checksum?: string | null
  /** Solo `archive`: esta ruta CONSERVA el avance siempre (§11.6.3). */
  on_removed_lessons?: 'archive'
}

export interface LessonDiffEntryDto {
  lesson_id: string
  /**
   * Título legible de la lección. La vista previa existe para que el estudiante
   * ENTIENDA qué cambia antes de aceptar, y un id como `f1Concurrencia` no le
   * comunica nada. `null` solo si el servidor no pudo resolverlo.
   */
  title: string | null
  change: LessonChange
  progress: ProgressEffect
  reason: string | null
}

export interface ProgressEffectSummaryDto {
  preserved: number
  rescored: number
  archived: number
  unaffected: number
}

export interface ModuleUpdatePreviewDto {
  module_id: string
  from_version: number
  to_version: number
  to_checksum: string
  lessons: LessonDiffEntryDto[]
  progress_summary: ProgressEffectSummaryDto
  warnings: ContentWarningDto[]
}

export interface InstallResultDto {
  module_id: string
  installed_version: number
  installed_checksum: string
  object_path: string
  local_order: number
  order_reassigned: boolean
  lessons_added: string[]
  lessons_updated: string[]
  lessons_removed: string[]
  questions_total: number
  progress: ProgressEffectSummaryDto
  installed_at: string
}

export interface UninstallResultDto {
  removed: boolean
  module_id: string
  lessons_removed: number
  /** Invariante de §11.6.4: siempre `false`. */
  progress_purged: boolean
  progress_archived: number
}

/** Un módulo que la sincronización no pudo incorporar (se reintenta luego). */
export interface CourseSyncFailureDto {
  module_id: string
  code: string
  message: string
}

/**
 * POST /api/v1/catalog/sync — descarga del curso completo. La app no trae
 * contenido propio: se pide al arrancar y trae lo que falte del catálogo.
 * `skipped: 'admin'` ⇒ instalación de autoría, que no se llena sola.
 */
export interface CourseSyncResultDto {
  installed: string[]
  /** Módulos base de versiones ≤ 1.0.9 cambiados por su versión de la nube. */
  replaced: string[]
  failed: CourseSyncFailureDto[]
  skipped: 'admin' | null
}
