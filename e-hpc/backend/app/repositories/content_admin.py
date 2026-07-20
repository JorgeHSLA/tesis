"""Repositorio de ESCRITURA del contenido de cursos (Fase 4, api-contract §10).

SQL explícito, sin lógica de negocio: INSERT/UPDATE/DELETE de las 4 tablas de
contenido (``modules``/``lessons``/``examples``/``quiz_questions``) y ``SELECT``
que arman el *shape* admin (``AdminModule(s)``/``AdminLessonDetail``/
``AdminExample``/``AdminQuiz``). La validación de negocio (unicidad, orden,
markdown, coherencia threads/GPU, refs) vive en ``services/content_writer.py``;
la orquestación bajo ``write_lock`` + ``reload_content`` también.

Contratos:
- Invariante ``lesson_id == example_id`` (§10.1): al crear una lección se inserta
  su ejemplo pareado con el MISMO id en la MISMA transacción; el borrado en
  cascada (FK ``ON DELETE CASCADE``) elimina ejemplo + quiz.
- Listas cortas/opacas (``directives``/``takeaways``/``recommended``/``options``)
  ⇄ JSON TEXT con ``json.dumps(ensure_ascii=False)`` / ``json.loads`` (preserva
  orden y unicode).
- Ninguna función aquí hace ``commit()`` ni toma ``write_lock``: eso es del
  writer (una unidad de escritura por mutación).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from app.schemas import (
    AdminExample,
    AdminExampleBase,
    AdminExampleUpdate,
    AdminLessonCreate,
    AdminLessonDetail,
    AdminLessonRef,
    AdminLessonUpdate,
    AdminModule,
    AdminModuleCreate,
    AdminModuleUpdate,
    AdminQuiz,
    AdminQuizOption,
    AdminQuizQuestion,
    AdminQuizUpsert,
    AdminRecommended,
)

if TYPE_CHECKING:
    import aiosqlite

#: Umbral por defecto de la lección hasta que un ``PUT .../quiz`` lo fije. La
#: columna ``lessons.pass_threshold`` es NOT NULL CHECK (0,1]; sin quiz no se usa.
DEFAULT_PASS_THRESHOLD = 0.8


# ─────────────────────────────── serialización ──────────────────────────────


def _dumps(value: Any) -> str:
    """JSON compacto preservando unicode (acentos/comillas)."""
    return json.dumps(value, ensure_ascii=False)


def _loads_list(raw: str | None) -> list:
    """``json.loads`` tolerante para columnas JSON de lista (``[]`` si falta)."""
    if not raw:
        return []
    value = json.loads(raw)
    return value if isinstance(value, list) else []


# ───────────────────────────── consultas de apoyo ───────────────────────────


async def _scalar(db: "aiosqlite.Connection", sql: str, params: tuple) -> Any:
    cur = await db.execute(sql, params)
    row = await cur.fetchone()
    return row[0] if row is not None else None


async def module_exists(db: "aiosqlite.Connection", module_id: str) -> bool:
    return (
        await _scalar(db, "SELECT 1 FROM modules WHERE id = ?", (module_id,))
    ) is not None


async def lesson_exists(db: "aiosqlite.Connection", lesson_id: str) -> bool:
    return (
        await _scalar(db, "SELECT 1 FROM lessons WHERE id = ?", (lesson_id,))
    ) is not None


async def example_exists(db: "aiosqlite.Connection", example_id: str) -> bool:
    return (
        await _scalar(db, "SELECT 1 FROM examples WHERE id = ?", (example_id,))
    ) is not None


async def module_order_taken(
    db: "aiosqlite.Connection", order: int, *, exclude_id: str | None = None
) -> bool:
    row = await _scalar(
        db,
        'SELECT 1 FROM modules WHERE "order" = ? AND id != ?',
        (order, exclude_id or ""),
    )
    return row is not None


async def lesson_order_taken(
    db: "aiosqlite.Connection", order: int, *, exclude_id: str | None = None
) -> bool:
    row = await _scalar(
        db,
        'SELECT 1 FROM lessons WHERE "order" = ? AND id != ?',
        (order, exclude_id or ""),
    )
    return row is not None


async def count_lessons_in_module(
    db: "aiosqlite.Connection", module_id: str
) -> int:
    value = await _scalar(
        db, "SELECT COUNT(*) FROM lessons WHERE module_id = ?", (module_id,)
    )
    return int(value or 0)


async def quiz_question_count(db: "aiosqlite.Connection", lesson_id: str) -> int:
    value = await _scalar(
        db,
        "SELECT COUNT(*) FROM quiz_questions WHERE lesson_id = ?",
        (lesson_id,),
    )
    return int(value or 0)


async def lesson_pass_threshold(
    db: "aiosqlite.Connection", lesson_id: str
) -> float | None:
    """``pass_threshold`` actual de la lección (``None`` si no existe)."""
    value = await _scalar(
        db, "SELECT pass_threshold FROM lessons WHERE id = ?", (lesson_id,)
    )
    return None if value is None else float(value)


async def quiz_question_ids(
    db: "aiosqlite.Connection", lesson_id: str
) -> list[str]:
    """Ids de las preguntas ACTUALES de la lección (revalidación en vuelo)."""
    cur = await db.execute(
        "SELECT id FROM quiz_questions WHERE lesson_id = ?", (lesson_id,)
    )
    return [row["id"] for row in await cur.fetchall()]


async def question_ids_in_other_lessons(
    db: "aiosqlite.Connection", lesson_id: str, ids: list[str]
) -> list[str]:
    """Ids de pregunta de ``ids`` que YA existen bajo OTRA lección.

    ``quiz_questions.id`` es PRIMARY KEY global; sin este chequeo un id ajeno
    provocaría ``IntegrityError`` (500) en vez de un ``CONTENT_VALIDATION_ERROR``
    limpio (CW-02)."""
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    cur = await db.execute(
        f"SELECT id FROM quiz_questions "
        f"WHERE lesson_id != ? AND id IN ({placeholders})",
        (lesson_id, *ids),
    )
    return [row["id"] for row in await cur.fetchall()]


# ──────────────────────────────── módulos ───────────────────────────────────


_INSERT_MODULE = """
INSERT INTO modules (id, "order", title, description, level)
VALUES (?, ?, ?, ?, ?)
"""

_UPDATE_MODULE = """
UPDATE modules SET "order" = ?, title = ?, description = ?, level = ?
WHERE id = ?
"""


async def insert_module(
    db: "aiosqlite.Connection", body: AdminModuleCreate
) -> None:
    await db.execute(
        _INSERT_MODULE,
        (body.id, body.order, body.title, body.description, body.level),
    )


async def update_module(
    db: "aiosqlite.Connection", module_id: str, body: AdminModuleUpdate
) -> None:
    await db.execute(
        _UPDATE_MODULE,
        (body.order, body.title, body.description, body.level, module_id),
    )


async def delete_module(db: "aiosqlite.Connection", module_id: str) -> None:
    await db.execute("DELETE FROM modules WHERE id = ?", (module_id,))


# ─────────────────────────── lecciones + ejemplo ────────────────────────────


_INSERT_LESSON = """
INSERT INTO lessons
    (id, module_id, "order", title, estimated_minutes,
     content_markdown, pass_threshold, recommended_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
"""

_UPDATE_LESSON = """
UPDATE lessons SET
    module_id = ?, "order" = ?, title = ?, estimated_minutes = ?,
    content_markdown = ?, recommended_json = ?
WHERE id = ?
"""

_INSERT_EXAMPLE = """
INSERT INTO examples
    (id, filename, title, difficulty, teaches, directives_json,
     threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
     self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
     requires_gpu, expected_output_note, takeaways_json, source_code)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

_UPDATE_EXAMPLE = """
UPDATE examples SET
    filename = ?, title = ?, difficulty = ?, teaches = ?, directives_json = ?,
    threads_configurable = ?, fixed_threads = ?, fixed_threads_note = ?,
    sweeps_threads = ?, self_measures = ?, parser_id = ?, default_timeout_s = ?,
    est_run_seconds = ?, enabled = ?, requires_gpu = ?, expected_output_note = ?,
    takeaways_json = ?
WHERE id = ?
"""


def _recommended_json(recommended: list[AdminRecommended]) -> str:
    return _dumps(
        [{"lesson_id": r.lesson_id, "label": r.label, "tag": r.tag} for r in recommended]
    )


def _example_insert_params(
    example_id: str, ex: AdminExampleBase, source_code: str
) -> tuple:
    return (
        example_id,
        ex.filename,
        ex.title,
        ex.difficulty,
        ex.teaches,
        _dumps(list(ex.directives)),
        int(ex.threads_configurable),
        ex.fixed_threads,
        ex.fixed_threads_note,
        int(ex.sweeps_threads),
        int(ex.self_measures),
        ex.parser_id,
        ex.default_timeout_s,
        ex.est_run_seconds,
        int(ex.enabled),
        int(ex.requires_gpu),
        ex.expected_output_note,
        _dumps(list(ex.takeaways)),
        source_code,
    )


async def insert_lesson_with_example(
    db: "aiosqlite.Connection", body: AdminLessonCreate
) -> None:
    """Inserta la lección + su ejemplo pareado (mismo id) en la misma unidad."""
    await db.execute(
        _INSERT_LESSON,
        (
            body.id,
            body.module_id,
            body.order,
            body.title,
            body.estimated_minutes,
            body.content_markdown,
            DEFAULT_PASS_THRESHOLD,
            _recommended_json(body.recommended),
        ),
    )
    await db.execute(
        _INSERT_EXAMPLE,
        _example_insert_params(body.id, body.example, body.source_code),
    )


async def update_lesson(
    db: "aiosqlite.Connection", lesson_id: str, body: AdminLessonUpdate
) -> None:
    """Actualiza la faceta lección (metadatos + markdown); no toca el ejemplo."""
    await db.execute(
        _UPDATE_LESSON,
        (
            body.module_id,
            body.order,
            body.title,
            body.estimated_minutes,
            body.content_markdown,
            _recommended_json(body.recommended),
            lesson_id,
        ),
    )


async def delete_lesson(db: "aiosqlite.Connection", lesson_id: str) -> None:
    """Borra la lección (CASCADE → ejemplo + quiz), limpia ``recommended``
    colgantes y PURGA el estado del estudiante asociado (BL-01, §10.1).

    ``lesson_progress``/``quiz_attempts`` no tienen FK a ``lessons`` (viven en
    el schema v1); sin la purga explícita quedarían huérfanos y un id
    reutilizado resucitaría ``completed``/``best_quiz_score`` de un contenido
    que ya no existe. Misma transacción que el DELETE (commit en el writer)."""
    await _clean_dangling_recommended(db, lesson_id)
    await db.execute(
        "DELETE FROM lesson_progress WHERE lesson_id = ?", (lesson_id,)
    )
    await db.execute(
        "DELETE FROM quiz_attempts WHERE lesson_id = ?", (lesson_id,)
    )
    await db.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))


