"""Routers de progreso (api-contract §6) — WP3.

- ``GET /api/v1/progress`` — mapa completo lección→progreso + summary (§6.1).
- ``PUT /api/v1/progress/lessons/{id}`` — marca ``viewed``/``completed``
  (§6.2). ``best_quiz_score`` y ``last_job_id`` NO son escribibles por este
  endpoint: cualquier valor extra del body se ignora (los gestiona el
  backend: quiz service y job runner respectivamente).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.repositories.content import ContentRepository
from app.routers.modules import (
    envelope_error,
    envelope_ok,
    get_content,
    get_progress_repo,
    quiz_total_for,
)
from app.schemas import (
    ProgressEntry,
    ProgressResponse,
    ProgressSummary,
    ProgressUpdateRequest,
)

router = APIRouter(prefix="/api/v1", tags=["progress"])


def _entry(record: Any, quiz_total: int) -> ProgressEntry:
    return ProgressEntry(
        viewed=bool(record.viewed),
        completed=bool(record.completed),
        best_quiz_score=record.best_quiz_score,
        quiz_total=quiz_total,
        last_job_id=record.last_job_id,
        updated_at=record.updated_at,
    )


def _modules_completed(
    content: ContentRepository, completed_ids: set[str]
) -> int:
    """Módulos con ≥1 lección habilitada y TODAS las habilitadas completadas."""
    count = 0
    for module in content.modules():
        enabled = [
            lid
            for lid in module.lesson_ids
            if (lesson := content.lesson(lid)) is not None and lesson.enabled
        ]
        if enabled and all(lid in completed_ids for lid in enabled):
            count += 1
    return count


@router.get("/progress")
async def get_progress(
    content: ContentRepository = Depends(get_content),
    progress_repo: Any = Depends(get_progress_repo),
) -> JSONResponse:
    """§6.1 — solo lecciones con registro; las demás se asumen en cero."""
    records = [
        r for r in await progress_repo.get_all() if content.exists_lesson(r.lesson_id)
    ]
    lessons = {
        r.lesson_id: _entry(r, quiz_total_for(content, r.lesson_id))
        for r in records
    }
    completed_ids = {r.lesson_id for r in records if r.completed}
    summary = ProgressSummary(
        lessons_completed=len(completed_ids),
        lessons_enabled=sum(1 for lesson in content.lessons() if lesson.enabled),
        modules_completed=_modules_completed(content, completed_ids),
        modules_total=len(content.modules()),
    )
    return envelope_ok(ProgressResponse(lessons=lessons, summary=summary))


@router.put("/progress/lessons/{lesson_id}")
async def put_lesson_progress(
    lesson_id: str,
    body: ProgressUpdateRequest,
    content: ContentRepository = Depends(get_content),
    progress_repo: Any = Depends(get_progress_repo),
) -> JSONResponse:
    """§6.2 — solo toca los campos enviados; responde el registro resultante."""
    if not content.exists_lesson(lesson_id):
        return envelope_error(
            404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}"
        )
    record = await progress_repo.upsert(
        lesson_id, viewed=body.viewed, completed=body.completed
    )
    return envelope_ok(_entry(record, quiz_total_for(content, lesson_id)))
