"""Suite 3 (architecture §11): job_runner con drainer, kill_reason y carreras.

Repositorio REAL sobre ``:memory:`` + FakeRunner scriptable. Casos: happy
path, timeout, OOM, truncado 256 KB, cancel en queued y en running, carrera
cancel-vs-finish (guard), drainer sin clientes, fan-out ×2, cliente lento,
sandbox_error y orden de terminación §3.4.
"""

from __future__ import annotations

import asyncio

import pytest

from app.repositories.jobs import JobRepository
from app.services.job_runner import (
    KILL_CANCEL,
    KILL_NONE,
    KILL_OUTPUT_LIMIT,
    KILL_TIMEOUT,
    JobHandle,
    JobRunner,
    compute_metrics,
    run_startup_reaper,
)

from conftest import load_stdout, make_job_record
from fakes.fake_docker import (
    FakeDockerService,
    FakeExecution,
    first_stats_sample,
    stats_sample,
)


def make_runner(docker: FakeDockerService, repo, settings, **over) -> JobRunner:
    return JobRunner(
        docker_service=docker,
        job_repo=repo,
        settings=settings,
        flush_interval_s=over.pop("flush_interval_s", 0.01),
        # sin retención por defecto: los tests históricos asumen la retirada
        # inmediata del registro (§3.4 paso 5); BL-09 la activa a propósito.
        terminal_retention_s=over.pop("terminal_retention_s", 0.0),
        **over,
    )


async def launch(
    runner: JobRunner, repo: JobRepository, job_id: str, *,
    threads: int = 2, timeout_s: int = 30, parser_id: str = "none",
    source_code: str = "print('x')\n", wait_timeout_s: int | None = None,
    lesson_id: str | None = None,
) -> JobHandle:
    """Crea la fila (queued) y arranca el runner. ``wait_timeout_s`` permite
    un timeout de espera menor que el mínimo del CHECK de la DB (5s)."""
    await repo.create(make_job_record(
        job_id, threads=threads, timeout_s=timeout_s, source_code=source_code,
        lesson_id=lesson_id,
    ))
    return runner.start(
        job_id=job_id, source_code=source_code, threads=threads,
        timeout_s=timeout_s if wait_timeout_s is None else wait_timeout_s,
        parser_id=parser_id, lesson_id=lesson_id,
    )


async def wait_phase(handle: JobHandle, *phases: str, timeout: float = 5.0) -> None:
    async def _poll():
        while handle.phase not in phases:
            await asyncio.sleep(0.005)

    await asyncio.wait_for(_poll(), timeout)


def drain(queue: asyncio.Queue) -> list:
    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    return items


# ────────────────────────────── happy path ───────────────────────────────────


async def test_happy_path_completed(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(FakeExecution(
        stdout=[b"hola\n", b"mundo\n"],
        stats=[first_stats_sample(), stats_sample(pids=9)],
        exit_code=0,
    ))
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)

    record = await repo.find_by_id("j1")
    assert record.status == "completed"
    assert record.exit_code == 0
    assert record.error_detail is None
    assert record.stdout == "hola\nmundo\n"
    assert record.stderr == ""
    assert record.output_truncated is False
    assert record.started_at is not None and record.finished_at is not None
    assert record.wall_time_ms is not None and record.wall_time_ms >= 0
    assert record.container_id == "fake-cid-0123456789abcdef"
    # metrics_summary: la 1ª muestra (sin precpu) se descarta
    assert record.metrics_summary["samples"] == 1
    assert record.metrics_summary["pids_max"] == 9
    # §3.4 paso 5: el registro se vacía al final
    assert runner.registry == {}
    assert runner.get_active("j1") is None
    # limpieza de recursos (§3.4 paso 4)
    assert docker.running["j1"].removed is True
    assert docker.cleaned == ["j1"]


