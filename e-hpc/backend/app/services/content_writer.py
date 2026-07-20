"""Orquestador de escrituras de contenido admin (Fase 4, api-contract §10).

Cada mutación pasa por aquí en tres tiempos:

1. **Validación de negocio** (§10.6) — corta con ``ApiException`` (4xx) ANTES de
   tocar la DB: refs (``MODULE_NOT_FOUND``), unicidad (``DUPLICATE_ID``), orden
   (``ORDER_CONFLICT``), módulo no vacío (``MODULE_NOT_EMPTY``), tamaño de código
   (``CODE_TOO_LARGE``), y reglas de contenido (markdown fuera del subset,
   ``correct_key`` ∈ opciones, coherencia threads/GPU, refs de ``recommended``)
   como ``CONTENT_VALIDATION_ERROR`` con ``details=[{field, reason}]``.
2. **Persistencia atómica** — todo dentro de ``app.state.write_lock``:
   ``INSERT/UPDATE/DELETE`` (``repositories/content_admin``) → se reconstruye el
   snapshot con ``reload_content`` (build-then-swap sobre los cambios AÚN sin
   commitear en la conexión única) → ``commit()``. Si el reload falla (grafo
   inconsistente) se hace ``rollback()``, no hay swap y se responde
   ``500 INTERNAL_ERROR`` (detalle solo a logs).
3. **Respuesta** — se devuelve el record ya persistido para armar el DTO admin.

Todas las validaciones que leen la DB corren DENTRO del lock: en el event loop
único ningún otro escritor se intercala entre la comprobación y la escritura.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.errors import ApiException
from app.repositories import content_admin
from app.repositories.content import ContentError, ContentRepository
from app.schemas import (
    AdminExample,
    AdminExampleBase,
    AdminExampleUpdate,
    AdminLessonCreate,
    AdminLessonDetail,
    AdminLessonUpdate,
    AdminModule,
    AdminModuleCreate,
    AdminModuleUpdate,
    AdminQuiz,
    AdminQuizUpsert,
    AdminRecommended,
)
from app.services.markdown_validator import validate as validate_markdown

if TYPE_CHECKING:
    from fastapi import FastAPI

#: Tope de bytes del código fuente (espejo de ``settings.max_code_bytes``).
_CODE_MAX_BYTES = 262144


# ─────────────────────────── errores de validación ──────────────────────────


def _content_error(details: list[dict]) -> ApiException:
    return ApiException(
        "CONTENT_VALIDATION_ERROR",
        "El contenido no cumple las reglas de validación.",
        details=details,
    )


def _code_bytes(source_code: str) -> int:
    return len(source_code.encode("utf-8"))


def _check_code_size(source_code: str) -> None:
    if _code_bytes(source_code) > _CODE_MAX_BYTES:
        raise ApiException(
            "CODE_TOO_LARGE",
            f"El código supera el máximo de {_CODE_MAX_BYTES} bytes.",
        )


def _example_coherence_issues(ex: AdminExampleBase) -> list[dict]:
    """Coherencia threads/GPU (§10.6, espeja jobs.py:131-153)."""
    issues: list[dict] = []
    if ex.threads_configurable and ex.fixed_threads is not None:
        issues.append(
            {
                "field": "fixed_threads",
                "reason": "threads_configurable=true ⇒ fixed_threads debe ser null",
            }
        )
    if (
        not ex.threads_configurable
        and not ex.sweeps_threads
        and (ex.fixed_threads is None or ex.fixed_threads < 1)
    ):
        issues.append(
            {
                "field": "fixed_threads",
                "reason": (
                    "threads no configurables y sin barrido ⇒ fixed_threads ≥ 1"
                ),
            }
        )
    if ex.requires_gpu and ex.enabled:
        issues.append(
            {
                "field": "enabled",
                "reason": "requires_gpu=true ⇒ enabled=false",
            }
        )
    return issues


async def _recommended_issues(
    db, recommended: list[AdminRecommended], *, self_id: str
) -> list[dict]:
    """``recommended[].lesson_id`` existe y no es la propia lección (§10.6)."""
    issues: list[dict] = []
    for rec in recommended:
        if rec.lesson_id == self_id:
            issues.append(
                {
                    "field": "recommended",
                    "reason": "una lección no puede recomendarse a sí misma",
                }
            )
            continue
        if not await content_admin.lesson_exists(db, rec.lesson_id):
            issues.append(
                {
                    "field": "recommended",
                    "reason": f"lección recomendada inexistente: {rec.lesson_id}",
                }
            )
    return issues


def _quiz_issues(body: AdminQuizUpsert) -> list[dict]:
    """Unicidad de ids/orden de pregunta, keys de opción y ``correct_key`` (§10.6)."""
    issues: list[dict] = []
    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    for question in body.questions:
        if question.id in seen_ids:
            issues.append(
                {"field": "questions", "reason": f"pregunta duplicada: {question.id}"}
            )
        seen_ids.add(question.id)
        if question.order in seen_orders:
            issues.append(
                {"field": "questions", "reason": f"order duplicado: {question.order}"}
            )
        seen_orders.add(question.order)
        keys = [o.key for o in question.options]
        if len(keys) != len(set(keys)):
            issues.append(
                {
                    "field": f"questions.{question.id}.options",
                    "reason": "keys de opción duplicadas",
                }
            )
        if question.correct_key not in keys:
            issues.append(
                {
                    "field": f"questions.{question.id}.correct_key",
                    "reason": (
                        f"correct_key '{question.correct_key}' no está entre las "
                        "opciones"
                    ),
                }
            )
    return issues


# ─────────────────────── persistencia atómica + reload ──────────────────────


async def _persist(app: "FastAPI", write) -> None:
    """Ejecuta la mutación ``write`` (coroutine sin ``commit``), valida el grafo
    reconstruyendo el snapshot sobre los cambios AÚN sin commitear, ``commit`` y
    SOLO ENTONCES hace el swap de ``app.state.content``.

    Rollback ante CUALQUIER excepción (garantías de integridad):
    - **CW-01**: un ``IntegrityError``/``OperationalError`` de los repos jamás
      deja una transacción parcial pendiente en la conexión compartida que otra
      unidad de escritura (quiz-attempt / job / progress) confirmaría a medias.
    - **CW-03**: la memoria nunca se adelanta a la DB — el swap ocurre después de
      un ``commit()`` exitoso; si el commit falla se hace ``rollback`` y no hay
      swap. El fallo de reload (grafo inconsistente) también hace ``rollback``.
    """
    db = app.state.db
    try:
        await write()  # INSERT/UPDATE/DELETE (sin commit)
        new_content = await ContentRepository.load(db)  # valida el grafo
        await db.commit()
    except ApiException:
        await db.rollback()
        raise
    except ContentError as exc:
        await db.rollback()
        raise ApiException(
            "INTERNAL_ERROR",
            "El contenido quedó en un estado inconsistente; se descartó el cambio.",
        ) from exc
    except Exception as exc:  # IntegrityError/OperationalError/… → rollback + 500
        await db.rollback()
        raise ApiException(
            "INTERNAL_ERROR", "No se pudo guardar el cambio de contenido."
        ) from exc
    app.state.content = new_content  # swap atómico SOLO tras commit OK


# ──────────────────────────────── módulos ───────────────────────────────────


async def create_module(app: "FastAPI", body: AdminModuleCreate) -> AdminModule:
    db = app.state.db
    async with app.state.write_lock:
        if await content_admin.module_exists(db, body.id):
            raise ApiException("DUPLICATE_ID", f"El id de módulo '{body.id}' ya existe.")
        if await content_admin.module_order_taken(db, body.order):
            raise ApiException(
                "ORDER_CONFLICT", f"El order {body.order} de módulo ya está en uso."
            )
        await _persist(app, lambda: content_admin.insert_module(db, body))
        result = await content_admin.select_admin_module(db, body.id)
    assert result is not None
    return result


async def update_module(
    app: "FastAPI", module_id: str, body: AdminModuleUpdate
) -> AdminModule:
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.module_exists(db, module_id):
            raise ApiException("MODULE_NOT_FOUND", f"No existe el módulo {module_id}.")
        if await content_admin.module_order_taken(db, body.order, exclude_id=module_id):
            raise ApiException(
                "ORDER_CONFLICT", f"El order {body.order} de módulo ya está en uso."
            )
        await _persist(app, lambda: content_admin.update_module(db, module_id, body))
        result = await content_admin.select_admin_module(db, module_id)
    assert result is not None
    return result


async def delete_module(app: "FastAPI", module_id: str) -> None:
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.module_exists(db, module_id):
            raise ApiException("MODULE_NOT_FOUND", f"No existe el módulo {module_id}.")
        if await content_admin.count_lessons_in_module(db, module_id) > 0:
            raise ApiException(
                "MODULE_NOT_EMPTY",
                "El módulo tiene lecciones; vacíalo antes de borrarlo.",
            )
        await _persist(app, lambda: content_admin.delete_module(db, module_id))


# ─────────────────────────────── lecciones ──────────────────────────────────


async def create_lesson(
    app: "FastAPI", body: AdminLessonCreate
) -> AdminLessonDetail:
    db = app.state.db
    _check_code_size(body.source_code)
    async with app.state.write_lock:
        if not await content_admin.module_exists(db, body.module_id):
            raise ApiException(
                "MODULE_NOT_FOUND", f"No existe el módulo {body.module_id}."
            )
        if await content_admin.lesson_exists(db, body.id):
            raise ApiException(
                "DUPLICATE_ID", f"El id de lección/ejemplo '{body.id}' ya existe."
            )
        if await content_admin.lesson_order_taken(db, body.order):
            raise ApiException(
                "ORDER_CONFLICT", f"El order {body.order} de lección ya está en uso."
            )
        issues = validate_markdown(body.content_markdown)
        # C2: el ejemplo va anidado (body.example); el path del error es
        # 'example.<campo>' para que el editor de lección posicione el hint.
        issues += [
            {**it, "field": f"example.{it['field']}"}
            for it in _example_coherence_issues(body.example)
        ]
        issues += await _recommended_issues(
            db, body.recommended, self_id=body.id
        )
        if issues:
            raise _content_error(issues)
        await _persist(
            app, lambda: content_admin.insert_lesson_with_example(db, body)
        )
        result = await content_admin.select_admin_lesson_detail(db, body.id)
    assert result is not None
    return result


async def update_lesson(
    app: "FastAPI", lesson_id: str, body: AdminLessonUpdate
) -> AdminLessonDetail:
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.lesson_exists(db, lesson_id):
            raise ApiException(
                "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
            )
        if not await content_admin.module_exists(db, body.module_id):
            raise ApiException(
                "MODULE_NOT_FOUND", f"No existe el módulo {body.module_id}."
            )
        if await content_admin.lesson_order_taken(
            db, body.order, exclude_id=lesson_id
        ):
            raise ApiException(
                "ORDER_CONFLICT", f"El order {body.order} de lección ya está en uso."
            )
        issues = validate_markdown(body.content_markdown)
        issues += await _recommended_issues(
            db, body.recommended, self_id=lesson_id
        )
        if issues:
            raise _content_error(issues)
        await _persist(app, lambda: content_admin.update_lesson(db, lesson_id, body))
        result = await content_admin.select_admin_lesson_detail(db, lesson_id)
    assert result is not None
    return result


async def delete_lesson(app: "FastAPI", lesson_id: str) -> None:
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.lesson_exists(db, lesson_id):
            raise ApiException(
                "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
            )
        await _persist(app, lambda: content_admin.delete_lesson(db, lesson_id))


# ──────────────────────────────── ejemplos ──────────────────────────────────


async def update_example(
    app: "FastAPI", example_id: str, body: AdminExampleUpdate
) -> AdminExample:
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.example_exists(db, example_id):
            raise ApiException(
                "EXAMPLE_NOT_FOUND", f"No existe el ejemplo {example_id}."
            )
        issues = _example_coherence_issues(body)
        if issues:
            raise _content_error(issues)
        await _persist(app, lambda: content_admin.update_example(db, example_id, body))
        result = await content_admin.select_admin_example(db, example_id)
    assert result is not None
    return result


async def set_example_code(
    app: "FastAPI", example_id: str, *, source_code: str, filename: str
) -> AdminExample:
    db = app.state.db
    _check_code_size(source_code)
    async with app.state.write_lock:
        if not await content_admin.example_exists(db, example_id):
            raise ApiException(
                "EXAMPLE_NOT_FOUND", f"No existe el ejemplo {example_id}."
            )
        await _persist(
            app,
            lambda: content_admin.set_example_code(
                db, example_id, source_code=source_code, filename=filename
            ),
        )
        result = await content_admin.select_admin_example(db, example_id)
    assert result is not None
    return result


# ────────────────────────────────── quiz ────────────────────────────────────


async def replace_quiz(
    app: "FastAPI", lesson_id: str, body: AdminQuizUpsert
) -> AdminQuiz:
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.lesson_exists(db, lesson_id):
            raise ApiException(
                "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
            )
        issues = _quiz_issues(body)
        # CW-02: quiz_questions.id es PK GLOBAL; un id ya usado por OTRA lección
        # daría IntegrityError (500). Se detecta aquí como 422 limpio.
        foreign = await content_admin.question_ids_in_other_lessons(
            db, lesson_id, [q.id for q in body.questions]
        )
        issues += [
            {
                "field": f"questions.{qid}.id",
                "reason": f"el id de pregunta '{qid}' ya lo usa otra lección",
            }
            for qid in foreign
        ]
        if issues:
            raise _content_error(issues)
        # BL-06 (§10.5): el estado previo se lee ANTES del reemplazo (el
        # DELETE+INSERT de preguntas borra la evidencia del conteo anterior).
        # Cambiar el nº de preguntas o el umbral invalida el progreso: un
        # best_quiz_score sobre un total distinto (o un "aprobado" con otro
        # umbral) sería una nota imposible de corregir para el estudiante.
        prev_count = await content_admin.quiz_question_count(db, lesson_id)
        prev_threshold = await content_admin.lesson_pass_threshold(db, lesson_id)
        reset_progress = (
            prev_count != len(body.questions)
            or prev_threshold != body.pass_threshold
        )

        async def _write() -> None:
            await content_admin.replace_quiz(db, lesson_id, body)
            if reset_progress:
                await content_admin.reset_quiz_progress(db, lesson_id)

        await _persist(app, _write)
        result = await content_admin.select_admin_quiz(db, lesson_id)
    assert result is not None
    return result


async def delete_quiz(app: "FastAPI", lesson_id: str) -> None:
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.lesson_exists(db, lesson_id):
            raise ApiException(
                "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
            )
        if await content_admin.quiz_question_count(db, lesson_id) == 0:
            raise ApiException(
                "QUIZ_NOT_FOUND", f"La lección {lesson_id} no tiene quiz."
            )

        # BL-06 (§10.5): borrar el quiz siempre cambia el nº de preguntas
        # (el guard de arriba garantiza que había ≥1) ⇒ reset incondicional.
        async def _write() -> None:
            await content_admin.delete_quiz(db, lesson_id)
            await content_admin.reset_quiz_progress(db, lesson_id)

        await _persist(app, _write)
