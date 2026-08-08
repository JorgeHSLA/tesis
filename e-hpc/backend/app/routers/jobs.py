"""Router de jobs — api-contract.md §7 (semántica de fuentes, upload, output).

Dependencias por ``app.state`` (inyectadas en el lifespan de WP1):
``settings``, ``job_repo`` (firma data-model §5), ``job_runner`` (JobRunner),
``docker_service`` (DockerServicePort), ``content`` (ContentRepository).
Los errores de negocio se responden aquí mismo con el envelope del contrato
(§1); los 422 de validación de query los reformatea el handler global (WP1).
"""

from __future__ import annotations

import asyncio
import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Form, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..errors import sanitize_validation_errors
from ..repositories.records import JobRecord
from ..schemas import FILENAME_PATTERN, JobCreateRequest
from ..services.job_runner import TERMINAL_STATUSES, utc_now_iso

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])

_FILENAME_RE = re.compile(FILENAME_PATTERN)
_UPLOAD_CHUNK = 64 * 1024
_MAX_QUEUE = 10  # cola interna: al llegar a 10 en queued ⇒ 429 (§7.4 tabla)
_STATUSES = frozenset(
    {"queued", "creating", "compiling", "running",
     "completed", "failed", "timeout", "cancelled"}
)
_TRUNCATION_MARK = "\n--- [E-HPC] output truncado a {n} bytes ---\n"


# ───────────────────────────── envelope helpers ─────────────────────────────


def _ok(data: Any, status_code: int = 200, meta: dict | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": True, "data": data, "error": None, "meta": meta},
    )


def _err(
    status_code: int, code: str, message: str, details: Any | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": {"code": code, "message": message, "details": details},
            "meta": None,
        },
    )


def _max_threads() -> int:
    return min(8, os.cpu_count() or 1)


# ─────────────────────── creación (lógica común §7.1/§7.2) ──────────────────


async def _create_job(
    request: Request,
    *,
    example_id: str | None,
    code: str | None,
    filename: str | None,
    threads: int | None,
    timeout_s: int | None,
    lesson_id: str | None,
    upload: bool,
) -> JSONResponse:
    state = request.app.state
    settings = state.settings
    content = state.content
    runner = state.job_runner

    if example_id is None and code is None:
        return _err(400, "VALIDATION_ERROR", "Debe venir example_id y/o code.")

    example = None
    if example_id is not None:
        example = content.example(example_id)
        if example is None:
            return _err(404, "EXAMPLE_NOT_FOUND", f"No existe el ejemplo {example_id}.")
        if not example.enabled:
            return _err(409, "EXAMPLE_DISABLED", f"El ejemplo {example_id} está deshabilitado.")

    if lesson_id is not None and not content.exists_lesson(lesson_id):
        return _err(404, "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}.")

    if code is not None and len(code.encode("utf-8")) > settings.max_code_bytes:
        return _err(
            413, "CODE_TOO_LARGE",
            f"El código supera el máximo de {settings.max_code_bytes} bytes.",
        )

    # --- fuentes (§7.1): example_id y/o code ---
    if upload:
        source_kind = "upload"
        source_code = code or ""
        parser_id = "none"
    elif code is None:
        assert example is not None
        source_kind = "example"
        source_code = example.source_code
        parser_id = example.parser_id
    elif example is None:
        source_kind = "editor"
        source_code = code
        parser_id = "none"
    else:
        # ejemplo + código: se ejecuta `code`; el ejemplo aporta parser/filename
        source_code = code
        parser_id = example.parser_id
        source_kind = "example" if code == example.source_code else "editor"

    eff_filename = filename or (example.filename if example is not None else None) or "main.py"

    # --- threads (§7.1): omitible; IGNORADO en no-configurables ---
    max_threads = _max_threads()
    threads_note: str | None = None
    if example is not None and not example.threads_configurable:
        if getattr(example, "sweeps_threads", False):
            threads_effective = max_threads
            threads_note = (
                "Este ejemplo barre 1/2/4/8 hilos internamente; "
                f"se asignan {threads_effective} CPUs."
            )
        else:
            # BL-32: clamp ANTES de formatear la nota — jamás citar más
            # hilos/CPUs de los que realmente se asignan.
            threads_effective = min(
                example.fixed_threads or max_threads, max_threads
            )
            note = getattr(example, "fixed_threads_note", None)
            threads_note = note or (
                f"Este ejemplo fija {threads_effective} hilos; "
                f"se asignan {threads_effective} CPUs."
            )
    else:
        # default 4 (§7.1) acotado por los cores reales de la máquina
        threads_effective = threads if threads is not None else min(4, max_threads)
        if not 1 <= threads_effective <= max_threads:
            return _err(
                422, "VALIDATION_ERROR",
                f"threads debe estar entre 1 y {max_threads}.",
            )

    # --- timeout (§7.4): mínimo SIEMPRE, máximo OPCIONAL ---
    # El default sigue siendo el del ejemplo (o 60 s para código propio): omitir
    # timeout_s nunca deja un slot colgado. El tope, en cambio, es opcional:
    # EHPC_MAX_TIMEOUT_S <= 0 significa "sin límite".
    default_timeout = example.default_timeout_s if example is not None else 60
    eff_timeout = timeout_s if timeout_s is not None else default_timeout
    if eff_timeout < 5:
        return _err(422, "VALIDATION_ERROR", "timeout_s debe ser >= 5.")
    if settings.max_timeout_s > 0 and eff_timeout > settings.max_timeout_s:
        return _err(
            422, "VALIDATION_ERROR",
            f"timeout_s no puede superar {settings.max_timeout_s}.",
        )

    # --- capacidad e infraestructura ---
    # BL-08: la reserva del slot es atómica respecto al chequeo (síncrona,
    # ANTES de cualquier await) — una ráfaga concurrente no supera el tope.
    # Se libera SIEMPRE: tras start() el handle ya cuenta como queued, y en
    # cualquier salida de error el slot vuelve a quedar libre.
    if not runner.try_reserve_queue_slot(_MAX_QUEUE):
        return _err(429, "TOO_MANY_JOBS", "La cola interna de jobs está llena.")
    try:
        docker = getattr(state, "docker_service", None)
        if docker is None or not await asyncio.to_thread(docker.ping):
            return _err(503, "DOCKER_UNAVAILABLE", "El daemon Docker no responde.")
        if not await asyncio.to_thread(docker.image_present):
            return _err(
                503, "RUNNER_IMAGE_MISSING",
                f"La imagen {settings.runner_image} no existe en el daemon.",
            )

        job_id = uuid.uuid4().hex
        created_at = utc_now_iso()
        record = JobRecord(
            id=job_id,
            source_kind=source_kind,
            example_id=example_id,
            lesson_id=lesson_id,
            filename=eff_filename,
            source_code=source_code,
            threads=threads_effective,
            timeout_s=eff_timeout,
            runner_image=settings.runner_image,
            status="queued",
            container_id=None,
            error_detail=None,
            exit_code=None,
            oom_killed=False,
            stdout=None,
            stderr=None,
            output_truncated=False,
            metrics_summary=None,
            parsed_timings=None,
            created_at=created_at,
            started_at=None,
            finished_at=None,
            wall_time_ms=None,
        )
        await state.job_repo.create(record)
        runner.start(
            job_id=job_id,
            source_code=source_code,
            threads=threads_effective,
            timeout_s=eff_timeout,
            parser_id=parser_id,
            lesson_id=lesson_id,
        )
    finally:
        runner.release_queue_slot()
    return _ok(
        {
            "job_id": job_id,
            "status": "queued",
            "threads_effective": threads_effective,
            "threads_note": threads_note,
            "ws_url": f"/ws/jobs/{job_id}",
            "href": f"/api/v1/jobs/{job_id}",
            "created_at": created_at,
        },
        status_code=202,
    )


