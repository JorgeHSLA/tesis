"""Actualizar un módulo instalado SIN perder el progreso — CU-39 (§11.6.2/§11.6.3).

Este módulo es el **aplicador**. El *qué* lo decide ``services/module_merge``
(``build_plan``, función pura); aquí solo se ejecuta ese plan contra SQLite, en
una sola transacción, con el patrón ``_persist`` de ``services/content_writer``:
un ``write()`` sin ``commit``, revalidación del grafo con
``ContentRepository.load`` y **un único** ``commit`` seguido del swap del
snapshot. Si algo falla, no queda ni una sentencia escrita.

El reparto de responsabilidades no es decorativo: separar el plan de su
aplicación es lo que permite que la **vista previa** de §11.6.2 («qué conservo,
qué pierdo») muestre exactamente lo que luego ocurrirá, y que el error se decida
ANTES de tocar la base, donde todavía es un 4xx limpio y no un ``IntegrityError``
a mitad de transacción convertido en 500.

CINCO REGLAS QUE ESTE ARCHIVO NO PUEDE ROMPER
─────────────────────────────────────────────
1. **La red nunca se sostiene con el ``write_lock`` tomado.** Se descarga, se
   valida y se hashea FUERA; solo se entra al lock con el bundle completo en
   memoria. Una descarga interrumpida no llega a escribir nada porque no llega
   a entrar.
2. **Prohibido ``content_admin.delete_lesson``.** Purga ``lesson_progress`` y
   ``quiz_attempts`` por diseño (BL-01): correcto cuando el AUTOR borra en su
   máquina, catastrófico cuando lo dispara la actualización de un estudiante.
   Aquí la lección que desaparece se **archiva** (``archived_at``), y solo se
   borra la que nadie tocó nunca.
3. **Todo por ``UPSERT ON CONFLICT(id)``.** Nunca «borrar y recrear»: el
   ``lesson_id`` es el ancla del progreso y del historial de jobs, y recrear la
   fila con el mismo id sigue siendo, para SQLite, borrar y volver a insertar
   (con su ventana de FK y sus CASCADE).
4. **Los ``order`` se aparcan en dos fases.** SQLite valida el índice único
   ``(module_id, "order") WHERE archived_at IS NULL`` POR SENTENCIA, así que un
   simple intercambio l2↔l3 revienta a mitad de transacción. El ``MAX`` del
   aparcado se toma **GLOBAL**: acotarlo por módulo parece la optimización
   natural y rompe el lote que mueve lecciones entre módulos.
5. **Anular una nota exige el UPDATE absoluto.** ``ProgressRepository.upsert``
   aplica ``MAX(best_quiz_score, :nuevo)`` y ``COALESCE``: es incapaz de bajar
   el valor y de escribir ``NULL``. Se usa
   ``repositories.catalog.rescore_progress_no_commit``, que sí puede — y que
   mantiene ``completed`` monótono, ``viewed`` y ``last_job_id`` intactos.

Y una que se cumple escribiendo, no absteniéndose: **el informe se guarda** en
``module_update_log``, en la misma transacción. Es lo que permite responderle al
estudiante *qué* se conservó en vez de pedirle que confíe.
"""

from __future__ import annotations

import asyncio

import json
import logging
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from ..errors import ApiException
from ..repositories import catalog as repo_catalog
from ..schemas.catalog import BundleLesson, ModuleBundle
from ..schemas.updates import (
    InvalidatedScore,
    MergePlan,
    MergeWarning,
    OnRemovedLessons,
    UpdateLessonsReport,
    UpdateProgressReport,
    UpdateReport,
    UpdateStatus,
)
from .bundle_guard import (
    BundleGuardError,
    cargar_json_sin_duplicados,
    decodificar_estricto,
    parse_bundle,
)
from .catalog_client import (
    CatalogGenerationMismatch,
    CatalogObject,
    CatalogObjectNotFound,
    CatalogObjectTooLarge,
    CatalogUnavailable,
)
from .catalog_hash import BundleHashError, bundle_checksum

# `_persist` y `_example_coherence_issues` son privados de `content_writer` a
# propósito —no son API pública del writer— pero reusarlos es obligatorio: el
# primero es EL patrón de escritura del repo (un commit, revalidación del grafo,
# swap del snapshot) y duplicarlo garantizaría que las dos copias divergieran;
# el segundo es la coherencia threads/GPU de §10.6, que ya existe y que
# `bundle_guard` deja explícitamente al instalador.
from .content_writer import _example_coherence_issues, _persist
from .module_merge import (
    LocalAttempt,
    LocalLesson,
    LocalModuleState,
    LocalProgress,
    LocalQuestion,
    LocalRecommended,
    MergeOptions,
    MergeRechazado,
    build_plan,
    id_pregunta,
    umbral_efectivo,
)
from .youtube import VideoUrlError
from .youtube import normalizar as normalizar_video

if TYPE_CHECKING:  # pragma: no cover
    import aiosqlite
    from fastapi import FastAPI

    from .catalog_client import CatalogReadPort

logger = logging.getLogger("telar.module_updater")


#: Status HTTP de los códigos de §11.3 que todavía no están en
#: ``errors.DEFAULT_STATUS`` (ese archivo pertenece a otro frente). Sin esto,
#: ``ApiException`` los degradaría a 500 y un «módulo no instalado» se leería
#: como una caída del servidor.
ESTADO_HTTP: Mapping[str, int] = {
    "REMOTE_MODULE_NOT_FOUND": 404,
    "MODULE_NOT_INSTALLED": 404,
    "MODULE_ALREADY_INSTALLED": 409,
    "VERSION_CONFLICT": 409,
    "CHECKSUM_MISMATCH": 409,
    "BUNDLE_TOO_LARGE": 413,
    "BUNDLE_INVALID": 422,
    "CATALOG_DISABLED": 503,
    "CATALOG_UNAVAILABLE": 503,
}

#: Aviso NO bloqueante: el módulo se había editado en local desde que se
#: instaló. El contrato congelado (§11.3) no tiene código de error para esto, así
#: que **no se convierte en 409**: se dice en el informe, que es donde el
#: estudiante puede verlo, y se deja pasar. Inventar un código fuera de §11.3
#: rompería el espejo TS; callarlo sería peor.
AVISO_MODIFICADO_EN_LOCAL = "MODULE_LOCALLY_MODIFIED"

#: ``modules.origin`` de todo lo que entra por aquí: viene del bucket.
ORIGEN_REMOTO = "remote"


def _error(code: str, message: str, details: Any = None) -> ApiException:
    """``ApiException`` con el status de §11.3 forzado (ver ``ESTADO_HTTP``)."""
    return ApiException(
        code, message, status_code=ESTADO_HTTP.get(code), details=details
    )


# ═════════════════════════ lectura del estado local ═════════════════════════


