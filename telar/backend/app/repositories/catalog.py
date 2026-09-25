"""Repositorio del MANIFIESTO DE SELECCIÓN y de la caché del índice (Fase 5).

SQL explícito, sin lógica de negocio, sobre las tablas de la migración 5
(``data-model.md`` §3 y §8.2):

- ``installed_modules`` — **qué módulos incorporó el estudiante y en qué
  versión**. Una fila por módulo instalado desde el catálogo remoto. Los módulos
  del BASELINE (sembrados desde fixtures) **no** tienen fila aquí: ``origin =
  'local'`` en ``modules`` + ausencia de manifiesto significan «este módulo no
  vino del catálogo y no se actualiza desde él» (§8.2).
- ``module_update_log`` — el informe de cada actualización. Es la trazabilidad
  de la promesa «no perdiste nada»: permite responderle al estudiante **qué** se
  conservó y **qué** se archivó, en vez de pedirle que confíe.
- ``app_meta['catalog_index_cache']`` — la caché del índice remoto (§11.5.1).
  Sin ella, un bucket caído dejaría ``/modulos`` en blanco; con ella se sirve el
  último listado conocido con ``stale=true`` (§11.9). El TTL
  (``TELAR_CATALOG_CACHE_TTL_S``) es decisión del servicio, no de aquí: este
  módulo solo guarda y devuelve el documento con su ``fetched_at``.

Contratos (idénticos a ``content_admin.py``):

- **Ninguna función hace ``commit()`` ni toma ``write_lock``.** Todas las
  mutaciones llevan sufijo ``_no_commit`` porque todas son pieza de una unidad
  COMPUESTA —instalar, actualizar, refrescar, desinstalar— que ya sostiene
  ``app.state.write_lock`` y cierra con UN solo commit por el patrón
  ``content_writer._persist`` (data-model §2/§5). No hay variantes que
  confirmen: no existe ninguna mutación de catálogo que sea atómica por sí sola.
- La RED no se toca aquí. Descargar y validar ocurre FUERA del lock; esto es lo
  único que entra dentro.
- Documentos JSON (``report_json``, el índice cacheado) ⇄ ``dict`` los
  (de)serializa este módulo, como ``jobs.py`` con ``metrics_summary``.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

#: Clave de ``app_meta`` donde vive el índice remoto cacheado. La caché es un
#: documento único (bucket + fecha + índice) para que reemplazarla sea UNA fila:
#: dos claves separadas podrían quedar descuadradas si algo falla en medio.
INDEX_CACHE_KEY = "catalog_index_cache"

_AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

_COLUMNAS = (
    "module_id, object_path, installed_version, installed_checksum, "
    "available_version, available_checksum, locally_modified, "
    "last_checked_at, installed_at, updated_at"
)


# ──────────────────────────────── records ───────────────────────────────────


@dataclass(frozen=True)
class InstalledModuleRecord:
    """Una fila de ``installed_modules`` (data-model §8.2).

    ``installed_*`` es lo que corre AHORA en esta máquina; ``available_*`` es lo
    último que vio el refresco del índice, y es lo que enciende el chip
    «actualización disponible» **sin** salir a la red.
    """

    module_id: str
    object_path: str
    installed_version: int
    installed_checksum: str
    available_version: int | None
    available_checksum: str | None
    locally_modified: bool
    last_checked_at: str | None
    installed_at: str
    updated_at: str


@dataclass(frozen=True)
class ModuleUpdateLogRecord:
    """Una entrada de ``module_update_log``: el informe de UNA actualización."""

    id: str
    module_id: str
    from_version: int | None
    to_version: int
    report: dict[str, Any]
    created_at: str


@dataclass(frozen=True)
class CatalogIndexCacheRecord:
    """El índice remoto cacheado, con la marca de cuándo y de qué bucket salió.

    ``bucket`` se guarda para que un cambio de despliegue no sirva el catálogo
    del bucket anterior: comparar es del servicio, guardarlo es de aquí.
    """

    bucket: str
    fetched_at: str
    index: dict[str, Any]


def _fila_a_installed(fila: "aiosqlite.Row") -> InstalledModuleRecord:
    return InstalledModuleRecord(
        module_id=fila["module_id"],
        object_path=fila["object_path"],
        installed_version=int(fila["installed_version"]),
        installed_checksum=fila["installed_checksum"],
        available_version=(
            None if fila["available_version"] is None
            else int(fila["available_version"])
        ),
        available_checksum=fila["available_checksum"],
        locally_modified=bool(fila["locally_modified"]),
        last_checked_at=fila["last_checked_at"],
        installed_at=fila["installed_at"],
        updated_at=fila["updated_at"],
    )


def _fila_a_log(fila: "aiosqlite.Row") -> ModuleUpdateLogRecord:
    return ModuleUpdateLogRecord(
        id=fila["id"],
        module_id=fila["module_id"],
        from_version=(
            None if fila["from_version"] is None else int(fila["from_version"])
        ),
        to_version=int(fila["to_version"]),
        report=json.loads(fila["report_json"]),
        created_at=fila["created_at"],
    )


# ───────────────────────── manifiesto: lecturas ─────────────────────────────


async def list_installed(db: "aiosqlite.Connection") -> list[InstalledModuleRecord]:
    """Todo el manifiesto, ordenado por ``module_id`` (orden estable).

    Los módulos del baseline NO salen aquí: no tienen fila. El cruce con
    ``modules`` para pintar ``/cursos`` (§11.4.1) lo hace el servicio.
    """
    cursor = await db.execute(
        f"SELECT {_COLUMNAS} FROM installed_modules ORDER BY module_id"
    )
    return [_fila_a_installed(fila) for fila in await cursor.fetchall()]


async def get_installed(
    db: "aiosqlite.Connection", module_id: str
) -> InstalledModuleRecord | None:
    """La fila del manifiesto, o ``None`` si el módulo no vino del catálogo.

    ``None`` NO es un error: es la respuesta correcta para un módulo del
    baseline o creado por el admin. Quien exige manifiesto (actualizar,
    desinstalar) traduce ese ``None`` a ``404 MODULE_NOT_INSTALLED`` (§11.3).
    """
    cursor = await db.execute(
        f"SELECT {_COLUMNAS} FROM installed_modules WHERE module_id = ?",
        (module_id,),
    )
    fila = await cursor.fetchone()
    return None if fila is None else _fila_a_installed(fila)


# ──────────────────────── manifiesto: escrituras ────────────────────────────


_UPSERT_INSTALLED = f"""
INSERT INTO installed_modules
    (module_id, object_path, installed_version, installed_checksum,
     available_version, available_checksum, locally_modified, last_checked_at)
