"""Orquestación del ciclo de vida de un job — architecture.md §3 COMPLETO.

Semáforo TELAR_MAX_CONCURRENT_JOBS + registro en memoria; **drainer por job**
(§3.2: presupuesto 256 KB, ring-buffer + seq, metrics_summary, fan-out lossy);
``cancel_requested`` tras el semáforo y ANTES de create (§3.3); ``kill_reason``
con prioridad cancel > output_limit > timeout escrito ANTES de kill(); orden
estricto de terminación (§3.4); puente threads→asyncio con
``run_coroutine_threadsafe(...).result(timeout)`` para logs (backpressure) y
``call_soon_threadsafe(put_nowait)`` para métricas (lossy).

Este módulo NO importa ``docker``: recibe ``DockerServicePort`` inyectado.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import itertools
import logging
import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from . import DockerServiceError, RunnerTimeout
from .output_parser import parse_output

if TYPE_CHECKING:  # pragma: no cover — solo tipos; jamás importa docker
    from ..config import Settings
    from .docker_service import DockerServicePort, JobExecutionPort

logger = logging.getLogger("telar.job_runner")

# ─────────────────────────────── Constantes ─────────────────────────────────

# Prioridad §3.3 cancel > output_limit > timeout: primer-escritor-gana.
KILL_NONE = "none"
KILL_CANCEL = "cancel"
KILL_OUTPUT_LIMIT = "output_limit"
KILL_TIMEOUT = "timeout"

TERMINAL_STATUSES = frozenset({"completed", "failed", "timeout", "cancelled"})

CENTRAL_QUEUE_MAX = 1000  # backpressure del productor contra el drainer (§8.4)
SUBSCRIBER_QUEUE_MAX = 200  # cola por-conexión, put_nowait lossy (§3.2)
BACKLOG_MAX_LINES = 500  # ring-buffer de replay (§3.2)
FLUSH_INTERVAL_S = 0.1  # un mensaje `log` cada ~100 ms… (§8.4)
FLUSH_MAX_BYTES = 4096  # …o al acumular 4 KB, lo que ocurra antes (§8.4)
BRIDGE_PUT_TIMEOUT_S = 5.0  # .result(timeout): el thread jamás cuelga (§3 p.3)
KILL_GRACE_S = 5.0  # wait() tras kill para el exit code real (137)
STREAMS_EOF_GRACE_S = 10.0  # espera de EOF de logs tras exit
# §3.4 paso 5 diferido (§8.2/BL-09): el handle terminal se retiene este
# periodo para que una reconexión (backoff 1s/2s/4s del cliente) reciba el
# backlog con los seq ORIGINALES en vez del replay renumerado desde DB.
TERMINAL_HANDLE_RETENTION_S = 10.0
_QUEUE_CLOSED = None  # sentinela de cierre de cola por-conexión
_FINALIZE = object()  # sentinela interno drainer (comparado por identidad)


def utc_now_iso() -> str:
    """ISO-8601 UTC con milisegundos y sufijo Z (contrato §0)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _iso_delta_ms(start: str, end: str) -> int | None:
    try:
        t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(end.replace("Z", "+00:00"))
        return max(int((t1 - t0).total_seconds() * 1000), 0)
    except ValueError:
        return None


def compute_metrics(sample: dict) -> dict | None:
    """Stats crudos → métricas WS (cgroups v2); None si la muestra es
    incompleta (la 1ª sin precpu, o la final). Formato puro: por eso vive
    aquí y no en docker_service (que arrastraría el import de docker)."""
    try:
        cpu = sample["cpu_stats"]
        pre = sample["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"]["total_usage"]
        system_delta = cpu["system_cpu_usage"] - pre.get("system_cpu_usage", 0)
        online = cpu.get("online_cpus") or 1
        cpu_percent = 0.0
        if system_delta > 0 and cpu_delta >= 0:
            cpu_percent = (cpu_delta / system_delta) * online * 100.0

        mem = sample["memory_stats"]
        stats = mem.get("stats", {})
        cache = stats.get("inactive_file", stats.get("total_inactive_file", 0))
        mem_used = max(mem["usage"] - cache, 0)
        mem_limit = mem.get("limit", 0)
        return {
            "cpu_percent": round(cpu_percent, 2),
            "online_cpus": int(online),
            "mem_used_bytes": int(mem_used),
            "mem_limit_bytes": int(mem_limit),
            "mem_percent": round(mem_used / mem_limit * 100, 2) if mem_limit else 0.0,
            "pids": int(sample.get("pids_stats", {}).get("current", 0)),
            "throttled_periods": int(cpu.get("throttling_data", {}).get("throttled_periods", 0)),
        }
    except (KeyError, TypeError):
        return None


