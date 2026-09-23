"""Seeder idempotente del contenido de cursos (Fase 4, data-model §7).

Migra los fixtures versionados de ``backend/app/content/`` a las 4 tablas de la
migración 2 (``modules``/``lessons``/``examples``/``quiz_questions``). La fuente
es ``ContentRepository.from_fixtures`` — el MISMO objeto validado de Fase 3
(invariantes 14/60 incluidas) → byte-idéntico, cero pérdida.

Idempotente: UPSERT ``ON CONFLICT(id) DO UPDATE`` por tabla (clave = PK ``id``);
una 2ª corrida deja los mismos bytes y cero filas nuevas.

CLI::

    python -m app.tools.seed_content [--db P] [--content D] [--prune] [--check]

- ``--prune``  reset al baseline versionado: borra ANTES de los upserts las
  filas cuyo ``id`` ya no está en los fixtures (con el progreso y los intentos
  de las lecciones borradas, como ``delete_lesson``), desarchiva las lecciones
  base y devuelve a cada módulo base su ``version``/``origin`` y quita
  ``checksum``/``published_at`` (CU-23.3). Tras un reset, ``--check`` pasa.
- ``--check``  no muta: con ``--db`` abre ESA DB en solo lectura (sin migrar;
  si no existe, error) y la compara con los fixtures. Sin ``--db`` solo prueba
  el round-trip fixtures→DB en memoria y avisa que no mira ninguna base
  instalada. Sale ≠0 si difieren o si no se pudo comparar.

Los ``order`` (``modules`` UNIQUE global, lecciones vivas únicas por módulo,
preguntas únicas por lección) se fijan en dos fases (CU-23.2): primero se
estacionan arriba las filas base y las filas extra que ocupan un hueco base
(estas se conservan ahí), luego cada upsert escribe su order definitivo.

El backend en marcha tiene el contenido cargado en memoria: tras sembrar hay
que reiniciarlo (la CLI lo avisa).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import aiosqlite

from app import db as db_module
from app.db import apply_schema, open_db
from app.repositories.content import ContentRepository

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
     content_markdown, pass_threshold, recommended_json,
     enabled, completion_rule, video_url)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    module_id         = excluded.module_id,
    "order"           = excluded."order",
    title             = excluded.title,
    estimated_minutes = excluded.estimated_minutes,
    content_markdown  = excluded.content_markdown,
    pass_threshold    = excluded.pass_threshold,
    recommended_json  = excluded.recommended_json,
    enabled           = excluded.enabled,
    completion_rule   = excluded.completion_rule,
    video_url         = excluded.video_url
"""

