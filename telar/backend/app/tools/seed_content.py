"""Seeder idempotente del contenido de cursos (Fase 4, data-model §7).

Migra los fixtures versionados de ``backend/app/content/`` a las 4 tablas de la
migración 2 (``modules``/``lessons``/``examples``/``quiz_questions``). La fuente
es ``ContentRepository.from_fixtures`` — el MISMO objeto validado de Fase 3
(invariantes 14/60 incluidas) → byte-idéntico, cero pérdida.

Idempotente: UPSERT ``ON CONFLICT(id) DO UPDATE`` por tabla (clave = PK ``id``);
una 2ª corrida deja los mismos bytes y cero filas nuevas.

CLI::

    python -m app.tools.seed_content [--db P] [--content D] [--prune] [--check]

- ``--prune``  borra filas cuyo ``id`` ya no está en los fixtures (reset al
  baseline versionado; útil para quitar contenido añadido por el admin).
- ``--check``  no muta: verifica que el round-trip fixtures→DB→snapshot es
  idéntico a los fixtures (fidelidad de serialización). Sale ≠0 si difieren.
  Con ``--db`` explícito compara ESA DB contra los fixtures.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from app import db as db_module
from app.db import apply_schema, open_db
from app.repositories.content import ContentRepository

if TYPE_CHECKING:
    import aiosqlite

CONTENT_DIR = Path(__file__).resolve().parents[1] / "content"

#: Clave de ``app_meta`` que gobierna el auto-seed del lifespan (BL-21):
#: presente ⇒ el contenido ya se sembró alguna vez y un catálogo vacío es una
#: decisión del admin, no un primer arranque.
SEED_MARKER_KEY = "content_seeded_at"


@dataclass(frozen=True)
class SeedReport:
    """Conteos de filas escritas (insertadas + actualizadas) por tabla."""

    modules: int
    lessons: int
    examples: int
    questions: int


# ─────────────────────────────── UPSERT SQL ─────────────────────────────────

_UPSERT_MODULE = """
INSERT INTO modules (id, "order", title, description, level)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    "order"     = excluded."order",
    title       = excluded.title,
    description = excluded.description,
    level       = excluded.level
