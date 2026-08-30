"""Puerto de LECTURA del catálogo remoto — ÚNICO módulo del lado estudiante
que sale a la red (api-contract.md §11.2, §11.3, §11.10; plan de Fase 5 R8).

`CatalogReadPort` es un ``typing.Protocol``, calcado de `DockerServicePort`
(``services/docker_service.py``): el lifespan inyecta un adaptador en
``app.state`` y ningún router/servicio conoce el transporte. Los tests inyectan
``tests/fakes/fake_catalog.py``; **ningún test toca la red**.

Dos adaptadores, seleccionados por ``TELAR_CATALOG_DRIVER``:

* ``gcs`` (producción) — lectura **anónima** de un bucket público con el
  ``httpx`` que el backend ya trae vía ``fastapi[standard]``: dos GET a
  ``storage.googleapis.com``, **sin** ``google-cloud-storage``. Ese SDK
  arrastraría ``requests``, ``urllib3``, ``google-auth`` y ``google-crc32c`` al
  árbol de producción de la imagen del ESTUDIANTE solo para leer un JSON
  público (§11.2). El SDK queda para la imagen admin, que publica.
* ``http_local`` (E2E/desarrollo) — el mismo ``httpx`` contra
  ``TELAR_CATALOG_ENDPOINT``, **rechazado en arranque si no es loopback**. Es lo
  que hace posible el journey E2E completo sin GCP.

Ambos recorren EXACTAMENTE el mismo código de límites y de traducción de
errores: solo difiere cómo se construye la URL. Si divergieran, el E2E dejaría
de decir nada sobre producción.

Tres propiedades que este módulo sostiene y que no pueden delegarse:

1. **El tope de bytes pertenece al PUERTO.** ``max_bytes`` es un argumento
   obligatorio de cada método del ``Protocol``, no una comprobación que el
   llamante haga *después*. Si fuera del llamante, el fake podría olvidarlo y
   la suite pasaría en verde mientras producción descarga sin límite.
2. **Corte duro DURANTE la transmisión y sobre los bytes DESCOMPRIMIDOS.**
   Contar solo lo que llega por el cable es el error clásico: un gzip de 5 KB
   expande a gigabytes. Ver `_DescompresorAcotado`.
3. **El texto crudo de la excepción NUNCA sale del módulo.** Se traduce a
   `CatalogUnavailable` con ``reason ∈ network|forbidden|corrupt|rate_limit|
   server`` (§11.3), que el router convierte en ``503 CATALOG_UNAVAILABLE``. El
   detalle real va al log del servidor, mismo criterio que ``jobs.error_detail``
   (data-model.md §3).
"""

from __future__ import annotations

import ipaddress
import logging
import re
import time
import zlib
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Literal, Protocol
from urllib.parse import quote, urlsplit

import httpx

from ..schemas.admin import ID_PATTERN

if TYPE_CHECKING:  # pragma: no cover
    from ..config import Settings

logger = logging.getLogger("telar.catalog_client")

# ────────────────────────────────── constantes ───────────────────────────────

#: Endpoint de la API JSON de GCS. La descarga anónima de un objeto público es
#: ``GET /storage/v1/b/<bucket>/o/<objeto url-encoded>?alt=media`` — la misma
#: URL que revela el 404 del SDK (investigacionGcs.md §1.8).
GCS_BASE_URL = "https://storage.googleapis.com"

#: ``identity``: no queremos compresión. El publicador (§11.8.2) sube el bundle
#: como ``application/json`` sin ``contentEncoding``, así que pedirla solo
#: abriría la puerta a la bomba de descompresión. Aun así el adaptador sabe
#: descomprimir con techo, porque el ``Content-Encoding`` de la RESPUESTA lo
#: decide el servidor, no nosotros.
DESCARGA_HEADERS = {"Accept-Encoding": "identity", "Accept": "application/json"}

