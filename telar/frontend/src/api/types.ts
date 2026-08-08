// api/types.ts — DTOs TRANSCRITOS LITERALMENTE de docs/architecture/api-contract.md.
// CONGELADO: no añadir, quitar ni renombrar campos sin actualizar el contrato.
// snake_case literal; envelope {success,data,error,meta}; 8 fases de job.

// ───────────────────────────── §1 Envelope ─────────────────────────────────

export interface ApiErrorDto {
  code: string
  message: string
  /** Objeto libre con contexto (p. ej. errores de validación por campo). */
  details: unknown | null
}

/** Solo se puebla en listados paginados. */
export interface ApiMetaDto {
  total: number
  limit: number
  offset: number
}

export interface Envelope<T> {
  success: boolean
  data: T | null
  error: ApiErrorDto | null
  meta: ApiMetaDto | null
}

/** §1.1 Catálogo de códigos de error. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'JOB_NOT_FOUND'
  | 'EXAMPLE_NOT_FOUND'
  | 'LESSON_NOT_FOUND'
  | 'QUIZ_NOT_FOUND'
  | 'EXAMPLE_DISABLED'
  | 'JOB_NOT_CANCELLABLE'
  | 'JOB_NOT_FINISHED'
  | 'CODE_TOO_LARGE'
  | 'INVALID_EXTENSION'
  | 'INVALID_ENCODING'
  | 'TOO_MANY_JOBS'
  | 'INTERNAL_ERROR'
  | 'DOCKER_UNAVAILABLE'
  | 'RUNNER_IMAGE_MISSING'
  // §10 Autoría (admin) — Fase 4
  | 'UNAUTHORIZED'
  | 'MODULE_NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'ORDER_CONFLICT'
  | 'MODULE_NOT_EMPTY'
  | 'CONTENT_VALIDATION_ERROR'

// ─────────────────────────── §2 Salud y sistema ────────────────────────────

/** §2.1 GET /health — SIN envelope (excepción documentada). */
export interface HealthChecksDto {
  db: boolean
  docker: boolean
  runner_image: boolean
}

export interface HealthDto {
  status: string // 'ok' con 200; semántica liveness ≠ readiness
  checks: HealthChecksDto
}

/** §2.2 GET /api/v1/system */
export interface SystemVersionsDto {
  backend: string
  python: string
  pyomp: string
  api: string
}

export interface SystemLimitsDto {
  max_code_bytes: number
  max_timeout_s: number
  max_concurrent_jobs: number
  max_output_bytes: number
}

export interface SystemInfoDto {
  cores: number
  /** min(8, cores) — techo del slider. */
  max_threads: number
  runner_image: string
  runner_image_present: boolean
  gpu_examples_enabled: boolean
  versions: SystemVersionsDto
  limits: SystemLimitsDto
}

// ──────────────────────── §3 Catálogo de ejemplos ──────────────────────────

export type ParserId =
  | 'none'
  | 'sweep_pi'
  | 'sweep_transporte'
  | 'pair_openmp_numpy'
  | 'pair_openmp_blas'
  | 'pair_parallel_serial'

/** §3.1 GET /api/v1/examples — item del listado (sin código fuente). */
export interface ExampleSummaryDto {
  id: string
  title: string
  module_id: string
  order: number
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
}

export interface ExamplesListDto {
  examples: ExampleSummaryDto[]
}

/** §3.2 GET /api/v1/examples/{example_id} — detalle con código. */
export interface ExampleDetailDto extends ExampleSummaryDto {
  source_code: string
  lesson_id: string
  expected_output_note: string
  /** 3-4 bullets para la card «Lo que vas a aprender». */
  takeaways: string[]
}

// ───────────────────── §4 Cursos: módulos y lecciones ──────────────────────

/** Progreso fusionado por lección (§4.1/§4.2/§6.1 usan variantes de esto). */
export interface LessonProgressDto {
  viewed: boolean
  completed: boolean
  best_quiz_score: number | null
  quiz_total: number
}