# ─────────────────────────── Estado en memoria ──────────────────────────────


@dataclass
class _MetricsAccumulator:
    """Agregado de muestras → ``jobs.metrics_summary`` (data-model §3.1)."""

    samples: int = 0
    cpu_max: float = 0.0
    cpu_sum: float = 0.0
    mem_used_max: int = 0
    mem_limit: int = 0
    pids_max: int = 0
    throttled_periods: int = 0

    def add(self, m: dict) -> None:
        self.samples += 1
        self.cpu_max = max(self.cpu_max, m["cpu_percent"])
        self.cpu_sum += m["cpu_percent"]
        self.mem_used_max = max(self.mem_used_max, m["mem_used_bytes"])
        self.mem_limit = m["mem_limit_bytes"] or self.mem_limit
        self.pids_max = max(self.pids_max, m["pids"])
        self.throttled_periods = m["throttled_periods"]  # último acumulado

    def summary(self) -> dict | None:
        if self.samples == 0:
            return None
        return {
            "samples": self.samples,
            "cpu_percent_max": round(self.cpu_max, 2),
            "cpu_percent_avg": round(self.cpu_sum / self.samples, 2),
            "mem_used_bytes_max": self.mem_used_max, "mem_limit_bytes": self.mem_limit,
            "pids_max": self.pids_max, "throttled_periods": self.throttled_periods,
        }


@dataclass
class JobHandle:
    """Entrada del registro ``app.state.jobs[job_id]`` (architecture §3.3)."""

    job_id: str
    source_code: str
    threads: int
    timeout_s: int
    parser_id: str
    max_output_bytes: int
    lesson_id: str | None = None  # §7.1: destino de last_job_id al completar
    phase: str = "queued"
    cancel_requested: bool = False
    kill_reason: str = KILL_NONE
    task: asyncio.Task | None = None
    drainer: asyncio.Task | None = None
    execution: "JobExecutionPort | None" = None
    code_prepared: bool = False
    closed: bool = False  # terminal + eof emitidos y colas cerradas
    started_at: str | None = None
    terminal_detail: dict | None = None
    # drainer / fan-out
    central_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    subscribers: dict[int, asyncio.Queue] = field(default_factory=dict)
    backlog: deque = field(default_factory=deque)
    backlog_lines: int = 0
    seq: int = 0
    stdout_parts: list[bytes] = field(default_factory=list)
    stderr_parts: list[bytes] = field(default_factory=list)
    total_log_bytes: int = 0
    output_truncated: bool = False
    metrics: _MetricsAccumulator = field(default_factory=_MetricsAccumulator)
    streams_done: asyncio.Event = field(default_factory=asyncio.Event)
    producer_stop: threading.Event = field(default_factory=threading.Event)
    aux_tasks: list[asyncio.Task] = field(default_factory=list)

    def request_kill(self, reason: str) -> bool:
        """Primer escritor gana (§3.3); True si esta llamada fijó la razón."""
        if self.kill_reason == KILL_NONE:
            self.kill_reason = reason
            return True
        return False

    def stdout_text(self) -> str:
        return b"".join(self.stdout_parts).decode("utf-8", errors="replace")

    def stderr_text(self) -> str:
        return b"".join(self.stderr_parts).decode("utf-8", errors="replace")


def _safe_put_nowait(queue: asyncio.Queue, item: Any) -> None:
    try:
        queue.put_nowait(item)
    except asyncio.QueueFull:
        pass


# ──────────────────────────────── JobRunner ─────────────────────────────────