VALUES (:module_id, :object_path, :installed_version, :installed_checksum,
        :available_version, :available_checksum, :locally_modified,
        :last_checked_at)
ON CONFLICT(module_id) DO UPDATE SET
    object_path        = :object_path,
    installed_version  = :installed_version,
    installed_checksum = :installed_checksum,
    available_version  = :available_version,
    available_checksum = :available_checksum,
    locally_modified   = :locally_modified,
    last_checked_at    = :last_checked_at,
    updated_at         = {_AHORA}
"""


async def upsert_installed_no_commit(
    db: "aiosqlite.Connection",
    *,
    module_id: str,
    object_path: str,
    installed_version: int,
    installed_checksum: str,
    available_version: int | None = None,
    available_checksum: str | None = None,
    locally_modified: bool = False,
    last_checked_at: str | None = None,
) -> None:
    """Registra la instalación (CU-36) o la reescribe tras actualizar (CU-39).

    Escritura ABSOLUTA: cada columna queda EXACTAMENTE con lo que pasa el
    llamador. En particular ``locally_modified`` vuelve a ``False`` por defecto,
    que es lo correcto justo después de aplicar contenido del bucket —el módulo
    local vuelve a ser idéntico al remoto—; el llamador que quiera conservar la
    marca la pasa explícitamente.

    ``installed_at`` se conserva en el UPDATE (es «desde cuándo lo tienes», no
    «cuándo se actualizó») y ``updated_at`` se refresca siempre.

    La FK ``module_id → modules(id)`` obliga a insertar el módulo ANTES; con
    ``foreign_keys=ON`` (db.py) escribir el manifiesto de un módulo inexistente
    revienta con ``IntegrityError``, que es justo lo que se quiere: el
    manifiesto nunca apunta a un módulo que no está.
    """
    await db.execute(
        _UPSERT_INSTALLED,
        {
            "module_id": module_id,
            "object_path": object_path,
            "installed_version": installed_version,
            "installed_checksum": installed_checksum,
            "available_version": available_version,
            "available_checksum": available_checksum,
            "locally_modified": int(locally_modified),
            "last_checked_at": last_checked_at,
        },
    )


_SET_AVAILABLE = f"""
UPDATE installed_modules SET
    available_version  = :available_version,
    available_checksum = :available_checksum,
    last_checked_at    = COALESCE(:checked_at, {_AHORA})