#: Codificaciones de contenido que el adaptador sabe deshacer con techo.
#: Cualquier otra (``br``, ``zstd``, …) ⇒ ``corrupt``: preferimos rechazar a
#: delegar la descompresión en un decodificador sin límite.
ENCODINGS_SOPORTADAS = frozenset({"", "identity", "gzip", "x-gzip"})

#: Nombre de bucket de GCS. Es configuración (confiable), pero acaba dentro de
#: una URL: validarlo impide que un despliegue mal escrito construya rutas raras.
BUCKET_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,221}$")

_ID_RE = re.compile(ID_PATTERN)

#: §11.3 — vocabulario CERRADO de ``error.details.reason``.
CatalogUnavailableReason = Literal[
    "network", "forbidden", "corrupt", "rate_limit", "server"
]


# ─────────────────────────────── excepciones ─────────────────────────────────


class CatalogClientError(Exception):
    """Base de todo lo que sale de este módulo (detalle SOLO en logs)."""


class CatalogConfigError(CatalogClientError):
    """Configuración inutilizable. Se lanza al CONSTRUIR el adaptador.

    Es deliberado que rompa en el arranque y no en la primera request: un
    ``TELAR_CATALOG_ENDPOINT`` apuntando fuera de loopback es un error de
    despliegue, y descubrirlo cuando un estudiante pulsa «instalar» es tarde.
    """


class CatalogUnavailable(CatalogClientError):
    """§11.3 — ``503 CATALOG_UNAVAILABLE``. El router copia `details` tal cual.

    ``causa`` existe para el log del servidor y **no** debe viajar en la
    respuesta: es lo único que podría llevar el texto crudo de la excepción.
    """

    def __init__(
        self,
        reason: CatalogUnavailableReason,
        *,
        retry_after_s: int | None = None,
        causa: str = "",
    ) -> None:
        self.reason: CatalogUnavailableReason = reason
        self.retry_after_s = retry_after_s
        self.causa = causa
        super().__init__(f"catálogo remoto no disponible ({reason})")

    @property
    def details(self) -> dict[str, object]:
        """``error.details`` de §11.3, sin nada derivado de la excepción real."""
        return {"reason": self.reason, "retry_after_s": self.retry_after_s}


class CatalogObjectNotFound(CatalogClientError):
    """El objeto no existe en el bucket ⇒ ``404 REMOTE_MODULE_NOT_FOUND``.

    No es un `CatalogUnavailable`: el bucket respondió, y lo hizo diciendo que
    ese módulo/versión no está publicado. Confundir ambos convertiría «no existe
    el módulo m9 v4» en «el catálogo está caído».
    """

    def __init__(self, object_path: str) -> None:
        self.object_path = object_path
        super().__init__(f"objeto no encontrado en el bucket: {object_path}")


class CatalogObjectTooLarge(CatalogClientError):
    """Se superó ``max_bytes`` ⇒ ``413 BUNDLE_TOO_LARGE``.

    ``bytes_leidos`` es lo que se alcanzó a contar antes de cortar, no el tamaño
    real del objeto: el corte es precisamente para no llegar a conocerlo.
    """

    def __init__(self, object_path: str, max_bytes: int, bytes_leidos: int) -> None:
        self.object_path = object_path
        self.max_bytes = max_bytes
        self.bytes_leidos = bytes_leidos
        super().__init__(
            f"{object_path} supera el tope de {max_bytes} bytes "
            f"(cortado en {bytes_leidos})"
        )


class CatalogGenerationMismatch(CatalogClientError):
    """``if_generation_match`` falló (412) ⇒ ``409 CHECKSUM_MISMATCH``.

    El objeto se reescribió entre el listado y la descarga: lo que llegaría no
    es lo que el estudiante vio en pantalla (§11.6.1, cierre del TOCTOU).
    """

    def __init__(self, object_path: str, generation: int | None) -> None:
        self.object_path = object_path
        self.generation = generation
        super().__init__(
            f"{object_path} ya no está en la generación {generation}"
        )


