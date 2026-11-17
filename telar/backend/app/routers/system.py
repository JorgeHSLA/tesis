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

import asyncio
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
# Se importa del módulo y no del paquete a propósito: `app/schemas/__init__.py`
# lo está tocando otra tanda de Fase 5 y este import no necesita competir por él.
from app.schemas.system import CatalogInfo

logger = logging.getLogger("telar.system")

#: Versión del backend (SystemVersions.backend y FastAPI(version=...)).
BACKEND_VERSION = "1.0.5"

API_VERSION = "v1"

router = APIRouter()


class SystemDockerPort(Protocol):
    """Lo único que este router necesita del docker service (WP2)."""

    def ping(self) -> Any: ...          # bool o awaitable de bool
    def image_present(self) -> Any: ...  # bool | None (None = no comprobable)


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


#: Espera máxima por llamada a Docker desde /health y /system (CU-26.2). El
#: healthcheck de compose abandona a los 3-5 s: esperar los 120 s del cliente
#: dejaría al consumidor sin respuesta justo cuando más la necesita.
DOCKER_CHECK_TIMEOUT_S = 3.0


async def _call_docker(fn: Any) -> Any:
    """``fn()`` en un hilo con timeout corto; acepta retorno sync o awaitable.

    El hilo no se puede matar: si Docker no contesta, sigue esperando hasta su
    propio timeout, pero el event loop ya no lo espera.
    """
    value = await asyncio.wait_for(asyncio.to_thread(fn), DOCKER_CHECK_TIMEOUT_S)
    if inspect.isawaitable(value):
        value = await asyncio.wait_for(value, DOCKER_CHECK_TIMEOUT_S)
    return value


async def _docker_checks(docker: Any) -> tuple[bool, bool | None]:
    """(daemon responde, imagen runner presente) — nunca lanza.

    La imagen es ``None`` cuando no se pudo comprobar (CU-26.1): daemon caído,
    timeout o error distinto de «no existe».
    """
    if docker is None:
        return False, None
    try:
        ping_ok = bool(await _call_docker(docker.ping))
    except TimeoutError:
        logger.warning("ping() al daemon docker sin respuesta en %.1f s", DOCKER_CHECK_TIMEOUT_S)
        return False, None
    except Exception:
        logger.exception("ping() al daemon docker fallido")
        return False, None
    if not ping_ok:
        return False, None
    try:
        present = await _call_docker(docker.image_present)
    except TimeoutError:
        logger.warning("image_present() sin respuesta en %.1f s", DOCKER_CHECK_TIMEOUT_S)
        return True, None
    except Exception:
        logger.exception("image_present() fallido")
        return True, None
    return True, None if present is None else bool(present)


async def ensure_docker(app: Any) -> Any:
    """El cliente Docker del estado, o uno nuevo si al arrancar no se pudo crear.

    CU-26.3: con el backend en el host (desarrollo), si Docker no estaba al
    arrancar, sin esto el backend seguía «sin Docker» hasta reiniciarlo. El
    cliente nuevo se entrega también al ``JobRunner`` y al alias de los routers.

    Hay UN solo intento en vuelo, compartido por todas las peticiones: si el
    daemon cuelga, el hilo del builder vive hasta su propio timeout y lanzar
    otro en cada sondeo acumularía hilos (y clientes sin cerrar). Si el intento
    no termina en ``DOCKER_CHECK_TIMEOUT_S`` se responde sin Docker y una
    petición posterior recoge su resultado.
    """
    docker = getattr(app.state, "docker", None)
    if docker is not None:
        return docker
    factory = getattr(app.state, "docker_factory", None)
    if factory is None:  # docker inyectado (tests) o lifespan incompleto
        return None
    build = getattr(app.state, "docker_build", None)
    if build is None:
        build = asyncio.ensure_future(asyncio.to_thread(factory))
        app.state.docker_build = build
    try:
        docker = await asyncio.wait_for(asyncio.shield(build), DOCKER_CHECK_TIMEOUT_S)
    except TimeoutError:
        return None  # sigue en vuelo
    except Exception as exc:
        app.state.docker_build = None
        logger.warning("Docker sigue sin estar disponible: %s", exc or type(exc).__name__)
        return None
    app.state.docker_build = None
    if docker is None:
        return None
    app.state.docker = docker
    app.state.docker_service = docker
    runner = getattr(app.state, "job_runner", None)
    if runner is not None:
        runner.docker_service = docker
    logger.info("Cliente Docker creado tras el arranque")
    return docker


def _settings_of(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    return settings if settings is not None else get_settings()


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    """Healthcheck de infraestructura (SIN envelope, §2.1)."""
    db_ok = await _db_alive(getattr(request.app.state, "db", None))
    docker_ok, image_ok = await _docker_checks(await ensure_docker(request.app))
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
    docker_ok, image_ok = await _docker_checks(await ensure_docker(request.app))
    if not docker_ok:
        raise ApiException(
            "DOCKER_UNAVAILABLE", "El daemon de Docker no responde."
        )

    cores = os.cpu_count() or 1
    data = SystemInfo(
        cores=cores,
        max_threads=min(8, cores),
        runner_image=settings.runner_image,
        runner_image_present=image_ok is True,
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
        catalog=await _catalog_info(request, settings),
    )
    return success_envelope(data.model_dump())


async def _catalog_info(request: Request, settings: Settings) -> CatalogInfo:
    """Bloque ``catalog`` de §2.2 (Fase 5, §11.12.A). **Nunca sale a la red.**

    ``last_checked_at`` se LEE de ``installed_modules`` —lo que dejó el último
    ``POST /catalog/refresh``—; sondear el bucket aquí convertiría el arranque
    de la UI en rehén de un timeout de 15 s, que es justo lo que §11.9 prohíbe.
    ``mode`` es ``admin`` allí donde hay credencial de escritura configurada
    (`TELAR_GCS_CREDENTIALS`) y ``anonymous`` en la imagen del estudiante, que
    solo lee.
    """
    ultimo: str | None = None
    if settings.catalog_enabled:
        db = getattr(request.app.state, "db", None)
        if db is not None:
            try:
                cursor = await db.execute(
                    "SELECT MAX(last_checked_at) FROM installed_modules"
                )
                fila = await cursor.fetchone()
                ultimo = None if fila is None else fila[0]
            except Exception:
                # Un /system que revienta porque falta una tabla sería peor que
                # un /system que dice «no sé cuándo se miró».
                logger.exception("No se pudo leer last_checked_at del catálogo")
    return CatalogInfo(
        enabled=settings.catalog_enabled,
        bucket=settings.catalog_bucket or None,
        mode="admin" if settings.gcs_credentials else "anonymous",
        last_checked_at=ultimo,
    )


def _pyomp_version(runner_image: str) -> str:
    """El tag de la imagen runner ES la versión de pyomp (telar-runner:0.5.1)."""
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
