"""Fakes de WP2 contra las firmas CONGELADAS (data-model §5, DockerServicePort).

Regla de la ola 1: esta suite NO importa módulos de WP1/WP3 salvo
``app.repositories.records`` (con fallback byte-compatible en conftest).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace
from types import SimpleNamespace
from typing import Callable, Iterator

from app.repositories.records import JobRecord
from app.services import RunnerTimeout

TERMINAL = frozenset({"completed", "failed", "timeout", "cancelled"})


# ─────────────────────────── settings / registros ───────────────────────────


def make_settings(**over) -> SimpleNamespace:
    base = dict(
        max_concurrent_jobs=2,
        max_output_bytes=262144,
        max_code_bytes=262144,
        max_timeout_s=120,
        runner_image="ehpc-runner:0.5.1",
        allowed_origins_list=["http://localhost:5173", "http://localhost:8080", "null"],
        code_delivery="bind",
        submissions_volume="ehpc_submissions",
    )
    base.update(over)
    return SimpleNamespace(**base)


def make_record(job_id: str, **over) -> JobRecord:
    base = dict(
        id=job_id,
        source_kind="editor",
        example_id=None,
        lesson_id=None,
        filename="main.py",
        source_code="print('x')\n",
        threads=2,
        timeout_s=5,
        runner_image="ehpc-runner:0.5.1",
        status="queued",
        container_id=None,
        error_detail=None,
        exit_code=None,
        oom_killed=False,
        stdout=None,
        stderr=None,
        output_truncated=False,
        metrics_summary=None,
        parsed_timings=None,
        created_at="2026-07-13T00:00:00.000Z",
        started_at=None,
        finished_at=None,
        wall_time_ms=None,
    )
    base.update(over)
    return JobRecord(**base)


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
    """Muestra cruda de docker stats (cgroups v2) con precpu válido."""
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


# ────────────────────────────── FakeExecution ───────────────────────────────


class FakeExecution:
    """Implementa JobExecutionPort con guion programable de logs/stats/exit.

    - ``hang=False``: el «proceso» ya terminó (wait devuelve exit_code al
      instante); los streams entregan sus chunks igualmente.
    - ``hang=True``: wait bloquea hasta ``kill()`` o ``finish()``.
    - ``repeat_last=True``: tras agotar los chunks, repite el último hasta
      que el proceso muera (para inundar el presupuesto de 256 KB).
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
        container_id: str = "fake-cid-0123456789abcdef",
    ) -> None:
        self._stdout = [bytes(c) for c in stdout]
        self._stderr = [bytes(c) for c in stderr]
        self._stats = list(stats)
        self._exit_code = exit_code
        self._oom = oom
        self._repeat_last = repeat_last
        self._cid = container_id
        self._done = threading.Event()
        self.killed = False
        self.removed = False
        if not hang:
            self._done.set()

    @property
    def container_id(self) -> str:
        return self._cid

    def finish(self, exit_code: int | None = None) -> None:
        """El «proceso» termina por sí mismo (sin kill)."""
        if exit_code is not None:
            self._exit_code = exit_code
        self._done.set()

    def iter_logs(self, stream: str) -> Iterator[bytes]:
        chunks = self._stdout if stream == "stdout" else self._stderr
        for chunk in chunks:
            yield chunk
        if self._repeat_last and chunks:
            while not self._done.is_set():
                yield chunks[-1]
        # el stream real queda abierto hasta que el contenedor muere
        self._done.wait(timeout=10)

    def iter_stats(self) -> Iterator[dict]:
        yield from self._stats

    def wait(self, timeout: float) -> int:
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


# ──────────────────────────── FakeDockerService ─────────────────────────────


class FakeDockerService:
    """Implementa DockerServicePort; ejecuciones por job o factory por defecto."""

    def __init__(self, default_factory: Callable[[], FakeExecution] | None = None) -> None:
        self.executions: dict[str, FakeExecution] = {}
        self.running: dict[str, FakeExecution] = {}
        self.prepared: dict[str, str] = {}
        self.cleaned: list[str] = []
        self.run_calls: list[dict] = []
        self.ping_ok = True
        self.image_ok = True
        self.reap_result = (0, 0)
        self.run_error: Exception | None = None
        self._default_factory = default_factory or (
            lambda: FakeExecution(stdout=[b"ok\n"])
        )

    def ping(self) -> bool:
        return self.ping_ok

    def image_present(self) -> bool:
        return self.image_ok

    def prepare_code(self, job_id: str, source_code: str) -> str:
        self.prepared[job_id] = source_code
        return f"/fake/jobs/{job_id}"

    def run_job(self, job_id: str, code_path: str, threads: int, timeout_s: int):
        if self.run_error is not None:
            raise self.run_error
        self.run_calls.append(
            {"job_id": job_id, "code_path": code_path,
             "threads": threads, "timeout_s": timeout_s}
        )
        execution = self.executions.get(job_id) or self._default_factory()
        self.running[job_id] = execution
        return execution

    def kill(self, job_id: str) -> None:
        execution = self.running.get(job_id)
        if execution is not None:
            execution.kill()

    def cleanup_code(self, job_id: str) -> None:
        self.cleaned.append(job_id)

    def reap_orphans(self) -> tuple[int, int]:
        return self.reap_result


# ─────────────────────────────── FakeJobRepo ────────────────────────────────


