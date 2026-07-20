"""ProgressRepository — upsert SQLite (data-model §5, CONGELADO).

``upsert`` con semántica "None = no tocar"; ``best_quiz_score`` solo si
mejora (MAX en SQL); ``updated_at`` siempre se refresca. Escritura dentro de
``db.write_lock``.
"""

import aiosqlite

from app import db as database
from app.repositories.records import LessonProgressRecord

_COLUMNS = "lesson_id, viewed, completed, best_quiz_score, last_job_id, updated_at"

_UPSERT_SQL = """
INSERT INTO lesson_progress (lesson_id, viewed, completed, best_quiz_score, last_job_id)
VALUES (:lesson_id,
        COALESCE(:viewed, 0),
        COALESCE(:completed, 0),
        :best_quiz_score,
        :last_job_id)
ON CONFLICT(lesson_id) DO UPDATE SET
    viewed          = COALESCE(:viewed, viewed),
    completed       = COALESCE(:completed, completed),
    best_quiz_score = CASE
                          WHEN :best_quiz_score IS NULL THEN best_quiz_score
                          WHEN best_quiz_score IS NULL THEN :best_quiz_score
                          ELSE MAX(best_quiz_score, :best_quiz_score)
                      END,
    last_job_id     = COALESCE(:last_job_id, last_job_id),
    updated_at      = strftime('%Y-%m-%dT%H:%M:%fZ','now')
"""


def _row_to_record(row: aiosqlite.Row) -> LessonProgressRecord:
    return LessonProgressRecord(
        lesson_id=row["lesson_id"],
        viewed=bool(row["viewed"]),
        completed=bool(row["completed"]),
        best_quiz_score=row["best_quiz_score"],
        last_job_id=row["last_job_id"],
        updated_at=row["updated_at"],
    )


class ProgressRepository:
    def __init__(self, db: aiosqlite.Connection) -> None:
        self._db = db

    async def get(self, lesson_id: str) -> LessonProgressRecord | None:
        cursor = await self._db.execute(
            f"SELECT {_COLUMNS} FROM lesson_progress WHERE lesson_id = ?",
            (lesson_id,),
        )
        row = await cursor.fetchone()
        return None if row is None else _row_to_record(row)

    async def get_all(self) -> list[LessonProgressRecord]:
        cursor = await self._db.execute(
            f"SELECT {_COLUMNS} FROM lesson_progress ORDER BY lesson_id"
        )
        rows = await cursor.fetchall()
        return [_row_to_record(row) for row in rows]

    async def upsert_no_commit(
        self, lesson_id: str, *,
        viewed: bool | None = None,          # None = no tocar
        completed: bool | None = None,
        best_quiz_score: int | None = None,  # solo si mejora (MAX en SQL)
        last_job_id: str | None = None,
    ) -> None:
        """Solo el UPSERT, sin lock ni commit.

        Pieza para unidades de escritura COMPUESTAS (p.ej. intento→progreso
        de ``QuizService.submit_attempt``) que ya sostienen ``write_lock`` y
        hacen su ÚNICO ``commit()``/``rollback()`` al final (data-model
        §2/§5). Fuera de una unidad así, usar ``upsert``.
        """
        params = {
            "lesson_id": lesson_id,
            "viewed": None if viewed is None else int(viewed),
            "completed": None if completed is None else int(completed),
            "best_quiz_score": best_quiz_score,
            "last_job_id": last_job_id,
        }
        await self._db.execute(_UPSERT_SQL, params)

    async def upsert(
        self, lesson_id: str, *,
        viewed: bool | None = None,          # None = no tocar
        completed: bool | None = None,
        best_quiz_score: int | None = None,  # solo si mejora (MAX en SQL)
        last_job_id: str | None = None,
    ) -> LessonProgressRecord:
        async with database.write_lock:
            try:
                await self.upsert_no_commit(
                    lesson_id,
                    viewed=viewed,
                    completed=completed,
                    best_quiz_score=best_quiz_score,
                    last_job_id=last_job_id,
                )
                await self._db.commit()
            except Exception:
                await self._db.rollback()
                raise
        record = await self.get(lesson_id)
        assert record is not None  # recién upserteado
        return record
