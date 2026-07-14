"""Tests de db.py: PRAGMAs de open_db, schema idempotente y write_lock."""

import asyncio

import aiosqlite
import pytest

from app import db as db_module
from app.db import apply_schema, get_schema_version, open_db

pytestmark = pytest.mark.asyncio


async def test_open_db_pragmas(tmp_path):
    db = await open_db(str(tmp_path / "ehpc.db"))
    try:
        async def pragma(name):
            cur = await db.execute(f"PRAGMA {name}")
            row = await cur.fetchone()
            return row[0]

        assert (await pragma("journal_mode")) == "wal"
        assert (await pragma("busy_timeout")) == 5000
        assert (await pragma("synchronous")) == 1  # NORMAL
        assert (await pragma("foreign_keys")) == 1
        assert db.row_factory is aiosqlite.Row
    finally:
        await db.close()


async def test_schema_idempotente(tmp_path):
    db = await open_db(str(tmp_path / "ehpc.db"))
    try:
        await apply_schema(db)
        await apply_schema(db)  # segunda pasada: no falla, no duplica versión
        assert await get_schema_version(db) == 1
        cur = await db.execute("SELECT COUNT(*) FROM schema_version")
        assert (await cur.fetchone())[0] == 1
    finally:
        await db.close()


async def test_schema_crea_tablas(db):
    cur = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    names = {row[0] for row in await cur.fetchall()}
    assert {"jobs", "quiz_attempts", "lesson_progress", "schema_version"} <= names


async def test_version_cero_sin_tabla():
    db = await aiosqlite.connect(":memory:")
    try:
        assert await get_schema_version(db) == 0
    finally:
        await db.close()


async def test_migraciones_por_bloques(tmp_path):
    schema = tmp_path / "schema.sql"
    schema.write_text(
        "CREATE TABLE IF NOT EXISTS schema_version (\n"
        "    version INTEGER PRIMARY KEY,\n"
        "    applied_at TEXT NOT NULL DEFAULT (datetime('now'))\n"
        ");\n"
        "INSERT INTO schema_version (version)\n"
        "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version WHERE version = 1);\n"
        "-- migration 2\n"
        "CREATE TABLE extra (x INTEGER);\n",
        encoding="utf-8",
    )
    db = await open_db(str(tmp_path / "m.db"))
    try:
        await apply_schema(db, schema)
        assert await get_schema_version(db) == 2
        # idempotente: la migración 2 no se re-aplica (fallaría el CREATE)
        await apply_schema(db, schema)
        assert await get_schema_version(db) == 2
        cur = await db.execute("SELECT COUNT(*) FROM schema_version")
        assert (await cur.fetchone())[0] == 2
    finally:
        await db.close()


async def test_migracion_rota_hace_rollback(tmp_path):
    schema = tmp_path / "schema.sql"
    schema.write_text(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);\n"
        "INSERT INTO schema_version (version)\n"
        "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version WHERE version = 1);\n"
        "-- migration 2\n"
        "ESTO NO ES SQL;\n",
        encoding="utf-8",
    )
    db = await open_db(str(tmp_path / "rota.db"))
    try:
        with pytest.raises(Exception):
            await apply_schema(db, schema)
        assert await get_schema_version(db) == 1  # la versión 2 no quedó grabada
    finally:
        await db.close()


async def test_write_lock_es_lock_compartido():
    # regla transversal: un único asyncio.Lock expuesto como atributo de módulo
    assert isinstance(db_module.write_lock, asyncio.Lock)
    from app.repositories import jobs as jobs_module

    # los repos lo referencian VÍA el módulo (no copia por import), así que
    # todos ven siempre la misma instancia vigente
    assert jobs_module.database is db_module
