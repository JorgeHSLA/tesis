"""DTOs pydantic (v2) del contrato de API de Telar — §1 Envelope.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
Módulo base del paquete ``app.schemas``: el resto de secciones dependen de
estos símbolos compartidos (``TypeVar T`` / envelope genérico).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel

# ────────────────────────────── §1 Envelope ─────────────────────────────────

#: §1.1 — catálogo de códigos de error.
#: Los códigos ADMIN (Fase 4, §10) se AÑADEN al final sin tocar los de Fase 3.
ApiErrorCode = Literal[
    "VALIDATION_ERROR",
    "JOB_NOT_FOUND",
    "EXAMPLE_NOT_FOUND",
    "LESSON_NOT_FOUND",
    "QUIZ_NOT_FOUND",
    "EXAMPLE_DISABLED",
    "JOB_NOT_CANCELLABLE",
    "JOB_NOT_FINISHED",
    "CODE_TOO_LARGE",
    "INVALID_EXTENSION",
    "INVALID_ENCODING",
    "TOO_MANY_JOBS",
    "INTERNAL_ERROR",
    "DOCKER_UNAVAILABLE",
    "RUNNER_IMAGE_MISSING",
    # ── Autoría (admin) — Fase 4, api-contract §10 ──
    "UNAUTHORIZED",             # 401 /admin/* con el modo admin apagado (sin EHPC_ADMIN_MODE)
    "MODULE_NOT_FOUND",         # 404 id de módulo inexistente
    "DUPLICATE_ID",             # 409 crear con un id ya usado (módulo o lección/ejemplo)
    "ORDER_CONFLICT",           # 409 order de módulo o de lección colisiona
    "MODULE_NOT_EMPTY",         # 409 borrar un módulo con lecciones
    "CONTENT_VALIDATION_ERROR", # 422 reglas de negocio (refs, markdown, correct_key, threads/GPU…)
]

T = TypeVar("T")


class ApiError(BaseModel):
    """Bloque ``error`` del envelope."""

    code: str
    message: str
    details: Any | None = None  # objeto libre (p. ej. lista 422 de FastAPI)


class ApiMeta(BaseModel):
    """Bloque ``meta`` — solo en listados paginados."""

    total: int
    limit: int
    offset: int


class Envelope(BaseModel, Generic[T]):
    """Envelope común: ``{"success", "data", "error", "meta"}``."""

    success: bool
    data: T | None = None
    error: ApiError | None = None
    meta: ApiMeta | None = None


__all__ = [
    "ApiErrorCode",
    "T",
    "ApiError",
    "ApiMeta",
    "Envelope",
]
