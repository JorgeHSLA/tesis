// api/admin-types.ts — DTOs de ESCRITURA del modo autoría (admin), Fase 4.
// TRANSCRIPCIÓN LITERAL de docs/architecture/api-contract.md §10 (CONGELADO):
// snake_case, envelope {success,data,error,meta}. Espejo de backend/app/schemas.py §10.
// Los tipos de LECTURA (ModuleDto, LessonDetailDto, ExampleDetailDto, QuizDto…) siguen
// viviendo en types.ts y NO se duplican aquí; esto es solo la superficie admin.
import type { ParserId, QuizOptionKey } from './types'

// El modo autoría ya NO usa login/token (2026-07-26): se gatea por build
// (VITE_ADMIN) + config del backend (EHPC_ADMIN_MODE). Los DTOs de auth
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

export interface AdminLessonBaseDto {
  module_id: string
  order: number
  title: string
  estimated_minutes: number
  content_markdown: string
  recommended: AdminRecommendedDto[]
}

export interface AdminLessonCreateDto extends AdminLessonBaseDto {
  id: string
  example: AdminExampleBaseDto
  source_code: string
}

/** Faceta lección + markdown (el ejemplo se edita por sus endpoints). */
export type AdminLessonUpdateDto = AdminLessonBaseDto

export interface AdminLessonDetailDto extends AdminLessonBaseDto {
  id: string
  enabled: boolean
  has_quiz: boolean
  quiz_question_count: number
  prev_lesson_id: string | null
  next_lesson_id: string | null
  example: AdminExampleDto
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
