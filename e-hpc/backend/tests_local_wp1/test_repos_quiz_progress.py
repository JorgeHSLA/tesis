"""QuizAttemptRepository y ProgressRepository contra :memory:."""

import sqlite3

import pytest

from app.repositories.jobs import JobRepository
from app.repositories.progress import ProgressRepository
from app.repositories.quiz_attempts import QuizAttemptRepository

from conftest import make_attempt, make_job

pytestmark = pytest.mark.asyncio


# ── quiz_attempts ────────────────────────────────────────────────────────────


async def test_attempt_create_roundtrip(db):
    repo = QuizAttemptRepository(db)
    created = await repo.create(make_attempt())
    assert created.answers == {"spmd-q1": "b", "spmd-q2": "c"}
    assert created.passed is True and isinstance(created.passed, bool)
    assert created.score == 4 and created.total == 5


async def test_list_by_lesson_paginado_desc(db):
    repo = QuizAttemptRepository(db)
    for i in range(3):
        await repo.create(
            make_attempt(
                attempt_id=f"{i:032d}",
                score=i,
                passed=False,
                created_at=f"2026-07-12T10:00:0{i}.000Z",
            )
        )
    await repo.create(make_attempt(attempt_id="x" * 32, lesson_id="for"))

    page, total = await repo.list_by_lesson("spmd", limit=2, offset=0)
    assert total == 3
    assert [a.id for a in page] == ["2".zfill(32), "1".zfill(32)]  # DESC

    page2, _ = await repo.list_by_lesson("spmd", limit=2, offset=2)
    assert [a.id for a in page2] == ["0".zfill(32)]


async def test_best_score(db):
    repo = QuizAttemptRepository(db)
    assert await repo.best_score("spmd") is None
    await repo.create(make_attempt(attempt_id="1" * 32, score=2))
    await repo.create(make_attempt(attempt_id="2" * 32, score=5))
    await repo.create(make_attempt(attempt_id="3" * 32, score=3))
    assert await repo.best_score("spmd") == 5
    assert await repo.best_score("otra") is None


# ── lesson_progress ──────────────────────────────────────────────────────────


async def test_upsert_crea_con_defaults(db):
    repo = ProgressRepository(db)
    rec = await repo.upsert("spmd", viewed=True)
    assert rec.lesson_id == "spmd"
    assert rec.viewed is True
    assert rec.completed is False
    assert rec.best_quiz_score is None
    assert rec.last_job_id is None
    assert rec.updated_at


async def test_upsert_none_no_toca(db):
    repo = ProgressRepository(db)
    await repo.upsert("spmd", viewed=True, completed=True, best_quiz_score=4)
    rec = await repo.upsert("spmd")  # todo None: solo refresca updated_at
    assert rec.viewed is True
    assert rec.completed is True
    assert rec.best_quiz_score == 4


async def test_upsert_best_score_solo_mejora(db):
    repo = ProgressRepository(db)
    await repo.upsert("spmd", best_quiz_score=4)
    rec = await repo.upsert("spmd", best_quiz_score=2)  # peor: se ignora
    assert rec.best_quiz_score == 4
    rec = await repo.upsert("spmd", best_quiz_score=5)  # mejor: se guarda
    assert rec.best_quiz_score == 5


async def test_upsert_last_job_id_fk(db):
    await JobRepository(db).create(make_job())
    repo = ProgressRepository(db)
    rec = await repo.upsert("spmd", last_job_id=make_job().id)
    assert rec.last_job_id == make_job().id

    with pytest.raises(sqlite3.IntegrityError):
        await repo.upsert("spmd", last_job_id="f" * 32)  # job inexistente

    # el rollback no dejó a medias: el registro previo sigue íntegro
    rec = await repo.get("spmd")
    assert rec.last_job_id == make_job().id


async def test_get_y_get_all(db):
    repo = ProgressRepository(db)
    assert await repo.get("spmd") is None
    assert await repo.get_all() == []
    await repo.upsert("spmd", viewed=True)
    await repo.upsert("for", completed=True)
    todos = await repo.get_all()
    assert {r.lesson_id for r in todos} == {"spmd", "for"}
    uno = await repo.get("for")
    assert uno.completed is True and uno.viewed is False
