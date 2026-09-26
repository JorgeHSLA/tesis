"""Migración 6 (S6 · CU-28): el taller guiado como TIPO de lección.

Tres piezas, ninguna reconstruye tablas:

- ``lessons.kind`` ∈ {``leccion``, ``taller``} con ``ADD COLUMN ... DEFAULT
  'leccion'``. No se toca el ``CHECK`` de ``completion_rule``: en un taller esa
  regla se ignora y se guarda ``'viewed'`` (ver api-contract §12).
- ``workshop_steps(lesson_id, idx, ...)``: los pasos, que caen con su lección.
- ``workshop_step_progress(lesson_id, idx, done_at)``: las casillas «Lo hice».
  SIN FK a ``lessons``, igual que ``lesson_progress``: el avance del estudiante
  sobrevive a que la lección se archive (data-model §8.3).

Lo que se defiende, sobre una DB construida a mano (mismo patrón que
``test_migration5``): una base existente abre igual y todas sus lecciones
quedan como ``leccion``.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from test_migration5 import SEMILLA_FASE4, _partir_esquema

SCHEMA = Path(__file__).resolve().parents[1] / "app" / "schema.sql"


@pytest.fixture
def db_migrada() -> sqlite3.Connection:
    """DB en la versión 5, sembrada, y luego migrada a la 6 (el caso real)."""
    base, bloques = _partir_esquema(SCHEMA.read_text(encoding="utf-8"))
    assert [n for n, _ in bloques] == [2, 3, 4, 5, 6], "cambió el juego de migraciones"

    db = sqlite3.connect(":memory:")
    db.executescript(base)
    for numero, bloque in bloques:
        if numero < 6:
            db.executescript(bloque)
    db.executescript(SEMILLA_FASE4)
    db.execute("UPDATE examples SET lesson_id = id")
    db.commit()
    bloque_6 = next(b for n, b in bloques if n == 6)
    db.executescript(bloque_6)
    db.commit()
    db.execute("PRAGMA foreign_keys = ON")
    yield db
    db.close()


def _filas(db: sqlite3.Connection, sql: str, *args: object) -> list[tuple]:
    return db.execute(sql, args).fetchall()


def _taller(db: sqlite3.Connection, lesson_id: str = "tallerHilos") -> None:
    db.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold,completion_rule,kind)
           VALUES (?, 'm1', 3, 'Taller: tus primeros hilos', 20, '# Taller', 0.8,
                   'viewed', 'taller')""",
        (lesson_id,),
    )


# ────────────────────────── base existente: abre igual ───────────────────────


def test_las_lecciones_existentes_quedan_como_leccion(db_migrada):
    assert _filas(db_migrada, "SELECT id, kind FROM lessons ORDER BY id") == [
        ("primerEjemplo", "leccion"),
        ("sumaVectoresGPU", "leccion"),
    ]


def test_el_progreso_existente_no_se_toca(db_migrada):
    assert _filas(
        db_migrada,
        "SELECT completed, best_quiz_score FROM lesson_progress WHERE lesson_id='primerEjemplo'",
    ) == [(1, 4)]


def test_una_leccion_nueva_sin_kind_es_leccion(db_migrada):
    db_migrada.execute(
        """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
             content_markdown,pass_threshold)
           VALUES ('nueva','m1',3,'Nueva',5,'# N',0.8)"""
    )
    assert _filas(db_migrada, "SELECT kind FROM lessons WHERE id='nueva'") == [("leccion",)]


