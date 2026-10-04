"""CLI del contenido base (CU-23): ``--check`` de solo lectura, órdenes en dos
fases, reset que devuelve el estado base y ``--prune`` sin progreso huérfano."""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import pytest

from app.db import apply_schema, open_db
from app.repositories.content import ContentRepository
from app.tools.seed_content import _check, main, seed_content_into

from conftest import CONTENT_DIR


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def _seeded_file(path: Path) -> None:
    db = await open_db(str(path))
    try:
        await apply_schema(db)
        await seed_content_into(db, content_dir=CONTENT_DIR)
    finally:
        await db.close()


def _sql(path: Path, *statements: tuple[str, tuple]) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        for sql, params in statements:
            conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _rows(path: Path, sql: str, params: tuple = ()) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


@pytest.fixture
def seeded_path(tmp_path) -> Path:
    import asyncio

    path = tmp_path / "telar.db"
    asyncio.run(_seeded_file(path))
    return path


# ─────────────────────────── 23.1 · --check solo lectura ─────────────────────


def test_check_con_db_inexistente_da_error_y_no_la_crea(tmp_path, capsys):
    path = tmp_path / "no-existe.db"
    assert main(["--check", "--db", str(path)]) != 0
    assert not path.exists()
    assert "no existe" in capsys.readouterr().err


def test_check_no_modifica_la_base(seeded_path):
    before = _sha(seeded_path)
    assert main(["--check", "--db", str(seeded_path)]) == 0
    assert _sha(seeded_path) == before


def test_check_no_migra_una_base_sin_esquema(tmp_path, capsys):
    path = tmp_path / "vacia.db"
    sqlite3.connect(path).close()  # archivo SQLite válido, sin tablas
    assert main(["--check", "--db", str(path)]) != 0
    assert _rows(path, "SELECT name FROM sqlite_master") == []  # sin migrar
    assert "no se pudo comparar" in capsys.readouterr().err


def test_check_sin_db_avisa_que_no_mira_ninguna_base(capsys):
    assert main(["--check"]) == 0
    out = capsys.readouterr()
    assert "no mira ninguna base instalada" in (out.out + out.err)


def test_check_detecta_diferencias(seeded_path, capsys):
    _sql(seeded_path, ("UPDATE modules SET title = 'otro' WHERE id = 'm1'", ()))
    assert main(["--check", "--db", str(seeded_path)]) == 1
    assert "modules difieren" in capsys.readouterr().err


# ────────────────────────── 23.2 · órdenes en dos fases ──────────────────────


def test_upsert_restaura_modulos_permutados(seeded_path):
    _sql(
        seeded_path,
        ('UPDATE modules SET "order" = 9000 WHERE id = ?', ("m1",)),
        ('UPDATE modules SET "order" = 400 WHERE id = ?', ("m3",)),
        ('UPDATE modules SET "order" = 410 WHERE id = ?', ("m1",)),
    )
    assert main(["--db", str(seeded_path)]) == 0
    assert _rows(seeded_path, 'SELECT id FROM modules ORDER BY "order" LIMIT 2') == [
        ("m1",), ("m3",)
    ]


def test_upsert_restaura_lecciones_y_preguntas_permutadas(seeded_path):
    _sql(
        seeded_path,
        ('UPDATE lessons SET "order" = 100 WHERE id = ?', ("primerEjemplo",)),
        ('UPDATE lessons SET "order" = 1 WHERE id = ?', ("for",)),
        ('UPDATE lessons SET "order" = 2 WHERE id = ?', ("primerEjemplo",)),
        ('UPDATE quiz_questions SET "order" = 100 WHERE id = ?', ("spmd-q1",)),
        ('UPDATE quiz_questions SET "order" = 1 WHERE id = ?', ("spmd-q2",)),
        ('UPDATE quiz_questions SET "order" = 2 WHERE id = ?', ("spmd-q1",)),
    )
    assert main(["--db", str(seeded_path)]) == 0
    assert main(["--check", "--db", str(seeded_path)]) == 0


def test_upsert_conserva_el_extra_que_ocupaba_un_orden_base(seeded_path):
    # El admin borró m8 y creó un módulo propio en su hueco.
    _sql(
        seeded_path,
        ("DELETE FROM modules WHERE id = ?", ("m8",)),
        (
            'INSERT INTO modules (id, "order", title, description, level) '
            "VALUES ('propio', 480, 'Propio', 'd', 'básico')",
            (),
        ),
    )
    assert main(["--db", str(seeded_path)]) == 0
    orders = dict(_rows(seeded_path, 'SELECT id, "order" FROM modules'))
    assert orders["m8"] == 480
    assert "propio" in orders and orders["propio"] > 480