# ────────────────────────────── endpoints ───────────────────────────────────


@router.post("")
async def create_job(request: Request) -> JSONResponse:
    """§7.1 ``POST /api/v1/jobs`` — editor o preset (JSON)."""
    try:
        payload = await request.json()
    except Exception:
        return _err(422, "VALIDATION_ERROR", "El body debe ser JSON válido.")
    try:
        body = JobCreateRequest.model_validate(payload)
    except ValidationError as exc:
        # BL-22: sanea `input`/`ctx`/`url` — nunca reflejar el valor crudo
        # rechazado del cliente (código, filename) en el cuerpo del 422.
        # BL-17: el tope de tamaño de `code` ya no es un `max_length` estático de
        # pydantic; el 413 CODE_TOO_LARGE lo emite `_create_job` en runtime contra
        # `settings.max_code_bytes` (por igual que `/upload`).
        return _err(
            422, "VALIDATION_ERROR", "Body inválido.",
            details=sanitize_validation_errors(exc.errors(include_url=False)),
        )
    return await _create_job(
        request,
        example_id=body.example_id,
        code=body.code,
        filename=body.filename,
        threads=body.threads,
        timeout_s=body.timeout_s,
        lesson_id=body.lesson_id,
        upload=False,
    )


@router.post("/upload")
async def create_job_upload(
    request: Request,
    file: UploadFile,
    threads: int | None = Form(default=None),
    timeout_s: int | None = Form(default=None),
    lesson_id: str | None = Form(default=None),
) -> JSONResponse:
    """§7.2 ``POST /api/v1/jobs/upload`` — archivo .py por chunks."""
    settings = request.app.state.settings
    filename = file.filename or ""
    if not _FILENAME_RE.fullmatch(filename):
        return _err(
            415, "INVALID_EXTENSION",
            "El archivo debe llamarse ^[A-Za-z0-9._-]{1,80}\\.py$ (solo .py).",
        )
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_UPLOAD_CHUNK):
        total += len(chunk)
        if total > settings.max_code_bytes:
            return _err(
                413, "CODE_TOO_LARGE",
                f"El archivo supera el máximo de {settings.max_code_bytes} bytes.",
            )
        chunks.append(chunk)
    try:
        code = b"".join(chunks).decode("utf-8")
    except UnicodeDecodeError:
        return _err(422, "INVALID_ENCODING", "El archivo debe ser texto UTF-8 válido.")
    if not code:
        return _err(422, "VALIDATION_ERROR", "El archivo está vacío.")
    return await _create_job(
        request,
        example_id=None,
        code=code,
        filename=filename,
        threads=threads,
        timeout_s=timeout_s,
        lesson_id=lesson_id,
        upload=True,
    )