/** §4.1 GET /api/v1/modules — lección dentro de un módulo. */
export interface ModuleLessonDto {
  id: string
  order: number
  title: string
  example_id: string
  has_quiz: boolean
  quiz_question_count: number
  estimated_minutes: number
  enabled: boolean
  progress: LessonProgressDto
}

export interface ModuleDto {
  id: string
  order: number
  title: string
  description: string
  level: string
  lessons: ModuleLessonDto[]
}

export interface ModulesSummaryDto {
  lessons_total: number
  lessons_enabled: number
  lessons_completed: number
  quizzes_total: number
  questions_enabled_total: number
}

export interface ModulesResponseDto {
  modules: ModuleDto[]
  summary: ModulesSummaryDto
}

/** §4.2 GET /api/v1/lessons/{lesson_id} */
export interface RecommendedLessonDto {
  lesson_id: string
  label: string
  tag: string
}

export interface LessonDetailDto {
  id: string
  module_id: string
  order: number
  title: string
  content_markdown: string
  example_id: string
  has_quiz: boolean
  quiz_question_count: number
  estimated_minutes: number
  enabled: boolean
  prev_lesson_id: string | null
  next_lesson_id: string | null
  recommended: RecommendedLessonDto[]
  progress: LessonProgressDto
}

// ────────────────────────────── §5 Quizzes ─────────────────────────────────

export type QuizOptionKey = 'a' | 'b' | 'c' | 'd'

export interface QuizOptionDto {
  key: QuizOptionKey
  text: string
}

/** §5.1 — pregunta SIN respuesta correcta (jamás viaja antes del intento). */
export interface QuizQuestionDto {
  id: string
  order: number
  text: string
  options: QuizOptionDto[]
}

export interface QuizDto {
  lesson_id: string
  question_count: number
  questions: QuizQuestionDto[]
}

/** §5.2 POST /api/v1/lessons/{lesson_id}/quiz/attempts — request. */
export interface QuizAttemptRequestDto {
  /** Deben venir TODAS las preguntas del quiz; valores en a|b|c|d. */
  answers: Record<string, QuizOptionKey>
}

export interface QuizQuestionResultDto {
  question_id: string
  selected: QuizOptionKey
  correct_key: QuizOptionKey
  correct: boolean
  explanation: string
}

/** §5.2 — respuesta 201. */
export interface QuizAttemptResultDto {
  attempt_id: string
  lesson_id: string
  score: number
  total: number
  passed: boolean
  pass_threshold: number
  created_at: string
  results: QuizQuestionResultDto[]
}

/** §5.3 GET .../quiz/attempts — historial (opcional post-MVP). */
export interface QuizAttemptSummaryDto {
  attempt_id: string
  score: number
  total: number
  passed: boolean
  created_at: string
}

export interface QuizAttemptsListDto {
  attempts: QuizAttemptSummaryDto[]
}

// ────────────────────────────── §6 Progreso ────────────────────────────────

/** §6.1 GET /api/v1/progress — entrada por lección (también respuesta de §6.2). */
export interface ProgressEntryDto {
  viewed: boolean
  completed: boolean
  best_quiz_score: number | null
  quiz_total: number
  last_job_id: string | null
  updated_at: string
}

export interface ProgressSummaryDto {
  lessons_completed: number
  lessons_enabled: number
  modules_completed: number
  modules_total: number
}

export interface ProgressResponseDto {
  /** Solo lecciones con algún registro; las demás se asumen en cero. */
  lessons: Record<string, ProgressEntryDto>
  summary: ProgressSummaryDto
}

/** §6.2 PUT /api/v1/progress/lessons/{lesson_id} — campos opcionales. */
export interface ProgressUpdateRequestDto {
  viewed?: boolean
  completed?: boolean
}

// ─────────────────────────────── §7 Jobs ───────────────────────────────────

/** §7.7 Estados del job (máquina de 8 fases). */
export type JobStatus =
  | 'queued'
  | 'creating'
  | 'compiling'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'

/** Terminales: completed | failed | timeout | cancelled. */
export type JobTerminalStatus = 'completed' | 'failed' | 'timeout' | 'cancelled'

