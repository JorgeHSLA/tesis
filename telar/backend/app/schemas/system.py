"""DTOs pydantic (v2) del contrato de API de Telar — §2 Salud y sistema.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO).
No añadir, quitar ni renombrar campos sin actualizar el contrato primero.
"""

from typing import Literal

from pydantic import BaseModel

# ─────────────────────────── §2 Salud y sistema ─────────────────────────────


class HealthChecks(BaseModel):
    """Checks informativos de ``GET /health``."""

    db: bool
    docker: bool
    #: ``None`` = no se pudo comprobar (enmienda aditiva CU-26.1); ``False`` =
    #: se comprobó y la imagen no existe.
    runner_image: bool | None


class HealthResponse(BaseModel):
    """§2.1 ``GET /health`` — SIN envelope (excepción documentada)."""

    status: str  # "ok" con 200; liveness ≠ readiness
    checks: HealthChecks


class SystemVersions(BaseModel):
    backend: str
    python: str
    pyomp: str
    api: str


class CatalogInfo(BaseModel):
    """§2.2 (Fase 5, §11.12.A) — el bloque ``catalog`` de ``GET /system``.

    Sirve para que el frontend **esconda** el item «Módulos disponibles» del
    rail cuando este despliegue no tiene bucket, en vez de mostrarlo roto.
    ``last_checked_at`` es el último sondeo CONOCIDO —el que dejó
    ``POST /catalog/refresh`` en ``installed_modules``—, nunca un sondeo hecho
    dentro de esta petición: ``/system`` no puede bloquearse por la red.
    """

    enabled: bool
    bucket: str | None
    mode: Literal["anonymous", "admin"]
    last_checked_at: str | None


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
    catalog: CatalogInfo  # Fase 5, §11.12.A


__all__ = [
    "HealthChecks",
    "HealthResponse",
    "SystemVersions",
    "SystemLimits",
    "CatalogInfo",
    "SystemInfo",
]