@router.get("")
async def list_jobs(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: str | None = Query(default=None),
) -> JSONResponse:
    """§7.3 ``GET /api/v1/jobs`` — listado resumido con meta de paginación."""
    if status is not None and status not in _STATUSES:
        return _err(422, "VALIDATION_ERROR", f"status inválido: {status}.")
    records, total = await request.app.state.job_repo.list_recent(
        limit=limit, offset=offset, status=status
    )
    jobs = [
        {
            "job_id": r.id,
            "filename": r.filename,
            "source_kind": r.source_kind,
            "example_id": r.example_id,
            "lesson_id": r.lesson_id,
            "status": r.status,
            "exit_code": r.exit_code,
            "threads": r.threads,
            "wall_time_ms": r.wall_time_ms,
            "created_at": r.created_at,
            "finished_at": r.finished_at,
        }
        for r in records
    ]
    return _ok({"jobs": jobs}, meta={"total": total, "limit": limit, "offset": offset})


@router.get("/{job_id}")
async def get_job(request: Request, job_id: str) -> JSONResponse:
    """§7.4 ``GET /api/v1/jobs/{job_id}`` — detalle y resultados."""
    record = await request.app.state.job_repo.find_by_id(job_id)
    if record is None:
        return _err(404, "JOB_NOT_FOUND", f"No existe el job {job_id}.")
    terminal = record.status in TERMINAL_STATUSES
    return _ok(
        {
            "job_id": record.id,
            "filename": record.filename,
            "source_kind": record.source_kind,
            "example_id": record.example_id,
            "lesson_id": record.lesson_id,
            "source_code": record.source_code,
            "status": record.status,
            "exit_code": record.exit_code,
            "oom_killed": record.oom_killed,
            "error_detail": record.error_detail,
            "threads": record.threads,
            "timeout_s": record.timeout_s,
            "created_at": record.created_at,
            "started_at": record.started_at,
            "finished_at": record.finished_at,
            "wall_time_ms": record.wall_time_ms,
            # mientras el job no es terminal, el vivo va por WS (§7.4)
            "stdout": record.stdout if terminal else None,
            "stderr": record.stderr if terminal else None,
            "output_truncated": record.output_truncated,
            "metrics_summary": record.metrics_summary if terminal else None,
            "parsed_timings": record.parsed_timings if terminal else None,
        }
    )


@router.post("/{job_id}/cancel")
async def cancel_job(request: Request, job_id: str) -> JSONResponse:
    """§7.5 — equivalente REST del mensaje WS ``cancel``."""
    state = request.app.state
    result = await state.job_runner.cancel(job_id)
    if result is None:
        # ventana de transición §3.4: reintento único tras ~100 ms
        record = await state.job_repo.find_by_id(job_id)
        if record is None:
            return _err(404, "JOB_NOT_FOUND", f"No existe el job {job_id}.")
        if record.status not in TERMINAL_STATUSES:
            await asyncio.sleep(0.1)
            result = await state.job_runner.cancel(job_id)
            if result is None:
                record = await state.job_repo.find_by_id(job_id)
        if result is None:
            if record is not None and record.status in TERMINAL_STATUSES:
                return _err(409, "JOB_NOT_CANCELLABLE", "El job ya es terminal.")
            return _err(409, "JOB_NOT_CANCELLABLE", "El job no se puede cancelar.")
    return _ok({"job_id": job_id, "status": "cancelling"}, status_code=202)


@router.get("/{job_id}/output")
async def download_output(
    request: Request,
    job_id: str,
    stream: str = Query(default="combined"),
) -> Response:
    """§7.6 — descarga text/plain SIN envelope; Content-Disposition seguro."""
    if stream not in {"combined", "stdout", "stderr"}:
        return _err(422, "VALIDATION_ERROR", f"stream inválido: {stream}.")
    record = await request.app.state.job_repo.find_by_id(job_id)
    if record is None:
        return _err(404, "JOB_NOT_FOUND", f"No existe el job {job_id}.")
    if record.status not in TERMINAL_STATUSES:
        return _err(409, "JOB_NOT_FINISHED", "El job aún no ha terminado")
    stdout = record.stdout or ""
    stderr = record.stderr or ""
    if stream == "stdout":
        text = stdout
    elif stream == "stderr":
        text = stderr
    else:
        text = stdout + ("\n" if stdout and stderr and not stdout.endswith("\n") else "") + stderr
    if record.output_truncated:
        settings = request.app.state.settings
        text += _TRUNCATION_MARK.format(n=settings.max_output_bytes)
    # el stem procede de jobs.filename, que ya cumple ^[A-Za-z0-9._-]{1,80}\.py$
    # — imposible inyectar comillas o CR/LF en la cabecera (§7.6).
    download_name = f"{Path(record.filename).stem}-{job_id[:8]}.txt"
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )
