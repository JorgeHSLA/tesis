"""DTOs pydantic (v2) del contrato de API de E-HPC — §5 Quizzes.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
Provee ``QuizOptionKey``, reutilizado por §10 (admin).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Literal

from pydantic import BaseModel

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


__all__ = [
    "QuizOptionKey",
    "QuizOption",
    "QuizQuestion",
    "QuizResponse",
    "QuizAttemptRequest",
    "QuizQuestionResult",
    "QuizAttemptResult",
    "QuizAttemptSummary",
    "QuizAttemptsList",
]
