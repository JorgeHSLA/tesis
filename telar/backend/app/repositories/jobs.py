"""JobRepository — SQL explícito, sin ORM (data-model §5, CONGELADO).

Solo SQL + mapeo: la lógica de negocio (transiciones, parseo) vive en
``services/``. Toda escritura toma ``db.write_lock`` y confirma DENTRO de él.
``finish()``/``set_phase()`` llevan guard de terminales (architecture §3.3):
0 filas afectadas ⇒ transición rechazada, nadie sobrescribe un terminal.
"""

import json

import aiosqlite

from app import db as database
from app.repositories.records import JobRecord

#: Estados terminales (api-contract §7.7): jamás se sobrescriben.
TERMINAL_STATUSES: tuple[str, ...] = ("completed", "failed", "timeout", "cancelled")

_NOT_TERMINAL = (
    "status NOT IN ('completed','failed','timeout','cancelled')"
)

_COLUMNS = (
    "id, source_kind, example_id, lesson_id, filename, source_code, threads, "
    "timeout_s, runner_image, status, container_id, error_detail, exit_code, "
    "oom_killed, stdout, stderr, output_truncated, metrics_summary, "
    "parsed_timings, created_at, started_at, finished_at, wall_time_ms"
)


def _dump_json(value: dict | None) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False)


def _load_json(value: str | None) -> dict | None:
    return None if value is None else json.loads(value)


def _row_to_record(row: aiosqlite.Row) -> JobRecord:
    return JobRecord(
        id=row["id"],
        source_kind=row["source_kind"],
        example_id=row["example_id"],
        lesson_id=row["lesson_id"],
        filename=row["filename"],
        source_code=row["source_code"],
        threads=row["threads"],
        timeout_s=row["timeout_s"],
        runner_image=row["runner_image"],
        status=row["status"],
        container_id=row["container_id"],
        error_detail=row["error_detail"],
        exit_code=row["exit_code"],
        oom_killed=bool(row["oom_killed"]),
        stdout=row["stdout"],
        stderr=row["stderr"],
        output_truncated=bool(row["output_truncated"]),
        metrics_summary=_load_json(row["metrics_summary"]),
        parsed_timings=_load_json(row["parsed_timings"]),
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        wall_time_ms=row["wall_time_ms"],
    )


