"""S7b — robustez de ejecución (informe 2026-09-22 §3.6 y §2.3).

- 08.1: cancelar no pisa un fin natural (contenedor ya salido / exit_code).
- 08.3: el fallo del kill se propaga y un segundo cancel lo reintenta.
- 09.3: ``compute_metrics`` descarta muestras incompletas (no inventa 0).
- 24.3: ``prepare_code`` no deja el directorio si falla la escritura.
- 24.6: solo es timeout si pasó ``timeout_s``; si no, error del sandbox.
- 25.1/25.2: barrido de directorios también sin Docker y sin contar lo que
  no se pudo borrar.
- §2.3 #21: ``mark_orphans_failed`` fija ``finished_at``.
"""

from __future__ import annotations

import asyncio
import shutil
import threading
import time
from pathlib import Path

import pytest
import requests
from fastapi.testclient import TestClient

import app.main as app_main
from app.main import create_app
from app.repositories.jobs import JobRepository
from app.services import DockerServiceError, RunnerNotFound, RunnerTimeout
from app.services import code_dirs
from app.services.docker_service import DockerService, JobExecution
from app.services.job_runner import KILL_CANCEL, KILL_NONE, JobRunner, compute_metrics

from conftest import make_job_record, wait_terminal
from fakes.fake_docker import FakeExecution, stats_sample
from test_docker_service import StubClient, StubContainer
from test_job_runner import launch, make_runner, wait_phase
from fakes.fake_docker import FakeDockerService


# ───────────────────────────── 08.1: fin natural ─────────────────────────────


class _ExitedExecution(FakeExecution):
    """El proceso ya salió solo, pero el runner sigue cerrando (oom_killed
    bloquea hasta ``release``): la ventana en la que llega el cancel tardío."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.in_post_exit = threading.Event()
        self.release = threading.Event()

    def oom_killed(self) -> bool:
        self.in_post_exit.set()
        self.release.wait(timeout=10)
        return False


async def test_cancel_tras_la_salida_natural_no_se_acepta(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    execution = docker.queue_execution(_ExitedExecution(stdout=[b"ok\n"], exit_code=0))
    handle = await launch(runner, repo, "j1")
    await asyncio.to_thread(execution.in_post_exit.wait, 5)

    assert await runner.cancel("j1") is None  # el contenedor ya salió
    assert handle.kill_reason == KILL_NONE
    assert execution.killed is False

    execution.release.set()
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "completed"


@pytest.mark.parametrize(
    ("exit_code", "expected"),
    [
        (0, ("completed", None)),  # terminó solo justo cuando llegó el kill
        (3, ("failed", None)),
        (137, ("cancelled", None)),  # SIGKILL del cancel
        (None, ("cancelled", None)),
    ],
)
def test_derive_terminal_con_cancel_mira_el_exit_code(exit_code, expected):
    assert JobRunner._derive_terminal(KILL_CANCEL, exit_code, False) == expected


# ─────────────────── 08.3: el fallo del kill no se traga ─────────────────────


class _KillFailsOnce(FakeExecution):
    def __init__(self, error: Exception, **kwargs) -> None:
        super().__init__(**kwargs)
        self._error: Exception | None = error
        self.kill_attempts = 0

    def kill(self) -> None:
        self.kill_attempts += 1
        if self._error is not None:
            error, self._error = self._error, None
            raise error
        super().kill()


async def test_cancel_propaga_el_fallo_del_kill_y_el_segundo_lo_reintenta(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    execution = docker.queue_execution(
        _KillFailsOnce(DockerServiceError("daemon caído"), stdout=[b"x\n"], hang=True)
    )
    handle = await launch(runner, repo, "j1")
    await wait_phase(handle, "compiling", "running")

    with pytest.raises(DockerServiceError):
        await runner.cancel("j1")
    assert execution.killed is False

    assert await runner.cancel("j1") == "cancelling"  # reintenta el kill
    assert execution.kill_attempts == 2
    await asyncio.wait_for(handle.task, 10)
    record = await repo.find_by_id("j1")
    assert record.status == "cancelled"


async def test_cancel_con_contenedor_ya_eliminado_es_benigno(db, settings):
    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    execution = docker.queue_execution(
        _KillFailsOnce(RunnerNotFound("gone"), stdout=[b"x\n"], hang=True)
    )
    handle = await launch(runner, repo, "j1")
    await wait_phase(handle, "compiling", "running")
    assert await runner.cancel("j1") == "cancelling"
    execution.finish()
    await asyncio.wait_for(handle.task, 10)


def wait_started(client, job_id: str, timeout: float = 5.0) -> None:
    """Hasta que el job tiene contenedor (compiling/running)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = client.get(f"/api/v1/jobs/{job_id}").json()["data"]["status"]
        if status in ("compiling", "running"):
            return
        time.sleep(0.01)
    raise AssertionError(f"el job {job_id} no arrancó")


