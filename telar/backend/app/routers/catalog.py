"""Catálogo remoto de módulos publicables — api-contract §11.4-§11.6, §11.13.

Los ocho endpoints de §11.13 que viajan en **ambas** imágenes (§11.2). Este
router es deliberadamente delgado: la red la pone ``services/catalog_client``
(puerto ``CatalogReadPort``), la escritura la ponen ``module_installer`` y
``module_updater``, y aquí solo queda decidir **quién puede fallar y con qué
código**, más los dos cruces que el frontend no debe duplicar (§11.5.1: el
estado de un módulo remoto respecto a lo instalado).

Tres invariantes que este archivo sostiene y que se pueden leer como tests:

1. **``GET /catalog/status`` responde 200 SIEMPRE.** Ni toca el puerto de
   catálogo ni lo pide: lee ``app.state.content`` y SQLite. Es lo que permite
   que ``/cursos`` se pinte con el bucket caído, con el bucket sin configurar y
   sin red (§11.0.8, §11.9). Que sea imposible salir a la red desde aquí es
   estructural, no una promesa: la función no recibe el puerto.
2. **``DELETE /catalog/modules/{id}`` es 100 % local** y por eso tampoco exige
   catálogo. Desinstalar con el avión en modo avión tiene que funcionar.
3. **Desinstalar NO borra el progreso. Nunca, sin excepción ni parámetro.**
   ``lesson_progress`` y ``quiz_attempts`` no tienen FK a ``lessons``
   (data-model §8.3) — esa ausencia es la propiedad que hace reversible quitar
   un módulo, y por eso el borrado va por SQL propio y **jamás** por
   ``content_admin.delete_lesson``, que purga el avance a propósito (BL-01).

Todas las escrituras entran por ``content_writer._persist`` bajo
``app.state.write_lock``: una unidad, un commit, revalidación del grafo y swap
atómico de ``app.state.content``. La red **nunca** se sostiene con el lock
tomado: descargar y validar ocurre fuera, escribir dentro.
"""

from __future__ import annotations

import asyncio

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Iterable, Mapping, Sequence

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.errors import ApiException
from app.repositories import catalog as catalog_repo
from app.repositories.content import ContentRepository
from app.routers.modules import envelope_ok
from app.schemas.catalog import (
    BundleLesson,
    CatalogIndex,
    CatalogIndexEntry,
    CatalogStatusResponse,
    CatalogStatusSummary,
    ContentWarning,
    InstallRequest,
    InstallResult,
    InstalledModuleStatus,
    LessonDiffEntry,
    ModuleUpdatePreview,
    ProgressEffectSummary,
    RemoteCatalogResponse,
    RemoteLessonPreview,
    RemoteModuleDetail,
    RemoteModuleSummary,
    UninstallResult,
    UpdateRequest,
)
from app.schemas.updates import UpdateReport
from app.services import course_sync, module_installer, module_updater
from app.services.bundle_guard import BundleGuardError, parse_bundle
from app.services.catalog_client import CatalogClientError, CatalogReadPort
from app.services.content_writer import _persist
from app.services.module_merge import AVISO_LECCION_RETIRADA, _sin_cambios
from app.services.module_updater import read_local_state

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    import aiosqlite
    from fastapi import FastAPI

    from app.repositories.catalog import InstalledModuleRecord
    from app.schemas.catalog import ModuleBundle

logger = logging.getLogger("telar.catalog")

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])

#: Aviso NO bloqueante de §11.5.2: el bundle reclama un id que ya es de otro
#: módulo local. No se inventa vocabulario: es el mismo código con el que el
#: instalador rechazará la operación (§11.3), dicho ANTES de que el estudiante
#: pulse «incorporar» en vez de después.
AVISO_ID_DUPLICADO = "DUPLICATE_ID"

#: Tope de placeholders por sentencia ``IN (...)``. Un módulo llega a 100
#: lecciones; el límite de variables de SQLite convertiría un DELETE explicado
#: en un ``OperationalError`` → 500.
_LOTE_IDS = 400


# ─────────────────────────── utilidades de estado ───────────────────────────


