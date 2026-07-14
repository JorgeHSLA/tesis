"""El write_lock transversal: toda escritura lo toma; concurrencia serializada."""

import asyncio

import pytest

from app import db as db_module
from app.repositories.jobs import JobRepository
from app.repositories.progress import ProgressRepository

from conftest import make_job

pytestmark = pytest.mark.asyncio

FINISH_KWARGS = {
    "status": "completed",
    "exit_code": 0,
    "oom_killed": False,
    "error_detail": None,
    "stdout": "",
    "stderr": "",
    "output_truncated": False,
    "metrics_summary": None,
    "parsed_timings": None,
    "finished_at": "2026-07-12T10:01:00.000Z",
    "wall_time_ms": 10,
}


async def test_finish_espera_al_write_lock(db):
    repo = JobRepository(db)
    await repo.create(make_job())

    async with db_module.write_lock:
        task = asyncio.create_task(repo.finish(make_job().id, **FINISH_KWARGS))
        await asyncio.sleep(0.05)
        assert not task.done()  # bloqueado por el lock ajeno

    await asyncio.wait_for(task, timeout=2)
    assert (await repo.find_by_id(make_job().id)).status == "completed"


async def test_upsert_espera_al_write_lock(db):
    repo = ProgressRepository(db)
    async with db_module.write_lock:
        task = asyncio.create_task(repo.upsert("spmd", viewed=True))
        await asyncio.sleep(0.05)
        assert not task.done()
    rec = await asyncio.wait_for(task, timeout=2)
    assert rec.viewed is True


async def test_create_espera_al_write_lock(db):
    repo = JobRepository(db)
    async with db_module.write_lock:
        task = asyncio.create_task(repo.create(make_job()))
        await asyncio.sleep(0.05)
        assert not task.done()
    created = await asyncio.wait_for(task, timeout=2)
    assert created.id == make_job().id


async def test_escrituras_concurrentes_serializadas(db):
    """N tasks concurrentes sobre la misma conexión: sin errores ni pérdidas."""
    jobs = JobRepository(db)
    progress = ProgressRepository(db)

    async def escribir(i: int):
        await jobs.create(make_job(job_id=f"{i:032d}", created_at=f"2026-07-12T10:00:{i:02d}.000Z"))
        await progress.upsert("spmd", best_quiz_score=i)

    await asyncio.gather(*(escribir(i) for i in range(10)))

    _, total = await jobs.list_recent(limit=1)
    assert total == 10
    rec = await progress.get("spmd")
    assert rec.best_quiz_score == 9  # MAX de todos los upserts
