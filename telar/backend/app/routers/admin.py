"""Router de contenido admin — api-contract §10.2-§10.6 (Fase 4, CONGELADO).

CRUD de módulos / lecciones (+ ejemplo pareado) / quiz / ejemplos, más la subida
del ``.py`` de un ejemplo. Prefijo ``/api/v1/admin`` y guard único a nivel de
router (``dependencies=[Depends(require_admin)]``): con el modo admin apagado
(``TELAR_ADMIN_MODE`` ausente, despliegue "estudiante") ⇒ ``401 UNAUTHORIZED``
para todos.

La validación de esquema (pydantic) la reformatea el handler global a
``422 VALIDATION_ERROR``; las reglas de negocio (§10.6) y la persistencia atómica
+ reload viven en ``services/content_writer``. Respuestas con el envelope §1 y los
DTOs ``Admin*`` de ``schemas.py``. No hay endpoint ``test-run`` (§10.4).
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.errors import sanitize_validation_errors
from app.repositories import content_admin
from app.routers.admin_deps import require_admin
from app.routers.modules import envelope_error, envelope_ok
from app.schemas import (
    FILENAME_PATTERN,
    AdminDeleteResult,
    AdminExampleCodeRequest,
    AdminExampleCodeResult,
    AdminExampleUpdate,
    AdminLessonCreate,
    AdminLessonExampleCreate,
    AdminLessonUpdate,
    AdminModuleCreate,
    AdminModuleUpdate,
    AdminModulesResponse,
    AdminQuizUpsert,
    AdminReorderRequest,
)
from app.services import content_writer

router = APIRouter(
    prefix="/api/v1/admin",
    tags=["admin-content"],
    dependencies=[Depends(require_admin)],
)

_FILENAME_RE = re.compile(FILENAME_PATTERN)
_UPLOAD_CHUNK = 64 * 1024


def _db(request: Request) -> Any:
    return request.app.state.db


def _parse_json_body(
    model_cls: Any, payload: Any
) -> tuple[Any, JSONResponse | None]:
    """Valida ``payload`` contra ``model_cls`` → ``422 VALIDATION_ERROR``.

    El tope de bytes del código NO es un cap estático de pydantic (BL-17): se
    valida en runtime contra ``settings.max_code_bytes`` en ``content_writer``
    (``413 CODE_TOO_LARGE``), por igual en JSON y multipart.
    """
    try:
        return model_cls.model_validate(payload), None
    except ValidationError as exc:
        # BL-22: nunca reflejar el valor rechazado (código fuente, filename…)
        # en los detalles de un 422.
        return None, envelope_error(
            422, "VALIDATION_ERROR", "El cuerpo de la petición no es válido.",
            details=sanitize_validation_errors(exc.errors(include_url=False)),
        )


# ──────────────────────────────── módulos ───────────────────────────────────


@router.get("/modules")
async def list_modules(request: Request) -> JSONResponse:
    """§10.2 ``GET /admin/modules`` — módulos con detalle admin."""
    # CW-04/BL-19: lee bajo el lock de lectura DEDICADO (no el write_lock
    # transversal) para no observar una mutación admin a medias sin acoplar la
    # latencia con finish()/quiz/progress.
    async with request.app.state.content_read_lock:
        modules = await content_admin.select_admin_modules(_db(request))
    return envelope_ok(AdminModulesResponse(modules=modules))


@router.post("/modules")
async def create_module(request: Request, body: AdminModuleCreate) -> JSONResponse:
    """§10.2 ``POST /admin/modules`` — crea un módulo."""
    result = await content_writer.create_module(request.app, body)
    return envelope_ok(result, status_code=201)


# Registrado ANTES de ``/modules/{module_id}`` para que no lo capture el path
# param (``reorder`` no es un id de módulo).
@router.put("/modules/reorder")
async def reorder_modules(
    request: Request, body: AdminReorderRequest
) -> JSONResponse:
    """§10.2 ``PUT /admin/modules/reorder`` — reordena módulos por lote (BL-20)."""
    result = await content_writer.reorder_modules(request.app, body.items)
    return envelope_ok(result)


@router.put("/modules/{module_id}")
async def update_module(
    request: Request, module_id: str, body: AdminModuleUpdate
) -> JSONResponse:
    """§10.2 ``PUT /admin/modules/{id}`` — reemplazo total de editables."""
    result = await content_writer.update_module(request.app, module_id, body)
    return envelope_ok(result)


@router.delete("/modules/{module_id}")
async def delete_module(request: Request, module_id: str) -> JSONResponse:
    """§10.2 ``DELETE /admin/modules/{id}`` — solo si está vacío."""
    await content_writer.delete_module(request.app, module_id)
    return envelope_ok(AdminDeleteResult(deleted=True, id=module_id))


# ─────────────────────────────── lecciones ──────────────────────────────────


@router.get("/lessons/{lesson_id}")
async def get_lesson(request: Request, lesson_id: str) -> JSONResponse:
    """§10.3 ``GET /admin/lessons/{id}`` — lección + ejemplo pareado."""
    async with request.app.state.content_read_lock:  # CW-04/BL-19: lock de lectura dedicado
        detail = await content_admin.select_admin_lesson_detail(_db(request), lesson_id)
    if detail is None:
        return envelope_error(
            404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
        )
    return envelope_ok(detail)


@router.post("/lessons")
async def create_lesson(request: Request) -> JSONResponse:
    """§10.3 ``POST /admin/lessons`` — crea lección + ejemplo pareado."""
    try:
        payload = await request.json()
    except Exception:
        return envelope_error(422, "VALIDATION_ERROR", "El body debe ser JSON válido.")
    body, error = _parse_json_body(AdminLessonCreate, payload)
    if error is not None:
        return error
    result = await content_writer.create_lesson(request.app, body)
    return envelope_ok(result, status_code=201)


# Registrado ANTES de ``/lessons/{lesson_id}`` (mismo motivo que módulos).
@router.put("/lessons/reorder")
async def reorder_lessons(
    request: Request, body: AdminReorderRequest
) -> JSONResponse:
    """§10.3 ``PUT /admin/lessons/reorder`` — reordena lecciones por lote (BL-20)."""
    result = await content_writer.reorder_lessons(request.app, body.items)
    return envelope_ok(result)


@router.put("/lessons/{lesson_id}")
async def update_lesson(
    request: Request, lesson_id: str, body: AdminLessonUpdate
) -> JSONResponse:
    """§10.3 ``PUT /admin/lessons/{id}`` — faceta lección + markdown."""
    result = await content_writer.update_lesson(request.app, lesson_id, body)
    return envelope_ok(result)


@router.delete("/lessons/{lesson_id}")
async def delete_lesson(request: Request, lesson_id: str) -> JSONResponse:
    """§10.3 ``DELETE /admin/lessons/{id}`` — borra lección + ejemplo + quiz."""
    await content_writer.delete_lesson(request.app, lesson_id)
    return envelope_ok(AdminDeleteResult(deleted=True, id=lesson_id))


@router.post("/lessons/{lesson_id}/example")
async def add_lesson_example(
    request: Request, lesson_id: str, body: AdminLessonExampleCreate
) -> JSONResponse:
    """§10.3 ``POST /admin/lessons/{id}/example`` — dar código a una lección."""
    example = await content_writer.add_example_to_lesson(request.app, lesson_id, body)
    return envelope_ok(example)


@router.delete("/lessons/{lesson_id}/example")
async def delete_lesson_example(request: Request, lesson_id: str) -> JSONResponse:
    """§10.3 ``DELETE /admin/lessons/{id}/example`` — la lección pasa a teórica.

    No toca la lección, ni su quiz, ni el progreso del estudiante.
    """
    await content_writer.remove_example_from_lesson(request.app, lesson_id)
    return envelope_ok({"deleted": True, "lesson_id": lesson_id})


# ────────────────────────────────── quiz ────────────────────────────────────


@router.get("/lessons/{lesson_id}/quiz")
async def get_quiz(request: Request, lesson_id: str) -> JSONResponse:
    """§10.5 ``GET /admin/lessons/{id}/quiz`` — CON clave correcta (solo admin)."""
    db = _db(request)
    async with request.app.state.content_read_lock:  # CW-04/BL-19: lock de lectura dedicado
        exists = await content_admin.lesson_exists(db, lesson_id)
        quiz = await content_admin.select_admin_quiz(db, lesson_id) if exists else None
    if not exists:
        return envelope_error(
            404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
        )
    if quiz is None:
        return envelope_error(
            404, "QUIZ_NOT_FOUND", f"La lección {lesson_id} no tiene quiz."
        )
    return envelope_ok(quiz)


@router.put("/lessons/{lesson_id}/quiz")
async def put_quiz(
    request: Request, lesson_id: str, body: AdminQuizUpsert
) -> JSONResponse:
    """§10.5 ``PUT /admin/lessons/{id}/quiz`` — reemplazo total del set."""
    result = await content_writer.replace_quiz(request.app, lesson_id, body)
    return envelope_ok(result)


@router.delete("/lessons/{lesson_id}/quiz")
async def delete_quiz(request: Request, lesson_id: str) -> JSONResponse:
    """§10.5 ``DELETE /admin/lessons/{id}/quiz`` — borra el quiz."""
    await content_writer.delete_quiz(request.app, lesson_id)
    return envelope_ok(AdminDeleteResult(deleted=True, id=lesson_id))


# ──────────────────────────────── ejemplos ──────────────────────────────────


@router.get("/examples/{example_id}")
async def get_example(request: Request, example_id: str) -> JSONResponse:
    """§10.4 ``GET /admin/examples/{id}`` — ejemplo con código."""
    async with request.app.state.content_read_lock:  # CW-04/BL-19: lock de lectura dedicado
        example = await content_admin.select_admin_example(_db(request), example_id)
    if example is None:
        return envelope_error(
            404, "EXAMPLE_NOT_FOUND", f"No existe el ejemplo {example_id}."
        )
    return envelope_ok(example)


@router.put("/examples/{example_id}")
async def update_example(
    request: Request, example_id: str, body: AdminExampleUpdate
) -> JSONResponse:
    """§10.4 ``PUT /admin/examples/{id}`` — metadatos (sin código)."""
    result = await content_writer.update_example(request.app, example_id, body)
    return envelope_ok(result)


@router.post("/examples/{example_id}/code")
async def upload_example_code(request: Request, example_id: str) -> JSONResponse:
    """§10.4 ``POST /admin/examples/{id}/code`` — sube el ``.py`` (multipart o JSON).

    Reutiliza el validador estricto de §7.2: filename ``^[A-Za-z0-9._-]{1,80}\\.py$``,
    ≤ 262144 bytes leídos por chunks, decode UTF-8.
    """
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        filename, source_code, error = await _read_multipart_code(request)
    else:
        filename, source_code, error = await _read_json_code(request)
    if error is not None:
        return error
    result = await content_writer.set_example_code(
        request.app, example_id, source_code=source_code, filename=filename
    )
    return envelope_ok(
        AdminExampleCodeResult(
            example_id=result.id,
            filename=result.filename,
            bytes=len(result.source_code.encode("utf-8")),
        )
    )


async def _read_multipart_code(
    request: Request,
) -> tuple[str, str, JSONResponse | None]:
    settings = request.app.state.settings
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        return "", "", envelope_error(
            422, "VALIDATION_ERROR", "Falta la parte 'file' del multipart."
        )
    filename = getattr(upload, "filename", None) or ""
    if not _FILENAME_RE.fullmatch(filename):
        return "", "", envelope_error(
            415, "INVALID_EXTENSION",
            "El archivo debe llamarse ^[A-Za-z0-9._-]{1,80}\\.py$ (solo .py).",
        )
    chunks: list[bytes] = []
    total = 0
    while chunk := await upload.read(_UPLOAD_CHUNK):
        total += len(chunk)
        if total > settings.max_code_bytes:
            return "", "", envelope_error(
                413, "CODE_TOO_LARGE",
                f"El archivo supera el máximo de {settings.max_code_bytes} bytes.",
            )
        chunks.append(chunk)
    try:
        code = b"".join(chunks).decode("utf-8")
    except UnicodeDecodeError:
        return "", "", envelope_error(
            422, "INVALID_ENCODING", "El archivo debe ser texto UTF-8 válido."
        )
    if not code:
        return "", "", envelope_error(
            422, "VALIDATION_ERROR", "El archivo está vacío."
        )
    return filename, code, None


async def _read_json_code(
    request: Request,
) -> tuple[str, str, JSONResponse | None]:
    try:
        payload = await request.json()
    except Exception:
        return "", "", envelope_error(
            422, "VALIDATION_ERROR", "El body debe ser JSON válido."
        )
    # BL-35: un filename presente que no cumple el patrón `.py` da 415
    # INVALID_EXTENSION, igual que la variante multipart (§7.2/§10.4) — se
    # comprueba con el MISMO validador antes de pydantic (que lo degradaría a
    # 422). filename ausente/no-string cae al 422 de pydantic (missing/type).
    if isinstance(payload, dict):
        raw_filename = payload.get("filename")
        if isinstance(raw_filename, str) and not _FILENAME_RE.fullmatch(raw_filename):
            return "", "", envelope_error(
                415, "INVALID_EXTENSION",
                "El archivo debe llamarse ^[A-Za-z0-9._-]{1,80}\\.py$ (solo .py).",
            )
    body, error = _parse_json_body(AdminExampleCodeRequest, payload)
    if error is not None:
        return "", "", error
    return body.filename, body.source_code, None