# ─────────────────────────────── puerto ──────────────────────────────────────


@dataclass(frozen=True, slots=True)
class CatalogObject:
    """Lo que devuelve una lectura: bytes CRUDOS, todavía sin validar.

    Se devuelven bytes y no un DTO a propósito: el sha256 de §11.8.2 se calcula
    sobre estos bytes, y parsear aquí obligaría a re-serializar para hashear —
    exactamente el footgun que la Fase 5 quiere evitar.
    """

    object_path: str
    data: bytes
    #: ``x-goog-generation`` de la respuesta; ``None`` si el transporte no
    #: versiona (driver local) o el header no vino.
    generation: int | None = None


class CatalogReadPort(Protocol):
    """Puerto de lectura del catálogo (§11.2) — inyectado en el lifespan.

    ``max_bytes`` es obligatorio y keyword-only en las dos lecturas: el tope
    pertenece al puerto, y toda implementación —incluido el fake— está obligada
    a cortar. `aclose` sí está en el Protocol (a diferencia de
    `DockerServicePort`, que no expone `close`) porque el recurso a liberar —el
    pool de conexiones— es del adaptador, y el lifespan tiene que cerrarlo sin
    saber cuál hay detrás.
    """

    async def fetch_index(self, *, max_bytes: int) -> CatalogObject:
        """Descarga ``TELAR_CATALOG_INDEX`` (§11.10). Devuelve bytes sin parsear."""
        ...

    async def fetch_module(
        self,
        module_id: str,
        version: int,
        *,
        max_bytes: int,
        generation: int | None = None,
    ) -> CatalogObject:
        """Descarga ``modulos/<module_id>/v<version>.json`` (§11.10).

        ``generation``, si viene, ancla la versión EXACTA del objeto: si el
        bucket lo reescribió, la descarga falla con `CatalogGenerationMismatch`
        en vez de traer otra cosa.
        """
        ...

    async def aclose(self) -> None:
        """Libera el transporte. Idempotente."""
        ...


def object_path_for(prefix: str, module_id: str, version: int) -> str:
    """§11.10 — ``<prefix><module_id>/v<version>.json``.

    La ruta se **deriva** de datos ya validados (``module_id`` contra
    ``ID_PATTERN``, ``version`` entero ≥ 1) y NUNCA se toma del
    ``object_path`` del índice. El índice viene del bucket, o sea de fuera: si
    él dictara la ruta de la petición, el contenido remoto elegiría qué objeto
    pide el backend. Con la ruta derivada, lo peor que puede hacer un índice
    mentiroso es anunciar un ``object_path`` que no cuadra — y eso lo detecta el
    instalador comparando, no el transporte.
    """
    if not _ID_RE.fullmatch(module_id):
        raise ValueError(f"module_id fuera de ID_PATTERN: {module_id!r}")
    if version < 1:
        raise ValueError(f"version debe ser >= 1, no {version!r}")
    base = prefix if prefix.endswith("/") or not prefix else prefix + "/"
    return f"{base}{module_id}/v{version}.json"


# ─────────────────────── descompresión con techo ─────────────────────────────


