"""docker_service: flags sandbox §4 como constantes, entrega de código §3.1,
reaper §3 p.8. Cliente docker = MagicMock (sin daemon)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock

import docker as docker_pkg
import pytest

from app.services import docker_service as ds


def make_service(tmp_path, mode="bind"):
    settings = SimpleNamespace(
        code_delivery=mode,
        jobs_dir_expanded=tmp_path,
        submissions_volume="ehpc_submissions",
        runner_image="ehpc-runner:0.5.1",
    )
    client = mock.MagicMock()
    return ds.DockerService(settings, client=client), client


def test_docker_solo_se_importa_en_docker_service():
    """architecture §5 — ningún otro módulo de WP2 importa ``docker``."""
    import ast
    from pathlib import Path

    app_dir = Path(ds.__file__).resolve().parent.parent
    offenders = []
    for path in app_dir.rglob("*.py"):
        if path.name == "docker_service.py" or "content" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                if any(a.name.split(".")[0] == "docker" for a in node.names):
                    offenders.append(str(path))
            elif isinstance(node, ast.ImportFrom):
                if node.level == 0 and (node.module or "").split(".")[0] == "docker":
                    offenders.append(str(path))
    assert offenders == []


def test_constantes_sandbox_congeladas():
    assert ds.SANDBOX_NETWORK_MODE == "none"
    assert ds.SANDBOX_USER == "10001"
    assert ds.SANDBOX_CAP_DROP == ["ALL"]
    assert ds.SANDBOX_SECURITY_OPT == ["no-new-privileges:true"]
    assert ds.SANDBOX_READ_ONLY is True
    assert "noexec" in ds.SANDBOX_TMPFS["/tmp"]
    assert ds.SANDBOX_MEM_LIMIT == ds.SANDBOX_MEMSWAP_LIMIT == "512m"
    assert ds.SANDBOX_PIDS_LIMIT == 128
    assert ds.SANDBOX_INIT is True
    assert ds.RUNNER_LOG_CONFIG == {
        "type": "json-file", "config": {"max-size": "4m", "max-file": "1"}
    }


def test_prepare_y_cleanup_code_bind(tmp_path):
    svc, _ = make_service(tmp_path)
    code_path = svc.prepare_code("job1", "print('hola')\n")
    main = tmp_path / "job1" / "main.py"
    assert code_path == str(tmp_path / "job1")
    assert main.read_text(encoding="utf-8") == "print('hola')\n"
    svc.cleanup_code("job1")
    assert not main.parent.exists()


def test_run_job_flags_sandbox(tmp_path):
    svc, client = make_service(tmp_path)
    svc.run_job("job1", str(tmp_path / "job1"), threads=4, timeout_s=30)
    kwargs = client.containers.create.call_args.kwargs
    assert kwargs["image"] == "ehpc-runner:0.5.1"
    assert kwargs["command"] == ["python", "-I", "/work/main.py"]
    assert kwargs["network_mode"] == "none"
    assert kwargs["user"] == "10001"
    assert kwargs["cap_drop"] == ["ALL"]
    assert kwargs["security_opt"] == ["no-new-privileges:true"]
    assert kwargs["read_only"] is True
    assert kwargs["tmpfs"] == {"/tmp": "rw,noexec,nosuid,size=64m"}
    assert kwargs["init"] is True
    assert kwargs["mem_limit"] == "512m" and kwargs["memswap_limit"] == "512m"
    assert kwargs["pids_limit"] == 128
    assert kwargs["nano_cpus"] == 4_000_000_000
    assert kwargs["cpuset_cpus"] == "0-3"
    assert kwargs["auto_remove"] is False
    assert kwargs["log_config"] == {
        "type": "json-file", "config": {"max-size": "4m", "max-file": "1"}
    }
    env = kwargs["environment"]
    assert env["OMP_NUM_THREADS"] == "4" and env["NUMBA_NUM_THREADS"] == "4"
    assert env["PYTHONUNBUFFERED"] == "1"
    assert env["NUMBA_CACHE_DIR"] == "/tmp/numba_cache"
    assert kwargs["labels"] == {"ehpc.runner": "true", "ehpc.job": "job1"}
    # modo bind: ruta del host montada :ro en /work
    assert kwargs["volumes"] == {
        str(tmp_path / "job1"): {"bind": "/work", "mode": "ro"}
    }
    # y se hizo start() del contenedor creado
    client.containers.create.return_value.start.assert_called_once_with()


def test_run_job_volume_subpath(tmp_path):
    svc, client = make_service(tmp_path, mode="volume")
    svc.run_job("job2", "/submissions/job2", threads=2, timeout_s=30)
    kwargs = client.containers.create.call_args.kwargs
    assert "volumes" not in kwargs
    (mount,) = kwargs["mounts"]
    assert mount["Target"] == "/work"
    assert mount["Source"] == "ehpc_submissions"
    assert mount["ReadOnly"] is True
    assert mount["VolumeOptions"] == {"Subpath": "job2"}


def test_run_job_error_docker_se_traduce(tmp_path):
    svc, client = make_service(tmp_path)
    client.containers.create.side_effect = docker_pkg.errors.APIError("boom")
    with pytest.raises(ds.DockerServiceError):
        svc.run_job("job3", str(tmp_path / "job3"), threads=1, timeout_s=10)


def test_image_present(tmp_path):
    svc, client = make_service(tmp_path)
    assert svc.image_present() is True
    client.images.get.side_effect = docker_pkg.errors.ImageNotFound("no")
    assert svc.image_present() is False


def test_ping_daemon_caido(tmp_path):
    svc, client = make_service(tmp_path)
    client.ping.side_effect = RuntimeError("daemon down")
    assert svc.ping() is False


def test_reaper_contenedores_y_directorios(tmp_path):
    svc, client = make_service(tmp_path)
    c1, c2 = mock.MagicMock(), mock.MagicMock()
    client.containers.list.return_value = [c1, c2]
    (tmp_path / "huerfano1").mkdir()
    (tmp_path / "huerfano2").mkdir()
    (tmp_path / "huerfano2" / "main.py").write_text("x", encoding="utf-8")
    removed, dirs_removed = svc.reap_orphans()
    assert removed == 2 and dirs_removed == 2
    client.containers.list.assert_called_once_with(
        all=True, filters={"label": "ehpc.runner=true"}
    )
    c1.remove.assert_called_once_with(force=True, v=True)
    assert not (tmp_path / "huerfano1").exists()
    assert not (tmp_path / "huerfano2").exists()


def test_job_execution_wrapper():
    """JobExecution traduce docker-py → puerto estrecho (wait/kill/oom/remove)."""
    import requests

    container = mock.MagicMock()
    container.id = "cid123"
    execution = ds.JobExecution(container)
    assert execution.container_id == "cid123"

    execution.iter_logs("stdout")
    container.logs.assert_called_with(
        stream=True, follow=True, stdout=True, stderr=False
    )
    execution.iter_logs("stderr")
    container.logs.assert_called_with(
        stream=True, follow=True, stdout=False, stderr=True
    )
    execution.iter_stats()
    container.stats.assert_called_once_with(stream=True, decode=True)

    container.wait.return_value = {"StatusCode": 137}
    assert execution.wait(30) == 137
    container.wait.assert_called_with(timeout=30)

    # ReadTimeout Y ConnectionError (socket UNIX) ⇒ RunnerTimeout (§5.1)
    for exc_type in (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError):
        container.wait.side_effect = exc_type("lento")
        with pytest.raises(ds.RunnerTimeout):
            execution.wait(1)

    container.reload.return_value = None
    container.attrs = {"State": {"OOMKilled": True}}
    assert execution.oom_killed() is True
    container.attrs = {"State": {"OOMKilled": False}}
    assert execution.oom_killed() is False

    execution.kill()
    container.kill.assert_called_once_with()
    container.kill.side_effect = docker_pkg.errors.APIError("not running")
    execution.kill()  # carrera benigna: no lanza
    container.kill.side_effect = docker_pkg.errors.NotFound("gone")
    with pytest.raises(ds.RunnerNotFound):
        execution.kill()

    execution.remove()
    container.remove.assert_called_once_with(force=True, v=True)
    container.remove.side_effect = docker_pkg.errors.NotFound("gone")
    execution.remove()  # NotFound se ignora


def test_kill_por_label(tmp_path):
    svc, client = make_service(tmp_path)
    target = mock.MagicMock()
    client.containers.list.return_value = [target]
    svc.kill("job9")
    client.containers.list.assert_called_once_with(
        filters={"label": "ehpc.job=job9"}
    )
    target.kill.assert_called_once_with()
