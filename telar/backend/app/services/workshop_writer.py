"""Autoría de los pasos de un taller (S6 · CU-28, api-contract §12).

Mismo esquema que ``content_writer``: validación de negocio DENTRO del
``write_lock`` (ningún otro escritor se intercala entre comprobar y escribir) →
``_persist`` (escritura sin commit, reload del snapshot que valida el grafo,
``commit`` y swap) → respuesta con la lista resultante.

Cada operación reescribe la lista entera con ``replace_steps_no_commit``: los
``idx`` son siempre ``0..n-1`` contiguos, sin huecos que la vista tenga que
interpretar. Reordenar y borrar MUEVEN las casillas con su paso
(``remap_marks_no_commit``): la marca de «Paso 1» sigue siendo de «Paso 1».
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.errors import ApiException
from app.repositories import catalog as catalog_repo
from app.repositories import content_admin
from app.repositories import workshop as workshop_repo
from app.repositories.workshop import StepContent, StepRow
from app.schemas import (
    MAX_WORKSHOP_STEPS,
    AdminWorkshopStepInput,
    AdminWorkshopSteps,
)
from app.services.content_writer import _content_error, _persist
from app.services.markdown_validator import validate as validate_markdown

if TYPE_CHECKING:
    import aiosqlite
    from fastapi import FastAPI


async def _pasos_del_taller(db: "aiosqlite.Connection", lesson_id: str) -> list[StepRow]:
    """Los pasos actuales, o el error que corresponde si no hay taller."""
    kind = await content_admin.lesson_kind(db, lesson_id)
    if kind is None:
        raise ApiException("LESSON_NOT_FOUND", f"No existe la lección {lesson_id}.")
    if kind != "taller":
        raise _content_error(
            [
                {
                    "field": "kind",
                    "reason": "solo un taller tiene pasos; cambia el tipo de la lección antes.",
                }
            ]
        )
    return await workshop_repo.select_steps(db, lesson_id)


def _paso(pasos: list[StepRow], lesson_id: str, idx: int) -> StepRow:
    if 0 <= idx < len(pasos):
        return pasos[idx]
    raise ApiException("STEP_NOT_FOUND", f"La lección {lesson_id} no tiene el paso {idx}.")


async def _issues_del_paso(
    db: "aiosqlite.Connection", lesson_id: str, body: AdminWorkshopStepInput
) -> list[dict]:
    """Markdown en el subset de siempre y un ejemplo del MISMO módulo.

    Publicar exige que el ejemplo de cada paso viaje en el bundle del módulo
    (``bundle_guard``); comprobarlo aquí evita guardar un paso que luego no se
    podría publicar.
    """
    issues = [
        {**problema, "field": "body_markdown"}
        for problema in validate_markdown(body.body_markdown)
    ]
    if body.example_id is None:
        return issues
    if not await content_admin.example_exists(db, body.example_id):
        issues.append(
            {"field": "example_id", "reason": f"no existe el ejemplo '{body.example_id}'."}
        )
    elif await content_admin.example_module_id(
        db, body.example_id
    ) != await content_admin.lesson_module_id(db, lesson_id):
        issues.append(
            {
                "field": "example_id",
                "reason": (
                    f"el ejemplo '{body.example_id}' no es de este módulo; un "
                    "paso solo puede abrir ejemplos del módulo del taller."
                ),
            }
        )
    return issues


def _contenido(pasos: list[StepRow]) -> list[StepContent]:
    return [StepContent(p.title, p.body_markdown, p.example_id) for p in pasos]


def _desde(body: AdminWorkshopStepInput) -> StepContent:
    return StepContent(body.title, body.body_markdown, body.example_id)


async def _escribir(
    app: "FastAPI",
    lesson_id: str,
    pasos: list[StepContent],
    *,
    destino_de_marcas: dict[int, int | None] | None = None,
) -> AdminWorkshopSteps:
    db = app.state.db

    async def _write() -> None:
        await catalog_repo.mark_linked_modified_no_commit(db, lesson_ids=[lesson_id])
        await workshop_repo.replace_steps_no_commit(db, lesson_id, pasos)
        if destino_de_marcas is not None:
            await workshop_repo.remap_marks_no_commit(db, lesson_id, destino_de_marcas)

    await _persist(app, _write)
    return AdminWorkshopSteps(
        lesson_id=lesson_id,
        steps=await content_admin.select_admin_steps(db, lesson_id),
    )


async def add_step(
    app: "FastAPI", lesson_id: str, body: AdminWorkshopStepInput
) -> AdminWorkshopSteps:
    """``POST /admin/lessons/{id}/steps`` — añade un paso al final."""
    db = app.state.db
    async with app.state.write_lock:
        pasos = await _pasos_del_taller(db, lesson_id)
        issues = await _issues_del_paso(db, lesson_id, body)
        if len(pasos) >= MAX_WORKSHOP_STEPS:
            issues.append(
                {"field": "steps", "reason": f"un taller admite como mucho {MAX_WORKSHOP_STEPS} pasos."}
            )
        if issues:
            raise _content_error(issues)
        return await _escribir(app, lesson_id, [*_contenido(pasos), _desde(body)])


async def update_step(
    app: "FastAPI", lesson_id: str, idx: int, body: AdminWorkshopStepInput
) -> AdminWorkshopSteps:
    """``PUT /admin/lessons/{id}/steps/{idx}`` — reemplaza el contenido de un paso."""
    db = app.state.db
    async with app.state.write_lock:
        pasos = await _pasos_del_taller(db, lesson_id)
        _paso(pasos, lesson_id, idx)
        issues = await _issues_del_paso(db, lesson_id, body)
        if issues:
            raise _content_error(issues)
        nuevos = _contenido(pasos)
        nuevos[idx] = _desde(body)
        return await _escribir(app, lesson_id, nuevos)


async def reorder_steps(
    app: "FastAPI", lesson_id: str, order: list[int]
) -> AdminWorkshopSteps:
    """``PUT /admin/lessons/{id}/steps/reorder`` — ``order`` es una permutación."""
    db = app.state.db
    async with app.state.write_lock:
        pasos = await _pasos_del_taller(db, lesson_id)
        if sorted(order) != list(range(len(pasos))):
            raise _content_error(
                [
                    {
                        "field": "order",
                        "reason": f"debe nombrar cada paso actual (0..{len(pasos) - 1}) exactamente una vez.",
                    }
                ]
            )
        nuevos = [_contenido(pasos)[viejo] for viejo in order]
        destino = {viejo: nuevo for nuevo, viejo in enumerate(order)}
        return await _escribir(app, lesson_id, nuevos, destino_de_marcas=destino)


async def delete_step(app: "FastAPI", lesson_id: str, idx: int) -> AdminWorkshopSteps:
    """``DELETE /admin/lessons/{id}/steps/{idx}`` — quita el paso y compacta."""
    db = app.state.db
    async with app.state.write_lock:
        pasos = await _pasos_del_taller(db, lesson_id)
        _paso(pasos, lesson_id, idx)
        restantes = [i for i in range(len(pasos)) if i != idx]
        nuevos = [_contenido(pasos)[i] for i in restantes]
        destino: dict[int, int | None] = {viejo: nuevo for nuevo, viejo in enumerate(restantes)}
        destino[idx] = None
        return await _escribir(app, lesson_id, nuevos, destino_de_marcas=destino)


__all__ = ["add_step", "update_step", "reorder_steps", "delete_step"]