def _lista_json(crudo: str | None, que: str) -> list:
    """``json.loads`` tolerante para las columnas JSON de lista de la DB.

    Los ``CHECK json_valid`` de la migración 2 hacen que una columna rota no se
    pueda escribir, así que esto solo se dispara con un archivo SQLite dañado
    —copiado a medias, truncado—. Ahí, degradar a lista vacía es infinitamente
    mejor que un 500: el estudiante pierde un enlace de «te recomendamos», no
    el acceso a su curso.
    """
    try:
        valor = json.loads(crudo)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        logger.warning("columna JSON ilegible en %s; se lee como vacía", que)
        return []
    return valor if isinstance(valor, list) else []


def _respuestas(crudo: str | None) -> dict[str, str] | None:
    """``quiz_attempts.answers`` → mapa id de pregunta → clave elegida.

    Devuelve ``None`` si el intento no es interpretable, y el llamador lo
    **descarta**: contarlo como «0 aciertos» sería peor que ignorarlo, porque
    ``plan_progress`` toma el máximo de las notas y un 0 fabricado podría
    tumbar la nota que el estudiante sí se ganó (``max(notas, default=…)``
    conserva la anterior precisamente cuando no hay evidencia legible).
    """
    if not crudo:
        return None
    try:
        valor = json.loads(crudo)
    except json.JSONDecodeError:
        return None
    if not isinstance(valor, dict):
        return None
    return {
        str(k): v for k, v in valor.items() if isinstance(v, str)
    }


async def read_local_state(
    db: "aiosqlite.Connection", module_id: str
) -> LocalModuleState:
    """Todo lo que ``build_plan`` necesita saber de esta máquina.

    Se lee **dentro** del ``write_lock`` (la llama ``update_module``), porque el
    plan que sale de aquí es el que se va a aplicar: leer fuera abriría la
    ventana para que otra escritura cambiara el suelo bajo el plan.

    Se leen TODAS las lecciones instaladas, no solo las del módulo: una lección
    que este bundle reclama desde otro módulo (re-parenting, D1) necesita su
    estado anterior para poder recalificar su progreso; sin él, un 4/4 obsoleto
    viajaría intacto con ella. Por la misma razón se leen todos los intentos y
    todo el progreso: son datos de UNA máquina de escritorio, y una lectura
    parcial que se deje fuera justo la lección mudada es un bug silencioso.
    """
    modulos = {
        fila["id"]: fila
        for fila in await (await db.execute(
            'SELECT id, "order", origin, version, checksum FROM modules'
        )).fetchall()
    }
    propio = modulos.get(module_id)
    manifiesto = await repo_catalog.get_installed(db, module_id)

    # La versión de referencia para la política de §11.6.3 es la del MANIFIESTO
    # (lo que de verdad se instaló desde el bucket). `modules.version` es su
    # espejo y solo manda cuando no hay manifiesto — un módulo autorado en local
    # sobre el que alguien intenta aplicar un bundle.
    if manifiesto is not None:
        version = manifiesto.installed_version
        checksum = manifiesto.installed_checksum
    elif propio is not None:
        version = propio["version"]
        checksum = propio["checksum"]
    else:
        version = checksum = None

    ejemplos_por_leccion: dict[str, tuple[str, str]] = {}
    duenio_de_ejemplo: dict[str, str] = {}
    for fila in await (await db.execute(
        "SELECT id, lesson_id, source_code FROM examples"
    )).fetchall():
        if fila["lesson_id"] is None:
            # Un ejemplo suelto no tiene módulo dueño, así que no se registra
            # como colisión: adoptarlo por UPSERT no le quita nada a nadie.
            continue
        ejemplos_por_leccion[fila["lesson_id"]] = (fila["id"], fila["source_code"])

    preguntas_por_leccion: dict[str, list[LocalQuestion]] = {}
    duenia_de_pregunta: dict[str, str] = {}
    for fila in await (await db.execute(
        'SELECT id, lesson_id, "order", text, options_json, correct_key, '
        "explanation FROM quiz_questions ORDER BY lesson_id, \"order\""
    )).fetchall():
        opciones = tuple(
            (str(o.get("key")), str(o.get("text")))
            for o in _lista_json(fila["options_json"], f"quiz_questions/{fila['id']}")
            if isinstance(o, dict)
        )
        preguntas_por_leccion.setdefault(fila["lesson_id"], []).append(
            LocalQuestion(
                id=fila["id"],
                order=fila["order"],
                text=fila["text"],
                options=opciones,
                correct_key=fila["correct_key"],
                explanation=fila["explanation"],
            )
        )
        duenia_de_pregunta[fila["id"]] = fila["lesson_id"]

    lecciones: dict[str, LocalLesson] = {}
    for fila in await (await db.execute(
        'SELECT id, module_id, "order", title, estimated_minutes, '
        "content_markdown, video_url, enabled, completion_rule, pass_threshold, "
        "recommended_json, archived_at FROM lessons"
    )).fetchall():
        lid = fila["id"]
        ejemplo = ejemplos_por_leccion.get(lid)
        if ejemplo is not None:
            duenio_de_ejemplo[ejemplo[0]] = fila["module_id"]
        lecciones[lid] = LocalLesson(
            id=lid,
            module_id=fila["module_id"],
            order=fila["order"],
            title=fila["title"],
            estimated_minutes=fila["estimated_minutes"],
            content_markdown=fila["content_markdown"],
            video_url=fila["video_url"],
            enabled=bool(fila["enabled"]),
            completion_rule=fila["completion_rule"],
            pass_threshold=fila["pass_threshold"],
            archived_at=fila["archived_at"],
            recommended=tuple(
                LocalRecommended(
                    lesson_id=str(r.get("lesson_id")),
                    label=str(r.get("label", "")),
                    tag=str(r.get("tag", "")),
                )
                for r in _lista_json(fila["recommended_json"], f"lessons/{lid}")
                if isinstance(r, dict)
            ),
            example_id=None if ejemplo is None else ejemplo[0],
            example_source_code=None if ejemplo is None else ejemplo[1],
            questions=tuple(preguntas_por_leccion.get(lid, ())),
        )

    progreso = {
        fila["lesson_id"]: LocalProgress(
            lesson_id=fila["lesson_id"],
            viewed=bool(fila["viewed"]),
            completed=bool(fila["completed"]),
            best_quiz_score=fila["best_quiz_score"],
            completed_via=fila["completed_via"],
            last_job_id=fila["last_job_id"],
        )
        for fila in await (await db.execute(
            "SELECT lesson_id, viewed, completed, best_quiz_score, "
            "completed_via, last_job_id FROM lesson_progress"
        )).fetchall()
    }

    intentos: dict[str, list[LocalAttempt]] = {}
    #: Lecciones con ALGÚN intento en la base, aunque su `answers` no se pueda leer.
    lecciones_con_intentos: set[str] = set()
    for fila in await (await db.execute(
        "SELECT lesson_id, answers, score, total FROM quiz_attempts "
        "ORDER BY created_at, rowid"
    )).fetchall():
        # `lecciones_con_intentos` se llena SIEMPRE, con respuestas legibles o
        # no. Es lo que decide si una lección «fue tocada» y por tanto si se
        # archiva en vez de borrarse. Antes esa decisión se tomaba sobre el mapa
        # ya filtrado, así que un `answers` ilegible hacía desaparecer el hecho
        # de que el estudiante había intentado el quiz: la lección se borraba
        # limpia y el informe decía `lost=[]`, porque el canario miraba el mismo
        # mapa filtrado que causaba la pérdida. Un vigilante con el mismo punto
        # ciego que aquello que vigila no vigila nada.
        lecciones_con_intentos.add(fila["lesson_id"])
        respuestas = _respuestas(fila["answers"])
        if respuestas is None:
            logger.warning(
                "intento de quiz con answers ilegibles en '%s'; se ignora para "
                "la recalificación, pero la lección SIGUE contando como tocada",
                fila["lesson_id"],
            )
            continue
        intentos.setdefault(fila["lesson_id"], []).append(
            LocalAttempt(answers=respuestas, score=fila["score"], total=fila["total"])
        )

    con_jobs = frozenset(
        fila["lesson_id"]
        for fila in await (await db.execute(
            "SELECT DISTINCT lesson_id FROM jobs WHERE lesson_id IS NOT NULL"
        )).fetchall()
    )

    return LocalModuleState(
        module_id=module_id,
        version=version,
        checksum=checksum,
        order=None if propio is None else propio["order"],
        lessons=lecciones,
        progress=progreso,
        attempts=intentos,
        lesson_ids_con_intentos=frozenset(lecciones_con_intentos),
        lesson_ids_con_jobs=con_jobs,
        module_origin={mid: fila["origin"] for mid, fila in modulos.items()},
        example_owner=duenio_de_ejemplo,
        question_owner=duenia_de_pregunta,
        orders_ocupados=frozenset(
            fila["order"] for mid, fila in modulos.items() if mid != module_id
        ),
    )


