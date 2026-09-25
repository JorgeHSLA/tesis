"""WebSocket ``/ws/jobs/{job_id}`` — api-contract.md §8 completo.

- Validación manual de ``Origin`` (CORS no aplica a WS): misma lista del CORS,
  aceptando también ``null`` y ausencia de header (§8.1).
- Job inexistente → accept + close **4404** ``"job not found"``.
- Job terminal → ``status`` final + replay del output como ``log`` + ``eof``
  y close **1000** (soporta F5).
- Job activo → snapshot + backlog (ring-buffer) + stream vivo (fan-out del
  drainer); tarea lectora concurrente para ``cancel``/desconexión
  (``asyncio.wait FIRST_COMPLETED``, pendientes SIEMPRE canceladas).
- Cualquier otro mensaje del cliente → ``error BAD_CLIENT_MESSAGE`` (no cierra).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services import DockerServiceError
from ..services.job_runner import TERMINAL_STATUSES, JobHandle, utc_now_iso

logger = logging.getLogger("telar.ws")

router = APIRouter(tags=["ws"])

_REPLAY_LINES_PER_MSG = 200
_RETRY_WINDOW_S = 0.1  # ventana de transición §3.4: un único reintento


# Orígenes opacos del shell de escritorio. Electron carga la UI con `loadFile`
# (file://) y Chromium NO serializa ese origen igual en las dos vías:
#   · fetch/XHR  -> `Origin: null`   (de ahí el "null" de TELAR_ALLOWED_ORIGINS)
#   · WebSocket  -> `Origin: file://`
# Contemplar solo "null" dejaba el WS del escritorio rechazado con 403 en TODOS
# los jobs (logs y métricas en vivo muertos), mientras el REST funcionaba —por
# eso el fallo pasó desapercibido. No debilita el modelo: la rama `origin is
# None` ya acepta cualquier cliente no-navegador, y el bind es loopback.
_DESKTOP_ORIGINS = frozenset({"null", "file://"})


def _origin_allowed(origin: str | None, allowed: list[str]) -> bool:
    return origin is None or origin in _DESKTOP_ORIGINS or origin in allowed


def _error_msg(job_id: str, code: str, message: str) -> dict:
    return {
        "type": "error",
        "job_id": job_id,
        "ts": utc_now_iso(),
        "code": code,
        "message": message,
    }


@router.websocket("/ws/jobs/{job_id}")
async def job_stream(websocket: WebSocket, job_id: str) -> None:
    state = websocket.app.state
    origin = websocket.headers.get("origin")
    if not _origin_allowed(origin, state.settings.allowed_origins_list):
        # rechazo del handshake (policy violation) antes de accept
        await websocket.close(code=1008, reason="origin not allowed")
        return
    await websocket.accept()

    runner = state.job_runner
    repo = state.job_repo

    handle = runner.get_active(job_id)
    if handle is not None:
        await _stream_active(websocket, runner, job_id, handle)
        return
    finished = runner.get_finished(job_id)
    if finished is not None:
        # BL-09: terminal aún retenido — replay con los seq/ts ORIGINALES
        # del stream vivo (el dedupe del cliente sigue funcionando, §8.2).
        await _replay_retained(websocket, finished)
        return

    record = await repo.find_by_id(job_id)
    if record is None:
        await websocket.close(code=4404, reason="job not found")
        return
    if record.status in TERMINAL_STATUSES:
        await _replay_terminal(websocket, record)
        return

    # No está en el registro pero la DB aún no es terminal: ventana de
    # transición (§3.4/§8.1) — reintento único tras ~100 ms y decisión.
    await asyncio.sleep(_RETRY_WINDOW_S)
    handle = runner.get_active(job_id)
    if handle is not None:
        await _stream_active(websocket, runner, job_id, handle)
        return
    finished = runner.get_finished(job_id)
    if finished is not None:
        await _replay_retained(websocket, finished)
        return
    record = await repo.find_by_id(job_id)
    if record is None:
        await websocket.close(code=4404, reason="job not found")
        return
    if record.status in TERMINAL_STATUSES:
        await _replay_terminal(websocket, record)
        return
    logger.error("ws %s: job no terminal y fuera del registro tras reintento", job_id)
    # §8.4: el 1011 va «tras intentar emitir `error`» (BL-33); el código
    # sale del catálogo cerrado de §8.2.
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        await websocket.send_json(_error_msg(
            job_id, "STREAM_ERROR",
            "Estado interno inconsistente; reintenta la conexión.",
        ))
    await websocket.close(code=1011, reason="internal error")


# ────────────────────────────── job terminal ────────────────────────────────


async def _replay_terminal(websocket: WebSocket, record: Any) -> None:
    """``status`` final + replay del output como ``log`` + ``eof`` + 1000."""
    try:
        await websocket.send_json(
            {
                "type": "status",
                "job_id": record.id,
                "ts": utc_now_iso(),
                "phase": record.status,
                "detail": {
                    "exit_code": record.exit_code,
                    "oom_killed": record.oom_killed,
                    "wall_time_ms": record.wall_time_ms,
                    "output_truncated": record.output_truncated,
                    "error_detail": record.error_detail,
                },
            }
        )
        seq = 0
        total_bytes = 0
        for stream, text in (("stdout", record.stdout), ("stderr", record.stderr)):
            if not text:
                continue
            total_bytes += len(text.encode("utf-8"))
            lines = text.splitlines()
            for i in range(0, len(lines), _REPLAY_LINES_PER_MSG):
                seq += 1
                await websocket.send_json(
                    {
                        "type": "log",
                        "job_id": record.id,
                        # BL-16: la DB no guarda el instante de cada línea —
                        # `ts` va vacío (marcado, §8.2) en vez de fabricarse
                        # con la hora del replay.
                        "ts": "",
                        "stream": stream,
                        "lines": lines[i : i + _REPLAY_LINES_PER_MSG],
                        "seq": seq,
                    }
                )
        await websocket.send_json(
            {
                "type": "eof",
                "job_id": record.id,
                "ts": utc_now_iso(),
                "total_log_bytes": total_bytes,
                "truncated": record.output_truncated,
            }
        )
        await websocket.close(code=1000)
    except (WebSocketDisconnect, RuntimeError):
        pass  # el cliente se fue durante el replay: no es un error


async def _replay_retained(websocket: WebSocket, handle: JobHandle) -> None:
    """Job terminal retenido en el registro (BL-09): ``status`` final +
    backlog del ring-buffer TAL CUAL (seq y ts originales) + ``eof`` + 1000."""
    try:
        detail = handle.terminal_detail or {
            "exit_code": None, "oom_killed": False, "wall_time_ms": None,
            "output_truncated": handle.output_truncated, "error_detail": None,
        }
        await websocket.send_json(
            {
                "type": "status",
                "job_id": handle.job_id,
                "ts": utc_now_iso(),
                "phase": handle.phase,
                "detail": detail,
            }
        )
        for msg in list(handle.backlog):
            await websocket.send_json(msg)
        await websocket.send_json(
            {
                "type": "eof",
                "job_id": handle.job_id,
                "ts": utc_now_iso(),
                "total_log_bytes": handle.total_log_bytes,
                "truncated": handle.output_truncated,
            }
        )
        await websocket.close(code=1000)
    except (WebSocketDisconnect, RuntimeError):
        pass  # el cliente se fue durante el replay: no es un error


# ─────────────────────────────── job activo ─────────────────────────────────


async def _stream_active(
    websocket: WebSocket, runner: Any, job_id: str, handle: JobHandle
) -> None:
    key, queue, snapshot = runner.subscribe(handle)
    try:
        for msg in snapshot:
            await websocket.send_json(msg)

        sender = asyncio.create_task(_pump(websocket, queue))
        receiver = asyncio.create_task(_listen(websocket, runner, job_id, queue))
        done, pending = await asyncio.wait(
            {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:  # SIEMPRE se cancelan las pendientes (§3 p.4)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        if sender in done and not sender.cancelled() and sender.exception() is None:
            # la cola por-conexión se cerró tras status terminal + eof
            with contextlib.suppress(RuntimeError):
                await websocket.close(code=1000)
    except (WebSocketDisconnect, RuntimeError):
        pass  # desconexión del cliente: NO cancela el job (§8.4)
    finally:
        runner.unsubscribe(handle, key)


async def _pump(websocket: WebSocket, queue: asyncio.Queue) -> None:
    """Bombea la cola por-conexión al socket; None = cola cerrada."""
    while True:
        msg = await queue.get()
        if msg is None:
            return
        await websocket.send_json(msg)


async def _listen(
    websocket: WebSocket, runner: Any, job_id: str, queue: asyncio.Queue
) -> None:
    """Tarea lectora: ``cancel`` / desconexión / BAD_CLIENT_MESSAGE (§8.3)."""
    while True:
        text = await websocket.receive_text()  # lanza WebSocketDisconnect
        try:
            data = json.loads(text)
        except (ValueError, TypeError):
            data = None
        if isinstance(data, dict) and data.get("type") == "cancel":
            # idempotente: cancelar dos veces o un job terminal se ignora
            try:
                await runner.cancel(job_id)
            except DockerServiceError:
                # CU-08.3: el kill falló; el cliente puede reintentar.
                with contextlib.suppress(asyncio.QueueFull):
                    queue.put_nowait(_error_msg(
                        job_id, "CANCEL_FAILED",
                        "No fue posible solicitar la cancelación. "
                        "La ejecución puede continuar activa.",
                    ))
            continue
        # el error viaja por la cola propia para no entrelazar sends
        try:
            queue.put_nowait(
                _error_msg(job_id, "BAD_CLIENT_MESSAGE", "Mensaje no soportado.")
            )
        except asyncio.QueueFull:
            pass
