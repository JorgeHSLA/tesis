"""Tipos del PLAN de actualización de un módulo — Fase 5 (CU-39).

Estos modelos NO son el contrato HTTP: son los tipos del plan puro que produce
``services/module_merge.py`` (``build_plan(local, bundle, opts) -> MergePlan``)
y que consume el aplicador transaccional. Por eso este módulo no importa
FastAPI ni nada de red o DB: el plan se calcula en memoria, se testea sin
levantar nada y —esto es lo importante— **decide el error ANTES de tocar la
base**, donde un fallo todavía es un 4xx limpio y no un rollback a medias.

Fuentes: ``docs/analysis/fase5-catalogo-gcs/algoritmoMerge.md`` §3–§5 (el plan y
el reporte) y ``docs/architecture/api-contract.md`` §11.6 (los endpoints que lo
exponen). El vocabulario de efectos es el de la decisión R3/R4 del plan de
fase: **archivar en vez de huérfanar** y **recalificar en vez de resetear**.

────────────────────────────────────────────────────────────────────────────
PUENTE CON EL CONTRATO CONGELADO (leer antes de tocar nada)
────────────────────────────────────────────────────────────────────────────
``schemas/catalog.py`` transcribe api-contract.md §11.11.1 tal cual, y ese
texto todavía usa el vocabulario ANTERIOR a R3/R4: ``reset``/``orphaned`` en
``ProgressEffect`` y ``keep_progress`` en ``on_removed_lessons``. Aquí se usa el
posterior. No son dos semánticas distintas, es el mismo mecanismo con el nombre
corregido, y la correspondencia es 1:1 —``EFECTO_A_CONTRATO`` y
``POLITICA_DESDE_CONTRATO`` la fijan para que el router traduzca en un sitio y
no en cinco—. Cuando §11.11.1 se enmiende con R3/R4, esas dos tablas se quedan
sin uso y se borran; hasta entonces, el que manda en el cable es ``catalog.py``.

Por qué el nombre cambió, en una línea cada uno:
* ``orphaned`` → ``archived``: con «huérfano» la fila de ``lessons`` desaparecía
  y ``quiz_attempts.lesson_id``/``jobs.lesson_id`` (que no tienen FK) se
  quedaban sin título resoluble — el historial pasaba a decir «lección
  desconocida». Archivar (``lessons.archived_at``) es reversible a coste cero.
* ``reset`` → ``rescored``: una actualización **nunca** baja ``completed``
  (monotonía, P2). Solo recalcula o anula ``best_quiz_score``, que es una caché
  derivada de ``quiz_attempts``. Si actualizar puede empeorarte, nadie actualiza
  y el mecanismo entero muere.
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .admin import ID_PATTERN
from .catalog import CHECKSUM_PATTERN

#: Qué le pasa al avance del estudiante en UNA lección al actualizar (R3/R4).
#:
#: * ``preserved`` — el ``lesson_id`` sigue y la evidencia pasada sigue siendo
#:   interpretable: ``viewed``, ``completed`` y ``best_quiz_score`` intactos.
#: * ``rescored`` — el quiz cambió: ``best_quiz_score`` se recalcula desde
#:   ``quiz_attempts.answers`` con la clave nueva, o se anula si el set de
#:   preguntas ya no permite corregir. ``completed`` NO baja.
#: * ``archived`` — la lección ya no viene en la versión nueva: fila y progreso
#:   se conservan, ``archived_at = now``, fuera de la ruta lineal y de los
#:   denominadores. Reversible si una versión futura reintroduce el id.
#: * ``none`` — lección nueva o sin fila de progreso: no había nada que hacer.
ProgressEffect = Literal["preserved", "rescored", "archived", "none"]

#: Política para las lecciones que desaparecen de la versión nueva.
#: ``archive`` es el DEFAULT y es la promesa de CU-39; ``purge`` borra también
#: ``lesson_progress``/``quiz_attempts`` y hay que pedirlo explícitamente.
OnRemovedLessons = Literal["archive", "purge"]

#: En qué terminó ``update_module``. ``preview`` no escribió absolutamente nada.
UpdateStatus = Literal["preview", "updated", "up_to_date"]

#: Dónde chocó un id que el bundle reclama y otro módulo local ya usa (§11.6.1,
#: ``409 DUPLICATE_ID`` con ``details = [{field, id, owner_module_id}]``).
ConflictField = Literal["lesson_id", "example_id", "question_id"]

#: Traducción del efecto interno al valor que viaja por el cable en
#: ``LessonDiffEntry.progress`` / ``ProgressEffectSummary`` (§11.11.1).
EFECTO_A_CONTRATO: Mapping[str, str] = MappingProxyType(
    {
        "preserved": "preserved",
        "rescored": "reset",
        "archived": "orphaned",
        "none": "none",
    }
)

#: Traducción inversa para ``UpdateRequest.on_removed_lessons`` (§11.6.3).
POLITICA_DESDE_CONTRATO: Mapping[str, str] = MappingProxyType(
    {"keep_progress": "archive", "purge": "purge"}
)


class _Plan(BaseModel):
    """Base de los tipos del plan.

    ``extra="forbid"`` no es aquí defensa contra un tercero —el plan lo
    construimos nosotros— sino contra el error tipográfico silencioso: un
    ``plan.archivadas=[…]`` mal escrito debe reventar en el test, no crear un
    atributo fantasma que nadie lee. Los modelos NO son ``frozen`` porque
    ``build_plan`` los llena por acumulación (``plan.added.append(...)``), que es
    lo que hace legible el algoritmo.
    """

    model_config = ConfigDict(extra="forbid")


# ── El plan (salida de build_plan, entrada de apply_plan) ────────────────────


class MergeConflict(_Plan):
    """Colisión de identidad que ABORTA la actualización antes de escribir.

    algoritmoMerge.md §4.1 paso 1 (D2/D3/D4). Se traduce a ``409 DUPLICATE_ID``
    con ``details = [{field, id, owner_module_id}]``, así que los campos están
    nombrados para copiarse tal cual al envelope de error.
    """

    code: str = Field(min_length=1, max_length=64)
    field: ConflictField
    id: str = Field(min_length=1, max_length=80)
    #: Módulo local que hoy es dueño del id. ``None`` si el choque no es de
    #: pertenencia (p. ej. dos lecciones del mismo bundle piden el mismo order).
    owner_module_id: str | None = None


class MergeWarning(_Plan):
    """Aviso NO bloqueante del plan (se muestra, no detiene).

    El caso que justifica ``related_lesson_id`` es ``POSIBLE_RENOMBRADO``
    (algoritmoMerge.md §4.1 paso 4): una lección archivada y otra añadida con el
    mismo título. Se AVISA, jamás se adivina — transferir el progreso por
    parecido de título sería inventarse el avance del estudiante.
    """

    code: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=400)
    lesson_id: str | None = None
    related_lesson_id: str | None = None


class LessonMove(_Plan):
    """Lección que cambia de módulo entre versiones (D1: re-parenting declarado)."""

    lesson_id: str = Field(pattern=ID_PATTERN)
    from_module_id: str = Field(pattern=ID_PATTERN)


class RecommendedPrune(_Plan):
    """Referencia de ``recommended`` que ya no resuelve y se poda (D7).

    Un enlace «te recomendamos X» apuntando a una lección que no existe es un
    404 en la cara del estudiante; podarlo es preferible a conservarlo.
    """

    lesson_id: str = Field(pattern=ID_PATTERN)
    target_lesson_id: str = Field(max_length=80)


class ProgressOp(_Plan):
    """UPDATE ABSOLUTO sobre ``lesson_progress`` de UNA lección.

    algoritmoMerge.md §4.2. Tres cosas que no son obvias:

    1. Es un SET absoluto, no un merge: ``best_quiz_score`` puede quedar en
       ``None``. Por eso NO puede pasar por ``ProgressRepository.upsert``, cuyo
       SQL aplica ``MAX(best_quiz_score, :nuevo)`` y ``COALESCE`` y es incapaz de
       bajar el valor o de escribir NULL — un 4/4 obsoleto sobreviviría al merge
       y se quedaría pegado para siempre.
    2. ``completed`` es MONÓTONO (P2): se calcula como ``previo or ganado``.
       Una actualización nunca desmarca una lección ya completada.
    3. Sin fila de progreso previa no hay ``ProgressOp``: ``plan_progress``
       devuelve ``None``, no un op vacío. Escribir una fila que no existía
       inventaría avance donde no lo hubo.
    """

    lesson_id: str = Field(pattern=ID_PATTERN)
    effect: ProgressEffect
    #: Observado por el estudiante ⇒ intacto, pase lo que pase con el contenido.
    viewed: bool
    #: Monótono: ``prog.completed or ganado``.
    completed: bool
    completed_via: Literal["quiz", "manual", "run"] | None = None
    #: Recalculado desde ``quiz_attempts.answers`` con la clave NUEVA, o ``None``
    #: si el set de preguntas cambió y la evidencia ya no es interpretable.
    best_quiz_score: int | None = Field(default=None, ge=0)
    last_job_id: str | None = None
    #: Lo que había antes, solo para el reporte («tenías 4/4 sobre 4»).
    previous_best_score: int | None = Field(default=None, ge=0)
    previous_total: int | None = Field(default=None, ge=0)


class MergePlan(_Plan):
    """Plan completo de una instalación o actualización. Función PURA, sin efectos.

    algoritmoMerge.md §4.1. Las lecciones se listan por **id**, no por copia: el
    aplicador ya tiene el bundle validado en la mano, y duplicar el contenido
    aquí solo abre la puerta a que plan y bundle discrepen.

    ``local_order`` va en el plan porque el ``order`` del módulo es LOCAL y una
    actualización JAMÁS lo toca (D5): el estudiante ordenó su curso, no el autor.
    """

    module_id: str = Field(pattern=ID_PATTERN)
    #: ``None`` ⇒ instalación inicial (CU-36), no actualización.
    from_version: int | None = Field(default=None, ge=1)
    to_version: int = Field(ge=1)
    to_checksum: str = Field(pattern=CHECKSUM_PATTERN)
    on_removed_lessons: OnRemovedLessons = "archive"

    #: ``order`` local del módulo, ya resuelto (reasignado si ``order_hint``
    #: colisionaba con el UNIQUE global de ``modules."order"``).
    local_order: int | None = Field(default=None, ge=1)
    order_reassigned: bool = False

    #: Lecciones que nacen en esta versión.
    added: list[str] = Field(default_factory=list)
    #: Lecciones que ya existían y se sobreescriben por UPSERT.
    updated: list[str] = Field(default_factory=list)
    #: Llegaron idénticas: se listan para que el reporte pueda decir «no cambió».
    unchanged: list[str] = Field(default_factory=list)
    #: Subconjunto de ``updated`` cuyo markdown cambió (solo para el reporte).
    revised: list[str] = Field(default_factory=list)
    #: Estaban archivadas de una versión anterior y esta las devuelve (A6).
    restored: list[str] = Field(default_factory=list)
    #: Desaparecen y el estudiante las tocó ⇒ ``archived_at = now`` (A4/P1).
    archived: list[str] = Field(default_factory=list)
    #: Desaparecen y NUNCA fueron tocadas ⇒ borrado limpio (A5).
    removed: list[str] = Field(default_factory=list)
    #: Cambian de módulo (D1).
    moved_in: list[LessonMove] = Field(default_factory=list)

    progress_ops: list[ProgressOp] = Field(default_factory=list)
    pruned_recommended: list[RecommendedPrune] = Field(default_factory=list)
    #: No vacío ⇒ el aplicador NO se ejecuta: se responde 409/422 y no se escribe.
    conflicts: list[MergeConflict] = Field(default_factory=list)
    warnings: list[MergeWarning] = Field(default_factory=list)


# ── El reporte (lo que se muestra antes de aceptar y se guarda después) ──────


class InvalidatedScore(_Plan):
    """Nota que dejó de ser válida porque el quiz cambió bajo ella.

    Se reporta con su total para que la UI pueda escribir «tenías 4/4» en vez de
    un «4» que ya no significa nada: una nota sobre otro denominador es una nota
    imposible (BL-06).
    """

    lesson_id: str = Field(pattern=ID_PATTERN)
    previous_score: int | None = Field(default=None, ge=0)
    previous_total: int = Field(ge=0)


class UpdateLessonsReport(_Plan):
    """Qué pasó con el CONTENIDO. algoritmoMerge.md §5."""

    added: list[str] = Field(default_factory=list)
    updated: list[str] = Field(default_factory=list)
    revised: list[str] = Field(default_factory=list)
    unchanged: list[str] = Field(default_factory=list)
    restored: list[str] = Field(default_factory=list)
    archived: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)
    moved_in: list[str] = Field(default_factory=list)


class UpdateProgressReport(_Plan):
    """Qué pasó con el AVANCE. Es la mitad del reporte que sostiene la promesa.

    ``lost`` existe en el esquema **precisamente para que un test afirme que
    siempre está vacío**: es el canario de CU-39. Si alguna vez se llena, el
    mecanismo dejó de cumplir lo que promete y hay que parar.
    """

    preserved: int = Field(default=0, ge=0)
    rescored: int = Field(default=0, ge=0)
    archived: int = Field(default=0, ge=0)
    unaffected: int = Field(default=0, ge=0)
    completed_kept: int = Field(default=0, ge=0)
    completed_gained: list[str] = Field(default_factory=list)
    scores_invalidated: list[InvalidatedScore] = Field(default_factory=list)
    #: SIEMPRE debe poder ser ``[]`` (P1). Ver docstring.
    lost: list[str] = Field(default_factory=list)


class UpdateReport(_Plan):
    """Resultado de ``update_module``: el mismo objeto para la vista previa y para
    la actualización real.

    algoritmoMerge.md §5. Que preview y ejecución compartan tipo no es economía
    de código: es lo que garantiza que lo que el estudiante ACEPTÓ y lo que
    luego OCURRIÓ se puedan comparar campo a campo. ``status="preview"`` ⇒ no se
    escribió nada; ``status="up_to_date"`` ⇒ el par (versión, checksum) ya era el
    instalado y solo se tocó ``last_checked_at``.
    """

    module_id: str = Field(pattern=ID_PATTERN)
    from_version: int | None = Field(default=None, ge=1)
    to_version: int = Field(ge=1)
    to_checksum: str = Field(pattern=CHECKSUM_PATTERN)
    status: UpdateStatus
    lessons: UpdateLessonsReport = Field(default_factory=UpdateLessonsReport)
    progress: UpdateProgressReport = Field(default_factory=UpdateProgressReport)
    warnings: list[MergeWarning] = Field(default_factory=list)


__all__ = [
    "ProgressEffect",
    "OnRemovedLessons",
    "UpdateStatus",
    "ConflictField",
    "EFECTO_A_CONTRATO",
    "POLITICA_DESDE_CONTRATO",
    "MergeConflict",
    "MergeWarning",
    "LessonMove",
    "RecommendedPrune",
    "ProgressOp",
    "MergePlan",
    "InvalidatedScore",
    "UpdateLessonsReport",
    "UpdateProgressReport",
    "UpdateReport",
]