# ═══════════════════ validación del bundle contra la config ═════════════════


def validar_bundle(bundle: ModuleBundle, *, max_code_bytes: int) -> None:
    """Lo de §10.6/§11.6.1 que ``bundle_guard`` deja fuera a propósito.

    ``bundle_guard`` valida forma, caracteres, esquema y las reglas que no
    necesitan nada externo. Quedan tres que sí:

    * **Tope de ``source_code``** (BL-17): es ``settings.max_code_bytes``, un
      valor de RUNTIME, para que subir o bajar ``TELAR_MAX_CODE_BYTES`` afecte
      por igual al admin y al bundle.
    * **Coherencia threads/GPU** del ejemplo: ya existe como
      ``content_writer._example_coherence_issues``; se reusa, no se duplica.
    * **Ids de pregunta EFECTIVOS únicos.** ``bundle_guard`` comprueba los ids
      explícitos, pero los omitidos se autogeneran al escribir como
      ``{lesson_id}-q{order}`` (BL-18) y pueden chocar con uno explícito de otra
      lección. Sin esta comprobación, ese choque sería un ``IntegrityError``
      sobre la PK a mitad de transacción, o sea un 500 en vez de un 422.

    Se ejecuta FUERA del ``write_lock``: rechazar aquí cuesta cero escrituras.
    """
    problemas: list[dict] = []
    vistos: dict[str, str] = {}
    for indice, leccion in enumerate(bundle.lessons):
        base = f"lessons[{indice}]"
        if leccion.example is not None:
            bytes_codigo = len(leccion.example.source_code.encode("utf-8"))
            if bytes_codigo > max_code_bytes:
                problemas.append(
                    {
                        "field": f"{base}.example.source_code",
                        "reason": (
                            f"el código ocupa {bytes_codigo} bytes y el máximo "
                            f"es {max_code_bytes}"
                        ),
                    }
                )
            problemas += [
                {**issue, "field": f"{base}.example.{issue['field']}"}
                for issue in _example_coherence_issues(leccion.example)
            ]
        # Coherencia de umbrales, igual que `module_installer`. Sin este
        # chequeo, el MISMO bundle entraba por la puerta de actualizar y no por
        # la de instalar, y `_upsert_lecciones` escribía el umbral EFECTIVO
        # (el más exigente de los dos), que no es ninguno de los que el autor
        # declaró: a partir de ahí el servidor calificaba con un número que no
        # está en el contenido. Elegir por el autor entre dos números que él
        # escribió distintos es exactamente cómo se cuela una nota mal puesta.
        if (
            leccion.quiz is not None
            and leccion.quiz.pass_threshold != leccion.pass_threshold
        ):
            problemas.append(
                {
                    "field": f"{base}.quiz.pass_threshold",
                    "reason": (
                        f"el umbral del quiz ({leccion.quiz.pass_threshold}) no "
                        f"coincide con el de la lección ({leccion.pass_threshold})"
                    ),
                }
            )
        for numero, pregunta in enumerate(leccion.quiz.questions if leccion.quiz else ()):
            qid = id_pregunta(leccion.id, pregunta)
            previa = vistos.get(qid)
            if previa is not None:
                problemas.append(
                    {
                        "field": f"{base}.quiz.questions[{numero}].id",
                        "reason": (
                            f"el id de pregunta {qid!r} ya lo usa {previa} "
                            "(recuerda que un id omitido se autogenera como "
                            "'{lesson_id}-q{order}')"
                        ),
                    }
                )
            else:
                vistos[qid] = f"{base}.quiz.questions[{numero}]"
    if problemas:
        raise _error(
            "CONTENT_VALIDATION_ERROR",
            "El contenido del bundle no cumple las reglas de validación.",
            details=problemas,
        )


def verificar_checksum(
    crudo: bytes, bundle: ModuleBundle, *, esperado: str | None = None
) -> str:
    """sha256 de §11.8.2 sobre el payload DESCARGADO. Devuelve el checksum real.

    Se hashea el ``dict`` recién parseado, **no** el ``ModuleBundle``: el modelo
    materializa los campos opcionales con su default, así que un bundle
    publicado sin ``module.notes`` daría un digest distinto al declarado y el
    módulo parecería corrupto sin serlo. §11.8.2 define el hash sobre el
    payload, y el payload es el documento JSON.

    Se llama DESPUÉS de ``parse_bundle``: con ``extra="forbid"`` ya validado,
    el ``dict`` no puede traer campos de más que entren en el digest.
    """
    try:
        payload = cargar_json_sin_duplicados(decodificar_estricto(crudo))
        real = bundle_checksum(payload)
    except (BundleGuardError, BundleHashError) as exc:  # pragma: no cover
        # Inalcanzable tras `parse_bundle`, que decodifica y parsea los MISMOS
        # bytes; se traduce igualmente para no dejar salir una excepción cruda.
        raise _error("BUNDLE_INVALID", "El bundle no es serializable.") from exc

    if real != bundle.checksum:
        raise _error(
            "CHECKSUM_MISMATCH",
            "El contenido descargado no coincide con su propio checksum.",
            details={"declared": bundle.checksum, "computed": real},
        )
    if esperado is not None and esperado != real:
        raise _error(
            "CHECKSUM_MISMATCH",
            "El módulo publicado cambió desde que lo viste en pantalla.",
            details={"expected": esperado, "computed": real},
        )
    return real


