"""Router ``GET /api/v1/lessons/{lesson_id}`` (api-contract §4.2) — WP3.

Lección completa: markdown, prev/next (ruta lineal por ``order`` global),
``recommended`` estático del catálogo y progreso fusionado desde SQLite.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.repositories import workshop as workshop_repo
from app.repositories.content import ContentRepository
from app.routers.modules import (
    envelope_error,
    envelope_ok,
    get_content,
    get_progress_repo,
    merge_progress,
)
from app.schemas import LessonDetail, RecommendedLesson, WorkshopStepView

router = APIRouter(prefix="/api/v1", tags=["lessons"])


@router.get("/lessons/{lesson_id}")
async def get_lesson(
    request: Request,
    lesson_id: str,
    content: ContentRepository = Depends(get_content),
    progress_repo: Any = Depends(get_progress_repo),
) -> JSONResponse:
    """§4.2 — lección con markdown; 404 LESSON_NOT_FOUND si no existe."""
    lesson = content.lesson(lesson_id)
    if lesson is None:
        return envelope_error(
            404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}"
        )
    record = await progress_repo.get(lesson_id)
    # S6 (§12): el estado de cada casilla viaja con su paso; al volver, la vista
    # abre el primer paso sin marcar.
    marcas = (
        await workshop_repo.select_marks(request.app.state.db, lesson_id)
        if lesson.is_taller
        else set()
    )
    detail = LessonDetail(
        id=lesson.id,
        module_id=lesson.module_id,
        order=lesson.order,
        title=lesson.title,
        content_markdown=lesson.content_markdown,
        video_url=lesson.video_url,
        example_id=lesson.example_id,
        has_quiz=lesson.has_quiz,
        quiz_question_count=lesson.quiz_question_count,
        estimated_minutes=lesson.estimated_minutes,
        enabled=lesson.enabled,
        completion_rule=lesson.completion_rule,
        archived=lesson.archived,
        prev_lesson_id=lesson.prev_lesson_id,
        next_lesson_id=lesson.next_lesson_id,
        recommended=[
            RecommendedLesson(lesson_id=r.lesson_id, label=r.label, tag=r.tag)
            for r in lesson.recommended
        ],
        progress=merge_progress(record, lesson.quiz_question_count),
        kind=lesson.kind,
        steps=[
            WorkshopStepView(
                idx=step.idx,
                title=step.title,
                body_markdown=step.body_markdown,
                example_id=step.example_id,
                done=step.idx in marcas,
            )
            for step in lesson.steps
        ],
    )
    return envelope_ok(detail)