export type SourceKind = 'example' | 'editor' | 'upload'

/** §7.4 — catálogo CERRADO de error_detail (nunca texto crudo de excepciones). */
export type JobErrorDetail =
  | 'wall_timeout'
  | 'output_limit_exceeded'
  | 'oom'
  | 'orphaned_on_restart'
  | 'sandbox_error'

/** §7.1 POST /api/v1/jobs — request (al menos una fuente: example_id y/o code). */
export interface JobCreateRequestDto {
  example_id?: string | null
  code?: string | null
  /** Patrón `^[A-Za-z0-9._-]{1,80}\.py$`; default: filename del ejemplo o main.py. */
  filename?: string | null
  /** Se OMITE si threads_configurable=false (el backend usa su valor fijo). */
  threads?: number | null
  /** 5..120 (tope servidor TELAR_MAX_TIMEOUT_S). */
  timeout_s?: number | null
  lesson_id?: string | null
}

/** §7.1/§7.2 — respuesta 202. */
export interface JobCreatedDto {
  job_id: string
  status: JobStatus
  /** CPUs realmente asignadas (puede diferir de threads en hilos fijos). */
  threads_effective: number
  threads_note: string | null
  ws_url: string
  href: string
  created_at: string
}

/** §7.3 GET /api/v1/jobs — item del listado (sin código, sin stdout). */
export interface JobSummaryDto {
  job_id: string
  filename: string
  source_kind: SourceKind
  example_id: string | null
  lesson_id: string | null
  status: JobStatus
  exit_code: number | null
  threads: number
  /** finished_at − started_at (excluye cola). */
  wall_time_ms: number | null
  created_at: string
  finished_at: string | null
}

export interface JobsListDto {
  jobs: JobSummaryDto[]
}

/** §7.4 — metrics_summary (agregado persistido de docker stats). */
export interface MetricsSummaryDto {
  samples: number
  cpu_percent_max: number
  cpu_percent_avg: number
  mem_used_bytes_max: number
  mem_limit_bytes: number
  pids_max: number
  throttled_periods: number
}

/** §7.4 — parsed_timings kind "sweep" (spmd, spmdCritical, transporteParticulas). */
export interface SweepPointDto {
  threads: number
  time_s: number
  speedup: number
  efficiency: number
}

export interface ParsedTimingsSweepDto {
  parser_id: ParserId
  kind: 'sweep'
  series: SweepPointDto[]
  extra: Record<string, number>
  correct: boolean | null
}

/** §7.4 — parsed_timings kind "pair" (sumaVectores, matrices, stencilCalor). */
export interface ParsedTimingsPairDto {
  parser_id: ParserId
  kind: 'pair'
  parallel_time_s: number
  reference_time_s: number
  /** "numpy" | "blas" | "serial" */
  reference_label: string
  speedup_vs_reference: number
  /** Del assert "correcto?/paralelo == serial?" si existe. */
  correct: boolean | null
}

export type ParsedTimingsDto = ParsedTimingsSweepDto | ParsedTimingsPairDto

/** §7.4 GET /api/v1/jobs/{job_id} — detalle y resultados. */
export interface JobDetailDto {
  job_id: string
  filename: string
  source_kind: SourceKind
  example_id: string | null
  lesson_id: string | null
  source_code: string
  status: JobStatus
  exit_code: number | null
  oom_killed: boolean
  error_detail: JobErrorDetail | null
  threads: number
  timeout_s: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  wall_time_ms: number | null
  /** null mientras el job no es terminal (el vivo va por WS). */
  stdout: string | null
  stderr: string | null
  output_truncated: boolean
  metrics_summary: MetricsSummaryDto | null
  /** null si no auto-mide, output truncado o job no terminal. */
  parsed_timings: ParsedTimingsDto | null
}

/** §7.5 POST /api/v1/jobs/{job_id}/cancel — respuesta 202. */
export interface JobCancelDto {
  job_id: string
  status: 'cancelling'
}
