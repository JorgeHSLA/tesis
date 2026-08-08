"""Suite 2 (architecture §11): el FakeRunner scriptable en sí.

El fake implementa estructuralmente ``DockerServicePort``/``JobExecutionPort``
y sus guiones (logs temporizados, stats, wait→exit, kill, excepciones) son la
base de todas las demás suites: aquí se verifica el guion mismo.
"""

from __future__ import annotations

import pytest

from app.services import RunnerTimeout

from fakes.fake_docker import (
    FakeDockerService,
    FakeExecution,
    first_stats_sample,
    stats_sample,
)


def test_cumple_los_protocols():
    """La costura de inyección es el Protocol (architecture §11): el fake
    expone TODOS los métodos de DockerServicePort/JobExecutionPort."""
    service = FakeDockerService()
    for method in ("ping", "image_present", "prepare_code", "run_job",
                   "kill", "cleanup_code", "reap_orphans"):
        assert callable(getattr(service, method)), method
    execution = FakeExecution()
    assert isinstance(execution.container_id, str)
    for method in ("iter_logs", "iter_stats", "wait", "kill",
                   "oom_killed", "remove"):
        assert callable(getattr(execution, method)), method


def test_guion_de_logs_y_stats():
    execution = FakeExecution(
        stdout=[b"linea 1\n", b"linea 2\n"],
        stderr=[b"warning\n"],
        stats=[stats_sample(), stats_sample(pids=20)],
    )
    assert list(execution.iter_logs("stdout")) == [b"linea 1\n", b"linea 2\n"]
    assert list(execution.iter_logs("stderr")) == [b"warning\n"]
    samples = list(execution.iter_stats())
    assert len(samples) == 2
    assert samples[1]["pids_stats"]["current"] == 20


def test_wait_devuelve_exit_code_sin_hang():
    assert FakeExecution(exit_code=3).wait(timeout=1) == 3


def test_wait_con_hang_lanza_runner_timeout():
    execution = FakeExecution(hang=True)
    with pytest.raises(RunnerTimeout):
        execution.wait(timeout=0.01)


def test_kill_desbloquea_y_devuelve_137():
    execution = FakeExecution(hang=True)
    execution.kill()
    assert execution.killed is True
    assert execution.wait(timeout=1) == 137


def test_finish_desbloquea_sin_kill():
    execution = FakeExecution(hang=True)
    execution.finish(exit_code=7)
    assert execution.wait(timeout=1) == 7
    assert execution.killed is False


def test_repeat_last_inunda_hasta_kill():
    execution = FakeExecution(stdout=[b"x" * 100], hang=True, repeat_last=True)
    seen = 0
    for chunk in execution.iter_logs("stdout"):
        seen += len(chunk)
        if seen > 1000:
            execution.kill()
    assert seen > 1000  # produjo más que sus chunks declarados


def test_log_error_scriptable():
    boom = RuntimeError("stream roto")
    execution = FakeExecution(stdout=[b"antes\n"], log_error=boom)
    iterator = execution.iter_logs("stdout")
    assert next(iterator) == b"antes\n"
    with pytest.raises(RuntimeError):
        next(iterator)


def test_stats_error_scriptable():
    execution = FakeExecution(stats=[stats_sample()], stats_error=ValueError("x"))
    iterator = execution.iter_stats()
    next(iterator)
    with pytest.raises(ValueError):
        next(iterator)


def test_oom_y_remove():
    execution = FakeExecution(exit_code=137, oom=True)
    assert execution.oom_killed() is True
    execution.remove()
    assert execution.removed is True


def test_service_fifo_por_job_y_default():
    service = FakeDockerService()
    scripted = FakeExecution(stdout=[b"scripted\n"])
    service.queue_execution(scripted)
    assert service.run_job("j1", "/code", 2, 30) is scripted
    default = service.run_job("j2", "/code", 2, 30)
    assert list(default.iter_logs("stdout")) == [b"ok\n"]
    by_job = FakeExecution()
    service.by_job["j3"] = by_job
    assert service.run_job("j3", "/code", 2, 30) is by_job
    assert [c["job_id"] for c in service.run_calls] == ["j1", "j2", "j3"]


def test_service_prepare_kill_cleanup_reap():
    service = FakeDockerService()
    assert service.ping() is True and service.image_present() is True
    path = service.prepare_code("j1", "print(1)\n")
    assert path.endswith("/j1")
    assert service.prepared["j1"] == "print(1)\n"

    execution = FakeExecution(hang=True)
    service.by_job["j1"] = execution
    service.run_job("j1", path, 2, 30)
    service.kill("j1")
    assert execution.killed is True
    assert service.kill_calls == ["j1"]

    service.cleanup_code("j1")
    assert service.cleaned == ["j1"]

    service.reap_result = (2, 3)
    assert service.reap_orphans() == (2, 3)
    assert service.reap_calls == 1


def test_service_errores_scriptables():
    service = FakeDockerService()
    service.ping_ok = False
    service.image_ok = False
    assert service.ping() is False and service.image_present() is False
    service.run_error = RuntimeError("daemon caído")
    with pytest.raises(RuntimeError):
        service.run_job("j1", "/code", 2, 30)
    service.prepare_error = OSError("disco lleno")
    with pytest.raises(OSError):
        service.prepare_code("j2", "x")
    service.reap_error = RuntimeError("reap")
    with pytest.raises(RuntimeError):
        service.reap_orphans()


def test_stats_sample_shapes():
    complete = stats_sample()
    assert "precpu_stats" in complete
    incomplete = first_stats_sample()
    assert "precpu_stats" not in incomplete
