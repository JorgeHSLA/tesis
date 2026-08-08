"""DTOs pydantic (v2) del contrato de API de Telar — §6 Progreso.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from pydantic import BaseModel

# ────────────────────────────── §6 Progreso ─────────────────────────────────


class ProgressEntry(BaseModel):
    """§6.1 — entrada por lección (también respuesta de §6.2)."""

    viewed: bool
    completed: bool
    best_quiz_score: int | None
    quiz_total: int
    last_job_id: str | None
    updated_at: str


class ProgressSummary(BaseModel):
    lessons_completed: int
    lessons_enabled: int
    modules_completed: int
    modules_total: int


class ProgressResponse(BaseModel):
    """§6.1 ``GET /api/v1/progress`` — bloque ``data``."""

    lessons: dict[str, ProgressEntry]
    summary: ProgressSummary


class ProgressUpdateRequest(BaseModel):
    """§6.2 ``PUT /api/v1/progress/lessons/{lesson_id}`` — campos opcionales.

    ``best_quiz_score`` y ``last_job_id`` NO son escribibles por este endpoint.
    """

    viewed: bool | None = None
    completed: bool | None = None


__all__ = [
    "ProgressEntry",
    "ProgressSummary",
    "ProgressResponse",
    "ProgressUpdateRequest",
]