def test_cancel_rest_con_kill_fallido_503_y_reintento(client, fake_docker):
    execution = fake_docker.queue_execution(
        _KillFailsOnce(DockerServiceError("daemon caído"), stdout=[b"x\n"], hang=True)
    )
    job_id = client.post("/api/v1/jobs", json={"code": "print(1)\n"}).json()["data"]["job_id"]
    wait_started(client, job_id)
    first = client.post(f"/api/v1/jobs/{job_id}/cancel")
    assert first.status_code == 503
    assert first.json()["error"]["code"] == "DOCKER_UNAVAILABLE"
    second = client.post(f"/api/v1/jobs/{job_id}/cancel")
    assert second.status_code == 202
    assert wait_terminal(client, job_id)["status"] == "cancelled"
    assert execution.kill_attempts == 2


def test_cancel_ws_con_kill_fallido_avisa_cancel_failed(client, fake_docker):
    execution = fake_docker.queue_execution(
        _KillFailsOnce(DockerServiceError("daemon caído"), stdout=[b"x\n"], hang=True)
    )
    job_id = client.post("/api/v1/jobs", json={"code": "print(1)\n"}).json()["data"]["job_id"]
    wait_started(client, job_id)
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        assert ws.receive_json()["type"] == "status"
        ws.send_json({"type": "cancel"})
        while True:
            msg = ws.receive_json()
            if msg["type"] == "error":
                break
        assert msg["code"] == "CANCEL_FAILED"
        ws.send_json({"type": "cancel"})  # la conexión sigue viva: reintento
        while msg["type"] != "eof":
            msg = ws.receive_json()
    assert wait_terminal(client, job_id)["status"] == "cancelled"
    assert execution.kill_attempts == 2


def test_kill_con_daemon_inalcanzable_es_docker_service_error():
    for exc in (
        requests.exceptions.ConnectionError("daemon caído"),
        requests.exceptions.ReadTimeout("t"),
    ):
        with pytest.raises(DockerServiceError) as info:
            JobExecution(StubContainer(kill_error=exc)).kill()
        assert not isinstance(info.value, RunnerNotFound)


async def test_kill_que_no_responde_se_propaga(db, settings, monkeypatch):
    monkeypatch.setattr("app.services.job_runner.KILL_REQUEST_TIMEOUT_S", 0.05)
    release = threading.Event()

    class _SlowKill(FakeExecution):
        def kill(self) -> None:
            release.wait(timeout=5)
            super().kill()

    docker = FakeDockerService()
    repo = JobRepository(db)
    runner = make_runner(docker, repo, settings)
    docker.queue_execution(_SlowKill(stdout=[b"x\n"], hang=True))
    handle = await launch(runner, repo, "j1")
    await wait_phase(handle, "compiling", "running")
    with pytest.raises(DockerServiceError):
        await runner.cancel("j1")
    release.set()
    await asyncio.wait_for(handle.task, 10)


# ─────────────────── 09.3: muestras incompletas se descartan ─────────────────


@pytest.mark.parametrize(
    "strip",
    [
        lambda s: s["precpu_stats"].pop("system_cpu_usage"),
        lambda s: s["memory_stats"].pop("limit"),
        lambda s: s.pop("pids_stats"),
        lambda s: s["cpu_stats"].pop("throttling_data"),
    ],
)
def test_compute_metrics_no_inventa_ceros(strip):
    sample = stats_sample()
    strip(sample)
    assert compute_metrics(sample) is None


