"""DTOs pydantic (v2) del contrato de API de E-HPC — §2 Salud y sistema.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from pydantic import BaseModel

# ─────────────────────────── §2 Salud y sistema ─────────────────────────────


class HealthChecks(BaseModel):
    """Checks informativos de ``GET /health``."""

    db: bool
    docker: bool
    runner_image: bool


class HealthResponse(BaseModel):
    """§2.1 ``GET /health`` — SIN envelope (excepción documentada)."""

    status: str  # "ok" con 200; liveness ≠ readiness
    checks: HealthChecks


class SystemVersions(BaseModel):
    backend: str
    python: str
    pyomp: str
    api: str


class SystemLimits(BaseModel):
    max_code_bytes: int
    max_timeout_s: int
    max_concurrent_jobs: int
    max_output_bytes: int


class SystemInfo(BaseModel):
    """§2.2 ``GET /api/v1/system`` — bloque ``data``."""

    cores: int
    max_threads: int  # min(8, cores) — techo del slider
    runner_image: str
    runner_image_present: bool
    gpu_examples_enabled: bool
    versions: SystemVersions
    limits: SystemLimits


__all__ = [
    "HealthChecks",
    "HealthResponse",
    "SystemVersions",
    "SystemLimits",
    "SystemInfo",
]