async def _clean_dangling_recommended(
    db: "aiosqlite.Connection", removed_id: str
) -> None:
    cur = await db.execute(
        "SELECT id, recommended_json FROM lessons WHERE id != ?", (removed_id,)
    )
    rows = list(await cur.fetchall())
    for row in rows:
        recommended = _loads_list(row["recommended_json"])
        kept = [
            rec
            for rec in recommended
            if not (isinstance(rec, dict) and rec.get("lesson_id") == removed_id)
        ]
        if len(kept) != len(recommended):
            await db.execute(
                "UPDATE lessons SET recommended_json = ? WHERE id = ?",
                (_dumps(kept), row["id"]),
            )


# ──────────────────────────────── ejemplos ──────────────────────────────────


async def update_example(
    db: "aiosqlite.Connection", example_id: str, body: AdminExampleUpdate
) -> None:
    """Actualiza los metadatos del ejemplo (``source_code`` va por ``set_example_code``)."""
    await db.execute(
        _UPDATE_EXAMPLE,
        (
            body.filename,
            body.title,
            body.difficulty,
            body.teaches,
            _dumps(list(body.directives)),
            int(body.threads_configurable),
            body.fixed_threads,
            body.fixed_threads_note,
            int(body.sweeps_threads),
            int(body.self_measures),
            body.parser_id,
            body.default_timeout_s,
            body.est_run_seconds,
            int(body.enabled),
            int(body.requires_gpu),
            body.expected_output_note,
            _dumps(list(body.takeaways)),
            example_id,
        ),
    )


