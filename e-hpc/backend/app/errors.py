"""Envelope y manejo de errores → api-contract §1 y §1.1 (CONGELADO).

Expone:
- ``success_envelope`` / ``error_envelope``: shape único de respuesta.
- ``ApiException``: excepción de dominio con código del catálogo §1.1.
- ``register_error_handlers``: instala los handlers que re-formatean TODO
  error al envelope (422 de pydantic → ``VALIDATION_ERROR``; excepción no
  controlada → ``INTERNAL_ERROR`` genérico, detalle solo en logs del
  servidor).
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("ehpc.errors")

#: HTTP por defecto de cada código del catálogo §1.1. Un router puede forzar
#: otro status en casos documentados (p. ej. VALIDATION_ERROR con 400 cuando
#: el body es JSON válido pero no trae ni ``code`` ni ``example_id``).
DEFAULT_STATUS: dict[str, int] = {
    "VALIDATION_ERROR": 422,
    "JOB_NOT_FOUND": 404,
    "EXAMPLE_NOT_FOUND": 404,
    "LESSON_NOT_FOUND": 404,
    "QUIZ_NOT_FOUND": 404,
    "EXAMPLE_DISABLED": 409,
    "JOB_NOT_CANCELLABLE": 409,
    "JOB_NOT_FINISHED": 409,
    "CODE_TOO_LARGE": 413,
    "INVALID_EXTENSION": 415,
    "INVALID_ENCODING": 422,
    "TOO_MANY_JOBS": 429,
    "INTERNAL_ERROR": 500,
    "DOCKER_UNAVAILABLE": 503,
    "RUNNER_IMAGE_MISSING": 503,
    # ── Autoría (admin) — Fase 4, api-contract §10 ──
    "UNAUTHORIZED": 401,
    "MODULE_NOT_FOUND": 404,
    "DUPLICATE_ID": 409,
    "ORDER_CONFLICT": 409,
    "MODULE_NOT_EMPTY": 409,
    "CONTENT_VALIDATION_ERROR": 422,
}

#: Fallback para HTTPException crudas (rutas inexistentes, 405...): códigos
#: fuera del catálogo §1.1 pero con el shape del envelope intacto.
_HTTP_FALLBACK_CODE: dict[int, str] = {
    400: "VALIDATION_ERROR",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    422: "VALIDATION_ERROR",
}


def success_envelope(data: Any, meta: dict[str, int] | None = None) -> dict:
    """Envelope de éxito: ``{"success": true, "data", "error": null, "meta"}``."""
    return {"success": True, "data": data, "error": None, "meta": meta}


def error_envelope(code: str, message: str, details: Any = None) -> dict:
    """Envelope de error: ``data`` null y bloque ``error`` poblado."""
    return {
        "success": False,
        "data": None,
        "error": {"code": code, "message": message, "details": details},
        "meta": None,
    }


class ApiException(Exception):
    """Error de dominio con código del catálogo §1.1.

    ``status_code`` sale de ``DEFAULT_STATUS`` salvo override explícito.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code or DEFAULT_STATUS.get(code, 500)
        self.details = details


def register_error_handlers(app: FastAPI) -> None:
    """Instala los handlers que garantizan el envelope en TODA respuesta de error."""

    @app.exception_handler(ApiException)
    async def _api_exception(request: Request, exc: ApiException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_envelope(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_envelope(
                "VALIDATION_ERROR",
                "El cuerpo o los parámetros de la petición no son válidos.",
                details=jsonable_encoder(exc.errors()),
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        if detail in DEFAULT_STATUS:  # un router lanzó HTTPException con código
            code = detail
            message = "Error de la API."
        else:
            code = _HTTP_FALLBACK_CODE.get(
                exc.status_code, "INTERNAL_ERROR" if exc.status_code >= 500 else "HTTP_ERROR"
            )
            message = detail
        return JSONResponse(
            status_code=exc.status_code, content=error_envelope(code, message)
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Detalle SOLO en logs del servidor; mensaje genérico hacia el cliente.
        logger.exception("Excepción no controlada en %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content=error_envelope("INTERNAL_ERROR", "Error interno del servidor."),
        )