# ══════════════════════════════ el informe ══════════════════════════════════


def build_report(
    plan: MergePlan, local: LocalModuleState, *, status: UpdateStatus
) -> UpdateReport:
    """Traduce el plan a lo que se le enseña al estudiante y se guarda en la bitácora.

    Dos cosas que no son mecánicas:

    * ``plan.updated`` es el conjunto COMPLETO de lecciones que ya existían, y
      ``unchanged``/``revised``/``restored`` son subconjuntos suyos. El plan lo
      quiere así para que el aplicador haga UPSERT de todo y una clasificación
      imprecisa no pueda perder contenido. El informe, en cambio, se lee como
      una partición (``LessonChange`` del contrato es disjunto), así que aquí sí
      se resta: ``updated = updated - unchanged``.
    * ``lost`` se calcula, **no se asume vacío**. Es el canario de CU-39: sale
      no vacío solo cuando el estudiante pidió ``purge`` explícitamente, y el
      test que lo afirma es la promesa entera del caso de uso.
    """
    sin_cambios = set(plan.unchanged)
    lecciones = UpdateLessonsReport(
        added=list(plan.added),
        updated=[lid for lid in plan.updated if lid not in sin_cambios],
        revised=list(plan.revised),
        unchanged=list(plan.unchanged),
        restored=list(plan.restored),
        archived=list(plan.archived),
        removed=list(plan.removed),
        moved_in=[mov.lesson_id for mov in plan.moved_in],
    )

    completadas_antes = {
        lid for lid, prog in local.progress.items() if prog.completed
    }
    conteo = {"preserved": 0, "rescored": 0, "archived": 0, "none": 0}
    completadas_que_siguen = 0
    ganadas: list[str] = []
    invalidadas: list[InvalidatedScore] = []
    for op in plan.progress_ops:
        conteo[op.effect] = conteo.get(op.effect, 0) + 1
        if op.completed:
            if op.lesson_id in completadas_antes:
                completadas_que_siguen += 1
            else:
                ganadas.append(op.lesson_id)
        if op.best_quiz_score is None and op.previous_best_score is not None:
            invalidadas.append(
                InvalidatedScore(
                    lesson_id=op.lesson_id,
                    previous_score=op.previous_best_score,
                    previous_total=op.previous_total or 0,
                )
            )

    con_operacion = {op.lesson_id for op in plan.progress_ops}
    consideradas = (
        set(plan.added) | set(plan.updated) | set(plan.archived) | set(plan.removed)
    )
    # Se borra la fila de la lección: solo pierde avance quien lo tenía. Con la
    # política `archive` esto es demostrablemente [] —`removed` solo recibe
    # lecciones que nadie tocó— y por eso se CALCULA en vez de darse por hecho.
    perdidas = [
        lid
        for lid in plan.removed
        if lid in local.progress
        or local.attempts.get(lid)
        or lid in local.lesson_ids_con_jobs
    ]

    return UpdateReport(
        module_id=plan.module_id,
        from_version=plan.from_version,
        to_version=plan.to_version,
        to_checksum=plan.to_checksum,
        status=status,
        lessons=lecciones,
        progress=UpdateProgressReport(
            preserved=conteo["preserved"],
            rescored=conteo["rescored"],
            archived=conteo["archived"],
            unaffected=len(consideradas - con_operacion),
            completed_kept=completadas_que_siguen,
            completed_gained=ganadas,
            scores_invalidated=invalidadas,
            lost=perdidas,
        ),
        warnings=list(plan.warnings),
    )


# ═════════════════════════════ SQL del aplicador ════════════════════════════

_UPSERT_MODULE = """
INSERT INTO modules
    (id, "order", title, description, level, version, checksum, origin, published_at)
VALUES (:id, :order, :title, :description, :level, :version, :checksum,
        :origin, :published_at)
ON CONFLICT(id) DO UPDATE SET
    "order"      = :order,
    title        = :title,
    description  = :description,
    level        = :level,
    version      = :version,
    checksum     = :checksum,
    origin       = :origin,
    published_at = :published_at
"""

# `archived_at = NULL` en las dos ramas: una versión nueva que reintroduce un
# `lesson_id` archivado lo devuelve a la vida CON su progreso (A6), que es la
# contrapartida de que archivar no destruya nada.
_UPSERT_LESSON = """
INSERT INTO lessons
    (id, module_id, "order", title, estimated_minutes, content_markdown,
     video_url, pass_threshold, recommended_json, enabled, completion_rule,
     archived_at)
VALUES (:id, :module_id, :order, :title, :estimated_minutes, :content_markdown,
        :video_url, :pass_threshold, :recommended_json, :enabled,
        :completion_rule, NULL)
ON CONFLICT(id) DO UPDATE SET
    module_id         = :module_id,
    "order"           = :order,
    title             = :title,
    estimated_minutes = :estimated_minutes,
    content_markdown  = :content_markdown,
    video_url         = :video_url,
    pass_threshold    = :pass_threshold,
    recommended_json  = :recommended_json,
    enabled           = :enabled,
    completion_rule   = :completion_rule,
    archived_at       = NULL
"""

_UPSERT_EXAMPLE = """
INSERT INTO examples
    (id, lesson_id, filename, title, difficulty, teaches, directives_json,
     threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
     self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
     requires_gpu, expected_output_note, takeaways_json, source_code)
VALUES (:id, :lesson_id, :filename, :title, :difficulty, :teaches,
        :directives_json, :threads_configurable, :fixed_threads,
        :fixed_threads_note, :sweeps_threads, :self_measures, :parser_id,
        :default_timeout_s, :est_run_seconds, :enabled, :requires_gpu,
        :expected_output_note, :takeaways_json, :source_code)
ON CONFLICT(id) DO UPDATE SET
    lesson_id            = :lesson_id,
    filename             = :filename,
    title                = :title,
    difficulty           = :difficulty,
    teaches              = :teaches,
    directives_json      = :directives_json,
    threads_configurable = :threads_configurable,
    fixed_threads        = :fixed_threads,
    fixed_threads_note   = :fixed_threads_note,
    sweeps_threads       = :sweeps_threads,
    self_measures        = :self_measures,
    parser_id            = :parser_id,
    default_timeout_s    = :default_timeout_s,
    est_run_seconds      = :est_run_seconds,
    enabled              = :enabled,
    requires_gpu         = :requires_gpu,
    expected_output_note = :expected_output_note,
    takeaways_json       = :takeaways_json,
    source_code          = :source_code
"""

_INSERT_QUESTION = """
INSERT INTO quiz_questions
    (id, lesson_id, "order", text, options_json, correct_key, explanation)
VALUES (:id, :lesson_id, :order, :text, :options_json, :correct_key, :explanation)
"""

