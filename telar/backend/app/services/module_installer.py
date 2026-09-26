"""Incorporación de un módulo del catálogo remoto — CU-36, api-contract §11.6.1.

El estudiante elige un módulo del bucket y esta unidad lo baja, lo somete al
mismo rigor que el ``.py`` que él mismo escribe, y lo importa a las tablas de
contenido **sin perder nada de lo que ya tenía**.

Estructura, que no es negociable (§11.6.1 «semántica de escritura»):

1. **Fuera del ``write_lock``**: índice, descarga, esquema, checksum y reglas de
   §10.6. La red jamás se sostiene con el lock tomado; si lo hiciera, un job del
   estudiante se quedaría esperando a que un bucket lento conteste.
2. **Dentro del ``write_lock``**: solo lo que LEE la base (ids libres, ``order``
   ocupados) y la escritura, que va por ``content_writer._persist``: una unidad,
   un commit, revalidación del grafo con ``ContentRepository.load`` antes del
   commit y swap atómico de ``app.state.content``. Un bundle que reviente a
   mitad no deja nada a medias.
3. Orden de inserción ``modules → lessons → examples → quiz_questions``, el
   mismo que ya resuelve ``app/tools/seed_content.py``, y todo por
   ``INSERT … ON CONFLICT(id) DO UPDATE``.

Tres cosas que este módulo NO hace, a propósito:

* **No borra nada.** ``content_admin.delete_lesson`` purga ``lesson_progress`` y
  ``quiz_attempts`` por diseño (BL-01) — correcto cuando el AUTOR borra en su
  máquina, catastrófico disparado por la incorporación de un estudiante.
* **No toca ``content_seeded_at``.** Instalar no es sembrar: el marcador gobierna
  el auto-seed del lifespan (BL-21) y moverlo aquí cambiaría el arranque.
* **No poda ``recommended``.** Instalar m1 en una base vacía deja enlaces a m2,
  m4 y m6 que todavía no existen, y eso es CORRECTO: ``recommended_json``
  conserva lo que escribió el autor y ``ContentRepository._podar_recommended``
  esconde del snapshot solo lo que aún no está instalado. En cuanto el
  estudiante incorpore el módulo que faltaba, el enlace reaparece **sin
  reinstalar nada**.

⚠ **BLOQUEANTE DE BUILD (no es de este archivo, pero lo mata).** §11.2 exige que
``module_installer`` viaje en la imagen ESTUDIANTE, pero el ``Dockerfile``
(línea 33-36) borra ahí ``services/content_writer.py`` y
``services/markdown_validator.py``. El instalador necesita el primero (``_persist``
es el contrato de escritura, data-model §7.4) y ``bundle_guard`` necesita el
segundo. El arreglo es de una línea y tiene precedente literal en el propio
Dockerfile: ``repositories/content_admin.py`` ya está exceptuado del borrado
porque lo importa ``quiz_service``, que no es admin. Ver
``tests/test_module_install.py::test_la_imagen_estudiante_conserva_lo_que_importa_el_instalador``.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import json
import re
from typing import TYPE_CHECKING, Any, Sequence

from app.errors import ApiException
from app.repositories import catalog as catalog_repo
from app.repositories import content_admin
from app.repositories import workshop as workshop_repo
from app.schemas.admin import QUESTION_ID_PATTERN
from app.schemas.catalog import (
    BundleLesson,
    BundleQuizQuestion,
    CatalogIndex,
    CatalogIndexEntry,
    InstallRequest,
    InstallResult,
    ModuleBundle,
    ProgressEffectSummary,
)
from app.services import youtube
from app.services.bundle_guard import (
    BundleContentInvalid,
    BundleGuardError,
    BundleInvalid,
    cargar_json_sin_duplicados,
    decodificar_estricto,
    issues_de_texto,
    parse_bundle,
)
from app.services.catalog_client import (
    CatalogClientError,
    CatalogGenerationMismatch,
    CatalogObject,
    CatalogObjectNotFound,
    CatalogObjectTooLarge,
    CatalogReadPort,
    CatalogUnavailable,
)
from app.services.catalog_hash import BundleHashError, bundle_checksum

# Importes PRIVADOS deliberados (plan.md C14: «se reutilizan sin tocar desde el
# instalador»). Duplicar `_persist` sería tener dos definiciones de «una unidad,
# un commit», que es justo la invariante que no admite dos definiciones.
from app.services.content_writer import (
    _check_code_size,
    _example_coherence_issues,
    _persist,
)

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    import aiosqlite
    from fastapi import FastAPI

#: HTTP de cada código de §11.3. ``app/errors.py`` (congelado, ajeno a esta
#: tanda) todavía no los tiene en ``DEFAULT_STATUS``, así que van explícitos:
#: sin esto un ``CHECKSUM_MISMATCH`` saldría como 500.
ESTADO_HTTP: dict[str, int] = {
    "REMOTE_MODULE_NOT_FOUND": 404,
    "MODULE_ALREADY_INSTALLED": 409,
    "CHECKSUM_MISMATCH": 409,
    "DUPLICATE_ID": 409,
    "CODE_TOO_LARGE": 413,
    "BUNDLE_TOO_LARGE": 413,
    "BUNDLE_INVALID": 422,
    "CONTENT_VALIDATION_ERROR": 422,
    "CATALOG_UNAVAILABLE": 503,
}

#: Tope de placeholders por sentencia ``IN (...)``. Un bundle puede traer 100
#: lecciones × 50 preguntas = 5000 ids, y el límite de variables de SQLite
#: (999 en builds antiguos) convertiría la comprobación de colisiones en un
#: ``OperationalError`` → 500. Se trocea y ya.
_LOTE_IDS = 400

_QUESTION_ID_RE = re.compile(QUESTION_ID_PATTERN)


# ─────────────────────────── errores tipados ────────────────────────────────


def _api(code: str, mensaje: str, *, details: Any = None) -> ApiException:
    return ApiException(
        code, mensaje, status_code=ESTADO_HTTP[code], details=details
    )


def _content_error(issues: list[dict]) -> ApiException:
    return _api(
        "CONTENT_VALIDATION_ERROR",
        "El contenido del módulo no cumple las reglas de validación.",
        details=issues,
    )


def api_error_from_catalog(exc: CatalogClientError) -> ApiException:
    """Excepción del puerto de catálogo → ``ApiException`` de §11.3.

    Vive aquí y no en el router para que las tres rutas que descargan del
    bucket (instalar, previsualizar, actualizar) traduzcan igual. El texto crudo
    de la excepción **nunca** viaja al cliente: solo el ``reason`` acotado que
    el propio cliente ya construyó (mismo criterio que ``jobs.error_detail``).
    """
    if isinstance(exc, CatalogObjectNotFound):
        return _api(
            "REMOTE_MODULE_NOT_FOUND",
            "El módulo pedido no está en el catálogo remoto.",
        )
    if isinstance(exc, CatalogObjectTooLarge):
        return _api(
            "BUNDLE_TOO_LARGE",
            f"El módulo supera el máximo de {exc.max_bytes} bytes.",
        )
    if isinstance(exc, CatalogGenerationMismatch):
        # El objeto cambió bajo nuestros pies entre el listado y la descarga:
        # lo que llegaría no es lo que el usuario vio (§11.6.1, TOCTOU).
        return _api(
            "CHECKSUM_MISMATCH",
            "El objeto del bucket cambió mientras se descargaba; "
            "vuelve a intentarlo.",
        )
    if isinstance(exc, CatalogUnavailable):
        return _api(
            "CATALOG_UNAVAILABLE",
            "No se pudo leer el catálogo remoto.",
            details=exc.details,
        )
    return _api("CATALOG_UNAVAILABLE", "No se pudo leer el catálogo remoto.")


def _error_de_guard(exc: BundleGuardError) -> ApiException:
    """``bundle_guard`` ya trae ``code``/``status_code``/``details`` de §11.3."""
    return ApiException(
        exc.code, exc.message, status_code=exc.status_code, details=exc.details
    )


# ──────────────────────── índice: descarga y parseo ─────────────────────────


def parse_index(raw: bytes, *, max_bytes: int) -> CatalogIndex:
    """Bytes de ``modulos/index.json`` → :class:`CatalogIndex` validado.

    El índice entra por el MISMO agujero que un bundle, así que recibe el mismo
    trato: tope de tamaño, UTF-8 estricto sin BOM, JSON sin claves duplicadas,
    **barrido de texto** (controles, BIDI, ancho cero) y ``extra="forbid"``. Se
    reutilizan las puertas que ``bundle_guard`` exporta justo para esto, en vez
    de reimplementarlas peor.

    El barrido de texto faltaba, y este docstring ya afirmaba que estaba: los
    `title`/`description` del índice solo tenían `max_length`, así que una marca
    RLO o una secuencia ANSI llegaban **verbatim** a la pantalla «Explorar»
    —que es lo que el estudiante ve ANTES de instalar nada— y se persistían en
    la caché. El mismo texto dentro de un bundle daba 422.
    """
    if max_bytes < 1:
        raise ValueError("max_bytes debe ser ≥ 1")
    if len(raw) > max_bytes:
        raise _api(
            "BUNDLE_TOO_LARGE",
            f"El índice del catálogo supera el máximo de {max_bytes} bytes.",
        )
    try:
        payload = cargar_json_sin_duplicados(decodificar_estricto(raw))
        if not isinstance(payload, dict):
            raise BundleInvalid("La raíz del índice debe ser un objeto JSON.")
        issues = issues_de_texto(payload)
        if issues:
            raise BundleContentInvalid(
                "El índice del catálogo trae texto no permitido.", details=issues
            )
        return CatalogIndex.model_validate(payload)
    except BundleGuardError as exc:
        raise _error_de_guard(exc) from exc
    except Exception as exc:
        # ValidationError, RecursionError de pydantic y cualquier sorpresa: el
        # índice viene de fuera, así que ninguna excepción suya puede salir como
        # error no controlado. El anidamiento hondo del PARSER ya lo convierte
        # `cargar_json_sin_duplicados`, con mejor mensaje.
        raise _api(
            "BUNDLE_INVALID", "El índice del catálogo no tiene el formato esperado."
        ) from exc


async def fetch_index(
    catalog: CatalogReadPort, *, max_bytes: int, sin_cache: bool = False
) -> CatalogIndex:
    """Lee y valida el índice del bucket. Traduce todo fallo a ``ApiException``.

    ``sin_cache`` viaja tal cual hasta el adaptador: es la relectura FORZADA, la
    que no puede quedarse mirando la copia que la caché de borde de Google
    conserva hasta una hora después de publicar (§11.4.2).
    """
    try:
        objeto = await catalog.fetch_index(max_bytes=max_bytes, sin_cache=sin_cache)
    except CatalogClientError as exc:
        raise api_error_from_catalog(exc) from exc
    return parse_index(objeto.data, max_bytes=max_bytes)


def _entrada_del_indice(
    indice: CatalogIndex, body: InstallRequest
) -> CatalogIndexEntry:
    """La fila del índice del módulo pedido (§11.6.1: ``version`` opcional).

    El índice publica UNA versión por módulo —la vigente— y es la única cuyo
    checksum conocemos. Pedir otra no es «versión antigua disponible», es una
    versión que no podemos verificar: ``404 REMOTE_MODULE_NOT_FOUND``, nunca una
    instalación a ciegas.
    """
    entrada = next((e for e in indice.modules if e.id == body.module_id), None)
    if entrada is None:
        raise _api(
            "REMOTE_MODULE_NOT_FOUND",
            f"El módulo '{body.module_id}' no está en el catálogo remoto.",
        )
    if body.version is not None and body.version != entrada.version:
        raise _api(
            "REMOTE_MODULE_NOT_FOUND",
            f"La versión {body.version} de '{body.module_id}' no está en el "
            f"catálogo remoto (la publicada es la {entrada.version}).",
        )
    return entrada


# ──────────────────── descarga y verificación del bundle ────────────────────


async def _descargar(
    catalog: CatalogReadPort,
    entrada: CatalogIndexEntry,
    *,
    max_bytes: int,
    generation: int | None,
) -> CatalogObject:
    """Descarga el objeto del módulo, con el tope aplicado ANTES por ``size_bytes``.

    El corte barato primero (§11.3: «se detecta por ``size`` antes de descargar
    cuando el listado lo trae») y el del puerto después, sobre los bytes reales:
    el índice es una conveniencia, no una fuente de verdad.
    """
    if entrada.size_bytes > max_bytes:
        raise _api(
            "BUNDLE_TOO_LARGE",
            f"El módulo anuncia {entrada.size_bytes} bytes y el máximo es "
            f"{max_bytes}.",
        )
    try:
        return await catalog.fetch_module(
            entrada.id,
            entrada.version,
            max_bytes=max_bytes,
            generation=generation,
        )
    except CatalogClientError as exc:
        raise api_error_from_catalog(exc) from exc


def _verificar_checksum(
    bundle: ModuleBundle,
    entrada: CatalogIndexEntry,
    body: InstallRequest,
    *,
    recibidos: int,
) -> str:
    """Las cuatro coincidencias que tienen que darse antes de escribir nada.

    ``size_bytes`` primero porque es el detector barato de truncado (R2), y
    después el sha256 canónico de §11.8.2 contra: lo que el propio bundle dice
    de sí mismo, lo que promete el índice, y lo que el usuario VIO en pantalla.
    Ese último es el que cierra el TOCTOU del bucket reescrito entre el listado
    y el clic.
    """
    if recibidos != entrada.size_bytes:
        raise _api(
            "CHECKSUM_MISMATCH",
            "El módulo descargado no coincide con el que anuncia el catálogo.",
            details=[
                {
                    "field": "size_bytes",
                    "reason": f"el índice anuncia {entrada.size_bytes} bytes y "
                    f"se recibieron {recibidos}",
                }
            ],
        )
    try:
        digest = bundle_checksum(bundle)
    except BundleHashError as exc:  # pragma: no cover - imposible ya validado
        raise _api("BUNDLE_INVALID", "El módulo no es serializable.") from exc

    for esperado, campo in (
        (bundle.checksum, "bundle.checksum"),
        (entrada.checksum, "index.checksum"),
        (body.expected_checksum, "expected_checksum"),
    ):
        if esperado is not None and esperado != digest:
            raise _api(
                "CHECKSUM_MISMATCH",
                "El módulo descargado no coincide con el checksum esperado.",
                details=[
                    {
                        "field": campo,
                        "reason": f"se esperaba {esperado} y el bundle "
                        f"descargado es {digest}",
                    }
                ],
            )
    return digest


def _verificar_identidad(bundle: ModuleBundle, entrada: CatalogIndexEntry) -> None:
    """El objeto servido bajo ``<id>/v<n>.json`` tiene que declararse como tal.

    Si el checksum cuadró y aun así el ``module.id`` no coincide, quien miente
    es el índice, no el transporte. Se rechaza como contenido inválido en vez de
    instalar un módulo bajo un id que su autor no escribió.
    """
    issues: list[dict] = []
    if bundle.module.id != entrada.id:
        issues.append(
            {
                "field": "module.id",
                "reason": f"el bundle se declara '{bundle.module.id}' pero el "
                f"catálogo lo publica como '{entrada.id}'",
            }
        )
    if bundle.module.version != entrada.version:
        issues.append(
            {
                "field": "module.version",
                "reason": f"el bundle se declara v{bundle.module.version} pero "
                f"el catálogo publica la v{entrada.version}",
            }
        )
    if issues:
        raise _content_error(issues)


def _verificar_contenido(app: "FastAPI", bundle: ModuleBundle) -> None:
    """Reglas de §10.6 que ``bundle_guard`` dejó fuera a propósito.

    Son las que necesitan el ``app`` (tope de código en runtime, BL-17) o las
    que ya tienen dueño en ``content_writer`` y no vale la pena duplicar
    (coherencia threads/GPU). El umbral doble se rechaza en vez de resolverse:
    ``lessons.pass_threshold`` es la columna con la que el servidor calificará,
    y elegir por el autor entre dos números que él escribió distintos es
    exactamente cómo se cuela una nota mal puesta.
    """
    issues: list[dict] = []
    for indice, leccion in enumerate(bundle.lessons):
        base = f"lessons[{indice}]"
        if leccion.example is not None:
            issues += [
                {**it, "field": f"{base}.example.{it['field']}"}
                for it in _example_coherence_issues(leccion.example)
            ]
        if (
            leccion.quiz is not None
            and leccion.quiz.pass_threshold != leccion.pass_threshold
        ):
            issues.append(
                {
                    "field": f"{base}.quiz.pass_threshold",
                    "reason": "el umbral del quiz "
                    f"({leccion.quiz.pass_threshold}) no coincide con el de la "
                    f"lección ({leccion.pass_threshold})",
                }
            )
    if issues:
        raise _content_error(issues)
    # El tope de código es 413 CODE_TOO_LARGE (§1.1), no un issue de contenido:
    # se reutiliza el MISMO helper que la vía admin para que subir o bajar
    # TELAR_MAX_CODE_BYTES afecte por igual a las dos.
    for leccion in bundle.lessons:
        if leccion.example is not None:
            _check_code_size(app, leccion.example.source_code)


def _ids_de_preguntas(
    bundle: ModuleBundle,
) -> dict[str, list[tuple[str, BundleQuizQuestion]]]:
    """Resuelve el id efectivo de cada pregunta y comprueba que sean únicos.

    BL-18: ``id`` es opcional y se deriva ``{lesson_id}-q{order}``. ``bundle_guard``
    **salta** las preguntas sin id (todavía no existen), así que la colisión
    entre un id explícito de una lección y uno derivado de otra solo se puede
    ver aquí — y ``quiz_questions.id`` es PK global, o sea que sin esto sería un
    ``IntegrityError`` → 500 en mitad de la escritura.
    """
    resueltas: dict[str, list[tuple[str, BundleQuizQuestion]]] = {}
    vistos: dict[str, str] = {}
    issues: list[dict] = []
    for indice, leccion in enumerate(bundle.lessons):
        base = f"lessons[{indice}].quiz.questions"
        if leccion.quiz is None:
            continue
        pares: list[tuple[str, BundleQuizQuestion]] = []
        for numero, pregunta in enumerate(leccion.quiz.questions):
            qid = pregunta.id or f"{leccion.id}-q{pregunta.order}"
            campo = f"{base}[{numero}].id"
            if not _QUESTION_ID_RE.match(qid):
                issues.append(
                    {
                        "field": campo,
                        "reason": f"el id de pregunta '{qid}' no cumple el "
                        "patrón permitido",
                    }
                )
            duenia = vistos.get(qid)
            if duenia is not None:
                issues.append(
                    {
                        "field": campo,
                        "reason": f"el id de pregunta '{qid}' ya lo usa la "
                        f"lección '{duenia}' del mismo módulo",
                    }
                )
            else:
                vistos[qid] = leccion.id
            pares.append((qid, pregunta))
        resueltas[leccion.id] = pares
    if issues:
        raise _content_error(issues)
    return resueltas


# ─────────────────── comprobaciones que LEEN la base (con lock) ─────────────


async def _filas_por_id(
    db: "aiosqlite.Connection", plantilla: str, ids: Sequence[str]
) -> list[Any]:
    """Ejecuta ``plantilla`` (con ``{marcas}``) por lotes y concatena las filas."""
    filas: list[Any] = []
    for inicio in range(0, len(ids), _LOTE_IDS):
        lote = list(ids[inicio : inicio + _LOTE_IDS])
        marcas = ",".join("?" for _ in lote)
        cursor = await db.execute(plantilla.format(marcas=marcas), lote)
        filas.extend(await cursor.fetchall())
    return filas


def _conflicto(campo: str, id_: str, owner: str | None) -> dict:
    """Fila de ``details`` de ``409 DUPLICATE_ID`` (§11.6.1, shape literal)."""
    return {"field": campo, "id": id_, "owner_module_id": owner}


def _sin_repetidos(conflictos: list[dict]) -> list[dict]:
    """Quita filas idénticas conservando el orden en que se descubrieron."""
    vistos: set[tuple] = set()
    unicos: list[dict] = []
    for conflicto in conflictos:
        clave = tuple(conflicto.values())
        if clave in vistos:
            continue
        vistos.add(clave)
        unicos.append(conflicto)
    return unicos


async def _verificar_ids_libres(
    db: "aiosqlite.Connection",
    bundle: ModuleBundle,
    preguntas: dict[str, list[tuple[str, BundleQuizQuestion]]],
) -> None:
    """Ningún id del bundle puede pertenecer ya a otro módulo local (§11.3).

    Se recogen TODAS las colisiones y se responde una sola vez: media docena de
    409 seguidos, uno por id, es una forma cara de no decirle al estudiante qué
    pasa. Y se comprueba antes de escribir porque las tres claves son PK
    globales: dejarlo a la base es cambiar un 409 explicado por un 500 opaco.
    """
    conflictos: list[dict] = []

    # Lecciones y ejemplos comparten espacio de nombres (§10.6): un id entrante
    # colisiona igual con una lección que con un ejemplo.
    entrantes: dict[str, str] = {}
    for leccion in bundle.lessons:
        entrantes[leccion.id] = "lesson_id"
        if leccion.example is not None:
            entrantes.setdefault(leccion.example.id, "example_id")
    ids_contenido = list(entrantes)

    for fila in await _filas_por_id(
        db,
        'SELECT id, module_id FROM lessons WHERE id IN ({marcas})',
        ids_contenido,
    ):
        conflictos.append(
            _conflicto(entrantes[fila["id"]], fila["id"], fila["module_id"])
        )
    for fila in await _filas_por_id(
        db,
        "SELECT e.id AS id, l.module_id AS module_id FROM examples e "
        "LEFT JOIN lessons l ON l.id = e.lesson_id WHERE e.id IN ({marcas})",
        ids_contenido,
    ):
        conflictos.append(
            _conflicto(entrantes[fila["id"]], fila["id"], fila["module_id"])
        )

    ids_pregunta = [qid for pares in preguntas.values() for qid, _ in pares]
    for fila in await _filas_por_id(
        db,
        "SELECT q.id AS id, l.module_id AS module_id FROM quiz_questions q "
        "LEFT JOIN lessons l ON l.id = q.lesson_id WHERE q.id IN ({marcas})",
        ids_pregunta,
    ):
        conflictos.append(_conflicto("question_id", fila["id"], fila["module_id"]))

    # El contenido histórico del repo tiene `examples.id == lessons.id` (backfill
    # de la migración 5), así que un mismo id entrante choca DOS veces —con la
    # lección y con su ejemplo— y sería la misma noticia dicha dos veces.
    conflictos = _sin_repetidos(conflictos)
    if conflictos:
        raise _api(
            "DUPLICATE_ID",
            "Algunos identificadores del módulo ya los usa contenido local.",
            details=conflictos,
        )


async def _verificar_modulo_libre(
    db: "aiosqlite.Connection", module_id: str
) -> None:
    """Ya instalado ⇒ actualizar; id tomado por contenido local ⇒ colisión."""
    if await catalog_repo.get_installed(db, module_id) is not None:
        raise _api(
            "MODULE_ALREADY_INSTALLED",
            f"El módulo '{module_id}' ya está incorporado; usa la actualización.",
        )
    if await content_admin.module_exists(db, module_id):
        raise _api(
            "DUPLICATE_ID",
            f"El id de módulo '{module_id}' ya lo usa un módulo local.",
            details=[_conflicto("module_id", module_id, module_id)],
        )


async def _resolver_order(
    db: "aiosqlite.Connection", order_hint: int
) -> tuple[int, bool]:
    """``modules."order"`` es UNIQUE GLOBAL: el ``order_hint`` es una sugerencia.

    Dos autores publican con ``order_hint: 3`` y los dos módulos son legítimos.
    Se reasigna a ``MAX + 1`` y se DECLARA en la respuesta, que es lo contrario
    de fallar con un ``IntegrityError`` que el estudiante no puede interpretar.
    """
    ocupados = set((await content_admin.all_module_orders(db)).values())
    if order_hint not in ocupados:
        return order_hint, False
    return max(ocupados) + 1, True


async def _lecciones_con_progreso(
    db: "aiosqlite.Connection", bundle: ModuleBundle
) -> int:
    """Cuántas lecciones entrantes ya tienen progreso guardado.

    No es un detalle cosmético: ``lesson_progress`` no tiene FK a ``lessons``
    (data-model §8.3), así que desinstalar deja el avance HUÉRFANO y volver a
    incorporar el módulo lo recupera. Contarlo aquí es lo que permite decírselo
    al estudiante en vez de que lo descubra por su cuenta.
    """
    ids = [leccion.id for leccion in bundle.lessons]
    filas = await _filas_por_id(
        db, "SELECT lesson_id FROM lesson_progress WHERE lesson_id IN ({marcas})", ids
    )
    return len(filas)


# ─────────────────────────────── escritura ──────────────────────────────────


def _dumps(valor: object) -> str:
    """JSON compacto preservando unicode, igual que el seeder."""
    return json.dumps(valor, ensure_ascii=False)


_UPSERT_MODULE = """
INSERT INTO modules
    (id, "order", title, description, level,
     version, checksum, origin, published_at)
