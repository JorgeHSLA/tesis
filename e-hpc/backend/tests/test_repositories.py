"""Suite 1 (architecture §11): repositorios contra ``:memory:`` + schema.sql.

CRUD de jobs, guard terminal de ``finish()``/``set_phase`` (0 filas si ya
terminal), upsert de progreso (None = no tocar, MAX de best_quiz_score),
``best_score`` de intentos y serialización del write_lock.
"""

from __future__ import annotations

import asyncio

import pytest

from app import db as db_module
from app.db import apply_schema, get_schema_version, open_db
from app.repositories.jobs import JobRepository
from app.repositories.progress import ProgressRepository
from app.repositories.quiz_attempts import QuizAttemptRepository
from app.repositories.records import QuizAttemptRecord

from conftest import make_job_record


# ─────────────────────────────── db.py ───────────────────────────────────────


async def test_schema_idempotente_y_version(db):
    # aplicar el schema dos veces no rompe (CREATE IF NOT EXISTS)
    await apply_schema(db)
    version = await get_schema_version(db)
    assert version >= 0  # sin migraciones pendientes en v1
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = {row["name"] for row in await cursor.fetchall()}
    assert {"jobs", "quiz_attempts", "lesson_progress", "schema_version"} <= tables


async def test_pragmas_congelados():
    conn = await open_db(":memory:")
    try:
        for pragma, expected in (
            ("journal_mode", {"wal", "memory"}),  # :memory: degrada WAL→memory
            ("foreign_keys", {1}),
            ("busy_timeout", {5000}),
        ):
            cursor = await conn.execute(f"PRAGMA {pragma}")
            row = await cursor.fetchone()
            value = row[0] if not isinstance(row[0], str) else row[0].lower()
            assert value in expected, pragma
    finally:
        await conn.close()