_ARCHIVAR = (
    "UPDATE lessons "
    "SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') "
    "WHERE id = ? AND archived_at IS NULL"
)


def _dumps(valor: Any) -> str:
    """JSON compacto preservando unicode, igual que ``content_admin._dumps``."""
    return json.dumps(valor, ensure_ascii=False)


def _video_canonico(leccion: BundleLesson) -> str | None:
    """URL de video en la forma que se GUARDA (id extraído y URL reconstruida).

    ``bundle_guard`` valida el video pero NO lo normaliza a propósito: cambiar
    bytes antes de verificar el checksum invalidaría el hash de §11.8.2. La
    normalización es de aquí, después de que el hash ya cuadró. Y tiene que
    ocurrir: ``module_merge`` compara la URL canónica contra la guardada, así que
    escribir la cruda haría que un bundle idéntico pareciera cambiado en cada
    actualización.
    """
    try:
        return normalizar_video(leccion.video_url)
    except VideoUrlError as exc:  # pragma: no cover - `bundle_guard` ya lo filtra
        raise _error(
            "CONTENT_VALIDATION_ERROR",
            "El contenido del bundle no cumple las reglas de validación.",
            details=[{"field": f"lessons[{leccion.id}].video_url", "reason": str(exc)}],
        ) from exc


# ═══════════════════════════════ el aplicador ═══════════════════════════════


async def apply_plan(
    db: "aiosqlite.Connection",
    plan: MergePlan,
    bundle: ModuleBundle,
    local: LocalModuleState,
    *,
    object_path: str,
    available_version: int | None = None,
    available_checksum: str | None = None,
    last_checked_at: str | None = None,
) -> UpdateReport:
    """Ejecuta el plan contra SQLite. **Sin ``commit`` y sin tomar el lock.**

    Es una pieza de una unidad compuesta: quien la llama ya sostiene
    ``app.state.write_lock`` y cierra con el ``commit`` único de ``_persist``.
    Así, si la revalidación del grafo falla, el ``rollback`` se lleva por delante
    la actualización entera y la máquina queda exactamente como estaba.

    El orden de las siete fases no es arbitrario; cada una libera el terreno
    para la siguiente:

    1. **módulo** — tiene que existir antes que sus lecciones (FK) y antes que
       el manifiesto (FK).
    2. **archivar** las retiradas: ``archived_at`` las saca del índice único
       parcial y libera su ``(module_id, "order")`` sin tocar su ``order``, que
       se conserva como parte del registro.
    3. **borrar** las retiradas que nadie tocó (y solo con ``purge``, su avance).
    4. **aparcar** los ``order`` de las supervivientes por encima del MAX global.
    5. **UPSERT** de lecciones, ejemplos y quizzes con sus valores finales.
    6. **recalificar** el progreso con el UPDATE absoluto.
    7. **manifiesto + bitácora**, en la misma transacción que el contenido.

    ``available_version``/``available_checksum`` en ``None`` significan «no se
    conoce nada más nuevo»: se anota lo recién instalado y el chip de
    actualización se apaga. Un llamador que sepa que el índice ya publica una
    versión posterior (se actualizó a la v3 teniendo la v5 delante) los pasa.
    """
    if plan.conflicts:
        # Programación, no entrada: con conflictos el aplicador no debe arrancar.
        raise ValueError(
            "apply_plan recibió un plan con conflictos; el llamador debe "
            "traducirlos a 409 DUPLICATE_ID y no escribir nada"
        )

    entrantes = {leccion.id: leccion for leccion in bundle.lessons}

    await _upsert_modulo(db, plan, bundle)
    await _archivar(db, plan.archived)
    await _borrar(db, plan)
    await _aparcar_orders(db, plan, entrantes)
    await _upsert_lecciones(db, plan, entrantes)
    await _reemplazar_ejemplos(db, entrantes)
    await _reemplazar_quizzes(db, entrantes)
    await _recalificar(db, plan)

    report = build_report(plan, local, status="updated")

    await repo_catalog.upsert_installed_no_commit(
        db,
        module_id=plan.module_id,
        object_path=object_path,
        installed_version=plan.to_version,
        installed_checksum=plan.to_checksum,
        available_version=(
            plan.to_version if available_version is None else available_version
        ),
        available_checksum=(
            plan.to_checksum if available_checksum is None else available_checksum
        ),
        # Tras aplicar el bundle el módulo local vuelve a ser el remoto: la
        # marca de «editado aquí» deja de ser cierta y se limpia.
        locally_modified=False,
        last_checked_at=last_checked_at,
    )
    await repo_catalog.log_update_no_commit(
        db,
        module_id=plan.module_id,
        from_version=plan.from_version,
        to_version=plan.to_version,
        report=report.model_dump(mode="json"),
    )
    return report


async def _upsert_modulo(
    db: "aiosqlite.Connection", plan: MergePlan, bundle: ModuleBundle
) -> None:
    """La cabecera del módulo. ``"order"`` sale del PLAN, nunca del bundle.

    ``modules."order"`` es UNIQUE **global** y pertenece al estudiante: en una
    actualización no se toca (D5) y en una instalación el ``order_hint`` del
    autor es solo una sugerencia que el plan ya reasignó si estaba tomada.
    """
    modulo = bundle.module
    await db.execute(
        _UPSERT_MODULE,
        {
            "id": modulo.id,
            "order": plan.local_order if plan.local_order else modulo.order_hint,
            "title": modulo.title,
            "description": modulo.description,
            "level": modulo.level,
            "version": modulo.version,
            "checksum": plan.to_checksum,
            "origin": ORIGEN_REMOTO,
            "published_at": modulo.published_at,
        },
    )


async def _archivar(db: "aiosqlite.Connection", lesson_ids: list[str]) -> None:
    """``archived_at = now`` para las lecciones retiradas con avance (A4/P1).

    NO se borra la fila: ``lesson_progress`` y ``quiz_attempts`` no tienen FK a
    ``lessons`` (a propósito, §8.3), y ``jobs.lesson_id`` tampoco, así que borrar
    dejaría el historial mostrando «lección desconocida». Archivada = legible por
    URL, fuera de la ruta lineal, con su avance intacto.

    ``AND archived_at IS NULL`` conserva la fecha del primer archivado: volver a
    sellarla en cada actualización convertiría «desde cuándo se retiró» en «la
    última vez que actualicé».
    """
    for lesson_id in lesson_ids:
        await db.execute(_ARCHIVAR, (lesson_id,))