WHERE module_id = :module_id
"""


async def set_available_no_commit(
    db: "aiosqlite.Connection",
    module_id: str,
    *,
    available_version: int | None,
    available_checksum: str | None,
    checked_at: str | None = None,
) -> bool:
    """Anota lo que vio el último refresco del índice (§11.4.2).

    ABSOLUTA a propósito: si el módulo **desapareció** del índice se llama con
    ``available_version=None`` y el chip de actualización se apaga. Un
    ``COALESCE`` aquí dejaría pegada para siempre una versión que ya no se
    publica.

    **No toca ``updated_at``**: mirar el bucket no es haber actualizado nada.
    En ``/cursos`` (§11.4.1) ``updated_at`` y ``last_checked_at`` son dos fechas
    distintas y confundirlas mentiría al estudiante.

    Devuelve ``False`` si el módulo no está en el manifiesto (0 filas): refrescar
    no instala nada.
    """
    cursor = await db.execute(
        _SET_AVAILABLE,
        {
            "module_id": module_id,
            "available_version": available_version,
            "available_checksum": available_checksum,
            "checked_at": checked_at,
        },
    )
    return cursor.rowcount > 0


async def set_locally_modified_no_commit(
    db: "aiosqlite.Connection", module_id: str, locally_modified: bool
) -> bool:
    """Marca (o desmarca) «el admin editó este módulo después de instalarlo».

    Lo enciende la autoría (``mark_linked_modified_no_commit``) al tocar un
    módulo con manifiesto, y lo apaga publicar o actualizar. Actualizar sobre él
    no se bloquea —el contrato no tiene código de error para eso— pero deja el
    aviso ``MODULE_LOCALLY_MODIFIED``: sobrescribir EN SILENCIO el trabajo del
    docente es la misma clase de error que borrar el progreso del estudiante,
    un nivel más arriba.

    Devuelve ``False`` si el módulo no tiene manifiesto (baseline o creado en
    local): **no es un error**, se puede llamar a ciegas desde el writer.
    """
    cursor = await db.execute(
        "UPDATE installed_modules SET locally_modified = :valor "
        "WHERE module_id = :module_id",
        {"module_id": module_id, "valor": int(locally_modified)},
    )
    return cursor.rowcount > 0


async def mark_linked_modified_no_commit(
    db: "aiosqlite.Connection",
    *,
    module_ids: Iterable[str] = (),
    lesson_ids: Iterable[str] = (),
    example_ids: Iterable[str] = (),
) -> None:
    """Enciende ``locally_modified`` en los módulos que toca una edición de §10.

    Resuelve lecciones y ejemplos a su módulo ACTUAL, así que el writer la
    llama ANTES de la mutación: si la edición mueve una lección, esto marca el
    módulo de origen y el destino lo pasa el llamador en ``module_ids``. Sin
    manifiesto no hay fila que marcar y no pasa nada (§2.3 #14).
    """
    modulos = set(module_ids)
    for lesson_id in lesson_ids:
        cur = await db.execute("SELECT module_id FROM lessons WHERE id = ?", (lesson_id,))
        fila = await cur.fetchone()
        if fila is not None:
            modulos.add(fila[0])
    for example_id in example_ids:
        cur = await db.execute(
            "SELECT l.module_id FROM examples e JOIN lessons l ON l.id = e.lesson_id "
            "WHERE e.id = ?",
            (example_id,),
        )
        fila = await cur.fetchone()
        if fila is not None:
            modulos.add(fila[0])
    for module_id in sorted(modulos):
        await set_locally_modified_no_commit(db, module_id, True)


async def delete_installed_no_commit(
    db: "aiosqlite.Connection", module_id: str
) -> bool:
    """Borra la fila del manifiesto (desinstalar, §11.6.4).

    Solo el manifiesto. Qué pasa con el contenido —archivar el módulo y sus
    lecciones, conservar el progreso— es del servicio, no de aquí. Devuelve
    ``False`` si no había fila.
    """
    cursor = await db.execute(
        "DELETE FROM installed_modules WHERE module_id = ?", (module_id,)
    )
    return cursor.rowcount > 0


# ────────────────────────── bitácora de updates ─────────────────────────────


async def log_update_no_commit(
    db: "aiosqlite.Connection",
    *,
    module_id: str,
    from_version: int | None,
    to_version: int,
    report: Mapping[str, Any],
    log_id: str | None = None,
) -> str:
    """Guarda el informe de una actualización y devuelve su id.

    ``from_version=None`` es una instalación (no había versión previa). El
    informe se guarda tal cual llega, serializado con ``ensure_ascii=False``
    para no destrozar los acentos de los títulos.
    """
    entrada_id = log_id or uuid.uuid4().hex
    await db.execute(
        "INSERT INTO module_update_log "
        "(id, module_id, from_version, to_version, report_json) "
        "VALUES (:id, :module_id, :from_version, :to_version, :report_json)",
        {
            "id": entrada_id,
            "module_id": module_id,
            "from_version": from_version,
            "to_version": to_version,
            "report_json": json.dumps(dict(report), ensure_ascii=False),
        },
    )
    return entrada_id


async def list_update_log(
    db: "aiosqlite.Connection", module_id: str, *, limit: int = 10
) -> list[ModuleUpdateLogRecord]:
    """Historial de actualizaciones del módulo, del más reciente al más viejo.

    Desempate por ``rowid`` porque ``created_at`` tiene milisegundos y dos
    informes de la misma actualización pueden caer en el mismo instante.
    """
    cursor = await db.execute(
        "SELECT id, module_id, from_version, to_version, report_json, created_at "
        "FROM module_update_log WHERE module_id = :module_id "
        "ORDER BY created_at DESC, rowid DESC LIMIT :limit",
        {"module_id": module_id, "limit": limit},
    )
    return [_fila_a_log(fila) for fila in await cursor.fetchall()]


# ────────────────────────── caché del índice remoto ─────────────────────────


_SAVE_INDEX_CACHE = f"""
INSERT INTO app_meta (key, value) VALUES (
    :key,
    json_object('bucket',     :bucket,
                'fetched_at', COALESCE(:fetched_at, {_AHORA}),
                'index',      json(:index_json))
)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
"""


async def save_index_cache_no_commit(
    db: "aiosqlite.Connection",
    *,
    bucket: str,
    index: Mapping[str, Any],
    fetched_at: str | None = None,
) -> CatalogIndexCacheRecord:
    """Reemplaza la caché del índice y devuelve lo que quedó guardado.

    El envoltorio se arma con ``json_object``/``json()`` de SQLite para que el
    ``fetched_at`` por defecto salga del MISMO reloj que ``installed_at`` y
    compañía, y para que un índice que no sea JSON válido reviente aquí y no al
    leerlo. Devuelve el record ya releído: quien responde ``/catalog/remote``
    necesita el ``fetched_at`` exacto que se persistió.
    """
    await db.execute(
        _SAVE_INDEX_CACHE,
        {
            "key": INDEX_CACHE_KEY,
            "bucket": bucket,
            "fetched_at": fetched_at,
            "index_json": json.dumps(dict(index), ensure_ascii=False),
        },
    )
    guardado = await get_index_cache(db)
    assert guardado is not None  # recién escrito en esta misma transacción
    return guardado


async def get_index_cache(
    db: "aiosqlite.Connection",
) -> CatalogIndexCacheRecord | None:
    """El índice cacheado, o ``None`` si nunca se cacheó **o si está ilegible**.

    Una caché corrupta (fila editada a mano, formato de otra versión) es una
    caché AUSENTE: ``/catalog/remote`` degrada a ``503 CATALOG_UNAVAILABLE`` en
    vez de reventar con un 500. La frescura (TTL) no se decide aquí.
    """
    cursor = await db.execute(
        "SELECT value FROM app_meta WHERE key = ?", (INDEX_CACHE_KEY,)
    )
    fila = await cursor.fetchone()
    if fila is None:
        return None
    try:
        envoltorio = json.loads(fila[0])
        return CatalogIndexCacheRecord(
            bucket=str(envoltorio["bucket"]),
            fetched_at=str(envoltorio["fetched_at"]),
            index=dict(envoltorio["index"]),
        )
    except (ValueError, TypeError, KeyError):
        return None


async def clear_index_cache_no_commit(db: "aiosqlite.Connection") -> bool:
    """Tira la caché del índice (cambio de bucket, catálogo desactivado)."""
    cursor = await db.execute(
        "DELETE FROM app_meta WHERE key = ?", (INDEX_CACHE_KEY,)
    )
    return cursor.rowcount > 0


# ───────────────────── recalificación del progreso (E4) ─────────────────────


_RESCORE = f"""
UPDATE lesson_progress SET
    best_quiz_score = :best_quiz_score,
    completed       = CASE
                          WHEN :completed IS NULL THEN completed
                          ELSE MAX(completed, :completed)
                      END,
    completed_via   = COALESCE(:completed_via, completed_via),
    completed_at    = CASE
                          WHEN completed_at IS NOT NULL THEN completed_at
                          WHEN :completed = 1 THEN {_AHORA}
                          ELSE completed_at
                      END,
    updated_at      = {_AHORA}
WHERE lesson_id = :lesson_id
"""


async def rescore_progress_no_commit(
    db: "aiosqlite.Connection",
    lesson_id: str,
    *,
    best_quiz_score: int | None,
    completed: bool | None = None,
    completed_via: str | None = None,
) -> bool:
    """Recalifica el progreso de UNA lección tras actualizar su módulo (§8.4).

    Hermano de ``ProgressRepository.upsert`` con **la** diferencia que es toda
    la razón de que exista: ``upsert`` aplica ``MAX(best_quiz_score, :nuevo)`` y
    ``COALESCE``, así que es **INCAPAZ de bajar la nota y de escribirle NULL**.
    Cuando una actualización cambia el conjunto de preguntas del quiz, la nota
    vieja deja de ser comparable y hay que poder borrarla; por la vía del
    ``upsert`` se quedaría pegada para siempre **y en silencio**. Aquí
    ``best_quiz_score`` es ABSOLUTO: baja y admite ``None``.

    Anular la nota no pierde nada: ``lesson_progress.best_quiz_score`` es una
    CACHÉ de ``quiz_attempts``, que conserva el 4/4 con su fecha para siempre.

    ``completed`` es MONÓTONO: se puede conceder (bajó el ``pass_threshold``)
    pero **nunca** revocar (subió). Una actualización jamás empeora al
    estudiante; si pudiera, nadie actualizaría. Por eso el parámetro pasa por
    ``MAX`` y no por asignación directa.

    Es un ``UPDATE`` puro: **no crea filas**. Una lección sin progreso no tiene
    nada que recalificar y devuelve ``False`` (0 filas).

    Sitio natural: ``ProgressRepository.rescore_no_commit`` (data-model §5).
    Vive aquí porque ``repositories/progress.py`` es de otro frente de trabajo;
    mudarla es copiar el SQL y dejar esta función delegando.
    """
    cursor = await db.execute(
        _RESCORE,
        {
            "lesson_id": lesson_id,
            "best_quiz_score": best_quiz_score,
            "completed": None if completed is None else int(completed),
            "completed_via": completed_via,
        },
    )
    return cursor.rowcount > 0


# ═══════════════ §11.8.2 · estado de PUBLICACIÓN de un módulo local ══════════
#
# Distinto de `installed_modules`, y la diferencia importa: aquella tabla dice
# «qué me bajé del bucket», y estas columnas de `modules` dicen «qué he
# publicado YO». Un módulo que el admin escribe aquí y publica nunca tiene fila
# en `installed_modules` — no se lo bajó de ningún sitio.


@dataclass(frozen=True, slots=True)
class PublishedState:
    """Lo último que este equipo publicó de un módulo (§11.8.2 paso 5)."""

    version: int
    checksum: str | None
    published_at: str | None

    @property
    def nunca_publicado(self) -> bool:
        """Sin ``published_at`` no hay versión publicada, valga lo que valga
        ``version``: los módulos del baseline nacen en la 1 sin haber salido
        jamás al bucket, y tratar ese 1 como «ya publicada» haría que la primera
        publicación fuese la v2."""
        return self.published_at is None


async def get_published_state(
    db: "aiosqlite.Connection", module_id: str
) -> PublishedState | None:
    """``modules.version/checksum/published_at``, o ``None`` si no existe."""
    cursor = await db.execute(
        "SELECT version, checksum, published_at FROM modules WHERE id = ?",
        (module_id,),
    )
    fila = await cursor.fetchone()
    if fila is None:
        return None
    return PublishedState(
        version=int(fila["version"]),
        checksum=fila["checksum"],
        published_at=fila["published_at"],
    )


async def set_published_no_commit(
    db: "aiosqlite.Connection",
    module_id: str,
    *,
    version: int,
    checksum: str,
    published_at: str,
    object_path: str,
) -> None:
    """§11.8.2 paso 5 — deja constancia local de lo que se acaba de publicar.

    Sin esto el admin no puede saber en qué versión va sin preguntarle al
    bucket, y el default de `version` (`la publicada + 1`) no tendría de dónde
    salir.

    Si el módulo tiene manifiesto (import vinculado, §11.7) se alinea en la
    misma unidad: lo instalado ES lo recién publicado. Sin esto el siguiente
    refresco vería la versión nueva mayor que la instalada y le ofrecería al
    autor «actualizar» a su propio trabajo (§2.3 #15). ``locally_modified``
    vuelve a ``False`` por lo mismo: ya no hay cambios locales sin publicar.
    Sin fila no se crea ninguna: publicar no es incorporar.
    """
    await db.execute(
        "UPDATE modules SET version = ?, checksum = ?, published_at = ? WHERE id = ?",
        (version, checksum, published_at, module_id),
    )
    await db.execute(
        "UPDATE installed_modules SET "
        "object_path = :object_path, "
        "installed_version = :version, installed_checksum = :checksum, "
        "available_version = :version, available_checksum = :checksum, "
        f"locally_modified = 0, updated_at = {_AHORA} "
        "WHERE module_id = :module_id",
        {
            "object_path": object_path,
            "version": version,
            "checksum": checksum,
            "module_id": module_id,
        },
    )