class _DescompresorAcotado:
    """Descomprime sin materializar jamás más de ``cupo + 1`` bytes por bloque.

    Por qué no basta con ``response.aiter_bytes()`` y contar: httpx descomprime
    cada bloque crudo **de una sola vez y sin techo**
    (``_decoders.GZipDecoder.decode`` llama a ``decompress(data)`` sin
    ``max_length``). Verificado: un gzip de 4,9 KB llega en UN bloque crudo y
    sale como 5.000.000 de bytes en UN solo trozo — el llamante puede contar que
    se pasó, pero solo DESPUÉS de que los 5 MB (o los 4 GB) ya están en RAM.

    Por eso el adaptador lee el stream CRUDO (``aiter_raw``) y descomprime aquí
    con ``max_length``: el corte ocurre de verdad durante la transmisión y sobre
    los bytes descomprimidos, que es donde vive el tope.
    """

    def __init__(self, codificacion: str) -> None:
        # 16 + MAX_WBITS = cabecera gzip. "" / "identity" ⇒ passthrough.
        self._zlib = (
            zlib.decompressobj(16 + zlib.MAX_WBITS)
            if codificacion in ("gzip", "x-gzip")
            else None
        )

    @property
    def comprimido(self) -> bool:
        return self._zlib is not None

    @property
    def completo(self) -> bool:
        """``True`` si el stream comprimido llegó a su fin lógico (no truncado)."""
        return self._zlib is None or self._zlib.eof

    def alimentar(self, bloque: bytes, cupo: int) -> bytes:
        """Devuelve como mucho ``cupo + 1`` bytes: el +1 basta para detectar
        que se pasó sin producir un byte más de lo necesario."""
        if self._zlib is None:
            return bloque
        producido = b""
        entrada = bloque
        while True:
            techo = cupo + 1 - len(producido)
            if techo <= 0:  # ya sabemos que se pasó; no seguimos inflando
                break
            producido += self._zlib.decompress(entrada, techo)
            entrada = self._zlib.unconsumed_tail
            if not entrada:
                break
        return producido


# ──────────────────────────── adaptador httpx ────────────────────────────────