async def _borrar(db: "aiosqlite.Connection", plan: MergePlan) -> None:
    """Las retiradas que se borran, y —SOLO con ``purge``— su avance.

    Con la política por defecto (``archive``) ``plan.removed`` solo contiene
    lecciones que nadie tocó jamás, así que los dos DELETE de estado serían
    no-ops; aun así están detrás del ``if``, porque ese ``if`` es la única
    barrera entre «actualizar» y «perder lo que hiciste». Que el borrado del
    avance sea inalcanzable salvo petición explícita tiene que verse en el
    código, no deducirse de una invariante de otro módulo.
    """
    if plan.on_removed_lessons == "purge":
        for lesson_id in plan.removed:
            await db.execute(
                "DELETE FROM lesson_progress WHERE lesson_id = ?", (lesson_id,)
            )
            await db.execute(
                "DELETE FROM quiz_attempts WHERE lesson_id = ?", (lesson_id,)
            )
    for lesson_id in plan.removed:
        # CASCADE se lleva ejemplo y preguntas de la lección.
        await db.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))


async def _aparcar_orders(
    db: "aiosqlite.Connection",
    plan: MergePlan,
    entrantes: Mapping[str, BundleLesson],
) -> None:
    """Fase 1 del reorden: sube TODAS las filas tocadas por encima del MAX global.

    El índice ``UNIQUE (module_id, "order") WHERE archived_at IS NULL`` se
    verifica **por sentencia**, no al final de la transacción: un intercambio
    l2↔l3 revienta con ``IntegrityError`` en el primer UPDATE. Se estacionan
    primero en valores positivos, únicos entre sí y por encima de cualquier
    ``order`` actual o final, y solo después se fija el definitivo (fase 2, en
    ``_upsert_lecciones``). Es el mismo truco de ``content_admin._reorder``.

    El ``MAX`` se toma **GLOBAL**, sobre toda la tabla. Acotarlo al módulo
    parece la optimización natural y rompe exactamente el caso que esta fase
    existe para sostener: un lote que mueve lecciones ENTRE módulos, donde una
    fila estacionada en el módulo de origen chocaría con otra ya colocada en su
    destino.
    """
    tocadas = [lid for lid in plan.updated if lid in entrantes]
    if not tocadas:
        return
    cursor = await db.execute('SELECT COALESCE(MAX("order"), 0) AS m FROM lessons')
    fila = await cursor.fetchone()
    maximo = int(fila["m"]) if fila is not None else 0
    finales = [leccion.order for leccion in entrantes.values()]
    base = max(maximo, max(finales, default=0)) + 1
    for desplazamiento, lesson_id in enumerate(tocadas):
        await db.execute(
            'UPDATE lessons SET "order" = ? WHERE id = ?',
            (base + desplazamiento, lesson_id),
        )


async def _upsert_lecciones(
    db: "aiosqlite.Connection",
    plan: MergePlan,
    entrantes: Mapping[str, BundleLesson],
) -> None:
    """Fase 2 del reorden y contenido de la lección, todo por ``ON CONFLICT(id)``.

    ``pass_threshold`` se escribe como el **umbral efectivo**
    (``max(lesson, quiz)``): la DB guarda un solo umbral, ``lessons
    .pass_threshold``, que es el que lee ``QuizService``, mientras el bundle
    declara dos. Escribir aquí el mismo que usó el plan para decidir el
    ``completed`` es lo que hace que la vista previa no mienta.
    """
    for leccion in entrantes.values():
        await db.execute(
            _UPSERT_LESSON,
            {
                "id": leccion.id,
                "module_id": plan.module_id,
                "order": leccion.order,
                "title": leccion.title,
                "estimated_minutes": leccion.estimated_minutes,
                "content_markdown": leccion.content_markdown,
                "video_url": _video_canonico(leccion),
                "pass_threshold": umbral_efectivo(leccion),
                "recommended_json": _dumps(
                    [
                        {"lesson_id": r.lesson_id, "label": r.label, "tag": r.tag}
                        for r in leccion.recommended
                    ]
                ),
                "enabled": int(leccion.enabled),
                "completion_rule": leccion.completion_rule,
            },
        )


async def _reemplazar_ejemplos(
    db: "aiosqlite.Connection", entrantes: Mapping[str, BundleLesson]
) -> None:
    """El ejemplo de cada lección entrante, en dos pasadas.

    ``examples.lesson_id`` es ``UNIQUE``: si el ejemplo de una lección cambia de
    id, o si un id de ejemplo se muda de una lección a otra dentro del mismo
    módulo, hacer «suelta e inserta» lección a lección chocaría con el ejemplo
    que la otra todavía no ha soltado. Por eso primero se sueltan TODOS los que
    dejan de valer y solo después se escriben los nuevos.

    Una lección que deja de traer ejemplo se queda **conceptual** (E1), que es
    exactamente lo que la migración 5 hizo representable.
    """
    for lesson_id, leccion in entrantes.items():
        nuevo = leccion.example.id if leccion.example is not None else None
        await db.execute(
            "DELETE FROM examples "
            "WHERE lesson_id = :lesson_id AND (:nuevo IS NULL OR id <> :nuevo)",
            {"lesson_id": lesson_id, "nuevo": nuevo},
        )
    for lesson_id, leccion in entrantes.items():
        ejemplo = leccion.example
        if ejemplo is None:
            continue
        await db.execute(
            _UPSERT_EXAMPLE,
            {
                "id": ejemplo.id,
                "lesson_id": lesson_id,
                "filename": ejemplo.filename,
                "title": ejemplo.title,
                "difficulty": ejemplo.difficulty,
                "teaches": ejemplo.teaches,
                "directives_json": _dumps(list(ejemplo.directives)),
                "threads_configurable": int(ejemplo.threads_configurable),
                "fixed_threads": ejemplo.fixed_threads,
                "fixed_threads_note": ejemplo.fixed_threads_note,
                "sweeps_threads": int(ejemplo.sweeps_threads),
                "self_measures": int(ejemplo.self_measures),
                "parser_id": ejemplo.parser_id,
                "default_timeout_s": ejemplo.default_timeout_s,
                "est_run_seconds": ejemplo.est_run_seconds,
                "enabled": int(ejemplo.enabled),
                "requires_gpu": int(ejemplo.requires_gpu),
                "expected_output_note": ejemplo.expected_output_note,
                "takeaways_json": _dumps(list(ejemplo.takeaways)),
                "source_code": ejemplo.source_code,
            },
        )


async def _reemplazar_quizzes(
    db: "aiosqlite.Connection", entrantes: Mapping[str, BundleLesson]
) -> None:
    """Reemplazo total del set de preguntas de cada lección entrante.

    También en dos pasadas, y por el mismo motivo que los ejemplos:
    ``quiz_questions.id`` es PK **global**, así que borrar todas las preguntas
    afectadas antes de insertar ninguna evita chocar con una que otra lección
    del mismo bundle aún no ha soltado.

    Borrar y reinsertar preguntas **no** toca ``quiz_attempts``: los intentos no
    tienen FK a ``quiz_questions`` y guardan las respuestas por id, que es lo que
    permite recalificarlos con la clave nueva en vez de pedirle al estudiante que
    repita el quiz.
    """
    for lesson_id in entrantes:
        await db.execute(
            "DELETE FROM quiz_questions WHERE lesson_id = ?", (lesson_id,)
        )
    for lesson_id, leccion in entrantes.items():
        if leccion.quiz is None:
            continue
        for pregunta in leccion.quiz.questions:
            await db.execute(
                _INSERT_QUESTION,
                {
                    "id": id_pregunta(lesson_id, pregunta),
                    "lesson_id": lesson_id,
                    "order": pregunta.order,
                    "text": pregunta.text,
                    "options_json": _dumps(
                        [{"key": o.key, "text": o.text} for o in pregunta.options]
                    ),
                    "correct_key": pregunta.correct_key,
                    "explanation": pregunta.explanation,
                },
            )


