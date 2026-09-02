// tests/fixtures/rest.ts — respuestas REST COPIADAS LITERALMENTE de los
// ejemplos JSON de api-contract.md (§2, §3, §4, §5, §7). snake_case literal,
// envelope {success,data,error,meta}. Los helpers envelope()/errorEnvelope()
// reproducen el sobre que client.ts desenvuelve.
import type {
  Envelope,
  ExampleDetailDto,
  JobDetailDto,
  ModulesResponseDto,
  ParsedTimingsPairDto,
  ParsedTimingsSweepDto,
  QuizAttemptResultDto,
  QuizDto,
  SystemInfoDto,
} from '@/api/types'

export function envelope<T>(data: T): Envelope<T> {
  return { success: true, data, error: null, meta: null }
}

export function errorEnvelope(code: string, message: string): Envelope<null> {
  return { success: false, data: null, error: { code, message, details: null }, meta: null }
}

/** Response-like para stubbear fetch (client.ts hace res.json()). */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

// ─────────────────────────── §2.2 GET /system ───────────────────────────────

export const SYSTEM_INFO: SystemInfoDto = {
  cores: 8,
  max_threads: 8,
  runner_image: 'telar-runner:0.5.1',
  runner_image_present: true,
  gpu_examples_enabled: false,
  versions: { backend: '1.0.0', python: '3.12', pyomp: '0.5.1', api: 'v1' },
  limits: { max_code_bytes: 262144, max_timeout_s: 120, max_concurrent_jobs: 10, max_output_bytes: 262144 },
  // Fase 5 (§11.12.A): despliegue CON bucket. `enabled: false` oculta el item
  // «Módulos disponibles» del rail.
  catalog: {
    enabled: true,
    bucket: 'telar-demo',
    mode: 'anonymous',
    last_checked_at: '2026-07-12T15:04:05.123Z',
  },
}

/** Host con menos de 8 núcleos (aviso ámbar del sweep). */
export const SYSTEM_INFO_4CORES: SystemInfoDto = {
  ...SYSTEM_INFO,
  cores: 4,
  max_threads: 4,
}

// ─────────────────────── §4.1 GET /modules ──────────────────────────────────

export const MODULES: ModulesResponseDto = {
  modules: [
    {
      id: 'm2',
      order: 2,
      title: 'Patrón SPMD y false sharing',
      description:
        'Reparto manual con omp_get_thread_num; false sharing y su arreglo (privado + critical).',
      level: 'Intermedio',
      version: 1,
      origin: 'local',
      update_available: null,
      lessons: [
        {
          id: 'spmd',
          order: 3,
          title: 'π con patrón SPMD (false sharing)',
          example_id: 'spmd',
          has_quiz: true,
          has_video: false,
          quiz_question_count: 5,
          estimated_minutes: 20,
          enabled: true,
          completion_rule: 'quiz',
          progress: { viewed: true, completed: false, best_quiz_score: 4, quiz_total: 5 },
        },
        {
          id: 'spmdCritical',
          order: 4,
          title: 'El arreglo: critical',
          example_id: 'spmdCritical',
          has_quiz: true,
          has_video: false,
          quiz_question_count: 5,
          estimated_minutes: 20,
          enabled: true,
          completion_rule: 'quiz',
          progress: { viewed: false, completed: false, best_quiz_score: null, quiz_total: 5 },
        },
      ],
    },
  ],
  summary: {
    lessons_total: 14,
    lessons_enabled: 13,
    lessons_completed: 5,
    quizzes_total: 14,
    questions_enabled_total: 60,
    modules_installed: 8,
    modules_updatable: 0,
  },
}

/**
 * Catálogo con una lección CONCEPTUAL (E1: sin ejemplo, se completa leyéndola).
 *
 * Va aparte de `MODULES` a propósito: si la lección sin ejemplo entrara en el
 * fixture compartido, la autoselección de `SimulatorIdle` la elegiría y el
 * simulador arrancaría sin nada que ejecutar, rompiendo tests que no tienen
 * nada que ver con esto.
 */
export const MODULES_CON_LECTURA: ModulesResponseDto = {
  modules: [
    {
      ...MODULES.modules[0],
      id: 'f1',
      order: 1,
      title: 'Fundamentos de paralelismo',
      lessons: [
        {
          id: 'queEsUnHilo',
          order: 1,
          title: '¿Qué es un hilo?',
          example_id: null,
          has_quiz: false,
          has_video: true,
          quiz_question_count: 0,
          estimated_minutes: 5,
          enabled: true,
          completion_rule: 'viewed',
          progress: { viewed: false, completed: false, best_quiz_score: null, quiz_total: 0 },
        },
        MODULES.modules[0].lessons[0],
      ],
    },
  ],
  summary: { ...MODULES.summary, lessons_total: 15, modules_installed: 9 },
}

// ─────────────────────── §5.1 GET /lessons/{id}/quiz ─────────────────────────