def _settings(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    return settings if settings is not None else get_settings()


def _db(request: Request) -> "aiosqlite.Connection":
    db = getattr(request.app.state, "db", None)
    if db is None:  # pragma: no cover - el lifespan siempre la pone
        raise RuntimeError("app.state.db no está inicializado (lifespan)")
    return db


def _require_catalog(request: Request) -> CatalogReadPort:
    """El puerto de lectura, o el 503 que corresponda (§11.1, §11.3).

    Dos negativas distintas que la UI trata distinto y por eso no se confunden:
    ``CATALOG_DISABLED`` es «este despliegue no tiene bucket» —el frontend
    esconde el item del rail (§2.2)— y ``CATALOG_UNAVAILABLE`` es «lo tiene pero
    hoy no sirve», que sí ofrece reintentar.
    """
    settings = _settings(request)
    if not settings.catalog_enabled:
        raise ApiException(
            "CATALOG_DISABLED",
            "Este despliegue no tiene catálogo remoto configurado.",
        )
    port = getattr(request.app.state, "catalog", None)
    if port is None:
        # Bucket configurado pero adaptador inservible (config rechazada en el
        # arranque, ver main.py). Para el usuario es indistinguible de caído.
        logger.warning(
            "TELAR_CATALOG_BUCKET está configurado pero no hay adaptador de "
            "catálogo en app.state.catalog"
        )
        raise ApiException(
            "CATALOG_UNAVAILABLE",
            "El catálogo remoto no está disponible en este despliegue.",
            details={"reason": "server", "retry_after_s": None},
        )
    return port


def _ahora_iso() -> str:
    """Marca de tiempo con el MISMO formato que los defaults de ``schema.sql``.

    ``strftime('%Y-%m-%dT%H:%M:%fZ','now')`` da milisegundos; replicarlo es lo
    que permite comparar como texto las fechas escritas desde Python y las
    escritas por la DB, que es como se ordenan.
    """
    ahora = datetime.now(timezone.utc)
    return f"{ahora:%Y-%m-%dT%H:%M:%S}.{ahora.microsecond // 1000:03d}Z"


def _parsear_iso(texto: str | None) -> datetime | None:
    """ISO-8601 → ``datetime`` con zona, o ``None``. Nunca lanza.

    La fecha viene de SQLite (o de una caché escrita por otra versión): que una
    marca ilegible tumbe ``/catalog/remote`` con un 500 sería absurdo cuando la
    respuesta correcta es «no sé cuán vieja es, trátala como vencida».
    """
    if not texto:
        return None
    try:
        momento = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        return None
    return momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)


def _lotes(ids: Sequence[str]) -> Iterable[Sequence[str]]:
    for inicio in range(0, len(ids), _LOTE_IDS):
        yield ids[inicio : inicio + _LOTE_IDS]


# ═══════════════════ §11.4.1 GET /catalog/status (OFFLINE-SAFE) ══════════════


def _estado_instalado(
    manifiesto: "InstalledModuleRecord | None", *, catalogo_activo: bool
) -> tuple[str, int | None, str | None]:
    """``(state, available_version, available_checksum)`` de UN módulo.

    ``state`` es DERIVADO, nunca almacenado (§11.4.1). Sin manifiesto el módulo
    es ``local_only``: lo sembró el baseline o lo creó el admin, y no se
    actualiza desde el bucket.

    Con el catálogo **apagado** se silencian ``available_*`` y ningún módulo
    queda en ``update_available``: sin índice no hay nada «disponible» que
    comparar, y encender el chip de actualizar sobre un despliegue donde todo
    §11 responde ``503 CATALOG_DISABLED`` sería ofrecer un botón que no lleva a
    ninguna parte. Lo que SÍ se conserva es lo instalado (versión, checksum,
    fechas): eso son hechos de esta máquina y no dependen de que haya bucket.
    """
    if manifiesto is None:
        return "local_only", None, None
    if not catalogo_activo:
        return "installed", None, None
    disponible = manifiesto.available_version
    if disponible is not None and disponible > manifiesto.installed_version:
        return "update_available", disponible, manifiesto.available_checksum
    return "installed", disponible, manifiesto.available_checksum


async def _status_payload(app: "FastAPI") -> CatalogStatusResponse:
    """§11.4.1 — el estado del catálogo leyendo SOLO SQLite.

    No recibe el puerto de catálogo **a propósito**: así es imposible que una
    refactorización futura cuele aquí una llamada de red y convierta la pantalla
    ``/cursos`` en rehén del bucket (§11.0.8).
    """
    settings = app.state.settings
    db = app.state.db
    content: ContentRepository = app.state.content
    activo = bool(settings.catalog_enabled)

    manifiestos = {
        fila.module_id: fila for fila in await catalog_repo.list_installed(db)
    }
    avances = {registro.lesson_id: registro for registro in await app.state.progress.get_all()}

    modulos: list[InstalledModuleStatus] = []
    for modulo in content.modules():
        # Las archivadas quedan fuera de la ruta lineal y de los denominadores:
        # contarlas haría que «2 de 3» se convirtiera en «2 de 4» al actualizar,
        # que es exactamente la sensación de haber perdido algo (§11.6).
        lecciones = [
            leccion
            for lesson_id in modulo.lesson_ids
            if (leccion := content.lesson(lesson_id)) is not None
            and not leccion.archived
        ]
        manifiesto = manifiestos.get(modulo.id)
        estado, disponible, checksum_disponible = _estado_instalado(
            manifiesto, catalogo_activo=activo
        )
        modulos.append(
            InstalledModuleStatus(
                module_id=modulo.id,
                title=modulo.title,
                origin=modulo.origin,
                state=estado,
                installed_version=(
                    None if manifiesto is None else manifiesto.installed_version
                ),
                installed_checksum=(
                    None if manifiesto is None else manifiesto.installed_checksum
                ),
                available_version=disponible,
                available_checksum=checksum_disponible,
                object_path=None if manifiesto is None else manifiesto.object_path,
                installed_at=None if manifiesto is None else manifiesto.installed_at,
                updated_at=None if manifiesto is None else manifiesto.updated_at,
                last_checked_at=(
                    None if manifiesto is None else manifiesto.last_checked_at
                ),
                lessons_total=len(lecciones),
                # LOCAL, y jamás sale del equipo (§11.0.1). Está aquí para poder
                # decir «si actualizas, conservas 2 de 3».
                lessons_completed=sum(
                    1
                    for leccion in lecciones
                    if (registro := avances.get(leccion.id)) is not None
                    and registro.completed
                ),
            )
        )

    # El resumen se deriva de las MISMAS filas que se devuelven: así no puede
    # haber un despliegue donde la cabecera diga «1 actualizable» y ninguna fila
    # esté en `update_available`.
    instalados = [fila for fila in modulos if fila.state != "local_only"]
    fechas = [
        fila.last_checked_at for fila in instalados if fila.last_checked_at is not None
    ]
    return CatalogStatusResponse(
        catalog_enabled=activo,
        bucket=settings.catalog_bucket or None,
        last_checked_at=max(fechas) if fechas else None,
        modules=modulos,
        summary=CatalogStatusSummary(
            modules_total=len(modulos),
            installed=len(instalados),
            updatable=sum(1 for fila in modulos if fila.state == "update_available"),
            local_only=sum(1 for fila in modulos if fila.state == "local_only"),
            never_checked=sum(
                1 for fila in instalados if fila.last_checked_at is None
            ),
        ),
    )