async def _recalificar(db: "aiosqlite.Connection", plan: MergePlan) -> None:
    """Aplica los ``ProgressOp`` con el UPDATE **absoluto**, nunca con el upsert.

    ``ProgressRepository.upsert`` aplica ``MAX(best_quiz_score, :nuevo)`` y
    ``COALESCE``: no puede bajar la nota ni escribir ``NULL``, así que un 4/4
    obsoleto sobre un quiz que ya no existe se quedaría pegado para siempre y en
    silencio. ``rescore_progress_no_commit`` sí puede, y mantiene lo que no se
    negocia: ``completed`` monótono (``MAX``), ``viewed`` y ``last_job_id``
    intactos, y ningún ``INSERT`` — una lección sin avance no lo estrena aquí.
    """
    for op in plan.progress_ops:
        await repo_catalog.rescore_progress_no_commit(
            db,
            op.lesson_id,
            best_quiz_score=op.best_quiz_score,
            completed=op.completed,
            completed_via=op.completed_via,
        )


# ══════════════════════════ el caso de uso completo ═════════════════════════


async def update_module(
    app: "FastAPI",
    module_id: str,
    *,
    to_version: int | None = None,
    expected_checksum: str | None = None,
    on_removed_lessons: OnRemovedLessons = "archive",
    generation: int | None = None,
    preview: bool = False,
    allow_downgrade: bool = False,
    catalog: "CatalogReadPort | None" = None,
) -> UpdateReport:
    """CU-39: trae la versión nueva de un módulo instalado y la aplica.

    Con ``preview=True`` es §11.6.2: descarga, valida y **calcula el mismo
    plan**, pero no escribe una sola sentencia. Que preview y ejecución
    compartan camino y tipo de resultado no es economía de código, es lo que
    garantiza que lo que el estudiante ACEPTÓ y lo que luego OCURRIÓ se puedan
    comparar campo a campo.

    Estructura, y el orden importa:

    * **Fuera del lock** todo lo que puede fallar y todo lo que toca la red:
      manifiesto, descarga, ``parse_bundle``, checksum, reglas de contenido.
      Sostener el ``write_lock`` durante una descarga bloquearía cada
      ``finish()`` de job y cada intento de quiz durante lo que tarde una red
      mala; y si la descarga se corta a la mitad, aquí todavía no se ha escrito
      nada porque aún no se ha entrado.
    * **Dentro del lock** solo memoria y SQLite: releer el estado, construir el
      plan y aplicarlo con un único ``commit``.
    """
    settings = app.state.settings
    db = app.state.db

    if not settings.catalog_enabled:
        raise _error(
            "CATALOG_DISABLED",
            "Este despliegue no tiene catálogo remoto configurado.",
        )
    puerto = catalog if catalog is not None else getattr(app.state, "catalog", None)
    if puerto is None:  # pragma: no cover - error de cableado del lifespan
        raise _error(
            "CATALOG_UNAVAILABLE",
            "El catálogo remoto no está disponible.",
            details={"reason": "server", "retry_after_s": None},
        )

    manifiesto = await repo_catalog.get_installed(db, module_id)
    if manifiesto is None:
        raise _error(
            "MODULE_NOT_INSTALLED",
            f"El módulo '{module_id}' no está incorporado a tu curso.",
        )

    destino = to_version or manifiesto.available_version or manifiesto.installed_version
    objeto = await _descargar(
        puerto,
        module_id,
        destino,
        max_bytes=int(settings.catalog_max_bundle_bytes),
        generation=generation,
    )
    bundle = await _parsear(
        objeto.data, max_bytes=int(settings.catalog_max_bundle_bytes)
    )
    _verificar_identidad(bundle, module_id, destino)
    checksum = verificar_checksum(objeto.data, bundle, esperado=expected_checksum)
    validar_bundle(bundle, max_code_bytes=int(settings.max_code_bytes))

    avisos: list[MergeWarning] = []
    if manifiesto.locally_modified:
        # El contrato congelado no tiene código de error para esto (§11.3), así
        # que no se convierte en 409: se dice, se aplica y se deja constancia en
        # la bitácora. Callarlo sería peor que decirlo sin bloquear.
        avisos.append(
            MergeWarning(
                code=AVISO_MODIFICADO_EN_LOCAL,
                message=(
                    "Este módulo se había editado en esta máquina; la versión "
                    f"{destino} del catálogo reemplaza esos cambios."
                ),
            )
        )

    # Ya no queda nada que dependa de la red: a partir de aquí, memoria y SQLite.
    async with app.state.write_lock:
        vigente = await repo_catalog.get_installed(db, module_id)
        if vigente is None:  # pragma: no cover - desinstalado mientras se bajaba
            raise _error(
                "MODULE_NOT_INSTALLED",
                f"El módulo '{module_id}' dejó de estar incorporado.",
            )

        disponible = _disponible(vigente, bundle.module.version, checksum)

        if (
            bundle.module.version == vigente.installed_version
            and checksum == vigente.installed_checksum
        ):
            # Mismo par (versión, checksum) ⇒ el contenido ya es EXACTAMENTE
            # este. Reaplicarlo sería un no-op caro que además pisaría lo que el
            # admin hubiera editado en local. Solo se anota que se miró.
            return await _anotar_sin_cambios(
                app, module_id, vigente, disponible, avisos, preview=preview
            )

        local = await read_local_state(db, module_id)
        try:
            plan = build_plan(
                local,
                bundle,
                MergeOptions(
                    on_removed_lessons=on_removed_lessons,
                    allow_downgrade=allow_downgrade,
                ),
            )
        except MergeRechazado as exc:
            raise _error(
                exc.code, str(exc), details={"reason": exc.motivo}
            ) from exc

        if plan.conflicts:
            raise _error(
                "DUPLICATE_ID",
                "El módulo usa identificadores que ya pertenecen a otro módulo "
                "instalado.",
                details=[conflicto.model_dump() for conflicto in plan.conflicts],
            )
        plan.warnings[:0] = avisos

        if preview:
            # §11.6.2: ni una sentencia. El plan ya está construido sobre el
            # estado que el lock mantiene quieto, así que el informe describe lo
            # que pasaría si se aceptara ahora mismo.
            return build_report(plan, local, status="preview")

        recogido: list[UpdateReport] = []

        async def _escribir() -> None:
            recogido.append(
                await apply_plan(
                    db,
                    plan,
                    bundle,
                    local,
                    object_path=objeto.object_path,
                    available_version=disponible[0],
                    available_checksum=disponible[1],
                    last_checked_at=_ahora_iso(),
                )
            )

        await _persist(app, _escribir)
        return recogido[0]


