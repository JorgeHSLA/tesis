"""``CatalogReadPort`` y sus dos adaptadores — CERO RED.

El adaptador real se ejercita con ``httpx.MockTransport``: httpx de verdad
(streaming, headers, códigos, excepciones de transporte) sobre un transporte que
nunca abre un socket. El resto de la suite usa ``tests/fakes/fake_catalog.py``.

Se cubre lo que puede romperse en silencio:

* el corte por tamaño, ANTES de leer (``content-length``) y DURANTE la lectura;
* el gzip que expande por encima del tope — el error clásico de contar solo lo
  que llega por el cable;
* cada traducción de error a ``reason ∈ network|forbidden|corrupt|rate_limit|
  server`` (§11.3), incluido el 401 del bucket que existe pero NO es público;
* el rechazo EN ARRANQUE de un ``TELAR_CATALOG_ENDPOINT`` que no sea loopback.
"""

from __future__ import annotations

import gzip
import zlib

import httpx
import pytest

from app.config import Settings
from app.services.catalog_client import (
    ANTICACHE_PARAM,
    GCS_BASE_URL,
    CatalogConfigError,
    CatalogGenerationMismatch,
    CatalogObject,
    CatalogObjectNotFound,
    CatalogObjectTooLarge,
    CatalogUnavailable,
    GcsCatalogClient,
    LocalHttpCatalogClient,
    build_catalog_client,
    object_path_for,
)

from fakes.fake_catalog import FakeCatalogService

BUCKET = "telar-modulos"


# ─────────────────────────────── utilidades ──────────────────────────────────


def hacer_settings(**extra) -> Settings:
    """Settings de test aislados del entorno del host."""
    base = dict(
        catalog_bucket=BUCKET,
        catalog_prefix="modulos/",
        catalog_index="modulos/index.json",
        catalog_max_bundle_bytes=4194304,
        catalog_timeout_s=5,
        catalog_driver="gcs",
        catalog_endpoint="",
    )
    base.update(extra)
    return Settings(**base)


def reloj_falso(*valores: float):
    """Reloj monótono guionizado; repite el último valor indefinidamente."""
    pendientes = list(valores)

    def _reloj() -> float:
        if len(pendientes) > 1:
            return pendientes.pop(0)
        return pendientes[0]

    return _reloj


def cliente_gcs(handler, *, settings: Settings | None = None, reloj=None):
    """`GcsCatalogClient` sobre ``MockTransport``: httpx real, cero red."""
    ajustes = settings or hacer_settings()
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    extra = {"reloj": reloj} if reloj is not None else {}
    return GcsCatalogClient(ajustes, client=http, **extra)


class _Stream(httpx.AsyncByteStream):
    """Cuerpo que se entrega TROZO A TROZO, como el de una respuesta real.

    ``httpx.Response(200, content=b"…")`` consume el stream al construirse y
    ``aiter_raw()`` ya no puede recorrerlo; el adaptador lee el stream CRUDO
    (para descomprimir con techo él mismo), así que los tests tienen que
    entregar el cuerpo sin consumir.
    """

    def __init__(self, trozos) -> None:
        self._trozos = list(trozos)

    async def __aiter__(self):
        for trozo in self._trozos:
            yield trozo


def respuesta(cuerpo: bytes, **headers) -> httpx.Response:
    """200 con ``content-length`` declarado (el caso normal del bucket)."""
    cabeceras = {"content-length": str(len(cuerpo))}
    cabeceras.update(headers)
    return httpx.Response(200, headers=cabeceras, stream=_Stream([cuerpo]))


def respuesta_chunked(*trozos: bytes, **headers) -> httpx.Response:
    """200 SIN ``content-length``: el tope solo puede aplicarse trozo a trozo."""
    return httpx.Response(200, headers=headers, stream=_Stream(trozos))


# ───────────────────────── derivación de la ruta ─────────────────────────────


def test_object_path_for_deriva_la_ruta_del_contrato():
    assert object_path_for("modulos/", "m9", 3) == "modulos/m9/v3.json"


def test_object_path_for_normaliza_el_prefijo():
    assert object_path_for("modulos", "m9", 1) == "modulos/m9/v1.json"
    assert object_path_for("", "m9", 1) == "m9/v1.json"


