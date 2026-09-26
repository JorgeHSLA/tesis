"""Taller guiado (S6 · CU-28, api-contract §12): la casilla «Lo hice».

Un taller se completa cuando TODOS sus pasos están marcados
(:func:`taller_completo`). Marcar el último escribe ``lesson_progress
.completed = 1`` con ``completed_via = 'manual'``, así el taller cuenta en el
progreso del módulo como cualquier lección y los agregados no cambian.

Reglas que este módulo sostiene:

* **Idempotente.** Marcar lo marcado o desmarcar lo desmarcado no cambia nada.
* **Monótono.** Desmarcar un paso NO descompleta el taller: lo ganado no se
  revoca, igual que el aprobado de un quiz (data-model §8.4).
* **Una sola regla de disponibilidad.** Un taller deshabilitado o archivado
  guarda la casilla —es lo que hizo el estudiante— pero no se completa. La
  condición se evalúa contra la DB dentro del ``write_lock``
  (``SQL_CUENTA_PARA_PROGRESO``), no contra el snapshot: el mismo criterio que
  el quiz y el job, a prueba de que el autor la retire a mitad.
* **Marcar = tocar.** Toda casilla deja ``viewed = 1``: el taller queda con
  historia, y una actualización del módulo que lo retire lo ARCHIVA en vez de
  borrarlo junto con sus casillas (``module_merge._tocada``).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, Protocol

from app import db as database
from app.errors import ApiException
from app.repositories import content_admin
from app.repositories import workshop as workshop_repo
from app.repositories.content import KIND_TALLER, SQL_CUENTA_PARA_PROGRESO
from app.schemas import WorkshopStepUpdateResult

if TYPE_CHECKING:
    import aiosqlite

    from app.repositories.progress import ProgressRepository


class _ConIdx(Protocol):
    """Un paso, del snapshot (``WorkshopStep``) o de la DB (``StepRow``)."""

    @property
    def idx(self) -> int: ...

#: ``lesson_progress.completed_via`` de un taller: ya admitido por el CHECK de la
#: migración 5; el estudiante lo completa con sus propias marcas.
COMPLETED_VIA_TALLER = "manual"


def taller_completo(steps: Sequence[_ConIdx], marcas: Iterable[int]) -> bool:
    """¿Están marcados todos los pasos? Un taller sin pasos nunca está completo.

    Las marcas de pasos que ya no existen (un idx retirado) no cuentan: solo se
    miran los ``idx`` de ``steps``.
    """
    hechas = set(marcas)
    return bool(steps) and all(step.idx in hechas for step in steps)


async def _completable(db: "aiosqlite.Connection", lesson_id: str) -> bool:
    """La verdad de la DB, dentro del lock: sigue siendo un taller disponible."""
    cursor = await db.execute(
        "SELECT 1 FROM lessons WHERE id = ? AND kind = ? "
        f"AND {SQL_CUENTA_PARA_PROGRESO}",
        (lesson_id, KIND_TALLER),
    )
    return await cursor.fetchone() is not None


async def marcar_paso(
    db: "aiosqlite.Connection",
    progress: "ProgressRepository",
    lesson_id: str,
    idx: int,
    done: bool,
) -> WorkshopStepUpdateResult:
    """Una unidad de escritura: casilla + ``viewed`` + (quizá) ``completed``.

    Los pasos se releen de la DB DENTRO del lock, no del snapshot en memoria
    (mismo criterio que ``QuizService._ensure_content_current``): si el autor
    añadió, borró o reordenó pasos mientras la petición esperaba, se decide con
    la lista vigente. Así no se completa un taller al que le falta un paso nuevo
    ni se marca un idx que ya es otro paso (``404 STEP_NOT_FOUND``).
    """
    async with database.write_lock:
        try:
            pasos = await workshop_repo.select_steps(db, lesson_id)
            if await content_admin.lesson_kind(db, lesson_id) != KIND_TALLER or all(
                paso.idx != idx for paso in pasos
            ):
                raise ApiException(
                    "STEP_NOT_FOUND", f"La lección {lesson_id} no tiene el paso {idx}"
                )
            await workshop_repo.set_mark_no_commit(db, lesson_id, idx, done)
            marcas = await workshop_repo.select_marks(db, lesson_id)
            completa = (
                done
                and taller_completo(pasos, marcas)
                and await _completable(db, lesson_id)
            )
            await progress.upsert_no_commit(
                lesson_id,
                viewed=True,
                completed=True if completa else None,  # None = no tocar (monótono)
                completed_via=COMPLETED_VIA_TALLER if completa else None,
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        # Dentro del lock: la respuesta es exactamente lo que ESTA unidad dejó.
        record = await progress.get(lesson_id)
    return WorkshopStepUpdateResult(
        lesson_id=lesson_id,
        idx=idx,
        done=idx in marcas,
        steps_done=sum(1 for paso in pasos if paso.idx in marcas),
        steps_total=len(pasos),
        completed=bool(record is not None and record.completed),
    )


__all__ = ["COMPLETED_VIA_TALLER", "taller_completo", "marcar_paso"]