def test_reset_con_extra_en_hueco_base(seeded_path):
    _sql(
        seeded_path,
        ("DELETE FROM modules WHERE id = ?", ("m8",)),
        (
            'INSERT INTO modules (id, "order", title, description, level) '
            "VALUES ('propio', 480, 'Propio', 'd', 'básico')",
            (),
        ),
    )
    assert main(["--db", str(seeded_path), "--prune"]) == 0
    assert main(["--check", "--db", str(seeded_path)]) == 0


# ─────────────────────── 23.3 · el reset deja el estado base ─────────────────


def test_reset_desarchiva_y_sincroniza_el_modulo(seeded_path):
    _sql(
        seeded_path,
        ("UPDATE lessons SET archived_at = '2026-09-01T00:00:00Z' WHERE id = ?", ("for",)),
        (
            "UPDATE modules SET version = 3, origin = 'remote', checksum = 'abc', "
            "published_at = '2026-09-01T00:00:00Z' WHERE id = ?",
            ("m1",),
        ),
    )
    assert main(["--check", "--db", str(seeded_path)]) == 1
    assert main(["--db", str(seeded_path), "--prune"]) == 0
    assert _rows(seeded_path, "SELECT archived_at FROM lessons WHERE id = 'for'") == [(None,)]
    assert _rows(
        seeded_path,
        "SELECT version, origin, checksum, published_at FROM modules WHERE id = 'm1'",
    ) == [(1, "local", None, None)]
    assert main(["--check", "--db", str(seeded_path)]) == 0


def test_reset_desarchiva_aunque_otra_leccion_ocupe_su_orden(seeded_path):
    # Archivada `for` (orden 2 de m1), una lección propia tomó su hueco.
    _sql(
        seeded_path,
        ("UPDATE lessons SET archived_at = '2026-09-01T00:00:00Z' WHERE id = ?", ("for",)),
        (
            "INSERT INTO lessons (id, module_id, \"order\", title, estimated_minutes, "
            "content_markdown, pass_threshold) VALUES ('propia', 'm1', 2, 'P', 5, 'x', 0.8)",
            (),
        ),
    )
    assert main(["--db", str(seeded_path), "--prune"]) == 0
    assert main(["--check", "--db", str(seeded_path)]) == 0


def test_upsert_normal_no_desarchiva(seeded_path):
    _sql(
        seeded_path,
        ("UPDATE lessons SET archived_at = '2026-09-01T00:00:00Z' WHERE id = ?", ("for",)),
    )
    assert main(["--db", str(seeded_path)]) == 0
    assert _rows(seeded_path, "SELECT archived_at IS NOT NULL FROM lessons WHERE id = 'for'") == [(1,)]


# ─────────────────────────── --prune sin huérfanos ───────────────────────────


def test_prune_purga_el_progreso_de_las_lecciones_borradas(seeded_path):
    _sql(
        seeded_path,
        (
            "INSERT INTO lessons (id, module_id, \"order\", title, estimated_minutes, "
            "content_markdown, pass_threshold) VALUES ('propia', 'm1', 50, 'P', 5, 'x', 0.8)",
            (),
        ),
        ("INSERT INTO lesson_progress (lesson_id, viewed) VALUES ('propia', 1)", ()),
        ("INSERT INTO lesson_progress (lesson_id, viewed) VALUES ('spmd', 1)", ()),
        (
            "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total) "
            "VALUES ('a1', 'propia', '{}', 1, 1)",
            (),
        ),
        (
            "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total) "
            "VALUES ('a2', 'spmd', '{}', 1, 1)",
            (),
        ),
    )
    assert main(["--db", str(seeded_path), "--prune"]) == 0
    assert _rows(seeded_path, "SELECT lesson_id FROM lesson_progress") == [("spmd",)]
    assert _rows(seeded_path, "SELECT lesson_id FROM quiz_attempts") == [("spmd",)]


def test_seed_avisa_reiniciar_el_backend(seeded_path, capsys):
    assert main(["--db", str(seeded_path)]) == 0
    assert "reinicia el backend" in capsys.readouterr().out.lower()


@pytest.mark.asyncio
async def test_check_async_directo_sobre_base_sembrada(seeded_path):
    assert await _check(str(seeded_path), CONTENT_DIR) == []
    loaded = ContentRepository.from_fixtures(CONTENT_DIR)
    assert len(loaded.modules()) == 8


def test_check_con_base_ilegible_da_error_limpio(tmp_path, capsys):
    """Un fallo al ABRIR la base (aquí: un directorio con nombre de .db, que
    pasa por archivo inexistente; y un archivo que no es SQLite) sale como
    error de --check, no como traceback."""
    path = tmp_path / "rota.db"
    path.write_bytes(b"esto no es sqlite" * 100)
    assert main(["--check", "--db", str(path)]) == 2
    assert "error:" in capsys.readouterr().err
