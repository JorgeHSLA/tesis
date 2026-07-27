"""Aplicación FastAPI de E-HPC — estado FINAL (architecture §3.4, §9, §10).

Lifespan (orden congelado):
1. abre la DB (PRAGMAs) y aplica ``schema.sql`` idempotente,
2. crea el docker service (inyectable por puerto para tests),
3. reaper de huérfanos POR INTERFAZ (``reap_orphans()``, lo implementa WP2)
   y ``mark_orphans_failed()`` en DB,
4. auto-seed condicional del contenido (gobernado por el marcador persistente
   ``content_seeded_at`` de ``app_meta``, BL-21) y carga del snapshot desde la
   DB (``ContentRepository.load`` es la fuente de Fase 4),
5. registro de jobs en memoria ``app.state.jobs`` (1 worker uvicorn).

El modo autoría (admin) es una variante de despliegue gateada por
``EHPC_ADMIN_MODE`` (``settings.admin_enabled``): sin token ni sesión.

CORS: lista de §10.5 con ``allow_credentials=False`` (incluye ``"null"`` por
Electron ``file://`` — riesgo residual documentado en api-contract).
"""

import asyncio
import inspect
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db as database
from app.config import Settings, get_settings
from app.errors import register_error_handlers
from app.repositories.jobs import JobRepository
from app.repositories.progress import ProgressRepository
from app.repositories.quiz_attempts import QuizAttemptRepository
from app.repositories.content import ContentRepository
from app.routers import system as system_router
from app.routers.system import BACKEND_VERSION
from app.services.job_runner import JobRunner
from app.tools.seed_content import (
    backfill_seed_marker,
    get_seed_marker,
    seed_content_into,
)

logger = logging.getLogger("ehpc.main")


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _build_docker_service(settings: Settings) -> Any:
    """Construye el docker service real (módulo único de WP2, §5)."""
    from app.services import docker_service as docker_module

    factory = getattr(docker_module, "create_docker_service", None)
    if callable(factory):
        return factory(settings)
    return docker_module.DockerService(settings)  # type: ignore[attr-defined]


async def _seed_content_if_unseeded(db_conn: Any) -> None:
    """Auto-seed gobernado por el marcador persistente ``content_seeded_at``
    (BL-21): «lessons vacía» no distingue "nunca sembrada" de "vaciada a
    propósito por el admin", así que dejó de ser la condición.

    - Marcador presente → no sembrar (aunque el catálogo esté vacío).
    - Sin marcador y ``lessons`` con filas → DB poblada antes de la migración
      3: backfill del marcador sin tocar el contenido.
    - Sin marcador y ``lessons`` vacía → primer arranque real: sembrar (el
      seeder deja el marcador en la misma transacción).
    """
    if await get_seed_marker(db_conn) is not None:
        return
    async with db_conn.execute("SELECT COUNT(*) FROM lessons") as cursor:
        row = await cursor.fetchone()
    if (row[0] if row is not None else 0) > 0:
        await backfill_seed_marker(db_conn)
        return
    await seed_content_into(db_conn)


async def _reap_orphans(docker: Any, db_conn: Any) -> None:
    """Reaper por interfaz + huérfanos en DB (architecture §3, punto 8)."""
    if docker is not None:
        try:
            await _maybe_await(docker.reap_orphans())
        except Exception:
            logger.exception("Reaper de contenedores huérfanos fallido")
    orphaned = await JobRepository(db_conn).mark_orphans_failed()
    if orphaned:
        logger.warning("%d jobs huérfanos marcados failed/orphaned_on_restart", orphaned)


