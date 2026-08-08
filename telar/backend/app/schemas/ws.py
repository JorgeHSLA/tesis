"""DTOs pydantic (v2) del contrato de API de Telar — §8 Protocolo WebSocket.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
Reutiliza ``JobStatus`` de §7 (jobs).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Literal

from pydantic import BaseModel

from .jobs import JobStatus

# ──────────────────── §8 Protocolo WebSocket (mensajes) ─────────────────────

#: Códigos de ``error`` no fatal del stream (§8.2). No cierran la conexión.
WsErrorCode = Literal["OUTPUT_TRUNCATED", "STREAM_ERROR", "BAD_CLIENT_MESSAGE"]


class WsStatusDetail(BaseModel):
    """``detail`` de un ``status`` terminal (solo en fases terminales)."""

    exit_code: int | None
    oom_killed: bool
    wall_time_ms: int | None
    output_truncated: bool
    error_detail: str | None


class WsStatusMsg(BaseModel):
    """§8.2 ``status`` — cambio de fase (snapshot al conectar + transiciones)."""

    type: Literal["status"] = "status"
    job_id: str
    ts: str  # ISO-8601 UTC
    phase: JobStatus
    detail: WsStatusDetail | None = None


class WsLogMsg(BaseModel):
    """§8.2 ``log`` — líneas completas re-bufferizadas por ``\\n``."""

    type: Literal["log"] = "log"
    job_id: str
    ts: str
    stream: Literal["stdout", "stderr"]
    lines: list[str]
    seq: int  # contador monótono por job (huecos detectables)


class WsMetricsMsg(BaseModel):
    """§8.2 ``metrics`` — muestra de docker stats (~1/s, lossy)."""

    type: Literal["metrics"] = "metrics"
    job_id: str
    ts: str
    cpu_percent: float  # puede superar 100 (N hilos ≈ N·100)
    online_cpus: int
    mem_used_bytes: int
    mem_limit_bytes: int
    mem_percent: float
    pids: int
    throttled_periods: int


class WsErrorMsg(BaseModel):
    """§8.2 ``error`` — error no fatal del stream (no cierra la conexión)."""

    type: Literal["error"] = "error"
    job_id: str
    ts: str
    code: WsErrorCode
    message: str


class WsEofMsg(BaseModel):
    """§8.2 ``eof`` — último mensaje; después el servidor cierra con 1000."""

    type: Literal["eof"] = "eof"
    job_id: str
    ts: str
    total_log_bytes: int
    truncated: bool


#: Unión servidor → cliente (discriminada por ``type``).
WsServerMsg = WsStatusMsg | WsLogMsg | WsMetricsMsg | WsErrorMsg | WsEofMsg


class WsCancelMsg(BaseModel):
    """§8.3 cliente → servidor: único comando soportado."""

    type: Literal["cancel"]


__all__ = [
    "WsErrorCode",
    "WsStatusDetail",
    "WsStatusMsg",
    "WsLogMsg",
    "WsMetricsMsg",
    "WsErrorMsg",
    "WsEofMsg",
    "WsServerMsg",
    "WsCancelMsg",
]
