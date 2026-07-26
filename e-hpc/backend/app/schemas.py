"""Modelos pydantic (v2) del contrato de API de E-HPC.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO):
envelope genérico, salud/sistema, ejemplos, módulos/lecciones, quizzes,
progreso, jobs y mensajes WebSocket. Sin lógica: solo shapes.
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

# ────────────────────────────── §1 Envelope ─────────────────────────────────

#: §1.1 — catálogo de códigos de error.
#: Los códigos ADMIN (Fase 4, §10) se AÑADEN al final sin tocar los de Fase 3.
ApiErrorCode = Literal[
    "VALIDATION_ERROR",
    "JOB_NOT_FOUND",
    "EXAMPLE_NOT_FOUND",
    "LESSON_NOT_FOUND",
    "QUIZ_NOT_FOUND",
    "EXAMPLE_DISABLED",
    "JOB_NOT_CANCELLABLE",
    "JOB_NOT_FINISHED",
    "CODE_TOO_LARGE",
    "INVALID_EXTENSION",
    "INVALID_ENCODING",
    "TOO_MANY_JOBS",
    "INTERNAL_ERROR",
    "DOCKER_UNAVAILABLE",
    "RUNNER_IMAGE_MISSING",
    # ── Autoría (admin) — Fase 4, api-contract §10 ──
    "UNAUTHORIZED",             # 401 /admin/* con el modo admin apagado (sin EHPC_ADMIN_MODE)
    "MODULE_NOT_FOUND",         # 404 id de módulo inexistente
    "DUPLICATE_ID",             # 409 crear con un id ya usado (módulo o lección/ejemplo)
    "ORDER_CONFLICT",           # 409 order de módulo o de lección colisiona
    "MODULE_NOT_EMPTY",         # 409 borrar un módulo con lecciones
    "CONTENT_VALIDATION_ERROR", # 422 reglas de negocio (refs, markdown, correct_key, threads/GPU…)
]

T = TypeVar("T")


class ApiError(BaseModel):
    """Bloque ``error`` del envelope."""

    code: str
    message: str
    details: Any | None = None  # objeto libre (p. ej. lista 422 de FastAPI)


class ApiMeta(BaseModel):
    """Bloque ``meta`` — solo en listados paginados."""

    total: int
    limit: int
    offset: int


class Envelope(BaseModel, Generic[T]):
    """Envelope común: ``{"success", "data", "error", "meta"}``."""

    success: bool
    data: T | None = None
    error: ApiError | None = None
    meta: ApiMeta | None = None


# ─────────────────────────── §2 Salud y sistema ─────────────────────────────


class HealthChecks(BaseModel):
    """Checks informativos de ``GET /health``."""

    db: bool
    docker: bool
    runner_image: bool


class HealthResponse(BaseModel):
    """§2.1 ``GET /health`` — SIN envelope (excepción documentada)."""

    status: str  # "ok" con 200; liveness ≠ readiness
    checks: HealthChecks


class SystemVersions(BaseModel):
    backend: str
    python: str
    pyomp: str
    api: str


class SystemLimits(BaseModel):
    max_code_bytes: int
    max_timeout_s: int
    max_concurrent_jobs: int
    max_output_bytes: int


class SystemInfo(BaseModel):
    """§2.2 ``GET /api/v1/system`` — bloque ``data``."""

    cores: int
    max_threads: int  # min(8, cores) — techo del slider
    runner_image: str
    runner_image_present: bool
    gpu_examples_enabled: bool
    versions: SystemVersions
    limits: SystemLimits


# ──────────────────────── §3 Catálogo de ejemplos ───────────────────────────

#: Los 6 parser_id válidos (architecture.md §7.2).
ParserId = Literal[
    "none",
    "sweep_pi",
    "sweep_transporte",
    "pair_openmp_numpy",
    "pair_openmp_blas",
    "pair_parallel_serial",
]


class ExampleSummary(BaseModel):
    """§3.1 — item de ``GET /api/v1/examples`` (sin código fuente)."""

    id: str
    title: str
    module_id: str
    order: int
    filename: str
    difficulty: int
    teaches: str
    directives: list[str]
    threads_configurable: bool
    fixed_threads: int | None
    fixed_threads_note: str | None
    sweeps_threads: bool
    self_measures: bool
    parser_id: ParserId
    default_timeout_s: int
    est_run_seconds: int
    enabled: bool
    requires_gpu: bool


class ExamplesList(BaseModel):
    examples: list[ExampleSummary]


class ExampleDetail(ExampleSummary):
    """§3.2 ``GET /api/v1/examples/{example_id}`` — detalle con código."""

    source_code: str
    lesson_id: str
    expected_output_note: str
    takeaways: list[str]  # 3-4 bullets («Lo que vas a aprender»)


# ───────────────────── §4 Cursos: módulos y lecciones ───────────────────────


class LessonProgress(BaseModel):
    """Progreso fusionado por lección (§4.1/§4.2)."""

    viewed: bool
    completed: bool
    best_quiz_score: int | None
    quiz_total: int


class ModuleLesson(BaseModel):
    """§4.1 — lección dentro de un módulo."""

    id: str
    order: int
    title: str
    example_id: str
    has_quiz: bool
    quiz_question_count: int
    estimated_minutes: int
    enabled: bool
    progress: LessonProgress


class Module(BaseModel):
    id: str
    order: int
    title: str
    description: str
    level: str
    lessons: list[ModuleLesson]


class ModulesSummary(BaseModel):
    lessons_total: int
    lessons_enabled: int
    lessons_completed: int
    quizzes_total: int
    questions_enabled_total: int


class ModulesResponse(BaseModel):
    """§4.1 ``GET /api/v1/modules`` — bloque ``data``."""

    modules: list[Module]
    summary: ModulesSummary


class RecommendedLesson(BaseModel):
    lesson_id: str
    label: str
    tag: str


class LessonDetail(BaseModel):
    """§4.2 ``GET /api/v1/lessons/{lesson_id}`` — bloque ``data``."""

    id: str
    module_id: str
    order: int
    title: str
    content_markdown: str
    example_id: str
    has_quiz: bool
    quiz_question_count: int
    estimated_minutes: int
    enabled: bool
    prev_lesson_id: str | None
    next_lesson_id: str | None
    recommended: list[RecommendedLesson]
    progress: LessonProgress


# ────────────────────────────── §5 Quizzes ──────────────────────────────────

QuizOptionKey = Literal["a", "b", "c", "d"]


class QuizOption(BaseModel):
    key: QuizOptionKey
    text: str


class QuizQuestion(BaseModel):
    """§5.1 — pregunta SIN clave correcta (jamás viaja antes del intento)."""

    id: str
    order: int
    text: str
    options: list[QuizOption]


class QuizResponse(BaseModel):
    """§5.1 ``GET /api/v1/lessons/{lesson_id}/quiz`` — bloque ``data``."""

    lesson_id: str
    question_count: int
    questions: list[QuizQuestion]


class QuizAttemptRequest(BaseModel):
    """§5.2 — request de ``POST .../quiz/attempts``.

    Deben venir TODAS las preguntas del quiz (validación de negocio en el
    servicio); valores en a|b|c|d (aquí, por Literal).
    """

    answers: dict[str, QuizOptionKey]


class QuizQuestionResult(BaseModel):
    question_id: str
    selected: QuizOptionKey
    correct_key: QuizOptionKey
    correct: bool
    explanation: str


class QuizAttemptResult(BaseModel):
    """§5.2 — respuesta 201 (bloque ``data``)."""

    attempt_id: str
    lesson_id: str
    score: int
    total: int
    passed: bool
    pass_threshold: float
    created_at: str
    results: list[QuizQuestionResult]


class QuizAttemptSummary(BaseModel):
    """§5.3 — item del historial de intentos (opcional post-MVP)."""

    attempt_id: str
    score: int
    total: int
    passed: bool
    created_at: str


class QuizAttemptsList(BaseModel):
    attempts: list[QuizAttemptSummary]


# ────────────────────────────── §6 Progreso ─────────────────────────────────


class ProgressEntry(BaseModel):
    """§6.1 — entrada por lección (también respuesta de §6.2)."""

    viewed: bool
    completed: bool
    best_quiz_score: int | None
    quiz_total: int
    last_job_id: str | None
    updated_at: str


class ProgressSummary(BaseModel):
    lessons_completed: int
    lessons_enabled: int
    modules_completed: int
    modules_total: int


class ProgressResponse(BaseModel):
    """§6.1 ``GET /api/v1/progress`` — bloque ``data``."""

    lessons: dict[str, ProgressEntry]
    summary: ProgressSummary


class ProgressUpdateRequest(BaseModel):
    """§6.2 ``PUT /api/v1/progress/lessons/{lesson_id}`` — campos opcionales.

    ``best_quiz_score`` y ``last_job_id`` NO son escribibles por este endpoint.
    """

    viewed: bool | None = None
    completed: bool | None = None


# ─────────────────────────────── §7 Jobs ────────────────────────────────────

#: §7.7 — máquina de 8 fases.
JobStatus = Literal[
    "queued",
    "creating",
    "compiling",
    "running",
    "completed",
    "failed",
    "timeout",
    "cancelled",
]

#: Terminales: completed | failed | timeout | cancelled.
JobTerminalStatus = Literal["completed", "failed", "timeout", "cancelled"]

SourceKind = Literal["example", "editor", "upload"]

#: §7.4 — catálogo CERRADO de error_detail (nunca texto crudo de excepciones).
JobErrorDetail = Literal[
    "wall_timeout",
    "output_limit_exceeded",
    "oom",
    "orphaned_on_restart",
    "sandbox_error",
]

#: §7.1/§7.2 — patrón estricto de filename (rechaza comillas, CR/LF, control).
FILENAME_PATTERN = r"^[A-Za-z0-9._-]{1,80}\.py$"


class JobCreateRequest(BaseModel):
    """§7.1 ``POST /api/v1/jobs`` — al menos una fuente (example_id y/o code).

    La regla «al menos una fuente» y los topes dependientes de config
    (threads ≤ max_threads) se validan en el router (400/422 del contrato).
    """

    example_id: str | None = None
    # BL-17: sin cap estático de bytes — el tope se aplica en RUNTIME
    # (settings.max_code_bytes) en el router `_create_job`, por igual que la vía
    # multipart y la admin JSON. Así subir/bajar EHPC_MAX_CODE_BYTES surte efecto
    # también por esta vía; el exceso da 413 CODE_TOO_LARGE (no un 422 genérico).
    code: str | None = Field(default=None, min_length=1)
    filename: str | None = Field(default=None, pattern=FILENAME_PATTERN)
    threads: int | None = Field(default=None, ge=1)  # tope: max_threads (/system)
    timeout_s: int | None = Field(default=None, ge=5, le=120)
    lesson_id: str | None = None


class JobCreated(BaseModel):
    """§7.1/§7.2 — respuesta 202 (bloque ``data``)."""

    job_id: str
    status: JobStatus
    threads_effective: int  # CPUs realmente asignadas
    threads_note: str | None
    ws_url: str
    href: str
    created_at: str


class JobSummary(BaseModel):
    """§7.3 — item de ``GET /api/v1/jobs`` (sin código, sin stdout)."""

    job_id: str
    filename: str
    source_kind: SourceKind
    example_id: str | None
    lesson_id: str | None
    status: JobStatus
    exit_code: int | None
    threads: int
    wall_time_ms: int | None  # finished_at − started_at (excluye cola)
    created_at: str
    finished_at: str | None


class JobsList(BaseModel):
    jobs: list[JobSummary]


class MetricsSummary(BaseModel):
    """§7.4 — agregado persistido de docker stats (data-model §3.1)."""

    samples: int
    cpu_percent_max: float
    cpu_percent_avg: float
    mem_used_bytes_max: int
    mem_limit_bytes: int
    pids_max: int
    throttled_periods: int


class SweepPoint(BaseModel):
    threads: int
    time_s: float
    speedup: float
    efficiency: float


class ParsedTimingsSweep(BaseModel):
    """§7.4 — ``parsed_timings`` kind "sweep" (spmd, spmdCritical, transporte)."""

    parser_id: ParserId
    kind: Literal["sweep"]
    series: list[SweepPoint]
    extra: dict[str, float]
    correct: bool | None


class ParsedTimingsPair(BaseModel):
    """§7.4 — ``parsed_timings`` kind "pair" (sumaVectores, matrices, stencil)."""

    parser_id: ParserId
    kind: Literal["pair"]
    parallel_time_s: float
    reference_time_s: float
    reference_label: str  # "numpy" | "blas" | "serial"
    speedup_vs_reference: float
    correct: bool | None


ParsedTimings = ParsedTimingsSweep | ParsedTimingsPair


class JobDetail(BaseModel):
    """§7.4 ``GET /api/v1/jobs/{job_id}`` — bloque ``data``."""

    job_id: str
    filename: str
    source_kind: SourceKind
    example_id: str | None
    lesson_id: str | None
    source_code: str
    status: JobStatus
    exit_code: int | None
    oom_killed: bool
    error_detail: JobErrorDetail | None
    threads: int
    timeout_s: int
    created_at: str
    started_at: str | None
    finished_at: str | None
    wall_time_ms: int | None
    stdout: str | None  # null mientras el job no es terminal
    stderr: str | None
    output_truncated: bool
    metrics_summary: MetricsSummary | None
    parsed_timings: ParsedTimings | None


class JobCancelResult(BaseModel):
    """§7.5 ``POST /api/v1/jobs/{job_id}/cancel`` — respuesta 202."""

    job_id: str
    status: Literal["cancelling"]


# ──────────────────── §8 Protocolo WebSocket (mensajes) ─────────────────────

#: Códigos de ``error`` no fatal del stream (§8.2). No cierran la conexión.
WsErrorCode = Literal["OUTPUT_TRUNCATED", "STREAM_ERROR", "BAD_CLIENT_MESSAGE"]


class WsStatusDetail(BaseModel):
    """``detail`` de un ``status`` terminal (solo en fases terminales)."""

    exit_code: int | None
    oom_killed: bool
    wall_time_ms: int | None
    output_truncated: bool
    error_detail: str | None


class WsStatusMsg(BaseModel):
    """§8.2 ``status`` — cambio de fase (snapshot al conectar + transiciones)."""

    type: Literal["status"] = "status"
    job_id: str
    ts: str  # ISO-8601 UTC
    phase: JobStatus
    detail: WsStatusDetail | None = None


class WsLogMsg(BaseModel):
    """§8.2 ``log`` — líneas completas re-bufferizadas por ``\\n``."""

    type: Literal["log"] = "log"
    job_id: str
    ts: str
    stream: Literal["stdout", "stderr"]
    lines: list[str]
    seq: int  # contador monótono por job (huecos detectables)


class WsMetricsMsg(BaseModel):
    """§8.2 ``metrics`` — muestra de docker stats (~1/s, lossy)."""

    type: Literal["metrics"] = "metrics"
    job_id: str
    ts: str
    cpu_percent: float  # puede superar 100 (N hilos ≈ N·100)
    online_cpus: int
    mem_used_bytes: int
    mem_limit_bytes: int
    mem_percent: float
    pids: int
    throttled_periods: int


class WsErrorMsg(BaseModel):
    """§8.2 ``error`` — error no fatal del stream (no cierra la conexión)."""

    type: Literal["error"] = "error"
    job_id: str
    ts: str
    code: WsErrorCode
    message: str


class WsEofMsg(BaseModel):
    """§8.2 ``eof`` — último mensaje; después el servidor cierra con 1000."""

    type: Literal["eof"] = "eof"
    job_id: str
    ts: str
    total_log_bytes: int
    truncated: bool


#: Unión servidor → cliente (discriminada por ``type``).
WsServerMsg = WsStatusMsg | WsLogMsg | WsMetricsMsg | WsErrorMsg | WsEofMsg


class WsCancelMsg(BaseModel):
    """§8.3 cliente → servidor: único comando soportado."""

    type: Literal["cancel"]


# ═══════════════════ §10 Autoría de cursos (admin) — Fase 4 ══════════════════
# TRANSCRIPCIÓN de api-contract.md §10 (CONGELADO). ADITIVO: no toca nada de
# Fase 3. Namespace REST /api/v1/admin; el modo admin es una variante de
# despliegue gateada por EHPC_ADMIN_MODE (sin login/token).
# Espejo TS: frontend/src/api/admin-types.ts.

#: §10 — ids estables de contenido (== nombre de carpeta, camelCase o m1..m8).
ID_PATTERN = r"^[A-Za-z][A-Za-z0-9_-]{0,63}$"
#: §10 — ids de pregunta de quiz (p. ej. ``spmd-q1``).
QUESTION_ID_PATTERN = r"^[A-Za-z0-9._-]{1,80}$"


# ── §10.2 Fragmentos compartidos ─────────────────────────────────────────────


class AdminRecommended(BaseModel):
    lesson_id: str
    label: str = Field(min_length=1, max_length=120)
    tag: str = Field(min_length=1, max_length=40)


# ── §10.3 Módulos ────────────────────────────────────────────────────────────


class AdminModuleBase(BaseModel):
    order: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=2000)
    level: str = Field(min_length=1, max_length=40)


class AdminModuleCreate(AdminModuleBase):
    id: str = Field(pattern=ID_PATTERN)


class AdminModuleUpdate(AdminModuleBase):
    """``id`` viene por el path param; reemplazo total de los campos editables."""


class AdminLessonRef(BaseModel):
    """Lección resumida dentro de ``AdminModule`` (para el dashboard admin)."""

    id: str
    order: int
    title: str
    enabled: bool
    has_quiz: bool
    quiz_question_count: int


class AdminModule(AdminModuleBase):
    id: str
    lessons: list[AdminLessonRef]


class AdminModulesResponse(BaseModel):
    modules: list[AdminModule]


# ── §10.2/§10.3 Reorden por lote (BL-20) ─────────────────────────────────────


class AdminReorderItem(BaseModel):
    """Un id de módulo/lección y su nuevo ``order`` (global, ≥1)."""

    id: str
    order: int = Field(ge=1)


class AdminReorderRequest(BaseModel):
    """``PUT /admin/{modules,lessons}/reorder`` — reasigna varios ``order`` en
    una sola transacción (evita el 409 del swap directo, §10.2)."""

    items: list[AdminReorderItem] = Field(min_length=1)


# ── §10.4 Ejemplos (faceta; nacen/mueren con la lección) ─────────────────────


class AdminExampleBase(BaseModel):
    """Metadatos editables del ejemplo (``source_code`` va por ``/code``)."""

    title: str = Field(min_length=1, max_length=160)
    filename: str = Field(pattern=FILENAME_PATTERN)
    difficulty: int = Field(ge=1, le=5)
    teaches: str = Field(min_length=1)
    directives: list[str]
    threads_configurable: bool
    fixed_threads: int | None = Field(default=None, ge=1, le=16)
    fixed_threads_note: str | None = None
    sweeps_threads: bool
    self_measures: bool
    parser_id: ParserId
    default_timeout_s: int = Field(ge=5, le=120)
    est_run_seconds: int = Field(ge=1)
    enabled: bool
    requires_gpu: bool
    expected_output_note: str
    takeaways: list[str] = Field(min_length=1)


class AdminExampleUpdate(AdminExampleBase):
    """§10.4 ``PUT /admin/examples/{id}`` — metadatos (sin código)."""


class AdminExample(AdminExampleBase):
    """§10.4 ``GET /admin/examples/{id}`` — con ``source_code`` y derivados."""

    id: str
    module_id: str
    order: int
    source_code: str


class AdminExampleCodeRequest(BaseModel):
    """§10.4 ``POST /admin/examples/{id}/code`` — variante JSON (alt: multipart)."""

    filename: str = Field(pattern=FILENAME_PATTERN)
    # BL-17: el tope de bytes se aplica en RUNTIME (settings.max_code_bytes) en
    # content_writer, no como cap estático — así JSON y multipart honran el
    # mismo límite configurable (subir o bajar EHPC_MAX_CODE_BYTES).
    source_code: str = Field(min_length=1)


class AdminExampleCodeResult(BaseModel):
    """§10.4 — respuesta 200 tras subir el ``.py`` del ejemplo."""

    example_id: str
    filename: str
    bytes: int


# ── §10.5 Lecciones (unidad = lección + ejemplo pareado + quiz) ──────────────


class AdminLessonBase(BaseModel):
    module_id: str
    order: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    estimated_minutes: int = Field(ge=1, le=600)
    content_markdown: str = Field(min_length=1, max_length=65536)
    recommended: list[AdminRecommended] = Field(default_factory=list, max_length=6)


class AdminLessonCreate(AdminLessonBase):
    """§10.5 ``POST /admin/lessons`` — crea lección + ejemplo pareado (mismo id)."""

    id: str = Field(pattern=ID_PATTERN)
    example: AdminExampleBase
    # BL-17: tope en runtime (settings.max_code_bytes), no cap estático.
    source_code: str = Field(min_length=1)


class AdminLessonUpdate(AdminLessonBase):
    """§10.5 ``PUT /admin/lessons/{id}`` — faceta lección + markdown."""


class AdminLessonDetail(AdminLessonBase):
    """§10.5 ``GET /admin/lessons/{id}`` — lección + ejemplo + derivados."""

    id: str
    enabled: bool
    has_quiz: bool
    quiz_question_count: int
    prev_lesson_id: str | None
    next_lesson_id: str | None
    example: AdminExample


# ── §10.6 Quiz (GET admin SÍ trae correct_key/explanation) ───────────────────


class AdminQuizOption(BaseModel):
    key: QuizOptionKey
    text: str = Field(min_length=1)


class AdminQuizQuestion(BaseModel):
    # §10.5/BL-18: id opcional; si falta, el servidor autogenera
    # ``{lesson_id}-q{order}`` (content_writer). Con valor, cumple el patrón.
    id: str | None = Field(default=None, pattern=QUESTION_ID_PATTERN)
    order: int = Field(ge=1)
    text: str = Field(min_length=1)
    options: list[AdminQuizOption] = Field(min_length=2, max_length=4)
    correct_key: QuizOptionKey
    explanation: str = Field(min_length=1)


class AdminQuizUpsert(BaseModel):
    """§10.6 ``PUT /admin/lessons/{id}/quiz`` — reemplazo total del set."""

    pass_threshold: float = Field(gt=0.0, le=1.0)
    questions: list[AdminQuizQuestion] = Field(min_length=1)


class AdminQuiz(AdminQuizUpsert):
    """§10.6 ``GET /admin/lessons/{id}/quiz`` — con clave correcta (solo admin)."""

    lesson_id: str
    question_count: int


class AdminDeleteResult(BaseModel):
    """Respuesta común de los DELETE admin."""

    deleted: bool
    id: str