@router.get("/status")
async def catalog_status(request: Request) -> JSONResponse:
    """§11.4.1 — qué está instalado y qué tiene actualización. **200 siempre.**"""
    return envelope_ok(await _status_payload(request.app))


# ══════════════ §11.4.2 POST /catalog/refresh (la única que sondea) ══════════


@router.post("/refresh")
async def catalog_refresh(request: Request) -> JSONResponse:
    """§11.4.2 — baja el índice y refresca ``available_*`` / ``last_checked_at``.

    Si el bucket no responde, ``installed_modules`` queda **intacta** (ni
    ``last_checked_at`` se toca): la descarga ocurre antes de abrir el lock, así
    que un fallo de red no llega siquiera a intentar escribir.
    """
    port = _require_catalog(request)
    app = request.app
    settings = _settings(request)

    indice = await module_installer.fetch_index(
        port, max_bytes=int(settings.catalog_max_bundle_bytes), sin_cache=True
    )

    publicado = {entrada.id: entrada for entrada in indice.modules}
    ahora = _ahora_iso()
    db = _db(request)

    async with app.state.write_lock:
        manifiestos = await catalog_repo.list_installed(db)

        async def _escribir() -> None:
            for manifiesto in manifiestos:
                entrada = publicado.get(manifiesto.module_id)
                # `set_available_no_commit` es ABSOLUTA: un módulo que
                # desapareció del índice apaga su chip en vez de conservar para
                # siempre una versión que ya nadie publica.
                await catalog_repo.set_available_no_commit(
                    db,
                    manifiesto.module_id,
                    available_version=None if entrada is None else entrada.version,
                    available_checksum=None if entrada is None else entrada.checksum,
                    checked_at=ahora,
                )
            await catalog_repo.save_index_cache_no_commit(
                db,
                bucket=settings.catalog_bucket,
                index=indice.model_dump(mode="json"),
                fetched_at=ahora,
            )

        await _persist(app, _escribir)

    return envelope_ok(await _status_payload(app))


# ═══════════════════ §11.5.1 GET /catalog/remote (red o caché) ═══════════════


@dataclass(frozen=True, slots=True)
class _IndiceServido:
    """El índice que se va a servir, y de dónde salió."""

    index: CatalogIndex
    source: str  # 'network' | 'cache'
    fetched_at: str | None
    stale: bool
    unavailable_reason: str | None


def _cache_utilizable(
    cache: catalog_repo.CatalogIndexCacheRecord | None, bucket: str
) -> CatalogIndex | None:
    """La caché validada, o ``None`` si no sirve. **Caché ilegible = ausente.**

    Se descarta también la de OTRO bucket: cambiar ``TELAR_CATALOG_BUCKET`` es
    cambiar de despliegue, y servir el listado del bucket anterior ofrecería
    módulos que este despliegue no puede descargar.
    """
    if cache is None or cache.bucket != bucket:
        return None
    try:
        return CatalogIndex.model_validate(cache.index)
    except Exception:
        logger.warning("caché del índice ilegible; se trata como ausente")
        return None


async def _guardar_indice(app: "FastAPI", indice: CatalogIndex, ahora: str) -> None:
    """Persiste la caché del índice en su propia unidad (un lock, un commit)."""

    async def _escribir() -> None:
        await catalog_repo.save_index_cache_no_commit(
            app.state.db,
            bucket=app.state.settings.catalog_bucket,
            index=indice.model_dump(mode="json"),
            fetched_at=ahora,
        )

    async with app.state.write_lock:
        await _persist(app, _escribir)


