"""Routers de quizzes (api-contract §5) — WP3.

- ``GET /api/v1/lessons/{id}/quiz`` — preguntas SIN ``correct_key`` ni
  ``explanation`` (§5.1): la clave correcta jamás sale antes del intento.
- ``POST /api/v1/lessons/{id}/quiz/attempts`` — corrección server-side +
  persistencia atómica intento→progreso (§5.2), 201.
- ``GET /api/v1/lessons/{id}/quiz/attempts`` — historial (§5.3, post-MVP;
  trivial porque el repositorio ya lo expone).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.repositories.content import ContentRepository
from app.routers.modules import (
    envelope_error,
    envelope_ok,
    get_attempts_repo,
    get_content,
    get_quiz_service,
)
from app.schemas import (
    QuizAttemptRequest,
    QuizAttemptsList,
    QuizAttemptSummary,
)
from app.services.quiz_service import (
    LessonNotFoundError,
    QuizNotFoundError,
    QuizService,
    QuizValidationError,
)

router = APIRouter(prefix="/api/v1", tags=["quizzes"])


def _not_found(exc: LookupError, lesson_id: str) -> JSONResponse:
    if isinstance(exc, QuizNotFoundError):
        return envelope_error(
            404, "QUIZ_NOT_FOUND", f"La lección {lesson_id} no tiene quiz"
        )
    return envelope_error(
        404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}"
    )


@router.get("/lessons/{lesson_id}/quiz")
async def get_quiz(
    lesson_id: str,
    service: QuizService = Depends(get_quiz_service),
) -> JSONResponse:
    """§5.1 — preguntas sin respuestas correctas ni explicaciones."""
    try:
        return envelope_ok(service.get_quiz(lesson_id))
    except (LessonNotFoundError, QuizNotFoundError) as exc:
        return _not_found(exc, lesson_id)


@router.post("/lessons/{lesson_id}/quiz/attempts")
async def submit_attempt(
    lesson_id: str,
    body: QuizAttemptRequest,
    service: QuizService = Depends(get_quiz_service),
) -> JSONResponse:
    """§5.2 — corrige en el servidor y persiste intento+progreso (201)."""
    try:
        result = await service.submit_attempt(lesson_id, body.answers)
    except (LessonNotFoundError, QuizNotFoundError) as exc:
        return _not_found(exc, lesson_id)
    except QuizValidationError as exc:
        return envelope_error(
            422,
            "VALIDATION_ERROR",
            "Respuestas inválidas: deben venir todas las preguntas del quiz",
            details=exc.details,
        )
    return envelope_ok(result, status_code=201)


@router.get("/lessons/{lesson_id}/quiz/attempts")
async def list_attempts(
    lesson_id: str,
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    content: ContentRepository = Depends(get_content),
    attempts_repo: Any = Depends(get_attempts_repo),
) -> JSONResponse:
    """§5.3 — historial de intentos (opcional post-MVP, shape congelado)."""
    if not content.exists_lesson(lesson_id):
        return envelope_error(
            404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}"
        )
    attempts, total = await attempts_repo.list_by_lesson(
        lesson_id, limit=limit, offset=offset
    )
    data = QuizAttemptsList(
        attempts=[
            QuizAttemptSummary(
                attempt_id=a.id,
                score=a.score,
                total=a.total,
                passed=bool(a.passed),
                created_at=a.created_at,
            )
            for a in attempts
        ]
    )
    return envelope_ok(
        data, meta={"total": total, "limit": limit, "offset": offset}
    )