class _HttpxCatalogClient:
    """Tronco común de los dos drivers: transporte, límites y traducción.

    Las subclases solo implementan `_url`. Todo lo que puede fallar de forma
    interesante —tamaño, compresión, códigos HTTP, red— se resuelve aquí una
    sola vez, para que el E2E con ``http_local`` ejercite el mismo código que
    producción.
    """

    def __init__(
        self,
        settings: "Settings",
        *,
        client: httpx.AsyncClient | None = None,
        reloj: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._timeout = float(settings.catalog_timeout_s)
        self._reloj = reloj
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(self._timeout),
            # Sin redirecciones: un 30x del bucket llevaría la petición a un
            # host que no elegimos. Se trata como respuesta inesperada.
            follow_redirects=False,
        )

    # ---- a implementar por cada driver --------------------------------------

    def _url(self, object_path: str, generation: int | None) -> str:
        raise NotImplementedError  # pragma: no cover

    # ---- CatalogReadPort ----------------------------------------------------

    async def fetch_index(self, *, max_bytes: int) -> CatalogObject:
        return await self._descargar(
            self._settings.catalog_index,
            max_bytes=max_bytes,
            generation=None,
            es_indice=True,
        )

    async def fetch_module(
        self,
        module_id: str,
        version: int,
        *,
        max_bytes: int,
        generation: int | None = None,
    ) -> CatalogObject:
        try:
            object_path = object_path_for(
                self._settings.catalog_prefix, module_id, version
            )
        except ValueError as exc:
            # Un id fuera de ``ID_PATTERN`` no puede existir en el bucket: es un
            # 404, no un 500. Se corta ANTES de construir ninguna URL.
            raise CatalogObjectNotFound(f"{module_id}/v{version}") from exc
        return await self._descargar(
            object_path,
            max_bytes=max_bytes,
            generation=generation,
            es_indice=False,
        )

    async def aclose(self) -> None:
        try:
            await self._client.aclose()
        except Exception:  # pragma: no cover — cerrar nunca debe romper el shutdown
            logger.debug("aclose() del cliente de catálogo falló", exc_info=True)

    # ---- descarga -----------------------------------------------------------

    async def _descargar(
        self,
        object_path: str,
        *,
        max_bytes: int,
        generation: int | None,
        es_indice: bool,
    ) -> CatalogObject:
        if max_bytes < 1:
            raise ValueError(f"max_bytes debe ser >= 1, no {max_bytes!r}")
        url = self._url(object_path, generation)
        # §11.1: TELAR_CATALOG_TIMEOUT_S es el timeout «por operación». El
        # timeout de httpx es por lectura de socket, así que un servidor que
        # gotee 1 byte cada 14 s lo esquiva indefinidamente: hace falta también
        # una cota de reloj para la operación entera.
        vence_en = self._reloj() + self._timeout
        try:
            async with self._client.stream(
                "GET", url, headers=DESCARGA_HEADERS, timeout=self._timeout
            ) as respuesta:
                self._traducir_estado(respuesta, object_path, generation, es_indice)
                datos = await self._leer_con_tope(
                    respuesta, object_path, max_bytes=max_bytes, vence_en=vence_en
                )
                return CatalogObject(
                    object_path=object_path,
                    data=datos,
                    generation=_entero(respuesta.headers.get("x-goog-generation")),
                )
        except CatalogClientError:
            raise
        except (httpx.DecodingError, httpx.RemoteProtocolError) as exc:
            # Cuerpo truncado o mal codificado: corrupción de transporte, el
            # equivalente httpx del ``DataCorruption`` del SDK (§11.3).
            raise self._traducir_excepcion("corrupt", object_path, exc) from exc
        except httpx.RequestError as exc:
            # DNS, TLS, conexión rechazada, timeout de socket… todo `network`.
            raise self._traducir_excepcion("network", object_path, exc) from exc

    def _traducir_excepcion(
        self,
        reason: CatalogUnavailableReason,
        object_path: str,
        exc: Exception,
    ) -> CatalogUnavailable:
        """Loguea el detalle REAL y devuelve la excepción que sí puede viajar."""
        logger.warning(
            "catálogo: fallo leyendo %s → reason=%s (%s: %s)",
            object_path, reason, type(exc).__name__, exc,
        )
        return CatalogUnavailable(reason, causa=type(exc).__name__)

    def _traducir_estado(
        self,
        respuesta: httpx.Response,
        object_path: str,
        generation: int | None,
        es_indice: bool,
    ) -> None:
        """Traduce el código HTTP. Nada de lo que devuelve el bucket sale de aquí."""
        codigo = respuesta.status_code
        if codigo == 200:
            return
        retry_after = _entero(respuesta.headers.get("retry-after"))
        if codigo in (401, 403):
            # ── EL CASO QUE UN `except` INGENUO SE DEJA FUERA ──
            # Un bucket que EXISTE pero NO es público no responde 403: responde
            # **401**. Con el SDK eso emerge como
            # ``google.auth.exceptions.InvalidOperation`` («Anonymous
            # credentials cannot be refreshed»), que es un ``GoogleAuthError`` y
            # NO un ``GoogleAPICallError``: un ``except GoogleCloudError`` lo
            # deja escapar y el usuario ve un 500
            # (investigacionGcs.md §1.7, riesgo R-7 del plan). Sin SDK el
            # síntoma es el 401 crudo, y el error simétrico sería mapear solo el
            # 403. Por eso van juntos.
            logger.warning(
                "catálogo: %s respondió %s — ¿el bucket no es público?",
                object_path, codigo,
            )
            raise CatalogUnavailable("forbidden", causa=f"HTTP {codigo}")
        if codigo == 404:
            if es_indice:
                # El índice no es «un módulo»: su ausencia no puede ser
                # REMOTE_MODULE_NOT_FOUND (§11.3), es catálogo inservible.
                raise CatalogUnavailable("server", causa="índice inexistente")
            raise CatalogObjectNotFound(object_path)
        if codigo == 412:
            raise CatalogGenerationMismatch(object_path, generation)
        if codigo == 429:
            raise CatalogUnavailable(
                "rate_limit", retry_after_s=retry_after, causa="HTTP 429"
            )
        if codigo >= 500:
            raise CatalogUnavailable(
                "server", retry_after_s=retry_after, causa=f"HTTP {codigo}"
            )
        # 3xx (no seguimos redirecciones), 400, 406… el bucket contestó algo que
        # no sabemos interpretar: para el usuario es indistinguible de caído.
        logger.warning("catálogo: %s respondió %s inesperado", object_path, codigo)
        raise CatalogUnavailable("server", causa=f"HTTP {codigo}")

    async def _leer_con_tope(
        self,
        respuesta: httpx.Response,
        object_path: str,
        *,
        max_bytes: int,
        vence_en: float,
    ) -> bytes:
        """Lee el cuerpo cortando en seco al superar ``max_bytes`` DESCOMPRIMIDOS."""
        codificacion = respuesta.headers.get("content-encoding", "").strip().lower()
        if codificacion not in ENCODINGS_SOPORTADAS:
            logger.warning(
                "catálogo: %s vino con content-encoding %r no soportado",
                object_path, codificacion,
            )
            raise CatalogUnavailable("corrupt", causa="content-encoding")
        descompresor = _DescompresorAcotado(codificacion)

        declarado = _entero(respuesta.headers.get("content-length"))
        if (
            declarado is not None
            and declarado > max_bytes
            and not descompresor.comprimido
        ):
            # Sin compresión, content-length ES el tamaño final: se rechaza sin
            # leer un solo byte del cuerpo. Con compresión no sirve de nada
            # (mide el cable, no el contenido) y se deja al corte del stream.
            raise CatalogObjectTooLarge(object_path, max_bytes, declarado)

        trozos: list[bytes] = []
        brutos = 0
        total = 0
        async for bloque in respuesta.aiter_raw():
            if self._reloj() > vence_en:
                logger.warning(
                    "catálogo: %s excedió el timeout por operación", object_path
                )
                raise CatalogUnavailable("network", causa="deadline")
            brutos += len(bloque)
            if brutos > max_bytes:
                # Tope también sobre el cable: un cuerpo sin comprimir no puede
                # superar el tope, y uno comprimido tampoco tiene por qué.
                raise CatalogObjectTooLarge(object_path, max_bytes, brutos)
            try:
                salida = descompresor.alimentar(bloque, max_bytes - total)
            except zlib.error as exc:
                logger.warning("catálogo: %s no descomprime (%s)", object_path, exc)
                raise CatalogUnavailable("corrupt", causa="zlib") from exc
            total += len(salida)
            if total > max_bytes:
                raise CatalogObjectTooLarge(object_path, max_bytes, total)
            trozos.append(salida)

        if not descompresor.completo:
            # Gzip que termina antes de su marca de fin: cuerpo truncado.
            logger.warning("catálogo: %s llegó truncado", object_path)
            raise CatalogUnavailable("corrupt", causa="stream truncado")
        return b"".join(trozos)


