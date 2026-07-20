"""``docker_service`` real con cliente docker-py STUB (sin daemon).

Verifica que los flags del sandbox (architecture §4) son constantes que
llegan intactos a ``containers.create``, la entrega de código bind/volume
(§3.1), el reaper (§3 p.8) y el mapeo de excepciones docker-py → excepciones
propias del servicio. Ninguna llamada toca un daemon real.
"""

from __future__ import annotations

from pathlib import Path

import docker
import pytest
import requests

from app.config import Settings
from app.services import DockerServiceError, RunnerNotFound, RunnerTimeout
from app.services.docker_service import (
    RUNNER_COMMAND,
    RUNNER_LABEL,
    RUNNER_LOG_CONFIG,
    DockerService,
    JobExecution,
    sandbox_environment,
)


# ────────────────────────────── stubs docker-py ──────────────────────────────


class StubContainer:
    def __init__(self, cid="cid-1", *, wait_result=None, wait_error=None,
                 attrs=None, kill_error=None, remove_error=None,
                 start_error=None):
        self.id = cid
        self.attrs = attrs or {"State": {"OOMKilled": False}}
        self._wait_result = wait_result or {"StatusCode": 0}
        self._wait_error = wait_error
        self._kill_error = kill_error
        self._remove_error = remove_error
        self._start_error = start_error
        self.started = False
        self.killed = False
        self.removed = False
        self.reloaded = False
        self.log_calls = []

    def start(self):
        if self._start_error is not None:
            raise self._start_error
        self.started = True

    def logs(self, **kwargs):
        self.log_calls.append(kwargs)
        return iter([b"chunk\n"])

    def stats(self, **kwargs):
        return iter([{"cpu_stats": {}}])

    def wait(self, timeout=None):
        if self._wait_error is not None:
            raise self._wait_error
        return self._wait_result

    def kill(self):
        if self._kill_error is not None:
            raise self._kill_error
        self.killed = True

    def reload(self):
        self.reloaded = True

    def remove(self, force=False, v=False):
        if self._remove_error is not None:
            raise self._remove_error
        self.removed = (force, v)


class StubContainers:
    def __init__(self):
        self.create_kwargs = None
        self.container = StubContainer()
        self.create_error = None
        self.listed = []
        self.list_filters = []

    def create(self, **kwargs):
        if self.create_error is not None:
            raise self.create_error
        self.create_kwargs = kwargs
        return self.container

    def list(self, all=False, filters=None):
        self.list_filters.append({"all": all, "filters": filters})
        return list(self.listed)


class StubImages:
    def __init__(self):
        self.present = True

    def get(self, name):
        if not self.present:
            raise docker.errors.ImageNotFound(f"no image {name}")
        return object()


class StubClient:
    def __init__(self):
        self.containers = StubContainers()
        self.images = StubImages()
        self.ping_result = True
        self.ping_error = None
        self.closed = False

    def ping(self):
        if self.ping_error is not None:
            raise self.ping_error
        return self.ping_result

    def close(self):
        self.closed = True


@pytest.fixture
def stub() -> StubClient:
    return StubClient()


@pytest.fixture
def service(settings: Settings, stub: StubClient) -> DockerService:
    return DockerService(settings, client=stub)


# ─────────────────────────────── salud ───────────────────────────────────────


def test_ping_ok_y_daemon_caido(service, stub):
    assert service.ping() is True
    stub.ping_error = requests.exceptions.ConnectionError("boom")
    assert service.ping() is False


def test_image_present_y_ausente(service, stub):
    assert service.image_present() is True
    stub.images.present = False
    assert service.image_present() is False


def test_close_no_lanza(service, stub):
    service.close()
    assert stub.closed is True


# ───────────────────── entrega de código (§3.1, modo bind) ───────────────────


def test_prepare_y_cleanup_code_bind(service, settings):
    code_path = service.prepare_code("job1", "print('hola')\n")
    main_py = Path(code_path) / "main.py"
    assert Path(code_path) == settings.jobs_dir_expanded / "job1"
    assert main_py.read_text(encoding="utf-8") == "print('hola')\n"
    service.cleanup_code("job1")
    assert not main_py.exists()


def test_cleanup_code_inexistente_es_benigno(service):
    service.cleanup_code("jamas-existio")  # no lanza


# ──────────────────────── run_job: sandbox §4 completo ───────────────────────