async def _obtener_indice(
    app: "FastAPI", port: CatalogReadPort, *, forzar: bool
) -> _IndiceServido:
    """El índice de §11.10, de la caché o del bucket, con la degradación de §11.9.

    Orden deliberado: caché fresca → red → caché vencida. El último salto es el
    que sostiene el requisito de escritorio: con el bucket caído se sirve
    ``200 + stale:true`` y solo se responde ``503`` cuando **nunca** hubo caché.
    """
    settings = app.state.settings
    guardada = await catalog_repo.get_index_cache(app.state.db)
    cache = _cache_utilizable(guardada, settings.catalog_bucket)
    fecha_cache = None if guardada is None or cache is None else guardada.fetched_at

    if cache is not None and not forzar:
        nacida = _parsear_iso(fecha_cache)
        edad = (
            None
            if nacida is None
            else (datetime.now(timezone.utc) - nacida).total_seconds()
        )
        if edad is not None and 0 <= edad < float(settings.catalog_cache_ttl_s):
            return _IndiceServido(cache, "cache", fecha_cache, False, None)

    try:
        indice = await module_installer.fetch_index(
            port,
            max_bytes=int(settings.catalog_max_bundle_bytes),
            sin_cache=forzar,
        )
    except ApiException as exc:
        if exc.code != "CATALOG_UNAVAILABLE" or cache is None:
            # Un índice fuera de esquema (422) NO se degrada: servir la caché
            # escondería que el publicador está subiendo basura.
            raise
        razon = exc.details.get("reason") if isinstance(exc.details, dict) else None
        logger.info("catálogo inalcanzable; se sirve la caché con stale=true")
        return _IndiceServido(cache, "cache", fecha_cache, True, razon)

    ahora = _ahora_iso()
    await _guardar_indice(app, indice, ahora)
    return _IndiceServido(indice, "network", ahora, False, None)


def _summary_remoto(
    entrada: CatalogIndexEntry, manifiesto: "InstalledModuleRecord | None"
) -> RemoteModuleSummary:
    """Fila del índice + cruce con ``installed_modules`` (§11.5.1).

    El cruce se hace en el backend a propósito: si lo hiciera el frontend
    habría dos definiciones de «update_available» —una en TS y otra en Python—
    y divergirían en la primera prisa.

    ``generation`` va en ``None``: el índice de §11.10 no publica la generación
    de cada objeto (no hay listado del bucket, solo dos GET), así que el ancla
    real de «lo que el usuario vio» es ``expected_checksum`` (§11.6.1).
    """
    if manifiesto is None:
        estado = "available"
    elif entrada.version > manifiesto.installed_version:
        estado = "update_available"
    else:
        estado = "installed"
    return RemoteModuleSummary(
        id=entrada.id,
        title=entrada.title,
        description=entrada.description,
        level=entrada.level,
        order_hint=entrada.order_hint,
        version=entrada.version,
        checksum=entrada.checksum,
        object_path=entrada.object_path,
        generation=None,
        size_bytes=entrada.size_bytes,
        published_at=entrada.published_at,
        author_label=entrada.author_label,
        lessons_count=entrada.lessons_count,
        questions_count=entrada.questions_count,
        estimated_minutes_total=entrada.estimated_minutes_total,
        requires_gpu=entrada.requires_gpu,
        state=estado,
        installed_version=(
            None if manifiesto is None else manifiesto.installed_version
        ),
        installed_checksum=(
            None if manifiesto is None else manifiesto.installed_checksum
        ),
    )


@router.get("/remote")
async def catalog_remote(
    request: Request,
    refresh: bool = Query(False, description="Ignora la caché y va al bucket"),
) -> JSONResponse:
    """§11.5.1 — el catálogo del bucket, cruzado con lo instalado."""
    port = _require_catalog(request)
    servido = await _obtener_indice(request.app, port, forzar=refresh)
    manifiestos = {
        fila.module_id: fila for fila in await catalog_repo.list_installed(_db(request))
    }
    modulos = [
        _summary_remoto(entrada, manifiestos.get(entrada.id))
        for entrada in servido.index.modules
    ]
    return envelope_ok(
        RemoteCatalogResponse(
            bucket=_settings(request).catalog_bucket or None,
            source=servido.source,
            fetched_at=servido.fetched_at,
            stale=servido.stale,
            unavailable_reason=servido.unavailable_reason,
            modules=modulos,
        )
    )


# ═════════════ §11.5.2 GET /catalog/remote/{id} (detalle sin instalar) ═══════