_UPSERT_EXAMPLE = """
INSERT INTO examples
    (id, lesson_id, filename, title, difficulty, teaches, directives_json,
     threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
     self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
     requires_gpu, expected_output_note, takeaways_json, source_code)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    lesson_id            = excluded.lesson_id,
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


async def _set_seed_marker(db: aiosqlite.Connection) -> None:
    """UPSERT del marcador, SIN lock ni commit (pieza de una unidad mayor)."""
    await db.execute(
        "INSERT INTO app_meta (key, value) "
        "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SEED_MARKER_KEY,),
    )


async def get_seed_marker(db: aiosqlite.Connection) -> str | None:
    """Timestamp de la última siembra, o ``None`` si nunca se sembró."""
    cursor = await db.execute(
        "SELECT value FROM app_meta WHERE key = ?", (SEED_MARKER_KEY,)
    )
    row = await cursor.fetchone()
    return None if row is None else str(row[0])


async def backfill_seed_marker(db: aiosqlite.Connection) -> None:
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
    db: aiosqlite.Connection,
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
    db: aiosqlite.Connection,
    repo: ContentRepository,
    modules: list,
    lessons: list,
    examples: list,
    prune_extra: bool,
) -> int:
    """Statements de la siembra SIN lock ni commit — la unidad y su
    ``commit()``/``rollback()`` viven en ``seed_content_into``. Devuelve
    el nº de preguntas escritas."""
    # El reset poda PRIMERO: así los huecos que dejan las filas extra quedan
    # libres para los upserts y una lección base colgada de un módulo extra
    # (borrada en cascada con él) se vuelve a insertar abajo.
    if prune_extra:
        await _prune_extra(db, modules, lessons, examples, repo)
    await _park_orders(db, repo, modules, lessons, unarchive=prune_extra)

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
                # Migración 5: `enabled` deja de derivarse de `examples.enabled`
                # y pasa a columna propia. El seeder escribe aquí el valor que
                # el snapshot de fixtures ya calculó, para que el round-trip
                # fixtures↔DB siga siendo byte-idéntico (SEED-1).
                int(lesson.enabled),
                lesson.completion_rule,
                lesson.video_url,
            ),
        )

    for example in examples:
        await db.execute(
            _UPSERT_EXAMPLE,
            (
                example.id,
                # E1: la relación la manda esta columna, ya no la igualdad de
                # ids. En el baseline de fixtures coinciden, pero escribirla es
                # lo que hace que el ON DELETE CASCADE alcance al ejemplo.
                example.lesson_id,
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
        await _reset_module_state(db, modules)

    # BL-21: el marcador viaja en la MISMA transacción que la siembra —
    # o se confirma todo (contenido + marcador) o nada.
    await _set_seed_marker(db)
    return question_count


async def _prune_extra(
    db: aiosqlite.Connection,
    modules: list,
    lessons: list,
    examples: list,
    repo: ContentRepository,
) -> None:
    """Borra filas cuyo id no está en los fixtures (hijo → padre)."""
    module_ids = [m.id for m in modules]
    lesson_ids = [lesson.id for lesson in lessons]
    # E1: el ejemplo tiene id PROPIO desde la migración 5. Filtrar `examples`
    # por los ids de LECCIÓN solo funcionaba mientras ambos coincidían; con ids
    # desacoplados borraría todos los ejemplos del baseline.
    example_ids = [example.id for example in examples]
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

    # lesson_progress/quiz_attempts no tienen FK a lessons: sin esto un id
    # reutilizado «resucitaría» el progreso viejo (igual que delete_lesson).
    keep_lessons = ",".join("?" for _ in lesson_ids) or "NULL"
    for table in ("lesson_progress", "quiz_attempts"):
        await db.execute(
            f"DELETE FROM {table} WHERE lesson_id IN "
            f"(SELECT id FROM lessons WHERE id NOT IN ({keep_lessons}))",
            tuple(lesson_ids),
        )

    # examples y quiz_questions caen por CASCADE al borrar lessons, pero se
    # limpian explícitamente por si sobreviven a una lección aún válida.
    await _delete_not_in("quiz_questions", question_ids)
    await _delete_not_in("examples", example_ids)
    await _delete_not_in("lessons", lesson_ids)
    await _delete_not_in("modules", module_ids)


async def _reset_module_state(db: aiosqlite.Connection, modules: list) -> None:
    """Devuelve a cada módulo base los datos que ``--check`` compara (CU-23.3).

    Un módulo base publicado o actualizado desde el catálogo deja de serlo: su
    fila de ``installed_modules`` sobra y ``checksum``/``published_at`` son de
    una versión que ya no está instalada.
    """
    for module in modules:
        await db.execute(
            "UPDATE modules SET version = ?, origin = ?, checksum = NULL, "
            "published_at = NULL WHERE id = ?",
            (module.version, module.origin, module.id),
        )
        await db.execute(
            "DELETE FROM installed_modules WHERE module_id = ?", (module.id,)
        )


async def _park_orders(
    db: aiosqlite.Connection,
    repo: ContentRepository,
    modules: list,
    lessons: list,
    *,
    unarchive: bool,
) -> None:
    """Fase 1 de los órdenes (CU-23.2): deja libres los huecos base.

    Mismo patrón que ``content_admin._reorder``: se estacionan valores
    positivos por encima de cualquier order actual o final. Los upserts de
    después (fase 2) escriben ya el order definitivo sin chocar.
    """
    await _park(db, "modules", None, [(m.id, None, m.order) for m in modules])
    await _park(
        db,
        "lessons",
        "module_id",
        [(lesson.id, lesson.module_id, lesson.order) for lesson in lessons],
        unarchive=unarchive,
    )
    await _park(
        db,
        "quiz_questions",
        "lesson_id",
        [
            (q.id, quiz.lesson_id, q.order)
            for lesson in lessons
            if (quiz := repo.quiz(lesson.id)) is not None
            for q in quiz.questions
        ],
    )


async def _park(
    db: aiosqlite.Connection,
    table: str,
    scope_col: str | None,
    targets: list[tuple[str, str | None, int]],
    *,
    unarchive: bool = False,
) -> None:
    """Estaciona arriba las filas base y las extra que ocupan un hueco base.

    ``targets`` = (id, ámbito, order final) de cada fila base; el ámbito es la
    columna en la que el order es único (``None`` = único en toda la tabla).
    En ``lessons`` solo las vivas cuentan para la unicidad (índice parcial); con
    ``unarchive`` las base archivadas se desarchivan aquí mismo, ya estacionadas,
    para que no choquen al volver a la ruta. ``table``/``scope_col`` son
    literales del propio código, nunca entrada del usuario.
    """
    if not targets:
        return
    base_ids = {row_id for row_id, _, _ in targets}
    wanted = {(scope, order) for _, scope, order in targets}
    archived = "archived_at IS NOT NULL" if table == "lessons" else "0"
    cur = await db.execute(
        f'SELECT id, {scope_col or "NULL"} AS scope, "order", {archived} AS archived '
        f"FROM {table}"
    )
    rows = await cur.fetchall()
    cur = await db.execute(f'SELECT COALESCE(MAX("order"), 0) FROM {table}')
    top = max(int((await cur.fetchone())[0]), max(order for *_, order in targets))

    displaced = [
        row["id"]
        for row in rows
        if row["id"] not in base_ids
        and not row["archived"]
        and (row["scope"], row["order"]) in wanted
    ]
    parked = [
        row["id"]
        for row in rows
        if row["id"] in base_ids and (unarchive or not row["archived"])
    ]
    set_archived = ", archived_at = NULL" if unarchive and table == "lessons" else ""
    for offset, row_id in enumerate(displaced + parked, start=1):
        extra = set_archived if row_id in base_ids else ""
        await db.execute(
            f'UPDATE {table} SET "order" = ?{extra} WHERE id = ?',
            (top + offset, row_id),
        )


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


class CheckError(Exception):
    """``--check`` no pudo comparar (base inexistente, sin esquema…)."""


async def _open_readonly(db_path: str) -> aiosqlite.Connection:
    """Abre ``db_path`` en solo lectura: ni la crea, ni la migra (CU-23.1)."""
    path = Path(db_path)
    if not path.is_file():
        raise CheckError(f"la base {db_path} no existe")
    db = await aiosqlite.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    db.row_factory = aiosqlite.Row
    return db


async def _check(db_path: str | None, content_dir: Path) -> list[str]:
    """Devuelve la lista de diferencias (vacía = idéntico).

    Lanza ``CheckError`` si con ``--db`` no se puede comparar.
    """
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
        db = await _open_readonly(db_path)
        try:
            loaded = await ContentRepository.load(db)
        except Exception as exc:
            # Esquema viejo o ausente: migrar es cosa del backend, no del check.
            raise CheckError(
                f"no se pudo comparar {db_path} ({exc}); si es una base vieja, "
                "arranca el backend una vez para migrarla"
            ) from exc
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
        if args.db is None:
            print(
                "aviso: sin --db solo se prueba el round-trip fixtures→DB en "
                "memoria; no mira ninguna base instalada (usa --db RUTA).",
                file=sys.stderr,
            )
        try:
            diffs = asyncio.run(_check(args.db, args.content))
        except CheckError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
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
    print(
        "Aviso: si el backend está corriendo, reinicia el backend: hasta "
        "entonces sigue sirviendo el contenido anterior."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