def test_run_job_flags_sandbox_constantes(service, stub, settings):
    execution = service.run_job("job1", "/host/jobs/job1", threads=4, timeout_s=30)
    kwargs = stub.containers.create_kwargs
    assert kwargs["image"] == settings.runner_image  # §4.16 imagen fija
    assert kwargs["command"] == RUNNER_COMMAND
    assert kwargs["network_mode"] == "none"                      # §4.1
    assert kwargs["user"] == "10001"                             # §4.2
    assert kwargs["cap_drop"] == ["ALL"]                         # §4.3
    assert kwargs["security_opt"] == ["no-new-privileges:true"]  # §4.4
    assert kwargs["read_only"] is True                           # §4.5
    assert kwargs["tmpfs"] == {"/tmp": "rw,noexec,nosuid,size=64m"}  # §4.6
    assert kwargs["mem_limit"] == "512m"                         # §4.7
    assert kwargs["memswap_limit"] == "512m"                     # sin swap
    assert kwargs["pids_limit"] == 128                           # §4.8
    assert kwargs["nano_cpus"] == 4_000_000_000                  # §4.9
    assert kwargs["cpuset_cpus"] == "0-3"
    assert kwargs["init"] is True                                # §4.11
    assert kwargs["auto_remove"] is False                        # §3 p.2
    assert kwargs["log_config"] == RUNNER_LOG_CONFIG             # §3 p.9
    assert kwargs["labels"] == {RUNNER_LABEL: "true", "ehpc.job": "job1"}
    env = kwargs["environment"]
    assert env["OMP_NUM_THREADS"] == "4" and env["NUMBA_NUM_THREADS"] == "4"
    assert env["PYTHONUNBUFFERED"] == "1"
    assert env["NUMBA_CACHE_DIR"] == "/tmp/numba_cache"
    ulimits = {u["Name"]: (u["Soft"], u["Hard"]) for u in kwargs["ulimits"]}
    assert ulimits == {"nofile": (256, 256), "fsize": (16_000_000, 16_000_000)}
    # bind: la ruta del HOST montada :ro en /work (§3.1)
    assert kwargs["volumes"] == {
        "/host/jobs/job1": {"bind": "/work", "mode": "ro"}
    }
    assert stub.containers.container.started is True
    assert execution.container_id == "cid-1"


def test_run_job_modo_volume_subpath(stub, settings):
    volume_settings = settings.model_copy(update={"code_delivery": "volume"})
    service = DockerService(volume_settings, client=stub)
    service.run_job("job1", "/submissions/job1", threads=2, timeout_s=30)
    kwargs = stub.containers.create_kwargs
    assert "volumes" not in kwargs
    (mount,) = kwargs["mounts"]
    assert mount["Target"] == "/work"
    assert mount["Source"] == settings.submissions_volume
    assert mount["Type"] == "volume"
    assert mount["ReadOnly"] is True
    assert mount["VolumeOptions"] == {"Subpath": "job1"}  # docker-py ≥ 7.2


def test_run_job_docker_exception_se_traduce(service, stub):
    stub.containers.create_error = docker.errors.APIError("500 server error")
    with pytest.raises(DockerServiceError):
        service.run_job("job1", "/x", threads=1, timeout_s=30)


# ─────────── BL-15: sin contenedor huérfano si start() falla ─────────────────


def test_bl15_start_fallido_tras_create_elimina_el_contenedor(service, stub):
    """create() OK + start() KO: el contenedor recién creado se elimina
    (remove force+v) en vez de quedar en el daemon hasta el próximo reaper."""
    stub.containers.container = StubContainer(
        start_error=docker.errors.APIError("cgroup roto")
    )
    with pytest.raises(DockerServiceError):
        service.run_job("job1", "/x", threads=1, timeout_s=30)
    assert stub.containers.container.removed == (True, True)  # force=True, v=True


def test_bl15_create_fallido_no_intenta_remove(service, stub):
    stub.containers.create_error = docker.errors.APIError("500 server error")
    with pytest.raises(DockerServiceError):
        service.run_job("job1", "/x", threads=1, timeout_s=30)
    assert stub.containers.container.removed is False


def test_bl15_fallo_del_remove_no_enmascara_el_error_original(service, stub):
    stub.containers.container = StubContainer(
        start_error=docker.errors.APIError("cgroup roto"),
        remove_error=docker.errors.APIError("contenedor ocupado"),
    )
    with pytest.raises(DockerServiceError) as excinfo:
        service.run_job("job1", "/x", threads=1, timeout_s=30)
    assert "cgroup roto" in str(excinfo.value)


# ─────── BL-14: cpuset 0..N-1 — limitación documentada (architecture §4) ─────