# ───────────────────── 24.3: preparación a medias ────────────────────────────


def test_prepare_code_borra_el_directorio_si_falla_la_escritura(
    settings, monkeypatch
):
    service = DockerService(settings, client=StubClient())

    def broken_write(self, *args, **kwargs):
        raise OSError("disco lleno")

    monkeypatch.setattr(Path, "write_text", broken_write)
    with pytest.raises(OSError):
        service.prepare_code("j1", "print(1)\n")
    assert not (settings.jobs_dir_expanded / "j1").exists()


# ─────────────────── 24.6: Docker caído ≠ timeout ────────────────────────────


def test_wait_con_error_antes_del_timeout_no_es_timeout():
    for exc in (
        requests.exceptions.ConnectionError("daemon caído"),
        requests.exceptions.ReadTimeout("t"),
    ):
        with pytest.raises(DockerServiceError) as info:
            JobExecution(StubContainer(wait_error=exc)).wait(60)
        assert not isinstance(info.value, RunnerTimeout)


def test_wait_sin_timeout_con_error_no_es_timeout():
    exc = requests.exceptions.ConnectionError("daemon caído")
    with pytest.raises(DockerServiceError) as info:
        JobExecution(StubContainer(wait_error=exc)).wait(None)
    assert not isinstance(info.value, RunnerTimeout)


def test_wait_tras_el_tiempo_limite_si_es_timeout(monkeypatch):
    clock = iter([100.0, 161.0])
    monkeypatch.setattr("app.services.docker_service.time.monotonic", lambda: next(clock))
    exc = requests.exceptions.ReadTimeout("t")
    with pytest.raises(RunnerTimeout):
        JobExecution(StubContainer(wait_error=exc)).wait(60)


# ─────────────────── 25.1/25.2: barrido de directorios ───────────────────────


def test_sweep_no_cuenta_lo_que_no_pudo_borrar(tmp_path, monkeypatch):
    (tmp_path / "ok").mkdir()
    (tmp_path / "atascado").mkdir()
    real_rmtree = shutil.rmtree

    def flaky_rmtree(path, *args, **kwargs):
        if Path(path).name == "atascado":
            raise PermissionError("en uso")
        real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(code_dirs.shutil, "rmtree", flaky_rmtree)
    assert code_dirs.sweep_code_dirs(tmp_path) == 1
    assert not (tmp_path / "ok").exists()
    assert (tmp_path / "atascado").exists()


def test_sweep_de_una_base_inexistente_es_cero(tmp_path):
    assert code_dirs.sweep_code_dirs(tmp_path / "no-existe") == 0


def test_reap_orphans_no_cuenta_lo_que_no_pudo_borrar(settings, monkeypatch):
    jobs_dir = settings.jobs_dir_expanded
    (jobs_dir / "atascado").mkdir(parents=True)
    monkeypatch.setattr(
        code_dirs.shutil, "rmtree",
        lambda *a, **k: (_ for _ in ()).throw(PermissionError("en uso")),
    )
    removed, dirs_removed = DockerService(settings, client=StubClient()).reap_orphans()
    assert (removed, dirs_removed) == (0, 0)


def test_arranque_sin_docker_barre_los_directorios_huerfanos(settings, monkeypatch):
    jobs_dir = settings.jobs_dir_expanded
    (jobs_dir / "huerfano").mkdir(parents=True)
    (jobs_dir / "huerfano" / "main.py").write_text("print(1)\n")

    def broken_builder(cfg):
        raise RuntimeError("sin daemon")

    monkeypatch.setattr(app_main, "_build_docker_service", broken_builder)
    with TestClient(create_app(settings=settings)):
        assert not (jobs_dir / "huerfano").exists()


# ─────────────── §2.3 #21: huérfanos con finished_at ─────────────────────────


async def test_mark_orphans_failed_fija_finished_at(db):
    repo = JobRepository(db)
    await repo.create(make_job_record("vivo", status="running"))
    assert await repo.mark_orphans_failed() == 1
    record = await repo.find_by_id("vivo")
    assert record.status == "failed"
    assert record.finished_at is not None
    assert record.finished_at.endswith("Z") and "T" in record.finished_at
