// api/admin-types.ts — DTOs de ESCRITURA del modo autoría (admin), Fase 4.
// TRANSCRIPCIÓN LITERAL de docs/architecture/api-contract.md §10 (CONGELADO):
// snake_case, envelope {success,data,error,meta}. Espejo de backend/app/schemas.py §10.
// Los tipos de LECTURA (ModuleDto, LessonDetailDto, ExampleDetailDto, QuizDto…) siguen
// viviendo en types.ts y NO se duplican aquí; esto es solo la superficie admin.
import type { ContentWarningDto } from './catalog-types'
import type { ParserId, QuizOptionKey } from './types'

// El modo autoría ya NO usa login/token (2026-07-26): se gatea por build
// (VITE_ADMIN) + config del backend (TELAR_ADMIN_MODE). Los DTOs de auth
// (AdminLoginRequest/Result, AdminSessionInfo, AdminLogoutResult) se eliminaron.

// ── §10.2 Fragmentos compartidos ─────────────────────────────────────────────

export interface AdminRecommendedDto {
  lesson_id: string
  label: string
  tag: string
}

// ── §10.3 Módulos ────────────────────────────────────────────────────────────

export interface AdminModuleBaseDto {
  order: number
  title: string
  description: string
  level: string
}

export interface AdminModuleCreateDto extends AdminModuleBaseDto {
  id: string
}

/** `id` viaja por el path param; reemplazo total de campos editables. */
export type AdminModuleUpdateDto = AdminModuleBaseDto

export interface AdminLessonRefDto {
  id: string
  order: number
  title: string
  enabled: boolean
  has_quiz: boolean
  quiz_question_count: number
}

export interface AdminModuleDto extends AdminModuleBaseDto {
  id: string
  lessons: AdminLessonRefDto[]
}

export interface AdminModulesResponseDto {
  modules: AdminModuleDto[]
}

// ── §10.2 Reorden por lote (PUT /admin/modules/reorder) ──────────────────────
// Reasigna varios `order` en una sola transacción (evita el 409 del swap
// directo). Espejo de schemas.py AdminReorderItem/AdminReorderRequest.

export interface AdminReorderItemDto {
  id: string
  order: number
}

export interface AdminReorderRequestDto {
  items: AdminReorderItemDto[]
}

// ── §10.4 Ejemplos (faceta; nacen/mueren con la lección) ─────────────────────

export interface AdminExampleBaseDto {
  title: string
  filename: string
  difficulty: number
  teaches: string
  directives: string[]
  threads_configurable: boolean
  fixed_threads: number | null
  fixed_threads_note: string | null
  sweeps_threads: boolean
  self_measures: boolean
  parser_id: ParserId
  default_timeout_s: number
  est_run_seconds: number
  enabled: boolean
  requires_gpu: boolean
  expected_output_note: string
  takeaways: string[]
}

/** Metadatos del ejemplo (el `source_code` va por `/code`). */
export type AdminExampleUpdateDto = AdminExampleBaseDto

export interface AdminExampleDto extends AdminExampleBaseDto {
  id: string
  module_id: string
  order: number
  source_code: string
}

export interface AdminExampleCodeRequestDto {
  filename: string
  source_code: string
}

export interface AdminExampleCodeResultDto {
  example_id: string
  filename: string
  bytes: number
}

// ── §10.5 Lecciones (unidad = lección + ejemplo pareado + quiz) ──────────────

export type CompletionRule = 'quiz' | 'viewed' | 'run'

export interface AdminLessonBaseDto {
  module_id: string
  order: number
  title: string
  estimated_minutes: number
  content_markdown: string
  /** Fase 5: URL de YouTube no listado (el backend la normaliza). */
  video_url: string | null
  /** Fase 5 (E4): campo propio de la lección. */
  enabled: boolean
  /** Fase 5 (E4): qué cuenta como completarla. */
  completion_rule: CompletionRule
  recommended: AdminRecommendedDto[]
}

export interface AdminLessonCreateDto extends AdminLessonBaseDto {
  id: string
  example: AdminExampleBaseDto | null
  source_code: string | null
}

/** Faceta lección + markdown (el ejemplo se edita por sus endpoints). */
export type AdminLessonUpdateDto = AdminLessonBaseDto

export interface AdminLessonDetailDto extends AdminLessonBaseDto {
  id: string
  has_quiz: boolean
  quiz_question_count: number
  archived: boolean
  prev_lesson_id: string | null
  next_lesson_id: string | null
  example: AdminExampleDto | null
}

// ── §10.6 Quiz (correct_key/explanation SOLO en el GET admin) ────────────────

export interface AdminQuizOptionDto {
  key: QuizOptionKey
  text: string
}

export interface AdminQuizQuestionDto {
  id: string
  order: number
  text: string
  options: AdminQuizOptionDto[]
  /** SOLO admin — jamás viaja en el GET público del quiz. */
  correct_key: QuizOptionKey
  explanation: string
}

export interface AdminQuizUpsertDto {
  pass_threshold: number
  questions: AdminQuizQuestionDto[]
}

export interface AdminQuizDto extends AdminQuizUpsertDto {
  lesson_id: string
  question_count: number
}

export interface AdminDeleteResultDto {
  deleted: boolean
  id: string
}

// ── §11.8 Catálogo admin: credencial y publicación ──────────────────────────
// TRANSCRIPCIÓN LITERAL de api-contract.md §11.11.4. Espejo de
// backend/app/schemas/admin_catalog.py.

/** §11.8.1 — por qué una credencial no sirve. Vocabulario CERRADO. */
export type CredentialReason =
  | 'absent'
  | 'unreadable'
  | 'insecure_mode'
  | 'malformed'
  | 'forbidden'

/** §11.8.1 `GET /admin/catalog/credentials`. Responde 200 SIEMPRE. */
export interface AdminCatalogCredentialStatusDto {
  configured: boolean
  usable: boolean
  client_email: string | null
  project_id: string | null
  bucket: string | null
  /** p. ej. `"0600"`. */
  file_mode: string | null
  /** ¿se contactó el bucket? Solo con `?probe=true`. */
  probed: boolean
  /** NUNCA el texto crudo de una excepción. */
  reason: CredentialReason | null
}

/** §11.8.2 `POST /admin/modules/{id}/publish`. */
export interface AdminPublishRequestDto {
  /** Default: la publicada + 1. Debe ser estrictamente mayor. */
  version?: number
  /** `true` ⇒ NO escribe en el bucket: valida, serializa y avisa. */
  dry_run?: boolean
  notes?: string
}

export interface AdminPublishResultDto {
  /** `false` con `dry_run`. */
  published: boolean
  module_id: string
  version: number
  checksum: string
  object_path: string
  generation: number | null
  bytes: number
  published_at: string
  index_updated: boolean
  lesson_ids: string[]
  warnings: ContentWarningDto[]
}

/** §11.7 `POST /admin/catalog/import`. */
export interface AdminImportRequestDto {
  module_id: string
  /** Default: la versión vigente del índice. */
  version?: number
  /** Presente ⇒ FORK: ids propios y sin vínculo con el bucket. */
  as_module_id?: string | null
  /** Default `as_module_id + "-"`. Un `""` explícito deja los ids como están. */
  id_prefix?: string | null
}

export interface AdminImportResultDto {
  mode: 'linked' | 'forked'
  module: AdminModuleDto
  /** `null` en fork: una copia con ids propios no tiene versión base que seguir. */
  base_version: number | null
  /** `null` en vinculado. En fork, qué id pasó a ser cuál. */
  id_remap: Record<string, string> | null
}
