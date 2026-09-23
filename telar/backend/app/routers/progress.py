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

from app.repositories.content import ContentRepository, cuenta_para_progreso
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
        completed_via=record.completed_via,
    )


def _modules_completed(
    content: ContentRepository, completed_ids: set[str]
) -> int:
    """Módulos con ≥1 lección que cuenta y TODAS las que cuentan completadas."""
    count = 0
    for module in content.modules():
        enabled = [
            lid
            for lid in module.lesson_ids
            if (lesson := content.lesson(lid)) is not None
            and cuenta_para_progreso(lesson)
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
    # BL-38: la métrica solo cuenta lecciones HABILITADAS (espeja /modules);
    # _modules_completed ya intersecta con las habilitadas por módulo.
    completed_enabled = {
        lid
        for lid in completed_ids
        if (lesson := content.lesson(lid)) is not None and cuenta_para_progreso(lesson)
    }
    summary = ProgressSummary(
        lessons_completed=len(completed_enabled),
        lessons_enabled=sum(
            1 for lesson in content.lessons() if cuenta_para_progreso(lesson)
        ),
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
    """§6.2 — solo toca los campos enviados; responde el registro resultante.

    E4: quién puede escribir ``completed`` lo decide la ``completion_rule`` de
    la lección. Con ``"quiz"`` (el caso por defecto) lo completa aprobar el
    quiz, y un ``completed:true`` del cliente **se ignora**; con ``"run"`` lo
    concede el job al terminar bien. Solo ``"viewed"`` deja que el estudiante lo
    marque, y entonces queda registrado como ``completed_via="manual"``.

    Se ignora en vez de responder 422 por coherencia con la regla que este mismo
    endpoint ya tenía: los campos que el cliente no gobierna
    (``best_quiz_score``, ``last_job_id``) se descartan en silencio y la
    respuesta dice la verdad. Un 422 aquí además sería un error que el
    estudiante no puede accionar.
    """
    lesson = content.lesson(lesson_id)
    if lesson is None:
        return envelope_error(
            404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}"
        )
    completed = body.completed
    completed_via = None
    if completed is not None and lesson.completion_rule != "viewed":
        completed = None   # no es el cliente quien completa esta lección
    elif completed:
        completed_via = "manual"
    record = await progress_repo.upsert(
        lesson_id,
        viewed=body.viewed,
        completed=completed,
        completed_via=completed_via,
    )
    return envelope_ok(_entry(record, quiz_total_for(content, lesson_id)))
