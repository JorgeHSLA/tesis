"""ContentRepository — snapshot inmutable del contenido de cursos.

Origen del snapshot (Fase 4):

- ``from_fixtures(content_dir)``: carga + validación **fail-fast** de los
  fixtures de ``backend/app/content/`` (invariantes ``data-model.md`` §4.4,
  incluidas 14 lecciones / 60 preguntas habilitadas). La usan el *seeder*
  (``app.tools.seed_content``) y los tests de baseline.
- ``load(db)``: reconstruye el **mismo** snapshot inmutable leyendo las 4
  tablas de la migración 2 (``modules``/``lessons``/``examples``/
  ``quiz_questions``). Es la fuente de runtime de Fase 4. La validación aquí
  se limita a la integridad estructural; los conteos 14/60 dejan de exigirse
  (contenido mutable — pasan a validación al escribir).

La interfaz de **lectura** (``data-model.md`` §5) queda byte-idéntica en firma
y semántica: síncrona, en memoria, sobre records inmutables (``frozen`` +
tuplas), de modo que ``load(db) == from_fixtures(dir)`` campo-a-campo cuando la
DB fue sembrada desde esos mismos fixtures.

COMPAT: ``ContentRepository(CONTENT_DIR)`` (constructor por ``content_dir``)
sigue funcionando como en Fase 3, delegando a ``from_fixtures`` — no rompe
``main.py`` (``_load_content``) ni el validador CLI ni los tests de baseline.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

if TYPE_CHECKING:
    import aiosqlite

#: Invariantes §4.4 — 17 ejemplos = 17 lecciones = 17 quizzes.
EXPECTED_LESSON_COUNT = 17
#: Invariantes §4.4 — 75 preguntas habilitadas (80 − 5 de GPU).
EXPECTED_ENABLED_QUESTIONS = 75

ParserId = Literal[
    "none",
    "sweep_pi",
    "sweep_transporte",
    "pair_openmp_numpy",
    "pair_openmp_blas",
    "pair_parallel_serial",
]

#: Los 6 parser_id válidos, como set para validación estructural en ``load``.
PARSER_ID_VALUES = frozenset(
    (
        "none",
        "sweep_pi",
        "sweep_transporte",
        "pair_openmp_numpy",
        "pair_openmp_blas",
        "pair_parallel_serial",
    )
)

OptionKey = Literal["a", "b", "c", "d"]


class ContentError(Exception):
    """Contenido inválido — la app no debe arrancar (o el reload se descarta)."""


# ─────────────────── Modelos pydantic de los fixtures (§4.2/§4.3) ───────────


class _RecommendedFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    lesson_id: str
    label: str
    tag: str


class _ModuleFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    order: int
    title: str
    description: str
    level: str
    lessons: list[str]


class _ExampleFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    filename: str
    title: str
    difficulty: int = Field(ge=1, le=5)
    teaches: str
    directives: list[str]
    threads_configurable: bool
    fixed_threads: int | None = None
    fixed_threads_note: str | None = None
    sweeps_threads: bool
    self_measures: bool
    parser_id: ParserId
    default_timeout_s: int = Field(ge=5)
    est_run_seconds: int = Field(ge=1)
    enabled: bool
    requires_gpu: bool
    expected_output_note: str
    takeaways: list[str] = Field(min_length=1)


class _LessonFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    module_id: str
    order: int
    title: str
    estimated_minutes: int = Field(ge=1)
    content_file: str
    recommended: list[_RecommendedFx] = Field(default_factory=list)


class _CatalogFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    modules: list[_ModuleFx]
    examples: dict[str, _ExampleFx]
    lessons: dict[str, _LessonFx]


class _QuizOptionFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: OptionKey
    text: str


class _QuizQuestionFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    order: int
    text: str
    options: list[_QuizOptionFx] = Field(min_length=2)
    correct_key: OptionKey
    explanation: str


class _QuizFx(BaseModel):
    model_config = ConfigDict(frozen=True)

    lesson_id: str
    pass_threshold: float = Field(gt=0.0, le=1.0)
    questions: list[_QuizQuestionFx] = Field(min_length=1)


# ───────────────────────── Records de dominio (inmutables) ──────────────────


@dataclass(frozen=True)
class Recommended:
    lesson_id: str
    label: str
    tag: str


@dataclass(frozen=True)
class Module:
    id: str
    order: int
    title: str
    description: str
    level: str
    lesson_ids: tuple[str, ...]
    #: Versión publicable del módulo (entero monótono). Los módulos del baseline
    #: viven en la 1 mientras nadie los publique.
    version: int = 1
    #: ``local`` = sembrado desde fixtures o creado por el admin aquí;
    #: ``remote`` = incorporado desde el catálogo del bucket.
    origin: str = "local"


@dataclass(frozen=True)
class Example:
    id: str
    title: str
    module_id: str
    order: int
    filename: str
    difficulty: int
    teaches: str
    directives: tuple[str, ...]
    threads_configurable: bool
    fixed_threads: int | None
    fixed_threads_note: str | None
    sweeps_threads: bool
    self_measures: bool
    parser_id: str
    default_timeout_s: int
    est_run_seconds: int
    enabled: bool
    requires_gpu: bool
    #: E1: a qué lección pertenece, o ``None`` si el ejemplo está suelto. Ya no
    #: coincide necesariamente con ``id``.
    lesson_id: str | None
    expected_output_note: str
    takeaways: tuple[str, ...]
    source_code: str


@dataclass(frozen=True)
class WorkshopStep:
    """S6 · CU-28: un paso de un taller (``workshop_steps``).

    ``idx`` es la posición 0..n-1. ``example_id`` es opcional: con él el paso
    ofrece «Abrir en el simulador»; sin él es solo lectura y acción.
    """

    idx: int
    title: str
    body_markdown: str
    example_id: str | None


#: S6 · CU-28: los dos tipos de lección (``lessons.kind``).
KIND_LECCION = "leccion"
KIND_TALLER = "taller"


@dataclass(frozen=True)
class Lesson:
    id: str
    module_id: str
    order: int
    title: str
    estimated_minutes: int
    content_markdown: str
    #: E1 (migración 5): ``None`` cuando la lección es conceptual y no trae
    #: código. Todo consumidor debe tratarlo: sin ejemplo NO hay affordance de
    #: ejecución, que no es lo mismo que un botón deshabilitado.
    example_id: str | None
    has_quiz: bool
    quiz_question_count: int
    #: E4: columna propia de la lección. Antes se derivaba de
    #: ``examples.enabled``, y con esa derivación una lección sin ejemplo caería
    #: a deshabilitada EN SILENCIO — desaparecería de ``lessons_enabled`` y del
    #: cómputo de módulo completado sin que nada fallara.
    enabled: bool
    #: E4: qué cuenta como completar la lección (``quiz`` | ``viewed`` | ``run``).
    completion_rule: str
    #: URL de YouTube no listado de ESTA lección, ya normalizada. ``None`` = sin
    #: video: el reproductor no se monta, no hay marco vacío.
    video_url: str | None
    #: Lección retirada en una versión posterior de su módulo: sigue siendo
    #: legible y conserva su progreso, pero queda fuera de la ruta lineal.
    archived: bool
    recommended: tuple[Recommended, ...]
    prev_lesson_id: str | None
    next_lesson_id: str | None
    #: S6 · CU-28: ``leccion`` | ``taller``. En un taller la ``completion_rule``
    #: se ignora (se guarda ``viewed``): lo completan sus pasos.
    kind: str = KIND_LECCION
    #: Pasos del taller en orden de ``idx``. Vacío en una lección normal.
    steps: tuple[WorkshopStep, ...] = ()

    @property
    def is_taller(self) -> bool:
        return self.kind == KIND_TALLER


#: La misma regla que ``cuenta_para_progreso``, para las consultas que la
#: evalúan contra la DB (no contra el snapshot). Mantener ambas juntas.
SQL_CUENTA_PARA_PROGRESO = "enabled = 1 AND archived_at IS NULL"


def cuenta_para_progreso(lesson: Lesson) -> bool:
    """La ÚNICA regla de disponibilidad: habilitada y no archivada.

    Lo que no cuenta no entra en los denominadores de ``/modules`` ni en los de
    ``/progress``, y ni el quiz ni un job pueden completarlo.
    """
    return lesson.enabled and not lesson.archived


@dataclass(frozen=True)
class QuizOption:
    key: str
    text: str


@dataclass(frozen=True)
class QuizQuestion:
    id: str
    order: int
    text: str
    options: tuple[QuizOption, ...]
    correct_key: str
    explanation: str


@dataclass(frozen=True)
class Quiz:
    lesson_id: str
    pass_threshold: float
    questions: tuple[QuizQuestion, ...]


# ───────────────────────── Lectura de fixtures (§4.x) ────────────────────────


def _read_utf8(path: Path, what: str) -> str:
    """Lee un archivo obligatorio como UTF-8 o lanza ContentError.

    Usa ``read_bytes().decode`` (no ``read_text``) para NO aplicar traducción
    universal de saltos de línea (CRLF→LF): preserva los bytes exactos del
    fixture y sostiene la garantía de byte-identidad del seeder (SEED-1)."""
    if not path.is_file():
        raise ContentError(f"{what}: falta el archivo {path}")
    try:
        return path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContentError(f"{what}: {path} no es UTF-8 válido ({exc})") from exc


def _load_catalog(content_dir: Path) -> _CatalogFx:
    raw = _read_utf8(content_dir / "catalog.json", "catalog.json")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContentError(f"catalog.json: JSON inválido ({exc})") from exc
    try:
        return _CatalogFx.model_validate(payload)
    except ValidationError as exc:
        raise ContentError(f"catalog.json: esquema inválido:\n{exc}") from exc


def _load_quiz(path: Path, lesson_id: str) -> _QuizFx:
    raw = _read_utf8(path, f"quiz {lesson_id}")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContentError(f"quizzes/{lesson_id}.json: JSON inválido ({exc})") from exc
    try:
        quiz = _QuizFx.model_validate(payload)
    except ValidationError as exc:
        raise ContentError(
            f"quizzes/{lesson_id}.json: esquema inválido:\n{exc}"
        ) from exc
    if quiz.lesson_id != lesson_id:
        raise ContentError(
            f"quizzes/{lesson_id}.json: lesson_id interno "
            f"'{quiz.lesson_id}' ≠ nombre del archivo"
        )
    _validate_quiz_questions(quiz, lesson_id)
    return quiz


def _validate_quiz_questions(quiz: _QuizFx, lesson_id: str) -> None:
    seen_ids: set[str] = set()
    for question in quiz.questions:
        if question.id in seen_ids:
            raise ContentError(
                f"quizzes/{lesson_id}.json: pregunta duplicada '{question.id}'"
            )
        seen_ids.add(question.id)
        keys = [o.key for o in question.options]
        if len(keys) != len(set(keys)):
            raise ContentError(
                f"quizzes/{lesson_id}.json: opciones duplicadas en '{question.id}'"
            )
        if question.correct_key not in keys:
            raise ContentError(
                f"quizzes/{lesson_id}.json: correct_key "
                f"'{question.correct_key}' no está entre las opciones de "
                f"'{question.id}'"
            )


# ─────────────────── Validación de invariantes de fixtures (§4.4) ────────────


def _validate_ids(catalog: _CatalogFx, content_dir: Path) -> None:
    example_ids = set(catalog.examples)
    lesson_ids = set(catalog.lessons)
    if example_ids != lesson_ids:
        raise ContentError(
            "catalog.json: examples y lessons no tienen los mismos ids "
            f"(solo examples: {sorted(example_ids - lesson_ids)}; "
            f"solo lessons: {sorted(lesson_ids - example_ids)})"
        )
    if len(lesson_ids) != EXPECTED_LESSON_COUNT:
        raise ContentError(
            f"catalog.json: se esperaban {EXPECTED_LESSON_COUNT} lecciones, "
            f"hay {len(lesson_ids)}"
        )
    _validate_modules(catalog, lesson_ids)
    _validate_orders(catalog)
    _validate_recommended(catalog, lesson_ids)
    _validate_example_dirs(content_dir, example_ids)


def _validate_modules(catalog: _CatalogFx, lesson_ids: set[str]) -> None:
    assigned: set[str] = set()
    for module in catalog.modules:
        for lid in module.lessons:
            if lid not in lesson_ids:
                raise ContentError(
                    f"catalog.json: módulo {module.id} referencia lección "
                    f"inexistente '{lid}'"
                )
            if lid in assigned:
                raise ContentError(
                    f"catalog.json: lección '{lid}' en más de un módulo"
                )
            if catalog.lessons[lid].module_id != module.id:
                raise ContentError(
                    f"catalog.json: lección '{lid}' declara module_id "
                    f"'{catalog.lessons[lid].module_id}' pero está listada "
                    f"en '{module.id}'"
                )
            assigned.add(lid)
    missing = lesson_ids - assigned
    if missing:
        raise ContentError(f"catalog.json: lecciones sin módulo: {sorted(missing)}")


def _validate_orders(catalog: _CatalogFx) -> None:
    orders = [lesson.order for lesson in catalog.lessons.values()]
    if len(orders) != len(set(orders)):
        raise ContentError("catalog.json: order de lección duplicado")
    module_orders = [m.order for m in catalog.modules]
    if len(module_orders) != len(set(module_orders)):
        raise ContentError("catalog.json: order de módulo duplicado")


def _validate_recommended(catalog: _CatalogFx, lesson_ids: set[str]) -> None:
    for lid, lesson in catalog.lessons.items():
        for rec in lesson.recommended:
            if rec.lesson_id not in lesson_ids:
                raise ContentError(
                    f"catalog.json: recommended de '{lid}' referencia "
                    f"lección inexistente '{rec.lesson_id}'"
                )


def _validate_example_dirs(content_dir: Path, example_ids: set[str]) -> None:
    examples_dir = content_dir / "examples"
    if not examples_dir.is_dir():
        raise ContentError(f"falta el directorio {examples_dir}")
    on_disk = {p.name for p in examples_dir.iterdir() if p.is_dir()}
    extra = on_disk - example_ids
    if extra:
        raise ContentError(
            f"examples/: directorios sin entrada en catalog.json: {sorted(extra)}"
        )


def _load_quizzes(catalog: _CatalogFx, content_dir: Path) -> dict[str, Quiz]:
    quizzes_dir = content_dir / "quizzes"
    if not quizzes_dir.is_dir():
        raise ContentError(f"falta el directorio {quizzes_dir}")
    extra = {p.stem for p in quizzes_dir.glob("*.json")} - set(catalog.lessons)
    if extra:
        raise ContentError(
            f"quizzes/: archivos sin lección en catalog.json: {sorted(extra)}"
        )
    quizzes: dict[str, Quiz] = {}
    for lesson_id in catalog.lessons:
        fx = _load_quiz(quizzes_dir / f"{lesson_id}.json", lesson_id)
        quizzes[lesson_id] = Quiz(
            lesson_id=lesson_id,
            pass_threshold=fx.pass_threshold,
            questions=tuple(
                QuizQuestion(
                    id=q.id,
                    order=q.order,
                    text=q.text,
                    options=tuple(
                        QuizOption(key=o.key, text=o.text) for o in q.options
                    ),
                    correct_key=q.correct_key,
                    explanation=q.explanation,
                )
                for q in sorted(fx.questions, key=lambda q: q.order)
            ),
        )
    return quizzes


def _validate_enabled_questions(
    catalog: _CatalogFx, quizzes: dict[str, Quiz]
) -> None:
    enabled_total = sum(
        len(quizzes[lid].questions)
        for lid in catalog.lessons
        if catalog.examples[lid].enabled
    )
    if enabled_total != EXPECTED_ENABLED_QUESTIONS:
        raise ContentError(
            f"preguntas habilitadas: se esperaban "
            f"{EXPECTED_ENABLED_QUESTIONS}, hay {enabled_total}"
        )


# ───────────────────── Construcción de records desde fixtures ────────────────


def _build_examples(catalog: _CatalogFx, content_dir: Path) -> dict[str, Example]:
    examples: dict[str, Example] = {}
    for example_id, fx in catalog.examples.items():
        lesson_fx = catalog.lessons[example_id]
        source_code = _read_utf8(
            content_dir / "examples" / example_id / "main.py",
            f"examples/{example_id}/main.py",
        )
        examples[example_id] = Example(
            id=example_id,
            title=fx.title,
            module_id=lesson_fx.module_id,
            order=lesson_fx.order,
            filename=fx.filename,
            difficulty=fx.difficulty,
            teaches=fx.teaches,
            directives=tuple(fx.directives),
            threads_configurable=fx.threads_configurable,
            fixed_threads=fx.fixed_threads,
            fixed_threads_note=fx.fixed_threads_note,
            sweeps_threads=fx.sweeps_threads,
            self_measures=fx.self_measures,
            parser_id=fx.parser_id,
            default_timeout_s=fx.default_timeout_s,
            est_run_seconds=fx.est_run_seconds,
            enabled=fx.enabled,
            requires_gpu=fx.requires_gpu,
            lesson_id=example_id,
            expected_output_note=fx.expected_output_note,
            takeaways=tuple(fx.takeaways),
            source_code=source_code,
        )
    return examples


def _build_lessons(
    catalog: _CatalogFx, content_dir: Path, quizzes: dict[str, Quiz]
) -> dict[str, Lesson]:
    ordered = sorted(catalog.lessons.items(), key=lambda kv: kv[1].order)
    # Misma ruta lineal que la vía DB (``_vecinos_de_la_ruta``): el snapshot
    # sembrado tiene que ser idéntico al de los fixtures.
    vecinos = _vecinos_de_la_ruta(
        [
            {
                "id": lesson_id,
                "archived_at": None,
                "enabled": catalog.examples[lesson_id].enabled,
            }
            for lesson_id, _ in ordered
        ]
    )
    lessons: dict[str, Lesson] = {}
    for index, (lesson_id, fx) in enumerate(ordered):
        markdown = _read_utf8(
            content_dir / fx.content_file, f"lección {lesson_id}"
        )
        quiz = quizzes.get(lesson_id)
        question_count = len(quiz.questions) if quiz else 0
        lessons[lesson_id] = Lesson(
            id=lesson_id,
            module_id=fx.module_id,
            order=fx.order,
            title=fx.title,
            estimated_minutes=fx.estimated_minutes,
            content_markdown=markdown,
            # En los fixtures del baseline la lección SIEMPRE trae ejemplo
            # pareado con su mismo id (lo sigue exigiendo `_validate_catalog`).
            # La opcionalidad de E1 solo aparece por la vía de DB.
            example_id=lesson_id,
            has_quiz=question_count > 0,
            quiz_question_count=question_count,
            enabled=catalog.examples[lesson_id].enabled,
            completion_rule="quiz",
            video_url=None,
            archived=False,
            recommended=tuple(
                Recommended(lesson_id=r.lesson_id, label=r.label, tag=r.tag)
                for r in fx.recommended
            ),
            prev_lesson_id=vecinos[index][0],
            next_lesson_id=vecinos[index][1],
        )
    return lessons


# ─────────────────── Reconstrucción de records desde la DB ───────────────────


def _json_list(raw: str, what: str) -> list:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContentError(f"{what}: JSON inválido en DB ({exc})") from exc
    if not isinstance(value, list):
        raise ContentError(f"{what}: se esperaba una lista JSON en DB")
    return value


def _load_modules_from_db(rows: list, lesson_ids_by_module: dict) -> tuple:
    return tuple(
        Module(
            id=row["id"],
            order=row["order"],
            title=row["title"],
            description=row["description"],
            level=row["level"],
            lesson_ids=tuple(lesson_ids_by_module.get(row["id"], ())),
            version=row["version"],
            origin=row["origin"],
        )
        for row in rows
    )


def _load_examples_from_db(rows: list) -> dict[str, Example]:
    examples: dict[str, Example] = {}
    for row in rows:
        example_id = row["id"]
        # E1: un ejemplo puede existir sin lección asignada (`lesson_id IS
        # NULL`). El snapshot público NO lo lleva: su `module_id` y su `order`
        # vendrían del LEFT JOIN como NULL y harían reventar cualquier orden
        # sobre la lista (`'<' not supported between NoneType and int`), que es
        # un 500 en `GET /examples`. Material así solo se ve por la vía admin,
        # que lee la tabla directamente y no este snapshot.
        if row["lesson_id"] is None:
            continue
        parser_id = row["parser_id"]
        if parser_id not in PARSER_ID_VALUES:
            raise ContentError(
                f"examples/{example_id}: parser_id '{parser_id}' desconocido"
            )
        directives = _json_list(
            row["directives_json"], f"examples/{example_id}.directives"
        )
        takeaways = _json_list(
            row["takeaways_json"], f"examples/{example_id}.takeaways"
        )
        examples[example_id] = Example(
            id=example_id,
            title=row["title"],
            module_id=row["module_id"],
            order=row["lesson_order"],
            filename=row["filename"],
            difficulty=row["difficulty"],
            teaches=row["teaches"],
            directives=tuple(directives),
            threads_configurable=bool(row["threads_configurable"]),
            fixed_threads=row["fixed_threads"],
            fixed_threads_note=row["fixed_threads_note"],
            sweeps_threads=bool(row["sweeps_threads"]),
            self_measures=bool(row["self_measures"]),
            parser_id=parser_id,
            default_timeout_s=row["default_timeout_s"],
            est_run_seconds=row["est_run_seconds"],
            enabled=bool(row["enabled"]),
            requires_gpu=bool(row["requires_gpu"]),
            lesson_id=row["lesson_id"],
            expected_output_note=row["expected_output_note"],
            takeaways=tuple(takeaways),
            source_code=row["source_code"],
        )
    return examples


def _load_quizzes_from_db(
    rows: list, pass_thresholds: dict[str, float]
) -> dict[str, Quiz]:
    grouped: dict[str, list] = {}
    for row in rows:
        grouped.setdefault(row["lesson_id"], []).append(row)
    quizzes: dict[str, Quiz] = {}
    for lesson_id, qrows in grouped.items():
        questions: list[QuizQuestion] = []
        for row in sorted(qrows, key=lambda r: r["order"]):
            options_raw = _json_list(
                row["options_json"], f"quiz_questions/{row['id']}.options"
            )
            options = tuple(
                QuizOption(key=o["key"], text=o["text"]) for o in options_raw
            )
            keys = {o.key for o in options}
            if row["correct_key"] not in keys:
                raise ContentError(
                    f"quiz {row['id']}: correct_key '{row['correct_key']}' "
                    f"no está entre las opciones"
                )
            questions.append(
                QuizQuestion(
                    id=row["id"],
                    order=row["order"],
                    text=row["text"],
                    options=options,
                    correct_key=row["correct_key"],
                    explanation=row["explanation"],
                )
            )
        quizzes[lesson_id] = Quiz(
            lesson_id=lesson_id,
            pass_threshold=pass_thresholds[lesson_id],
            questions=tuple(questions),
        )
    return quizzes


def _vecinos_de_la_ruta(rows: list) -> list[tuple[str | None, str | None]]:
    """(prev, next) de cada fila, SALTANDO las que no cuentan para el progreso.

    Una lección archivada sigue siendo legible por URL, pero no forma parte de
    la ruta lineal del curso: si estuviera, «Siguiente» llevaría al estudiante a
    contenido que su módulo ya retiró. S2: una deshabilitada tampoco (misma
    regla que ``cuenta_para_progreso``): «Siguiente» no lleva a una lección que
    el sidebar no deja abrir.
    """
    vivas = [
        i
        for i, row in enumerate(rows)
        if row["archived_at"] is None and bool(row["enabled"])
    ]
    posicion = {indice: orden for orden, indice in enumerate(vivas)}
    vecinos: list[tuple[str | None, str | None]] = []
    for indice in range(len(rows)):
        orden = posicion.get(indice)
        if orden is None:  # archivada: fuera de la ruta, sin vecinos
            vecinos.append((None, None))
            continue
        anterior = rows[vivas[orden - 1]]["id"] if orden > 0 else None
        siguiente = rows[vivas[orden + 1]]["id"] if orden + 1 < len(vivas) else None
        vecinos.append((anterior, siguiente))
    return vecinos


def _load_steps_from_db(
    rows: list, example_ids: set[str]
) -> dict[str, tuple[WorkshopStep, ...]]:
    """``workshop_steps`` → pasos por lección, ya en orden de ``idx``.

    Un ``example_id`` cuyo ejemplo ya no existe (el autor lo borró) se poda del
    SNAPSHOT, no del dato, igual que ``recommended``: el paso queda como de solo
    lectura en vez de ofrecer un «Abrir en el simulador» que daría 404.
    """
    pasos: dict[str, list[WorkshopStep]] = {}
    for row in rows:  # ya vienen ORDER BY lesson_id, idx
        example_id = row["example_id"]
        pasos.setdefault(row["lesson_id"], []).append(
            WorkshopStep(
                idx=row["idx"],
                title=row["title"],
                body_markdown=row["body_markdown"],
                example_id=example_id if example_id in example_ids else None,
            )
        )
    return {lesson_id: tuple(lista) for lesson_id, lista in pasos.items()}


def _load_lessons_from_db(
    rows: list,
    example_ids_by_lesson: dict[str, str],
    quizzes: dict[str, Quiz],
    module_ids: set[str],
    steps_by_lesson: dict[str, tuple[WorkshopStep, ...]] | None = None,
) -> dict[str, Lesson]:
    steps_by_lesson = steps_by_lesson or {}
    ordered = list(rows)  # ya vienen ORDER BY (modules."order", lessons."order")
    # E2: la unicidad del `order` es POR MÓDULO y solo entre lecciones vivas
    # (índice parcial de la migración 5). Un `order` repetido entre módulos
    # distintos es lo normal desde que instalar módulos es à la carte.
    vivas: set[tuple[str, int]] = set()
    for row in ordered:
        if row["archived_at"] is not None:
            continue
        clave = (row["module_id"], row["order"])
        if clave in vivas:
            raise ContentError(
                f"lessons: order {row['order']} duplicado en el módulo "
                f"'{row['module_id']}'"
            )
        vivas.add(clave)
    vecinos = _vecinos_de_la_ruta(ordered)
    lessons: dict[str, Lesson] = {}
    for index, row in enumerate(ordered):
        lesson_id = row["id"]
        if row["module_id"] not in module_ids:
            raise ContentError(
                f"lección '{lesson_id}': module_id '{row['module_id']}' "
                f"inexistente"
            )
        if not (row["content_markdown"] or "").strip():
            raise ContentError(f"lección '{lesson_id}': content_markdown vacío")
        recommended_raw = _json_list(
            row["recommended_json"], f"lessons/{lesson_id}.recommended"
        )
        quiz = quizzes.get(lesson_id)
        question_count = len(quiz.questions) if quiz else 0
        lessons[lesson_id] = Lesson(
            id=lesson_id,
            module_id=row["module_id"],
            order=row["order"],
            title=row["title"],
            estimated_minutes=row["estimated_minutes"],
            content_markdown=row["content_markdown"],
            # E1: la relación la manda `examples.lesson_id`, no la igualdad de
            # ids. Una lección sin ejemplo pareado queda con `None`.
            example_id=example_ids_by_lesson.get(lesson_id),
            has_quiz=question_count > 0,
            quiz_question_count=question_count,
            enabled=bool(row["enabled"]),
            completion_rule=row["completion_rule"],
            video_url=row["video_url"],
            archived=row["archived_at"] is not None,
            recommended=tuple(
                Recommended(
                    lesson_id=r["lesson_id"], label=r["label"], tag=r["tag"]
                )
                for r in recommended_raw
            ),
            prev_lesson_id=vecinos[index][0],
            next_lesson_id=vecinos[index][1],
            kind=row["kind"],
            # Los pasos de una lección que dejó de ser taller se conservan en la
            # tabla (el autor puede volver a convertirla) pero no se exponen.
            steps=(
                steps_by_lesson.get(lesson_id, ())
                if row["kind"] == KIND_TALLER
                else ()
            ),
        )
    return _podar_recommended(lessons)


def _podar_recommended(lessons: dict[str, Lesson]) -> dict[str, Lesson]:
    """Descarta del snapshot las recomendaciones cuyo destino no está instalado.

    En Fase 4 esto LANZABA ``ContentError``, y era correcto: el catálogo era uno
    y completo, así que un enlace colgante solo podía ser un error del autor.

    Con módulos instalables à la carte deja de serlo: los ``recommended`` del
    módulo m1 del propio repo apuntan a m2, m4 y m6, así que instalar m1 en una
    base vacía reventaría con ``ContentError`` dentro de ``_persist`` → 500. O
    sea, un fallo garantizado del primer caso de uso.

    Se poda el SNAPSHOT, no el dato: ``lessons.recommended_json`` conserva la
    lista completa que escribió el autor, de modo que el enlace reaparece solo
    en cuanto el estudiante instale el módulo que faltaba.
    """
    podadas: dict[str, Lesson] = {}
    for lesson_id, lesson in lessons.items():
        vivas = tuple(
            rec for rec in lesson.recommended if rec.lesson_id in lessons
        )
        podadas[lesson_id] = (
            lesson if len(vivas) == len(lesson.recommended)
            else replace(lesson, recommended=vivas)
        )
    return podadas


# ────────────────────────────── Repositorio ─────────────────────────────────


class ContentRepository:
    """Snapshot inmutable del contenido (interfaz de lectura congelada, §5).

    Se construye vía las fábricas ``from_fixtures`` / ``load``. El constructor
    acepta también un ``content_dir`` posicional por COMPAT (Fase 3): en ese
    caso delega en ``from_fixtures``.
    """

    def __init__(
        self,
        content_dir: Path | str | None = None,
        *,
        modules: tuple[Module, ...] | None = None,
        lessons: dict[str, Lesson] | None = None,
        examples: dict[str, Example] | None = None,
        quizzes: dict[str, Quiz] | None = None,
    ) -> None:
        if content_dir is not None:
            # COMPAT: ``ContentRepository(CONTENT_DIR)`` ≡ ``from_fixtures``.
            built = ContentRepository.from_fixtures(content_dir)
            modules = built._modules
            lessons = built._lessons
            examples = built._examples
            quizzes = built._quizzes
        self._modules: tuple[Module, ...] = modules or ()
        self._lessons: dict[str, Lesson] = lessons or {}
        self._examples: dict[str, Example] = examples or {}
        self._quizzes: dict[str, Quiz] = quizzes or {}

    # ── Fábricas ─────────────────────────────────────────────────────────────

    @classmethod
    def from_fixtures(cls, content_dir: Path | str) -> "ContentRepository":
        """Carga + valida fixtures fail-fast (invariantes 14/60). La usan el
        seeder y los tests de baseline. Cuerpo = el ``__init__`` de Fase 3."""
        content_dir = Path(content_dir)
        if not content_dir.is_dir():
            raise ContentError(f"content_dir no existe: {content_dir}")
        catalog = _load_catalog(content_dir)
        _validate_ids(catalog, content_dir)
        quizzes = _load_quizzes(catalog, content_dir)
        _validate_enabled_questions(catalog, quizzes)
        examples = _build_examples(catalog, content_dir)
        lessons = _build_lessons(catalog, content_dir, quizzes)
        modules = tuple(
            Module(
                id=m.id,
                order=m.order,
                title=m.title,
                description=m.description,
                level=m.level,
                # lesson_ids en orden GLOBAL (por lesson.order), idéntico a
                # ``load(db)`` (que deriva por ORDER BY "order"): elimina el
                # riesgo de reordenamiento silencioso en el round-trip (SEED-2).
                lesson_ids=tuple(
                    sorted(m.lessons, key=lambda lid: lessons[lid].order)
                ),
            )
            for m in sorted(catalog.modules, key=lambda m: m.order)
        )
        return cls(
            modules=modules, lessons=lessons, examples=examples, quizzes=quizzes
        )

    @classmethod
    async def load(cls, db: "aiosqlite.Connection") -> "ContentRepository":
        """Reconstruye el MISMO snapshot inmutable desde las 4 tablas de DB.

        Validación limitada a integridad estructural (refs, correct_key ∈
        opciones, parser_id, markdown no vacío, order global único); los
        conteos 14/60 NO se exigen aquí (contenido mutable, §6.2)."""
        module_rows = list(
            await (await db.execute('SELECT * FROM modules ORDER BY "order"')).fetchall()
        )
        # E2: el orden de la ruta lineal es (modules."order", lessons."order"),
        # ya no el `order` global de lecciones que la migración 5 retiró.
        lesson_rows = list(
            await (
                await db.execute(
                    "SELECT l.* FROM lessons l "
                    "JOIN modules m ON m.id = l.module_id "
                    'ORDER BY m."order", l."order"'
                )
            ).fetchall()
        )
        # E1: el ejemplo se une por `lesson_id`, no por igualdad de ids. LEFT
        # JOIN porque un ejemplo puede no tener lección asignada, y entonces su
        # `module_id`/`order` son NULL.
        example_rows = list(
            await (
                await db.execute(
                    'SELECT e.*, l.module_id AS module_id, '
                    'l."order" AS lesson_order '
                    "FROM examples e LEFT JOIN lessons l ON l.id = e.lesson_id"
                )
            ).fetchall()
        )
        quiz_rows = list(
            await (
                await db.execute(
                    'SELECT * FROM quiz_questions ORDER BY lesson_id, "order"'
                )
            ).fetchall()
        )

        step_rows = list(
            await (
                await db.execute(
                    "SELECT lesson_id, idx, title, body_markdown, example_id "
                    "FROM workshop_steps ORDER BY lesson_id, idx"
                )
            ).fetchall()
        )

        module_ids = {row["id"] for row in module_rows}
        lesson_ids_by_module: dict[str, list[str]] = {}
        for row in lesson_rows:
            lesson_ids_by_module.setdefault(row["module_id"], []).append(row["id"])
        pass_thresholds = {row["id"]: row["pass_threshold"] for row in lesson_rows}

        examples = _load_examples_from_db(example_rows)
        example_ids_by_lesson = {
            example.lesson_id: example.id
            for example in examples.values()
            if example.lesson_id is not None
        }
        quizzes = _load_quizzes_from_db(quiz_rows, pass_thresholds)
        lessons = _load_lessons_from_db(
            lesson_rows,
            example_ids_by_lesson,
            quizzes,
            module_ids,
            _load_steps_from_db(step_rows, set(examples)),
        )
        modules = _load_modules_from_db(module_rows, lesson_ids_by_module)
        return cls(
            modules=modules, lessons=lessons, examples=examples, quizzes=quizzes
        )

    # ── Interfaz congelada (data-model §5) ──────────────────────────────────

    def modules(self) -> list[Module]:
        """Módulos ordenados por ``order``."""
        return list(self._modules)

    def lessons(self) -> list[Lesson]:
        """Lecciones ordenadas por ``order`` global."""
        return sorted(self._lessons.values(), key=lambda lesson: lesson.order)

    def lesson(self, lesson_id: str) -> Lesson | None:
        """Lección con ``content_markdown`` incluido."""
        return self._lessons.get(lesson_id)

    def examples(self) -> list[Example]:
        """Ejemplos ordenados por ``order`` global."""
        return sorted(self._examples.values(), key=lambda example: example.order)

    def example(self, example_id: str) -> Example | None:
        """Ejemplo con ``source_code`` incluido."""
        return self._examples.get(example_id)

    def quiz(self, lesson_id: str) -> Quiz | None:
        """Quiz CON ``correct_key``/``explanation`` — solo para el servicio."""
        return self._quizzes.get(lesson_id)

    def exists_lesson(self, lesson_id: str) -> bool:
        return lesson_id in self._lessons

    def exists_example(self, example_id: str) -> bool:
        return example_id in self._examples