@pytest.mark.parametrize("module_id", ["../otro", "m9/../m1", "", "9m", "a" * 65])
def test_object_path_for_rechaza_ids_fuera_de_patron(module_id):
    """La ruta se deriva de datos validados: el bucket nunca la dicta."""
    with pytest.raises(ValueError):
        object_path_for("modulos/", module_id, 1)


def test_object_path_for_rechaza_version_no_positiva():
    with pytest.raises(ValueError):
        object_path_for("modulos/", "m9", 0)


async def test_fetch_module_con_id_invalido_no_sale_a_la_red():
    llamadas: list[httpx.Request] = []

    def handler(request):  # pragma: no cover — no debe llegar a ejecutarse
        llamadas.append(request)
        return respuesta(b"{}")

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogObjectNotFound):
        await cliente.fetch_module("../otro", 1, max_bytes=1024)
    assert llamadas == []
    await cliente.aclose()


# ─────────────────────────── camino feliz (gcs) ──────────────────────────────


async def test_fetch_index_devuelve_bytes_crudos_y_generacion():
    vistas: list[httpx.Request] = []

    def handler(request):
        vistas.append(request)
        return respuesta(b'{"index_format":1}', **{"x-goog-generation": "1755001"})

    cliente = cliente_gcs(handler)
    objeto = await cliente.fetch_index(max_bytes=4096)
    assert isinstance(objeto, CatalogObject)
    assert objeto.data == b'{"index_format":1}'
    assert objeto.object_path == "modulos/index.json"
    assert objeto.generation == 1755001
    # URL exacta de la API JSON anónima (investigacionGcs §1.8).
    url = str(vistas[0].url)
    assert url.startswith(f"{GCS_BASE_URL}/storage/v1/b/{BUCKET}/o/")
    assert "modulos%2Findex.json" in url
    assert "alt=media" in url
    # Lectura ANÓNIMA: ni Authorization ni cookies.
    assert "authorization" not in vistas[0].headers
    # Pedimos identity: no queremos compresión que luego haya que acotar.
    assert vistas[0].headers["accept-encoding"] == "identity"
    await cliente.aclose()


async def test_fetch_module_deriva_la_ruta_y_ancla_la_generacion():
    vistas: list[httpx.Request] = []

    def handler(request):
        vistas.append(request)
        return respuesta(b"{}")

    cliente = cliente_gcs(handler)
    await cliente.fetch_module("m9", 3, max_bytes=4096, generation=42)
    url = str(vistas[0].url)
    assert "modulos%2Fm9%2Fv3.json" in url
    # ifGenerationMatch (y no generation=) para que un objeto reescrito dé 412.
    assert "ifGenerationMatch=42" in url
    await cliente.aclose()


async def test_sin_generacion_no_se_ancla():
    vistas: list[httpx.Request] = []

    def handler(request):
        vistas.append(request)
        return respuesta(b"{}")

    cliente = cliente_gcs(handler)
    await cliente.fetch_module("m9", 3, max_bytes=4096)
    assert "ifGenerationMatch" not in str(vistas[0].url)
    await cliente.aclose()


async def test_generacion_no_numerica_no_rompe():
    def handler(request):
        return respuesta(b"{}", **{"x-goog-generation": "no-es-un-numero"})

    cliente = cliente_gcs(handler)
    assert (await cliente.fetch_index(max_bytes=4096)).generation is None
    await cliente.aclose()


# ──────────────────────────── corte por tamaño ───────────────────────────────


async def test_corte_antes_de_leer_por_content_length():
    """Sin compresión, ``content-length`` ES el tamaño final: se rechaza sin
    leer un byte del cuerpo."""

    def handler(request):
        return respuesta(b"A" * 4096)

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogObjectTooLarge) as exc:
        await cliente.fetch_index(max_bytes=1024)
    assert exc.value.max_bytes == 1024
    assert exc.value.bytes_leidos == 4096
    await cliente.aclose()


async def test_corte_durante_la_transmision_sin_content_length():
    """Respuesta chunked: el tope se aplica trozo a trozo, no al final."""

    def handler(request):
        return respuesta_chunked(*[b"x" * 100] * 20)

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogObjectTooLarge) as exc:
        await cliente.fetch_index(max_bytes=250)
    # 300 = tres trozos: cortó en cuanto se pasó, no tras leer los 2000.
    assert exc.value.bytes_leidos == 300
    await cliente.aclose()