class GcsCatalogClient(_HttpxCatalogClient):
    """Driver ``gcs`` — lectura ANÓNIMA de un bucket público, sin SDK (§11.2).

    El bucket concede ``roles/storage.objectViewer`` a ``allUsers``, así que la
    petición no lleva credencial alguna: el estudiante nunca se loguea (§11.0.5).
    """

    def __init__(
        self,
        settings: "Settings",
        *,
        client: httpx.AsyncClient | None = None,
        reloj: Callable[[], float] = time.monotonic,
    ) -> None:
        bucket = settings.catalog_bucket
        if not BUCKET_PATTERN.fullmatch(bucket):
            raise CatalogConfigError(
                f"TELAR_CATALOG_BUCKET no es un nombre de bucket válido: {bucket!r}"
            )
        self._bucket = bucket
        super().__init__(settings, client=client, reloj=reloj)

    def _url(self, object_path: str, generation: int | None) -> str:
        # ``safe=""`` codifica también las barras: el nombre del objeto es UN
        # segmento de la ruta de la API JSON, no una jerarquía.
        objeto = quote(object_path, safe="")
        url = (
            f"{GCS_BASE_URL}/storage/v1/b/{quote(self._bucket, safe='')}"
            f"/o/{objeto}?alt=media"
        )
        if generation is not None:
            # ``ifGenerationMatch`` (y no ``generation=``) para que un objeto
            # reescrito dé 412 en vez de servir en silencio otra versión.
            url += f"&ifGenerationMatch={int(generation)}"
        return url


