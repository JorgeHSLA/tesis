"""Fixtures compartidos de la suite local de WP1 (backend-core).

Autosuficiente: NO importa módulos de WP2/WP3 (services/, routers de jobs,
content...). Los repositorios se prueban contra SQLite en memoria y los
routers propios (system/health) contra apps FastAPI parciales con fakes.
"""

import sys
from pathlib import Path

# `app` importable ejecutando pytest desde cualquier cwd.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncio

import aiosqlite
import pytest
import pytest_asyncio

from app import db as db_module
from app.db import apply_schema
from app.repositories.records import JobRecord, QuizAttemptRecord


@pytest.fixture(autouse=True)
def _fresh_write_lock():
    """asyncio.Lock se ata al primer loop que lo usa; pytest-asyncio crea un
    loop por test → lock nuevo por test (en producción hay UN loop)."""
    db_module.write_lock = asyncio.Lock()
    yield


@pytest_asyncio.fixture
async def db():
    """Conexión aiosqlite en memoria con el schema aplicado."""
    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys=ON")
    await apply_schema(conn)
    yield conn
    await conn.close()


def make_job(job_id: str = "a" * 32, **overrides) -> JobRecord:
    """Factory de JobRecord con defaults válidos según data-model §5."""
    fields = {
        "id": job_id,
        "source_kind": "example",
        "example_id": "spmd",
        "lesson_id": "spmd",
        "filename": "piSpmd.py",
        "source_code": "print('hola')\n",
        "threads": 4,
        "timeout_s": 60,
        "runner_image": "ehpc-runner:0.5.1",
        "status": "queued",
        "container_id": None,
        "error_detail": None,
        "exit_code": None,
        "oom_killed": False,
        "stdout": None,
        "stderr": None,
        "output_truncated": False,
        "metrics_summary": None,
        "parsed_timings": None,
        "created_at": "2026-07-12T10:00:00.000Z",
        "started_at": None,
        "finished_at": None,
        "wall_time_ms": None,
    }
    fields.update(overrides)
    return JobRecord(**fields)


def make_attempt(attempt_id: str = "b" * 32, **overrides) -> QuizAttemptRecord:
    """Factory de QuizAttemptRecord con defaults válidos."""
    fields = {
        "id": attempt_id,
        "lesson_id": "spmd",
        "answers": {"spmd-q1": "b", "spmd-q2": "c"},
        "score": 4,
        "total": 5,
        "passed": True,
        "created_at": "2026-07-12T10:00:00.000Z",
    }
    fields.update(overrides)
    return QuizAttemptRecord(**fields)


class FakeDocker:
    """Fake síncrono del puerto docker (solo lo que consume WP1)."""

    def __init__(self, ping_ok: bool = True, image_ok: bool = True) -> None:
        self._ping_ok = ping_ok
        self._image_ok = image_ok
        self.reaped = 0

    def ping(self) -> bool:
        return self._ping_ok

    def image_present(self) -> bool:
        return self._image_ok

    def reap_orphans(self) -> int:
        self.reaped += 1
        return 0


class AsyncFakeDocker:
    """Fake con métodos async — el router debe soportar ambos (interfaz)."""

    def __init__(self, ping_ok: bool = True, image_ok: bool = True) -> None:
        self._ping_ok = ping_ok
        self._image_ok = image_ok

    async def ping(self) -> bool:
        return self._ping_ok

    async def image_present(self) -> bool:
        return self._image_ok


@pytest.fixture
def fake_docker():
    return FakeDocker()
