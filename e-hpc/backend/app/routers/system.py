"""Salud y sistema — api-contract §2 (CONGELADO).

- ``GET /health``: liveness ≠ readiness. 200 salvo DB caída (o lifespan
  incompleto); ``docker``/``runner_image`` son checks INFORMATIVOS.
  Sin envelope (excepción documentada).
- ``GET /api/v1/system``: cores/límites/versiones para la UI; 503
  ``DOCKER_UNAVAILABLE`` si el daemon no responde a ``ping()``.

El puerto docker se consume por interfaz estructural (``ping()`` /
``image_present()``, sync o async): este módulo NO importa ``docker`` ni
``services.docker_service``.
"""

import inspect
import logging
import os
import platform
from typing import Any, Protocol

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.errors import ApiException, success_envelope
from app.schemas import (
    HealthChecks,
    HealthResponse,
    SystemInfo,
    SystemLimits,
    SystemVersions,
)

logger = logging.getLogger("ehpc.system")

#: Versión del backend (SystemVersions.backend y FastAPI(version=...)).
BACKEND_VERSION = "1.0.0"

API_VERSION = "v1"

router = APIRouter()


class SystemDockerPort(Protocol):
    """Lo único que este router necesita del docker service (WP2)."""

    def ping(self) -> Any: ...          # bool o awaitable de bool
    def image_present(self) -> Any: ...


async def maybe_await(value: Any) -> Any:
    """Puente de interfaz: acepta retornos sync o awaitables."""
    if inspect.isawaitable(value):
        return await value
    return value


async def _db_alive(db: Any) -> bool:
    if db is None:
        return False
    try:
        cursor = await db.execute("SELECT 1")
        await cursor.fetchone()
        return True
    except Exception:
        logger.exception("Check de DB fallido en /health")
        return False


async def _docker_checks(docker: Any) -> tuple[bool, bool]:
    """(daemon responde, imagen runner presente) — nunca lanza."""
    if docker is None:
        return False, False
    try:
        ping_ok = bool(await maybe_await(docker.ping()))
    except Exception:
        logger.exception("ping() al daemon docker fallido")
        return False, False
    if not ping_ok:
        return False, False
    try:
        image_ok = bool(await maybe_await(docker.image_present()))
    except Exception:
        logger.exception("image_present() fallido")
        image_ok = False
    return True, image_ok


def _settings_of(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    return settings if settings is not None else get_settings()


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    """Healthcheck de infraestructura (SIN envelope, §2.1)."""
    db_ok = await _db_alive(getattr(request.app.state, "db", None))
    docker_ok, image_ok = await _docker_checks(
        getattr(request.app.state, "docker", None)
    )
    body = HealthResponse(
        status="ok" if db_ok else "error",
        checks=HealthChecks(db=db_ok, docker=docker_ok, runner_image=image_ok),
    )
    return JSONResponse(
        status_code=200 if db_ok else 503, content=body.model_dump()
    )


@router.get("/api/v1/system")
async def system_info(request: Request) -> dict:
    """Info para la UI (§2.2): 503 DOCKER_UNAVAILABLE si el daemon no responde."""
    settings = _settings_of(request)
    docker_ok, image_ok = await _docker_checks(
        getattr(request.app.state, "docker", None)
    )
    if not docker_ok:
        raise ApiException(
            "DOCKER_UNAVAILABLE", "El daemon de Docker no responde."
        )

    cores = os.cpu_count() or 1
    data = SystemInfo(
        cores=cores,
        max_threads=min(8, cores),
        runner_image=settings.runner_image,
        runner_image_present=image_ok,
        gpu_examples_enabled=_gpu_examples_enabled(request),
        versions=SystemVersions(
            backend=BACKEND_VERSION,
            python=platform.python_version(),
            pyomp=_pyomp_version(settings.runner_image),
            api=API_VERSION,
        ),
        limits=SystemLimits(
            max_code_bytes=settings.max_code_bytes,
            max_timeout_s=settings.max_timeout_s,
            max_concurrent_jobs=settings.max_concurrent_jobs,
            max_output_bytes=settings.max_output_bytes,
        ),
    )
    return success_envelope(data.model_dump())


def _pyomp_version(runner_image: str) -> str:
    """El tag de la imagen runner ES la versión de pyomp (ehpc-runner:0.5.1)."""
    _, _, tag = runner_image.partition(":")
    return tag or "unknown"


def _gpu_examples_enabled(request: Request) -> bool:
    """True solo si algún ejemplo requires_gpu está habilitado (fixtures WP4)."""
    content = getattr(request.app.state, "content", None)
    if content is None:
        return False
    try:
        return any(
            bool(getattr(example, "requires_gpu", False))
            and bool(getattr(example, "enabled", False))
            for example in content.examples()
        )
    except Exception:
        logger.exception("No se pudo evaluar gpu_examples_enabled")
        return False