async def test_happy_path_con_parser(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(FakeExecution(
        stdout=[load_stdout("sweep_transporte.txt").encode()],
    ))
    handle = await launch(runner, repo, "j1", parser_id="sweep_transporte")
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "completed"
    assert record.parsed_timings["kind"] == "sweep"
    assert len(record.parsed_timings["series"]) == 4
    assert record.parsed_timings["series"][1]["speedup"] == 2.84  # del contrato


async def test_exit_distinto_de_cero_failed_sin_detail(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(FakeExecution(
        stdout=[b"Traceback...\n"], stderr=[b"ZeroDivisionError\n"], exit_code=1,
    ))
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "failed"
    assert record.exit_code == 1
    assert record.error_detail is None  # tabla §3.3: exit≠0 sin OOM
    assert record.stderr == "ZeroDivisionError\n"


# ──────────────────────────── timeout / OOM ──────────────────────────────────


async def test_timeout_wall_clock(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    execution = docker.queue_execution(FakeExecution(hang=True))
    handle = await launch(runner, repo, "j1", wait_timeout_s=0)  # wait(0) → timeout
    await asyncio.wait_for(handle.task, 10)
    assert handle.kill_reason == KILL_TIMEOUT
    assert execution.killed is True
    record = await repo.find_by_id("j1")
    assert record.status == "timeout"
    assert record.error_detail == "wall_timeout"
    assert record.exit_code == 137  # exit real tras el kill


async def test_oom_killed_137(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(FakeExecution(exit_code=137, oom=True))
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "failed"
    assert record.error_detail == "oom"
    assert record.oom_killed is True


# ─────────────────────── truncado 256 KB (drainer §3.2) ──────────────────────


async def test_output_truncado_mata_y_falla(db, settings):
    small = settings.model_copy(update={"max_output_bytes": 512})
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, small)
    execution = docker.queue_execution(FakeExecution(
        stdout=[b"x" * 100 + b"\n"], hang=True, repeat_last=True,
    ))
    handle = await launch(runner, repo, "j1")
    _, queue, _ = runner.subscribe(handle)
    await asyncio.wait_for(handle.task, 10)

    assert handle.kill_reason == KILL_OUTPUT_LIMIT
    assert execution.killed is True
    record = await repo.find_by_id("j1")
    assert record.status == "failed"
    assert record.error_detail == "output_limit_exceeded"
    assert record.output_truncated is True
    assert len(record.stdout.encode()) <= 512  # presupuesto respetado
    assert record.parsed_timings is None  # truncado ⇒ jamás se parsea

    messages = drain(queue)
    errors = [m for m in messages if m and m["type"] == "error"]
    assert any(e["code"] == "OUTPUT_TRUNCATED" for e in errors)
    eofs = [m for m in messages if m and m["type"] == "eof"]
    assert eofs and eofs[-1]["truncated"] is True


# ───────────────────────────── cancelación §3.3 ──────────────────────────────


async def test_cancel_en_queued_no_crea_contenedor(db, settings):
    one = settings.model_copy(update={"max_concurrent_jobs": 1})
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, one)
    blocker_exec = docker.queue_execution(FakeExecution(hang=True))
    blocker = await launch(runner, repo, "ocupa")
    await wait_phase(blocker, "compiling", "running")

    queued = await launch(runner, repo, "encolado")
    assert queued.phase == "queued"
    result = await runner.cancel("encolado")
    assert result == "cancelling"
    record = await repo.find_by_id("encolado")
    assert record.status == "cancelled"  # ya en DB, sin esperar al task

    blocker_exec.finish(exit_code=0)
    await asyncio.wait_for(blocker.task, 10)
    await asyncio.wait_for(queued.task, 10)
    # el task del cancelado JAMÁS llegó a containers.create
    assert [c["job_id"] for c in docker.run_calls] == ["ocupa"]
    assert "encolado" not in docker.prepared
    record = await repo.find_by_id("encolado")
    assert record.status == "cancelled"
    assert record.error_detail is None


async def test_cancel_en_running_kill_reason_antes_de_kill(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    execution = docker.queue_execution(FakeExecution(
        stdout=[b"corriendo\n"], hang=True,
    ))
    handle = await launch(runner, repo, "j1")
    await wait_phase(handle, "compiling", "running")
    result = await runner.cancel("j1")
    assert result == "cancelling"
    assert handle.kill_reason == KILL_CANCEL  # escrito ANTES del kill
    await asyncio.wait_for(handle.task, 10)
    assert execution.killed is True
    record = await repo.find_by_id("j1")
    assert record.status == "cancelled"
    assert record.error_detail is None


async def test_cancel_idempotente(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(FakeExecution(stdout=[b"x\n"], hang=True))
    handle = await launch(runner, repo, "j1")
    await wait_phase(handle, "compiling", "running")
    assert await runner.cancel("j1") == "cancelling"
    assert await runner.cancel("j1") == "cancelling"  # repetir no rompe
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "cancelled"


async def test_carrera_cancel_vs_finish_guard(db, settings):
    """El job termina solo; un cancel tardío no sobrescribe el terminal."""
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(FakeExecution(stdout=[b"done\n"], exit_code=0))
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)
    assert await runner.cancel("j1") is None  # ya no activo (closed)
    # ni siquiera un finish directo pisa el terminal (guard SQL §3.3)
    await repo.finish(
        "j1", status="cancelled", exit_code=None, oom_killed=False,
        error_detail=None, stdout="", stderr="", output_truncated=False,
        metrics_summary=None, parsed_timings=None,
        finished_at="2026-07-13T09:00:00.000Z", wall_time_ms=None,
    )
    record = await repo.find_by_id("j1")
    assert record.status == "completed"


def test_kill_reason_primer_escritor_gana():
    handle = JobHandle(
        job_id="x", source_code="", threads=1, timeout_s=5,
        parser_id="none", max_output_bytes=1024,
    )
    assert handle.kill_reason == KILL_NONE
    assert handle.request_kill(KILL_TIMEOUT) is True
    assert handle.request_kill(KILL_CANCEL) is False  # no sobrescribe
    assert handle.kill_reason == KILL_TIMEOUT


# ─────────────────────── drainer: fan-out y clientes ─────────────────────────


async def test_drainer_sin_clientes_no_bloquea_al_productor(db, settings):
    """Cero suscriptores: el job fluye igual (el drainer SIEMPRE consume)."""
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    lines = [f"linea {i}\n".encode() for i in range(2000)]
    docker.queue_execution(FakeExecution(stdout=lines))
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 15)
    record = await repo.find_by_id("j1")
    assert record.status == "completed"
    assert record.stdout.count("\n") == 2000  # nada se perdió


async def test_fanout_dos_suscriptores_reciben_lo_mismo(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    execution = docker.queue_execution(FakeExecution(
        stdout=[b"uno\ndos\n"], hang=True,
    ))
    handle = await launch(runner, repo, "j1")
    await wait_phase(handle, "compiling", "running")
    key_a, queue_a, snap_a = runner.subscribe(handle)
    key_b, queue_b, snap_b = runner.subscribe(handle)
    assert snap_a[0]["type"] == "status"  # snapshot = status + backlog
    execution.finish(exit_code=0)
    await asyncio.wait_for(handle.task, 10)

    msgs_a = [m for m in drain(queue_a) if m is not None]
    msgs_b = [m for m in drain(queue_b) if m is not None]
    logs_a = [m["lines"] for m in msgs_a if m["type"] == "log"]
    logs_b = [m["lines"] for m in msgs_b if m["type"] == "log"]
    assert logs_a == logs_b
    assert msgs_a[-1]["type"] == "eof" and msgs_b[-1]["type"] == "eof"
    terminal_a = [m for m in msgs_a if m["type"] == "status"][-1]
    assert terminal_a["phase"] == "completed"
    assert terminal_a["detail"]["exit_code"] == 0


async def test_cliente_lento_pierde_pero_recibe_el_cierre(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings, subscriber_queue_max=3)
    execution = docker.queue_execution(FakeExecution(
        stdout=[f"l{i}\n".encode() for i in range(50)], hang=True,
    ))
    handle = await launch(runner, repo, "j1")
    await wait_phase(handle, "compiling", "running")
    _, queue, _ = runner.subscribe(handle)  # jamás se consume: se llena
    execution.finish(exit_code=0)
    await asyncio.wait_for(handle.task, 10)

    items = drain(queue)
    assert items[-1] is None  # sentinela de cierre
    messages = [m for m in items if m is not None]
    # pese al overflow, los DOS últimos son status terminal + eof (§3.4)
    assert messages[-2]["type"] == "status"
    assert messages[-2]["phase"] == "completed"
    assert messages[-1]["type"] == "eof"


async def test_backlog_ring_buffer_y_seq(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    lines = [f"linea {i}\n".encode() for i in range(800)]
    execution = docker.queue_execution(FakeExecution(stdout=lines, hang=True))
    handle = await launch(runner, repo, "j1")

    async def _ingested():
        while handle.total_log_bytes < sum(len(c) for c in lines):
            await asyncio.sleep(0.01)

    await asyncio.wait_for(_ingested(), 10)
    await asyncio.sleep(0.05)  # flush del drainer
    backlog_lines = sum(len(m["lines"]) for m in handle.backlog)
    assert backlog_lines <= 500 + 100  # ~500 líneas (poda por mensaje)
    seqs = [m["seq"] for m in handle.backlog]
    assert seqs == sorted(seqs)  # monótono
    # un suscriptor tardío recibe snapshot + backlog con los seq ORIGINALES
    _, _, snapshot = runner.subscribe(handle)
    assert snapshot[0]["type"] == "status"
    assert [m["seq"] for m in snapshot[1:]] == seqs
    execution.finish(exit_code=0)
    await asyncio.wait_for(handle.task, 10)


async def test_stream_error_no_fatal(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(FakeExecution(
        stdout=[b"antes\n"], log_error=RuntimeError("stream roto"),
    ))
    handle = await launch(runner, repo, "j1")
    _, queue, _ = runner.subscribe(handle)
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "completed"  # STREAM_ERROR no mata el job
    messages = [m for m in drain(queue) if m is not None]
    assert any(
        m["type"] == "error" and m["code"] == "STREAM_ERROR" for m in messages
    )


# ─────────────────────────── sandbox_error ───────────────────────────────────


async def test_sandbox_error_y_cleanup(db, settings):
    docker = FakeDockerService()
    docker.run_error = RuntimeError("volumen roto")  # tras prepare_code
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "failed"
    assert record.error_detail == "sandbox_error"  # código de catálogo CERRADO
    assert "volumen roto" not in (record.stderr or "")  # detalle solo en logs
    assert docker.cleaned == ["j1"]  # el código preparado se borra igualmente
    assert runner.registry == {}


# ──────────────────────── métricas (cgroups v2) ──────────────────────────────


def test_compute_metrics_formula_oficial():
    metric = compute_metrics(stats_sample())
    # (1e9 / 1e9) * 8 * 100 = 800%
    assert metric["cpu_percent"] == 800.0
    assert metric["online_cpus"] == 8
    assert metric["mem_used_bytes"] == 90_000_000  # usage - inactive_file
    assert metric["mem_limit_bytes"] == 536_870_912
    assert metric["pids"] == 12
    assert 0 < metric["mem_percent"] < 100


def test_compute_metrics_descarta_muestras_incompletas():
    assert compute_metrics(first_stats_sample()) is None  # 1ª sin precpu
    assert compute_metrics({}) is None                    # final vacía


# ─────────────────────────── reaper de arranque ──────────────────────────────


async def test_run_startup_reaper(db, settings):
    docker = FakeDockerService()
    docker.reap_result = (2, 1)
    repo = JobRepository(db)
    await repo.create(make_job_record("huerfano", status="running"))
    result = await run_startup_reaper(docker, repo)
    assert result == {
        "containers_removed": 2, "dirs_removed": 1, "jobs_orphaned": 1,
    }
    record = await repo.find_by_id("huerfano")
    assert record.status == "failed"
    assert record.error_detail == "orphaned_on_restart"


# ──────── BL-07: cancel sobre queued sincroniza el handle (auditoría §3) ─────


async def test_bl07_cancel_en_queued_sincroniza_handle_y_emite_terminal(db, settings):
    """El cancel en queued deja el handle terminal EN EL ACTO: la cola no lo
    sobrecuenta y un WS ya suscrito recibe status cancelled + eof (§8.1)."""
    one = settings.model_copy(update={"max_concurrent_jobs": 1})
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, one)
    blocker_exec = docker.queue_execution(FakeExecution(hang=True))
    blocker = await launch(runner, repo, "ocupa")
    await wait_phase(blocker, "compiling", "running")

    queued = await launch(runner, repo, "encolado")
    _, queue, _ = runner.subscribe(queued)  # WS conectado ANTES del cancel
    assert runner.queued_count() == 1
    assert await runner.cancel("encolado") == "cancelling"

    # sincronizado en el mismo instante que la escritura en DB
    assert queued.phase == "cancelled"
    assert runner.queued_count() == 0  # (b) la cola no cuenta cancelados
    assert runner.get_active("encolado") is None  # (a) ningún WS lo ve activo
    items = drain(queue)
    assert items[-1] is None  # cola por-conexión cerrada
    messages = [m for m in items if m is not None]
    assert messages[-2]["type"] == "status"
    assert messages[-2]["phase"] == "cancelled"
    assert messages[-2]["detail"]["error_detail"] is None
    assert messages[-1]["type"] == "eof"

    # el drainer se detiene YA: no queda despertando mientras la tarea espera
    # el semáforo detrás de jobs largos (review S3)
    assert queued.drainer.done()

    blocker_exec.finish(exit_code=0)
    await asyncio.wait_for(blocker.task, 10)
    await asyncio.wait_for(queued.task, 10)
    assert (await repo.find_by_id("encolado")).status == "cancelled"
    assert "encolado" not in docker.prepared  # jamás llegó a create


# ──────── BL-13: la CAUSA de terminación prevalece (contrato §7.4) ───────────


def test_bl13_causa_de_terminacion_prevalece_sobre_output_truncated():
    """Si cancel/timeout ya fijaron kill_reason, el truncado posterior NO
    reclasifica: status/error_detail reflejan la causa (primer escritor gana)
    y output_truncated=true convive como flag informativo (§7.4)."""
    handle = JobHandle(
        job_id="x", source_code="", threads=1, timeout_s=5,
        parser_id="none", max_output_bytes=64,
    )
    assert handle.request_kill(KILL_CANCEL) is True
    handle.output_truncated = True  # el drainer cortó output en la misma ventana
    assert handle.request_kill(KILL_OUTPUT_LIMIT) is False
    status, error_detail = JobRunner._derive_terminal(handle.kill_reason, None, False)
    assert (status, error_detail) == ("cancelled", None)


# ──────── BL-09 (opción A): retención corta del handle terminal ──────────────


async def test_bl09_handle_retenido_conserva_backlog_con_seq_originales(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings, terminal_retention_s=0.3)
    docker.queue_execution(FakeExecution(stdout=[b"uno\ndos\n"]))
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)

    # terminal: invisible para el stream vivo, visible para el replay
    assert runner.get_active("j1") is None
    retained = runner.get_finished("j1")
    assert retained is handle
    assert retained.closed is True and retained.phase == "completed"
    seqs = [m["seq"] for m in retained.backlog]
    assert seqs and seqs == sorted(seqs)  # seq ORIGINALES del stream vivo

    # pasada la retención, §3.4 paso 5 (diferido): registro vacío
    await asyncio.sleep(0.6)
    assert runner.registry == {}
    assert runner.get_finished("j1") is None


async def test_shutdown_cancela_las_retenciones_pendientes(db, settings):
    """Apagar el proceso no deja tareas `_expire()` colgadas (review S3): sin
    esto CPython avisa «Task was destroyed but it is pending!» al redesplegar."""
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings, terminal_retention_s=30.0)
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)
    retention = [t for t in handle.aux_tasks if not t.done()]
    assert retention, "la retención debería seguir viva"

    await runner.shutdown()
    assert all(t.done() for t in handle.aux_tasks)


async def test_shutdown_sin_jobs_no_rompe(db, settings):
    docker = FakeDockerService()
    runner = make_runner(docker, JobRepository(db), settings)
    await runner.shutdown()  # idempotente y seguro con el registro vacío


async def test_bl09_sin_retencion_el_registro_se_vacia_al_instante(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)  # retención 0 (histórico)
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 10)
    assert runner.registry == {}
    assert runner.get_finished("j1") is None