async def set_example_code(
    db: "aiosqlite.Connection", example_id: str, *, source_code: str, filename: str
) -> None:
    await db.execute(
        "UPDATE examples SET source_code = ?, filename = ? WHERE id = ?",
        (source_code, filename, example_id),
    )


# ────────────────────────────────── quiz ────────────────────────────────────


_INSERT_QUESTION = """
INSERT INTO quiz_questions
    (id, lesson_id, "order", text, options_json, correct_key, explanation)
VALUES (?, ?, ?, ?, ?, ?, ?)
"""


async def replace_quiz(
    db: "aiosqlite.Connection", lesson_id: str, body: AdminQuizUpsert
) -> None:
    """Reemplazo total del set: fija ``pass_threshold`` en la lección, borra las
    preguntas previas e inserta las nuevas."""
    await db.execute(
        "UPDATE lessons SET pass_threshold = ? WHERE id = ?",
        (body.pass_threshold, lesson_id),
    )
    await db.execute(
        "DELETE FROM quiz_questions WHERE lesson_id = ?", (lesson_id,)
    )
    for question in body.questions:
        await db.execute(
            _INSERT_QUESTION,
            (
                question.id,
                lesson_id,
                question.order,
                question.text,
                _dumps(
                    [{"key": o.key, "text": o.text} for o in question.options]
                ),
                question.correct_key,
                question.explanation,
            ),
        )


