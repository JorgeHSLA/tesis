"""DTOs pydantic (v2) del contrato de API de Telar — §4 Cursos: módulos y lecciones.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from pydantic import BaseModel

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
    #: Fase 5 (E1): ``None`` en una lección conceptual. Sin ejemplo NO hay
    #: affordance de ejecución, que no es lo mismo que un botón deshabilitado.
    example_id: str | None
    has_quiz: bool
    #: Fase 5: si la lección tiene video, sin exponer la URL en el listado.
    has_video: bool
    quiz_question_count: int
    estimated_minutes: int
    enabled: bool
    #: Fase 5 (E4): qué cuenta como completar esta lección.
    completion_rule: str
    progress: LessonProgress


class Module(BaseModel):
    id: str
    order: int
    title: str
    description: str
    level: str
    #: Fase 5: versión publicable del módulo (entero monótono).
    version: int
    #: Fase 5: ``"local"`` | ``"remote"`` — de dónde salió este módulo.
    origin: str
    #: Fase 5: versión disponible en el bucket si es mayor que la instalada;
    #: ``None`` si está al día o no vino del catálogo remoto.
    update_available: int | None
    lessons: list[ModuleLesson]


class ModulesSummary(BaseModel):
    lessons_total: int
    lessons_enabled: int
    lessons_completed: int
    quizzes_total: int
    questions_enabled_total: int
    #: Fase 5: cuántos módulos hay instalados y cuántos tienen versión nueva.
    modules_installed: int
    modules_updatable: int


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
    #: Fase 5: URL del video de ESTA lección en YouTube no listado, ya
    #: normalizada por el servidor. ``None`` ⇒ el reproductor no se monta.
    video_url: str | None
    #: Fase 5 (E1): ``None`` en una lección conceptual.
    example_id: str | None
    has_quiz: bool
    quiz_question_count: int
    estimated_minutes: int
    enabled: bool
    #: Fase 5 (E4).
    completion_rule: str
    #: Fase 5: retirada de una versión posterior de su módulo. Legible y con su
    #: progreso intacto, pero fuera de la ruta lineal.
    archived: bool
    prev_lesson_id: str | None
    next_lesson_id: str | None
    recommended: list[RecommendedLesson]
    progress: LessonProgress


__all__ = [
    "LessonProgress",
    "ModuleLesson",
    "Module",
    "ModulesSummary",
    "ModulesResponse",
    "RecommendedLesson",
    "LessonDetail",
]
