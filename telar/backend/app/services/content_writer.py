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

import re
from typing import TYPE_CHECKING

from app.errors import ApiException
from app.repositories import catalog as catalog_repo
from app.repositories import content_admin
from app.repositories.content import ContentError, ContentRepository
from app.schemas import (
    AdminExample,
    AdminExampleBase,
    AdminExampleUpdate,
    AdminLessonCreate,
    AdminLessonExampleCreate,
    AdminLessonDetail,
    AdminLessonUpdate,
    AdminModule,
    AdminModuleCreate,
    AdminModulesResponse,
    AdminModuleUpdate,
    AdminQuiz,
    AdminQuizUpsert,
    AdminRecommended,
    AdminReorderItem,
    QUESTION_ID_PATTERN,
)
from app.services import youtube
from app.services.markdown_validator import validate as validate_markdown

if TYPE_CHECKING:
    from fastapi import FastAPI

#: Patrón de id de pregunta (§10.6); valida también los ids AUTOGENERADOS, que
#: no pasan por pydantic (BL-18).
_QUESTION_ID_RE = re.compile(QUESTION_ID_PATTERN)

# ─────────────────────────── errores de validación ──────────────────────────


def _content_error(details: list[dict]) -> ApiException:
    return ApiException(
        "CONTENT_VALIDATION_ERROR",
        "El contenido no cumple las reglas de validación.",
        details=details,
    )


def _code_bytes(source_code: str) -> int:
    return len(source_code.encode("utf-8"))


def _max_code_bytes(app: "FastAPI") -> int:
    """Tope de bytes del código fuente leído en runtime (BL-17).

    Espeja la vía multipart y ``/jobs``: el límite es ``settings.max_code_bytes``
    (``TELAR_MAX_CODE_BYTES``), no una constante — un operador que baje el tope lo
    ve aplicado por igual en la vía JSON.
    """
    return int(app.state.settings.max_code_bytes)


def _check_code_size(app: "FastAPI", source_code: str) -> None:
    max_bytes = _max_code_bytes(app)
    if _code_bytes(source_code) > max_bytes:
        raise ApiException(
            "CODE_TOO_LARGE",
            f"El código supera el máximo de {max_bytes} bytes.",
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
        and not ex.requires_gpu  # BL-11: los ejemplos GPU no usan hilos de CPU
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


def _example_pairing_issues(example, source_code: str | None) -> list[dict]:
    """``example`` y ``source_code`` viajan juntos o no viajan (E1)."""
    if (example is None) == (source_code is None):
        return []
    falta = "source_code" if source_code is None else "example"
    return [
        {
            "field": falta,
            "reason": (
                "El ejemplo y su código van juntos: envía ambos para una "
                "lección con código, o ninguno para una lección conceptual."
            ),
        }
    ]


def _completion_rule_issues(rule: str, *, tiene_ejemplo: bool) -> list[dict]:
    """E4 — la regla de completitud tiene que ser alcanzable.

    Solo se comprueba ``"run"``. Elegirla es un acto deliberado del autor, y
    hacerlo sin ejemplo es una incoherencia directa: no hay nada que ejecutar.

    ``"quiz"`` **no** se comprueba aquí, aunque sea el caso que deja una lección
    incompletable, porque durante la autoría es el estado NORMAL: la lección
    nace sin quiz y el quiz se añade después con
    ``PUT /admin/lessons/{id}/quiz``. Bloquear cada edición intermedia
    convertiría el flujo de trabajo en una pelea con el validador.

    Dónde sí se exige: al **publicar** un módulo y al **instalar** un bundle
    (§10.6/§11.10), que es cuando el contenido llega a un estudiante y una
    lección incompletable pasa de borrador a problema real.
    """
    if rule == "run" and not tiene_ejemplo:
        return [
            {
                "field": "completion_rule",
                "reason": (
                    "'run' exige que la lección tenga ejemplo ejecutable; "
                    "sin código no hay nada que ejecutar para completarla."
                ),
            }
        ]
    return []


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


def _assign_question_ids(lesson_id: str, body: AdminQuizUpsert) -> AdminQuizUpsert:
    """Autogenera el id de las preguntas sin id como ``{lesson_id}-q{order}``.

    BL-18 / api-contract §10.5: el ``id`` de pregunta es opcional; cuando falta,
    el servidor lo deriva del ``order`` (único por §10.6, validado justo después)
    en vez de rechazar la petición con un 422. Las preguntas con id de cliente se
    conservan intactas.
    """
    if all(q.id for q in body.questions):
        return body
    questions = [
        q if q.id else q.model_copy(update={"id": f"{lesson_id}-q{q.order}"})
        for q in body.questions
    ]
    return body.model_copy(update={"questions": questions})


def _quiz_issues(body: AdminQuizUpsert) -> list[dict]:
    """Unicidad de ids/orden de pregunta, keys de opción y ``correct_key`` (§10.6)."""
    issues: list[dict] = []
    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    for question in body.questions:
        # BL-18: el id autogenerado ({lesson_id}-q{order}) no pasa por pydantic;
        # con un lesson_id largo + order enorme podría superar los 80 chars del
        # patrón. Se valida aquí para no persistir un id fuera de contrato.
        if question.id is None or not _QUESTION_ID_RE.fullmatch(question.id):
            issues.append(
                {
                    "field": "questions",
                    "reason": (
                        f"id de pregunta inválido (patrón {QUESTION_ID_PATTERN}): "
                        f"{question.id}"
                    ),
                }
            )
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
    # BL-19: el lock de lectura DEDICADO cubre la ventana con cambios sin
    # commitear en la conexión compartida. Los GET admin lo toman también, así
    # que no observan una mutación a medias SIN retener el ``write_lock``
    # transversal — la persistencia de ``finish()`` de jobs / quiz / progreso
    # ya no espera a un dashboard admin que lee.
    async with app.state.content_read_lock:
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
        async def _write() -> None:
            await catalog_repo.mark_linked_modified_no_commit(db, module_ids=[module_id])
            await content_admin.update_module(db, module_id, body)

        await _persist(app, _write)
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
    # E1: sin ejemplo no hay código que medir.
    if body.source_code is not None:
        _check_code_size(app, body.source_code)
    async with app.state.write_lock:
        if not await content_admin.module_exists(db, body.module_id):
            raise ApiException(
                "MODULE_NOT_FOUND", f"No existe el módulo {body.module_id}."
            )
        if await content_admin.lesson_exists(db, body.id):
            raise ApiException(
                "DUPLICATE_ID", f"El id de lección/ejemplo '{body.id}' ya existe."
            )
        # E2: el order es único DENTRO del módulo destino, ya no global.
        if await content_admin.lesson_order_taken(db, body.module_id, body.order):
            raise ApiException(
                "ORDER_CONFLICT",
                f"El order {body.order} ya está en uso en el módulo "
                f"{body.module_id}.",
            )
        issues = validate_markdown(body.content_markdown)
        issues += youtube.issues(body.video_url)
        # C2: el ejemplo va anidado (body.example); el path del error es
        # 'example.<campo>' para que el editor de lección posicione el hint.
        if body.example is not None:
            issues += [
                {**it, "field": f"example.{it['field']}"}
                for it in _example_coherence_issues(body.example)
            ]
        issues += _completion_rule_issues(
            body.completion_rule, tiene_ejemplo=body.example is not None
        )
        issues += _example_pairing_issues(body.example, body.source_code)
        issues += await _recommended_issues(
            db, body.recommended, self_id=body.id
        )
        if issues:
            raise _content_error(issues)
        body = body.model_copy(
            update={"video_url": youtube.normalizar(body.video_url)}
        )
        async def _write() -> None:
            await catalog_repo.mark_linked_modified_no_commit(db, module_ids=[body.module_id])
            await content_admin.insert_lesson_with_example(db, body)

        await _persist(app, _write)
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
        # E2: contra el módulo DESTINO (`body.module_id`), que puede ser otro
        # si la edición mueve la lección de módulo.
        if await content_admin.lesson_order_taken(
            db, body.module_id, body.order, exclude_id=lesson_id
        ):
            raise ApiException(
                "ORDER_CONFLICT",
                f"El order {body.order} ya está en uso en el módulo "
                f"{body.module_id}.",
            )
        issues = validate_markdown(body.content_markdown)
        issues += youtube.issues(body.video_url)
        issues += _completion_rule_issues(
            body.completion_rule,
            tiene_ejemplo=await content_admin.lesson_has_example(db, lesson_id),
        )
        issues += await _recommended_issues(
            db, body.recommended, self_id=lesson_id
        )
        if issues:
            raise _content_error(issues)
        body = body.model_copy(
            update={"video_url": youtube.normalizar(body.video_url)}
        )
        async def _write() -> None:
            # Origen (resuelto antes de mover) y destino.
            await catalog_repo.mark_linked_modified_no_commit(
                db, lesson_ids=[lesson_id], module_ids=[body.module_id]
            )
            await content_admin.update_lesson(db, lesson_id, body)

        await _persist(app, _write)
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
        async def _write() -> None:
            await catalog_repo.mark_linked_modified_no_commit(db, lesson_ids=[lesson_id])
            await content_admin.delete_lesson(db, lesson_id)

        await _persist(app, _write)


# ───────────────────────────── reorden por lote ─────────────────────────────


async def _reorder(
    app: "FastAPI",
    items: list[AdminReorderItem],
    *,
    exists,
    get_orders,
    persist_write,
    clave_final,
    pares,
    not_found_code: str,
    kind: str,
) -> AdminModulesResponse:
    """Valida y aplica un reorden por lote (BL-20, §10.2/§10.3).

    Reglas: sin ids repetidos en la petición; cada id existe
    (``not_found_code``); el conjunto FINAL de CLAVES (filas tocadas + intactas)
    es único (``ORDER_CONFLICT``). La escritura en dos fases del repo evita
    violar el ``UNIQUE`` a mitad de transacción. Devuelve el listado admin
    completo ya reordenado.

    La clave depende de la entidad (E2): para módulos es el ``order`` a secas,
    porque ``modules."order"`` sigue siendo único global; para lecciones es la
    pareja ``(module_id, order)``. Por eso ``clave_final`` y ``pares`` se
    inyectan en vez de asumir una forma única.
    """
    db = app.state.db
    async with app.state.write_lock:
        ids = [it.id for it in items]
        if len(set(ids)) != len(ids):
            raise _content_error(
                [{"field": "items", "reason": f"id de {kind} repetido en la petición"}]
            )
        missing: list[str] = []
        for row_id in ids:
            if not await exists(db, row_id):
                missing.append(row_id)
        if missing:
            raise ApiException(
                not_found_code,
                f"{kind} inexistente(s): {', '.join(missing)}.",
            )
        current = await get_orders(db)  # {id: clave} de TODAS las filas
        nuevas = {it.id: await clave_final(db, it) for it in items}
        final = {**current, **nuevas}
        if len(set(final.values())) != len(final):
            raise ApiException(
                "ORDER_CONFLICT",
                "El reorden deja dos elementos con el mismo order.",
            )
        escrituras = [await pares(db, it) for it in items]
        await _persist(app, lambda: persist_write(db, escrituras))
        modules = await content_admin.select_admin_modules(db)
    return AdminModulesResponse(modules=modules)


async def reorder_modules(
    app: "FastAPI", items: list[AdminReorderItem]
) -> AdminModulesResponse:
    async def _clave(_db, item: AdminReorderItem) -> int:
        return item.order

    async def _par(_db, item: AdminReorderItem) -> tuple[str, int]:
        return (item.id, item.order)

    return await _reorder(
        app,
        items,
        exists=content_admin.module_exists,
        get_orders=content_admin.all_module_orders,
        persist_write=content_admin.reorder_modules,
        clave_final=_clave,
        pares=_par,
        not_found_code="MODULE_NOT_FOUND",
        kind="módulo",
    )


async def reorder_lessons(
    app: "FastAPI", items: list[AdminReorderItem]
) -> AdminModulesResponse:
    # `module_id` es OPCIONAL en el item (§10.3): si falta, se resuelve contra
    # el módulo actual de la lección. Así los payloads de Fase 4, que no lo
    # traían, siguen siendo válidos; enviarlo mueve además la lección de módulo.
    async def _modulo(db, item: AdminReorderItem) -> str:
        if item.module_id is not None:
            return item.module_id
        actuales = await content_admin.lesson_module_ids(db)
        return actuales[item.id]

    async def _clave(db, item: AdminReorderItem) -> tuple[str, int]:
        return (await _modulo(db, item), item.order)

    async def _par(db, item: AdminReorderItem) -> tuple[str, str, int]:
        return (item.id, await _modulo(db, item), item.order)

    async def _escribir(db, escrituras: list[tuple[str, str, int]]) -> None:
        # El orden de las lecciones es contenido publicable (el bundle las
        # numera así); el de los módulos no, es local. Solo se marcan las que
        # de verdad cambian: el reorden suele reenviar el módulo entero.
        actuales = await content_admin.all_lesson_orders(db)
        cambian = [e for e in escrituras if actuales.get(e[0]) != (e[1], e[2])]
        await catalog_repo.mark_linked_modified_no_commit(
            db,
            lesson_ids=[e[0] for e in cambian],
            module_ids=[e[1] for e in cambian],
        )
        await content_admin.reorder_lessons(db, escrituras)

    return await _reorder(
        app,
        items,
        exists=content_admin.lesson_exists,
        get_orders=content_admin.all_lesson_orders,
        persist_write=_escribir,
        clave_final=_clave,
        pares=_par,
        not_found_code="LESSON_NOT_FOUND",
        kind="lección",
    )


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
        async def _write() -> None:
            await catalog_repo.mark_linked_modified_no_commit(db, example_ids=[example_id])
            await content_admin.update_example(db, example_id, body)

        await _persist(app, _write)
        result = await content_admin.select_admin_example(db, example_id)
    assert result is not None
    return result


async def add_example_to_lesson(
    app: "FastAPI", lesson_id: str, body: AdminLessonExampleCreate
) -> AdminExample:
    """§10.3 ``POST /admin/lessons/{id}/example`` — dar código a una lección.

    E1: el ejemplo dejó de nacer y morir con su lección, así que una lección
    conceptual puede convertirse en práctica sin recrearla —y sin que su
    progreso se pierda, que es lo que pasaría al borrarla y volver a crearla.
    """
    db = app.state.db
    _check_code_size(app, body.source_code)
    async with app.state.write_lock:
        if not await content_admin.lesson_exists(db, lesson_id):
            raise ApiException(
                "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
            )
        if await content_admin.lesson_has_example(db, lesson_id):
            raise ApiException(
                "DUPLICATE_ID",
                f"La lección {lesson_id} ya tiene ejemplo; edítalo o bórralo.",
            )
        if await content_admin.example_exists(db, lesson_id):
            raise ApiException(
                "DUPLICATE_ID", f"El id de ejemplo '{lesson_id}' ya existe."
            )
        issues = _example_coherence_issues(body.example)
        if issues:
            raise _content_error(issues)
        async def _write() -> None:
            await catalog_repo.mark_linked_modified_no_commit(db, lesson_ids=[lesson_id])
            await content_admin.insert_example_for_lesson(
                db, lesson_id, body.example, body.source_code
            )

        await _persist(app, _write)
        result = await content_admin.select_admin_example(db, lesson_id)
    assert result is not None
    return result


async def remove_example_from_lesson(app: "FastAPI", lesson_id: str) -> None:
    """§10.3 ``DELETE /admin/lessons/{id}/example`` — la lección pasa a teórica.

    Borra SOLO el ejemplo. La lección, su quiz y —sobre todo— el progreso del
    estudiante siguen intactos: ese es el punto de haber desacoplado los ids.
    """
    db = app.state.db
    async with app.state.write_lock:
        if not await content_admin.lesson_exists(db, lesson_id):
            raise ApiException(
                "LESSON_NOT_FOUND", f"No existe la lección {lesson_id}."
            )
        if not await content_admin.lesson_has_example(db, lesson_id):
            raise ApiException(
                "EXAMPLE_NOT_FOUND", f"La lección {lesson_id} no tiene ejemplo."
            )
        async def _write() -> None:
            await catalog_repo.mark_linked_modified_no_commit(db, lesson_ids=[lesson_id])
            await content_admin.delete_example_of_lesson(db, lesson_id)

        await _persist(app, _write)


async def set_example_code(
    app: "FastAPI", example_id: str, *, source_code: str, filename: str
) -> AdminExample:
    db = app.state.db
    _check_code_size(app, source_code)
    async with app.state.write_lock:
        if not await content_admin.example_exists(db, example_id):
            raise ApiException(
                "EXAMPLE_NOT_FOUND", f"No existe el ejemplo {example_id}."
            )
        async def _write() -> None:
            await catalog_repo.mark_linked_modified_no_commit(db, example_ids=[example_id])
            await content_admin.set_example_code(
                db, example_id, source_code=source_code, filename=filename
            )

        await _persist(app, _write)
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
        body = _assign_question_ids(lesson_id, body)  # BL-18: id opcional
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
            await catalog_repo.mark_linked_modified_no_commit(db, lesson_ids=[lesson_id])
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
            await catalog_repo.mark_linked_modified_no_commit(db, lesson_ids=[lesson_id])
            await content_admin.delete_quiz(db, lesson_id)
            await content_admin.reset_quiz_progress(db, lesson_id)

        await _persist(app, _write)
