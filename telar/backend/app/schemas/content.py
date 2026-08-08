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


__all__ = [
    "LessonProgress",
    "ModuleLesson",
    "Module",
    "ModulesSummary",
    "ModulesResponse",
    "RecommendedLesson",
    "LessonDetail",
]
