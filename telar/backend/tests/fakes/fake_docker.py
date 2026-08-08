"""FakeRunner — implementación SCRIPTABLE de ``DockerServicePort`` (WP9).

Cumple estructuralmente los Protocols de ``app.services.docker_service``
(``DockerServicePort`` / ``JobExecutionPort``) sin importar ``docker``:
toda la suite integral corre SIN daemon (criterio de WP9).

Guiones soportados:
- ``FakeExecution``: chunks de stdout/stderr, muestras de stats, exit code,
  OOM, colgado hasta ``kill()``/``finish()``, repetición del último chunk
  (para inundar el presupuesto de 256 KB) y excepciones a mitad de stream.
- ``FakeDockerService``: cola FIFO de ejecuciones por ``run_job``, guiones
  por job_id, y flags de error para ``ping``/``image_present``/
  ``prepare_code``/``run_job``.
"""

from __future__ import annotations

import threading
from typing import Callable, Iterator

from app.services import RunnerTimeout


def stats_sample(
    *,
    cpu_total: int = 2_000_000_000,
    pre_total: int = 1_000_000_000,
    system: int = 10_000_000_000,
    pre_system: int = 9_000_000_000,
    online: int = 8,
    usage: int = 100_000_000,
    inactive: int = 10_000_000,
    limit: int = 536_870_912,
    pids: int = 12,
    throttled: int = 0,
) -> dict:
    """Muestra cruda de ``docker stats`` (cgroups v2) con ``precpu`` válido."""
    return {
        "cpu_stats": {
            "cpu_usage": {"total_usage": cpu_total},
            "system_cpu_usage": system,
            "online_cpus": online,
            "throttling_data": {"throttled_periods": throttled},
        },
        "precpu_stats": {
            "cpu_usage": {"total_usage": pre_total},
            "system_cpu_usage": pre_system,
        },
        "memory_stats": {
            "usage": usage,
            "limit": limit,
            "stats": {"inactive_file": inactive},
        },
        "pids_stats": {"current": pids},
    }


def first_stats_sample() -> dict:
    """La 1ª muestra del daemon llega SIN ``precpu_stats`` → se descarta."""
    return {
        "cpu_stats": {"cpu_usage": {"total_usage": 1}, "online_cpus": 8},
        "memory_stats": {"usage": 1, "limit": 2},
    }


class FakeExecution:
    """Implementa ``JobExecutionPort`` con guion programable.

    - ``hang=False``: el «proceso» ya terminó (``wait`` devuelve el exit code
      al instante); los streams entregan sus chunks igualmente.
    - ``hang=True``: ``wait`` bloquea hasta ``kill()`` o ``finish()``.
    - ``repeat_last=True``: tras agotar los chunks repite el último hasta que
      el proceso muera (inunda el presupuesto del drainer).
    - ``log_error``: excepción lanzada por ``iter_logs`` tras sus chunks.
    - ``stats_error``: excepción lanzada por ``iter_stats`` tras sus muestras.
    """

    def __init__(
        self,
        *,
        stdout: tuple | list = (),
        stderr: tuple | list = (),
        stats: tuple | list = (),
        exit_code: int = 0,
        oom: bool = False,
        hang: bool = False,
        repeat_last: bool = False,
        log_error: Exception | None = None,
        stats_error: Exception | None = None,
        container_id: str = "fake-cid-0123456789abcdef",
    ) -> None:
        self._stdout = [bytes(c) for c in stdout]
        self._stderr = [bytes(c) for c in stderr]
        self._stats = list(stats)
        self._exit_code = exit_code
        self._oom = oom
        self._repeat_last = repeat_last
        self._log_error = log_error
        self._stats_error = stats_error
        self._cid = container_id
        self._done = threading.Event()
        self.killed = False
        self.removed = False
        #: Timeouts con los que el runner llamó a wait() (None = sin timeout).
        self.wait_timeouts: list[float | None] = []
        if not hang:
            self._done.set()

    # ── control del guion ────────────────────────────────────────────────────

    def finish(self, exit_code: int | None = None) -> None:
        """El «proceso» termina por sí mismo (sin kill)."""
        if exit_code is not None:
            self._exit_code = exit_code
        self._done.set()

    # ── JobExecutionPort ─────────────────────────────────────────────────────

    @property
    def container_id(self) -> str:
        return self._cid

    def iter_logs(self, stream: str) -> Iterator[bytes]:
        chunks = self._stdout if stream == "stdout" else self._stderr
        for chunk in chunks:
            yield chunk
        if self._log_error is not None and stream == "stdout":
            raise self._log_error
        if self._repeat_last and chunks:
            while not self._done.is_set():
                yield chunks[-1]
        # el stream real queda abierto hasta que el contenedor muere
        self._done.wait(timeout=10)

    def iter_stats(self) -> Iterator[dict]:
        yield from self._stats
        if self._stats_error is not None:
            raise self._stats_error

    def wait(self, timeout: float | None) -> int:
        # `timeout=None` ⇒ espera indefinida (job sin timeout): Event.wait(None)
        # bloquea hasta que alguien lo despierte y NUNCA devuelve False, así que
        # es imposible que salga un RunnerTimeout. Se registra el valor recibido
        # para que los tests comprueben que el runner propagó None.
        self.wait_timeouts.append(timeout)
        if not self._done.wait(timeout):
            raise RunnerTimeout(f"wait({timeout}) excedido (fake)")
        return 137 if self.killed else self._exit_code

    def kill(self) -> None:
        self.killed = True
        self._done.set()

    def oom_killed(self) -> bool:
        return self._oom

    def remove(self) -> None:
        self.removed = True