def _entrada_o_404(
    indice: CatalogIndex, module_id: str, version: int | None
) -> CatalogIndexEntry:
    """La fila del índice, o ``404 REMOTE_MODULE_NOT_FOUND``.

    Pedir una ``version`` distinta de la publicada es un 404 y no una descarga a
    ciegas: el índice publica UNA versión por módulo y es la única cuyo checksum
    conocemos. Bajar otra sería traer un objeto que no podemos verificar.
    """
    entrada = next((fila for fila in indice.modules if fila.id == module_id), None)
    if entrada is None:
        raise ApiException(
            "REMOTE_MODULE_NOT_FOUND",
            f"El módulo '{module_id}' no está en el catálogo remoto.",
        )
    if version is not None and version != entrada.version:
        raise ApiException(
            "REMOTE_MODULE_NOT_FOUND",
            f"La versión {version} de '{module_id}' no está publicada "
            f"(la vigente es la {entrada.version}).",
        )
    return entrada


async def _descargar_bundle(
    app: "FastAPI", port: CatalogReadPort, entrada: CatalogIndexEntry
) -> "ModuleBundle":
    """Descarga y valida un bundle **sin escribir nada** (§11.5.2).

    Mismo recorrido que hace el instalador antes de abrir el ``write_lock``, con
    las mismas piezas públicas: tope barato por ``size_bytes`` → puerto →
    ``bundle_guard.parse_bundle`` → checksum canónico → reglas de §10.6. Que sea
    el mismo recorrido es lo que hace que la vista previa no pueda decir «esto
    se instala» de algo que el instalador vaya a rechazar.
    """
    settings = app.state.settings
    max_bytes = int(settings.catalog_max_bundle_bytes)
    if entrada.size_bytes > max_bytes:
        raise ApiException(
            "BUNDLE_TOO_LARGE",
            f"El módulo anuncia {entrada.size_bytes} bytes y el máximo es "
            f"{max_bytes}.",
        )
    try:
        objeto = await port.fetch_module(
            entrada.id, entrada.version, max_bytes=max_bytes
        )
    except CatalogClientError as exc:
        raise module_installer.api_error_from_catalog(exc) from exc

    try:
        # El parseo de un bundle es trabajo de CPU (decodificar, recorrer texto,
        # validar markdown de hasta 64 KiB por lección). Hacerlo en la corrutina deja el
        # event loop parado para TODOS: sin latido de WebSocket, sin /health, sin los
        # jobs de los demás estudiantes. Va a un hilo.
        bundle = await asyncio.to_thread(
            parse_bundle, objeto.data, max_bytes=max_bytes
        )
    except BundleGuardError as exc:
        raise ApiException(
            exc.code, exc.message, status_code=exc.status_code, details=exc.details
        ) from exc

    module_updater.verificar_checksum(
        objeto.data, bundle, esperado=entrada.checksum
    )
    if bundle.module.id != entrada.id or bundle.module.version != entrada.version:
        # El checksum cuadró y aun así el bundle dice ser otro: quien miente es
        # el índice. Se rechaza en vez de enseñar un módulo bajo un id que su
        # autor no escribió.
        raise ApiException(
            "BUNDLE_INVALID",
            "El módulo publicado no coincide con la ruta desde la que se pidió.",
            details=[
                {
                    "field": "module",
                    "reason": (
                        f"se pidió {entrada.id} v{entrada.version} y el objeto "
                        f"declara ser {bundle.module.id} v{bundle.module.version}"
                    ),
                }
            ],
        )
    module_updater.validar_bundle(bundle, max_code_bytes=int(settings.max_code_bytes))
    return bundle


def _preview_de_leccion(
    leccion: BundleLesson, estado: str
) -> RemoteLessonPreview:
    return RemoteLessonPreview(
        lesson_id=leccion.id,
        order=leccion.order,
        title=leccion.title,
        estimated_minutes=leccion.estimated_minutes,
        has_example=leccion.example is not None,
        has_quiz=leccion.quiz is not None,
        quiz_question_count=0 if leccion.quiz is None else len(leccion.quiz.questions),
        requires_gpu=bool(leccion.example is not None and leccion.example.requires_gpu),
        completion_rule=leccion.completion_rule,
        status=estado,
    )


