"""DTOs pydantic (v2) del contrato de API de E-HPC — §10 Autoría (admin), Fase 4.

TRANSCRIPCIÓN de api-contract.md §10 (CONGELADO). ADITIVO: no toca nada de
Fase 3. Reutiliza ``ParserId`` (§3), ``FILENAME_PATTERN`` (§7) y
``QuizOptionKey`` (§5).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from pydantic import BaseModel, Field

from .examples import ParserId
from .jobs import FILENAME_PATTERN
from .quizzes import QuizOptionKey

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
    default_timeout_s: int = Field(ge=5)
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


__all__ = [
    "ID_PATTERN",
    "QUESTION_ID_PATTERN",
    "AdminRecommended",
    "AdminModuleBase",
    "AdminModuleCreate",
    "AdminModuleUpdate",
    "AdminLessonRef",
    "AdminModule",
    "AdminModulesResponse",
    "AdminReorderItem",
    "AdminReorderRequest",
    "AdminExampleBase",
    "AdminExampleUpdate",
    "AdminExample",
    "AdminExampleCodeRequest",
    "AdminExampleCodeResult",
    "AdminLessonBase",
    "AdminLessonCreate",
    "AdminLessonUpdate",
    "AdminLessonDetail",
    "AdminQuizOption",
    "AdminQuizQuestion",
    "AdminQuizUpsert",
    "AdminQuiz",
    "AdminDeleteResult",
]