class FakeDockerService:
    """Implementa ``DockerServicePort``; guiones por job o cola FIFO/factory."""

    def __init__(
        self, default_factory: Callable[[], FakeExecution] | None = None
    ) -> None:
        self.by_job: dict[str, FakeExecution] = {}
        self.pending: list[FakeExecution] = []  # FIFO para los próximos run_job
        self.running: dict[str, FakeExecution] = {}
        self.prepared: dict[str, str] = {}
        self.cleaned: list[str] = []
        self.run_calls: list[dict] = []
        self.kill_calls: list[str] = []
        self.ping_ok = True
        self.image_ok = True
        self.reap_result = (0, 0)
        self.reap_calls = 0
        self.reap_error: Exception | None = None
        self.run_error: Exception | None = None
        self.prepare_error: Exception | None = None
        self.default_factory = default_factory or (
            lambda: FakeExecution(stdout=[b"ok\n"])
        )

    # ── guiones ──────────────────────────────────────────────────────────────

    def queue_execution(self, execution: FakeExecution) -> FakeExecution:
        """Guiona la ejecución del PRÓXIMO ``run_job`` (orden FIFO)."""
        self.pending.append(execution)
        return execution

    # ── DockerServicePort ────────────────────────────────────────────────────

    def ping(self) -> bool:
        return self.ping_ok

    def image_present(self) -> bool:
        return self.image_ok

    def prepare_code(self, job_id: str, source_code: str) -> str:
        if self.prepare_error is not None:
            raise self.prepare_error
        self.prepared[job_id] = source_code
        return f"/fake/jobs/{job_id}"

    def run_job(self, job_id: str, code_path: str, threads: int, timeout_s: int):
        if self.run_error is not None:
            raise self.run_error
        self.run_calls.append(
            {"job_id": job_id, "code_path": code_path,
             "threads": threads, "timeout_s": timeout_s}
        )
        execution = self.by_job.get(job_id)
        if execution is None and self.pending:
            execution = self.pending.pop(0)
        if execution is None:
            execution = self.default_factory()
        self.running[job_id] = execution
        return execution

    def kill(self, job_id: str) -> None:
        self.kill_calls.append(job_id)
        execution = self.running.get(job_id)
        if execution is not None:
            execution.kill()

    def cleanup_code(self, job_id: str) -> None:
        self.cleaned.append(job_id)

    def reap_orphans(self) -> tuple[int, int]:
        self.reap_calls += 1
        if self.reap_error is not None:
            raise self.reap_error
        return self.reap_result
