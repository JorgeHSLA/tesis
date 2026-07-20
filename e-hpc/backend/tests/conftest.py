"""Fixtures de la suite integral WP9 (backend/tests).

- DB SQLite en memoria + ``schema.sql`` real.
- ``FakeDockerService`` (tests/fakes/fake_docker.py) implementando el
  Protocol ``DockerServicePort`` — TODA la suite corre sin daemon Docker.
- App FastAPI de integración: mismos routers/handlers/repositorios REALES
  del backend, con el docker service inyectado (dependency override por
  ``app.state``, la costura de inyección congelada en architecture §11).
- Contenido REAL del repo (``app/content``) cargado una vez por sesión.
"""

from __future__ import annotations

import asyncio
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

# `import app...` debe resolver contra backend/ desde cualquier cwd;
# `import fakes...` contra tests/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
for _p in (str(BACKEND_DIR), str(TESTS_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db as db_module
from app.config import Settings
from app.db import apply_schema, open_db
from app.errors import register_error_handlers
from app.repositories.content import ContentRepository
from app.repositories.jobs import JobRepository
from app.repositories.progress import ProgressRepository
from app.repositories.quiz_attempts import QuizAttemptRepository
from app.repositories.records import JobRecord
from app.services.job_runner import JobRunner
from app.tools.seed_content import seed_content_into

from fakes.fake_docker import FakeDockerService

CONTENT_DIR = BACKEND_DIR / "app" / "content"
STDOUT_DIR = Path(__file__).parent / "fixtures" / "stdout"

TERMINAL = frozenset({"completed", "failed", "timeout", "cancelled"})


def load_stdout(name: str) -> str:
    """Fixture literal de ``tests/fixtures/stdout`` (examples-content §6)."""
    return (STDOUT_DIR / name).read_text(encoding="utf-8")


# ─────────────────────────────── fixtures base ───────────────────────────────


@pytest.fixture(autouse=True)
def _fresh_write_lock():
    """El lock se ata al primer loop que lo usa; pytest-asyncio y
    TestClient crean loops distintos → lock nuevo por test (en producción
    hay UN solo loop). Se usa la clase REENTRANTE real (data-model §2)."""
    db_module.write_lock = db_module.ReentrantWriteLock()
    yield


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Settings de test aislados del entorno del host."""
    return Settings(
        db_path=str(tmp_path / "ehpc.db"),
        jobs_dir=str(tmp_path / "jobs"),
        allowed_origins="http://localhost:5173,http://localhost:8080,null",
        code_delivery="bind",
        runner_image="ehpc-runner:0.5.1",
        max_timeout_s=120,
        max_concurrent_jobs=2,
        max_code_bytes=262144,
        max_output_bytes=262144,
    )


@pytest_asyncio.fixture
async def db():
    """Conexión aiosqlite ``:memory:`` con el schema.sql REAL aplicado."""
    conn = await open_db(":memory:")
    await apply_schema(conn)
    yield conn
    await conn.close()


async def _seed_and_load(content_dir: Path = CONTENT_DIR) -> ContentRepository:
    """Siembra una DB ``:memory:`` desde fixtures y devuelve el snapshot DB.

    El snapshot es inmutable (records ``frozen`` + tuplas) y queda
    completamente desligado de la conexión: por eso puede cerrarse la DB y
    devolver el repo. Fase 4: la fuente runtime es la DB, sembrada desde los
    mismos fixtures → el snapshot es byte-idéntico al de ``from_fixtures``.
    """
    conn = await open_db(":memory:")
    try:
        await apply_schema(conn)
        await seed_content_into(conn, content_dir=content_dir)
        return await ContentRepository.load(conn)
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def real_content() -> ContentRepository:
    """ContentRepository de runtime (Fase 4): DB sembrada desde los fixtures
    REALES + ``ContentRepository.load``. Mismo tipo e interfaz que Fase 3; el
    snapshot inmutable hace que sea igual campo-a-campo a ``from_fixtures``."""
    return asyncio.run(_seed_and_load())


@pytest.fixture
def fake_docker() -> FakeDockerService:
    return FakeDockerService()


# ─────────────────────────── registros de prueba ─────────────────────────────


def make_job_record(job_id: str, **over) -> JobRecord:
    base = dict(
        id=job_id,
        source_kind="editor",
        example_id=None,
        lesson_id=None,
        filename="main.py",
        source_code="print('x')\n",
        threads=2,
        timeout_s=30,
        runner_image="ehpc-runner:0.5.1",
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
        created_at="2026-07-13T00:00:00.000Z",
        started_at=None,
        finished_at=None,
        wall_time_ms=None,
    )
    base.update(over)
    return JobRecord(**base)


# ─────────────────────────── app de integración ──────────────────────────────


def build_app(
    *,
    settings: Settings,
    docker: FakeDockerService,
    content=None,
    content_dir: Path = CONTENT_DIR,
    flush_interval_s: float = 0.02,
    subscriber_queue_max: int = 200,
    terminal_retention_s: float = 0.0,
) -> FastAPI:
    """App con los routers y handlers REALES y estado como el lifespan de WP1,
    pero DB en memoria y docker service inyectado (fake).

    Fase 4: la DB in-memory se siembra desde los fixtures y
    ``app.state.content`` se carga DESDE la DB (fuente runtime), replicando el
    lifespan de producción. El parámetro ``content`` se mantiene por compat con
    tests de Fase 3 pero es redundante: el snapshot de DB es byte-idéntico al
    de fixtures (records frozen)."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        conn = await open_db(":memory:")
        await apply_schema(conn)
        await seed_content_into(conn, content_dir=content_dir)
        app.state.db = conn
        app.state.settings = settings
        app.state.jobs = {}
        app.state.docker = docker
        app.state.docker_service = docker
        repo = JobRepository(conn)
        app.state.job_repo = repo
        app.state.progress = ProgressRepository(conn)
        app.state.quiz_attempts = QuizAttemptRepository(conn)
        # Wiring REAL de producción (main.py:112): se comparte la MISMA
        # instancia que usan los repos por dentro. Con ``ReentrantWriteLock``
        # (data-model §2) la unidad intento→progreso de QuizService puede
        # sostener el lock y dejar que los repos lo re-adquieran sin
        # autobloquearse (WP9-01 corregido).
        app.state.write_lock = db_module.write_lock
        app.state.job_runner = JobRunner(
            docker_service=docker,
            job_repo=repo,
            settings=settings,
            registry=app.state.jobs,
            flush_interval_s=flush_interval_s,
            subscriber_queue_max=subscriber_queue_max,
            progress=app.state.progress,  # wiring real (main.py): last_job_id
            # 0 por defecto: los tests históricos fuerzan la vía DB con
            # wait_registry_empty; los de BL-09 activan la retención.
            terminal_retention_s=terminal_retention_s,
        )
        # Fuente runtime de Fase 4: el snapshot se carga DESDE la DB sembrada.
        app.state.content = await ContentRepository.load(conn)
        try:
            yield
        finally:
            await conn.close()

    from app.routers import (
        examples,
        jobs,
        lessons,
        modules,
        progress,
        quizzes,
        system,
        ws,
    )

    app = FastAPI(lifespan=lifespan)
    register_error_handlers(app)
    app.include_router(system.router)
    app.include_router(examples.router)
    app.include_router(modules.router)
    app.include_router(lessons.router)
    app.include_router(quizzes.router)
    app.include_router(progress.router)
    app.include_router(jobs.router)
    app.include_router(ws.router)
    return app


@pytest.fixture
def app(settings, fake_docker, real_content) -> FastAPI:
    return build_app(settings=settings, docker=fake_docker, content=real_content)


@pytest.fixture
def client(app):
    """TestClient con lifespan (repos reales sobre :memory: + docker fake)."""
    with TestClient(app) as test_client:
        yield test_client


# ────────────────────────────── helpers HTTP ─────────────────────────────────


def wait_terminal(client: TestClient, job_id: str, timeout: float = 10.0) -> dict:
    """Polling REST hasta estado terminal; devuelve el bloque ``data``."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/jobs/{job_id}")
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        if data["status"] in TERMINAL:
            return data
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} no llegó a terminal en {timeout}s")


def wait_registry_empty(app: FastAPI, job_id: str, timeout: float = 10.0) -> None:
    """Espera el paso 5 de §3.4 (retirada del registro en memoria)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if job_id not in app.state.jobs:
            return
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} sigue en app.state.jobs")
