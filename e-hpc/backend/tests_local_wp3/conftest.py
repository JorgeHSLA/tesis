"""Suite local de WP3 — autosuficiente respecto a WP1/WP2/WP4.

- Stub de ``app.repositories.records`` (firmas EXACTAS de data-model §5,
  transcritas aquí) instalado en ``sys.modules`` ANTES de importar cualquier
  módulo de WP3: los módulos reales de WP1 se escriben en paralelo y esta
  suite no debe depender de ellos.
- Fakes de ProgressRepository/QuizAttemptRepository con las firmas congeladas
  de data-model §5 (incluida la semántica MAX de ``best_quiz_score`` y
  ``None = no tocar``), instrumentados para verificar que las escrituras del
  quiz ocurren DENTRO del write_lock.
- Mini-fixtures de contenido generados por ``content_factory`` (14 lecciones
  sintéticas, 60 preguntas habilitadas — invariantes reales de §4.4).
"""

from __future__ import annotations

import asyncio
import sys
import types
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pytest

# ── sys.path: permitir `pytest backend/tests_local_wp3` desde la raíz ───────
_TESTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _TESTS_DIR.parent
for _path in (str(_BACKEND_DIR), str(_TESTS_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)


def _install_records_stub() -> None:
    """Stubs para NO importar código de WP1 (suite autosuficiente).

    1. ``app.repositories`` (paquete): su ``__init__.py`` real re-exporta los
       repositorios de estado de WP1 (jobs/progress/quiz_attempts). Se instala
       un stub de paquete con ``__path__`` apuntando al directorio real: los
       submódulos de WP3 (``content``) siguen cargando desde disco, pero el
       ``__init__`` de WP1 jamás se ejecuta.
    2. ``app.repositories.records``: firmas EXACTAS de data-model §5,
       transcritas aquí (lo único que consume ``quiz_service``).
    """
    pkg_name = "app.repositories"
    if pkg_name not in sys.modules:
        package = types.ModuleType(pkg_name)
        package.__path__ = [  # type: ignore[attr-defined]
            str(_BACKEND_DIR / "app" / "repositories")
        ]
        sys.modules[pkg_name] = package

    name = "app.repositories.records"
    if name in sys.modules:
        return
    module = types.ModuleType(name)

    @dataclass(frozen=True)
    class QuizAttemptRecord:
        id: str
        lesson_id: str
        answers: dict[str, str]
        score: int
        total: int
        passed: bool
        created_at: str

    @dataclass(frozen=True)
    class LessonProgressRecord:
        lesson_id: str
        viewed: bool
        completed: bool
        best_quiz_score: int | None
        last_job_id: str | None
        updated_at: str

    module.QuizAttemptRecord = QuizAttemptRecord  # type: ignore[attr-defined]
    module.LessonProgressRecord = LessonProgressRecord  # type: ignore[attr-defined]
    sys.modules[name] = module


_install_records_stub()

from app.repositories.records import (  # noqa: E402  (tras el stub)
    LessonProgressRecord,
    QuizAttemptRecord,
)


def _now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


# ─────────────────────────── Fakes (firmas §5) ──────────────────────────────


class FakeDb:
    """Solo lo que usa QuizService: rollback()."""

    def __init__(self) -> None:
        self.rollbacks = 0

    async def rollback(self) -> None:
        self.rollbacks += 1


class FakeProgressRepository:
    """ProgressRepository fake con la semántica congelada del upsert."""

    def __init__(self, lock: asyncio.Lock | None = None) -> None:
        self.rows: dict[str, LessonProgressRecord] = {}
        self.upsert_calls: list[dict[str, object]] = []
        self._lock = lock

    async def get(self, lesson_id: str) -> LessonProgressRecord | None:
        return self.rows.get(lesson_id)

    async def get_all(self) -> list[LessonProgressRecord]:
        return list(self.rows.values())

    async def upsert(
        self,
        lesson_id: str,
        *,
        viewed: bool | None = None,
        completed: bool | None = None,
        best_quiz_score: int | None = None,
        last_job_id: str | None = None,
    ) -> LessonProgressRecord:
        self.upsert_calls.append(
            {
                "lesson_id": lesson_id,
                "viewed": viewed,
                "completed": completed,
                "best_quiz_score": best_quiz_score,
                "last_job_id": last_job_id,
                "lock_held": self._lock.locked() if self._lock else None,
            }
        )
        current = self.rows.get(lesson_id)
        best = current.best_quiz_score if current else None
        if best_quiz_score is not None:  # MAX en SQL
            best = best_quiz_score if best is None else max(best, best_quiz_score)
        record = LessonProgressRecord(
            lesson_id=lesson_id,
            viewed=(current.viewed if current else False)
            if viewed is None
            else viewed,
            completed=(current.completed if current else False)
            if completed is None
            else completed,
            best_quiz_score=best,
            last_job_id=(current.last_job_id if current else None)
            if last_job_id is None
            else last_job_id,
            updated_at=_now_iso(),
        )
        self.rows[lesson_id] = record
        return record


class FakeQuizAttemptRepository:
    """QuizAttemptRepository fake (firma congelada §5)."""

    def __init__(self, lock: asyncio.Lock | None = None) -> None:
        self.rows: list[QuizAttemptRecord] = []
        self.create_calls: list[dict[str, object]] = []
        self.fail_on_create = False
        self._lock = lock

    async def create(self, attempt: QuizAttemptRecord) -> QuizAttemptRecord:
        self.create_calls.append(
            {
                "attempt": attempt,
                "lock_held": self._lock.locked() if self._lock else None,
            }
        )
        if self.fail_on_create:
            raise RuntimeError("fallo simulado del INSERT")
        self.rows.append(attempt)
        return attempt

    async def list_by_lesson(
        self, lesson_id: str, *, limit: int = 10, offset: int = 0
    ) -> tuple[list[QuizAttemptRecord], int]:
        matches = sorted(
            (a for a in self.rows if a.lesson_id == lesson_id),
            key=lambda a: a.created_at,
            reverse=True,
        )
        return matches[offset : offset + limit], len(matches)

    async def best_score(self, lesson_id: str) -> int | None:
        scores = [a.score for a in self.rows if a.lesson_id == lesson_id]
        return max(scores) if scores else None


# ───────────────────────────── Fixtures pytest ──────────────────────────────


@pytest.fixture()
def content_dir(tmp_path: Path) -> Path:
    """Árbol de contenido sintético VÁLIDO (14 lecciones, 60 habilitadas)."""
    from content_factory import make_content

    root = tmp_path / "content"
    make_content(root)
    return root


@pytest.fixture()
def content_repo(content_dir: Path):
    from app.repositories.content import ContentRepository

    return ContentRepository(content_dir)


@pytest.fixture()
def write_lock() -> asyncio.Lock:
    return asyncio.Lock()


@pytest.fixture()
def progress_repo(write_lock: asyncio.Lock) -> FakeProgressRepository:
    return FakeProgressRepository(lock=write_lock)


@pytest.fixture()
def attempts_repo(write_lock: asyncio.Lock) -> FakeQuizAttemptRepository:
    return FakeQuizAttemptRepository(lock=write_lock)


@pytest.fixture()
def fake_db() -> FakeDb:
    return FakeDb()


@pytest.fixture()
def app(content_repo, progress_repo, attempts_repo, write_lock, fake_db):
    """App FastAPI mínima con SOLO los routers de WP3 y state fake.

    Incluye un handler 422→envelope local que imita el de WP1 (errors.py)
    para poder afirmar el shape del contrato sin importar módulos de WP1.
    """
    from fastapi import FastAPI, Request
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    from app.routers import examples, lessons, modules, progress, quizzes

    application = FastAPI()
    for module in (examples, lessons, modules, progress, quizzes):
        application.include_router(module.router)

    application.state.content = content_repo
    application.state.progress = progress_repo
    application.state.quiz_attempts = attempts_repo
    application.state.write_lock = write_lock
    application.state.db = fake_db

    @application.exception_handler(RequestValidationError)
    async def _validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:  # imita errors.py de WP1 (api-contract §1)
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "data": None,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Datos inválidos",
                    "details": exc.errors(),
                },
                "meta": None,
            },
        )

    return application


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        yield test_client