@router.get("/remote/{module_id}")
async def catalog_remote_detail(
    request: Request,
    module_id: str,
    version: int | None = Query(None, ge=1),
) -> JSONResponse:
    """§11.5.2 — qué trae el módulo, antes de decidir incorporarlo."""
    port = _require_catalog(request)
    app = request.app
    db = _db(request)

    # CU-34.2: índice FRESCO, no la caché de `catalog_cache_ttl_s`. El detalle
    # es el paso previo a incorporar: enseñar durante 15 min una versión que ya
    # no es la vigente (o un módulo ya retirado) es prometer lo que no se va a
    # instalar. Sin red, `_obtener_indice` sigue cayendo a la caché (§11.9).
    servido = await _obtener_indice(app, port, forzar=True)
    entrada = _entrada_o_404(servido.index, module_id, version)
    bundle = await _descargar_bundle(app, port, entrada)

    manifiesto = await catalog_repo.get_installed(db, module_id)
    local = await read_local_state(db, module_id)
    instalado = manifiesto is not None

    lecciones: list[RemoteLessonPreview] = []
    avisos: list[ContentWarning] = []
    entrantes = {leccion.id for leccion in bundle.lessons}

    for leccion in sorted(bundle.lessons, key=lambda item: item.order):
        anterior = local.lessons.get(leccion.id)
        if not instalado or anterior is None:
            # §11.5.2: `present`/`changed` solo tienen sentido contra un módulo
            # ya instalado. Con el módulo ausente, todo es nuevo.
            estado = "new"
        else:
            # `_sin_cambios` es la MISMA comparación que usará el merge: si el
            # detalle dijera «sin cambios» con otro criterio, la vista previa y
            # la actualización contarían lecciones distintas.
            estado = "present" if _sin_cambios(anterior, leccion) else "changed"
        lecciones.append(_preview_de_leccion(leccion, estado))

        if not instalado and anterior is not None:
            avisos.append(
                ContentWarning(
                    code=AVISO_ID_DUPLICADO,
                    message=(
                        f"La lección '{leccion.id}' ya pertenece al módulo "
                        f"'{anterior.module_id}'; incorporar este módulo será "
                        "rechazado hasta que uno de los dos cambie de id."
                    ),
                    lesson_id=leccion.id,
                )
            )

    if instalado:
        for anterior in local.lessons.values():
            if (
                anterior.module_id == module_id
                and anterior.archived_at is None
                and anterior.id not in entrantes
            ):
                avisos.append(
                    ContentWarning(
                        code=AVISO_LECCION_RETIRADA,
                        message=(
                            f"La versión {bundle.module.version} ya no incluye "
                            "esta lección; quedará archivada y tu avance en ella "
                            "dejará de contar en la ruta."
                        ),
                        lesson_id=anterior.id,
                    )
                )

    detalle = RemoteModuleDetail(
        **_summary_remoto(entrada, manifiesto).model_dump(),
        lessons=lecciones,
        content_warnings=avisos,
    )
    return envelope_ok(detalle)


# ═══════════════ §11.6.1 POST /catalog/install (CU-36, 201) ══════════════════


@router.post("/install", status_code=201)
async def catalog_install(request: Request, body: InstallRequest) -> JSONResponse:
    """§11.6.1 — incorporar un módulo del catálogo.

    El índice se vuelve a bajar aquí en vez de reusar la caché: instalar es un
    acto explícito y el checksum contra el que se verifica el bundle tiene que
    ser el vigente, no el que se cacheó hace catorce minutos. Si el bucket
    cambió desde la pantalla, ``expected_checksum`` lo convierte en un
    ``409 CHECKSUM_MISMATCH`` claro en vez de una instalación silenciosa de otra
    cosa.
    """
    port = _require_catalog(request)
    resultado = await module_installer.install_module(request.app, body, catalog=port)
    return envelope_ok(resultado, status_code=201)


# ═══════════════ POST /catalog/sync — el curso completo, desde la nube ════════


@router.post("/sync")
async def catalog_sync(request: Request) -> JSONResponse:
    """Incorpora todos los módulos publicados que este equipo aún no tiene.

    La app no trae contenido propio: el frontend llama aquí al arrancar y una
    instalación nueva recibe el curso completo sin que el estudiante haga nada.
    Idempotente: lo ya incorporado (o quitado a propósito) no se repite. Ver
    ``services/course_sync.py``.
    """
    port = _require_catalog(request)
    resultado = await course_sync.sincronizar_curso(request.app, catalog=port)
    return envelope_ok(resultado)


# ═══════ §11.6.2/§11.6.3 vista previa y actualización (CU-39) ════════════════

#: `LessonChange` del contrato es una PARTICIÓN: cada lección aparece una sola
#: vez. `UpdateLessonsReport` reparte lo mismo en más cubos (revised y restored
#: son matices de «ya existía»), así que aquí se colapsan.
_CAMBIO_POR_CUBO: tuple[tuple[str, str], ...] = (
    ("added", "added"),
    ("updated", "updated"),
    ("restored", "updated"),
    ("unchanged", "unchanged"),
    ("archived", "removed"),
    ("removed", "removed"),
)


def _efecto_en_avance(
    lesson_id: str,
    cambio: str,
    *,
    con_avance: bool,
    efectos: Mapping[str, str],
) -> tuple[str, str | None]:
    """``(progress, reason)`` de UNA lección, con el vocabulario del CABLE.

    Cable y plan comparten vocabulario (``preserved``, ``rescored``,
    ``archived``, ``none``). El efecto sale de ``UpdateReport.progress_effects``,
    que es el ``ProgressOp`` que el aplicador ejecutará (CU-38.3): la vista
    previa dice «se recalificará» exactamente cuando la actualización lo hace,
    también si solo cambió una ``correct_key`` y la nota nueva no es nula.
    """
    if cambio == "added" or not con_avance:
        return "none", None
    if cambio == "removed":
        return "archived", AVISO_LECCION_RETIRADA
    if efectos.get(lesson_id) == "rescored":
        return "rescored", "QUIZ_CHANGED"
    return "preserved", None


