"""Acceso a Docker — ÚNICO módulo del repo que importa ``docker``.

Implementa architecture.md §3.1 (entrega de código bind/volume-subpath),
§4 (sandbox en capas, flags como CONSTANTES), §5 (módulo único aislado) y el
reaper del punto 8 de §3 (contenedores por label + directorios de submissions).

Ningún router/servicio importa ``docker``: consumen ``DockerServicePort`` /
``JobExecutionPort`` (typing.Protocol) inyectados en el lifespan.
Todas las llamadas son SÍNCRONAS (docker-py): el job_runner las puentea con
``asyncio.to_thread`` / threads daemon.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Iterator, Protocol

import docker
import requests
from docker.types import Ulimit

from . import DockerServiceError, RunnerNotFound, RunnerTimeout

if TYPE_CHECKING:  # pragma: no cover
    from docker.models.containers import Container

    from ..config import Settings

logger = logging.getLogger("telar.docker_service")

# ───────────────────── Constantes del sandbox (architecture §4) ──────────────
# El usuario JAMÁS influye en HostConfig: imagen/flags fijos por constante;
# solo `threads` (ya validado 1..max) y el timeout acotado llegan del exterior.

RUNNER_LABEL = "telar.runner"  # + telar.job=<id>; base del reaper (§4.15)
SANDBOX_NETWORK_MODE = "none"  # §4.1 sin red
SANDBOX_USER = "10001"  # §4.2 useradd runner, sin shell
SANDBOX_CAP_DROP = ["ALL"]  # §4.3
SANDBOX_SECURITY_OPT = ["no-new-privileges:true"]  # §4.4
SANDBOX_READ_ONLY = True  # §4.5 rootfs ro
SANDBOX_TMPFS = {"/tmp": "rw,noexec,nosuid,size=64m"}  # §4.6
SANDBOX_MEM_LIMIT = "512m"  # §4.7 mem == memswap ⇒ sin swap
SANDBOX_MEMSWAP_LIMIT = "512m"
SANDBOX_PIDS_LIMIT = 128  # §4.8
SANDBOX_ULIMITS = [  # §4.10
    {"name": "nofile", "soft": 256, "hard": 256},
    {"name": "fsize", "soft": 16_000_000, "hard": 16_000_000},
]
SANDBOX_INIT = True  # §4.11 tini PID 1
RUNNER_COMMAND = ["python", "-I", "/work/main.py"]  # -I: modo aislado CPython
RUNNER_WORKDIR = "/work"  # §4.12 código :ro
#: §3 punto 9 — defensa en profundidad contra print-floods en el disco host.
RUNNER_LOG_CONFIG = {"type": "json-file", "config": {"max-size": "4m", "max-file": "1"}}
#: Grace tras kill para recuperar el exit code real (137).
KILL_GRACE_S = 5


def sandbox_environment(threads: int) -> dict[str, str]:
    """§4.17 — env del runner; libomp no es cgroup-aware (SIEMPRE fijar N)."""
    return {
        "PYTHONUNBUFFERED": "1",
        "NUMBA_CACHE_DIR": "/tmp/numba_cache",
        "OMP_NUM_THREADS": str(threads),
        "NUMBA_NUM_THREADS": str(threads),
    }


# ─────────────────────────── Puertos (inyección) ────────────────────────────


class JobExecutionPort(Protocol):
    """Handle de un contenedor runner en ejecución (API estrecha)."""

    @property
    def container_id(self) -> str: ...

    def iter_logs(self, stream: str) -> Iterator[bytes]:
        """Generador BLOQUEANTE de chunks (stream='stdout'|'stderr')."""
        ...

    def iter_stats(self) -> Iterator[dict]:
        """Generador BLOQUEANTE de muestras crudas de docker stats (~1/s)."""
        ...

    def wait(self, timeout: float) -> int:
        """Bloquea hasta exit; lanza RunnerTimeout al exceder el wall-clock."""
        ...

    def kill(self) -> None:
        """SIGKILL al PID 1 — cierra ejecución + log-stream + stats-stream."""
        ...

    def oom_killed(self) -> bool:
        """reload() → attrs['State']['OOMKilled'] (desambigua el 137)."""
        ...

    def remove(self) -> None:
        """remove(force=True, v=True); NotFound se ignora (carrera benigna)."""
        ...


class DockerServicePort(Protocol):
    """Puerto del servicio Docker (architecture §5) — inyectado en lifespan."""

    def ping(self) -> bool: ...

    def image_present(self) -> bool: ...

    def prepare_code(self, job_id: str, source_code: str) -> str:
        """Escribe main.py (bind/volume según config); devuelve code_path."""
        ...

    def run_job(
        self, job_id: str, code_path: str, threads: int, timeout_s: int
    ) -> JobExecutionPort: ...

    def kill(self, job_id: str) -> None: ...

    def cleanup_code(self, job_id: str) -> None: ...

    def reap_orphans(self) -> tuple[int, int]:
        """(contenedores eliminados, directorios de código eliminados)."""
        ...


# ─────────────────────────── Implementación real ────────────────────────────


class JobExecution:
    """Wrapper fino y tipado sobre ``docker.models.containers.Container``."""

    def __init__(self, container: "Container") -> None:
        self._container = container

    @property
    def container_id(self) -> str:
        return str(self._container.id)

    def iter_logs(self, stream: str) -> Iterator[bytes]:
        # logs() (no attach): entrega desde el inicio — sin carrera de arranque.
        return self._container.logs(
            stream=True,
            follow=True,
            stdout=(stream == "stdout"),
            stderr=(stream == "stderr"),
        )

    def iter_stats(self) -> Iterator[dict]:
        return self._container.stats(stream=True, decode=True)

    def wait(self, timeout: float) -> int:
        try:
            result = self._container.wait(timeout=timeout)
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as exc:
            # timeout= es read-timeout HTTP; sobre socket UNIX puede venir
            # envuelto en ConnectionError (docker-py.md §5.1) — capturar ambos.
            raise RunnerTimeout(str(exc)) from exc
        return int(result.get("StatusCode", -1))

    def kill(self) -> None:
        try:
            self._container.kill()
        except docker.errors.NotFound as exc:
            raise RunnerNotFound(str(exc)) from exc
        except docker.errors.APIError:
            # "not running": ya había muerto — carrera benigna.
            pass

    def oom_killed(self) -> bool:
        try:
            self._container.reload()
            return bool(self._container.attrs.get("State", {}).get("OOMKilled", False))
        except docker.errors.NotFound:
            return False

    def remove(self) -> None:
        try:
            self._container.remove(force=True, v=True)
        except docker.errors.NotFound:
            pass


class DockerService:
    """Implementación real de ``DockerServicePort`` sobre docker-py ≥ 7.2."""

    def __init__(self, settings: "Settings", client: docker.DockerClient | None = None) -> None:
        self._settings = settings
        # Cliente único del lifespan; cada stream de logs/stats retiene una
        # conexión del pool → max_pool_size alto (docker-py.md §1).
        self._client = client or docker.from_env(version="auto", timeout=120, max_pool_size=50)

    # ---- salud -------------------------------------------------------------

    def ping(self) -> bool:
        try:
            return bool(self._client.ping())
        except Exception:  # daemon caído: cualquier excepción ⇒ False
            return False

    def image_present(self) -> bool:
        try:
            self._client.images.get(self._settings.runner_image)
            return True
        except docker.errors.ImageNotFound:
            return False
        except Exception:
            return False

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:  # pragma: no cover
            pass

    # ---- entrega de código (§3.1) -------------------------------------------

    def _code_base_dir(self) -> Path:
        if self._settings.code_delivery == "bind":
            return self._settings.jobs_dir_expanded
        return Path("/submissions")

    def prepare_code(self, job_id: str, source_code: str) -> str:
        job_dir = self._code_base_dir() / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "main.py").write_text(source_code, encoding="utf-8")
        return str(job_dir)

    def cleanup_code(self, job_id: str) -> None:
        job_dir = self._code_base_dir() / job_id
        try:
            shutil.rmtree(job_dir, ignore_errors=True)
        except OSError:  # pragma: no cover
            pass

    # ---- lanzamiento --------------------------------------------------------

    def _code_mount_kwargs(self, job_id: str, code_path: str) -> dict:
        """bind: ruta del host :ro · volume: volumen nombrado con subpath :ro."""
        if self._settings.code_delivery == "bind":
            return {"volumes": {code_path: {"bind": RUNNER_WORKDIR, "mode": "ro"}}}
        mount = docker.types.Mount(
            target=RUNNER_WORKDIR,
            source=self._settings.submissions_volume,
            type="volume",
            read_only=True,
        )
        # subpath: docker-py ≥ 7.2 / API ≥ 1.45. Mount es un dict: se fija el
        # campo de la API directamente (robusto ante variaciones del kwarg).
        mount["VolumeOptions"] = {"Subpath": job_id}
        return {"mounts": [mount]}

    def run_job(
        self, job_id: str, code_path: str, threads: int, timeout_s: int
    ) -> JobExecutionPort:
        """create + start con los flags CONSTANTES de §4. NO bloquea (detach)."""
        del timeout_s  # el timeout duro lo aplica el job_runner en wait()
        container = None
        try:
            container = self._client.containers.create(
                image=self._settings.runner_image,
                command=RUNNER_COMMAND,
                name=f"telar-run-{job_id}",
                detach=True,
                labels={RUNNER_LABEL: "true", "telar.job": job_id},
                # --- aislamiento (§4) ---
                network_mode=SANDBOX_NETWORK_MODE,
                user=SANDBOX_USER,
                cap_drop=list(SANDBOX_CAP_DROP),
                security_opt=list(SANDBOX_SECURITY_OPT),
                read_only=SANDBOX_READ_ONLY,
                tmpfs=dict(SANDBOX_TMPFS),
                init=SANDBOX_INIT,
                # --- recursos coherentes con N hilos (§4.9, §7.3) ---
                mem_limit=SANDBOX_MEM_LIMIT,
                memswap_limit=SANDBOX_MEMSWAP_LIMIT,
                nano_cpus=threads * 1_000_000_000,
                cpuset_cpus=f"0-{threads - 1}",
                pids_limit=SANDBOX_PIDS_LIMIT,
                ulimits=[Ulimit(**u) for u in SANDBOX_ULIMITS],
                # --- entorno PyOMP/Numba (§4.17) ---
                environment=sandbox_environment(threads),
                working_dir=RUNNER_WORKDIR,
                # --- ciclo de vida (§3 puntos 2 y 9) ---
                auto_remove=False,
                log_config=RUNNER_LOG_CONFIG,
                **self._code_mount_kwargs(job_id, code_path),
            )
            container.start()
        except docker.errors.DockerException as exc:
            logger.exception("run_job(%s) falló", job_id)
            if container is not None:
                # BL-15: create() triunfó pero start() falló — sin esto el
                # contenedor queda en el daemon hasta el próximo reaper.
                try:
                    container.remove(force=True, v=True)
                except docker.errors.NotFound:
                    pass  # ya no existe: carrera benigna, nada que limpiar
                except (docker.errors.DockerException, requests.exceptions.RequestException):
                    # Si el daemon se cayó a mitad del ciclo create→start, el
                    # remove golpea la misma conectividad rota y docker-py
                    # deja escapar la excepción cruda de requests (mismo caso
                    # que wait(), docker-py.md §5.1): se atrapan ambas para no
                    # romper la frontera del módulo con una excepción sin
                    # abstraer.
                    logger.warning(
                        "run_job(%s): no se pudo eliminar el contenedor "
                        "tras el fallo de start()", job_id,
                    )
            raise DockerServiceError(str(exc)) from exc
        return JobExecution(container)

    def kill(self, job_id: str) -> None:
        """Mata el runner del job por label (vía REST /cancel sin handle)."""
        try:
            containers = self._client.containers.list(
                filters={"label": f"telar.job={job_id}"}
            )
            for container in containers:
                try:
                    container.kill()
                except docker.errors.APIError:
                    pass
        except docker.errors.DockerException as exc:
            raise DockerServiceError(str(exc)) from exc

    # ---- reaper (§3 punto 8) -------------------------------------------------

    def reap_orphans(self) -> tuple[int, int]:
        removed = 0
        try:
            orphans = self._client.containers.list(
                all=True, filters={"label": f"{RUNNER_LABEL}=true"}
            )
            for container in orphans:
                try:
                    container.remove(force=True, v=True)
                    removed += 1
                except docker.errors.APIError:
                    logger.warning("reaper: no se pudo eliminar %s", container.id)
        except docker.errors.DockerException:
            logger.exception("reaper: fallo listando contenedores huérfanos")

        dirs_removed = 0
        base = self._code_base_dir()
        if base.is_dir():
            for child in base.iterdir():
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                    dirs_removed += 1
        return removed, dirs_removed
