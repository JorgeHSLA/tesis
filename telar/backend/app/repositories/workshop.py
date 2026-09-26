"""Repositorio de talleres (S6 · CU-28): pasos y casillas «Lo hice».

SQL explícito y sin lógica de negocio, como ``content_admin``. Todas las
escrituras son ``*_no_commit``: las compone una unidad que ya sostiene el
``write_lock`` y cierra con un único ``commit()``/``rollback()`` (el servicio de
casillas, ``content_writer._persist`` en autoría, o el instalador/actualizador
del catálogo).

- ``workshop_steps`` cae con su lección (``ON DELETE CASCADE``).
- ``workshop_step_progress`` no tiene FK a ``lessons``, como ``lesson_progress``:
  sobrevive a un archivado y se purga a mano al borrar la lección.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    import aiosqlite


class StepRow(NamedTuple):
    """Una fila de ``workshop_steps`` sin ``lesson_id``."""

    idx: int
    title: str
    body_markdown: str
    example_id: str | None


class StepContent(NamedTuple):
    """Lo que escribe el autor de un paso; la posición la da el orden de la lista."""

    title: str
    body_markdown: str
    example_id: str | None


# ─────────────────────────────── lectura ────────────────────────────────────


async def select_steps(db: "aiosqlite.Connection", lesson_id: str) -> list[StepRow]:
    cursor = await db.execute(
        "SELECT idx, title, body_markdown, example_id FROM workshop_steps "
        "WHERE lesson_id = ? ORDER BY idx",
        (lesson_id,),
    )
    return [
        StepRow(r["idx"], r["title"], r["body_markdown"], r["example_id"])
        for r in await cursor.fetchall()
    ]


async def select_marks(db: "aiosqlite.Connection", lesson_id: str) -> set[int]:
    """Los ``idx`` marcados como «Lo hice» en este taller."""
    cursor = await db.execute(
        "SELECT idx FROM workshop_step_progress WHERE lesson_id = ?", (lesson_id,)
    )
    return {row["idx"] for row in await cursor.fetchall()}


# ─────────────────────────────── casillas ───────────────────────────────────


async def set_mark_no_commit(
    db: "aiosqlite.Connection", lesson_id: str, idx: int, done: bool
) -> None:
    """Marca o desmarca un paso. Idempotente: repetir no cambia nada.

    Marcar lo ya marcado conserva el ``done_at`` original (``INSERT OR IGNORE``).
    """
    if done:
        await db.execute(
            "INSERT OR IGNORE INTO workshop_step_progress (lesson_id, idx) "
            "VALUES (?, ?)",
            (lesson_id, idx),
        )
    else:
        await db.execute(
            "DELETE FROM workshop_step_progress WHERE lesson_id = ? AND idx = ?",
            (lesson_id, idx),
        )


async def purge_marks_no_commit(db: "aiosqlite.Connection", lesson_id: str) -> None:
    """Borra las casillas de una lección (se llama al BORRARLA, nunca al archivar)."""
    await db.execute(
        "DELETE FROM workshop_step_progress WHERE lesson_id = ?", (lesson_id,)
    )


async def remap_marks_no_commit(
    db: "aiosqlite.Connection", lesson_id: str, destino: Mapping[int, int | None]
) -> None:
    """Mueve cada casilla con su paso: ``destino[idx_viejo] = idx_nuevo | None``.

    Autoría reordena o borra pasos en la máquina del autor; sin esto la marca de
    «Paso 1» pasaría a significar el paso que quedara en su posición. ``None``
    (o un idx ausente del mapa) = el paso ya no existe y su marca se va.
    """
    cursor = await db.execute(
        "SELECT idx, done_at FROM workshop_step_progress WHERE lesson_id = ?",
        (lesson_id,),
    )
    filas = [(row["idx"], row["done_at"]) for row in await cursor.fetchall()]
    await purge_marks_no_commit(db, lesson_id)
    for idx, done_at in filas:
        nuevo = destino.get(idx)
        if nuevo is not None:
            await db.execute(
                "INSERT INTO workshop_step_progress (lesson_id, idx, done_at) "
                "VALUES (?, ?, ?)",
                (lesson_id, nuevo, done_at),
            )


# ──────────────────────────────── pasos ─────────────────────────────────────


async def replace_steps_no_commit(
    db: "aiosqlite.Connection", lesson_id: str, steps: Iterable[StepContent]
) -> None:
    """Reescribe los pasos del taller: ``idx`` = posición en ``steps``.

    Es la ÚNICA escritura de pasos: la usan la autoría (tras aplicar su cambio a
    la lista) y el catálogo (instalar/actualizar, que traen la lista entera).
    Las casillas no se tocan aquí; mover o conservar marcas es decisión del
    llamador.
    """
    await db.execute("DELETE FROM workshop_steps WHERE lesson_id = ?", (lesson_id,))
    for idx, step in enumerate(steps):
        await db.execute(
            "INSERT INTO workshop_steps (lesson_id, idx, title, body_markdown, example_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (lesson_id, idx, step.title, step.body_markdown, step.example_id),
        )


__all__ = [
    "StepRow",
    "StepContent",
    "select_steps",
    "select_marks",
    "set_mark_no_commit",
    "purge_marks_no_commit",
    "remap_marks_no_commit",
    "replace_steps_no_commit",
]