# ───────── BL-05 (auditoría §3): lesson_progress.last_job_id (§7.1) ──────────


async def test_bl05_completed_con_lesson_id_escribe_last_job_id(db, settings):
    """Un job ``completed`` con ``lesson_id`` deja ``last_job_id`` en progreso."""
    from app.repositories.progress import ProgressRepository

    docker = FakeDockerService()
    repo = JobRepository(db)
    progress = ProgressRepository(db)
    runner = make_runner(docker, repo, settings, progress=progress)
    handle = await launch(runner, repo, "job-bl05", lesson_id="spmd")
    await handle.task

    record = await progress.get("spmd")
    assert record is not None
    assert record.last_job_id == "job-bl05"
    # el runner NO toca lo que gestionan quiz/estudiante
    assert record.completed is False
    assert record.best_quiz_score is None


async def test_bl05_job_fallido_no_escribe_last_job_id(db, settings):
    """«Al terminar BIEN» (§7.1): un job failed no actualiza el progreso."""
    from app.repositories.progress import ProgressRepository

    docker = FakeDockerService()
    docker.queue_execution(FakeExecution(exit_code=1))
    repo = JobRepository(db)
    progress = ProgressRepository(db)
    runner = make_runner(docker, repo, settings, progress=progress)
    handle = await launch(runner, repo, "job-bl05-fail", lesson_id="spmd")
    await handle.task

    assert (await repo.find_by_id("job-bl05-fail")).status == "failed"
    assert await progress.get("spmd") is None


async def test_bl05_sin_lesson_id_no_escribe_progreso(db, settings):
    """Job sin lección asociada: cero filas nuevas en lesson_progress."""
    from app.repositories.progress import ProgressRepository

    docker = FakeDockerService()
    repo = JobRepository(db)
    progress = ProgressRepository(db)
    runner = make_runner(docker, repo, settings, progress=progress)
    handle = await launch(runner, repo, "job-bl05-sin")
    await handle.task

    assert (await repo.find_by_id("job-bl05-sin")).status == "completed"
    assert await progress.get_all() == []


async def test_bl05_upsert_que_falla_no_reclasifica_el_job(db, settings):
    """Si el upsert de progreso falla, el job sigue ``completed`` (el fallo
    se logea; jamás reclasifica un resultado correcto como sandbox_error)."""

    class ExplodingProgress:
        async def upsert(self, lesson_id, **kwargs):
            raise RuntimeError("progreso caído")

    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings, progress=ExplodingProgress())
    handle = await launch(runner, repo, "job-bl05-boom", lesson_id="spmd")
    await handle.task

    record = await repo.find_by_id("job-bl05-boom")
    assert record.status == "completed"
    assert record.error_detail is None
