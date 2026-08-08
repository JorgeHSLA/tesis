"""Conexión SQLite (aiosqlite) del backend Telar.

Contrato: ``docs/architecture/data-model.md`` §2 (CONGELADO).

- ``open_db``: conexión única creada en el lifespan, con los 4 PRAGMAs.
- ``write_lock``: regla transversal — la conexión única comparte el estado
  transaccional entre tasks; **toda unidad de escritura** (cada ``finish()``,
  cada upsert, la secuencia quiz-attempt→progress) toma este lock y hace
  ``commit()``/``rollback()`` DENTRO de él. Las lecturas no lo toman (WAL).
  Es REENTRANTE por task: una unidad compuesta (p.ej.
  ``QuizService.submit_attempt``) puede sostener el lock y llamar a
  repositorios que lo re-adquieren sin autobloquearse; la exclusión mutua
  frente a OTROS tasks se conserva a lo largo de toda la unidad.
- ``apply_schema``: ``schema.sql`` idempotente + migraciones manuales por
  bloques ``-- migration N`` gobernadas por ``schema_version``.
"""

import asyncio
import re
from pathlib import Path
from typing import Any

import aiosqlite


class ReentrantWriteLock:
    """Lock de escritura reentrante por task (data-model §2).

    ``asyncio.Lock`` NO es reentrante: si una unidad de escritura ya sostiene
    el lock (p.ej. ``QuizService.submit_attempt``) y llama a un repositorio que
    lo re-adquiere (``QuizAttemptRepository.create`` / ``ProgressRepository
    .upsert``), la task se autobloquea para siempre (deadlock WP9-01).

    Al ser el loop cooperativo y de task única, este lock permite la re-entrada
    del MISMO task manteniendo la exclusión mutua frente a OTROS tasks: la
    unidad compuesta intento→progreso conserva el lock a lo largo de ambos
    writes (atomicidad real), a diferencia de usar un lock separado que dejaría
    interleavear a otros escritores entre los dos ``commit()``.

    Interfaz idéntica a ``asyncio.Lock`` (``async with``, ``acquire``,
    ``release``, ``locked``) para ser un reemplazo directo.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._owner: "asyncio.Task[Any] | None" = None
        self._depth = 0

    async def acquire(self) -> bool:
        task = asyncio.current_task()
        if task is not None and self._owner is task:
            self._depth += 1
            return True
        await self._lock.acquire()
        self._owner = task
        self._depth = 1
        return True

    def release(self) -> None:
        if self._owner is not asyncio.current_task():
            raise RuntimeError(
                "release de write_lock por un task que no lo posee"
            )
        self._depth -= 1
        if self._depth == 0:
            self._owner = None
            self._lock.release()

    def locked(self) -> bool:
        return self._lock.locked()

    async def __aenter__(self) -> "ReentrantWriteLock":
        await self.acquire()
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        self.release()


#: Lock transversal de escritura (data-model §2). Instancia única de proceso.
write_lock: ReentrantWriteLock = ReentrantWriteLock()

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

_MIGRATION_MARK = re.compile(r"^--\s*migration\s+(\d+)\s*$", re.MULTILINE)


async def open_db(path: str) -> aiosqlite.Connection:
    """Abre la conexión única con los PRAGMAs congelados (data-model §2)."""
    db = await aiosqlite.connect(path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")    # lectores no bloquean al escritor
    await db.execute("PRAGMA busy_timeout=5000")   # espera 5s ante lock
    await db.execute("PRAGMA synchronous=NORMAL")  # seguro con WAL
    await db.execute("PRAGMA foreign_keys=ON")     # OFF por defecto en SQLite
    await db.commit()
    return db


async def get_schema_version(db: aiosqlite.Connection) -> int:
    """Versión de esquema aplicada (0 si la tabla aún no existe)."""
    try:
        cursor = await db.execute("SELECT MAX(version) FROM schema_version")
    except aiosqlite.OperationalError:
        return 0
    row = await cursor.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _split_schema(sql: str) -> tuple[str, list[tuple[int, str]]]:
    """Separa el bloque base de los bloques ``-- migration N`` (ordenados)."""
    parts = _MIGRATION_MARK.split(sql)
    base = parts[0]
    migrations = [
        (int(parts[i]), parts[i + 1]) for i in range(1, len(parts) - 1, 2)
    ]
    return base, sorted(migrations, key=lambda item: item[0])


async def apply_schema(
    db: aiosqlite.Connection, schema_path: Path = SCHEMA_PATH
) -> None:
    """Ejecuta el schema idempotente y las migraciones pendientes.

    El bloque base es ``CREATE ... IF NOT EXISTS`` (seguro en cada arranque);
    cada bloque ``-- migration N`` se aplica solo si ``schema_version < N``.
    """
    base, migrations = _split_schema(schema_path.read_text(encoding="utf-8"))
    await db.executescript(base)
    await db.commit()

    version = await get_schema_version(db)
    for number, block in migrations:
        if number <= version:
            continue
        try:
            await db.executescript(block)
            await db.execute(
                "INSERT INTO schema_version (version) VALUES (?)", (number,)
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
