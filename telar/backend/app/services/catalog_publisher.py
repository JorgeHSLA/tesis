"""Puerto de ESCRITURA del catálogo — api-contract §11.8 (CU-38, solo admin).

Simétrico de ``services/catalog_client`` y por las mismas razones: un
``typing.Protocol`` con dos adaptadores, para que los tests y el recorrido E2E
ejerciten el MISMO código de serialización, checksum, avisos y CAS del índice
que producción, cambiando solo el transporte.

* ``gcs`` — ``google-cloud-storage`` con una **cuenta de servicio** (§11.8.1).
  El SDK se importa **dentro** del adaptador, no arriba: es una dependencia de
  ``requirements-admin.txt`` y la imagen del estudiante no la lleva. Importarla
  a nivel de módulo haría que la imagen estudiante fallara al arrancar por una
  dependencia de una operación que ni siquiera puede ejecutar.
* ``http_local`` — escribe ficheros bajo ``TELAR_CATALOG_LOCAL_ROOT``, que es
  justo la raíz que sirve el servidor estático del E2E. Publicar y leer cierran
  el círculo sin GCP.

Este módulo **no** viaja a la imagen del estudiante: el ``Dockerfile`` lo borra
con ``TELAR_ADMIN_BUILD=0``, junto a ``routers/admin_catalog`` y
``schemas/admin_catalog`` (§11.2).

Cuatro propiedades que sostiene y que no pueden delegarse:

1. **Una versión publicada es INMUTABLE.** El bundle sube con
   ``if_generation_match=0`` («crear solo si no existe»). No es una convención
   amable: el estudiante ancla la descarga por ``checksum``, así que reescribir
   un ``v3.json`` convertiría en corrupto lo que ya instaló otra persona.
2. **El índice se reescribe con CAS.** ``if_generation_match=<generation leída>``.
   Dos admins publicando a la vez es raro pero posible, y un
   *read-modify-write* sin CAS pierde en silencio la entrada del otro.
3. **El `Cache-Control` es parte del contrato, no decoración.** Medido contra el
   bucket real: GCS sirve los objetos públicos con ``public, max-age=3600`` por
   defecto y el borde entrega esa copia aunque el objeto ya se haya reescrito
   —se observó el índice en v1 con ``age=227`` cuando el bucket ya tenía v2—.
   Publicar el índice sin ``no-cache`` hace que el aviso de «hay versión nueva»
   tarde hasta una hora (§11.8.2, §11.4.2).
4. **Ni la clave ni el texto crudo de un error salen de aquí.** Los fallos se
   traducen a ``CredentialReason``/``ApiException``; el detalle va al log, igual
   que ``jobs.error_detail``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from app.errors import ApiException
from app.schemas.admin_catalog import CredentialReason

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    from app.config import Settings

logger = logging.getLogger("telar.catalog_publisher")

#: §11.8.2 — el índice MUTA en cada publicación y es quien anuncia cuál es la
#: versión vigente. Sin esto, CU-38 tarda hasta una hora en cumplirse.
CACHE_CONTROL_INDICE = "no-cache, max-age=0, must-revalidate"
#: §11.10 — un bundle publicado no se reescribe nunca (`if_generation_match=0`),
#: así que cachearlo un año es correcto y ahorra operaciones Clase B del nivel
#: gratuito.
CACHE_CONTROL_BUNDLE = "public, max-age=31536000, immutable"

CONTENT_TYPE = "application/json"

#: Permisos MÁXIMOS tolerados en la clave (§11.8.1): ni grupo ni otros.
MODO_MAXIMO = 0o600

ESTADO_HTTP: dict[str, int] = {
    "CATALOG_CREDENTIALS_INVALID": 403,
    "MODULE_NOT_FOUND": 404,
    "VERSION_CONFLICT": 409,
    "BUNDLE_TOO_LARGE": 413,
    "CONTENT_VALIDATION_ERROR": 422,
    "CATALOG_UNAVAILABLE": 503,
    "CATALOG_DISABLED": 503,
}


def _api(code: str, mensaje: str, *, details: Any = None) -> ApiException:
    return ApiException(
        code, mensaje, status_code=ESTADO_HTTP.get(code), details=details
    )


# ═══════════════════════ §11.8.1 · la credencial ═════════════════════════════


@dataclass(frozen=True, slots=True)
class Credencial:
    """Clave de cuenta de servicio ya inspeccionada. Inmutable a propósito.

    ``ruta`` se conserva para poder abrirla al construir el cliente, pero
    **nunca** se serializa: es una ruta del sistema de ficheros del admin.
    """

    ruta: str
    client_email: str | None
    project_id: str | None
    file_mode: str | None
    reason: CredentialReason | None

    @property
    def usable(self) -> bool:
        """Sirve para publicar (sin haber salido a la red todavía)."""
        return self.reason is None


def inspeccionar_credencial(settings: "Settings") -> Credencial:
    """§11.8.1 — ¿sirve la clave? **Sin tocar la red.**

    Se comprueba en este orden porque cada paso vuelve informativo al siguiente:
    existe → se puede leer → los permisos son sanos → es realmente una clave de
    cuenta de servicio. Al revés, un JSON ilegible se reportaría como
    «malformado», que manda al admin a mirar el contenido del archivo en vez de
    sus permisos.

    Que esto sea local es lo que permite a ``GET /admin/catalog/credentials``
    responder 200 siempre (§11.9): saber que falta la clave no requiere Google.
    """
    ruta = (settings.gcs_credentials or "").strip()
    if not ruta:
        return Credencial("", None, None, None, "absent")

    camino = Path(ruta)
    try:
        info = camino.stat()
    except OSError:
        logger.warning("credencial: no se pudo consultar %s", ruta)
        return Credencial(ruta, None, None, None, "unreadable")

    modo = stat.S_IMODE(info.st_mode)
    modo_txt = f"{modo:04o}"
    if modo & ~MODO_MAXIMO:
        # Legible por grupo u otros. Una clave de servicio que puede leer
        # cualquier usuario del sistema no es una credencial, es un archivo.
        logger.warning("credencial: %s tiene permisos %s (se exige 0600)", ruta, modo_txt)
        return Credencial(ruta, None, None, modo_txt, "insecure_mode")

    try:
        datos = json.loads(camino.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        logger.warning("credencial: %s no se pudo leer", ruta)
        return Credencial(ruta, None, None, modo_txt, "unreadable")
    except json.JSONDecodeError:
        logger.warning("credencial: %s no es JSON válido", ruta)
        return Credencial(ruta, None, None, modo_txt, "malformed")

    if not isinstance(datos, dict) or datos.get("type") != "service_account":
        # Se rechaza explícitamente la credencial de USUARIO (OAuth): tiene otro
        # ciclo de vida —el refresh token caduca— y el contrato fijó cuenta de
        # servicio justamente para que publicar no dependa de una sesión.
        logger.warning("credencial: %s no es una clave de cuenta de servicio", ruta)
        return Credencial(ruta, None, None, modo_txt, "malformed")

    correo = datos.get("client_email")
    proyecto = datos.get("project_id") or settings.gcs_project_id or None
    if not correo or not datos.get("private_key"):
        logger.warning("credencial: %s sin client_email o private_key", ruta)
        return Credencial(ruta, None, proyecto, modo_txt, "malformed")

    return Credencial(ruta, correo, proyecto, modo_txt, None)


# ══════════════════════════ el puerto de escritura ═══════════════════════════


@dataclass(frozen=True, slots=True)
class ObjetoEscrito:
    """Resultado de una escritura: la ``generation`` es el ancla del CAS."""

    object_path: str
    generation: int | None
    bytes: int


class CatalogWritePort(Protocol):
    """Escritura del catálogo (§11.8.2) — inyectado como el puerto de lectura.

    Los tres métodos son lo mínimo que exige el contrato: subir un bundle
    inmutable, leer el índice con su ``generation``, y reescribirlo anclado a
    esa ``generation``.
    """

    async def upload_bundle(self, object_path: str, data: bytes) -> ObjetoEscrito:
        """Sube un bundle con ``if_generation_match=0`` (crear solo si no existe).

        Si el objeto ya existe ⇒ `BundleAlreadyPublished`: una versión es
        inmutable, y sobreescribirla rompería a quien ya la instaló.
        """
        ...

    async def read_index(self) -> tuple[bytes, int | None]:
        """``(bytes, generation)``. ``(b"", None)`` si el índice aún no existe."""
        ...

    async def write_index(
        self, data: bytes, *, if_generation_match: int | None
    ) -> ObjetoEscrito:
        """Reescribe el índice con CAS. ``None`` ⇒ ``if_generation_match=0``."""
        ...

    async def aclose(self) -> None:
        """Libera el transporte. Idempotente."""
        ...


class PublisherError(Exception):
    """Base de los fallos del publicador (detalle SOLO en logs)."""


class BundleAlreadyPublished(PublisherError):
    """El objeto ya existe ⇒ ``409 VERSION_CONFLICT``. La versión es inmutable."""


class IndexCasFailed(PublisherError):
    """El índice cambió entre la lectura y la escritura ⇒ reintento o 409."""


class PublisherUnavailable(PublisherError):
    """El bucket no responde o la cuenta no autoriza ⇒ 503/403."""

    def __init__(self, reason: str, *, forbidden: bool = False) -> None:
        self.reason = reason
        self.forbidden = forbidden
        super().__init__(f"publicación no disponible ({reason})")


# ──────────────────────── adaptador local (E2E/tests) ────────────────────────


class LocalCatalogPublisher:
    """Driver ``http_local`` — escribe ficheros bajo ``TELAR_CATALOG_LOCAL_ROOT``.

    Es la contraparte de `LocalHttpCatalogClient`: lo que este escribe es
    exactamente lo que aquel lee, así que el recorrido «publicar → el estudiante
    lo ve» se puede verificar entero sin GCP.

    No versiona objetos (un sistema de ficheros no tiene ``generation``), así que
    el CAS del índice degrada a «reescribir». Es correcto aquí: el driver local
    es de un solo proceso, y el ancla real frente al bucket reescrito sigue
    siendo el ``checksum`` (§11.6.1), que se comprueba aguas arriba.
    """

    def __init__(self, settings: "Settings") -> None:
        raiz = (settings.catalog_local_root or "").strip()
        if not raiz:
            raise _api(
                "CATALOG_DISABLED",
                "El driver local exige TELAR_CATALOG_LOCAL_ROOT para publicar.",
            )
        self._raiz = Path(raiz)
        self._index = settings.catalog_index

    def _destino(self, object_path: str) -> Path:
        # `object_path` se DERIVA de datos validados (`object_path_for`), nunca
        # llega de fuera; aun así se resuelve y se comprueba que cae dentro de la
        # raíz, porque un fallo aquí escribe en el disco del admin.
        destino = (self._raiz / object_path).resolve()
        if not destino.is_relative_to(self._raiz.resolve()):
            raise PublisherError(f"ruta fuera de la raíz local: {object_path}")
        return destino

    async def upload_bundle(self, object_path: str, data: bytes) -> ObjetoEscrito:
        destino = self._destino(object_path)
        if destino.exists():
            raise BundleAlreadyPublished(object_path)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(data)
        return ObjetoEscrito(object_path, None, len(data))

    async def read_index(self) -> tuple[bytes, int | None]:
        destino = self._destino(self._index)
        if not destino.exists():
            return b"", None
        return destino.read_bytes(), None

    async def write_index(
        self, data: bytes, *, if_generation_match: int | None
    ) -> ObjetoEscrito:
        del if_generation_match  # un fichero no versiona: ver el docstring
        destino = self._destino(self._index)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(data)
        return ObjetoEscrito(self._index, None, len(data))

    async def aclose(self) -> None:
        return None


# ─────────────────────────── adaptador GCS (real) ────────────────────────────


class GcsCatalogPublisher:
    """Driver ``gcs`` — ``google-cloud-storage`` con cuenta de servicio (§11.8.1).

    El SDK se importa aquí dentro y no arriba: es dependencia de
    ``requirements-admin.txt``, y la imagen del estudiante no lo tiene instalado.

    Las llamadas del SDK son **síncronas**; se ejecutan en un hilo con
    ``asyncio.to_thread`` para no bloquear el bucle mientras sube. Publicar puede
    tardar segundos y el backend es de un solo worker: bloquear aquí congelaría
    los jobs de cualquier estudiante que esté usando el simulador.
    """

    def __init__(self, settings: "Settings", credencial: Credencial) -> None:
        self._bucket_name = settings.catalog_bucket
        self._index = settings.catalog_index
        self._credencial = credencial
        self._cliente: Any = None

    def _bucket(self) -> Any:
        """Cliente perezoso: construirlo ya lee la clave del disco."""
        if self._cliente is None:
            from google.cloud import storage  # noqa: PLC0415 - dependencia admin
            from google.oauth2 import service_account  # noqa: PLC0415

            cred = service_account.Credentials.from_service_account_file(
                self._credencial.ruta
            )
            # `project` explícito: con credencial de usuario el SDK lanza OSError
            # si falta, y con cuenta de servicio evita depender del ADC del host.
            self._cliente = storage.Client(
                project=self._credencial.project_id, credentials=cred
            )
        return self._cliente.bucket(self._bucket_name)

    async def upload_bundle(self, object_path: str, data: bytes) -> ObjetoEscrito:
        import asyncio  # noqa: PLC0415

        def _subir() -> int | None:
            from google.api_core import exceptions as gexc  # noqa: PLC0415

            blob = self._bucket().blob(object_path)
            blob.cache_control = CACHE_CONTROL_BUNDLE
            blob.metadata = {
                "telar-module-id": object_path.rsplit("/", 2)[-2],
                "telar-sha256": _sha_de(data),
            }
            try:
                # `if_generation_match=0` ⇒ «crear solo si no existe». Es lo que
                # hace inmutable a una versión publicada (§11.8.2 paso 3).
                blob.upload_from_string(
                    data, content_type=CONTENT_TYPE, if_generation_match=0
                )
            except gexc.PreconditionFailed as exc:
                raise BundleAlreadyPublished(object_path) from exc
            except gexc.Forbidden as exc:
                raise PublisherUnavailable("forbidden", forbidden=True) from exc
            except gexc.GoogleAPICallError as exc:
                raise PublisherUnavailable("server") from exc
            return blob.generation

        generation = await asyncio.to_thread(_subir)
        return ObjetoEscrito(object_path, generation, len(data))

    async def read_index(self) -> tuple[bytes, int | None]:
        import asyncio  # noqa: PLC0415

        def _leer() -> tuple[bytes, int | None]:
            from google.api_core import exceptions as gexc  # noqa: PLC0415

            blob = self._bucket().blob(self._index)
            try:
                datos = blob.download_as_bytes()
            except gexc.NotFound:
                # Todavía no hay índice: es el primer módulo que se publica.
                return b"", None
            except gexc.Forbidden as exc:
                raise PublisherUnavailable("forbidden", forbidden=True) from exc
            except gexc.GoogleAPICallError as exc:
                raise PublisherUnavailable("server") from exc
            return datos, blob.generation

        return await asyncio.to_thread(_leer)

    async def write_index(
        self, data: bytes, *, if_generation_match: int | None
    ) -> ObjetoEscrito:
        import asyncio  # noqa: PLC0415

        def _escribir() -> int | None:
            from google.api_core import exceptions as gexc  # noqa: PLC0415

            blob = self._bucket().blob(self._index)
            # Sin esto el catálogo anuncia versiones viejas durante una hora.
            blob.cache_control = CACHE_CONTROL_INDICE
            try:
                blob.upload_from_string(
                    data,
                    content_type=CONTENT_TYPE,
                    if_generation_match=if_generation_match or 0,
                )
            except gexc.PreconditionFailed as exc:
                raise IndexCasFailed(self._index) from exc
            except gexc.Forbidden as exc:
                raise PublisherUnavailable("forbidden", forbidden=True) from exc
            except gexc.GoogleAPICallError as exc:
                raise PublisherUnavailable("server") from exc
            return blob.generation

        generation = await asyncio.to_thread(_escribir)
        return ObjetoEscrito(self._index, generation, len(data))

    async def aclose(self) -> None:
        cliente, self._cliente = self._cliente, None
        if cliente is not None:
            try:
                cliente.close()
            except Exception:  # pragma: no cover - cerrar no debe romper nada
                logger.debug("cerrar el cliente de publicación falló", exc_info=True)


def _sha_de(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_publisher(
    settings: "Settings", credencial: Credencial
) -> CatalogWritePort:
    """Adaptador según ``TELAR_CATALOG_DRIVER``, igual que en la lectura."""
    if settings.catalog_driver == "http_local":
        return LocalCatalogPublisher(settings)
    return GcsCatalogPublisher(settings, credencial)