async def delete_quiz(db: "aiosqlite.Connection", lesson_id: str) -> None:
    await db.execute(
        "DELETE FROM quiz_questions WHERE lesson_id = ?", (lesson_id,)
    )


async def reset_quiz_progress(
    db: "aiosqlite.Connection", lesson_id: str
) -> None:
    """Invalida el progreso de quiz de la lección (BL-06, §10.5).

    Se ejecuta en la MISMA transacción que el reemplazo/borrado del quiz
    cuando cambia el nº de preguntas o el ``pass_threshold`` (la decisión de
    cuándo aplica vive en el writer). ``viewed`` se conserva."""
    await db.execute(
        "UPDATE lesson_progress SET best_quiz_score = NULL, completed = 0, "
        "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') "
        "WHERE lesson_id = ?",
        (lesson_id,),
    )


# ──────────────────────────── SELECT shape admin ────────────────────────────


async def _lesson_refs(
    db: "aiosqlite.Connection", module_id: str
) -> list[AdminLessonRef]:
    cur = await db.execute(
        'SELECT l.id AS id, l."order" AS "order", l.title AS title, '
        "e.enabled AS enabled, "
        "(SELECT COUNT(*) FROM quiz_questions q WHERE q.lesson_id = l.id) AS qcount "
        "FROM lessons l LEFT JOIN examples e ON e.id = l.id "
        'WHERE l.module_id = ? ORDER BY l."order"',
        (module_id,),
    )
    rows = list(await cur.fetchall())
    return [
        AdminLessonRef(
            id=row["id"],
            order=row["order"],
            title=row["title"],
            enabled=bool(row["enabled"]),
            has_quiz=int(row["qcount"] or 0) > 0,
            quiz_question_count=int(row["qcount"] or 0),
        )
        for row in rows
    ]


def _module_from_row(row: Any, lessons: list[AdminLessonRef]) -> AdminModule:
    return AdminModule(
        id=row["id"],
        order=row["order"],
        title=row["title"],
        description=row["description"],
        level=row["level"],
        lessons=lessons,
    )


async def select_admin_modules(
    db: "aiosqlite.Connection",
) -> list[AdminModule]:
    cur = await db.execute('SELECT * FROM modules ORDER BY "order"')
    rows = list(await cur.fetchall())
    modules: list[AdminModule] = []
    for row in rows:
        lessons = await _lesson_refs(db, row["id"])
        modules.append(_module_from_row(row, lessons))
    return modules


async def select_admin_module(
    db: "aiosqlite.Connection", module_id: str
) -> AdminModule | None:
    cur = await db.execute("SELECT * FROM modules WHERE id = ?", (module_id,))
    row = await cur.fetchone()
    if row is None:
        return None
    lessons = await _lesson_refs(db, module_id)
    return _module_from_row(row, lessons)