async def test_el_tamano_justo_pasa():
    def handler(request):
        return respuesta(b"A" * 1024)

    cliente = cliente_gcs(handler)
    assert len((await cliente.fetch_index(max_bytes=1024)).data) == 1024
    await cliente.aclose()


async def test_max_bytes_invalido_es_error_de_programacion():
    def handler(request):  # pragma: no cover
        return respuesta(b"{}")

    cliente = cliente_gcs(handler)
    with pytest.raises(ValueError):
        await cliente.fetch_index(max_bytes=0)
    await cliente.aclose()


# ─────────────────────── el gzip que expande (la bomba) ──────────────────────


async def test_gzip_pequeno_que_expande_por_encima_del_tope():
    """5 MB que viajan como 4,9 KB: contar el cable habría dejado pasar la bomba.

    Y no solo se detecta: se corta SIN materializar los 5 MB. ``bytes_leidos``
    es exactamente ``max_bytes + 1``, la prueba de que la descompresión se hizo
    con techo (``_DescompresorAcotado``) y no de un golpe.
    """
    comprimido = gzip.compress(b"A" * 5_000_000)
    assert len(comprimido) < 100_000  # entra de sobra por el cable

    def handler(request):
        return respuesta(comprimido, **{"content-encoding": "gzip"})

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogObjectTooLarge) as exc:
        await cliente.fetch_index(max_bytes=1_000_000)
    assert exc.value.bytes_leidos == 1_000_001
    await cliente.aclose()


async def test_gzip_que_cabe_se_descomprime_entero():
    cuerpo = b'{"index_format":1,"modules":[]}'

    def handler(request):
        return respuesta(gzip.compress(cuerpo), **{"content-encoding": "gzip"})

    cliente = cliente_gcs(handler)
    assert (await cliente.fetch_index(max_bytes=4096)).data == cuerpo
    await cliente.aclose()


async def test_gzip_truncado_es_corrupcion():
    def handler(request):
        return respuesta(
            gzip.compress(b"A" * 5000)[:-4], **{"content-encoding": "gzip"}
        )

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=1_000_000)
    assert exc.value.reason == "corrupt"
    await cliente.aclose()


async def test_gzip_ilegible_es_corrupcion():
    basura = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\x03" + b"\xff" * 16

    def handler(request):
        return respuesta(basura, **{"content-encoding": "gzip"})

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=1_000_000)
    assert exc.value.reason == "corrupt"
    await cliente.aclose()
    # el mismo cuerpo revienta zlib directamente: el fixture es representativo
    with pytest.raises(zlib.error):
        zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(basura, 4096)


async def test_content_encoding_no_soportado_se_rechaza():
    """``br``/``zstd``: preferimos rechazar a delegar en un decodificador sin techo."""

    def handler(request):
        return respuesta(b"loquesea", **{"content-encoding": "br"})

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "corrupt"
    await cliente.aclose()


# ─────────────────── traducción de códigos HTTP (§11.3) ──────────────────────


async def test_bucket_que_existe_pero_no_es_publico_da_401_y_es_forbidden():
    """EL CASO QUE UN ``except`` INGENUO SE DEJA FUERA.

    Un bucket privado no responde 403 al lector anónimo: responde **401**. Con
    el SDK eso emerge como ``google.auth.exceptions.InvalidOperation``, que es
    ``GoogleAuthError`` y NO ``GoogleAPICallError`` — un ``except
    GoogleCloudError`` lo deja escapar (investigacionGcs §1.7). Sin SDK el error
    simétrico sería mapear solo el 403.
    """

    def handler(request):
        return httpx.Response(401, content=b"")

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "forbidden"
    await cliente.aclose()


async def test_403_tambien_es_forbidden():
    def handler(request):
        return httpx.Response(403, content=b"")

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_module("m9", 1, max_bytes=4096)
    assert exc.value.reason == "forbidden"
    await cliente.aclose()


async def test_404_de_un_modulo_es_not_found_no_unavailable():
    """«No existe m9 v4» no puede leerse como «el catálogo está caído»."""

    def handler(request):
        return httpx.Response(404, content=b"")

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogObjectNotFound) as exc:
        await cliente.fetch_module("m9", 4, max_bytes=4096)
    assert exc.value.object_path == "modulos/m9/v4.json"
    await cliente.aclose()


