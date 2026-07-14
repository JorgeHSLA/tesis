"""job_runner: drainer §3.2, kill_reason §3.3, orden §3.4, puente threads→asyncio.

Escenarios congelados del plan (WP2): happy / timeout / OOM / truncado /
cancel-queued / cancel-running / fan-out×2 / desconexión-sin-consumidor
no bloquea al productor.
"""

from __future__ import annotations

import asyncio

import pytest

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
from fakes import (
    FakeDockerService,
    FakeExecution,
    FakeJobRepo,
    make_record,
    make_settings,
    stats_sample,
)

SPMD_STDOUT = (
    b"hilos = 1 | pi = 3.1415926535897523 | tiempo = 0.726 s\n"
    b"hilos = 2 | pi = 3.1415926535897527 | tiempo = 0.256 s\n"
    b"hilos = 4 | pi = 3.1415926535897514 | tiempo = 0.173 s\n"
    b"hilos = 8 | pi = 3.1415926535897523 | tiempo = 0.091 s\n"
)


def make_runner(docker, repo, **over):
    defaults = dict(max_concurrent_jobs=2, max_output_bytes=262144)
    settings_over = {
        k: over.pop(k) for k in list(over)
        if k in ("max_concurrent_jobs", "max_output_bytes")
    }
    defaults.update(settings_over)
    return JobRunner(
        docker_service=docker,
        job_repo=repo,
        settings=make_settings(**defaults),
        flush_interval_s=0.01,
        **over,
    )


async def launch(runner, repo, job_id, *, threads=2, timeout_s=5, parser_id="none"):
    await repo.create(make_record(job_id, threads=threads, timeout_s=timeout_s))
    return runner.start(
        job_id=job_id,
        source_code="print('x')\n",
        threads=threads,
        timeout_s=timeout_s,
        parser_id=parser_id,
    )


async def wait_running(handle, timeout=5.0):
    """Espera a que el job tenga contenedor (fase creating→compiling)."""
    async def _poll():
        while handle.execution is None:
            await asyncio.sleep(0.005)
    await asyncio.wait_for(_poll(), timeout)


def drain_queue(queue: asyncio.Queue) -> list:
    items = []
    while True:
        try:
            items.append(queue.get_nowait())
        except asyncio.QueueEmpty:
            return items


# ─────────────────────────────── escenarios ─────────────────────────────────


async def test_happy_path_completed():
    docker = FakeDockerService()
    docker.executions["j1"] = FakeExecution(
        stdout=[b"hola\n", b"mundo\n"],
        stderr=[b"aviso\n"],
        stats=[{"precpu_stats": {}}, stats_sample()],  # la 1ª se descarta
        exit_code=0,
    )
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j1")
    await asyncio.wait_for(handle.task, 5)

    rec = repo.records["j1"]
    assert rec.status == "completed"
    assert rec.exit_code == 0
    assert rec.error_detail is None
    assert rec.stdout == "hola\nmundo\n"
    assert rec.stderr == "aviso\n"
    assert rec.output_truncated is False
    assert rec.oom_killed is False
    # metrics_summary agregada de la muestra válida (800% = 8×100)
    assert rec.metrics_summary["samples"] == 1
    assert rec.metrics_summary["cpu_percent_max"] == 800.0
    assert rec.metrics_summary["pids_max"] == 12
    # fases no terminales registradas en orden
    assert [s for _, s in repo.phase_calls] == ["creating", "compiling", "running"]
    # orden §3.4: contenedor eliminado, código borrado, registro vacío
    assert docker.running["j1"].removed is True
    assert docker.cleaned == ["j1"]
    assert "j1" not in runner.registry


async def test_happy_con_parser_sweep():
    docker = FakeDockerService()
    docker.executions["j2"] = FakeExecution(stdout=[SPMD_STDOUT], exit_code=0)
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j2", parser_id="sweep_pi")
    await asyncio.wait_for(handle.task, 5)
    parsed = repo.records["j2"].parsed_timings
    assert parsed["kind"] == "sweep"
    assert [p["speedup"] for p in parsed["series"]] == [1.0, 2.84, 4.2, 7.98]


async def test_timeout_wall_clock():
    docker = FakeDockerService()
    docker.executions["j3"] = FakeExecution(stdout=[b"antes del timeout\n"], hang=True)
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j3", timeout_s=0)  # RunnerTimeout inmediato
    await asyncio.wait_for(handle.task, 5)

    rec = repo.records["j3"]
    assert rec.status == "timeout"
    assert rec.error_detail == "wall_timeout"
    assert rec.exit_code == 137
    assert handle.kill_reason == KILL_TIMEOUT
    assert docker.running["j3"].killed is True
    assert rec.stdout == "antes del timeout\n"  # los logs previos se conservan


async def test_oom_killed():
    docker = FakeDockerService()
    docker.executions["j4"] = FakeExecution(
        stdout=[b"reservando memoria...\n"], exit_code=137, oom=True
    )
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j4")
    await asyncio.wait_for(handle.task, 5)

    rec = repo.records["j4"]
    assert rec.status == "failed"
    assert rec.error_detail == "oom"
    assert rec.oom_killed is True
    assert rec.exit_code == 137