class FakeJobRepo:
    """Firma EXACTA de JobRepository (data-model §5) sobre un dict en memoria."""

    def __init__(self) -> None:
        self.records: dict[str, JobRecord] = {}
        self.finish_calls: list[dict] = []
        self.phase_calls: list[tuple[str, str]] = []

    async def create(self, job: JobRecord) -> JobRecord:
        self.records[job.id] = job
        return job

    async def find_by_id(self, job_id: str) -> JobRecord | None:
        return self.records.get(job_id)

    async def list_recent(
        self, *, limit: int = 20, offset: int = 0, status: str | None = None,
    ) -> tuple[list[JobRecord], int]:
        rows = [
            r for r in self.records.values()
            if status is None or r.status == status
        ]
        rows.sort(key=lambda r: r.created_at, reverse=True)
        return rows[offset:offset + limit], len(rows)

    async def set_phase(
        self, job_id: str, status: str, *,
        container_id: str | None = None, started_at: str | None = None,
    ) -> None:
        rec = self.records.get(job_id)
        if rec is None or rec.status in TERMINAL:  # guard de terminales
            return
        changes: dict = {"status": status}
        if container_id is not None:
            changes["container_id"] = container_id
        if started_at is not None:
            changes["started_at"] = started_at
        self.records[job_id] = replace(rec, **changes)
        self.phase_calls.append((job_id, status))

    async def finish(
        self, job_id: str, *, status: str, exit_code: int | None,
        oom_killed: bool, error_detail: str | None,
        stdout: str, stderr: str, output_truncated: bool,
        metrics_summary: dict | None, parsed_timings: dict | None,
        finished_at: str, wall_time_ms: int | None,
    ) -> None:
        call = dict(
            job_id=job_id, status=status, exit_code=exit_code,
            oom_killed=oom_killed, error_detail=error_detail, stdout=stdout,
            stderr=stderr, output_truncated=output_truncated,
            metrics_summary=metrics_summary, parsed_timings=parsed_timings,
            finished_at=finished_at, wall_time_ms=wall_time_ms,
        )
        self.finish_calls.append(call)
        rec = self.records.get(job_id)
        if rec is None or rec.status in TERMINAL:  # idempotente por terminal
            return
        self.records[job_id] = replace(
            rec, status=status, exit_code=exit_code, oom_killed=oom_killed,
            error_detail=error_detail, stdout=stdout, stderr=stderr,
            output_truncated=output_truncated, metrics_summary=metrics_summary,
            parsed_timings=parsed_timings, finished_at=finished_at,
            wall_time_ms=wall_time_ms,
        )

    async def mark_orphans_failed(self) -> int:
        count = 0
        for job_id, rec in list(self.records.items()):
            if rec.status not in TERMINAL:
                self.records[job_id] = replace(
                    rec, status="failed", error_detail="orphaned_on_restart"
                )
                count += 1
        return count


# ─────────────────────────────── FakeContent ────────────────────────────────


@dataclass
class FakeExample:
    id: str
    enabled: bool = True
    source_code: str = "print('fixture')\n"
    parser_id: str = "none"
    filename: str = "main.py"
    threads_configurable: bool = True
    sweeps_threads: bool = False
    fixed_threads: int | None = None
    fixed_threads_note: str | None = None
    default_timeout_s: int = 30


class FakeContent:
    def __init__(self, examples: tuple | list = (), lessons: tuple | list = ()) -> None:
        self._examples = {e.id: e for e in examples}
        self._lessons = set(lessons)

    def example(self, example_id: str):
        return self._examples.get(example_id)

    def exists_lesson(self, lesson_id: str) -> bool:
        return lesson_id in self._lessons


DEFAULT_EXAMPLES = (
    FakeExample(
        id="spmd", parser_id="sweep_pi", filename="piSpmd.py",
        threads_configurable=False, sweeps_threads=True, default_timeout_s=60,
    ),
    FakeExample(
        id="sumaVectores", parser_id="pair_openmp_numpy",
        filename="sumaVectores.py", default_timeout_s=45,
    ),
    FakeExample(
        id="monteCarloPi", filename="piMonteCarlo.py",
        threads_configurable=False, fixed_threads=4,
        fixed_threads_note="Este ejemplo fija 4 hilos por código; se asignan 4 CPUs.",
    ),
    FakeExample(id="sumaVectoresGPU", enabled=False, filename="sumaVectoresGPU.py"),
)


# ───────────────────────────── app de pruebas ───────────────────────────────


def build_app(
    *,
    settings=None,
    docker: FakeDockerService | None = None,
    repo: FakeJobRepo | None = None,
    content: FakeContent | None = None,
    flush_interval_s: float = 0.01,
):
    """FastAPI mínima con los routers de WP2 y app.state poblado con fakes."""
    from fastapi import FastAPI

    from app.routers import jobs as jobs_router
    from app.routers import ws as ws_router
    from app.services.job_runner import JobRunner

    settings = settings or make_settings()
    docker = docker if docker is not None else FakeDockerService()
    repo = repo if repo is not None else FakeJobRepo()
    content = content if content is not None else FakeContent(
        DEFAULT_EXAMPLES, lessons=("spmd", "sumaVectores")
    )
    runner = JobRunner(
        docker_service=docker, job_repo=repo, settings=settings,
        flush_interval_s=flush_interval_s,
    )
    app = FastAPI()
    app.include_router(jobs_router.router)
    app.include_router(ws_router.router)
    app.state.settings = settings
    app.state.docker_service = docker
    app.state.job_repo = repo
    app.state.content = content
    app.state.job_runner = runner
    ctx = SimpleNamespace(
        settings=settings, docker=docker, repo=repo, content=content, runner=runner
    )
    return app, ctx