def _diff_de_lecciones(
    report: UpdateReport, *, con_avance: set[str]
) -> list[LessonDiffEntry]:
    vistas: set[str] = set()
    filas: list[LessonDiffEntry] = []
    for cubo, cambio in _CAMBIO_POR_CUBO:
        for lesson_id in getattr(report.lessons, cubo):
            if lesson_id in vistas:  # `revised` ⊂ `updated`, etc.
                continue
            vistas.add(lesson_id)
            efecto, razon = _efecto_en_avance(
                lesson_id,
                cambio,
                con_avance=lesson_id in con_avance,
                efectos=report.progress_effects,
            )
            filas.append(
                LessonDiffEntry(
                    lesson_id=lesson_id,
                    # Sin título la fila diría `f1Concurrencia`, que para el
                    # estudiante no significa nada. El `None` solo queda si no
                    # se pudo resolver ni por el bundle ni por lo instalado.
                    title=report.lesson_titles.get(lesson_id),
                    change=cambio,
                    progress=efecto,
                    reason=razon,
                )
            )
    return filas


async def _lecciones_con_avance(
    db: "aiosqlite.Connection", lesson_ids: Sequence[str]
) -> set[str]:
    """Cuáles de esas lecciones tienen fila en ``lesson_progress``.

    Sin fila no hay nada que conservar ni que perder: el efecto es ``none``, no
    ``preserved``. Decir «conservas tu avance» de una lección que nunca se abrió
    sería ruido en la única pantalla donde el estudiante decide si actualiza.
    """
    encontradas: set[str] = set()
    for lote in _lotes(list(lesson_ids)):
        marcas = ",".join("?" * len(lote))
        cursor = await db.execute(
            f"SELECT lesson_id FROM lesson_progress WHERE lesson_id IN ({marcas})",
            tuple(lote),
        )
        encontradas.update(fila[0] for fila in await cursor.fetchall())
    return encontradas


async def _a_preview(
    db: "aiosqlite.Connection", report: UpdateReport
) -> ModuleUpdatePreview:
    """``UpdateReport`` → §11.6.2 «qué conservo, qué pierdo»."""
    lecciones = _diff_de_lecciones(
        report,
        con_avance=await _lecciones_con_avance(db, _todas_las_lecciones(report)),
    )
    avance = report.progress
    return ModuleUpdatePreview(
        module_id=report.module_id,
        # `from_version` solo es `None` en una instalación, y aquí el módulo ya
        # está instalado: el 404 de `update_module` corta antes.
        from_version=report.from_version or report.to_version,
        to_version=report.to_version,
        to_checksum=report.to_checksum,
        lessons=lecciones,
        progress_summary=ProgressEffectSummary(
            preserved=avance.preserved,
            rescored=avance.rescored,
            archived=avance.archived,
            unaffected=avance.unaffected,
        ),
        warnings=[
            ContentWarning(
                code=aviso.code, message=aviso.message, lesson_id=aviso.lesson_id
            )
            for aviso in report.warnings
        ],
    )


def _todas_las_lecciones(report: UpdateReport) -> list[str]:
    vistas: list[str] = []
    for cubo, _ in _CAMBIO_POR_CUBO:
        for lesson_id in getattr(report.lessons, cubo):
            if lesson_id not in vistas:
                vistas.append(lesson_id)
    return vistas


@router.get("/modules/{module_id}/update/preview")
async def catalog_update_preview(
    request: Request,
    module_id: str,
    to_version: int | None = Query(None, ge=1),
) -> JSONResponse:
    """§11.6.2 — el diff anclado en ``lesson_id`` **sin escribir una sentencia**.

    Es el endpoint que sostiene la promesa de producto: el estudiante ve qué
    conserva antes de aceptar. Comparte camino con la actualización real
    (``update_module``), así que lo que ve aquí y lo que ocurre después salen del
    mismo plan.
    """
    port = _require_catalog(request)
    report = await module_updater.update_module(
        request.app, module_id, to_version=to_version, preview=True, catalog=port
    )
    return envelope_ok(await _a_preview(_db(request), report))


def _questions_total(content: ContentRepository, module_id: str) -> int:
    modulo = next((fila for fila in content.modules() if fila.id == module_id), None)
    if modulo is None:  # pragma: no cover - lo acaba de escribir la transacción
        return 0
    return sum(
        leccion.quiz_question_count
        for lesson_id in modulo.lesson_ids
        if (leccion := content.lesson(lesson_id)) is not None and not leccion.archived
    )


def _local_order(content: ContentRepository, module_id: str) -> int:
    modulo = next((fila for fila in content.modules() if fila.id == module_id), None)
    return 0 if modulo is None else modulo.order