async def test_output_truncado_mata_y_falla():
    docker = FakeDockerService()
    chunk = b"A" * 300 + b"\n"
    docker.executions["j5"] = FakeExecution(
        stdout=[chunk], hang=True, repeat_last=True
    )
    repo = FakeJobRepo()
    runner = make_runner(docker, repo, max_output_bytes=1024)
    handle = await launch(runner, repo, "j5", parser_id="sweep_pi")
    key, queue, _ = runner.subscribe(handle)
    await asyncio.wait_for(handle.task, 5)

    rec = repo.records["j5"]
    assert rec.status == "failed"
    assert rec.error_detail == "output_limit_exceeded"
    assert rec.output_truncated is True
    assert len(rec.stdout.encode()) <= 1024  # presupuesto respetado
    assert rec.parsed_timings is None  # truncado ⇒ jamás se parsea
    assert handle.kill_reason == KILL_OUTPUT_LIMIT
    assert docker.running["j5"].killed is True

    msgs = drain_queue(queue)
    errors = [m for m in msgs if isinstance(m, dict) and m.get("type") == "error"]
    assert any(e["code"] == "OUTPUT_TRUNCATED" for e in errors)
    eof = [m for m in msgs if isinstance(m, dict) and m.get("type") == "eof"]
    assert eof and eof[-1]["truncated"] is True
    assert msgs[-1] is None  # cola por-conexión cerrada (§3.4 paso 3)


async def test_cancel_queued_no_crea_contenedor():
    docker = FakeDockerService()
    exec_a = FakeExecution(stdout=[b"a\n"], hang=True)
    docker.executions["jA"] = exec_a
    repo = FakeJobRepo()
    runner = make_runner(docker, repo, max_concurrent_jobs=1)
    handle_a = await launch(runner, repo, "jA")
    await wait_running(handle_a)  # A tiene el único slot del semáforo
    handle_b = await launch(runner, repo, "jB")
    assert handle_b.phase == "queued"

    assert await runner.cancel("jB") == "cancelling"
    assert repo.records["jB"].status == "cancelled"  # cancelled en DB YA (§3.3)
    assert repo.records["jB"].error_detail is None

    exec_a.finish(0)  # libera el semáforo
    await asyncio.wait_for(handle_a.task, 5)
    await asyncio.wait_for(handle_b.task, 5)
    # jB jamás llegó a containers.create
    assert [c["job_id"] for c in docker.run_calls] == ["jA"]
    assert "jB" not in docker.prepared
    assert "jB" not in runner.registry
    assert repo.records["jA"].status == "completed"


async def test_cancel_running_kill_reason_antes_de_kill():
    docker = FakeDockerService()
    docker.executions["j6"] = FakeExecution(stdout=[b"trabajando\n"], hang=True)
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j6")
    await wait_running(handle)

    assert await runner.cancel("j6") == "cancelling"
    assert handle.kill_reason == KILL_CANCEL
    assert await runner.cancel("j6") == "cancelling"  # idempotente
    await asyncio.wait_for(handle.task, 5)

    rec = repo.records["j6"]
    assert rec.status == "cancelled"
    assert rec.error_detail is None
    assert docker.running["j6"].killed is True
    assert docker.running["j6"].removed is True
    assert docker.cleaned == ["j6"]
    assert await runner.cancel("j6") is None  # terminal: ya no activo


async def test_fanout_dos_suscriptores_reciben_lo_mismo():
    docker = FakeDockerService()
    execution = FakeExecution(stdout=[b"uno\n", b"dos\n"], hang=True)
    docker.executions["j7"] = execution
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j7")
    key1, q1, snap1 = runner.subscribe(handle)
    key2, q2, snap2 = runner.subscribe(handle)
    assert snap1[0]["type"] == "status" and snap1[0]["phase"] == "queued"
    assert snap2[0]["phase"] == "queued"

    await wait_running(handle)
    await asyncio.sleep(0.1)  # deja fluir logs al fan-out
    execution.finish(0)
    await asyncio.wait_for(handle.task, 5)

    msgs1 = drain_queue(q1)
    msgs2 = drain_queue(q2)
    logs1 = [m for m in msgs1 if isinstance(m, dict) and m.get("type") == "log"]
    logs2 = [m for m in msgs2 if isinstance(m, dict) and m.get("type") == "log"]
    assert logs1 == logs2  # réplica exacta (mismos seq y lines)
    assert [line for m in logs1 for line in m["lines"]] == ["uno", "dos"]
    seqs = [m["seq"] for m in logs1]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    for msgs in (msgs1, msgs2):
        types = [m.get("type") for m in msgs if isinstance(m, dict)]
        assert "eof" in types
        terminal = [m for m in msgs if isinstance(m, dict) and m.get("type") == "status"][-1]
        assert terminal["phase"] == "completed"
        assert terminal["detail"]["exit_code"] == 0
        assert msgs[-1] is None


