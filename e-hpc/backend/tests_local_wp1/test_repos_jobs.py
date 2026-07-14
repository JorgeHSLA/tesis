"""JobRepository contra :memory:: CRUD, paginación, guard de terminales."""

import pytest

from app.repositories.jobs import TERMINAL_STATUSES, JobRepository

from conftest import make_job

pytestmark = pytest.mark.asyncio


async def test_create_y_find_roundtrip(db):
    repo = JobRepository(db)
    job = make_job(metrics_summary={"samples": 3, "cpu_percent_max": 200.0})
    created = await repo.create(job)
    assert created.id == job.id
    assert created.status == "queued"

    found = await repo.find_by_id(job.id)
    assert found is not None
    assert found.source_code == job.source_code
    assert found.metrics_summary == {"samples": 3, "cpu_percent_max": 200.0}
    assert found.parsed_timings is None
    assert found.oom_killed is False and isinstance(found.oom_killed, bool)
    assert found.output_truncated is False


async def test_find_by_id_inexistente(db):
    assert await JobRepository(db).find_by_id("no-existe") is None


async def test_create_duplicado_propaga_y_rollback(db):
    import sqlite3

    repo = JobRepository(db)
    await repo.create(make_job())
    with pytest.raises(sqlite3.IntegrityError):
        await repo.create(make_job())  # mismo id: PK
    _, total = await repo.list_recent()
    assert total == 1  # el rollback no dejó basura ni transacción abierta


async def test_list_recent_orden_paginacion_y_filtro(db):
    repo = JobRepository(db)
    for i in range(5):
        status = "completed" if i % 2 == 0 else "queued"
        await repo.create(
            make_job(
                job_id=f"{i:032d}",
                status=status,
                created_at=f"2026-07-12T10:00:0{i}.000Z",
            )
        )

    page, total = await repo.list_recent(limit=2, offset=0)
    assert total == 5
    assert [j.id for j in page] == ["4".zfill(32), "3".zfill(32)]  # DESC

    page2, total2 = await repo.list_recent(limit=2, offset=2)
    assert total2 == 5
    assert [j.id for j in page2] == ["2".zfill(32), "1".zfill(32)]

    solo_completed, total_c = await repo.list_recent(status="completed")
    assert total_c == 3
    assert all(j.status == "completed" for j in solo_completed)


async def test_set_phase_actualiza_no_terminal(db):
    repo = JobRepository(db)
    await repo.create(make_job())
    await repo.set_phase(
        make_job().id, "running", container_id="cafe1234", started_at="2026-07-12T10:00:01.000Z"
    )
    job = await repo.find_by_id(make_job().id)
    assert job.status == "running"
    assert job.container_id == "cafe1234"
    assert job.started_at == "2026-07-12T10:00:01.000Z"

    # sin kwargs opcionales: conserva los valores previos
    await repo.set_phase(job.id, "compiling")
    job = await repo.find_by_id(job.id)
    assert job.status == "compiling"
    assert job.container_id == "cafe1234"
    assert job.started_at == "2026-07-12T10:00:01.000Z"


async def _finish(repo, job_id, status="completed", **overrides):
    kwargs = {
        "status": status,
        "exit_code": 0,
        "oom_killed": False,
        "error_detail": None,
        "stdout": "ok\n",
        "stderr": "",
        "output_truncated": False,
        "metrics_summary": {"samples": 1},
        "parsed_timings": None,
        "finished_at": "2026-07-12T10:01:00.000Z",
        "wall_time_ms": 1234,
    }
    kwargs.update(overrides)
    await repo.finish(job_id, **kwargs)


async def test_finish_escribe_resultado(db):
    repo = JobRepository(db)
    await repo.create(make_job())
    await _finish(repo, make_job().id, parsed_timings={"kind": "pair", "correct": True})
    job = await repo.find_by_id(make_job().id)
    assert job.status == "completed"
    assert job.exit_code == 0
    assert job.stdout == "ok\n"
    assert job.parsed_timings == {"kind": "pair", "correct": True}
    assert job.wall_time_ms == 1234


@pytest.mark.parametrize("terminal", TERMINAL_STATUSES)
async def test_guard_set_phase_rechaza_sobre_terminal(db, terminal):
    repo = JobRepository(db)
    await repo.create(make_job())
    await _finish(repo, make_job().id, status=terminal)

    await repo.set_phase(make_job().id, "running")  # 0 filas: rechazada
    job = await repo.find_by_id(make_job().id)
    assert job.status == terminal


async def test_guard_finish_no_sobrescribe_terminal(db):
    repo = JobRepository(db)
    await repo.create(make_job())
    await _finish(repo, make_job().id, status="cancelled", exit_code=137)
    # carrera cancel-vs-finish: el segundo finish pierde
    await _finish(repo, make_job().id, status="completed", exit_code=0, stdout="tarde\n")
    job = await repo.find_by_id(make_job().id)
    assert job.status == "cancelled"
    assert job.exit_code == 137
    assert job.stdout == "ok\n"


async def test_mark_orphans_failed(db):
    repo = JobRepository(db)
    for i, status in enumerate(["queued", "creating", "compiling", "running", "completed"]):
        await repo.create(make_job(job_id=f"{i:032x}", status=status))

    n = await repo.mark_orphans_failed()
    assert n == 4

    for i in range(4):
        job = await repo.find_by_id(f"{i:032x}")
        assert job.status == "failed"
        assert job.error_detail == "orphaned_on_restart"

    intacto = await repo.find_by_id(f"{4:032x}")
    assert intacto.status == "completed"
    assert intacto.error_detail is None

    # segunda pasada: ya no hay huérfanos
    assert await repo.mark_orphans_failed() == 0