export const QUIZ: QuizDto = {
  lesson_id: 'spmd',
  question_count: 2,
  questions: [
    {
      id: 'spmd-q1',
      order: 1,
      text: '¿Cómo reparte el trabajo el hilo tid en el patrón SPMD de este ejemplo?',
      options: [
        { key: 'a', text: 'OpenMP reparte el bucle automáticamente' },
        { key: 'b', text: 'Manualmente con range(tid, num_steps, nths): reparto cíclico' },
        { key: 'c', text: 'Cada hilo procesa la mitad izquierda o derecha' },
        { key: 'd', text: 'Un hilo maestro asigna trozos bajo demanda' },
      ],
    },
    {
      id: 'spmd-q2',
      order: 2,
      text: '¿Qué mide omp_get_wtime()?',
      options: [
        { key: 'a', text: 'El tiempo de CPU acumulado de todos los hilos' },
        { key: 'b', text: 'El número de hilos activos' },
        { key: 'c', text: 'El tiempo de reloj de pared dentro de la región' },
        { key: 'd', text: 'El uso de memoria del proceso' },
      ],
    },
  ],
}

// ─────────────────── §5.2 POST /lessons/{id}/quiz/attempts ───────────────────

export const QUIZ_ATTEMPT_RESULT: QuizAttemptResultDto = {
  attempt_id: '9f2c4e61b0a14d97a6d0c3f5e8b21a44',
  lesson_id: 'spmd',
  score: 2,
  total: 2,
  passed: true,
  pass_threshold: 0.8,
  created_at: '2026-07-12T15:04:05.123Z',
  results: [
    {
      question_id: 'spmd-q1',
      selected: 'b',
      correct_key: 'b',
      correct: true,
      explanation: 'El info lo llama "ESTE es el reparto manual"; el for es un for de Python normal.',
    },
    {
      question_id: 'spmd-q2',
      selected: 'c',
      correct_key: 'c',
      correct: true,
      explanation: 'omp_get_wtime() es el cronómetro de OpenMP y mide reloj de pared.',
    },
  ],
}

/** Variante fallida (una respuesta incorrecta): score 1/2, no aprobado. */
export const QUIZ_ATTEMPT_FAIL: QuizAttemptResultDto = {
  ...QUIZ_ATTEMPT_RESULT,
  score: 1,
  passed: false,
  results: [
    QUIZ_ATTEMPT_RESULT.results[0],
    {
      question_id: 'spmd-q2',
      selected: 'a',
      correct_key: 'c',
      correct: false,
      explanation: 'omp_get_wtime() es el cronómetro de OpenMP y se usa dentro de la función @njit.',
    },
  ],
}

// ─────────────────────── §7.4 parsed_timings ────────────────────────────────

/** sweep_transporte (copiado del §7.4): escala casi lineal, correct null. */
export const TIMINGS_SWEEP_TRANSPORTE: ParsedTimingsSweepDto = {
  parser_id: 'sweep_transporte',
  kind: 'sweep',
  series: [
    { threads: 1, time_s: 0.726, speedup: 1.0, efficiency: 1.0 },
    { threads: 2, time_s: 0.256, speedup: 2.84, efficiency: 1.42 },
    { threads: 4, time_s: 0.173, speedup: 4.2, efficiency: 1.05 },
    { threads: 8, time_s: 0.091, speedup: 7.98, efficiency: 1.0 },
  ],
  extra: { transmitidas_pct: 2.35, reflejadas_pct: 20.85, absorbidas_pct: 76.8 },
  correct: null,
}

/** sweep de piSpmd PLANO (false sharing): 8 hilos, casi sin speedup. */
export const TIMINGS_SWEEP_SPMD_FLAT: ParsedTimingsSweepDto = {
  parser_id: 'sweep_pi',
  kind: 'sweep',
  series: [
    { threads: 1, time_s: 1.0, speedup: 1.0, efficiency: 1.0 },
    { threads: 2, time_s: 0.95, speedup: 1.05, efficiency: 0.53 },
    { threads: 4, time_s: 0.9, speedup: 1.11, efficiency: 0.28 },
    { threads: 8, time_s: 0.85, speedup: 1.18, efficiency: 0.15 },
  ],
  extra: {},
  correct: false,
}

/** pair_parallel_serial (copiado del §7.4). */
export const TIMINGS_PAIR_SERIAL: ParsedTimingsPairDto = {
  parser_id: 'pair_parallel_serial',
  kind: 'pair',
  parallel_time_s: 0.912,
  reference_time_s: 0.989,
  reference_label: 'serial',
  speedup_vs_reference: 1.08,
  correct: true,
}

/** pair donde OpenMP pierde contra NumPy (speedup < 1). */
export const TIMINGS_PAIR_NUMPY_SLOW: ParsedTimingsPairDto = {
  parser_id: 'pair_openmp_numpy',
  kind: 'pair',
  parallel_time_s: 2.0,
  reference_time_s: 1.0,
  reference_label: 'numpy',
  speedup_vs_reference: 0.5,
  correct: true,
}