"""

_UPSERT_LESSON = """
INSERT INTO lessons
    (id, module_id, "order", title, estimated_minutes,
     content_markdown, pass_threshold, recommended_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    module_id         = excluded.module_id,
    "order"           = excluded."order",
    title             = excluded.title,
    estimated_minutes = excluded.estimated_minutes,
    content_markdown  = excluded.content_markdown,
    pass_threshold    = excluded.pass_threshold,
    recommended_json  = excluded.recommended_json
"""

_UPSERT_EXAMPLE = """
INSERT INTO examples
    (id, filename, title, difficulty, teaches, directives_json,
     threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
     self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
     requires_gpu, expected_output_note, takeaways_json, source_code)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    filename             = excluded.filename,
    title                = excluded.title,
    difficulty           = excluded.difficulty,
    teaches              = excluded.teaches,
    directives_json      = excluded.directives_json,
    threads_configurable = excluded.threads_configurable,
    fixed_threads        = excluded.fixed_threads,
    fixed_threads_note   = excluded.fixed_threads_note,
    sweeps_threads       = excluded.sweeps_threads,
    self_measures        = excluded.self_measures,
    parser_id            = excluded.parser_id,
    default_timeout_s    = excluded.default_timeout_s,
    est_run_seconds      = excluded.est_run_seconds,
    enabled              = excluded.enabled,
    requires_gpu         = excluded.requires_gpu,
    expected_output_note = excluded.expected_output_note,
    takeaways_json       = excluded.takeaways_json,
    source_code          = excluded.source_code
"""

_UPSERT_QUESTION = """
INSERT INTO quiz_questions
    (id, lesson_id, "order", text, options_json, correct_key, explanation)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    lesson_id    = excluded.lesson_id,
    "order"      = excluded."order",
    text         = excluded.text,
    options_json = excluded.options_json,
    correct_key  = excluded.correct_key,
    explanation  = excluded.explanation
"""


def _dumps(value: object) -> str:
    """JSON compacto pero legible, preservando unicode (acentos/comillas)."""
    return json.dumps(value, ensure_ascii=False)


# ─────────────────────────── marcador de seed (BL-21) ───────────────────────


async def _set_seed_marker(db: "aiosqlite.Connection") -> None:
    """UPSERT del marcador, SIN lock ni commit (pieza de una unidad mayor)."""
    await db.execute(
        "INSERT INTO app_meta (key, value) "
        "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SEED_MARKER_KEY,),
    )


async def get_seed_marker(db: "aiosqlite.Connection") -> str | None:
    """Timestamp de la última siembra, o ``None`` si nunca se sembró."""
    cursor = await db.execute(
        "SELECT value FROM app_meta WHERE key = ?", (SEED_MARKER_KEY,)
    )
    row = await cursor.fetchone()
    return None if row is None else str(row[0])


async def backfill_seed_marker(db: "aiosqlite.Connection") -> None:
    """Marca como sembrada una DB poblada ANTES de la migración 3, sin tocar
    su contenido (no pisa ediciones del admin). Unidad de escritura propia."""
    async with db_module.write_lock:
        try:
            await _set_seed_marker(db)
            await db.commit()
        except Exception:
            await db.rollback()
            raise


# ──────────────────────────────── Seeding ───────────────────────────────────


async def seed_content_into(
    db: "aiosqlite.Connection",
    *,
    content_dir: Path = CONTENT_DIR,
    prune_extra: bool = False,
) -> SeedReport:
    """Siembra/actualiza el contenido en DB desde los fixtures validados.

    Fuente = ``ContentRepository.from_fixtures(content_dir)`` (fail-fast; si
    los fixtures están rotos lanza ``ContentError`` y NO toca la DB). Todo el
    write va dentro de ``write_lock`` y una sola transacción (commit único),
    en el orden ``modules → lessons → examples → quiz_questions``.
    """
    repo = ContentRepository.from_fixtures(content_dir)
    await apply_schema(db)

    modules = repo.modules()
    lessons = repo.lessons()
    examples = repo.examples()

    async with db_module.write_lock:
        try:
            question_count = await _apply_seed_statements(
                db, repo, modules, lessons, examples, prune_extra
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise

    return SeedReport(
        modules=len(modules),
        lessons=len(lessons),
        examples=len(examples),
        questions=question_count,
    )


async def _apply_seed_statements(
    db: "aiosqlite.Connection",
    repo: ContentRepository,
    modules: list,
    lessons: list,
    examples: list,
    prune_extra: bool,
) -> int:
    """Statements de la siembra SIN lock ni commit — la unidad y su
    ``commit()``/``rollback()`` viven en ``seed_content_into``. Devuelve
    el nº de preguntas escritas."""
    for module in modules:
        await db.execute(
            _UPSERT_MODULE,
            (
                module.id,
                module.order,
                module.title,
                module.description,
                module.level,
            ),
        )

    for lesson in lessons:
        quiz = repo.quiz(lesson.id)
        pass_threshold = quiz.pass_threshold if quiz is not None else 1.0
        await db.execute(
            _UPSERT_LESSON,
            (
                lesson.id,
                lesson.module_id,
                lesson.order,
                lesson.title,
                lesson.estimated_minutes,
                lesson.content_markdown,
                pass_threshold,
                _dumps(
                    [
                        {"lesson_id": r.lesson_id, "label": r.label, "tag": r.tag}
                        for r in lesson.recommended
                    ]
                ),
            ),
        )

    for example in examples:
        await db.execute(
            _UPSERT_EXAMPLE,
            (
                example.id,
                example.filename,
                example.title,
                example.difficulty,
                example.teaches,
                _dumps(list(example.directives)),
                int(example.threads_configurable),
                example.fixed_threads,
                example.fixed_threads_note,
                int(example.sweeps_threads),
                int(example.self_measures),
                example.parser_id,
                example.default_timeout_s,
                example.est_run_seconds,
                int(example.enabled),
                int(example.requires_gpu),
                example.expected_output_note,
                _dumps(list(example.takeaways)),
                example.source_code,
            ),
        )

    question_count = 0
    for lesson in lessons:
        quiz = repo.quiz(lesson.id)
        if quiz is None:
            continue
        for question in quiz.questions:
            await db.execute(
                _UPSERT_QUESTION,
                (
                    question.id,
                    quiz.lesson_id,
                    question.order,
                    question.text,
                    _dumps(
                        [
                            {"key": o.key, "text": o.text}
                            for o in question.options
                        ]
                    ),
                    question.correct_key,
                    question.explanation,
                ),
            )
            question_count += 1

    if prune_extra:
        await _prune_extra(db, modules, lessons, repo)

    # BL-21: el marcador viaja en la MISMA transacción que la siembra —
    # o se confirma todo (contenido + marcador) o nada.
    await _set_seed_marker(db)
    return question_count


async def _prune_extra(
    db: "aiosqlite.Connection",
    modules: list,
    lessons: list,
    repo: ContentRepository,
) -> None:
    """Borra filas cuyo id no está en los fixtures (hijo → padre)."""
    module_ids = [m.id for m in modules]
    lesson_ids = [lesson.id for lesson in lessons]
    question_ids = [
        q.id
        for lesson in lessons
        if (quiz := repo.quiz(lesson.id)) is not None
        for q in quiz.questions
    ]

    async def _delete_not_in(table: str, keep: list[str]) -> None:
        placeholders = ",".join("?" for _ in keep) or "NULL"
        await db.execute(
            f"DELETE FROM {table} WHERE id NOT IN ({placeholders})", tuple(keep)
        )

    # examples y quiz_questions caen por CASCADE al borrar lessons, pero se
    # limpian explícitamente por si sobreviven a una lección aún válida.
    await _delete_not_in("quiz_questions", question_ids)
    await _delete_not_in("examples", lesson_ids)
    await _delete_not_in("lessons", lesson_ids)
    await _delete_not_in("modules", module_ids)


# ──────────────────────────────── --check ───────────────────────────────────


def _diff_snapshots(
    fixtures: ContentRepository, other: ContentRepository
) -> list[str]:
    """Diferencias campo-a-campo entre dos snapshots (records frozen → ==)."""
    diffs: list[str] = []
    if fixtures.modules() != other.modules():
        diffs.append("modules difieren")
    if fixtures.lessons() != other.lessons():
        diffs.append("lessons difieren")
    if fixtures.examples() != other.examples():
        diffs.append("examples difieren")
    ids = {lesson.id for lesson in fixtures.lessons()} | {
        lesson.id for lesson in other.lessons()
    }
    for lesson_id in sorted(ids):
        if fixtures.quiz(lesson_id) != other.quiz(lesson_id):
            diffs.append(f"quiz '{lesson_id}' difiere")
    return diffs


async def _check(db_path: str | None, content_dir: Path) -> list[str]:
    """Devuelve la lista de diferencias (vacía = idéntico)."""
    fixtures = ContentRepository.from_fixtures(content_dir)
    if db_path is None:
        # Round-trip in-memory: fixtures → DB → snapshot (fidelidad pura).
        db = await open_db(":memory:")
        try:
            await apply_schema(db)
            await seed_content_into(db, content_dir=content_dir)
            loaded = await ContentRepository.load(db)
        finally:
            await db.close()
    else:
        db = await open_db(db_path)
        try:
            await apply_schema(db)
            loaded = await ContentRepository.load(db)
        finally:
            await db.close()
    return _diff_snapshots(fixtures, loaded)


# ──────────────────────────────── CLI ───────────────────────────────────────


async def _run_seed(db_path: str, content_dir: Path, prune: bool) -> SeedReport:
    db = await open_db(db_path)
    try:
        await apply_schema(db)
        return await seed_content_into(
            db, content_dir=content_dir, prune_extra=prune
        )
    finally:
        await db.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.tools.seed_content",
        description="Siembra el contenido de cursos en SQLite desde los fixtures.",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="ruta de la DB SQLite (default: TELAR_DB_PATH de la config)",
    )
    parser.add_argument(
        "--content",
        type=Path,
        default=CONTENT_DIR,
        help=f"directorio de fixtures (default: {CONTENT_DIR})",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="borra filas cuyo id ya no está en los fixtures",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verifica fidelidad fixtures↔DB sin mutar; sale ≠0 si difieren",
    )
    args = parser.parse_args(argv)

    if args.check:
        diffs = asyncio.run(_check(args.db, args.content))
        if diffs:
            print("contenido DB ≠ fixtures:", file=sys.stderr)
            for diff in diffs:
                print(f"  - {diff}", file=sys.stderr)
            return 1
        origin = args.db or "round-trip in-memory"
        print(f"contenido OK: fixtures ≡ DB ({origin})")
        return 0

    db_path = args.db
    if db_path is None:
        from app.config import get_settings

        db_path = str(get_settings().db_path_expanded)
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    report = asyncio.run(_run_seed(db_path, args.content, args.prune))
    print(
        f"sembrado en {db_path}: {report.modules} módulos · "
        f"{report.lessons} lecciones · {report.examples} ejemplos · "
        f"{report.questions} preguntas"
        + (" (prune activado)" if args.prune else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