async def test_cliente_lento_no_bloquea_ni_pierde_el_cierre():
    docker = FakeDockerService()
    lines = b"".join(b"linea %04d\n" % i for i in range(300))
    docker.executions["j8"] = FakeExecution(stdout=[lines], exit_code=0)
    repo = FakeJobRepo()
    runner = make_runner(docker, repo, subscriber_queue_max=4)
    handle = await launch(runner, repo, "j8")
    key, queue, _ = runner.subscribe(handle)  # jamás se consume: cliente lento

    await asyncio.wait_for(handle.task, 5)  # el job NO se bloquea
    rec = repo.records["j8"]
    assert rec.status == "completed"
    assert rec.stdout.count("\n") == 300  # el drainer acumuló TODO
    msgs = drain_queue(queue)
    assert len(msgs) <= 4 + 1
    # el cierre forzado abre hueco: status terminal + eof + cierre presentes
    assert msgs[-1] is None
    assert msgs[-2]["type"] == "eof"
    assert msgs[-3]["type"] == "status" and msgs[-3]["phase"] == "completed"


async def test_sin_ningun_consumidor_no_bloquea_al_productor():
    docker = FakeDockerService()
    chunks = [b"x" * 100 + b"\n"] * 500  # 50 KB en 500 chunks
    docker.executions["j9"] = FakeExecution(stdout=chunks, exit_code=0)
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j9")  # cero suscriptores
    await asyncio.wait_for(handle.task, 10)
    rec = repo.records["j9"]
    assert rec.status == "completed"
    assert len(rec.stdout) == 500 * 101


async def test_backlog_ring_buffer_500_lineas():
    docker = FakeDockerService()
    line = b"L" + b"x" * 99 + b"\n"  # ~100 B/línea ⇒ flush cada ~40 líneas
    chunks = [line * 35] * 20  # 700 líneas en 20 chunks
    docker.executions["j10"] = FakeExecution(stdout=chunks, hang=True)
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j10")
    await wait_running(handle)

    async def _all_ingested():
        while handle.total_log_bytes < 700 * 100:
            await asyncio.sleep(0.01)
    await asyncio.wait_for(_all_ingested(), 5)
    await asyncio.sleep(0.05)  # último flush del drainer

    assert handle.backlog_lines <= 500 + 80  # recortado (tolerancia 1 msg)
    key, queue, snapshot = runner.subscribe(handle)
    log_msgs = [m for m in snapshot if m.get("type") == "log"]
    assert log_msgs and log_msgs[0]["seq"] > 1  # hueco de seq detectable
    docker.running["j10"].finish(0)
    await asyncio.wait_for(handle.task, 5)
    assert repo.records["j10"].stdout.count("\n") == 700  # stdout completo


async def test_sandbox_error_y_cleanup_de_codigo():
    from app.services import DockerServiceError

    docker = FakeDockerService()
    docker.run_error = DockerServiceError("detalle interno que NO debe filtrarse")
    repo = FakeJobRepo()
    runner = make_runner(docker, repo)
    handle = await launch(runner, repo, "j11")
    await asyncio.wait_for(handle.task, 5)
    rec = repo.records["j11"]
    assert rec.status == "failed"
    assert rec.error_detail == "sandbox_error"  # código estable, sin detalle crudo
    assert docker.cleaned == ["j11"]  # prepare_code corrió ⇒ dir borrado
    assert "j11" not in runner.registry


# ───────────────────────── unidades auxiliares ──────────────────────────────


def test_kill_reason_primer_escritor_gana():
    handle = JobHandle(
        job_id="x", source_code="", threads=1, timeout_s=5,
        parser_id="none", max_output_bytes=100,
    )
    assert handle.kill_reason == KILL_NONE
    assert handle.request_kill(KILL_CANCEL) is True
    assert handle.request_kill(KILL_TIMEOUT) is False
    assert handle.request_kill(KILL_OUTPUT_LIMIT) is False
    assert handle.kill_reason == KILL_CANCEL


def test_compute_metrics_formula_cgroups_v2():
    m = compute_metrics(stats_sample())
    assert m["cpu_percent"] == 800.0  # (1e9/1e9)·8·100
    assert m["online_cpus"] == 8
    assert m["mem_used_bytes"] == 90_000_000  # usage - inactive_file
    assert m["mem_limit_bytes"] == 536_870_912
    assert m["pids"] == 12


def test_compute_metrics_descarta_primera_y_ultima_muestra():
    assert compute_metrics({"cpu_stats": {}, "precpu_stats": {}}) is None
    assert compute_metrics({}) is None


async def test_run_startup_reaper():
    docker = FakeDockerService()
    docker.reap_result = (2, 3)
    repo = FakeJobRepo()
    await repo.create(make_record("huerfano", status="running"))
    await repo.create(make_record("terminado", status="completed"))
    result = await run_startup_reaper(docker, repo)
    assert result == {
        "containers_removed": 2, "dirs_removed": 3, "jobs_orphaned": 1
    }
    assert repo.records["huerfano"].status == "failed"
    assert repo.records["huerfano"].error_detail == "orphaned_on_restart"
    assert repo.records["terminado"].status == "completed"