class LocalHttpCatalogClient(_HttpxCatalogClient):
    """Driver ``http_local`` (R8) — el mismo httpx contra un servidor de ficheros.

    Existe para que el journey E2E de la Fase 5 corra entero sin GCP. Comparte
    con `GcsCatalogClient` todo salvo la URL, así que el E2E sí dice algo sobre
    producción.
    """

    def __init__(
        self,
        settings: "Settings",
        *,
        client: httpx.AsyncClient | None = None,
        reloj: Callable[[], float] = time.monotonic,
    ) -> None:
        self._base = _validar_endpoint_loopback(settings.catalog_endpoint)
        super().__init__(settings, client=client, reloj=reloj)

    def _url(self, object_path: str, generation: int | None) -> str:
        # Un servidor de ficheros no versiona objetos: el ancla real sigue
        # siendo ``expected_checksum`` (§11.6.1), que se comprueba aguas arriba.
        del generation
        return f"{self._base}/{quote(object_path, safe='/')}"


def _validar_endpoint_loopback(endpoint: str) -> str:
    """Rechaza en ARRANQUE cualquier ``TELAR_CATALOG_ENDPOINT`` no loopback.

    El driver local existe para el E2E: habla HTTP plano y confía en lo que le
    devuelvan. Apuntarlo a un host remoto sería contenido no confiable llegando
    sin TLS ni verificación, y encima por una ruta que no es la de producción.
    """
    if not endpoint:
        raise CatalogConfigError(
            "TELAR_CATALOG_DRIVER=http_local exige TELAR_CATALOG_ENDPOINT"
        )
    partes = urlsplit(endpoint)
    if partes.scheme not in ("http", "https"):
        raise CatalogConfigError(
            f"TELAR_CATALOG_ENDPOINT debe ser http(s), no {partes.scheme!r}"
        )
    if not _es_loopback(partes.hostname or ""):
        raise CatalogConfigError(
            "TELAR_CATALOG_ENDPOINT debe apuntar a loopback "
            f"(127.0.0.1, ::1, localhost), no a {partes.hostname!r}"
        )
    return endpoint.rstrip("/")


def _es_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def _entero(valor: str | None) -> int | None:
    """Header numérico → int, o ``None``. Nunca lanza: es texto de fuera.

    ``Retry-After`` admite además la forma de fecha HTTP; se ignora a propósito
    (``retry_after_s`` es un entero de segundos en §11.3, y una fecha mal
    interpretada es peor que un ``null``).
    """
    if valor is None:
        return None
    try:
        return int(valor.strip())
    except (ValueError, AttributeError):
        return None


def build_catalog_client(
    settings: "Settings", *, client: httpx.AsyncClient | None = None
) -> CatalogReadPort | None:
    """Adaptador según ``TELAR_CATALOG_DRIVER`` (R8), o ``None`` si no hay catálogo.

    ``None`` ⇔ ``TELAR_CATALOG_BUCKET`` vacío ⇒ todo §11 responde
    ``503 CATALOG_DISABLED`` (§11.1). Un único sitio decide «desactivado», para
    que ``/system`` y los routers no puedan discrepar.
    """
    if not settings.catalog_bucket:
        return None
    if settings.catalog_driver == "http_local":
        return LocalHttpCatalogClient(settings, client=client)
    return GcsCatalogClient(settings, client=client)