async def test_404_del_indice_es_catalogo_inservible():
    """El índice no es «un módulo»: su ausencia no puede ser REMOTE_MODULE_NOT_FOUND."""

    def handler(request):
        return httpx.Response(404, content=b"")

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "server"
    await cliente.aclose()


async def test_412_es_generacion_desfasada():
    def handler(request):
        return httpx.Response(412, content=b"")

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogGenerationMismatch) as exc:
        await cliente.fetch_module("m9", 2, max_bytes=4096, generation=7)
    assert exc.value.generation == 7
    assert exc.value.object_path == "modulos/m9/v2.json"
    await cliente.aclose()


async def test_429_es_rate_limit_con_retry_after():
    def handler(request):
        return httpx.Response(429, content=b"", headers={"retry-after": "30"})

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.details == {"reason": "rate_limit", "retry_after_s": 30}
    await cliente.aclose()


async def test_retry_after_en_formato_fecha_se_ignora():
    def handler(request):
        return httpx.Response(
            503, content=b"", headers={"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"}
        )

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.details == {"reason": "server", "retry_after_s": None}
    await cliente.aclose()


@pytest.mark.parametrize("codigo", [500, 502, 503, 504])
async def test_5xx_es_server(codigo):
    def handler(request):
        return httpx.Response(codigo, content=b"")

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "server"
    await cliente.aclose()


@pytest.mark.parametrize("codigo", [302, 400, 406])
async def test_respuesta_inesperada_es_server(codigo):
    """No seguimos redirecciones: un 30x lleva la petición a un host que no elegimos."""

    def handler(request):
        return httpx.Response(codigo, content=b"", headers={"location": "http://otro/"})

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "server"
    await cliente.aclose()


# ───────────────── traducción de excepciones de transporte ───────────────────


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("dns no resuelve"),
        httpx.ReadTimeout("se agotó la lectura"),
        httpx.ConnectTimeout("se agotó la conexión"),
        httpx.PoolTimeout("sin conexiones"),
    ],
)
async def test_fallos_de_red_son_network(error):
    def handler(request):
        raise error

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "network"
    await cliente.aclose()


@pytest.mark.parametrize(
    "error",
    [
        httpx.RemoteProtocolError("el servidor cortó a mitad"),
        httpx.DecodingError("cuerpo mal codificado"),
    ],
)
async def test_corrupcion_de_transporte_es_corrupt(error):
    """Equivalente httpx del ``DataCorruption`` del SDK (§11.3)."""

    def handler(request):
        raise error

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "corrupt"
    await cliente.aclose()


async def test_stream_que_se_corta_a_mitad_es_corrupt():
    async def cuerpo():
        yield b"{"
        raise httpx.RemoteProtocolError("conexión cerrada sin terminar el cuerpo")

    def handler(request):
        return httpx.Response(200, content=cuerpo())

    cliente = cliente_gcs(handler)
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "corrupt"
    await cliente.aclose()


async def test_timeout_por_operacion_corta_el_goteo():
    """§11.1: el timeout es POR OPERACIÓN. El de httpx es por lectura de socket,
    así que un servidor que gotee un byte cada 4 s lo esquivaría para siempre."""

    def handler(request):
        return respuesta_chunked(*[b"x"] * 50)

    cliente = cliente_gcs(handler, reloj=reloj_falso(0.0, 1.0, 999.0))
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "network"
    await cliente.aclose()


# ───────────────────────── el detalle nunca viaja ────────────────────────────


def test_details_es_el_del_contrato_y_no_lleva_el_texto_crudo():
    error = CatalogUnavailable(
        "network", causa="ConnectError: [Errno -2] Name or service not known"
    )
    assert error.details == {"reason": "network", "retry_after_s": None}
    assert set(error.details) == {"reason", "retry_after_s"}
    assert "Errno" not in str(error.details)