def test_bl14_cpuset_siempre_arranca_en_el_core_0(service, stub):
    """Decisión de la zona gris 6: NO hay cpuset disjunto por slot. Dos jobs
    concurrentes comparten los cores 0..N-1; la reproducibilidad de las
    métricas de speedup aplica ejecutando un job a la vez (architecture §4)."""
    service.run_job("job1", "/x", threads=4, timeout_s=30)
    assert stub.containers.create_kwargs["cpuset_cpus"] == "0-3"


def test_sandbox_environment_valores():
    env = sandbox_environment(8)
    assert env["OMP_NUM_THREADS"] == "8" and env["NUMBA_NUM_THREADS"] == "8"


# ──────────────────────────── kill por label ─────────────────────────────────


def test_kill_por_label(service, stub):
    target = StubContainer()
    stub.containers.listed = [target]
    service.kill("job1")
    assert target.killed is True
    assert stub.containers.list_filters[-1]["filters"] == {
        "label": "ehpc.job=job1"
    }


def test_kill_api_error_benigno_y_daemon_caido(service, stub):
    dead = StubContainer(kill_error=docker.errors.APIError("not running"))
    stub.containers.listed = [dead]
    service.kill("job1")  # APIError del contenedor: carrera benigna

    def broken_list(all=False, filters=None):
        raise docker.errors.APIError("daemon")

    stub.containers.list = broken_list
    with pytest.raises(DockerServiceError):
        service.kill("job1")


# ─────────────────────────── reaper (§3 punto 8) ─────────────────────────────


def test_reap_orphans_contenedores_y_directorios(service, stub, settings):
    orphan = StubContainer()
    stub.containers.listed = [orphan]
    jobs_dir = settings.jobs_dir_expanded
    (jobs_dir / "viejo1").mkdir(parents=True)
    (jobs_dir / "viejo2").mkdir()
    (jobs_dir / "viejo2" / "main.py").write_text("x")

    removed, dirs_removed = service.reap_orphans()
    assert removed == 1 and dirs_removed == 2
    assert orphan.removed == (True, True)  # force=True, v=True
    assert stub.containers.list_filters[-1] == {
        "all": True, "filters": {"label": "ehpc.runner=true"}
    }
    assert not (jobs_dir / "viejo1").exists()


def test_reap_orphans_tolerante_a_errores(service, stub):
    bad = StubContainer(remove_error=docker.errors.APIError("in use"))
    stub.containers.listed = [bad]
    removed, _ = service.reap_orphans()
    assert removed == 0  # no lanza; lo deja logueado


# ───────────────────────── JobExecution (wrapper) ────────────────────────────


def test_execution_iter_logs_demultiplexa():
    container = StubContainer()
    execution = JobExecution(container)
    list(execution.iter_logs("stdout"))
    list(execution.iter_logs("stderr"))
    assert container.log_calls[0]["stdout"] is True
    assert container.log_calls[0]["stderr"] is False
    assert container.log_calls[1]["stdout"] is False
    assert container.log_calls[1]["stderr"] is True
    assert container.log_calls[0]["stream"] is True
    assert container.log_calls[0]["follow"] is True


def test_execution_wait_exit_y_timeout():
    assert JobExecution(StubContainer(wait_result={"StatusCode": 7})).wait(5) == 7
    for exc in (
        requests.exceptions.ReadTimeout("t"),
        requests.exceptions.ConnectionError("c"),  # socket UNIX (docker-py §5.1)
    ):
        with pytest.raises(RunnerTimeout):
            JobExecution(StubContainer(wait_error=exc)).wait(0.1)


def test_execution_kill_variantes():
    ok = StubContainer()
    JobExecution(ok).kill()
    assert ok.killed is True
    gone = StubContainer(kill_error=docker.errors.NotFound("gone"))
    with pytest.raises(RunnerNotFound):
        JobExecution(gone).kill()
    dead = StubContainer(kill_error=docker.errors.APIError("not running"))
    JobExecution(dead).kill()  # carrera benigna: no lanza


def test_execution_oom_killed():
    oom = StubContainer(attrs={"State": {"OOMKilled": True}})
    execution = JobExecution(oom)
    assert execution.oom_killed() is True
    assert oom.reloaded is True  # §3 p.7: reload ANTES de leer attrs
    missing = StubContainer(kill_error=None)
    missing.reload = lambda: (_ for _ in ()).throw(docker.errors.NotFound("x"))
    assert JobExecution(missing).oom_killed() is False


def test_execution_remove_force_y_notfound():
    container = StubContainer()
    JobExecution(container).remove()
    assert container.removed == (True, True)
    gone = StubContainer(remove_error=docker.errors.NotFound("gone"))
    JobExecution(gone).remove()  # NotFound se ignora