def test_kind_rechaza_valores_fuera_del_catalogo(db_migrada):
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
                 content_markdown,pass_threshold,kind)
               VALUES ('x','m1',9,'X',5,'# X',0.8,'curso')"""
        )


# ─────────────────────────────── pasos ───────────────────────────────────────


def test_un_taller_guarda_pasos_ordenados_con_ejemplo_opcional(db_migrada):
    _taller(db_migrada)
    db_migrada.executemany(
        """INSERT INTO workshop_steps (lesson_id, idx, title, body_markdown, example_id)
           VALUES ('tallerHilos', ?, ?, ?, ?)""",
        [
            (0, "Lee el código", "Abre el ejemplo.", "primerEjemplo"),
            (1, "Piensa", "¿Cuántos hilos ves?", None),
        ],
    )
    assert _filas(
        db_migrada,
        "SELECT idx, title, example_id FROM workshop_steps WHERE lesson_id='tallerHilos' ORDER BY idx",
    ) == [(0, "Lee el código", "primerEjemplo"), (1, "Piensa", None)]


def test_dos_pasos_no_pueden_compartir_posicion(db_migrada):
    _taller(db_migrada)
    db_migrada.execute(
        "INSERT INTO workshop_steps (lesson_id, idx, title, body_markdown) VALUES ('tallerHilos',0,'A','a')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            "INSERT INTO workshop_steps (lesson_id, idx, title, body_markdown) VALUES ('tallerHilos',0,'B','b')"
        )


def test_un_paso_exige_leccion_existente(db_migrada):
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            "INSERT INTO workshop_steps (lesson_id, idx, title, body_markdown) VALUES ('fantasma',0,'A','a')"
        )


def test_borrar_la_leccion_arrastra_sus_pasos(db_migrada):
    _taller(db_migrada)
    db_migrada.execute(
        "INSERT INTO workshop_steps (lesson_id, idx, title, body_markdown) VALUES ('tallerHilos',0,'A','a')"
    )
    db_migrada.execute("DELETE FROM lessons WHERE id='tallerHilos'")
    assert _filas(db_migrada, "SELECT COUNT(*) FROM workshop_steps") == [(0,)]


# ─────────────────────────────── casillas ────────────────────────────────────


def test_una_casilla_por_paso(db_migrada):
    _taller(db_migrada)
    db_migrada.execute(
        "INSERT INTO workshop_step_progress (lesson_id, idx, done_at) VALUES ('tallerHilos',0,'2026-09-26T00:00:00.000Z')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        db_migrada.execute(
            "INSERT INTO workshop_step_progress (lesson_id, idx, done_at) VALUES ('tallerHilos',0,'2026-09-26T00:00:01.000Z')"
        )


def test_las_casillas_sobreviven_a_archivar_el_taller(db_migrada):
    """Como `lesson_progress`: sin FK a `lessons`, el avance no se pierde."""
    _taller(db_migrada)
    db_migrada.execute(
        "INSERT INTO workshop_step_progress (lesson_id, idx, done_at) VALUES ('tallerHilos',0,'2026-09-26T00:00:00.000Z')"
    )
    db_migrada.execute(
        "UPDATE lessons SET archived_at='2026-09-26T00:00:00.000Z' WHERE id='tallerHilos'"
    )
    assert _filas(db_migrada, "SELECT COUNT(*) FROM workshop_step_progress") == [(1,)]


# ───────────────────────────── idempotencia ──────────────────────────────────


def test_el_bloque_base_sigue_siendo_re_ejecutable(db_migrada):
    base, _ = _partir_esquema(SCHEMA.read_text(encoding="utf-8"))
    db_migrada.executescript(base)
    assert _filas(db_migrada, "SELECT COUNT(*) FROM lessons") == [(2,)]


@pytest.mark.asyncio
async def test_apply_schema_deja_la_version_6_y_el_snapshot_trae_kind(tmp_path):
    """`apply_schema` sobre una base nueva llega a la 6, y `ContentRepository.load`
    expone `kind` y los pasos del taller."""
    import aiosqlite

    from app.db import apply_schema, get_schema_version
    from app.repositories.content import ContentRepository

    async with aiosqlite.connect(tmp_path / "t.db") as db:
        db.row_factory = aiosqlite.Row
        await apply_schema(db)
        assert await get_schema_version(db) == 6
        await db.executescript(SEMILLA_FASE4)
        await db.execute("UPDATE examples SET lesson_id = id")
        await db.execute(
            """INSERT INTO lessons (id,module_id,"order",title,estimated_minutes,
                 content_markdown,pass_threshold,completion_rule,kind)
               VALUES ('tallerHilos','m1',3,'Taller',20,'# Taller',0.8,'viewed','taller')"""
        )
        await db.executemany(
            """INSERT INTO workshop_steps (lesson_id, idx, title, body_markdown, example_id)
               VALUES ('tallerHilos', ?, ?, ?, ?)""",
            [(1, "Segundo", "b", None), (0, "Primero", "a", "primerEjemplo")],
        )
        await db.commit()
        repo = await ContentRepository.load(db)

    normal = repo.lesson("primerEjemplo")
    assert normal is not None and normal.kind == "leccion" and normal.steps == ()
    taller = repo.lesson("tallerHilos")
    assert taller is not None and taller.kind == "taller"
    assert [(s.idx, s.title, s.example_id) for s in taller.steps] == [
        (0, "Primero", "primerEjemplo"),
        (1, "Segundo", None),
    ]