def create_app(
    *,
    settings: Settings | None = None,
    docker_service: Any | None = None,
) -> FastAPI:
    """Factory de la app; ``docker_service`` es inyectable por puerto."""
    cfg = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        db_path = cfg.db_path_expanded
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_conn = await database.open_db(str(db_path))
        await database.apply_schema(db_conn)
        await _seed_content_if_unseeded(db_conn)  # auto-seed condicional (Fase 4)
        app.state.db = db_conn
        app.state.settings = cfg
        app.state.jobs = {}  # registro en memoria por job (architecture §3.3)

        docker = docker_service
        if docker is None:
            try:
                docker = _build_docker_service(cfg)
            except Exception:
                # El backend arranca igualmente: /health informa y /system
                # responde 503 DOCKER_UNAVAILABLE (liveness ≠ readiness).
                logger.exception("No se pudo crear el docker service")
                docker = None
        app.state.docker = docker
        app.state.docker_service = docker  # alias esperado por routers WP2

        await _reap_orphans(docker, db_conn)

        # Repositorios de estado (firmas congeladas data-model §5) y runner
        # (WP2) — inyectados en app.state para los routers WP2/WP3.
        job_repo = JobRepository(db_conn)
        app.state.job_repo = job_repo
        app.state.progress = ProgressRepository(db_conn)
        app.state.quiz_attempts = QuizAttemptRepository(db_conn)
        app.state.write_lock = database.write_lock
        # BL-19: lock de lectura DEDICADO para los GET admin (no el write_lock
        # transversal) — evita que un dashboard admin serialice finish()/quiz.
        app.state.content_read_lock = asyncio.Lock()
        app.state.job_runner = JobRunner(
            docker_service=docker,
            job_repo=job_repo,
            settings=cfg,
            registry=app.state.jobs,
            progress=app.state.progress,  # §7.1: last_job_id al completar
        )

        # Fuente de contenido de Fase 4: el snapshot se carga DESDE la DB
        # (sembrada arriba), no desde los fixtures directamente.
        app.state.content = await ContentRepository.load(db_conn)
        try:
            yield
        finally:
            runner = getattr(app.state, "job_runner", None)
            if runner is not None:
                # retenciones de handles terminales y kills en vuelo (§3.4)
                await runner.shutdown()
            await db_conn.close()

    app = FastAPI(title="E-HPC API", version=BACKEND_VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.allowed_origins_list,  # incluye "null" (Electron)
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    _include_routers(app)
    return app


def _include_routers(app: FastAPI) -> None:
    """TODOS los routers del contrato (§9). Cada router define sus paths
    completos (incluido el prefijo ``/api/v1`` y ``/ws``): se incluyen sin
    ``prefix``."""
    from app.routers import (
        examples,
        jobs,
        lessons,
        modules,
        progress,
        quizzes,
        ws,
    )

    # El router admin es OPCIONAL a nivel de ARTEFACTO (Nivel 3, seguridad por
    # AUSENCIA — ver backend/Dockerfile). En el build "estudiante"
    # (EHPC_ADMIN_BUILD=0) el módulo admin NO se copia a la imagen: su import
    # falla y el router NO se registra → /api/v1/admin/* responde 404. En el
    # build admin (o contra el source, p. ej. los tests) el módulo existe y el
    # runtime lo sigue gateando EHPC_ADMIN_MODE (api-contract §10.0).
    #
    # Se captura ``ImportError`` (NO solo ``ModuleNotFoundError``): cuando el
    # archivo falta y ``app.routers`` es un paquete, ``from app.routers import
    # admin`` lanza ``ImportError: cannot import name 'admin' from 'app.routers'``
    # (verificado construyendo la imagen estudiante). ``ModuleNotFoundError`` es
    # subclase de ``ImportError``, así que este ``except`` cubre ambos casos.
    try:
        from app.routers import admin as _admin
    except ImportError:
        _admin = None

    app.include_router(system_router.router)
    app.include_router(examples.router)
    app.include_router(modules.router)
    app.include_router(lessons.router)
    app.include_router(quizzes.router)
    app.include_router(progress.router)
    app.include_router(jobs.router)
    app.include_router(ws.router)
    if _admin is not None:
        app.include_router(_admin.router)  # §10.2-§10.6 CRUD admin (gate runtime EHPC_ADMIN_MODE)


app = create_app()