_MINI_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS demo (a INTEGER);
INSERT INTO schema_version (version)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version WHERE version = 1);
-- migration 2
ALTER TABLE demo ADD COLUMN b INTEGER;
"""


async def test_migraciones_por_bloques(tmp_path):
    """Bloques ``-- migration N`` gobernados por schema_version (db.py)."""
    schema_path = tmp_path / "schema.sql"
    schema_path.write_text(_MINI_SCHEMA, encoding="utf-8")
    conn = await open_db(":memory:")
    try:
        await apply_schema(conn, schema_path)
        assert await get_schema_version(conn) == 2
        cursor = await conn.execute("PRAGMA table_info(demo)")
        columns = {row["name"] for row in await cursor.fetchall()}
        assert columns == {"a", "b"}
        # re-aplicar es idempotente: la migración 2 NO se re-ejecuta
        await apply_schema(conn, schema_path)
        assert await get_schema_version(conn) == 2
    finally:
        await conn.close()


async def test_migracion_rota_hace_rollback(tmp_path):
    schema_path = tmp_path / "schema.sql"
    schema_path.write_text(
        _MINI_SCHEMA + "\n-- migration 3\nESTO NO ES SQL;\n", encoding="utf-8"
    )
    conn = await open_db(":memory:")
    try:
        with pytest.raises(Exception):
            await apply_schema(conn, schema_path)
        assert await get_schema_version(conn) == 2  # la 3 no quedó registrada
    finally:
        await conn.close()


async def test_schema_version_sin_tabla_es_cero():
    conn = await open_db(":memory:")
    try:
        assert await get_schema_version(conn) == 0
    finally:
        await conn.close()


# ─────────────────────────── JobRepository ───────────────────────────────────


async def test_jobs_create_y_find(db):
    repo = JobRepository(db)
    created = await repo.create(make_job_record("j1", lesson_id="spmd"))
    assert created.id == "j1"
    assert created.status == "queued"
    found = await repo.find_by_id("j1")
    assert found == created
    assert await repo.find_by_id("nope") is None


async def test_jobs_list_recent_paginacion_y_filtro(db):
    repo = JobRepository(db)
    for i in range(5):
        status = "completed" if i % 2 == 0 else "queued"
        await repo.create(
            make_job_record(
                f"j{i}", status=status, created_at=f"2026-07-13T00:00:0{i}.000Z"
            )
        )
    page, total = await repo.list_recent(limit=2, offset=0)
    assert total == 5
    assert [r.id for r in page] == ["j4", "j3"]  # DESC por created_at
    page2, _ = await repo.list_recent(limit=2, offset=2)
    assert [r.id for r in page2] == ["j2", "j1"]
    completed, total_completed = await repo.list_recent(status="completed")
    assert total_completed == 3
    assert all(r.status == "completed" for r in completed)


async def test_jobs_set_phase_y_guard_terminal(db):
    repo = JobRepository(db)
    await repo.create(make_job_record("j1"))
    await repo.set_phase("j1", "creating")
    await repo.set_phase(
        "j1", "compiling", container_id="cid-1", started_at="2026-07-13T00:00:01.000Z"
    )
    record = await repo.find_by_id("j1")
    assert record.status == "compiling"
    assert record.container_id == "cid-1"
    assert record.started_at == "2026-07-13T00:00:01.000Z"

    await repo.finish(
        "j1", status="completed", exit_code=0, oom_killed=False, error_detail=None,
        stdout="ok\n", stderr="", output_truncated=False, metrics_summary=None,
        parsed_timings=None, finished_at="2026-07-13T00:00:02.000Z", wall_time_ms=1000,
    )
    # guard: set_phase sobre terminal NO cambia nada (0 filas)
    await repo.set_phase("j1", "running")
    record = await repo.find_by_id("j1")
    assert record.status == "completed"


async def test_jobs_finish_guard_carrera_cancel_vs_finish(db):
    """Carrera §3.3: el PRIMER finish gana; el segundo afecta 0 filas."""
    repo = JobRepository(db)
    await repo.create(make_job_record("j1"))
    await repo.finish(
        "j1", status="completed", exit_code=0, oom_killed=False, error_detail=None,
        stdout="done\n", stderr="", output_truncated=False,
        metrics_summary={"samples": 2}, parsed_timings=None,
        finished_at="2026-07-13T00:00:02.000Z", wall_time_ms=500,
    )
    await repo.finish(  # el "canceller" llega tarde
        "j1", status="cancelled", exit_code=None, oom_killed=False, error_detail=None,
        stdout="", stderr="", output_truncated=False, metrics_summary=None,
        parsed_timings=None, finished_at="2026-07-13T00:00:03.000Z", wall_time_ms=None,
    )
    record = await repo.find_by_id("j1")
    assert record.status == "completed"
    assert record.stdout == "done\n"
    assert record.metrics_summary == {"samples": 2}


async def test_jobs_json_roundtrip(db):
    repo = JobRepository(db)
    await repo.create(make_job_record("j1"))
    parsed = {
        "parser_id": "sweep_pi", "kind": "sweep",
        "series": [{"threads": 1, "time_s": 0.8, "speedup": 1.0, "efficiency": 1.0}],
        "extra": {}, "correct": None,
    }
    metrics = {"samples": 3, "cpu_percent_max": 792.4}
    await repo.finish(
        "j1", status="completed", exit_code=0, oom_killed=False, error_detail=None,
        stdout="s", stderr="e", output_truncated=False, metrics_summary=metrics,
        parsed_timings=parsed, finished_at="2026-07-13T00:00:02.000Z",
        wall_time_ms=100,
    )
    record = await repo.find_by_id("j1")
    assert record.parsed_timings == parsed
    assert record.metrics_summary == metrics
    assert record.oom_killed is False
    assert record.output_truncated is False


async def test_jobs_mark_orphans_failed(db):
    repo = JobRepository(db)
    for i, status in enumerate(["queued", "creating", "running", "completed"]):
        await repo.create(make_job_record(f"j{i}", status=status))
    orphaned = await repo.mark_orphans_failed()
    assert orphaned == 3
    for i in range(3):
        record = await repo.find_by_id(f"j{i}")
        assert record.status == "failed"
        assert record.error_detail == "orphaned_on_restart"
    intact = await repo.find_by_id("j3")
    assert intact.status == "completed"
    assert intact.error_detail is None


async def test_write_lock_serializa_escrituras_concurrentes(db):
    """Regla transversal data-model §2: escrituras concurrentes no se pisan."""
    repo = JobRepository(db)

    async def create_one(i: int) -> None:
        await repo.create(make_job_record(f"c{i}"))

    await asyncio.gather(*(create_one(i) for i in range(20)))
    _, total = await repo.list_recent(limit=100)
    assert total == 20
    assert not db_module.write_lock.locked()


async def test_create_duplicado_hace_rollback_y_lanza(db):
    repo = JobRepository(db)
    await repo.create(make_job_record("dup"))
    with pytest.raises(Exception):
        await repo.create(make_job_record("dup"))
    assert not db_module.write_lock.locked()  # el lock se libera tras rollback


# ───────────────────────── ProgressRepository ────────────────────────────────


async def test_progress_upsert_none_no_toca(db):
    repo = ProgressRepository(db)
    first = await repo.upsert("spmd", viewed=True)
    assert first.viewed is True and first.completed is False
    assert first.best_quiz_score is None

    second = await repo.upsert("spmd", completed=True)  # viewed=None → no tocar
    assert second.viewed is True and second.completed is True

    third = await repo.upsert("spmd", viewed=False)
    assert third.viewed is False and third.completed is True


async def test_progress_best_quiz_score_solo_mejora(db):
    repo = ProgressRepository(db)
    await repo.upsert("spmd", best_quiz_score=3)
    worse = await repo.upsert("spmd", best_quiz_score=2)
    assert worse.best_quiz_score == 3  # MAX en SQL
    better = await repo.upsert("spmd", best_quiz_score=5)
    assert better.best_quiz_score == 5
    untouched = await repo.upsert("spmd", viewed=True)  # score None → conserva
    assert untouched.best_quiz_score == 5


async def test_progress_last_job_id_y_get_all(db):
    # last_job_id tiene FK a jobs(id): el job debe existir
    await JobRepository(db).create(make_job_record("01a2"))
    repo = ProgressRepository(db)
    await repo.upsert("spmd", last_job_id="01a2")
    await repo.upsert("for", viewed=True)
    record = await repo.get("spmd")
    assert record.last_job_id == "01a2"
    assert record.updated_at  # SIEMPRE poblado
    assert await repo.get("nope") is None
    all_records = await repo.get_all()
    assert [r.lesson_id for r in all_records] == ["for", "spmd"]


# ──────────────────────── QuizAttemptRepository ──────────────────────────────


def make_attempt(attempt_id: str, **over) -> QuizAttemptRecord:
    base = dict(
        id=attempt_id, lesson_id="spmd", answers={"spmd-q1": "b"},
        score=4, total=5, passed=True, created_at="2026-07-13T00:00:00.000Z",
    )
    base.update(over)
    return QuizAttemptRecord(**base)


async def test_attempts_create_list_best(db):
    repo = QuizAttemptRepository(db)
    await repo.create(make_attempt("a1", score=3, passed=False,
                                   created_at="2026-07-13T00:00:01.000Z"))
    await repo.create(make_attempt("a2", score=5,
                                   created_at="2026-07-13T00:00:02.000Z"))
    await repo.create(make_attempt("a3", lesson_id="for", score=1, passed=False))

    attempts, total = await repo.list_by_lesson("spmd", limit=10)
    assert total == 2
    assert [a.id for a in attempts] == ["a2", "a1"]  # DESC por created_at
    assert attempts[0].answers == {"spmd-q1": "b"}
    assert attempts[0].passed is True

    page, total = await repo.list_by_lesson("spmd", limit=1, offset=1)
    assert total == 2 and [a.id for a in page] == ["a1"]

    assert await repo.best_score("spmd") == 5
    assert await repo.best_score("for") == 1
    assert await repo.best_score("nada") is None