/** pair_openmp_blas: referencia es BLAS (1 core + SIMD), no t(1) del mismo código (BL-30). */
export const TIMINGS_PAIR_BLAS: ParsedTimingsPairDto = {
  parser_id: 'pair_openmp_blas',
  kind: 'pair',
  parallel_time_s: 0.7,
  reference_time_s: 0.98,
  reference_label: 'blas',
  speedup_vs_reference: 1.4,
  correct: true,
}

// ─────────────────────── §7.4 GET /jobs/{id} detalle ─────────────────────────

const JOB_BASE: JobDetailDto = {
  job_id: '01a2b3c4d5e64f789a0b1c2d3e4f5061',
  filename: 'transporteMonteCarlo.py',
  source_kind: 'example',
  example_id: 'transporteParticulas',
  lesson_id: 'transporteParticulas',
  source_code: 'from numba.openmp import njit, openmp_context as openmp\n',
  status: 'completed',
  exit_code: 0,
  oom_killed: false,
  error_detail: null,
  threads: 8,
  timeout_s: 60,
  created_at: '2026-07-12T15:04:05.123Z',
  started_at: '2026-07-12T15:04:05.610Z',
  finished_at: '2026-07-12T15:04:14.337Z',
  wall_time_ms: 8727,
  stdout: 'hilos = 1 | tiempo = 0.726 s | transmitidas: 2.35 %\nhilos = 8 | tiempo = 0.091 s',
  stderr: '',
  output_truncated: false,
  metrics_summary: {
    samples: 8,
    cpu_percent_max: 792.4,
    cpu_percent_avg: 431.0,
    mem_used_bytes_max: 231211008,
    mem_limit_bytes: 536870912,
    pids_max: 12,
    throttled_periods: 0,
  },
  parsed_timings: TIMINGS_SWEEP_TRANSPORTE,
}

export function jobDetail(overrides: Partial<JobDetailDto> = {}): JobDetailDto {
  return { ...JOB_BASE, ...overrides }
}

/** Job terminal con parser sweep (SpeedupChart). */
export const JOB_SWEEP = jobDetail()

/** Job terminal con parser pair (ComparisonBars). */
export const JOB_PAIR = jobDetail({
  filename: 'sumaVectores.py',
  example_id: 'sumaVectores',
  lesson_id: 'sumaVectores',
  parsed_timings: TIMINGS_PAIR_SERIAL,
})

/** Job terminal sin parsed_timings pero con metrics_summary (degradación). */
export const JOB_NO_TIMINGS = jobDetail({
  filename: 'helloOpenMP.py',
  example_id: 'helloOpenMP',
  lesson_id: null,
  parsed_timings: null,
})

/** Job terminal sin parsed_timings NI metrics_summary (degradación total). */
export const JOB_BARE = jobDetail({
  parsed_timings: null,
  metrics_summary: null,
  lesson_id: null,
  example_id: null,
  source_kind: 'editor',
})

/** Job fallido con stderr (regla failed + stderr de observations). */
export const JOB_FAILED = jobDetail({
  status: 'failed',
  exit_code: 1,
  parsed_timings: null,
  stderr: 'Traceback (most recent call last):\n  File "x.py", line 3\nZeroDivisionError: division by zero',
})

// ─────────────────────── §3.2 GET /examples/{id} ─────────────────────────────

const EXAMPLE_BASE: ExampleDetailDto = {
  id: 'spmd',
  title: 'π con patrón SPMD',
  module_id: 'm2',
  order: 3,
  filename: 'piSpmd.py',
  difficulty: 3,
  teaches: 'false sharing',
  directives: ['parallel', 'critical'],
  threads_configurable: true,
  fixed_threads: null,
  fixed_threads_note: null,
  sweeps_threads: false,
  self_measures: false,
  parser_id: 'none',
  default_timeout_s: 60,
  est_run_seconds: 5,
  enabled: true,
  requires_gpu: false,
  source_code: 'print("hola")\n',
  lesson_id: 'spmd',
  expected_output_note: 'π ≈ 3.14159',
  takeaways: ['SPMD reparte a mano', 'false sharing'],
}

export function exampleDetail(overrides: Partial<ExampleDetailDto> = {}): ExampleDetailDto {
  return { ...EXAMPLE_BASE, ...overrides }
}

/** Ejemplo configurable (slider activo). */
export const EXAMPLE_CONFIGURABLE = exampleDetail()

/** Ejemplo de hilos FIJOS (entornoDatos): slider disabled + hint. */
export const EXAMPLE_FIXED = exampleDetail({
  id: 'entornoDatos',
  filename: 'entornoDatos.py',
  threads_configurable: false,
  sweeps_threads: false,
  fixed_threads: 4,
  fixed_threads_note: 'Este ejemplo usa exactamente 4 hilos por diseño del ejercicio.',
})

/** Ejemplo de BARRIDO (piSpmd): slider disabled mostrando 1·2·4·8. */
export const EXAMPLE_SWEEP = exampleDetail({
  id: 'piSpmd',
  filename: 'piSpmd.py',
  threads_configurable: false,
  sweeps_threads: true,
  parser_id: 'sweep_pi',
  fixed_threads: null,
})
