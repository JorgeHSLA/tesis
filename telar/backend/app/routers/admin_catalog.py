"""Catálogo del lado ADMIN — api-contract §11.7, §11.8, §11.13.

Tres endpoints, todos detrás de ``require_admin`` (§10.0: el modo autoría es una
variante de DESPLIEGUE, no un login):

* ``GET  /api/v1/admin/catalog/credentials`` — ¿se puede publicar, y con qué
  cuenta? Local salvo ``?probe=true``.
* ``POST /api/v1/admin/catalog/import``      — §11.7 CU-37, traer un módulo del
  bucket para editarlo.
* ``POST /api/v1/admin/modules/{id}/publish`` — §11.8 CU-38, publicarlo.
* ``GET  /api/v1/admin/modules/{id}/publish/status`` — S5 (D+), ¿hay cambios
  sin publicar?
* ``DELETE /api/v1/admin/modules/{id}/publish`` — S7d (CU-41.1), retirarlo del
  catálogo.

Como ``routers/admin.py``, este módulo es OPCIONAL a nivel de artefacto: el
``Dockerfile`` no lo copia con ``TELAR_ADMIN_BUILD=0``, su import falla y
``/api/v1/admin/catalog/*`` responde **404** — la ruta no existe, que es más
fuerte que un 401 (§11.2, seguridad por AUSENCIA).

Dos decisiones que se leen como tests:

1. **``GET /credentials`` responde 200 SIEMPRE**, incluso sin clave y sin bucket
   (§11.9). Que falte la credencial es un estado normal, no un fallo del
   servidor, y el diálogo de autoría necesita poder decir *por qué* no se puede
   publicar antes de que el admin escriba nada.
2. **Publicar NO sostiene el ``write_lock`` mientras sube.** La red va fuera del
   lock; dentro solo se persiste el resultado. Un bucket lento no puede congelar
   los jobs de un estudiante que esté usando el simulador.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.errors import ApiException
from app.repositories import catalog as catalog_repo
from app.routers.admin_deps import require_admin
from app.routers.modules import envelope_ok
from app.schemas.admin_catalog import (
    AdminCatalogCredentialStatus,
    AdminImportRequest,
    AdminImportResult,
    AdminPublishRequest,
    AdminPublishResult,
    AdminPublishStatus,
    AdminUnpublishResult,
)
from app.schemas.admin import ID_PATTERN
from app.schemas.catalog import CatalogIndexEntry, ModuleBundle
from app.services import (
    catalog_import,
    catalog_publish,
    catalog_retirar,
    image_upload,
    module_installer,
)
from app.services.bundle_guard import BundleGuardError, parse_bundle
from app.services.catalog_hash import content_hash
from app.services.content_writer import _persist
from app.services.catalog_publisher import (
    PublisherUnavailable,
    build_publisher,
    inspeccionar_credencial,
)

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    from fastapi import FastAPI

    from app.services.catalog_client import CatalogReadPort

#: Fecha de relleno para construir el bundle SOLO para hashearlo: ``content_hash``
#: ignora ``published_at``, ``version`` y ``notes``.
_FECHA_NEUTRA = "1970-01-01T00:00:00.000Z"

#: El ``{module_id}`` de la ruta se valida con el mismo patrón que los ids del
#: cuerpo (``AdminImportRequest``): uno mal formado es ``422 VALIDATION_ERROR``
#: antes de llegar al repositorio o a las rutas de objeto del bucket.
ModuleIdPath = Annotated[str, Path(pattern=ID_PATTERN)]

logger = logging.getLogger("telar.admin_catalog")

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin-catalog"], dependencies=[Depends(require_admin)]
)


def _settings(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    return settings if settings is not None else get_settings()


# ═══════════════ §11.8.1 GET /admin/catalog/credentials (200 SIEMPRE) ════════


@router.get("/catalog/credentials")
async def admin_catalog_credentials(
    request: Request,
    probe: bool = Query(False, description="Contacta el bucket para comprobar permisos"),
) -> JSONResponse:
    """§11.8.1 — estado de la clave de la cuenta de servicio.

    Sin ``?probe=true`` **no sale a la red**: solo mira el archivo (existe,
    permisos, forma). Con ``probe`` intenta leer el índice con esa credencial,
    que es la operación más barata que demuestra que la cuenta autoriza sobre el
    bucket, y devuelve ``usable:false, reason:"forbidden"`` si no.

    La respuesta **nunca** lleva la ruta de la clave ni el texto de una
    excepción: solo el correo de la cuenta (que es lo que el admin necesita para
    reconocerla) y un ``reason`` de vocabulario cerrado.
    """
    settings = _settings(request)
    credencial = inspeccionar_credencial(settings)
    bucket = settings.catalog_bucket or None

    estado = AdminCatalogCredentialStatus(
        configured=bool(settings.gcs_credentials.strip()),
        usable=credencial.usable,
        client_email=credencial.client_email,
        project_id=credencial.project_id,
        bucket=bucket,
        file_mode=credencial.file_mode,
        probed=False,
        reason=credencial.reason,
    )

    if probe and credencial.usable and settings.catalog_enabled:
        publisher = build_publisher(settings, credencial)
        try:
            await publisher.read_index()
            estado = estado.model_copy(update={"probed": True})
        except PublisherUnavailable as exc:
            logger.warning("probe de credencial falló: reason=%s", exc.reason)
            estado = estado.model_copy(
                update={
                    "probed": True,
                    "usable": False,
                    "reason": "forbidden" if exc.forbidden else None,
                }
            )
        finally:
            await publisher.aclose()

    return envelope_ok(estado)


# ═══════════════════ §11.7 POST /admin/catalog/import ════════════════════════


def _require_catalog(request: Request) -> "CatalogReadPort":
    """El puerto de LECTURA, o el 503 que corresponda (§11.7).

    Importar solo lee del bucket: **no exige credencial de escritura**. Es lo que
    dice §11.7 —«no requiere OAuth: leer sigue siendo anónimo»— y la razón de que
    este endpoint no pase por `inspeccionar_credencial`: un admin puede querer
    bajarse un módulo para estudiarlo sin tener permiso para publicar nada.
    """
    settings = _settings(request)
    if not settings.catalog_enabled:
        raise ApiException(
            "CATALOG_DISABLED", "Este despliegue no tiene catálogo remoto configurado."
        )
    port = getattr(request.app.state, "catalog", None)
    if port is None:
        raise ApiException(
            "CATALOG_UNAVAILABLE",
            "El catálogo remoto no está disponible en este despliegue.",
            details={"reason": "server", "retry_after_s": None},
        )
    return port


@router.post("/catalog/import", status_code=201)
async def admin_catalog_import(
    request: Request, body: AdminImportRequest
) -> JSONResponse:
    """§11.7 CU-37 — traer un módulo del bucket para editarlo.

    Sin ``as_module_id`` el import es **vinculado**: equivale a incorporarlo, y
    el módulo conserva su fila en ``installed_modules``, que es lo que le dice al
    admin sobre qué versión base edita. Con ``as_module_id`` es un **fork**: ids
    propios, ``origin='local'`` y sin manifiesto, o sea contenido nuevo que se
    publicará bajo su id.

    La red va FUERA del ``write_lock``; el servicio se encarga.
    """
    port = _require_catalog(request)
    resultado: AdminImportResult = await catalog_import.import_module(
        request.app, body, catalog=port
    )
    return envelope_ok(resultado, status_code=201)


# ═══════════════ §11.8.2 POST /admin/modules/{id}/publish ════════════════════


async def _bundle_publicado(
    app: "FastAPI", settings: Settings, module_id: str, version: int | None
) -> ModuleBundle | None:
    """El bundle de la ÚLTIMA versión publicada, para poder comparar (§11.8.2).

    Se lee por el puerto de LECTURA, que ya está inyectado y sabe de topes y de
    traducción de errores. Si no se puede traer, se devuelve ``None`` y se
    publica **sin avisos** en vez de fallar: no poder comparar con la versión
    anterior no es motivo para impedir publicar la siguiente — pero sí se
    registra, porque significa que el admin no verá `LESSON_ID_REMOVED`.
    """
    if version is None:
        return None
    port = getattr(app.state, "catalog", None)
    if port is None:
        return None
    try:
        objeto = await port.fetch_module(
            module_id, version, max_bytes=int(settings.catalog_max_bundle_bytes)
        )
        return ModuleBundle.model_validate_json(objeto.data)
    except Exception as exc:
        logger.warning(
            "no se pudo leer la v%s publicada de %s (%s): se publica sin avisos",
            version, module_id, type(exc).__name__,
        )
        return None


async def _entrada_vigente(
    app: "FastAPI", settings: Settings, module_id: str
) -> CatalogIndexEntry | None:
    """La fila del índice de ``module_id``, leída SIN caché (ni de borde ni local).

    Lanza ``ApiException`` si el catálogo no se puede leer: quien llama decide si
    eso es «no se sabe» (estado) o «se sigue sin comparar» (publicar).
    """
    port = getattr(app.state, "catalog", None)
    if not settings.catalog_enabled or port is None:
        raise ApiException("CATALOG_DISABLED", "Este despliegue no tiene catálogo remoto.")
    indice = await module_installer.fetch_index(
        port, max_bytes=int(settings.catalog_max_bundle_bytes), sin_cache=True
    )
    return next((e for e in indice.modules if e.id == module_id), None)


def _lector_de_publicados(
    app: "FastAPI", settings: Settings, module_id: str
):
    """``version → bytes | None`` del bundle ya subido, para el reintento idempotente.

    ``None`` ante cualquier fallo: sin poder leerlo no se puede afirmar que sea
    la misma publicación, y el llamador cae al ``409`` de siempre.
    """

    async def leer(version: int) -> bytes | None:
        port = getattr(app.state, "catalog", None)
        if port is None:
            return None
        try:
            objeto = await port.fetch_module(
                module_id, version, max_bytes=int(settings.catalog_max_bundle_bytes)
            )
        except Exception as exc:
            logger.warning(
                "no se pudo leer la v%s subida de %s (%s)",
                version, module_id, type(exc).__name__,
            )
            return None
        return objeto.data

    return leer


#: Tope de la caché de huellas: el backend vive mucho y cada versión nueva
#: añadiría una entrada para siempre.
_MAX_HUELLAS = 256


async def _huella_publicada(
    app: "FastAPI", settings: Settings, entrada: CatalogIndexEntry
) -> str:
    """``content_hash`` de la versión vigente, cacheado en memoria.

    La clave lleva el checksum del índice: un bundle publicado es inmutable, así
    que mientras el índice anuncie el mismo objeto la huella no puede cambiar y
    el dashboard no vuelve a descargarlo en cada visita.
    """
    cache: dict[tuple[str, int, str], str] | None = getattr(
        app.state, "huellas_publicadas", None
    )
    if cache is None:
        cache = {}
        app.state.huellas_publicadas = cache
    clave = (entrada.id, entrada.version, entrada.checksum)
    if clave not in cache:
        try:
            objeto = await app.state.catalog.fetch_module(
                entrada.id, entrada.version,
                max_bytes=int(settings.catalog_max_bundle_bytes),
            )
        except Exception as exc:
            raise module_installer.api_error_from_catalog(exc) from exc
        # Del bucket: la misma puerta endurecida que usa el instalador.
        try:
            remoto = await asyncio.to_thread(
                parse_bundle,
                objeto.data,
                max_bytes=int(settings.catalog_max_bundle_bytes),
            )
        except BundleGuardError as exc:
            raise ApiException(
                "BUNDLE_INVALID", "La versión publicada no es un bundle válido."
            ) from exc
        # Como en el reintento idempotente (`_misma_publicacion`): content_hash
        # ignora id y versión, así que la identidad se comprueba aparte o la
        # huella de un objeto ajeno pasaría por la de esta publicación.
        if remoto.module.id != entrada.id or remoto.module.version != entrada.version:
            raise ApiException(
                "BUNDLE_INVALID",
                "La versión publicada no corresponde a lo que anuncia el índice.",
            )
        if len(cache) >= _MAX_HUELLAS:
            cache.clear()  # un bundle publicado es inmutable: recalcular es solo coste
        cache[clave] = content_hash(remoto)
    return cache[clave]


def _razon_desconocida(exc: ApiException) -> str:
    if exc.code == "CATALOG_DISABLED":
        return "disabled"
    if isinstance(exc.details, dict) and isinstance(exc.details.get("reason"), str):
        return exc.details["reason"]
    return exc.code.lower()


@router.get("/modules/{module_id}/publish/status")
async def admin_publish_status(
    request: Request, module_id: ModuleIdPath
) -> JSONResponse:
    """S5 (D+) — ¿el contenido local es el de la versión publicada?

    No sale a la red más que para leer: el índice sin caché y, si hace falta, el
    bundle vigente (una vez por versión, luego sale de la caché en memoria).
    Sin red responde ``200`` con ``state="unknown"``: no poder comprobar no
    impide publicar, y el diálogo tiene que poder decirlo.
    """
    app = request.app
    settings = _settings(request)
    estado = await catalog_repo.get_published_state(app.state.db, module_id)
    if estado is None:
        raise ApiException(
            "MODULE_NOT_FOUND", f"No existe el módulo '{module_id}'.", status_code=404
        )
    local_version = None if estado.nunca_publicado else estado.version
    local, _ = catalog_publish.construir_bundle(
        app.state.content, module_id, version=1, published_at=_FECHA_NEUTRA
    )
    base = AdminPublishStatus(
        module_id=module_id,
        state="unknown",
        local_version=local_version,
        content_hash=content_hash(local),
    )

    try:
        entrada = await _entrada_vigente(app, settings, module_id)
        if entrada is None:
            return envelope_ok(base.model_copy(update={"state": "never_published"}))
        remota = await _huella_publicada(app, settings, entrada)
    except ApiException as exc:
        logger.info("no se pudo comprobar %s: %s", module_id, exc.code)
        return envelope_ok(base.model_copy(update={"reason": _razon_desconocida(exc)}))

    if remota != base.content_hash:
        estado_publicacion = "changed"
    elif local_version != entrada.version:
        estado_publicacion = "out_of_sync"
    else:
        estado_publicacion = "unchanged"
    return envelope_ok(
        base.model_copy(
            update={"state": estado_publicacion, "published_version": entrada.version}
        )
    )


@router.post("/modules/{module_id}/publish", status_code=201)
async def admin_publish_module(
    request: Request, module_id: ModuleIdPath, body: AdminPublishRequest
) -> JSONResponse:
    """§11.8.2 — publica un módulo local en el bucket.

    El ``201`` es «publicado»; con ``dry_run`` el status baja a ``200`` porque no
    se creó nada. Que el mismo endpoint sirva para ensayar y para publicar es
    deliberado: el ensayo tiene que recorrer EXACTAMENTE el mismo camino
    —construir, validar, serializar, firmar— o no probaría nada de lo que va a
    pasar al publicar de verdad.
    """
    app = request.app
    settings = _settings(request)
    credencial = inspeccionar_credencial(settings)

    if not credencial.usable:
        # §11.8.1: sin credencial utilizable no se publica, y se dice POR QUÉ
        # con vocabulario cerrado. Se comprueba antes de construir el bundle:
        # serializar un módulo entero para descubrir después que no hay clave es
        # trabajo tirado y un error que llega tarde.
        raise ApiException(
            "CATALOG_CREDENTIALS_INVALID",
            "No hay una credencial de escritura utilizable para publicar.",
            status_code=403,
            details={"reason": credencial.reason},
        )

    db = app.state.db
    estado = await catalog_repo.get_published_state(db, module_id)
    if estado is None:
        raise ApiException(
            "MODULE_NOT_FOUND", f"No existe el módulo '{module_id}'.", status_code=404
        )
    # `version` cuenta lo PUBLICADO, no lo local: un módulo del baseline nace en
    # la 1 sin haber salido nunca al bucket, y tomar ese 1 por «ya publicada»
    # haría que la primera publicación fuese la v2.
    version_publicada = None if estado.nunca_publicado else estado.version
    # CU-37.4: si el índice ya anuncia una versión posterior a la registrada en
    # local, la publicación anterior llegó a la nube y falló al guardarse aquí.
    # Se toma la del índice como «la publicada» para no chocar con ella; si su
    # contenido es el local, `publish_module` solo completa lo que faltó.
    completar_vigente = False
    try:
        entrada = await _entrada_vigente(app, settings, module_id)
    except ApiException as exc:
        logger.info("publicar %s sin leer el índice (%s)", module_id, exc.code)
        entrada = None
    if entrada is not None and entrada.version > (version_publicada or 0):
        version_publicada = entrada.version
        completar_vigente = True
    publicado = await _bundle_publicado(app, settings, module_id, version_publicada)

    publisher = build_publisher(settings, credencial)
    try:
        # La red va FUERA del write_lock: subir puede tardar segundos y el
        # backend tiene un solo worker.
        resultado: AdminPublishResult = await catalog_publish.publish_module(
            app.state.content,
            settings,
            publisher,
            module_id,
            body,
            version_publicada=version_publicada,
            bundle_publicado=publicado,
            leer_publicado=_lector_de_publicados(app, settings, module_id),
            completar_vigente=completar_vigente,
        )
    finally:
        await publisher.aclose()

    if resultado.published:
        # §11.8.2 paso 5. Dentro del lock y por `_persist`, como toda escritura:
        # una unidad, un commit, y el snapshot se cambia después del commit.
        async def _escribir() -> None:
            await catalog_repo.set_published_no_commit(
                db,
                module_id,
                version=resultado.version,
                checksum=resultado.checksum,
                published_at=resultado.published_at,
                object_path=resultado.object_path,
            )

        try:
            async with app.state.write_lock:
                await _persist(app, _escribir)
        except Exception:
            # CU-37.4: el bucket YA tiene la versión (inmutable) y el índice la
            # anuncia; lo único que falló es la constancia local. No es un error
            # de la publicación y no se deshace: se declara, y reintentar la
            # reconcilia (el índice va por delante del estado local).
            # `Exception` a propósito: sea cual sea la causa, la situación del
            # autor es la misma (publicado sin constancia) y `_persist` ya hizo
            # rollback, así que la base queda como antes. Un 500 aquí le haría
            # creer que no se publicó. La traza completa va al log.
            logger.exception("publicado %s v%s; falló el estado local", module_id, resultado.version)
            resultado = resultado.model_copy(update={"local_state_updated": False})

    return envelope_ok(resultado, status_code=200 if body.dry_run else 201)


# ═══════════════ POST /admin/images — imágenes de las lecciones ═══════════════

_IMAGE_CHUNK = 64 * 1024


@router.post("/images", status_code=201)
async def admin_upload_image(request: Request, file: UploadFile) -> JSONResponse:
    """Sube una imagen al bucket y devuelve su URL para pegarla en la lección.

    Las imágenes viven en la nube junto al catálogo (``imagenes/<hash>.<ext>``),
    no dentro del módulo; el texto de la lección solo lleva el enlace, igual que
    el video es un enlace a YouTube. Reglas (todas en ``services/image_upload``):
    se valida el CONTENIDO (bytes mágicos y dimensiones, no la extensión),
    máximo 2 MB y 4096 px por lado, sin SVG.

    Sube a la nube AL MOMENTO, no al publicar el módulo: la URL es la del
    contenido (hash), así que es segura de insertar de inmediato y subir la misma
    imagen dos veces no duplica nada. Requiere la misma credencial que publicar.
    """
    settings = _settings(request)
    credencial = inspeccionar_credencial(settings)
    if not credencial.usable:
        raise ApiException(
            "CATALOG_CREDENTIALS_INVALID",
            "No hay una credencial de escritura utilizable para subir imágenes.",
            status_code=403,
            details={"reason": credencial.reason},
        )

    # Lectura por trozos con tope: un archivo enorme no se carga entero en memoria.
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_IMAGE_CHUNK):
        total += len(chunk)
        if total > image_upload.MAX_IMAGE_BYTES:
            break
        chunks.append(chunk)
    if total > image_upload.MAX_IMAGE_BYTES:
        raise ApiException(
            "INVALID_IMAGE",
            f"La imagen supera el máximo de {image_upload.MAX_IMAGE_BYTES // (1024 * 1024)} MB. "
            "Redúcela o expórtala más comprimida.",
            status_code=413,
        )
    data = b"".join(chunks)

    try:
        info = image_upload.inspect_image(data)
    except image_upload.ImageRejected as exc:
        raise ApiException("INVALID_IMAGE", str(exc), status_code=422) from exc

    object_path = image_upload.object_path_for(data, info.ext)
    publisher = build_publisher(settings, credencial)
    try:
        await publisher.upload_image(object_path, data, info.content_type)
    except PublisherUnavailable as exc:
        raise ApiException(
            "CATALOG_UNAVAILABLE",
            "No se pudo subir la imagen al bucket. Revisa la conexión y los permisos de la clave.",
            status_code=503,
            details={"reason": "forbidden" if exc.forbidden else "unavailable"},
        ) from exc
    finally:
        await publisher.aclose()

    # El bucket va en la URL pública; con el driver local (E2E) puede no haber, y
    # se usa un nombre fijo: la URL sigue cumpliendo el patrón del markdown.
    url = image_upload.public_url(settings.catalog_bucket or "telar-local", object_path)
    return envelope_ok(
        {
            "url": url,
            "object_path": object_path,
            "bytes": len(data),
            "width": info.width,
            "height": info.height,
            "content_type": info.content_type,
        },
        status_code=201,
    )


# ═══════════ §11.8.4 DELETE /admin/modules/{id}/publish (CU-41.1) ════════════


@router.delete("/modules/{module_id}/publish")
async def admin_unpublish_module(
    request: Request, module_id: ModuleIdPath
) -> JSONResponse:
    """§11.8.4 — retira el módulo del catálogo: quita su entrada del índice.

    Misma puerta que publicar (credencial de escritura utilizable) y el módulo
    tiene que existir aquí: se retira desde Autoría. **No escribe nada local**:
    ``modules.version``/``published_at`` se conservan para que republicar salga
    con la versión siguiente y nunca reutilice un número ya subido; el estado
    de publicación pasa a ``never_published`` porque se lee del índice.
    """
    app = request.app
    settings = _settings(request)
    credencial = inspeccionar_credencial(settings)
    if not credencial.usable:
        raise ApiException(
            "CATALOG_CREDENTIALS_INVALID",
            "No hay una credencial de escritura utilizable para retirar módulos.",
            status_code=403,
            details={"reason": credencial.reason},
        )
    if await catalog_repo.get_published_state(app.state.db, module_id) is None:
        raise ApiException(
            "MODULE_NOT_FOUND", f"No existe el módulo '{module_id}'.", status_code=404
        )

    publisher = build_publisher(settings, credencial)
    try:
        resultado: AdminUnpublishResult = await catalog_retirar.retirar_modulo(
            settings, publisher, module_id
        )
    finally:
        await publisher.aclose()
    return envelope_ok(resultado)
