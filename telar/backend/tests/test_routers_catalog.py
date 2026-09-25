"""Endpoints del catálogo remoto — api-contract §11.4-§11.6, §11.9, §11.13.

Toda la suite corre **sin red**: el bucket es ``FakeCatalogService``, que cumple
el ``typing.Protocol`` ``CatalogReadPort`` sobre un dict en memoria. Ningún test
abre un socket.

Los dos tests que dan sentido al archivo son los del final:
``test_con_el_bucket_caido_el_contenido_responde_identico`` y su pareja sin
bucket configurado. Son el **requisito de escritorio** (§11.9): la app tiene que
seguir siendo plenamente usable con lo ya instalado, y ese es exactamente el
invariante que se rompe sin que nadie se dé cuenta cuando alguien mete una
llamada al bucket en un camino de §3-§6.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import DEFAULT_STATUS
from app.repositories import catalog as catalog_repo
from app.services.catalog_client import (
    CatalogObjectTooLarge,
    CatalogUnavailable,
)
from app.services.catalog_hash import bundle_checksum
from app.schemas.catalog import ModuleBundle

from conftest import build_app
from fakes.fake_catalog import FakeCatalogService

BUCKET = "telar-modulos"
MARKDOWN = "# Título\n\nUn párrafo dentro del subset.\n"


# ═══════════════════════════ envelope (§1) ══════════════════════════════════


def ok(response: Any, status: int = 200) -> dict:
    assert response.status_code == status, response.text
    cuerpo = response.json()
    assert cuerpo["success"] is True and cuerpo["error"] is None, cuerpo
    return cuerpo["data"]


def falla(response: Any, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    cuerpo = response.json()
    assert cuerpo["success"] is False and cuerpo["data"] is None, cuerpo
    assert cuerpo["error"]["code"] == code, cuerpo
    return cuerpo["error"]


# ════════════════════════ fábricas de bundles ═══════════════════════════════


def ejemplo(eid: str, **over) -> dict:
    base = {
        "id": eid,
        "title": "Ejemplo mínimo",
        "filename": "main.py",
        "difficulty": 1,
        "teaches": "una directiva",
        "directives": ["parallel"],
        "threads_configurable": True,
        "fixed_threads": None,
        "fixed_threads_note": None,
        "sweeps_threads": False,
        "self_measures": False,
        "parser_id": "none",
        "default_timeout_s": 30,
        "est_run_seconds": 5,
        "enabled": True,
        "requires_gpu": False,
        "expected_output_note": "imprime algo",
        "takeaways": ["algo se aprendió"],
        "source_code": "print('hola')\n",
    }
    base.update(over)
    return base


def pregunta(order: int = 1, **over) -> dict:
    base: dict[str, Any] = {
        "order": order,
        "text": f"Pregunta {order}",
        "options": [
            {"key": "a", "text": "Abre una región paralela"},
            {"key": "b", "text": "Cierra el programa"},
        ],
        "correct_key": "a",
        "explanation": "Abre la región paralela.",
    }
    base.update(over)
    return base


def quiz(*preguntas: dict, pass_threshold: float = 0.6) -> dict:
    return {
        "pass_threshold": pass_threshold,
        "questions": list(preguntas) or [pregunta()],
    }


def leccion(lid: str, *, order: int = 1, **over) -> dict:
    base: dict[str, Any] = {
        "id": lid,
        "order": order,
        "title": f"Lección {lid}",
        "estimated_minutes": 10,
        "content_markdown": MARKDOWN,
        "video_url": None,
        "enabled": True,
        "completion_rule": "quiz",
        "pass_threshold": 0.6,
        "recommended": [],
        "example": ejemplo(f"{lid}-ej"),
        "quiz": quiz(),
    }
    base.update(over)
    return base


def sellar(payload: dict) -> tuple[dict, bytes]:
    """Valida, calcula el checksum canónico y serializa (orden de §11.8.2)."""
    modelo = ModuleBundle.model_validate({**payload, "checksum": "0" * 64})
    datos = modelo.model_dump(mode="json")
    datos["checksum"] = bundle_checksum(datos)
    return datos, json.dumps(datos, ensure_ascii=False).encode("utf-8")


def bundle(
    module_id: str,
    *lecciones: dict,
    version: int = 1,
    order_hint: int = 9,
    **modulo_over,
) -> tuple[dict, bytes]:
    modulo = {
        "id": module_id,
        "order_hint": order_hint,
        "title": f"Módulo {module_id}",
        "description": "Descripción del módulo publicable.",
        "level": "Avanzado",
        "version": version,
        "published_at": "2026-08-29T12:00:00.000Z",
        "author_label": "Curso Telar — UN",
        "notes": "",
    }
    modulo.update(modulo_over)
    lista = list(lecciones) or [leccion(f"{module_id}-l1")]
    return sellar({"bundle_format": 1, "module": modulo, "lessons": lista})


def fila_indice(datos: dict, crudo: bytes, **over) -> dict:
    """Fila del índice DERIVADA del bundle real (``size_bytes == len(crudo)``)."""
    modulo, lecciones = datos["module"], datos["lessons"]
    base: dict[str, Any] = {
        "id": modulo["id"],
        "title": modulo["title"],
        "description": modulo["description"],
        "level": modulo["level"],
        "order_hint": modulo["order_hint"],
        "version": modulo["version"],
        "checksum": datos["checksum"],
        "object_path": f"modulos/{modulo['id']}/v{modulo['version']}.json",
        "size_bytes": len(crudo),
        "published_at": modulo["published_at"],
        "author_label": modulo["author_label"],
        "lessons_count": len(lecciones),
        "questions_count": sum(
            len((lec.get("quiz") or {}).get("questions", [])) for lec in lecciones
        ),
        "estimated_minutes_total": sum(
            lec["estimated_minutes"] for lec in lecciones
        ),
        "requires_gpu": any(
            (lec.get("example") or {}).get("requires_gpu") for lec in lecciones
        ),
    }
    base.update(over)
    return base


def indice(*filas: dict, generated_at: str = "2026-08-29T12:00:00.000Z") -> dict:
    return {"index_format": 1, "generated_at": generated_at, "modules": list(filas)}


def publicar(
    catalogo: FakeCatalogService, datos: dict, crudo: bytes, **fila_over
) -> dict:
    """Deja el objeto en el bucket y devuelve su fila de índice."""
    catalogo.publicar_modulo(
        datos["module"]["id"], datos["module"]["version"], crudo
    )
    return fila_indice(datos, crudo, **fila_over)


def publicar_todo(catalogo: FakeCatalogService, *bundles) -> dict:
    """Publica los bundles y el índice que los describe. Devuelve el índice."""
    filas = [publicar(catalogo, datos, crudo) for datos, crudo in bundles]
    doc = indice(*filas)
    catalogo.publicar_indice(doc)
    return doc


# ══════════════════════════════ fixtures ════════════════════════════════════


@pytest.fixture
def catalog_settings(tmp_path: Path) -> Settings:
    """Despliegue CON bucket configurado (§11.1)."""
    return Settings(
        db_path=str(tmp_path / "telar.db"),
        jobs_dir=str(tmp_path / "jobs"),
        allowed_origins="http://localhost:5173,http://localhost:8080,null",
        code_delivery="bind",
        runner_image="telar-runner:0.5.1",
        max_timeout_s=120,
        max_concurrent_jobs=2,
        max_code_bytes=262144,
        max_output_bytes=262144,
        catalog_bucket=BUCKET,
        catalog_cache_ttl_s=900,
    )


@pytest.fixture
def catalog_app(catalog_settings, fake_docker, fake_catalog, real_content):
    return build_app(
        settings=catalog_settings, docker=fake_docker, catalog=fake_catalog
    )


@pytest.fixture
def cliente(catalog_app):
    """TestClient con bucket configurado y ``FakeCatalogService`` inyectado."""
    with TestClient(catalog_app) as test_client:
        yield test_client


# ─────────────── helpers para sembrar el manifiesto sin router ───────────────


def instalar_manifiesto(
    cliente: TestClient, catalogo: FakeCatalogService, *bundles
) -> list[dict]:
    """Instala de verdad, por el endpoint. Devuelve los ``InstallResult``."""
    publicar_todo(catalogo, *bundles)
    resultados = []
    for datos, _ in bundles:
        respuesta = cliente.post(
            "/api/v1/catalog/install", json={"module_id": datos["module"]["id"]}
        )
        resultados.append(ok(respuesta, 201))
    return resultados


def fila_de(datos: dict, module_id: str) -> dict:
    return next(fila for fila in datos["modules"] if fila["module_id"] == module_id)


# ═══════════════════ §11.4.1 GET /catalog/status ════════════════════════════


def test_status_sin_bucket_responde_200_y_nada_es_remoto(client):
    """El escenario literal de §11.4.1: sin bucket, todo es ``local_only``."""
    data = ok(client.get("/api/v1/catalog/status"))
    assert data["catalog_enabled"] is False
    assert data["bucket"] is None
    assert data["last_checked_at"] is None
    assert data["modules"], "el baseline sembrado tiene módulos"
    assert all(fila["state"] == "local_only" for fila in data["modules"])
    assert all(fila["installed_version"] is None for fila in data["modules"])
    resumen = data["summary"]
    assert resumen["installed"] == 0
    assert resumen["updatable"] == 0
    assert resumen["never_checked"] == 0
    assert resumen["local_only"] == resumen["modules_total"] == len(data["modules"])


def test_status_no_sale_a_la_red_ni_con_el_bucket_caido(cliente, fake_catalog):
    """§11.0.8: ``/cursos`` no puede quedar rehén del bucket.

    Es estructural, no una promesa: ``_status_payload`` ni siquiera recibe el
    puerto. El test lo comprueba desde fuera con un bucket que revienta.
    """
    fake_catalog.fallar_indice(CatalogUnavailable("network"))
    data = ok(cliente.get("/api/v1/catalog/status"))
    assert data["catalog_enabled"] is True and data["bucket"] == BUCKET
    assert fake_catalog.index_calls == []
    assert fake_catalog.module_calls == []


def test_status_cuenta_lecciones_y_completadas_del_modulo(cliente, fake_catalog):
    # `completion_rule="viewed"` porque con `"quiz"` el backend IGNORA un
    # `completed=true` del cliente (E4, §6.2): la lección se completa aprobando.
    modulo = bundle(
        "mx",
        leccion("mx-a", order=1, completion_rule="viewed"),
        leccion("mx-b", order=2),
    )
    instalar_manifiesto(cliente, fake_catalog, modulo)
    ok(cliente.put("/api/v1/progress/lessons/mx-a", json={"viewed": True, "completed": True}))

    fila = fila_de(ok(cliente.get("/api/v1/catalog/status")), "mx")
    assert fila["lessons_total"] == 2
    assert fila["lessons_completed"] == 1
    assert fila["state"] == "installed"
    assert fila["origin"] == "remote"
    assert fila["installed_version"] == 1
    assert fila["object_path"] == "modulos/mx/v1.json"


def test_status_enciende_el_chip_cuando_el_indice_vio_una_version_mayor(
    cliente, fake_catalog
):
    v1 = bundle("mx", version=1)
    instalar_manifiesto(cliente, fake_catalog, v1)

    v2 = bundle("mx", version=2)
    publicar_todo(fake_catalog, v2)
    ok(cliente.post("/api/v1/catalog/refresh"))

    data = ok(cliente.get("/api/v1/catalog/status"))
    fila = fila_de(data, "mx")
    assert fila["state"] == "update_available"
    assert fila["available_version"] == 2
    assert fila["installed_version"] == 1
    assert data["summary"]["updatable"] == 1
    assert data["summary"]["installed"] == 1
    assert data["last_checked_at"] == fila["last_checked_at"] is not None


def test_status_con_el_catalogo_apagado_no_ofrece_actualizar(
    cliente, catalog_app, fake_catalog
):
    """Bucket retirado del despliegue con módulos ya instalados.

    Se conserva la VERDAD de lo instalado (versión, ruta, fechas) y se silencia
    lo que ya no se puede saber ni hacer: sin catálogo no hay «disponible», y
    encender el chip llevaría a un botón que responde 503 CATALOG_DISABLED.

    (§11.4.1 describe el caso degenerado —sin bucket nunca hubo instalaciones,
    así que «todos local_only» sale solo—; este es el residual, y ahí mentir
    sobre `installed_version` sería peor que decir la verdad.)
    """
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=1))
    publicar_todo(fake_catalog, bundle("mx", version=5))
    ok(cliente.post("/api/v1/catalog/refresh"))
    con_chip = fila_de(ok(cliente.get("/api/v1/catalog/status")), "mx")
    assert con_chip["state"] == "update_available"
    assert con_chip["available_version"] == 5

    # El despliegue pierde el bucket sin perder la base de datos.
    catalog_app.state.settings = catalog_app.state.settings.model_copy(
        update={"catalog_bucket": ""}
    )
    data = ok(cliente.get("/api/v1/catalog/status"))
    apagado = fila_de(data, "mx")
    assert data["catalog_enabled"] is False and data["bucket"] is None
    assert apagado["state"] == "installed"
    assert apagado["available_version"] is None
    assert apagado["available_checksum"] is None
    assert apagado["installed_version"] == 1  # el hecho local no se falsea
    assert apagado["object_path"] == "modulos/mx/v1.json"
    assert data["summary"]["updatable"] == 0
    # …y coherente: el resumen sale de las mismas filas que se devuelven.
    assert data["summary"]["installed"] == 1
    falla(cliente.post("/api/v1/catalog/refresh"), 503, "CATALOG_DISABLED")


def test_status_es_el_mismo_shape_que_devuelve_refresh(cliente, fake_catalog):
    publicar_todo(fake_catalog)
    directo = ok(cliente.get("/api/v1/catalog/status"))
    tras_refresh = ok(cliente.post("/api/v1/catalog/refresh"))
    assert set(directo) == set(tras_refresh)
    assert directo["modules"] == tras_refresh["modules"]


# ═══════════════════ §11.4.2 POST /catalog/refresh ══════════════════════════


def test_refresh_sin_bucket_responde_503_catalog_disabled(client):
    falla(client.post("/api/v1/catalog/refresh"), 503, "CATALOG_DISABLED")


def test_refresh_apaga_el_chip_de_un_modulo_que_salio_del_indice(
    cliente, fake_catalog
):
    """``set_available_no_commit`` es ABSOLUTA: ``None`` apaga.

    Sin esto, un módulo despublicado se quedaría anunciando para siempre una
    actualización que ya nadie sirve.
    """
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=1))
    publicar_todo(fake_catalog, bundle("mx", version=3))
    ok(cliente.post("/api/v1/catalog/refresh"))
    assert fila_de(ok(cliente.get("/api/v1/catalog/status")), "mx")["state"] == (
        "update_available"
    )

    fake_catalog.publicar_indice(indice())  # el autor lo despublica
    fila = fila_de(ok(cliente.post("/api/v1/catalog/refresh")), "mx")
    assert fila["available_version"] is None
    assert fila["state"] == "installed"


def test_refresh_con_el_bucket_caido_deja_installed_modules_intacta(
    cliente, fake_catalog
):
    """§11.4.2: ni ``last_checked_at`` se toca. La red va ANTES del lock."""
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=1))
    antes = fila_de(ok(cliente.get("/api/v1/catalog/status")), "mx")

    fake_catalog.fallar_indice(CatalogUnavailable("network", retry_after_s=7))
    error = falla(cliente.post("/api/v1/catalog/refresh"), 503, "CATALOG_UNAVAILABLE")
    assert error["details"] == {"reason": "network", "retry_after_s": 7}

    assert fila_de(ok(cliente.get("/api/v1/catalog/status")), "mx") == antes


def test_refresh_con_indice_fuera_de_esquema_responde_422(cliente, fake_catalog):
    fake_catalog.publicar_indice({"index_format": 99, "modules": []})
    falla(cliente.post("/api/v1/catalog/refresh"), 422, "BUNDLE_INVALID")


def test_refresh_cachea_el_indice_para_el_modo_sin_red(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.post("/api/v1/catalog/refresh"))
    llamadas = len(fake_catalog.index_calls)

    fake_catalog.fallar_indice(CatalogUnavailable("network"))
    data = ok(cliente.get("/api/v1/catalog/remote"))
    assert data["source"] == "cache"
    assert data["stale"] is False  # la caché es fresca: ni se intentó la red
    assert len(fake_catalog.index_calls) == llamadas
    assert [fila["id"] for fila in data["modules"]] == ["mx"]


# ═══════════════════ §11.5.1 GET /catalog/remote ════════════════════════════


def test_remote_sin_bucket_responde_503_catalog_disabled(client):
    falla(client.get("/api/v1/catalog/remote"), 503, "CATALOG_DISABLED")


def test_remote_lista_el_bucket_y_cruza_con_lo_instalado(cliente, fake_catalog):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=1))
    publicar_todo(
        fake_catalog, bundle("mx", version=2), bundle("my", version=1, order_hint=10)
    )

    data = ok(cliente.get("/api/v1/catalog/remote", params={"refresh": True}))
    assert data["bucket"] == BUCKET
    assert data["source"] == "network"
    assert data["stale"] is False and data["unavailable_reason"] is None
    por_id = {fila["id"]: fila for fila in data["modules"]}
    assert por_id["mx"]["state"] == "update_available"
    assert por_id["mx"]["installed_version"] == 1
    assert por_id["my"]["state"] == "available"
    assert por_id["my"]["installed_version"] is None
    # El índice de §11.10 no publica generación por objeto: el ancla es el
    # checksum, y mentir con un número inventado sería peor que decir `null`.
    assert por_id["mx"]["generation"] is None


def test_remote_marca_installed_cuando_la_version_publicada_es_la_instalada(
    cliente, fake_catalog
):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=2))
    data = ok(cliente.get("/api/v1/catalog/remote", params={"refresh": True}))
    assert data["modules"][0]["state"] == "installed"


def test_remote_sin_cache_previa_y_bucket_caido_responde_503(cliente, fake_catalog):
    fake_catalog.fallar_indice(CatalogUnavailable("forbidden"))
    error = falla(cliente.get("/api/v1/catalog/remote"), 503, "CATALOG_UNAVAILABLE")
    assert error["details"]["reason"] == "forbidden"


def test_remote_con_cache_previa_y_bucket_caido_responde_200_stale(
    cliente, fake_catalog
):
    """§11.9, la fila que sostiene el requisito de escritorio."""
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))  # deja caché

    fake_catalog.fallar_indice(CatalogUnavailable("rate_limit", retry_after_s=30))
    data = ok(cliente.get("/api/v1/catalog/remote", params={"refresh": True}))
    assert data["source"] == "cache"
    assert data["stale"] is True
    assert data["unavailable_reason"] == "rate_limit"
    assert [fila["id"] for fila in data["modules"]] == ["mx"]


def test_remote_refresh_true_ignora_la_cache_fresca(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))
    publicar_todo(fake_catalog, bundle("mx"), bundle("my", order_hint=10))

    servido = ok(cliente.get("/api/v1/catalog/remote"))
    assert [fila["id"] for fila in servido["modules"]] == ["mx"]  # caché fresca

    fresco = ok(cliente.get("/api/v1/catalog/remote", params={"refresh": True}))
    assert sorted(fila["id"] for fila in fresco["modules"]) == ["mx", "my"]
    assert fresco["source"] == "network"


def test_remote_descarta_la_cache_de_otro_bucket(
    cliente, catalog_app, fake_catalog
):
    """Cambiar de bucket es cambiar de despliegue: no se sirve el catálogo ajeno."""
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))
    catalog_app.state.settings = catalog_app.state.settings.model_copy(
        update={"catalog_bucket": "otro-bucket"}
    )

    fake_catalog.fallar_indice(CatalogUnavailable("network"))
    falla(cliente.get("/api/v1/catalog/remote"), 503, "CATALOG_UNAVAILABLE")


def test_remote_con_cache_ilegible_no_da_500(cliente, catalog_app, fake_catalog):
    """Caché corrupta = caché ausente: se degrada a 503, nunca a un 500."""
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))
    _romper_cache(catalog_app)

    fake_catalog.fallar_indice(CatalogUnavailable("corrupt"))
    falla(cliente.get("/api/v1/catalog/remote"), 503, "CATALOG_UNAVAILABLE")


def _romper_cache(app) -> None:
    """Deja en ``app_meta`` un documento con la forma correcta y datos basura."""
    import asyncio

    async def _escribir() -> None:
        await app.state.db.execute(
            "UPDATE app_meta SET value = ? WHERE key = ?",
            (
                json.dumps(
                    {
                        "bucket": BUCKET,
                        "fetched_at": "2026-08-29T12:00:00.000Z",
                        "index": {"index_format": 42},
                    }
                ),
                catalog_repo.INDEX_CACHE_KEY,
            ),
        )
        await app.state.db.commit()

    asyncio.run(_escribir())


def test_remote_con_indice_fuera_de_esquema_no_degrada_a_la_cache(
    cliente, fake_catalog
):
    """Un 422 NO se esconde sirviendo la caché: el publicador está subiendo basura."""
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))
    fake_catalog.publicar_indice({"index_format": 1, "modules": [{"id": "?"}]})
    falla(
        cliente.get("/api/v1/catalog/remote", params={"refresh": True}),
        422,
        "BUNDLE_INVALID",
    )


def test_remote_con_ttl_cero_siempre_va_a_la_red(
    catalog_settings, fake_docker, fake_catalog, real_content
):
    sin_ttl = catalog_settings.model_copy(update={"catalog_cache_ttl_s": 0})
    with TestClient(
        build_app(settings=sin_ttl, docker=fake_docker, catalog=fake_catalog)
    ) as sin_cache:
        publicar_todo(fake_catalog, bundle("mx"))
        ok(sin_cache.get("/api/v1/catalog/remote"))
        ok(sin_cache.get("/api/v1/catalog/remote"))
        assert len(fake_catalog.index_calls) == 2


# ═══════════════ §11.5.2 GET /catalog/remote/{module_id} ════════════════════


def test_detalle_lista_las_lecciones_de_un_modulo_no_instalado(
    cliente, fake_catalog
):
    datos, crudo = bundle(
        "mx",
        leccion("mx-a", order=1),
        leccion("mx-b", order=2, quiz=None, completion_rule="viewed"),
    )
    publicar_todo(fake_catalog, (datos, crudo))

    data = ok(cliente.get("/api/v1/catalog/remote/mx"))
    assert data["id"] == "mx" and data["state"] == "available"
    assert [lec["lesson_id"] for lec in data["lessons"]] == ["mx-a", "mx-b"]
    assert all(lec["status"] == "new" for lec in data["lessons"])
    assert data["lessons"][0]["has_quiz"] is True
    assert data["lessons"][0]["quiz_question_count"] == 1
    assert data["lessons"][1]["has_quiz"] is False
    assert data["lessons"][1]["completion_rule"] == "viewed"
    assert data["content_warnings"] == []


def test_detalle_no_escribe_nada_en_la_base(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote/mx"))
    assert fila_de(ok(cliente.get("/api/v1/catalog/status")), "m1")["state"] == (
        "local_only"
    )
    assert not any(
        fila["module_id"] == "mx"
        for fila in ok(cliente.get("/api/v1/catalog/status"))["modules"]
    )


def test_detalle_marca_present_y_changed_de_un_modulo_instalado(
    cliente, fake_catalog
):
    v1 = bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2))
    instalar_manifiesto(cliente, fake_catalog, v1)

    v2 = bundle(
        "mx",
        leccion("mx-a", order=1),
        leccion("mx-c", order=2),
        version=2,
    )
    publicar_todo(fake_catalog, v2)

    data = ok(cliente.get("/api/v1/catalog/remote/mx", params={"version": 2}))
    estados = {lec["lesson_id"]: lec["status"] for lec in data["lessons"]}
    assert estados == {"mx-a": "present", "mx-c": "new"}
    assert data["state"] == "update_available"
    retiradas = [
        aviso for aviso in data["content_warnings"] if aviso["code"] == "LESSON_ID_REMOVED"
    ]
    assert [aviso["lesson_id"] for aviso in retiradas] == ["mx-b"]


def test_detalle_marca_changed_cuando_la_leccion_cambia(cliente, fake_catalog):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", leccion("mx-a")))
    publicar_todo(
        fake_catalog,
        bundle("mx", leccion("mx-a", title="Otro título"), version=2),
    )
    data = ok(cliente.get("/api/v1/catalog/remote/mx"))
    assert data["lessons"][0]["status"] == "changed"


def test_detalle_avisa_de_un_id_que_ya_es_de_otro_modulo(cliente, fake_catalog):
    """Aviso NO bloqueante: el estudiante lo sabe ANTES de pulsar «incorporar»."""
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", leccion("compartida")))
    otro = bundle("my", leccion("compartida"), order_hint=10)
    publicar_todo(fake_catalog, bundle("mx", leccion("compartida")), otro)

    data = ok(cliente.get("/api/v1/catalog/remote/my"))
    avisos = [a for a in data["content_warnings"] if a["code"] == "DUPLICATE_ID"]
    assert [a["lesson_id"] for a in avisos] == ["compartida"]
    # …y el instalador lo rechaza de verdad, que es lo que el aviso anticipa.
    falla(
        cliente.post("/api/v1/catalog/install", json={"module_id": "my"}),
        409,
        "DUPLICATE_ID",
    )


def test_detalle_de_un_modulo_desconocido_es_404(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    falla(cliente.get("/api/v1/catalog/remote/nope"), 404, "REMOTE_MODULE_NOT_FOUND")


def test_detalle_de_una_version_no_publicada_es_404(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx", version=2))
    falla(
        cliente.get("/api/v1/catalog/remote/mx", params={"version": 1}),
        404,
        "REMOTE_MODULE_NOT_FOUND",
    )


def test_detalle_con_checksum_que_no_cuadra_es_409(cliente, fake_catalog):
    datos, crudo = bundle("mx")
    fila = publicar(fake_catalog, datos, crudo, checksum="a" * 64)
    fake_catalog.publicar_indice(indice(fila))
    falla(cliente.get("/api/v1/catalog/remote/mx"), 409, "CHECKSUM_MISMATCH")


def test_detalle_con_size_bytes_por_encima_del_tope_es_413(cliente, fake_catalog):
    """El corte barato de §11.3: se rechaza por ``size`` ANTES de descargar."""
    datos, crudo = bundle("mx")
    fila = publicar(fake_catalog, datos, crudo, size_bytes=99_000_000)
    fake_catalog.publicar_indice(indice(fila))
    falla(cliente.get("/api/v1/catalog/remote/mx"), 413, "BUNDLE_TOO_LARGE")
    assert fake_catalog.module_calls == []


def test_detalle_con_el_puerto_cortando_por_tamano_es_413(cliente, fake_catalog):
    datos, crudo = bundle("mx")
    fila = publicar(fake_catalog, datos, crudo)
    fake_catalog.publicar_indice(indice(fila))
    fake_catalog.fallar_modulo(
        "mx", 1, CatalogObjectTooLarge("modulos/mx/v1.json", 10, 11)
    )
    falla(cliente.get("/api/v1/catalog/remote/mx"), 413, "BUNDLE_TOO_LARGE")


def test_detalle_de_un_objeto_que_no_esta_en_el_bucket_es_404(
    cliente, fake_catalog
):
    datos, crudo = bundle("mx")
    fake_catalog.publicar_indice(indice(fila_indice(datos, crudo)))  # sin el objeto
    falla(cliente.get("/api/v1/catalog/remote/mx"), 404, "REMOTE_MODULE_NOT_FOUND")


def test_detalle_de_un_objeto_que_no_parsea_es_422(cliente, fake_catalog):
    datos, crudo = bundle("mx")
    fila = publicar(fake_catalog, datos, crudo)
    fake_catalog.publicar_modulo("mx", 1, b"{no soy json")
    fake_catalog.publicar_indice(indice({**fila, "size_bytes": 12}))
    falla(cliente.get("/api/v1/catalog/remote/mx"), 422, "BUNDLE_INVALID")


def test_detalle_de_un_objeto_que_dice_ser_otro_modulo_es_422(
    cliente, fake_catalog
):
    """El checksum cuadra porque es el checksum del impostor: miente el índice."""
    impostor, crudo = bundle("otro")
    fila = fila_indice(impostor, crudo, id="mx", object_path="modulos/mx/v1.json")
    fake_catalog.publicar_modulo("mx", 1, crudo)
    fake_catalog.publicar_indice(indice(fila))
    falla(cliente.get("/api/v1/catalog/remote/mx"), 422, "BUNDLE_INVALID")


def test_detalle_sin_bucket_es_503(client):
    falla(client.get("/api/v1/catalog/remote/mx"), 503, "CATALOG_DISABLED")


# ═══════════════════ §11.6.1 POST /catalog/install ══════════════════════════


def test_install_incorpora_el_modulo_y_devuelve_201(cliente, fake_catalog):
    datos, crudo = bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2))
    publicar_todo(fake_catalog, (datos, crudo))

    resultado = ok(
        cliente.post("/api/v1/catalog/install", json={"module_id": "mx"}), 201
    )
    assert resultado["module_id"] == "mx"
    assert resultado["installed_version"] == 1
    assert resultado["installed_checksum"] == datos["checksum"]
    assert resultado["object_path"] == "modulos/mx/v1.json"
    assert resultado["lessons_added"] == ["mx-a", "mx-b"]
    assert resultado["lessons_updated"] == [] and resultado["lessons_removed"] == []
    assert resultado["questions_total"] == 2
    assert resultado["installed_at"]

    # …y el contenido ya se sirve por §4, sin reiniciar nada.
    modulos = ok(cliente.get("/api/v1/modules"))
    assert any(fila["id"] == "mx" for fila in modulos["modules"])
    ok(cliente.get("/api/v1/lessons/mx-a"))


def test_install_reasigna_el_order_cuando_el_hint_esta_tomado(cliente, fake_catalog):
    """``modules."order"`` es UNIQUE GLOBAL y el baseline ya usa el 1."""
    publicar_todo(fake_catalog, bundle("mx", order_hint=1))
    resultado = ok(
        cliente.post("/api/v1/catalog/install", json={"module_id": "mx"}), 201
    )
    assert resultado["order_reassigned"] is True
    assert resultado["local_order"] != 1


def test_install_de_un_modulo_ya_instalado_es_409(cliente, fake_catalog):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx"))
    falla(
        cliente.post("/api/v1/catalog/install", json={"module_id": "mx"}),
        409,
        "MODULE_ALREADY_INSTALLED",
    )


def test_install_de_un_modulo_que_no_esta_en_el_indice_es_404(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    falla(
        cliente.post("/api/v1/catalog/install", json={"module_id": "my"}),
        404,
        "REMOTE_MODULE_NOT_FOUND",
    )


def test_install_con_expected_checksum_desactualizado_es_409(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    falla(
        cliente.post(
            "/api/v1/catalog/install",
            json={"module_id": "mx", "expected_checksum": "b" * 64},
        ),
        409,
        "CHECKSUM_MISMATCH",
    )
    assert fake_catalog.module_calls == [], "se corta ANTES de gastar la descarga"


def test_install_con_bucket_caido_no_escribe_nada(cliente, fake_catalog):
    fake_catalog.fallar_indice(CatalogUnavailable("network"))
    falla(
        cliente.post("/api/v1/catalog/install", json={"module_id": "mx"}),
        503,
        "CATALOG_UNAVAILABLE",
    )
    assert ok(cliente.get("/api/v1/catalog/status"))["summary"]["installed"] == 0


def test_install_sin_bucket_es_503_catalog_disabled(client):
    falla(
        client.post("/api/v1/catalog/install", json={"module_id": "mx"}),
        503,
        "CATALOG_DISABLED",
    )


def test_install_con_module_id_fuera_de_patron_es_422(cliente):
    respuesta = cliente.post("/api/v1/catalog/install", json={"module_id": "../etc"})
    falla(respuesta, 422, "VALIDATION_ERROR")


# ══════════ §11.6.2 GET /catalog/modules/{id}/update/preview ════════════════


def test_preview_dice_que_conserva_y_no_escribe(cliente, fake_catalog):
    v1 = bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2))
    instalar_manifiesto(cliente, fake_catalog, v1)
    ok(cliente.put("/api/v1/progress/lessons/mx-a", json={"viewed": True}))

    v2 = bundle(
        "mx",
        leccion("mx-a", order=1, title="Título nuevo"),
        leccion("mx-c", order=2),
        version=2,
    )
    publicar_todo(fake_catalog, v2)
    ok(cliente.post("/api/v1/catalog/refresh"))

    data = ok(cliente.get("/api/v1/catalog/modules/mx/update/preview"))
    assert data["module_id"] == "mx"
    assert data["from_version"] == 1 and data["to_version"] == 2
    assert data["to_checksum"] == v2[0]["checksum"]
    cambios = {fila["lesson_id"]: fila for fila in data["lessons"]}
    assert cambios["mx-a"]["change"] == "updated"
    assert cambios["mx-a"]["progress"] == "preserved"
    assert cambios["mx-c"]["change"] == "added"
    assert cambios["mx-c"]["progress"] == "none"
    assert cambios["mx-b"]["change"] == "removed"
    assert cambios["mx-b"]["progress"] == "none"  # nunca se tocó
    assert data["progress_summary"]["preserved"] == 1

    # No escribió: sigue instalada la v1.
    assert fila_de(ok(cliente.get("/api/v1/catalog/status")), "mx")[
        "installed_version"
    ] == 1


def test_preview_marca_archived_la_leccion_retirada_con_avance(
    cliente, fake_catalog
):
    v1 = bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2))
    instalar_manifiesto(cliente, fake_catalog, v1)
    ok(cliente.put("/api/v1/progress/lessons/mx-b", json={"viewed": True}))

    publicar_todo(fake_catalog, bundle("mx", leccion("mx-a", order=1), version=2))
    data = ok(
        cliente.get(
            "/api/v1/catalog/modules/mx/update/preview", params={"to_version": 2}
        )
    )
    retirada = next(f for f in data["lessons"] if f["lesson_id"] == "mx-b")
    assert retirada["change"] == "removed"
    assert retirada["progress"] == "archived"
    assert retirada["reason"] == "LESSON_ID_REMOVED"
    assert data["progress_summary"]["archived"] == 1
    assert any(a["code"] == "LESSON_ID_REMOVED" for a in data["warnings"])


def test_preview_marca_rescored_cuando_el_quiz_deja_de_ser_corregible(
    cliente, fake_catalog
):
    """BL-06: una nota sobre otro total es una nota imposible."""
    v1 = bundle("mx", leccion("mx-a", quiz=quiz(pregunta(1))))
    instalar_manifiesto(cliente, fake_catalog, v1)
    ok(
        cliente.post(
            "/api/v1/lessons/mx-a/quiz/attempts",
            json={"answers": {"mx-a-q1": "a"}},
        ),
        201,
    )

    v2 = bundle(
        "mx",
        leccion("mx-a", quiz=quiz(pregunta(1), pregunta(2))),
        version=2,
    )
    publicar_todo(fake_catalog, v2)
    data = ok(
        cliente.get(
            "/api/v1/catalog/modules/mx/update/preview", params={"to_version": 2}
        )
    )
    fila = next(f for f in data["lessons"] if f["lesson_id"] == "mx-a")
    assert fila["progress"] == "rescored"
    assert fila["reason"] == "QUIZ_CHANGED"
    assert data["progress_summary"]["rescored"] == 1


# ═════════ S7d 38.3 · el preview usa el efecto real del plan ═════════════════


def test_preview_anuncia_rescored_si_solo_cambia_la_clave(
    cliente, fake_catalog
):
    """La limitación que documentaba `_efecto_en_avance`: mismo conjunto de
    preguntas y mismas opciones, pero otra ``correct_key``. La nota recalculada
    no es nula (no sale en ``scores_invalidated``) y la lección ya estaba
    aprobada (no sale en ``completed_gained``): antes se anunciaba «preserved»."""
    v1 = bundle("mx", leccion("mx-a", quiz=quiz(pregunta(1), pregunta(2))))
    instalar_manifiesto(cliente, fake_catalog, v1)
    ok(
        cliente.post(
            "/api/v1/lessons/mx-a/quiz/attempts",
            json={"answers": {"mx-a-q1": "a", "mx-a-q2": "a"}},
        ),
        201,
    )

    v2 = bundle(
        "mx",
        leccion("mx-a", quiz=quiz(pregunta(1), pregunta(2, correct_key="b"))),
        version=2,
    )
    publicar_todo(fake_catalog, v2)
    data = ok(
        cliente.get(
            "/api/v1/catalog/modules/mx/update/preview", params={"to_version": 2}
        )
    )
    fila = next(f for f in data["lessons"] if f["lesson_id"] == "mx-a")
    assert fila["progress"] == "rescored"
    assert fila["reason"] == "QUIZ_CHANGED"
    assert data["progress_summary"]["rescored"] == 1

    # Y lo anunciado es lo que ocurre.
    ok(cliente.post("/api/v1/catalog/modules/mx/update", json={"to_version": 2}))
    fila_progreso = ok(cliente.get("/api/v1/progress"))["lessons"]["mx-a"]
    assert fila_progreso["best_quiz_score"] == 1
    assert fila_progreso["completed"] is True  # monótono: no se revoca


def test_preview_de_un_modulo_no_instalado_es_404(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    falla(
        cliente.get("/api/v1/catalog/modules/mx/update/preview"),
        404,
        "MODULE_NOT_INSTALLED",
    )


def test_preview_de_un_downgrade_es_409_version_conflict(cliente, fake_catalog):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=3))
    publicar_todo(fake_catalog, bundle("mx", version=1))
    falla(
        cliente.get(
            "/api/v1/catalog/modules/mx/update/preview", params={"to_version": 1}
        ),
        409,
        "VERSION_CONFLICT",
    )


def test_preview_sin_bucket_es_503(client):
    falla(
        client.get("/api/v1/catalog/modules/mx/update/preview"),
        503,
        "CATALOG_DISABLED",
    )


# ══════════════ §11.6.3 POST /catalog/modules/{id}/update ═══════════════════


def test_update_conserva_el_avance_y_devuelve_el_shape_de_install(
    cliente, fake_catalog
):
    """CU-39 por HTTP: nada de ``lesson_progress`` desaparece."""
    v1 = bundle(
        "mx",
        leccion("mx-a", order=1, completion_rule="viewed"),
        leccion("mx-b", order=2),
    )
    instalar_manifiesto(cliente, fake_catalog, v1)
    ok(cliente.put("/api/v1/progress/lessons/mx-a", json={"viewed": True, "completed": True}))
    ok(cliente.put("/api/v1/progress/lessons/mx-b", json={"viewed": True}))

    v2 = bundle(
        "mx",
        leccion("mx-a", order=1, title="Título nuevo", completion_rule="viewed"),
        leccion("mx-c", order=2),
        version=2,
    )
    publicar_todo(fake_catalog, v2)

    # Sin `to_version` el default es `available_version`, que es lo que dejó el
    # refresco del índice: exactamente el flujo de `/cursos` (§11.4.2).
    ok(cliente.post("/api/v1/catalog/refresh"))
    resultado = ok(cliente.post("/api/v1/catalog/modules/mx/update", json={}))
    assert resultado["module_id"] == "mx"
    assert resultado["installed_version"] == 2
    assert resultado["installed_checksum"] == v2[0]["checksum"]
    assert resultado["order_reassigned"] is False
    assert resultado["lessons_added"] == ["mx-c"]
    assert "mx-a" in resultado["lessons_updated"]
    assert "mx-b" in resultado["lessons_removed"]
    # §11.6.3: «mismo shape que InstallResult». Se comprueba campo a campo para
    # que un renombre en uno de los dos caminos no pase inadvertido.
    assert set(resultado) == {
        "module_id", "installed_version", "installed_checksum", "object_path",
        "local_order", "order_reassigned", "lessons_added", "lessons_updated",
        "lessons_removed", "questions_total", "progress", "installed_at",
    }

    # El avance sigue ahí, incluida la lección retirada (archivada, no borrada).
    avance = ok(cliente.get("/api/v1/progress"))["lessons"]
    assert avance["mx-a"]["completed"] is True
    assert "mx-b" in avance


def test_update_de_un_modulo_no_instalado_es_404(cliente, fake_catalog):
    publicar_todo(fake_catalog, bundle("mx"))
    falla(
        cliente.post("/api/v1/catalog/modules/mx/update", json={}),
        404,
        "MODULE_NOT_INSTALLED",
    )


def test_update_a_una_version_menor_es_409_version_conflict(cliente, fake_catalog):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=3))
    publicar_todo(fake_catalog, bundle("mx", version=1))
    falla(
        cliente.post(
            "/api/v1/catalog/modules/mx/update", json={"to_version": 1}
        ),
        409,
        "VERSION_CONFLICT",
    )


def test_update_con_expected_checksum_distinto_es_409(cliente, fake_catalog):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=1))
    publicar_todo(fake_catalog, bundle("mx", version=2))
    falla(
        cliente.post(
            "/api/v1/catalog/modules/mx/update",
            json={"to_version": 2, "expected_checksum": "c" * 64},
        ),
        409,
        "CHECKSUM_MISMATCH",
    )


def test_el_update_del_estudiante_no_sabe_purgar_y_conserva_el_avance(
    cliente, fake_catalog
):
    """§11.6.3 — pedir ``purge`` es 422, y la lección retirada CONSERVA su avance.

    Era la segunda puerta al mismo borrado que ``purge_progress``: la ruta del
    estudiante podía mandar ``on_removed_lessons: "purge"`` y llevarse
    ``lesson_progress`` y ``quiz_attempts``. Cerrar solo una de las dos habría
    sido cosmético — misma API, mismas tablas, misma promesa rota.

    Se comprueban las dos mitades, porque una sin la otra no dice nada: que el
    valor destructivo se RECHACE, y que el camino que sí funciona CONSERVE.
    """
    v1 = bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2))
    instalar_manifiesto(cliente, fake_catalog, v1)
    ok(cliente.put("/api/v1/progress/lessons/mx-b", json={"viewed": True}))
    publicar_todo(fake_catalog, bundle("mx", leccion("mx-a", order=1), version=2))

    # 1 · el valor destructivo ya no es pedible: 422 ruidoso, no borrado callado.
    falla(
        cliente.post(
            "/api/v1/catalog/modules/mx/update",
            json={"to_version": 2, "on_removed_lessons": "purge"},
        ),
        422,
        "VALIDATION_ERROR",
    )
    # 2 · y el update que sí se acepta deja el avance de la retirada en su sitio.
    ok(cliente.post("/api/v1/catalog/modules/mx/update", json={"to_version": 2}))
    assert "mx-b" in ok(cliente.get("/api/v1/progress"))["lessons"]


def test_update_sin_bucket_es_503(client):
    falla(
        client.post("/api/v1/catalog/modules/mx/update", json={}),
        503,
        "CATALOG_DISABLED",
    )


def test_update_a_la_misma_version_es_idempotente(cliente, fake_catalog):
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", version=1))
    resultado = ok(cliente.post("/api/v1/catalog/modules/mx/update", json={}))
    assert resultado["installed_version"] == 1
    assert resultado["lessons_added"] == []


# ══════════════ §11.6.4 DELETE /catalog/modules/{id} ════════════════════════


def test_delete_quita_el_contenido_y_conserva_el_progreso(cliente, fake_catalog):
    """La promesa de la UI: «Quitar módulo — tu progreso se conserva»."""
    instalar_manifiesto(
        cliente,
        fake_catalog,
        bundle(
            "mx",
            leccion("mx-a", order=1, completion_rule="viewed"),
            leccion("mx-b", order=2),
        ),
    )
    ok(cliente.put("/api/v1/progress/lessons/mx-a", json={"viewed": True, "completed": True}))

    data = ok(cliente.request("DELETE", "/api/v1/catalog/modules/mx"))
    assert data == {
        "removed": True,
        "module_id": "mx",
        "lessons_removed": 2,
        "progress_purged": False,
        "progress_archived": 1,
    }

    assert cliente.get("/api/v1/lessons/mx-a").status_code == 404
    assert not any(
        fila["id"] == "mx" for fila in ok(cliente.get("/api/v1/modules"))["modules"]
    )
    # El avance sobrevive huérfano y vuelve al reinstalar: los ids son estables.
    ok(cliente.post("/api/v1/catalog/install", json={"module_id": "mx"}), 201)
    assert ok(cliente.get("/api/v1/progress"))["lessons"]["mx-a"]["completed"] is True


def test_desinstalar_conserva_el_avance_aunque_se_pida_purgarlo(
    cliente, fake_catalog
):
    """§11.6.4 — ``purge_progress`` ya no existe, y mandarlo NO borra nada.

    Se manda el parámetro viejo a propósito. Que la ruta lo ignore es la prueba
    de que la garantía no depende de que el cliente se porte bien: FastAPI
    descarta el query param desconocido, y como la rama de purga tampoco existe
    ya en el código, no hay forma de llegar al DELETE aunque se quiera.

    Se comprueban las DOS tablas: ``lesson_progress`` y ``quiz_attempts``. Con
    mirar solo una, media purga pasaría por conservación.
    """
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", leccion("mx-a")))
    ok(
        cliente.post(
            "/api/v1/lessons/mx-a/quiz/attempts", json={"answers": {"mx-a-q1": "a"}}
        ),
        201,
    )

    data = ok(
        cliente.request(
            "DELETE", "/api/v1/catalog/modules/mx", params={"purge_progress": True}
        )
    )
    # `progress_purged` sigue en el shape y ahora es una constante honesta.
    assert data["progress_purged"] is False
    assert data["progress_archived"] == 1

    ok(cliente.post("/api/v1/catalog/install", json={"module_id": "mx"}), 201)
    assert "mx-a" in ok(cliente.get("/api/v1/progress"))["lessons"]
    assert ok(cliente.get("/api/v1/lessons/mx-a/quiz/attempts"))["attempts"] != []


def test_delete_de_un_modulo_no_incorporado_es_404(cliente):
    """Un módulo del baseline no se desinstala por aquí: eso es /admin."""
    falla(
        cliente.request("DELETE", "/api/v1/catalog/modules/m1"),
        404,
        "MODULE_NOT_INSTALLED",
    )


def test_delete_funciona_con_el_bucket_caido(cliente, fake_catalog):
    """§11.9: desinstalar es 100 % local. Nunca toca el puerto."""
    instalar_manifiesto(cliente, fake_catalog, bundle("mx"))
    llamadas = len(fake_catalog.index_calls), len(fake_catalog.module_calls)
    fake_catalog.fallar_indice(CatalogUnavailable("network"))

    ok(cliente.request("DELETE", "/api/v1/catalog/modules/mx"))
    assert (len(fake_catalog.index_calls), len(fake_catalog.module_calls)) == llamadas


def test_delete_sin_bucket_configurado_no_es_503(client):
    """Sin catálogo el endpoint EXISTE y contesta 404, no 503 CATALOG_DISABLED."""
    falla(
        client.request("DELETE", "/api/v1/catalog/modules/m1"),
        404,
        "MODULE_NOT_INSTALLED",
    )


# ═════════════ §11.9 el requisito de escritorio (los dos que importan) ══════


CONTENIDO = (
    "/api/v1/examples",
    "/api/v1/examples/helloOpenMP",
    "/api/v1/modules",
    "/api/v1/lessons/primerEjemplo",
    "/api/v1/lessons/primerEjemplo/quiz",
    "/api/v1/progress",
)


def _instantanea(test_client: TestClient) -> dict[str, tuple[int, Any]]:
    return {
        ruta: (respuesta.status_code, respuesta.json())
        for ruta in CONTENIDO
        if (respuesta := test_client.get(ruta)) is not None
    }


def test_con_el_bucket_caido_el_contenido_responde_identico(cliente, fake_catalog):
    """**El invariante que se rompe sin que nadie se dé cuenta** (§11.9).

    Ningún endpoint de §3-§6 toca el bucket, jamás. Se fotografían las
    respuestas con el bucket sano y se comparan con el bucket reventado: tienen
    que ser idénticas byte a byte, y el puerto no puede haber recibido ni una
    llamada.
    """
    publicar_todo(fake_catalog, bundle("mx"))
    sano = _instantanea(cliente)

    fake_catalog.fallar_indice(CatalogUnavailable("network"))
    for version in (1, 2, 3):
        fake_catalog.fallar_modulo("mx", version, CatalogUnavailable("forbidden"))
    fake_catalog.index_calls.clear()
    fake_catalog.module_calls.clear()

    assert _instantanea(cliente) == sano
    assert fake_catalog.index_calls == []
    assert fake_catalog.module_calls == []
    assert cliente.get("/health").status_code == 200


def test_sin_bucket_configurado_el_contenido_responde_identico(cliente, client):
    """El otro extremo: un despliegue SIN catálogo sirve exactamente lo mismo.

    Si añadir el catálogo cambiara una sola respuesta de §3-§6, el «módulo como
    unidad publicable» habría dejado de ser aditivo.
    """
    assert _instantanea(client) == _instantanea(cliente)


def test_status_sigue_a_200_con_todo_el_bucket_reventado(cliente, fake_catalog):
    fake_catalog.fallar_indice(CatalogUnavailable("server"))
    assert cliente.get("/api/v1/catalog/status").status_code == 200
    falla(cliente.post("/api/v1/catalog/refresh"), 503, "CATALOG_UNAVAILABLE")


# ═══════════════════════ §2.2 el bloque `catalog` ═══════════════════════════


def test_system_reporta_el_catalogo_apagado(client):
    catalogo = ok(client.get("/api/v1/system"))["catalog"]
    assert catalogo == {
        "enabled": False,
        "bucket": None,
        "mode": "anonymous",
        "last_checked_at": None,
    }


def test_system_reporta_el_catalogo_encendido_sin_sondearlo(cliente, fake_catalog):
    """§2.2: ``last_checked_at`` es el último sondeo CONOCIDO, nunca uno nuevo."""
    instalar_manifiesto(cliente, fake_catalog, bundle("mx"))
    ok(cliente.post("/api/v1/catalog/refresh"))
    llamadas = len(fake_catalog.index_calls)

    catalogo = ok(cliente.get("/api/v1/system"))["catalog"]
    assert catalogo["enabled"] is True
    assert catalogo["bucket"] == BUCKET
    assert catalogo["mode"] == "anonymous"
    assert catalogo["last_checked_at"] is not None
    assert len(fake_catalog.index_calls) == llamadas


def test_system_reporta_mode_admin_con_credencial_de_escritura(
    catalog_settings, fake_docker, real_content
):
    admin = catalog_settings.model_copy(update={"gcs_credentials": "/dev/null"})
    with TestClient(build_app(settings=admin, docker=fake_docker)) as test_client:
        assert ok(test_client.get("/api/v1/system"))["catalog"]["mode"] == "admin"


# ═════════════════════ §11.3 la tabla de códigos ════════════════════════════


def test_los_codigos_de_la_11_3_tienen_su_status_en_errors():
    """Sin estas filas, ``ApiException`` degradaría a 500 códigos que son 4xx."""
    assert {
        "REMOTE_MODULE_NOT_FOUND": 404,
        "MODULE_NOT_INSTALLED": 404,
        "MODULE_ALREADY_INSTALLED": 409,
        "VERSION_CONFLICT": 409,
        "CHECKSUM_MISMATCH": 409,
        "DUPLICATE_ID": 409,
        "BUNDLE_TOO_LARGE": 413,
        "BUNDLE_INVALID": 422,
        "CONTENT_VALIDATION_ERROR": 422,
        "CATALOG_CREDENTIALS_INVALID": 403,
        "CATALOG_DISABLED": 503,
        "CATALOG_UNAVAILABLE": 503,
    }.items() <= DEFAULT_STATUS.items()


def test_una_ruta_de_catalogo_inexistente_sigue_llevando_envelope(cliente):
    respuesta = cliente.get("/api/v1/catalog/no-existe/nada")
    assert respuesta.status_code == 404
    assert respuesta.json()["success"] is False


# ═══════════ bordes: adaptador ausente, caché rara y lifespan ═══════════════


def test_con_bucket_configurado_pero_sin_adaptador_es_503_unavailable(
    catalog_settings, fake_docker, real_content
):
    """Bucket en la config y adaptador inservible: es indistinguible de caído.

    No es ``CATALOG_DISABLED`` —el despliegue SÍ quiere catálogo— ni un 500: la
    UI tiene que poder ofrecer «reintentar», que es lo que hace con un
    ``CATALOG_UNAVAILABLE``.
    """
    with TestClient(
        build_app(settings=catalog_settings, docker=fake_docker, catalog=None)
    ) as sin_puerto:
        error = falla(
            sin_puerto.get("/api/v1/catalog/remote"), 503, "CATALOG_UNAVAILABLE"
        )
        assert error["details"] == {"reason": "server", "retry_after_s": None}
        # …y lo local sigue funcionando, que es de lo que va §11.9.
        assert ok(sin_puerto.get("/api/v1/catalog/status"))["catalog_enabled"] is True


@pytest.mark.parametrize("fecha", ["ayer por la tarde", ""])
def test_una_cache_con_fecha_ilegible_se_trata_como_vencida(
    cliente, catalog_app, fake_catalog, fecha
):
    """«No sé cuán vieja es» ⇒ vencida. Nunca un 500 por una fecha rara."""
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))
    _falsear_fecha_de_cache(catalog_app, fecha)

    llamadas = len(fake_catalog.index_calls)
    data = ok(cliente.get("/api/v1/catalog/remote"))
    assert data["source"] == "network"
    assert len(fake_catalog.index_calls) == llamadas + 1


def _falsear_fecha_de_cache(app, fecha: str) -> None:
    import asyncio

    async def _escribir() -> None:
        cursor = await app.state.db.execute(
            "SELECT value FROM app_meta WHERE key = ?",
            (catalog_repo.INDEX_CACHE_KEY,),
        )
        fila = await cursor.fetchone()
        documento = json.loads(fila[0])
        documento["fetched_at"] = fecha
        await app.state.db.execute(
            "UPDATE app_meta SET value = ? WHERE key = ?",
            (json.dumps(documento), catalog_repo.INDEX_CACHE_KEY),
        )
        await app.state.db.commit()

    asyncio.run(_escribir())


def test_preview_no_lista_dos_veces_una_leccion_revisada(cliente, fake_catalog):
    """``revised`` ⊂ ``updated``: el diff del contrato es una PARTICIÓN."""
    instalar_manifiesto(cliente, fake_catalog, bundle("mx", leccion("mx-a")))
    publicar_todo(
        fake_catalog,
        bundle(
            "mx",
            leccion("mx-a", content_markdown="# Otro\n\nTexto reescrito.\n"),
            version=2,
        ),
    )
    data = ok(
        cliente.get(
            "/api/v1/catalog/modules/mx/update/preview", params={"to_version": 2}
        )
    )
    ids = [fila["lesson_id"] for fila in data["lessons"]]
    assert ids == ["mx-a"]
    assert data["lessons"][0]["change"] == "updated"


def test_system_no_revienta_si_no_puede_leer_el_ultimo_sondeo(
    cliente, catalog_app
):
    class _DbRota:
        async def execute(self, *_args, **_kwargs):
            raise RuntimeError("tabla ausente")

    original = catalog_app.state.db
    catalog_app.state.db = _DbRota()
    try:
        assert ok(cliente.get("/api/v1/system"))["catalog"]["last_checked_at"] is None
    finally:
        catalog_app.state.db = original


# ─────────────────────────── lifespan de producción ─────────────────────────


def test_el_lifespan_no_construye_catalogo_sin_bucket(settings, fake_docker):
    from app.main import create_app

    application = create_app(settings=settings, docker_service=fake_docker)
    with TestClient(application) as test_client:
        assert application.state.catalog is None
        assert ok(test_client.get("/api/v1/catalog/status"))["catalog_enabled"] is False
        falla(test_client.get("/api/v1/catalog/remote"), 503, "CATALOG_DISABLED")


def test_el_lifespan_construye_el_adaptador_y_lo_cierra(
    catalog_settings, fake_docker
):
    """Se crea el adaptador REAL (no abre ningún socket) y el lifespan lo cierra."""
    from app.main import create_app

    application = create_app(settings=catalog_settings, docker_service=fake_docker)
    with TestClient(application) as test_client:
        puerto = application.state.catalog
        assert puerto is not None
        assert ok(test_client.get("/api/v1/system"))["catalog"]["bucket"] == BUCKET
    assert puerto._client.is_closed


def test_una_config_de_catalogo_invalida_no_tumba_el_arranque(
    catalog_settings, fake_docker
):
    """§11.0.8: el catálogo es opcional; ``/cursos`` no puede quedar rehén de él.

    Un ``TELAR_CATALOG_BUCKET`` con nombre imposible se registra y se deja en
    ``None``: la app arranca, los cursos instalados siguen ahí y §11 responde
    503. Es el mismo criterio de liveness ≠ readiness del docker service.
    """
    from app.main import create_app

    roto = catalog_settings.model_copy(update={"catalog_bucket": "BUCKET Inválido"})
    application = create_app(settings=roto, docker_service=fake_docker)
    with TestClient(application) as test_client:
        assert application.state.catalog is None
        assert test_client.get("/api/v1/catalog/status").status_code == 200
        assert ok(test_client.get("/api/v1/modules"))["modules"]
        falla(test_client.get("/api/v1/catalog/remote"), 503, "CATALOG_UNAVAILABLE")


def test_preview_no_lista_dos_veces_una_leccion_resucitada(cliente, fake_catalog):
    """A6: una lección archivada que una versión posterior devuelve.

    ``restored`` ⊂ ``updated`` en el informe del plan, así que sin deduplicar
    la lección saldría dos veces en un diff que el contrato define como
    partición.
    """
    instalar_manifiesto(
        cliente,
        fake_catalog,
        bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2)),
    )
    ok(cliente.put("/api/v1/progress/lessons/mx-b", json={"viewed": True}))

    publicar_todo(fake_catalog, bundle("mx", leccion("mx-a", order=1), version=2))
    ok(cliente.post("/api/v1/catalog/modules/mx/update", json={"to_version": 2}))

    publicar_todo(
        fake_catalog,
        bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2), version=3),
    )
    data = ok(
        cliente.get(
            "/api/v1/catalog/modules/mx/update/preview", params={"to_version": 3}
        )
    )
    ids = [fila["lesson_id"] for fila in data["lessons"]]
    assert sorted(ids) == ["mx-a", "mx-b"], ids
    resucitada = next(f for f in data["lessons"] if f["lesson_id"] == "mx-b")
    assert resucitada["change"] == "updated"
    # El avance de la lección archivada seguía ahí y vuelve a contar.
    assert resucitada["progress"] in ("preserved", "rescored")


# ══════════ la relectura forzada tiene que llegar hasta el transporte ════════


def test_refresh_pide_saltarse_la_cache_de_borde_y_la_lectura_normal_no(
    cliente, fake_catalog
):
    """``POST /catalog/refresh`` ⇒ ``sin_cache=True``; ``GET /remote`` ⇒ ``False``.

    Es la mitad de lectura del hallazgo de §11.8.2. Verificado contra el bucket
    real: GCS sirve los objetos públicos con ``Cache-Control: public,
    max-age=3600`` y el borde entrega esa copia AUNQUE el objeto ya se haya
    reescrito —se observó el índice en v1 con ``age=227`` cuando el bucket ya
    tenía la v2—. Si el «Actualizar lista» del estudiante no rompe la clave de
    caché, CU-38 tarda hasta una hora en cumplirse.

    La lectura normal debe seguir SIN romperla: es la que se hace al pintar la
    pantalla, y el borde es justo lo que mantiene el catálogo dentro del nivel
    gratuito.
    """
    publicar_todo(fake_catalog, bundle("mx", version=1))
    fake_catalog.index_calls.clear()

    ok(cliente.get("/api/v1/catalog/remote"))
    assert [c["sin_cache"] for c in fake_catalog.index_calls] == [False]

    fake_catalog.index_calls.clear()
    ok(cliente.post("/api/v1/catalog/refresh"))
    assert [c["sin_cache"] for c in fake_catalog.index_calls] == [True]

    # Y `?refresh=true` es el mismo gesto por otra puerta: la que usa la UI al
    # volver a /modulos después de que el admin publique.
    fake_catalog.index_calls.clear()
    ok(cliente.get("/api/v1/catalog/remote?refresh=true"))
    assert [c["sin_cache"] for c in fake_catalog.index_calls] == [True]


# ═══════════ CU-34.2: el detalle lee el índice fresco, no la caché ═══════════


def test_detalle_ignora_la_cache_del_indice(cliente, fake_catalog):
    """Con la caché de 900 s recién llenada, el detalle ve la versión nueva."""
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))  # llena la caché

    publicar_todo(fake_catalog, bundle("mx", version=2))
    data = ok(cliente.get("/api/v1/catalog/remote/mx"))
    assert data["version"] == 2
    assert fake_catalog.index_calls[-1]["sin_cache"] is True


def test_detalle_de_una_publicacion_retirada_es_404_aunque_este_en_cache(
    cliente, fake_catalog
):
    publicar_todo(fake_catalog, bundle("mx"))
    ok(cliente.get("/api/v1/catalog/remote"))  # llena la caché

    fake_catalog.publicar_indice(indice())
    falla(cliente.get("/api/v1/catalog/remote/mx"), 404, "REMOTE_MODULE_NOT_FOUND")
