"""Seeder de contenido (Fase 4, design §3): no-pérdida + idempotencia +
backward-compat de los GET públicos.

Garantía central (``test_seed_no_data_loss``): sembrar los fixtures en SQLite y
reconstruir el snapshot con ``ContentRepository.load`` produce un objeto
byte-idéntico al de ``ContentRepository.from_fixtures`` (records ``frozen`` →
``==`` compara todo, incl. ``source_code``, ``content_markdown``, ``takeaways``,
``recommended``, ``options`` y ``prev/next``).
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from app.repositories.content import ContentRepository
from app.tools.seed_content import (
    SeedReport,
    _diff_snapshots,
    seed_content_into,
)

from conftest import CONTENT_DIR


@pytest.fixture(scope="module")
def fixtures_repo() -> ContentRepository:
    return ContentRepository.from_fixtures(CONTENT_DIR)


@pytest_asyncio.fixture
async def seeded(db) -> ContentRepository:
    """DB in-memory sembrada desde fixtures → snapshot reconstruido de DB."""
    await seed_content_into(db, content_dir=CONTENT_DIR)
    return await ContentRepository.load(db)


# ───────────────────────────── no-pérdida ────────────────────────────────────


@pytest.mark.asyncio
async def test_seed_report_conteos(db):
    report = await seed_content_into(db, content_dir=CONTENT_DIR)
    assert isinstance(report, SeedReport)
    assert report.modules == 8
    assert report.lessons == 17
    assert report.examples == 17
    assert report.questions == 80  # 75 habilitadas + 5 de la lección GPU


@pytest.mark.asyncio
async def test_seed_no_data_loss(seeded, fixtures_repo):
    # Snapshot DB idéntico al de fixtures, campo-a-campo (frozen → ==).
    assert _diff_snapshots(fixtures_repo, seeded) == []
    assert seeded.modules() == fixtures_repo.modules()
    assert seeded.lessons() == fixtures_repo.lessons()
    assert seeded.examples() == fixtures_repo.examples()
    for lesson in fixtures_repo.lessons():
        assert seeded.quiz(lesson.id) == fixtures_repo.quiz(lesson.id)


@pytest.mark.asyncio
async def test_seed_conteos_snapshot(seeded):
    assert len(seeded.modules()) == 8
    assert len(seeded.lessons()) == 17
    assert len(seeded.examples()) == 17
    enabled_questions = sum(
        len(seeded.quiz(lesson.id).questions)
        for lesson in seeded.lessons()
        if lesson.enabled
    )
    assert enabled_questions == 75


@pytest.mark.asyncio
async def test_seed_preserva_unicode_y_source_code(seeded, fixtures_repo):
    # source_code TEXT sin transformación; unicode en takeaways/options.
    spmd_ex = seeded.example("spmd")
    assert spmd_ex.source_code == fixtures_repo.example("spmd").source_code
    assert spmd_ex.takeaways == fixtures_repo.example("spmd").takeaways
    spmd_quiz = seeded.quiz("spmd")
    assert spmd_quiz.questions == fixtures_repo.quiz("spmd").questions


# ───────────────────────────── idempotencia ──────────────────────────────────


@pytest.mark.asyncio
async def test_seed_idempotente(db, fixtures_repo):
    first = await seed_content_into(db, content_dir=CONTENT_DIR)
    snapshot_1 = await ContentRepository.load(db)
    second = await seed_content_into(db, content_dir=CONTENT_DIR)
    snapshot_2 = await ContentRepository.load(db)

    assert first == second  # mismos conteos
    # Sin filas nuevas: los conteos de tabla no cambian.
    for table, expected in (
        ("modules", 8),
        ("lessons", 17),
        ("examples", 17),
        ("quiz_questions", 80),
    ):
        cur = await db.execute(f"SELECT COUNT(*) FROM {table}")
        assert (await cur.fetchone())[0] == expected

    assert snapshot_1.modules() == snapshot_2.modules() == fixtures_repo.modules()
    assert snapshot_1.lessons() == snapshot_2.lessons() == fixtures_repo.lessons()
    assert snapshot_1.examples() == snapshot_2.examples() == fixtures_repo.examples()


# ──────────────────────── backward-compat GET públicos ───────────────────────


def _ok(response):
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    return body["data"]


def test_get_modules_shape_identico(client, real_content):
    data = _ok(client.get("/api/v1/modules"))
    got_ids = [m["id"] for m in data["modules"]]
    assert got_ids == [m.id for m in real_content.modules()]
    assert data["summary"]["lessons_total"] == 17
    assert data["summary"]["lessons_enabled"] == 16
    assert data["summary"]["questions_enabled_total"] == 75
    # lecciones del primer módulo en orden global
    first = data["modules"][0]
    assert [lesson["id"] for lesson in first["lessons"]] == list(
        real_content.modules()[0].lesson_ids
    )


def test_get_example_golden_primer_ejemplo(client, real_content):
    data = _ok(client.get("/api/v1/examples/primerEjemplo"))
    example = real_content.example("primerEjemplo")
    assert data["source_code"] == example.source_code
    assert data["filename"] == example.filename
    assert data["title"] == example.title
    assert data["parser_id"] == example.parser_id
    assert data["default_timeout_s"] == example.default_timeout_s


def test_get_lesson_golden_spmd(client, real_content):
    data = _ok(client.get("/api/v1/lessons/spmd"))
    lesson = real_content.lesson("spmd")
    assert data["id"] == "spmd"
    assert data["content_markdown"] == lesson.content_markdown
    assert data["prev_lesson_id"] == lesson.prev_lesson_id
    assert data["next_lesson_id"] == lesson.next_lesson_id
    got_rec = [(r["lesson_id"], r["label"], r["tag"]) for r in data["recommended"]]
    assert got_rec == [(r.lesson_id, r.label, r.tag) for r in lesson.recommended]


def test_get_quiz_publico_omite_correct_key(client, real_content):
    data = _ok(client.get("/api/v1/lessons/spmd/quiz"))
    quiz = real_content.quiz("spmd")
    assert len(data["questions"]) == len(quiz.questions)
    for question in data["questions"]:
        assert "correct_key" not in question
        assert "explanation" not in question
        for option in question["options"]:
            assert set(option) == {"key", "text"}


async def test_seed_fallido_hace_rollback_completo(db, monkeypatch):
    """Un fallo a mitad de la siembra revierte la unidad ENTERA (ninguna
    tabla parcialmente poblada, conexión sana para la siguiente siembra)."""
    import pytest

    from app import db as db_module
    from app.tools import seed_content as sc

    async def boom(_db):
        raise RuntimeError("boom en la siembra")

    monkeypatch.setattr(sc, "_set_seed_marker", boom)
    with pytest.raises(RuntimeError, match="boom"):
        await sc.seed_content_into(db)

    for table in ("modules", "lessons", "examples", "quiz_questions"):
        cur = await db.execute(f"SELECT COUNT(*) FROM {table}")
        assert (await cur.fetchone())[0] == 0, table
    assert db_module.write_lock.locked() is False

    monkeypatch.undo()
    report = await sc.seed_content_into(db)  # la conexión no quedó envenenada
    assert report.lessons == 17