async def select_admin_example(
    db: "aiosqlite.Connection", example_id: str
) -> AdminExample | None:
    cur = await db.execute(
        'SELECT e.*, l.module_id AS module_id, l."order" AS lesson_order '
        "FROM examples e JOIN lessons l ON l.id = e.id WHERE e.id = ?",
        (example_id,),
    )
    row = await cur.fetchone()
    if row is None:
        return None
    return AdminExample(
        id=example_id,
        module_id=row["module_id"],
        order=row["lesson_order"],
        source_code=row["source_code"],
        title=row["title"],
        filename=row["filename"],
        difficulty=row["difficulty"],
        teaches=row["teaches"],
        directives=list(_loads_list(row["directives_json"])),
        threads_configurable=bool(row["threads_configurable"]),
        fixed_threads=row["fixed_threads"],
        fixed_threads_note=row["fixed_threads_note"],
        sweeps_threads=bool(row["sweeps_threads"]),
        self_measures=bool(row["self_measures"]),
        parser_id=row["parser_id"],
        default_timeout_s=row["default_timeout_s"],
        est_run_seconds=row["est_run_seconds"],
        enabled=bool(row["enabled"]),
        requires_gpu=bool(row["requires_gpu"]),
        expected_output_note=row["expected_output_note"],
        takeaways=list(_loads_list(row["takeaways_json"])),
    )


async def _adjacent_lesson_ids(
    db: "aiosqlite.Connection", order: int
) -> tuple[str | None, str | None]:
    prev_id = await _scalar(
        db,
        'SELECT id FROM lessons WHERE "order" < ? ORDER BY "order" DESC LIMIT 1',
        (order,),
    )
    next_id = await _scalar(
        db,
        'SELECT id FROM lessons WHERE "order" > ? ORDER BY "order" ASC LIMIT 1',
        (order,),
    )
    return prev_id, next_id


async def select_admin_lesson_detail(
    db: "aiosqlite.Connection", lesson_id: str
) -> AdminLessonDetail | None:
    cur = await db.execute(
        "SELECT id, module_id, \"order\", title, estimated_minutes, "
        "content_markdown, recommended_json FROM lessons WHERE id = ?",
        (lesson_id,),
    )
    row = await cur.fetchone()
    if row is None:
        return None
    example = await select_admin_example(db, lesson_id)
    if example is None:
        # No debería ocurrir (invariante 1:1) — el grafo estaría roto.
        return None
    qcount = await quiz_question_count(db, lesson_id)
    prev_id, next_id = await _adjacent_lesson_ids(db, row["order"])
    recommended = [
        AdminRecommended(
            lesson_id=rec["lesson_id"], label=rec["label"], tag=rec["tag"]
        )
        for rec in _loads_list(row["recommended_json"])
        if isinstance(rec, dict)
    ]
    return AdminLessonDetail(
        id=row["id"],
        module_id=row["module_id"],
        order=row["order"],
        title=row["title"],
        estimated_minutes=row["estimated_minutes"],
        content_markdown=row["content_markdown"],
        recommended=recommended,
        enabled=example.enabled,
        has_quiz=qcount > 0,
        quiz_question_count=qcount,
        prev_lesson_id=prev_id,
        next_lesson_id=next_id,
        example=example,
    )


async def select_admin_quiz(
    db: "aiosqlite.Connection", lesson_id: str
) -> AdminQuiz | None:
    """Quiz admin (CON ``correct_key``/``explanation``). ``None`` si la lección
    no tiene ninguna pregunta (el caller distingue LESSON_NOT_FOUND)."""
    threshold = await _scalar(
        db, "SELECT pass_threshold FROM lessons WHERE id = ?", (lesson_id,)
    )
    if threshold is None:
        return None  # la lección no existe
    cur = await db.execute(
        'SELECT id, "order", text, options_json, correct_key, explanation '
        'FROM quiz_questions WHERE lesson_id = ? ORDER BY "order"',
        (lesson_id,),
    )
    rows = list(await cur.fetchall())
    if not rows:
        return None  # lección sin quiz
    questions = [
        AdminQuizQuestion(
            id=row["id"],
            order=row["order"],
            text=row["text"],
            options=[
                AdminQuizOption(key=o["key"], text=o["text"])
                for o in _loads_list(row["options_json"])
            ],
            correct_key=row["correct_key"],
            explanation=row["explanation"],
        )
        for row in rows
    ]
    return AdminQuiz(
        lesson_id=lesson_id,
        question_count=len(questions),
        pass_threshold=threshold,
        questions=questions,
    )
