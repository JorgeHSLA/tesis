"""DTOs pydantic (v2) del contrato de API de Telar — §7 Jobs.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
Provee ``FILENAME_PATTERN`` (reutilizado por §10 admin) y ``JobStatus``
(reutilizado por §8 WebSocket). Reutiliza ``ParserId`` de §3.
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Literal

from pydantic import BaseModel, Field

from .examples import ParserId

# ─────────────────────────────── §7 Jobs ────────────────────────────────────

#: §7.7 — máquina de 8 fases.
JobStatus = Literal[
    "queued",
    "creating",
    "compiling",
    "running",
    "completed",
    "failed",
    "timeout",
    "cancelled",
]

#: Terminales: completed | failed | timeout | cancelled.
JobTerminalStatus = Literal["completed", "failed", "timeout", "cancelled"]

SourceKind = Literal["example", "editor", "upload"]

#: §7.4 — catálogo CERRADO de error_detail (nunca texto crudo de excepciones).
JobErrorDetail = Literal[
    "wall_timeout",
    "output_limit_exceeded",
    "oom",
    "orphaned_on_restart",
    "sandbox_error",
]

#: §7.1/§7.2 — patrón estricto de filename (rechaza comillas, CR/LF, control).
FILENAME_PATTERN = r"^[A-Za-z0-9._-]{1,80}\.py$"


class JobCreateRequest(BaseModel):
    """§7.1 ``POST /api/v1/jobs`` — al menos una fuente (example_id y/o code).

    La regla «al menos una fuente» y los topes dependientes de config
    (threads ≤ max_threads) se validan en el router (400/422 del contrato).
    """

    example_id: str | None = None
    # BL-17: sin cap estático de bytes — el tope se aplica en RUNTIME
    # (settings.max_code_bytes) en el router `_create_job`, por igual que la vía
    # multipart y la admin JSON. Así subir/bajar EHPC_MAX_CODE_BYTES surte efecto
    # también por esta vía; el exceso da 413 CODE_TOO_LARGE (no un 422 genérico).
    code: str | None = Field(default=None, min_length=1)
    filename: str | None = Field(default=None, pattern=FILENAME_PATTERN)
    threads: int | None = Field(default=None, ge=1)  # tope: max_threads (/system)
    # Sin cap estático: el tope es OPCIONAL y se aplica en RUNTIME
    # (settings.max_timeout_s > 0) en el router `_create_job`. Con
    # EHPC_MAX_TIMEOUT_S <= 0 no hay máximo; el mínimo (5 s) sí es fijo.
    timeout_s: int | None = Field(default=None, ge=5)
    lesson_id: str | None = None


class JobCreated(BaseModel):
    """§7.1/§7.2 — respuesta 202 (bloque ``data``)."""

    job_id: str
    status: JobStatus
    threads_effective: int  # CPUs realmente asignadas
    threads_note: str | None
    ws_url: str
    href: str
    created_at: str


class JobSummary(BaseModel):
    """§7.3 — item de ``GET /api/v1/jobs`` (sin código, sin stdout)."""

    job_id: str
    filename: str
    source_kind: SourceKind
    example_id: str | None
    lesson_id: str | None
    status: JobStatus
    exit_code: int | None
    threads: int
    wall_time_ms: int | None  # finished_at − started_at (excluye cola)
    created_at: str
    finished_at: str | None


class JobsList(BaseModel):
    jobs: list[JobSummary]


class MetricsSummary(BaseModel):
    """§7.4 — agregado persistido de docker stats (data-model §3.1)."""

    samples: int
    cpu_percent_max: float
    cpu_percent_avg: float
    mem_used_bytes_max: int
    mem_limit_bytes: int
    pids_max: int
    throttled_periods: int


class SweepPoint(BaseModel):
    threads: int
    time_s: float
    speedup: float
    efficiency: float


class ParsedTimingsSweep(BaseModel):
    """§7.4 — ``parsed_timings`` kind "sweep" (spmd, spmdCritical, transporte)."""

    parser_id: ParserId
    kind: Literal["sweep"]
    series: list[SweepPoint]
    extra: dict[str, float]
    correct: bool | None


class ParsedTimingsPair(BaseModel):
    """§7.4 — ``parsed_timings`` kind "pair" (sumaVectores, matrices, stencil)."""

    parser_id: ParserId
    kind: Literal["pair"]
    parallel_time_s: float
    reference_time_s: float
    reference_label: str  # "numpy" | "blas" | "serial"
    speedup_vs_reference: float
    correct: bool | None


ParsedTimings = ParsedTimingsSweep | ParsedTimingsPair


class JobDetail(BaseModel):
    """§7.4 ``GET /api/v1/jobs/{job_id}`` — bloque ``data``."""

    job_id: str
    filename: str
    source_kind: SourceKind
    example_id: str | None
    lesson_id: str | None
    source_code: str
    status: JobStatus
    exit_code: int | None
    oom_killed: bool
    error_detail: JobErrorDetail | None
    threads: int
    timeout_s: int
    created_at: str
    started_at: str | None
    finished_at: str | None
    wall_time_ms: int | None
    stdout: str | None  # null mientras el job no es terminal
    stderr: str | None
    output_truncated: bool
    metrics_summary: MetricsSummary | None
    parsed_timings: ParsedTimings | None


class JobCancelResult(BaseModel):
    """§7.5 ``POST /api/v1/jobs/{job_id}/cancel`` — respuesta 202."""

    job_id: str
    status: Literal["cancelling"]


__all__ = [
    "JobStatus",
    "JobTerminalStatus",
    "SourceKind",
    "JobErrorDetail",
    "FILENAME_PATTERN",
    "JobCreateRequest",
    "JobCreated",
    "JobSummary",
    "JobsList",
    "MetricsSummary",
    "SweepPoint",
    "ParsedTimingsSweep",
    "ParsedTimingsPair",
    "ParsedTimings",
    "JobDetail",
    "JobCancelResult",
]
