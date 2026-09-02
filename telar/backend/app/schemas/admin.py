"""DTOs pydantic (v2) del contrato de API de Telar — §10 Autoría (admin), Fase 4.

TRANSCRIPCIÓN de api-contract.md §10 (CONGELADO). ADITIVO: no toca nada de
Fase 3. Reutiliza ``ParserId`` (§3), ``FILENAME_PATTERN`` (§7) y
``QuizOptionKey`` (§5).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Literal

from pydantic import BaseModel, Field

from .examples import ParserId
from .jobs import FILENAME_PATTERN
from .quizzes import QuizOptionKey

# ═══════════════════ §10 Autoría de cursos (admin) — Fase 4 ══════════════════
# TRANSCRIPCIÓN de api-contract.md §10 (CONGELADO). ADITIVO: no toca nada de
# Fase 3. Namespace REST /api/v1/admin; el modo admin es una variante de
# despliegue gateada por TELAR_ADMIN_MODE (sin login/token).
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
    order: int = Field(ge=1, le=10_000)
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
    """Un id de módulo/lección y su nuevo ``order`` (≥1).

    Fase 5 (E2): el ``order`` de lección es único **por módulo**, así que el
    item puede traer ``module_id``. Es OPCIONAL a propósito: si falta, el
    servidor lo resuelve contra el módulo actual de la lección, y así los
    payloads de Fase 4 —que no lo llevaban— siguen siendo válidos. Enviarlo
    mueve además la lección a ese módulo. Para módulos se ignora:
    ``modules."order"`` sigue siendo único global.
    """

    id: str
    order: int = Field(ge=1, le=10_000)
    module_id: str | None = None


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
    # `le=` no es cosmético: sin tope, un valor de 2**63 revienta el INSERT de
    # SQLite (enteros de 64 bits) y sale por un 500 en vez de un 422.
    default_timeout_s: int = Field(ge=5, le=86_400)
    est_run_seconds: int = Field(ge=1, le=86_400)
    enabled: bool
    requires_gpu: bool
    expected_output_note: str
    takeaways: list[str] = Field(min_length=1)


class AdminExampleUpdate(AdminExampleBase):
    """§10.4 ``PUT /admin/examples/{id}`` — metadatos (sin código)."""


class AdminExample(AdminExampleBase):
    """§10.4 ``GET /admin/examples/{id}`` — con ``source_code`` y derivados."""

    id: str
    #: Fase 5 (E1): id propio del ejemplo y relación por columna. ``None`` en un
    #: ejemplo todavía sin lección asignada.
    lesson_id: str | None
    #: Derivados del JOIN con la lección; ``None`` si el ejemplo está suelto.
    module_id: str | None
    order: int | None
    source_code: str


class AdminExampleCodeRequest(BaseModel):
    """§10.4 ``POST /admin/examples/{id}/code`` — variante JSON (alt: multipart)."""

    filename: str = Field(pattern=FILENAME_PATTERN)
    # BL-17: el tope de bytes se aplica en RUNTIME (settings.max_code_bytes) en
    # content_writer, no como cap estático — así JSON y multipart honran el
    # mismo límite configurable (subir o bajar TELAR_MAX_CODE_BYTES).
    source_code: str = Field(min_length=1)


class AdminExampleCodeResult(BaseModel):
    """§10.4 — respuesta 200 tras subir el ``.py`` del ejemplo."""

    example_id: str
    filename: str
    bytes: int


# ── §10.5 Lecciones (unidad = lección + ejemplo pareado + quiz) ──────────────


class AdminLessonBase(BaseModel):
    module_id: str
    order: int = Field(ge=1, le=10_000)
    title: str = Field(min_length=1, max_length=160)
    estimated_minutes: int = Field(ge=1, le=600)
    content_markdown: str = Field(min_length=1, max_length=65536)
    #: Fase 5: URL de YouTube no listado de esta lección. Se valida y NORMALIZA
    #: al escribir (se conserva el id del video, se descarta el resto).
    video_url: str | None = Field(default=None, max_length=2048)
    #: Fase 5 (E4): columna propia de la lección. Antes se derivaba del ejemplo,
    #: y una lección sin ejemplo habría nacido deshabilitada en silencio.
    enabled: bool = True
    #: Fase 5 (E4): qué cuenta como completarla.
    completion_rule: Literal["quiz", "viewed", "run"] = "quiz"
    recommended: list[AdminRecommended] = Field(default_factory=list, max_length=6)


class AdminLessonCreate(AdminLessonBase):
    """§10.3 ``POST /admin/lessons`` — lección, con ejemplo OPCIONAL.

    Fase 5 (E1): omitir ``example``/``source_code`` crea una **lección
    conceptual**, que es justo lo que el acoplamiento 1:1 hacía irrepresentable.
    Enviarlos sigue creando lección + ejemplo en una sola transacción.
    """

    id: str = Field(pattern=ID_PATTERN)
    example: AdminExampleBase | None = None
    # BL-17: tope en runtime (settings.max_code_bytes), no cap estático.
    source_code: str | None = Field(default=None, min_length=1)


class AdminLessonExampleCreate(BaseModel):
    """§10.3 ``POST /admin/lessons/{id}/example`` — dar código a una lección.

    E1: una lección conceptual puede volverse práctica sin recrearla, que es lo
    que antes obligaba a borrarla —y con ella, el progreso del estudiante—.
    """

    example: AdminExampleBase
    source_code: str = Field(min_length=1)


class AdminLessonUpdate(AdminLessonBase):
    """§10.5 ``PUT /admin/lessons/{id}`` — faceta lección + markdown."""


class AdminLessonDetail(AdminLessonBase):
    """§10.5 ``GET /admin/lessons/{id}`` — lección + ejemplo + derivados."""

    id: str
    has_quiz: bool
    quiz_question_count: int
    #: Fase 5: retirada por una versión posterior de su módulo.
    archived: bool = False
    prev_lesson_id: str | None
    next_lesson_id: str | None
    #: Fase 5 (E1): ``None`` en una lección conceptual. El GET responde **200**,
    #: no 404: la lección existe aunque no tenga código.
    example: AdminExample | None


# ── §10.6 Quiz (GET admin SÍ trae correct_key/explanation) ───────────────────


class AdminQuizOption(BaseModel):
    key: QuizOptionKey
    text: str = Field(min_length=1)


class AdminQuizQuestion(BaseModel):
    # §10.5/BL-18: id opcional; si falta, el servidor autogenera
    # ``{lesson_id}-q{order}`` (content_writer). Con valor, cumple el patrón.
    id: str | None = Field(default=None, pattern=QUESTION_ID_PATTERN)
    order: int = Field(ge=1, le=10_000)
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
