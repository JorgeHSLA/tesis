"""Router ``GET /api/v1/modules`` + utilidades compartidas de WP3.

Este módulo aloja, además del endpoint de módulos (api-contract §4.1), los
helpers comunes a los routers de contenido de WP3 (examples, lessons,
quizzes, progress): envelope de respuesta, providers de dependencias
(leen ``app.state``; WP9 puede sobreescribirlos con dependency overrides)
y la fusión de progreso fixtures+SQLite.

Atributos esperados en ``app.state`` (los puebla el lifespan de WP1):
``content`` (ContentRepository), ``progress`` (ProgressRepository),
``quiz_attempts`` (QuizAttemptRepository), ``db`` (aiosqlite.Connection)
y ``write_lock`` (asyncio.Lock; si falta, se usa ``app.db.write_lock``).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.repositories.content import ContentRepository
from app.schemas import (
    LessonProgress,
    Module,
    ModuleLesson,
    ModulesResponse,
    ModulesSummary,
)
from app.services.quiz_service import QuizService

# ─────────────────────────── Envelope (§1) ──────────────────────────────────


def envelope_ok(
    data: Any, *, status_code: int = 200, meta: dict[str, int] | None = None
) -> JSONResponse:
    """Respuesta de éxito con el envelope congelado de api-contract §1."""
    payload = data.model_dump(mode="json") if hasattr(data, "model_dump") else data
    return JSONResponse(
        status_code=status_code,
        content={"success": True, "data": payload, "error": None, "meta": meta},
    )


def envelope_error(
    status_code: int, code: str, message: str, details: Any | None = None
) -> JSONResponse:
    """Respuesta de error con el envelope congelado de api-contract §1."""
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": {"code": code, "message": message, "details": details},
            "meta": None,
        },
    )


# ─────────────────── Providers de dependencias (app.state) ──────────────────


def _state_attr(request: Request, name: str) -> Any:
    value = getattr(request.app.state, name, None)
    if value is None:
        raise RuntimeError(
            f"app.state.{name} no está inicializado (lifespan de WP1)"
        )
    return value


def get_content(request: Request) -> ContentRepository:
    """ContentRepository cargado en el lifespan."""
    return _state_attr(request, "content")


def get_progress_repo(request: Request) -> Any:
    """ProgressRepository (firma congelada, data-model §5)."""
    return _state_attr(request, "progress")


def get_attempts_repo(request: Request) -> Any:
    """QuizAttemptRepository (firma congelada, data-model §5)."""
    return _state_attr(request, "quiz_attempts")


def get_write_lock(request: Request) -> Any:
    """Lock de escritura: ``app.state.write_lock`` o ``app.db.write_lock``."""
    lock = getattr(request.app.state, "write_lock", None)
    if lock is None:
        from app import db as db_module  # WP1; solo si el state no lo trae

        lock = db_module.write_lock
    return lock


def get_quiz_service(request: Request) -> QuizService:
    """QuizService armado desde app.state (una instancia ligera por request)."""
    return QuizService(
        content=get_content(request),
        attempts=get_attempts_repo(request),
        progress=get_progress_repo(request),
        write_lock=get_write_lock(request),
        db=getattr(request.app.state, "db", None),
    )


# ─────────────────────── Fusión de progreso (§4/§6) ─────────────────────────


def merge_progress(record: Any | None, quiz_total: int) -> LessonProgress:
    """LessonProgressRecord|None + total del quiz → bloque ``progress``."""
    if record is None:
        return LessonProgress(
            viewed=False, completed=False, best_quiz_score=None, quiz_total=quiz_total
        )
    return LessonProgress(
        viewed=bool(record.viewed),
        completed=bool(record.completed),
        best_quiz_score=record.best_quiz_score,
        quiz_total=quiz_total,
    )


def quiz_total_for(content: ContentRepository, lesson_id: str) -> int:
    """Número de preguntas del quiz de la lección (0 si no tiene)."""
    quiz = content.quiz(lesson_id)
    return len(quiz.questions) if quiz else 0


# ──────────────────────── GET /api/v1/modules (§4.1) ────────────────────────

router = APIRouter(prefix="/api/v1", tags=["modules"])


@router.get("/modules")
async def get_modules(
    content: ContentRepository = Depends(get_content),
    progress_repo: Any = Depends(get_progress_repo),
) -> JSONResponse:
    """Catálogo completo: módulos + lecciones + progreso fusionado + summary."""
    records = {r.lesson_id: r for r in await progress_repo.get_all()}
    modules = [
        _module_payload(content, module, records) for module in content.modules()
    ]
    lessons = content.lessons()
    summary = ModulesSummary(
        lessons_total=len(lessons),
        lessons_enabled=sum(1 for lesson in lessons if lesson.enabled),
        lessons_completed=sum(
            1
            for record in records.values()
            if record.completed and content.exists_lesson(record.lesson_id)
        ),
        quizzes_total=sum(1 for lesson in lessons if lesson.has_quiz),
        questions_enabled_total=sum(
            quiz_total_for(content, lesson.id) for lesson in lessons if lesson.enabled
        ),
    )
    return envelope_ok(ModulesResponse(modules=modules, summary=summary))


def _module_payload(
    content: ContentRepository, module: Any, records: dict[str, Any]
) -> Module:
    lessons = []
    for lesson_id in module.lesson_ids:
        lesson = content.lesson(lesson_id)
        if lesson is None:  # imposible tras la validación fail-fast
            continue
        quiz_total = quiz_total_for(content, lesson_id)
        lessons.append(
            ModuleLesson(
                id=lesson.id,
                order=lesson.order,
                title=lesson.title,
                example_id=lesson.example_id,
                has_quiz=lesson.has_quiz,
                quiz_question_count=lesson.quiz_question_count,
                estimated_minutes=lesson.estimated_minutes,
                enabled=lesson.enabled,
                progress=merge_progress(records.get(lesson_id), quiz_total),
            )
        )
    lessons.sort(key=lambda lesson: lesson.order)
    return Module(
        id=module.id,
        order=module.order,
        title=module.title,
        description=module.description,
        level=module.level,
        lessons=lessons,
    )