# ───────────────────── driver http_local (R8) y arranque ─────────────────────


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://127.0.0.1:8099",
        "http://localhost:8099/base",
        "http://[::1]:8099",
        "https://127.0.0.99:8099",
    ],
)
def test_endpoint_loopback_se_acepta(endpoint):
    settings = hacer_settings(catalog_driver="http_local", catalog_endpoint=endpoint)
    assert isinstance(
        build_catalog_client(settings), LocalHttpCatalogClient
    )


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://10.0.0.5:8099",
        "http://storage.googleapis.com",
        "http://0.0.0.0:8099",
        "http://192.168.1.10",
        "http://evil.example.com/127.0.0.1",
    ],
)
def test_endpoint_no_loopback_se_rechaza_en_arranque(endpoint):
    """El driver local habla HTTP plano y confía en lo que le devuelvan:
    apuntarlo fuera sería contenido no confiable sin TLS y por una ruta que no
    es la de producción. Y falla al ARRANCAR, no cuando alguien pulsa instalar."""
    settings = hacer_settings(catalog_driver="http_local", catalog_endpoint=endpoint)
    with pytest.raises(CatalogConfigError):
        build_catalog_client(settings)


@pytest.mark.parametrize("endpoint", ["", "ftp://127.0.0.1", "127.0.0.1:8099"])
def test_endpoint_mal_formado_se_rechaza_en_arranque(endpoint):
    settings = hacer_settings(catalog_driver="http_local", catalog_endpoint=endpoint)
    with pytest.raises(CatalogConfigError):
        build_catalog_client(settings)