class JobRepository:
    def __init__(self, db: aiosqlite.Connection) -> None:
        self._db = db

    async def create(self, job: JobRecord) -> JobRecord:
        """INSERT completo; el job nace ``queued``."""
        params = {
            "id": job.id,
            "source_kind": job.source_kind,
            "example_id": job.example_id,
            "lesson_id": job.lesson_id,
            "filename": job.filename,
            "source_code": job.source_code,
            "threads": job.threads,
            "timeout_s": job.timeout_s,
            "runner_image": job.runner_image,
            "status": job.status,
            "container_id": job.container_id,
            "error_detail": job.error_detail,
            "exit_code": job.exit_code,
            "oom_killed": int(job.oom_killed),
            "stdout": job.stdout,
            "stderr": job.stderr,
            "output_truncated": int(job.output_truncated),
            "metrics_summary": _dump_json(job.metrics_summary),
            "parsed_timings": _dump_json(job.parsed_timings),
            "created_at": job.created_at,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
            "wall_time_ms": job.wall_time_ms,
        }
        columns = ", ".join(params)
        placeholders = ", ".join(f":{name}" for name in params)
        async with database.write_lock:
            try:
                await self._db.execute(
                    f"INSERT INTO jobs ({columns}) VALUES ({placeholders})", params
                )
                await self._db.commit()
            except Exception:
                await self._db.rollback()
                raise
        created = await self.find_by_id(job.id)
        assert created is not None  # recién insertado
        return created

    async def find_by_id(self, job_id: str) -> JobRecord | None:
        cursor = await self._db.execute(
            f"SELECT {_COLUMNS} FROM jobs WHERE id = ?", (job_id,)
        )
        row = await cursor.fetchone()
        return None if row is None else _row_to_record(row)

    async def list_recent(
        self, *, limit: int = 20, offset: int = 0, status: str | None = None,
    ) -> tuple[list[JobRecord], int]:
        """ORDER BY created_at DESC; devuelve ``(página, total)`` para meta."""
        where = "" if status is None else "WHERE status = :status"
        params: dict = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        cursor = await self._db.execute(
            f"SELECT {_COLUMNS} FROM jobs {where} "
            "ORDER BY created_at DESC LIMIT :limit OFFSET :offset",
            params,
        )
        rows = await cursor.fetchall()
        count_cursor = await self._db.execute(
            f"SELECT COUNT(*) FROM jobs {where}",
            {"status": status} if status is not None else {},
        )
        total = (await count_cursor.fetchone())[0]
        return [_row_to_record(row) for row in rows], int(total)

    async def set_phase(
        self, job_id: str, status: str, *,
        container_id: str | None = None, started_at: str | None = None,
    ) -> None:
        """Transiciones no terminales (creating/compiling/running) con guard."""
        async with database.write_lock:
            try:
                await self._db.execute(
                    "UPDATE jobs SET status = :status, "
                    "container_id = COALESCE(:container_id, container_id), "
                    "started_at = COALESCE(:started_at, started_at) "
                    f"WHERE id = :id AND {_NOT_TERMINAL}",
                    {
                        "id": job_id,
                        "status": status,
                        "container_id": container_id,
                        "started_at": started_at,
                    },
                )
                await self._db.commit()
            except Exception:
                await self._db.rollback()
                raise

    async def finish(
        self, job_id: str, *, status: str, exit_code: int | None,
        oom_killed: bool, error_detail: str | None,
        stdout: str, stderr: str, output_truncated: bool,
        metrics_summary: dict | None, parsed_timings: dict | None,
        finished_at: str, wall_time_ms: int | None,
    ) -> None:
        """Única escritura del resultado (terminal); idempotente por el guard."""
        async with database.write_lock:
            try:
                await self._db.execute(
                    "UPDATE jobs SET status = :status, exit_code = :exit_code, "
                    "oom_killed = :oom_killed, error_detail = :error_detail, "
                    "stdout = :stdout, stderr = :stderr, "
                    "output_truncated = :output_truncated, "
                    "metrics_summary = :metrics_summary, "
                    "parsed_timings = :parsed_timings, "
                    "finished_at = :finished_at, wall_time_ms = :wall_time_ms "
                    f"WHERE id = :id AND {_NOT_TERMINAL}",
                    {
                        "id": job_id,
                        "status": status,
                        "exit_code": exit_code,
                        "oom_killed": int(oom_killed),
                        "error_detail": error_detail,
                        "stdout": stdout,
                        "stderr": stderr,
                        "output_truncated": int(output_truncated),
                        "metrics_summary": _dump_json(metrics_summary),
                        "parsed_timings": _dump_json(parsed_timings),
                        "finished_at": finished_at,
                        "wall_time_ms": wall_time_ms,
                    },
                )
                await self._db.commit()
            except Exception:
                await self._db.rollback()
                raise

    async def mark_orphans_failed(self) -> int:
        """Marca huérfanos tras un reinicio (lifespan, tras el reaper)."""
        async with database.write_lock:
            try:
                cursor = await self._db.execute(
                    "UPDATE jobs SET status = 'failed', "
                    "error_detail = 'orphaned_on_restart', "
                    # §2.3 #21: un terminal siempre lleva finished_at (§0).
                    "finished_at = COALESCE(finished_at, "
                    "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) "
                    "WHERE status IN ('queued','creating','compiling','running')"
                )
                await self._db.commit()
            except Exception:
                await self._db.rollback()
                raise
        return cursor.rowcount
