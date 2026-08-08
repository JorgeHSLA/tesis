"""QuizAttemptRepository — SQL explícito (data-model §5, CONGELADO).

Sin lógica de negocio: el score/passed lo calcula ``QuizService`` (WP3);
aquí solo INSERT/SELECT + mapeo. Escrituras dentro de ``db.write_lock``.
"""

import json

import aiosqlite

from app import db as database
from app.repositories.records import QuizAttemptRecord

_COLUMNS = "id, lesson_id, answers, score, total, passed, created_at"


def _row_to_record(row: aiosqlite.Row) -> QuizAttemptRecord:
    return QuizAttemptRecord(
        id=row["id"],
        lesson_id=row["lesson_id"],
        answers=json.loads(row["answers"]),
        score=row["score"],
        total=row["total"],
        passed=bool(row["passed"]),
        created_at=row["created_at"],
    )


class QuizAttemptRepository:
    def __init__(self, db: aiosqlite.Connection) -> None:
        self._db = db

    async def create_no_commit(self, attempt: QuizAttemptRecord) -> None:
        """Solo el INSERT, sin lock ni commit.

        Pieza para unidades de escritura COMPUESTAS (p.ej. la secuencia
        intento→progreso de ``QuizService.submit_attempt``) que ya sostienen
        ``write_lock`` y hacen su ÚNICO ``commit()``/``rollback()`` al final
        (data-model §2/§5). Fuera de una unidad así, usar ``create``.
        """
        params = {
            "id": attempt.id,
            "lesson_id": attempt.lesson_id,
            "answers": json.dumps(attempt.answers, ensure_ascii=False),
            "score": attempt.score,
            "total": attempt.total,
            "passed": int(attempt.passed),
            "created_at": attempt.created_at,
        }
        await self._db.execute(
            f"INSERT INTO quiz_attempts ({_COLUMNS}) VALUES "
            "(:id, :lesson_id, :answers, :score, :total, :passed, :created_at)",
            params,
        )

    async def create(self, attempt: QuizAttemptRecord) -> QuizAttemptRecord:
        async with database.write_lock:
            try:
                await self.create_no_commit(attempt)
                await self._db.commit()
            except Exception:
                await self._db.rollback()
                raise
        cursor = await self._db.execute(
            f"SELECT {_COLUMNS} FROM quiz_attempts WHERE id = ?", (attempt.id,)
        )
        row = await cursor.fetchone()
        assert row is not None  # recién insertado
        return _row_to_record(row)

    async def list_by_lesson(
        self, lesson_id: str, *, limit: int = 10, offset: int = 0,
    ) -> tuple[list[QuizAttemptRecord], int]:
        cursor = await self._db.execute(
            f"SELECT {_COLUMNS} FROM quiz_attempts WHERE lesson_id = :lesson_id "
            "ORDER BY created_at DESC LIMIT :limit OFFSET :offset",
            {"lesson_id": lesson_id, "limit": limit, "offset": offset},
        )
        rows = await cursor.fetchall()
        count_cursor = await self._db.execute(
            "SELECT COUNT(*) FROM quiz_attempts WHERE lesson_id = ?", (lesson_id,)
        )
        total = (await count_cursor.fetchone())[0]
        return [_row_to_record(row) for row in rows], int(total)

    async def best_score(self, lesson_id: str) -> int | None:
        cursor = await self._db.execute(
            "SELECT MAX(score) FROM quiz_attempts WHERE lesson_id = ?", (lesson_id,)
        )
        row = await cursor.fetchone()
        return None if row is None or row[0] is None else int(row[0])