def _disponible(
    manifiesto: repo_catalog.InstalledModuleRecord, version: int, checksum: str
) -> tuple[int, str | None]:
    """Qué queda en ``available_*`` después de aplicar la versión ``version``.

    Normalmente, lo recién instalado: no se conoce nada más nuevo y el chip de
    «hay actualización» se apaga. Pero si el último refresco del índice vio una
    versión POSTERIOR —el estudiante pidió la v3 teniendo la v5 delante— esa
    sigue estando publicada, y machacarla apagaría el chip de un módulo que sí
    tiene actualización pendiente. ``available_*`` es lo que vio el índice, no
    lo que se acaba de instalar.
    """
    if (
        manifiesto.available_version is not None
        and manifiesto.available_version > version
    ):
        return manifiesto.available_version, manifiesto.available_checksum
    return version, checksum


async def _anotar_sin_cambios(
    app: "FastAPI",
    module_id: str,
    manifiesto: repo_catalog.InstalledModuleRecord,
    disponible: tuple[int, str | None],
    avisos: list[MergeWarning],
    *,
    preview: bool,
) -> UpdateReport:
    """``status="up_to_date"``: solo se refresca la marca de «cuándo se miró».

    ``last_checked_at`` y ``updated_at`` son dos fechas distintas en §11.4.1 y
    confundirlas mentiría al estudiante («actualizado hoy» cuando lo único que
    pasó es que se comprobó el bucket). Por eso se usa ``set_available_no_commit``,
    que a propósito no toca ``updated_at``.
    """
    report = UpdateReport(
        module_id=module_id,
        from_version=manifiesto.installed_version,
        to_version=manifiesto.installed_version,
        to_checksum=manifiesto.installed_checksum,
        status="preview" if preview else "up_to_date",
        warnings=avisos,
    )
    if preview:
        return report

    async def _escribir() -> None:
        await repo_catalog.set_available_no_commit(
            app.state.db,
            module_id,
            available_version=disponible[0],
            available_checksum=disponible[1],
            checked_at=_ahora_iso(),
        )

    await _persist(app, _escribir)
    return report


def _ahora_iso() -> str:
    """Marca de tiempo en el MISMO formato que los defaults del schema.

    ``strftime('%Y-%m-%dT%H:%M:%fZ','now')`` de SQLite da milisegundos; aquí se
    replica exactamente para que las fechas escritas desde Python y las escritas
    por la DB se ordenen entre sí como texto, que es como se comparan.
    """
    ahora = datetime.now(timezone.utc)
    return f"{ahora:%Y-%m-%dT%H:%M:%S}.{ahora.microsecond // 1000:03d}Z"


async def _descargar(
    puerto: "CatalogReadPort",
    module_id: str,
    version: int,
    *,
    max_bytes: int,
    generation: int | None,
) -> CatalogObject:
    """Descarga el bundle traduciendo el puerto a los códigos de §11.3.

    Ninguna excepción del transporte sale de aquí: el texto crudo de un error de
    red nunca debe acabar en el cuerpo de una respuesta (mismo criterio que
    ``jobs.error_detail``), y confundir «este módulo no existe» con «el catálogo
    está caído» le diría al estudiante que se quede esperando a que vuelva algo
    que nunca estuvo.
    """
    try:
        return await puerto.fetch_module(
            module_id, version, max_bytes=max_bytes, generation=generation
        )
    except CatalogObjectNotFound as exc:
        raise _error(
            "REMOTE_MODULE_NOT_FOUND",
            f"El catálogo no publica la versión {version} del módulo "
            f"'{module_id}'.",
        ) from exc
    except CatalogObjectTooLarge as exc:
        raise _error(
            "BUNDLE_TOO_LARGE",
            f"El módulo supera el máximo de {max_bytes} bytes.",
        ) from exc
    except CatalogGenerationMismatch as exc:
        raise _error(
            "CHECKSUM_MISMATCH",
            "El módulo publicado cambió mientras se descargaba.",
        ) from exc
    except CatalogUnavailable as exc:
        logger.warning(
            "catálogo no disponible al bajar %s v%s: %s",
            module_id,
            version,
            exc.causa or exc.reason,
        )
        raise _error(
            "CATALOG_UNAVAILABLE",
            "No se pudo contactar con el catálogo remoto.",
            details=exc.details,
        ) from exc


async def _parsear(crudo: bytes, *, max_bytes: int) -> ModuleBundle:
    """``bundle_guard.parse_bundle`` con sus errores tipados ya traducidos.

    El parseo de un bundle es trabajo de CPU (decodificar, recorrer texto,
    validar markdown de hasta 64 KiB por lección). Hacerlo en la corrutina deja el
    event loop parado para TODOS: sin latido de WebSocket, sin /health, sin los
    jobs de los demás estudiantes. Va a un hilo.
    """
    try:
        return await asyncio.to_thread(parse_bundle, crudo, max_bytes=max_bytes)
    except BundleGuardError as exc:
        raise ApiException(
            exc.code,
            exc.message,
            status_code=exc.status_code,
            details=exc.details,
        ) from exc


def _verificar_identidad(
    bundle: ModuleBundle, module_id: str, version: int
) -> None:
    """El bundle tiene que decir lo que su RUTA prometía (§11.6.1, paso 1).

    La ruta se deriva de ``(module_id, version)`` ya validados y jamás del
    ``object_path`` del índice, así que lo peor que puede hacer un bucket
    mentiroso es servir en ``modulos/m9/v3.json`` un módulo que dice ser otro.
    Sin esta comprobación, ese contenido se instalaría bajo el id que el
    estudiante pidió, y el checksum cuadraría —porque es el checksum del
    impostor—.
    """
    problemas = []
    if bundle.module.id != module_id:
        problemas.append(
            {
                "field": "module.id",
                "reason": (
                    f"el objeto de '{module_id}' declara ser el módulo "
                    f"'{bundle.module.id}'"
                ),
            }
        )
    if bundle.module.version != version:
        problemas.append(
            {
                "field": "module.version",
                "reason": (
                    f"el objeto de la versión {version} declara ser la "
                    f"{bundle.module.version}"
                ),
            }
        )
    if problemas:
        raise _error(
            "BUNDLE_INVALID",
            "El módulo publicado no coincide con la ruta desde la que se pidió.",
            details=problemas,
        )


__all__ = [
    "ESTADO_HTTP",
    "AVISO_MODIFICADO_EN_LOCAL",
    "ORIGEN_REMOTO",
    "read_local_state",
    "validar_bundle",
    "verificar_checksum",
    "build_report",
    "apply_plan",
    "update_module",
]