async def _a_install_result(
    app: "FastAPI", report: UpdateReport
) -> InstallResult:
    """``UpdateReport`` → el ``InstallResult`` que §11.6.3 exige compartir con §11.6.1."""
    manifiesto = await catalog_repo.get_installed(app.state.db, report.module_id)
    if manifiesto is None:  # pragma: no cover - lo garantiza update_module
        raise ApiException(
            "MODULE_NOT_INSTALLED",
            f"El módulo '{report.module_id}' dejó de estar incorporado.",
        )
    content: ContentRepository = app.state.content
    avance = report.progress
    return InstallResult(
        module_id=report.module_id,
        installed_version=report.to_version,
        installed_checksum=report.to_checksum,
        object_path=manifiesto.object_path,
        local_order=_local_order(content, report.module_id),
        # D5: actualizar JAMÁS toca el `order` local. El estudiante ordenó su
        # curso; el autor no puede reordenárselo desde el bucket.
        order_reassigned=False,
        lessons_added=list(report.lessons.added),
        lessons_updated=list(report.lessons.updated) + list(report.lessons.restored),
        lessons_removed=list(report.lessons.archived) + list(report.lessons.removed),
        questions_total=_questions_total(content, report.module_id),
        progress=ProgressEffectSummary(
            preserved=avance.preserved,
            rescored=avance.rescored,
            archived=avance.archived,
            unaffected=avance.unaffected,
        ),
        installed_at=manifiesto.installed_at,
    )


@router.post("/modules/{module_id}/update")
async def catalog_update(
    request: Request, module_id: str, body: UpdateRequest
) -> JSONResponse:
    """§11.6.3 — actualizar conservando el progreso (CU-39)."""
    port = _require_catalog(request)
    report = await module_updater.update_module(
        request.app,
        module_id,
        to_version=body.to_version,
        expected_checksum=body.expected_checksum,
        # en UN solo sitio (`schemas/updates`), no en cinco.
        on_removed_lessons=body.on_removed_lessons,
        catalog=port,
    )
    return envelope_ok(await _a_install_result(request.app, report))


# ═══════════ §11.6.4 DELETE /catalog/modules/{id} (100 % local) ══════════════


async def _ids_de_lecciones(
    db: "aiosqlite.Connection", module_id: str
) -> list[str]:
    cursor = await db.execute(
        "SELECT id FROM lessons WHERE module_id = ?", (module_id,)
    )
    return [fila[0] for fila in await cursor.fetchall()]


@router.delete("/modules/{module_id}")
async def catalog_uninstall(request: Request, module_id: str) -> JSONResponse:
    """§11.6.4 — quitar un módulo incorporado. **No exige catálogo ni red.**

    **El avance SIEMPRE sobrevive.** El contenido se borra por CASCADE y las
    filas de ``lesson_progress``/``quiz_attempts`` quedan huérfanas: reinstalar
    el módulo las recupera, porque los ``lesson_id`` son estables (§11.0.7).

    Por eso el borrado va por SQL propio y no por ``content_admin.delete_lesson``,
    que purga el avance a propósito (BL-01) — correcto cuando el AUTOR borra en
    su máquina, catastrófico aquí.

    Esta ruta tuvo un ``purge_progress=true`` que sí borraba. Se retiró: dejaba
    que cualquier cliente del estudiante destruyera lo ÚNICO que no se puede
    volver a bajar del bucket, y contradecía la promesa que la propia pantalla
    hace al pulsar el botón. Que ya no exista el parámetro es la garantía; que
    el código no tenga rama de purga es lo que la hace no-relajable.
    """
    app = request.app
    db = _db(request)

    async with app.state.write_lock:
        manifiesto = await catalog_repo.get_installed(db, module_id)
        if manifiesto is None:
            # Un módulo `local_only` no se desinstala por aquí: eso es
            # DELETE /admin/modules/{id}, que es otra cosa y exige modo autoría.
            raise ApiException(
                "MODULE_NOT_INSTALLED",
                f"El módulo '{module_id}' no está incorporado desde el catálogo.",
            )
        lecciones = await _ids_de_lecciones(db, module_id)
        con_avance = await _lecciones_con_avance(db, lecciones)

        async def _escribir() -> None:
            # NO hay rama que borre `lesson_progress` ni `quiz_attempts`, y es
            # deliberado: la única forma de garantizar que desinstalar no pierde
            # avance es que aquí no exista el DELETE que podría perderlo.
            # CASCADE: lessons → examples/quiz_questions, y installed_modules.
            # `lesson_progress`/`quiz_attempts` NO tienen FK a `lessons`
            # (data-model §8.3): esa ausencia es lo que hace reversible quitar
            # un módulo, y está PROHIBIDO añadirla.
            await db.execute("DELETE FROM modules WHERE id = ?", (module_id,))

        await _persist(app, _escribir)

    return envelope_ok(
        UninstallResult(
            removed=True,
            module_id=module_id,
            lessons_removed=len(lecciones),
            progress_purged=False,
            progress_archived=len(con_avance),
        )
    )


__all__ = ["router"]