VALUES (?, ?, ?, ?, ?, ?, ?, 'remote', ?)
ON CONFLICT(id) DO UPDATE SET
    "order"      = excluded."order",
    title        = excluded.title,
    description  = excluded.description,
    level        = excluded.level,
    version      = excluded.version,
    checksum     = excluded.checksum,
    origin       = excluded.origin,
    published_at = excluded.published_at
"""

_UPSERT_LESSON = """
INSERT INTO lessons
    (id, module_id, "order", title, estimated_minutes, content_markdown,
     video_url, pass_threshold, recommended_json, enabled, completion_rule,
     kind, archived_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
ON CONFLICT(id) DO UPDATE SET
    module_id         = excluded.module_id,
    "order"           = excluded."order",
    title             = excluded.title,
    estimated_minutes = excluded.estimated_minutes,
    content_markdown  = excluded.content_markdown,
    video_url         = excluded.video_url,
    pass_threshold    = excluded.pass_threshold,
    recommended_json  = excluded.recommended_json,
    enabled           = excluded.enabled,
    completion_rule   = excluded.completion_rule,
    kind              = excluded.kind,
    archived_at       = NULL
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


def _params_leccion(leccion: BundleLesson, module_id: str) -> tuple:
    return (
        leccion.id,
        module_id,
        leccion.order,
        leccion.title,
        leccion.estimated_minutes,
        leccion.content_markdown,
        # La URL se guarda RECONSTRUIDA desde el id de 11 chars: del enlace
        # original no sobrevive nada más (services/youtube). El guard valida
        # pero no normaliza a propósito, porque normalizar cambia bytes y el
        # checksum de §11.8.2 va sobre los originales.
        youtube.normalizar(leccion.video_url),
        leccion.pass_threshold,
        _dumps(
            [
                {"lesson_id": r.lesson_id, "label": r.label, "tag": r.tag}
                for r in leccion.recommended
            ]
        ),
        int(leccion.enabled),
        leccion.completion_rule,
        leccion.kind or "leccion",  # S6: ausente (bundle 1) = lección
    )


async def _escribir_pasos(
    db: "aiosqlite.Connection", lecciones: "Sequence[BundleLesson]"
) -> None:
    """S6 (§12.5): los pasos de cada lección, tal como vienen en el bundle.

    Se reescriben SIEMPRE, también en las lecciones que no son taller (con la
    lista vacía): el contenido instalado es el del bundle, y una lección que dejó
    de ser taller no conserva pasos del publicador anterior. Las casillas del
    estudiante no se tocan (data-model §9).
    """
    for leccion in lecciones:
        pasos = leccion.steps if leccion.es_taller and leccion.steps else []
        await workshop_repo.replace_steps_no_commit(
            db,
            leccion.id,
            [
                workshop_repo.StepContent(p.title, p.body_markdown, p.example_id)
                for p in pasos
            ],
        )


def _params_ejemplo(leccion: BundleLesson) -> tuple:
    ejemplo = leccion.example
    assert ejemplo is not None
    return (
        # E1: el ejemplo tiene id PROPIO desde la migración 5; la relación la
        # manda `lesson_id`, no la igualdad de claves.
        ejemplo.id,
        leccion.id,
        ejemplo.filename,
        ejemplo.title,
        ejemplo.difficulty,
        ejemplo.teaches,
        _dumps(list(ejemplo.directives)),
        int(ejemplo.threads_configurable),
        ejemplo.fixed_threads,
        ejemplo.fixed_threads_note,
        int(ejemplo.sweeps_threads),
        int(ejemplo.self_measures),
        ejemplo.parser_id,
        ejemplo.default_timeout_s,
        ejemplo.est_run_seconds,
        int(ejemplo.enabled),
        int(ejemplo.requires_gpu),
        ejemplo.expected_output_note,
        _dumps(list(ejemplo.takeaways)),
        ejemplo.source_code,
    )


async def _escribir(
    db: "aiosqlite.Connection",
    bundle: ModuleBundle,
    preguntas: dict[str, list[tuple[str, BundleQuizQuestion]]],
    *,
    object_path: str,
    local_order: int,
    checksum: str,
    report: dict[str, Any],
) -> None:
    """Los INSERT de la incorporación, SIN commit: la unidad la cierra ``_persist``.

    Orden ``modules → lessons → examples → quiz_questions`` (el del seeder), y
    el manifiesto en la MISMA transacción (§11.6.1 paso 5): un manifiesto que se
    confirmara aparte podría decir «instalado» de contenido que no está.
    """
    modulo = bundle.module
    await db.execute(
        _UPSERT_MODULE,
        (
            modulo.id,
            local_order,
            modulo.title,
            modulo.description,
            modulo.level,
            modulo.version,
            checksum,
            modulo.published_at,
        ),
    )
    for leccion in bundle.lessons:
        await db.execute(_UPSERT_LESSON, _params_leccion(leccion, modulo.id))
    await _escribir_pasos(db, bundle.lessons)
    for leccion in bundle.lessons:
        if leccion.example is not None:
            await db.execute(_UPSERT_EXAMPLE, _params_ejemplo(leccion))
    for leccion in bundle.lessons:
        for qid, pregunta in preguntas.get(leccion.id, []):
            await db.execute(
                _UPSERT_QUESTION,
                (
                    qid,
                    leccion.id,
                    pregunta.order,
                    pregunta.text,
                    _dumps([{"key": o.key, "text": o.text} for o in pregunta.options]),
                    pregunta.correct_key,
                    pregunta.explanation,
                ),
            )

    await catalog_repo.upsert_installed_no_commit(
        db,
        module_id=modulo.id,
        object_path=object_path,
        installed_version=modulo.version,
        installed_checksum=checksum,
        # Lo instalado ES lo último visto del bucket: sin esto el chip
        # «actualización disponible» se encendería nada más incorporar.
        available_version=modulo.version,
        available_checksum=checksum,
    )
    # `from_version=None` marca la INSTALACIÓN en el historial. No lo exige
    # §11.6.1, pero es la primera entrada de la trazabilidad que sostiene la
    # promesa de CU-39 («esto es lo que tenías y esto es lo que pasó»).
    await catalog_repo.log_update_no_commit(
        db,
        module_id=modulo.id,
        from_version=None,
        to_version=modulo.version,
        report=report,
    )


# Alias PÚBLICOS de las sentencias y constructores que comparte CU-37
# (`services/catalog_import`). Un fork escribe exactamente las MISMAS filas de
# lección, ejemplo y pregunta que una incorporación; lo único que cambia es la
# cabecera del módulo, que va con `origin='local'` y sin manifiesto. Se exponen
# con alias en vez de renombrarlos para no tocar las referencias internas ya
# probadas, y se declaran aquí —y no en `catalog_import`— porque el dueño de
# «cómo se escribe un bundle» es este módulo.
UPSERT_LESSON = _UPSERT_LESSON
UPSERT_EXAMPLE = _UPSERT_EXAMPLE
UPSERT_QUESTION = _UPSERT_QUESTION
params_leccion = _params_leccion
params_ejemplo = _params_ejemplo
escribir_pasos = _escribir_pasos
dumps_json = _dumps


# ──────────────────────────── caso de uso CU-36 ─────────────────────────────


@dataclass(frozen=True, slots=True)
class BundleTraido:
    """Un bundle del bucket ya descargado, verificado y listo para escribir.

    Agrupa las cuatro cosas que la fase de red produce y que la de escritura
    necesita, para que extraerla no obligue a devolver una tupla anónima de
    cuatro elementos que hay que recordar en orden.
    """

    bundle: ModuleBundle
    objeto: CatalogObject
    checksum: str
    preguntas: dict[str, list[tuple[str, BundleQuizQuestion]]]


async def descargar_y_validar(
    app: "FastAPI",
    body: InstallRequest,
    *,
    catalog: CatalogReadPort,
    index: CatalogIndex | None = None,
    generation: int | None = None,
) -> BundleTraido:
    """Trae un bundle del bucket y lo valida. **No escribe nada, no toma el lock.**

    Es la fase 1 de §11.6.1, extraída porque la comparten dos casos de uso que
    escriben distinto: incorporar (CU-36, `install_module`) e importar para
    editar (CU-37, `services/catalog_import`). Compartirla no es estética — es
    que las comprobaciones que hace son la frontera con contenido que viene de
    FUERA del equipo: tope de bytes, guard del bundle, checksum contra el
    índice, identidad, reglas de §10.6 e ids de pregunta únicos. Una segunda
    copia de esa lista sería una segunda copia que se olvida de actualizar.

    Que no tome el ``write_lock`` es parte del contrato: la red **nunca** se
    sostiene con el lock tomado, o un bucket lento congelaría los jobs de todos.
    """
    settings = app.state.settings
    max_bytes = int(settings.catalog_max_bundle_bytes)

    indice = index if index is not None else await fetch_index(
        catalog, max_bytes=max_bytes
    )
    entrada = _entrada_del_indice(indice, body)
    if (
        body.expected_checksum is not None
        and body.expected_checksum != entrada.checksum
    ):
        # El bucket cambió entre la pantalla y el clic: se corta ANTES de gastar
        # la descarga, no después.
        raise _api(
            "CHECKSUM_MISMATCH",
            "El catálogo cambió desde que viste este módulo; refresca y vuelve "
            "a intentarlo.",
            details=[
                {
                    "field": "expected_checksum",
                    "reason": "el índice publica otro checksum para esta versión",
                }
            ],
        )

    objeto = await _descargar(
        catalog, entrada, max_bytes=max_bytes, generation=generation
    )
    try:
        # El parseo de un bundle es trabajo de CPU (decodificar, recorrer texto,
        # validar markdown de hasta 64 KiB por lección). Hacerlo en la corrutina deja el
        # event loop parado para TODOS: sin latido de WebSocket, sin /health, sin los
        # jobs de los demás estudiantes. Va a un hilo.
        bundle = await asyncio.to_thread(
            parse_bundle, objeto.data, max_bytes=max_bytes
        )
    except BundleGuardError as exc:
        raise _error_de_guard(exc) from exc

    checksum = _verificar_checksum(
        bundle, entrada, body, recibidos=len(objeto.data)
    )
    _verificar_identidad(bundle, entrada)
    _verificar_contenido(app, bundle)
    return BundleTraido(bundle, objeto, checksum, _ids_de_preguntas(bundle))


async def install_module(
    app: "FastAPI",
    body: InstallRequest,
    *,
    catalog: CatalogReadPort,
    index: CatalogIndex | None = None,
    generation: int | None = None,
) -> InstallResult:
    """Incorpora un módulo del catálogo remoto (``POST /api/v1/catalog/install``).

    ``index`` permite pasar el índice ya cacheado (``repositories/catalog`` lo
    guarda en ``app_meta``) para no volver a salir a la red; si falta, se
    descarga. ``generation`` ancla el objeto exacto cuando el listado la trae.

    Quien decide que este despliegue NO tiene catálogo (``503 CATALOG_DISABLED``)
    es el router: aquí ya llega un puerto construido.
    """
    # ── 1. FUERA del write_lock: red y validación en memoria ────────────────
    traido = await descargar_y_validar(
        app, body, catalog=catalog, index=index, generation=generation
    )
    bundle, objeto, checksum, preguntas = (
        traido.bundle, traido.objeto, traido.checksum, traido.preguntas
    )

    # ── 2. DENTRO del write_lock: leer la base y escribir ───────────────────
    db = app.state.db
    async with app.state.write_lock:
        await _verificar_modulo_libre(db, bundle.module.id)
        await _verificar_ids_libres(db, bundle, preguntas)
        local_order, reasignado = await _resolver_order(db, bundle.module.order_hint)
        preservadas = await _lecciones_con_progreso(db, bundle)

        lecciones = [leccion.id for leccion in bundle.lessons]
        total_preguntas = sum(len(pares) for pares in preguntas.values())
        progreso = ProgressEffectSummary(
            preserved=preservadas,
            rescored=0,
            archived=0,
            unaffected=len(lecciones) - preservadas,
        )
        report = {
            "kind": "install",
            "object_path": objeto.object_path,
            "checksum": checksum,
            "local_order": local_order,
            "order_reassigned": reasignado,
            "lessons_added": lecciones,
            "questions_total": total_preguntas,
            "progress": progreso.model_dump(),
        }
        await _persist(
            app,
            lambda: _escribir(
                db,
                bundle,
                preguntas,
                object_path=objeto.object_path,
                local_order=local_order,
                checksum=checksum,
                report=report,
            ),
        )
        manifiesto = await catalog_repo.get_installed(db, bundle.module.id)

    assert manifiesto is not None  # lo acaba de escribir la misma transacción
    return InstallResult(
        module_id=bundle.module.id,
        installed_version=bundle.module.version,
        installed_checksum=checksum,
        object_path=objeto.object_path,
        local_order=local_order,
        order_reassigned=reasignado,
        lessons_added=lecciones,
        lessons_updated=[],
        lessons_removed=[],
        questions_total=total_preguntas,
        progress=progreso,
        installed_at=manifiesto.installed_at,
    )


__all__ = [
    "ESTADO_HTTP",
    "api_error_from_catalog",
    "parse_index",
    "fetch_index",
    "descargar_y_validar",
    "UPSERT_LESSON",
    "UPSERT_EXAMPLE",
    "UPSERT_QUESTION",
    "params_leccion",
    "params_ejemplo",
    "BundleTraido",
    "install_module",
]