class JobRunner:
    """Un task + un drainer por job; puentea docker_service (sync) y asyncio."""

    def __init__(
        self,
        *,
        docker_service: "DockerServicePort",
        job_repo: Any,  # firma congelada data-model §5 (JobRepository)
        settings: "Settings",
        registry: dict[str, JobHandle] | None = None,
        flush_interval_s: float = FLUSH_INTERVAL_S,
        subscriber_queue_max: int = SUBSCRIBER_QUEUE_MAX,
        progress: Any | None = None,  # ProgressRepository (BL-05, §7.1)
        terminal_retention_s: float = TERMINAL_HANDLE_RETENTION_S,
    ) -> None:
        self._docker = docker_service
        self._repo = job_repo
        self._progress = progress
        self._settings = settings
        self.registry: dict[str, JobHandle] = registry if registry is not None else {}
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._flush_interval = flush_interval_s
        self._subscriber_queue_max = subscriber_queue_max
        self._sub_keys = itertools.count(1)
        self._terminal_retention_s = terminal_retention_s
        self._queue_reserved = 0  # slots reservados pre-registro (BL-08)

    # ---- API para routers ----------------------------------------------------

    def get_active(self, job_id: str) -> JobHandle | None:
        handle = self.registry.get(job_id)
        if handle is None or handle.closed:
            return None
        return handle

    def queued_count(self) -> int:
        return sum(1 for h in self.registry.values() if h.phase == "queued")

    def get_finished(self, job_id: str) -> JobHandle | None:
        """Handle terminal retenido (BL-09): su backlog conserva los seq
        originales para el replay de una reconexión (§8.2)."""
        handle = self.registry.get(job_id)
        if handle is None or not handle.closed:
            return None
        return handle

    def try_reserve_queue_slot(self, limit: int) -> bool:
        """Reserva atómica de un slot de cola (BL-08): chequeo e incremento
        son síncronos en el event loop — sin ventana TOCTOU frente a otros
        POST concurrentes. Debe liberarse SIEMPRE con release_queue_slot()."""
        if self.queued_count() + self._queue_reserved >= limit:
            return False
        self._queue_reserved += 1
        return True

    def release_queue_slot(self) -> None:
        """Libera una reserva (tras start() el handle ya cuenta como queued)."""
        self._queue_reserved = max(0, self._queue_reserved - 1)

    def start(
        self,
        *,
        job_id: str,
        source_code: str,
        threads: int,
        timeout_s: int,
        parser_id: str,
        lesson_id: str | None = None,
    ) -> JobHandle:
        """Crea handle + drainer + task (la fila ya existe en DB, 'queued')."""
        handle = JobHandle(
            job_id=job_id,
            source_code=source_code,
            threads=threads,
            timeout_s=timeout_s,
            parser_id=parser_id,
            lesson_id=lesson_id,
            max_output_bytes=self._settings.max_output_bytes,
            central_queue=asyncio.Queue(maxsize=CENTRAL_QUEUE_MAX),
        )
        self.registry[job_id] = handle
        handle.drainer = asyncio.create_task(
            self._drain(handle), name=f"telar-drainer-{job_id}"
        )
        handle.task = asyncio.create_task(self._run(handle), name=f"telar-job-{job_id}")
        return handle

    async def cancel(self, job_id: str) -> str | None:
        """§3.3/§7.5 — devuelve "cancelling" si aceptado; None si no activo.

        Idempotente: repetir un cancel ya aceptado devuelve "cancelling".
        """
        handle = self.registry.get(job_id)
        if handle is None or handle.closed:
            return None
        if handle.cancel_requested:
            return "cancelling"
        if handle.phase == "queued" and handle.execution is None:
            # cancel sobre queued: flag + cancelled en DB YA; el task lo ve
            # tras el semáforo y ANTES de containers.create (§3.3).
            handle.cancel_requested = True
            handle.request_kill(KILL_CANCEL)
            # BL-07: el estado en memoria se sincroniza ANTES de cualquier
            # await — la cola deja de contarlo y ningún WS lo ve activo.
            handle.phase = "cancelled"
            handle.terminal_detail = self._detail(
                exit_code=None, oom=False, wall_time_ms=None,
                truncated=False, error_detail=None)
            await self._finish_db(
                handle, status="cancelled", exit_code=None, oom=False,
                error_detail=None, parsed=None, finished_at=utc_now_iso(),
                wall_time_ms=None,
            )
            # El job nunca ejecutará: su drainer no tiene productores ni nada
            # que consumir. Se detiene YA en vez de dejarlo despertando cada
            # flush_interval hasta que la tarea alcance el semáforo — con la
            # cola llena de jobs largos por delante eso podían ser minutos.
            # _run lo re-invoca al despertar; _stop_drainer es idempotente.
            await self._stop_drainer(handle)
            # §3.4 pasos 2-3 para los suscriptores ya conectados: status
            # terminal + eof + cierre de colas (idempotente vía handle.closed).
            self._emit_terminal_and_close(handle)
            return "cancelling"
        # job con contenedor (o creándolo): kill_reason ANTES de kill()
        handle.cancel_requested = True
        handle.request_kill(KILL_CANCEL)
        if handle.execution is not None:
            self._spawn_kill(handle)
        return "cancelling"

    def subscribe(self, handle: JobHandle) -> tuple[int, asyncio.Queue, list[dict]]:
        """Cola por-conexión + snapshot (status actual + backlog) — §8.1."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._subscriber_queue_max)
        key = next(self._sub_keys)
        handle.subscribers[key] = queue
        snapshot: list[dict] = [
            self._status_msg(handle, handle.phase, handle.terminal_detail)
        ]
        snapshot.extend(handle.backlog)
        return key, queue, snapshot

    def unsubscribe(self, handle: JobHandle, key: int) -> None:
        handle.subscribers.pop(key, None)

    # ---- mensajes WS -----------------------------------------------------------

    def _status_msg(self, handle: JobHandle, phase: str, detail: dict | None) -> dict:
        return {"type": "status", "job_id": handle.job_id, "ts": utc_now_iso(),
                "phase": phase, "detail": detail}

    def _broadcast(self, handle: JobHandle, msg: dict) -> None:
        """Fan-out lossy: un cliente lento pierde mensajes de SU cola (§3.2)."""
        for queue in list(handle.subscribers.values()):
            _safe_put_nowait(queue, msg)

    async def _set_phase(
        self,
        handle: JobHandle,
        phase: str,
        *,
        container_id: str | None = None,
        started_at: str | None = None,
    ) -> None:
        handle.phase = phase  # síncrono ANTES del await: el canceller lo ve
        self._broadcast(handle, self._status_msg(handle, phase, None))
        await self._repo.set_phase(
            handle.job_id, phase, container_id=container_id, started_at=started_at
        )

    def _spawn_kill(self, handle: JobHandle) -> None:
        execution = handle.execution
        if execution is None:
            return

        async def _kill() -> None:
            try:
                await asyncio.to_thread(execution.kill)
            except DockerServiceError:
                pass  # ya muerto: carrera benigna

        task = asyncio.create_task(_kill())
        handle.aux_tasks.append(task)  # referencia viva (trampa GC de asyncio)

    # ---- drainer (§3.2) --------------------------------------------------------

    async def _drain(self, handle: JobHandle) -> None:
        line_buf = {"stdout": b"", "stderr": b""}
        pending: dict[str, list[str]] = {"stdout": [], "stderr": []}
        pending_bytes = {"stdout": 0, "stderr": 0}
        streams_open = 2

        def flush(stream: str) -> None:
            if not pending[stream]:
                return
            handle.seq += 1
            msg = {
                "type": "log",
                "job_id": handle.job_id,
                "ts": utc_now_iso(),
                "stream": stream,
                "lines": pending[stream],
                "seq": handle.seq,
            }
            pending[stream] = []
            pending_bytes[stream] = 0
            self._broadcast(handle, msg)
            handle.backlog.append(msg)
            handle.backlog_lines += len(msg["lines"])
            while handle.backlog_lines > BACKLOG_MAX_LINES and len(handle.backlog) > 1:
                dropped = handle.backlog.popleft()
                handle.backlog_lines -= len(dropped["lines"])

        def flush_all() -> None:
            flush("stdout")
            flush("stderr")

        async def on_log(stream: str, chunk: bytes) -> None:
            nonlocal streams_open
            if handle.output_truncated:
                return  # presupuesto agotado: se descarta el resto (§3.2)
            allowed = handle.max_output_bytes - handle.total_log_bytes
            exceeded = len(chunk) > allowed
            if exceeded:
                chunk = chunk[:allowed]
            handle.total_log_bytes += len(chunk)
            (handle.stdout_parts if stream == "stdout" else handle.stderr_parts).append(
                chunk
            )
            if stream == "stdout" and handle.phase == "compiling":
                # primer byte de stdout ⇒ running (§7.7)
                await self._set_phase(handle, "running")
            line_buf[stream] += chunk
            while b"\n" in line_buf[stream]:
                raw, line_buf[stream] = line_buf[stream].split(b"\n", 1)
                line = raw.decode("utf-8", errors="replace")
                pending[stream].append(line)
                pending_bytes[stream] += len(raw) + 1
            if pending_bytes[stream] >= FLUSH_MAX_BYTES:
                flush(stream)
            if exceeded:
                handle.output_truncated = True
                if line_buf[stream]:
                    pending[stream].append(
                        line_buf[stream].decode("utf-8", errors="replace")
                    )
                    line_buf[stream] = b""
                flush_all()
                self._broadcast(handle, {
                    "type": "error", "job_id": handle.job_id, "ts": utc_now_iso(),
                    "code": "OUTPUT_TRUNCATED",
                    "message": (f"Salida cortada a {handle.max_output_bytes} "
                                "bytes; el job será terminado."),
                })
                # kill_reason ANTES de kill() (§3.3)
                handle.request_kill(KILL_OUTPUT_LIMIT)
                self._spawn_kill(handle)

        while True:
            try:
                item = await asyncio.wait_for(
                    handle.central_queue.get(), timeout=self._flush_interval
                )
            except asyncio.TimeoutError:
                flush_all()
                continue
            if item is _FINALIZE:
                break
            kind = item[0]
            if kind == "log":
                await on_log(item[1], item[2])
            elif kind == "log_eof":
                stream = item[1]
                if line_buf[stream] and not handle.output_truncated:
                    pending[stream].append(
                        line_buf[stream].decode("utf-8", errors="replace")
                    )
                    line_buf[stream] = b""
                    flush(stream)
                streams_open -= 1
                if streams_open <= 0:
                    handle.streams_done.set()
            elif kind == "stats":
                metric = compute_metrics(item[1])
                if metric is not None:
                    handle.metrics.add(metric)
                    self._broadcast(handle, {
                        "type": "metrics", "job_id": handle.job_id,
                        "ts": utc_now_iso(), **metric,
                    })
            elif kind == "stream_error":
                self._broadcast(handle, {
                    "type": "error", "job_id": handle.job_id, "ts": utc_now_iso(),
                    "code": "STREAM_ERROR",
                    "message": "Error leyendo el stream del contenedor.",
                })
                logger.warning("job %s stream_error(%s): %s", handle.job_id, item[1], item[2])
        # finalize: flush de restos (líneas parciales incluidas)
        for stream in ("stdout", "stderr"):
            if line_buf[stream] and not handle.output_truncated:
                pending[stream].append(line_buf[stream].decode("utf-8", errors="replace"))
                line_buf[stream] = b""
        flush_all()
        handle.streams_done.set()

    async def _stop_drainer(self, handle: JobHandle) -> None:
        if handle.drainer is None or handle.drainer.done():
            return
        await handle.central_queue.put(_FINALIZE)
        try:
            await asyncio.wait_for(handle.drainer, timeout=STREAMS_EOF_GRACE_S)
        except asyncio.TimeoutError:  # pragma: no cover — defensa
            handle.drainer.cancel()

    # ---- productores (threads daemon) -------------------------------------------

    def _logs_worker(
        self,
        handle: JobHandle,
        execution: "JobExecutionPort",
        stream: str,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        """Thread sync: chunks → cola central con backpressure acotado (§3 p.3)."""
        try:
            for chunk in execution.iter_logs(stream):
                if not chunk:
                    continue
                if handle.producer_stop.is_set():
                    return
                item = ("log", stream, bytes(chunk))
                while True:
                    fut = asyncio.run_coroutine_threadsafe(
                        handle.central_queue.put(item), loop
                    )
                    try:
                        fut.result(timeout=BRIDGE_PUT_TIMEOUT_S)
                        break
                    except concurrent.futures.TimeoutError:
                        if not fut.cancel():
                            break  # el put llegó a completarse: no duplicar
                        if handle.producer_stop.is_set():
                            return  # re-chequeo del flag de fin: jamás colgado
                    except (concurrent.futures.CancelledError, RuntimeError):
                        return  # loop cerrado / drainer cancelado
        except Exception as exc:  # stream roto (contenedor eliminado, etc.)
            try:
                loop.call_soon_threadsafe(
                    _safe_put_nowait,
                    handle.central_queue,
                    ("stream_error", stream, str(exc)),
                )
            except RuntimeError:
                pass
        finally:
            try:
                loop.call_soon_threadsafe(
                    _safe_put_nowait, handle.central_queue, ("log_eof", stream)
                )
            except RuntimeError:
                pass

    def _stats_worker(
        self,
        handle: JobHandle,
        execution: "JobExecutionPort",
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        """Thread sync: muestras ~1/s, entrega lossy (perder una es aceptable)."""
        try:
            for sample in execution.iter_stats():
                if handle.producer_stop.is_set():
                    return
                loop.call_soon_threadsafe(
                    _safe_put_nowait, handle.central_queue, ("stats", sample)
                )
        except Exception:
            pass  # el stats-stream muere con el contenedor: no es un error

    # ---- ciclo de vida del job ----------------------------------------------------

    async def _run(self, handle: JobHandle) -> None:
        finished_in_db = False
        try:
            async with self._semaphore:
                # §3.3: cancel sobre queued — chequeo tras el semáforo y ANTES
                # de containers.create. Sin awaits entre chequeo y set de fase:
                # atómico respecto al canceller (mismo event loop).
                if handle.cancel_requested:
                    handle.terminal_detail = self._detail(
                        exit_code=None, oom=False, wall_time_ms=None,
                        truncated=False, error_detail=None)
                    handle.phase = "cancelled"
                    finished_in_db = True  # el canceller ya marcó cancelled
                    await self._stop_drainer(handle)
                    return
                await self._set_phase(handle, "creating")
                code_path = await asyncio.to_thread(
                    self._docker.prepare_code, handle.job_id, handle.source_code
                )
                handle.code_prepared = True
                execution = await asyncio.to_thread(
                    self._docker.run_job,
                    handle.job_id,
                    code_path,
                    handle.threads,
                    handle.timeout_s,
                )
                handle.execution = execution
                handle.started_at = utc_now_iso()
                if handle.cancel_requested:
                    # cancel llegó DURANTE create/start: vía kill (§3.3)
                    handle.request_kill(KILL_CANCEL)
                    self._spawn_kill(handle)
                await self._set_phase(
                    handle,
                    "compiling",
                    container_id=execution.container_id,
                    started_at=handle.started_at,
                )
                loop = asyncio.get_running_loop()
                for stream in ("stdout", "stderr"):
                    threading.Thread(
                        target=self._logs_worker,
                        args=(handle, execution, stream, loop),
                        daemon=True,
                        name=f"telar-logs-{stream}-{handle.job_id[:8]}",
                    ).start()
                threading.Thread(
                    target=self._stats_worker,
                    args=(handle, execution, loop),
                    daemon=True,
                    name=f"telar-stats-{handle.job_id[:8]}",
                ).start()

                exit_code = await self._wait_with_timeout(handle, execution)
                oom = False
                try:
                    oom = await asyncio.to_thread(execution.oom_killed)
                except DockerServiceError:
                    pass
                # esperar el EOF de los streams de logs (cierran con el kill/exit)
                try:
                    await asyncio.wait_for(
                        handle.streams_done.wait(), timeout=STREAMS_EOF_GRACE_S
                    )
                except asyncio.TimeoutError:  # pragma: no cover — defensa
                    handle.producer_stop.set()
                handle.producer_stop.set()
                await self._stop_drainer(handle)

                status, error_detail = self._derive_terminal(
                    handle.kill_reason, exit_code, oom
                )
                parsed = parse_output(
                    handle.parser_id,
                    handle.stdout_text(),
                    truncated=handle.output_truncated,
                )
                finished_at = utc_now_iso()
                wall_time_ms = (
                    _iso_delta_ms(handle.started_at, finished_at)
                    if handle.started_at
                    else None
                )
                # BL-05 (§7.1): «al terminar bien el job se actualiza
                # lesson_progress.last_job_id». El upsert (unidad de escritura
                # propia bajo write_lock) va ANTES del finish terminal: quien
                # observe status 'completed' por REST ya ve last_job_id. Un
                # fallo aquí jamás reclasifica un job correcto (solo logs).
                if (
                    status == "completed"
                    and handle.lesson_id
                    and self._progress is not None
                ):
                    try:
                        await self._progress.upsert(
                            handle.lesson_id, last_job_id=handle.job_id
                        )
                    except Exception:
                        logger.exception(
                            "job %s: no se pudo actualizar last_job_id de %s",
                            handle.job_id, handle.lesson_id,
                        )
                # §3.4 paso 1: finish() escribe DB (guard de terminales en repo)
                await self._finish_db(
                    handle, status=status, exit_code=exit_code, oom=oom,
                    error_detail=error_detail, parsed=parsed,
                    finished_at=finished_at, wall_time_ms=wall_time_ms,
                )
                finished_in_db = True
                handle.phase = status
                handle.terminal_detail = self._detail(
                    exit_code=exit_code, oom=oom, wall_time_ms=wall_time_ms,
                    truncated=handle.output_truncated, error_detail=error_detail)
        except Exception:
            # sandbox_error: detalle SOLO en logs del servidor (§3.3/§7.4)
            logger.exception("job %s: excepción del sandbox", handle.job_id)
            handle.producer_stop.set()
            try:
                await self._stop_drainer(handle)
            except Exception:  # pragma: no cover
                pass
            status = "cancelled" if handle.kill_reason == KILL_CANCEL else "failed"
            error_detail = None if status == "cancelled" else "sandbox_error"
            finished_at = utc_now_iso()
            wall_time_ms = (
                _iso_delta_ms(handle.started_at, finished_at)
                if handle.started_at
                else None
            )
            if not finished_in_db:
                try:
                    await self._finish_db(
                        handle, status=status, exit_code=None, oom=False,
                        error_detail=error_detail, parsed=None,
                        finished_at=finished_at, wall_time_ms=wall_time_ms,
                    )
                except Exception:  # pragma: no cover — DB caída
                    logger.exception("job %s: finish() falló", handle.job_id)
            handle.phase = status
            handle.terminal_detail = self._detail(
                exit_code=None, oom=False, wall_time_ms=wall_time_ms,
                truncated=handle.output_truncated, error_detail=error_detail)
        finally:
            handle.producer_stop.set()
            # §3.4 pasos 2-3: status terminal + eof a TODAS las colas y cierre
            self._emit_terminal_and_close(handle)
            # §3.4 paso 4: remove(force) + borrado del dir de código
            await self._cleanup_resources(handle)
            # §3.4 paso 5: RECIÉN AHORA se retira el job del registro
            # (diferido el periodo de retención — BL-09).
            self._retire_handle(handle)

    async def _wait_with_timeout(
        self, handle: JobHandle, execution: "JobExecutionPort"
    ) -> int | None:
        """Timeout duro §3 p.6: wait(timeout) → kill → wait(grace) → 137."""
        try:
            return await asyncio.to_thread(execution.wait, float(handle.timeout_s))
        except RunnerTimeout:
            handle.request_kill(KILL_TIMEOUT)  # ANTES de kill() (§3.3)
            try:
                await asyncio.to_thread(execution.kill)
            except DockerServiceError:
                pass
            try:
                return await asyncio.to_thread(execution.wait, KILL_GRACE_S)
            except DockerServiceError:
                return None

    async def _finish_db(
        self,
        handle: JobHandle,
        *,
        status: str,
        exit_code: int | None,
        oom: bool,
        error_detail: str | None,
        parsed: dict | None,
        finished_at: str,
        wall_time_ms: int | None,
    ) -> None:
        """Única escritura terminal en DB (guard de terminales en el repo)."""
        await self._repo.finish(
            handle.job_id,
            status=status,
            exit_code=exit_code,
            oom_killed=oom,
            error_detail=error_detail,
            stdout=handle.stdout_text(),
            stderr=handle.stderr_text(),
            output_truncated=handle.output_truncated,
            metrics_summary=handle.metrics.summary(),
            parsed_timings=parsed,
            finished_at=finished_at,
            wall_time_ms=wall_time_ms,
        )

    @staticmethod
    def _derive_terminal(
        kill_reason: str, exit_code: int | None, oom: bool
    ) -> tuple[str, str | None]:
        """Tabla §3.3: status/error_detail SOLO de kill_reason+exit+OOM."""
        if kill_reason == KILL_CANCEL:
            return "cancelled", None
        if kill_reason == KILL_TIMEOUT:
            return "timeout", "wall_timeout"
        if kill_reason == KILL_OUTPUT_LIMIT:
            return "failed", "output_limit_exceeded"
        if oom:
            return "failed", "oom"
        if exit_code == 0:
            return "completed", None
        if exit_code is None:
            return "failed", "sandbox_error"
        return "failed", None

    @staticmethod
    def _detail(
        *, exit_code: int | None, oom: bool, wall_time_ms: int | None,
        truncated: bool, error_detail: str | None,
    ) -> dict:
        return {"exit_code": exit_code, "oom_killed": oom,
                "wall_time_ms": wall_time_ms, "output_truncated": truncated,
                "error_detail": error_detail}

    def _emit_terminal_and_close(self, handle: JobHandle) -> None:
        if handle.closed:
            return
        detail = handle.terminal_detail or self._detail(
            exit_code=None, oom=False, wall_time_ms=None,
            truncated=False, error_detail=None)
        status_msg = self._status_msg(handle, handle.phase, detail)
        eof_msg = {
            "type": "eof", "job_id": handle.job_id, "ts": utc_now_iso(),
            "total_log_bytes": handle.total_log_bytes,
            "truncated": handle.output_truncated,
        }
        for queue in list(handle.subscribers.values()):
            for msg in (status_msg, eof_msg, _QUEUE_CLOSED):
                while True:
                    try:
                        queue.put_nowait(msg)
                        break
                    except asyncio.QueueFull:
                        try:  # abrir hueco: el cliente lento pierde lo más viejo
                            queue.get_nowait()
                        except asyncio.QueueEmpty:  # pragma: no cover
                            break
        handle.closed = True

    async def shutdown(self) -> None:
        """Cancela las tareas auxiliares vivas al apagar el proceso.

        Sin esto, un handle aún dentro de su ventana de retención deja una
        tarea `_expire()` pendiente cuando uvicorn cierra el loop y CPython
        avisa «Task was destroyed but it is pending!» en cada redespliegue.
        """
        pending = [
            task
            for handle in list(self.registry.values())
            for task in handle.aux_tasks
            if not task.done()
        ]
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    def _retire_handle(self, handle: JobHandle) -> None:
        """§3.4 paso 5, con retención (BL-09): el handle terminal sigue un
        periodo corto en el registro para servir el replay de reconexión con
        los seq originales; después se retira de verdad."""
        if self._terminal_retention_s <= 0:
            self.registry.pop(handle.job_id, None)
            return

        async def _expire() -> None:
            await asyncio.sleep(self._terminal_retention_s)
            self.registry.pop(handle.job_id, None)

        task = asyncio.create_task(
            _expire(), name=f"telar-retain-{handle.job_id}"
        )
        handle.aux_tasks.append(task)  # referencia viva (trampa GC de asyncio)

    async def _cleanup_resources(self, handle: JobHandle) -> None:
        if handle.execution is not None:
            try:
                await asyncio.to_thread(handle.execution.remove)
            except Exception:
                logger.warning("job %s: remove() falló", handle.job_id)
        if handle.code_prepared:  # aunque run_job fallara tras prepare_code
            try:
                await asyncio.to_thread(self._docker.cleanup_code, handle.job_id)
            except Exception:
                logger.warning("job %s: cleanup_code() falló", handle.job_id)


# ─────────────────────────── Reaper de arranque ─────────────────────────────


async def run_startup_reaper(docker_service: "DockerServicePort", job_repo: Any) -> dict:
    """§3 punto 8 — lo invoca el lifespan de WP1 por interfaz: elimina los
    contenedores con label ``telar.runner=true``, barre TODOS los directorios
    de código huérfanos y marca ``failed/orphaned_on_restart`` en DB."""
    containers_removed, dirs_removed = await asyncio.to_thread(
        docker_service.reap_orphans
    )
    jobs_orphaned = await job_repo.mark_orphans_failed()
    return {"containers_removed": containers_removed,
            "dirs_removed": dirs_removed, "jobs_orphaned": jobs_orphaned}