async def test_driver_local_pide_la_misma_ruta_de_objeto():
    vistas: list[httpx.Request] = []

    def handler(request):
        vistas.append(request)
        return respuesta(b"{}")

    settings = hacer_settings(
        catalog_driver="http_local", catalog_endpoint="http://127.0.0.1:8099/"
    )
    cliente = LocalHttpCatalogClient(
        settings, client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    await cliente.fetch_module("m9", 3, max_bytes=4096, generation=7)
    assert str(vistas[0].url) == "http://127.0.0.1:8099/modulos/m9/v3.json"
    await cliente.aclose()


async def test_los_dos_drivers_comparten_los_limites():
    """Si el E2E corriera por otro camino de validación, no diría nada de producción."""
    comprimido = gzip.compress(b"A" * 5_000_000)

    def handler(request):
        return respuesta(comprimido, **{"content-encoding": "gzip"})

    settings = hacer_settings(
        catalog_driver="http_local", catalog_endpoint="http://127.0.0.1:8099"
    )
    cliente = LocalHttpCatalogClient(
        settings, client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    with pytest.raises(CatalogObjectTooLarge):
        await cliente.fetch_index(max_bytes=1_000_000)
    await cliente.aclose()


# ───────────────────────────── fábrica (§11.1) ───────────────────────────────


def test_sin_bucket_no_hay_catalogo():
    """``TELAR_CATALOG_BUCKET`` vacío ⇒ ``None`` ⇒ ``503 CATALOG_DISABLED``."""
    settings = hacer_settings(catalog_bucket="")
    assert build_catalog_client(settings) is None
    assert settings.catalog_enabled is False


def test_con_bucket_el_driver_por_defecto_es_gcs():
    settings = hacer_settings()
    assert settings.catalog_enabled is True
    assert isinstance(build_catalog_client(settings), GcsCatalogClient)


@pytest.mark.parametrize("bucket", ["Telar-Modulos", "bucket con espacios", "a", "b/c"])
def test_nombre_de_bucket_invalido_se_rechaza_en_arranque(bucket):
    with pytest.raises(CatalogConfigError):
        build_catalog_client(hacer_settings(catalog_bucket=bucket))


async def test_aclose_cierra_el_transporte():
    def handler(request):  # pragma: no cover
        return respuesta(b"{}")

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    cliente = GcsCatalogClient(hacer_settings(), client=http)
    await cliente.aclose()
    assert http.is_closed
    await cliente.aclose()  # idempotente


# ──────────────────────────────── el fake ────────────────────────────────────


def test_el_fake_cumple_el_protocol():
    """La costura de inyección es el Protocol: el fake expone TODO el puerto."""
    fake = FakeCatalogService()
    for metodo in ("fetch_index", "fetch_module", "aclose"):
        assert callable(getattr(fake, metodo)), metodo


async def test_el_fake_sirve_lo_publicado():
    fake = FakeCatalogService()
    fake.publicar_indice({"index_format": 1, "modules": []})
    ruta = fake.publicar_modulo("m9", 3, b'{"bundle_format":1}', generation=99)

    indice = await fake.fetch_index(max_bytes=4096)
    assert b'"index_format"' in indice.data
    modulo = await fake.fetch_module("m9", 3, max_bytes=4096)
    assert modulo.object_path == ruta == "modulos/m9/v3.json"
    assert modulo.data == b'{"bundle_format":1}'
    assert modulo.generation == 99
    assert fake.module_calls[0]["max_bytes"] == 4096


async def test_el_fake_respeta_el_tope_del_puerto():
    """Si el fake ignorara ``max_bytes``, la suite pasaría en verde mientras
    producción descarga sin límite: por eso el tope es del PUERTO."""
    fake = FakeCatalogService()
    fake.publicar_modulo("m9", 1, b"A" * 2048)
    with pytest.raises(CatalogObjectTooLarge):
        await fake.fetch_module("m9", 1, max_bytes=1024)
    with pytest.raises(ValueError):
        await fake.fetch_module("m9", 1, max_bytes=0)


async def test_el_fake_distingue_ausencias_como_el_adaptador_real():
    fake = FakeCatalogService()
    with pytest.raises(CatalogUnavailable) as exc:
        await fake.fetch_index(max_bytes=4096)
    assert exc.value.reason == "server"

    fake.publicar_indice(b"{}")
    with pytest.raises(CatalogObjectNotFound):
        await fake.fetch_module("m9", 1, max_bytes=4096)
    with pytest.raises(CatalogObjectNotFound):
        await fake.fetch_module("../otro", 1, max_bytes=4096)


async def test_el_fake_ancla_la_generacion():
    fake = FakeCatalogService()
    fake.publicar_modulo("m9", 1, b"{}", generation=5)
    assert (await fake.fetch_module("m9", 1, max_bytes=64, generation=5)).data == b"{}"
    with pytest.raises(CatalogGenerationMismatch):
        await fake.fetch_module("m9", 1, max_bytes=64, generation=6)


async def test_el_fake_guiona_fallos_con_las_excepciones_reales():
    fake = FakeCatalogService()
    fake.fallar_indice(CatalogUnavailable("network", causa="guion"))
    fake.publicar_modulo("m9", 1, b"{}")
    fake.fallar_modulo("m9", 1, CatalogUnavailable("rate_limit", retry_after_s=12))

    with pytest.raises(CatalogUnavailable) as indice:
        await fake.fetch_index(max_bytes=4096)
    assert indice.value.reason == "network"
    with pytest.raises(CatalogUnavailable) as modulo:
        await fake.fetch_module("m9", 1, max_bytes=4096)
    assert modulo.value.details == {"reason": "rate_limit", "retry_after_s": 12}


async def test_el_fake_acepta_texto_y_se_cierra():
    fake = FakeCatalogService()
    fake.publicar_indice("{}")
    assert (await fake.fetch_index(max_bytes=64)).data == b"{}"
    await fake.aclose()
    assert fake.cerrado is True


# ══════════ la caché de borde de Google, y el mapeo de estados REALES ════════
#
# Los dos bloques de abajo fijan comportamiento OBSERVADO contra
# `storage.googleapis.com` con el bucket real `clasestelar` (2026-08-30), no
# comportamiento supuesto. Son justo lo que el driver `http_local` no puede
# enseñar: un servidor estático en loopback no tiene caché de borde ni modelo
# de permisos.


async def test_relectura_forzada_rompe_la_cache_de_borde_de_google():
    """``sin_cache=True`` cambia la URL, que es lo ÚNICO que cambia la respuesta.

    Verificado contra el bucket real: tras publicar la v2 del índice, el borde
    seguía sirviendo la v1 con ``age=227`` y ``Cache-Control: public,
    max-age=3600``. Mandar ``Cache-Control: no-cache`` en la PETICIÓN no cambió
    nada —se probó—, porque lo que decide es la CLAVE de caché, o sea la URL.
    Sin esto, el aviso de «hay versión nueva» (CU-38) puede tardar una hora.
    """
    vistas: list[httpx.Request] = []

    def handler(request):
        vistas.append(request)
        return respuesta(b'{"index_format":1}')

    cliente = cliente_gcs(handler)
    await cliente.fetch_index(max_bytes=4096)
    await cliente.fetch_index(max_bytes=4096, sin_cache=True)
    await cliente.fetch_index(max_bytes=4096, sin_cache=True)

    normal, forzada_1, forzada_2 = (str(v.url) for v in vistas)
    # La lectura NORMAL no lleva el parámetro: sigue aprovechando el borde, que
    # es lo correcto para el 99 % de las lecturas.
    assert ANTICACHE_PARAM not in normal
    assert f"{ANTICACHE_PARAM}=" in forzada_1
    # Y dos relecturas forzadas NO comparten clave de caché. Con una marca de
    # reloj en vez de un valor aleatorio, dos refrescos en el mismo milisegundo
    # se pisarían y el segundo volvería a leer del borde.
    assert forzada_1 != forzada_2
    await cliente.aclose()


async def test_el_driver_local_ignora_el_anticache():
    """No hay borde que romper contra un fichero en loopback: la URL no cambia.

    Importa que sea así y no «por casualidad»: si el driver local añadiera el
    parámetro, el servidor estático del E2E devolvería 404 y el recorrido
    dejaría de decir nada sobre producción.
    """
    vistas: list[httpx.Request] = []

    def handler(request):
        vistas.append(request)
        return respuesta(b"{}")

    ajustes = hacer_settings(
        catalog_driver="http_local", catalog_endpoint="http://127.0.0.1:8095"
    )
    cliente = LocalHttpCatalogClient(
        ajustes, client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    await cliente.fetch_index(max_bytes=4096)
    await cliente.fetch_index(max_bytes=4096, sin_cache=True)

    assert str(vistas[0].url) == str(vistas[1].url)
    assert ANTICACHE_PARAM not in str(vistas[1].url)
    await cliente.aclose()


@pytest.mark.parametrize(
    "codigo, cuerpo",
    [
        # API JSON (la que usa el adaptador), bucket privado, lector anónimo.
        # Observado: 401 «Anonymous caller does not have storage.objects.get
        # access». google-auth lo convierte en InvalidOperation, que NO es un
        # GoogleAPICallError — de ahí el riesgo R-7 del plan.
        (401, b"Anonymous caller does not have storage.objects.get access"),
        # API XML sobre el MISMO bucket privado: 403 AccessDenied. Dos códigos
        # para la misma causa según la superficie; el adaptador no puede
        # depender de cuál toca.
        (403, b"<Error><Code>AccessDenied</Code></Error>"),
    ],
)
async def test_bucket_privado_es_forbidden_no_catalogo_caido(codigo, cuerpo):
    """Un bucket que existe pero no es público ⇒ ``forbidden``, nunca ``server``.

    La distinción no es cosmética: ``forbidden`` es «el admin configuró mal el
    bucket» —acción: revisarlo— y ``server``/``network`` es «Google está
    caído» —acción: reintentar—. Confundirlos manda al estudiante a esperar
    por algo que nadie va a arreglar solo.
    """
    cliente = cliente_gcs(lambda _r: httpx.Response(codigo, content=cuerpo))
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "forbidden"
    # El texto crudo de Google NO viaja: filtra el nombre del bucket y la ruta.
    assert cuerpo.decode()[:20] not in str(exc.value.details)
    await cliente.aclose()


async def test_bucket_o_objeto_inexistente_es_404_y_no_se_confunde_con_privado():
    """Observado: bucket inexistente y objeto ausente dan los DOS 404.

    O sea, GCS **no** filtra si el bucket existe. Por eso un 404 no puede
    traducirse a «no tienes permiso» ni al revés: para el índice es catálogo
    inservible (``server``), y para un módulo es ``REMOTE_MODULE_NOT_FOUND``.
    """
    cliente = cliente_gcs(lambda _r: httpx.Response(404, content=b"No such object"))
    # El índice ausente NO es «módulo no encontrado»: es catálogo inservible.
    with pytest.raises(CatalogUnavailable) as exc:
        await cliente.fetch_index(max_bytes=4096)
    assert exc.value.reason == "server"
    # Un módulo ausente sí es un 404 de dominio.
    with pytest.raises(CatalogObjectNotFound):
        await cliente.fetch_module("mFundamentos", 9, max_bytes=4096)
    await cliente.aclose()
