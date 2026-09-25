"""Sesión S7d — resto del catálogo (CU-38.3, CU-41.1 y hallazgos §2.3 #14-15).

Lo que se fija aquí:

1. **El preview dice lo que va a pasar (38.3).** Si la actualización va a
   recalificar una lección, la vista previa dice ``rescored`` aunque la nota
   nueva no sea nula: el efecto sale del plan, no de adivinarlo por los recuentos.
2. **El autor no se ve a sí mismo con «actualización disponible» (#15).**
   Publicar un módulo vinculado alinea su fila de ``installed_modules``.
3. **Editar un módulo vinculado lo marca (#14).** Así el aviso
   ``MODULE_LOCALLY_MODIFIED`` del actualizador deja de ser código muerto.
4. **Retirar del catálogo (41.1).** Quita la entrada del índice con CAS, no
   borra bundles y, si falla, no toca nada local.
"""

from __future__ import annotations

import pytest

from app.repositories import catalog as catalog_repo
from app.services import catalog_publisher

from test_admin_catalog import falla, ok
from test_publicacion_garantias import (  # noqa: F401 — fixtures
    ESTADO,
    PUBLICAR,
    catalogo,
    cliente,
    crear_leccion,
    indice,
    raiz,
    versiones_subidas,
)

RETIRAR = "/api/v1/admin/modules/{}/publish"


# ═════════════ helpers: un módulo local convertido en vinculado ══════════════


def _vincular(cliente, module_id: str, *, version: int, checksum: str) -> None:
    """Escribe la fila de ``installed_modules`` como la dejaría un import
    vinculado (§11.7), sin pasar por el bucket."""
    db = cliente.app.state.db

    async def _hazlo() -> None:
        await catalog_repo.upsert_installed_no_commit(
            db,
            module_id=module_id,
            object_path=f"modulos/{module_id}/v{version}.json",
            installed_version=version,
            installed_checksum=checksum,
            available_version=version,
            available_checksum=checksum,
        )
        await db.commit()

    cliente.portal.call(_hazlo)


def _manifiesto(cliente, module_id: str):
    db = cliente.app.state.db

    async def _lee():
        return await catalog_repo.get_installed(db, module_id)

    return cliente.portal.call(_lee)


def _editar_titulo(cliente, module_id: str, sufijo: str = " (rev)") -> None:
    modulo = next(
        m
        for m in ok(cliente.get("/api/v1/admin/modules"))["modules"]
        if m["id"] == module_id
    )
    ok(
        cliente.put(
            f"/api/v1/admin/modules/{module_id}",
            json={
                "order": modulo["order"],
                "title": modulo["title"] + sufijo,
                "description": modulo["description"],
                "level": modulo["level"],
            },
        )
    )


# ═══════════ #15 · publicar alinea el manifiesto del propio autor ════════════


def test_publicar_un_modulo_vinculado_alinea_su_manifiesto(cliente):
    v1 = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    _vincular(cliente, "m1", version=1, checksum=v1["checksum"])

    _editar_titulo(cliente, "m1")
    v2 = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    assert v2["version"] == 2

    fila = _manifiesto(cliente, "m1")
    assert fila.installed_version == 2
    assert fila.installed_checksum == v2["checksum"]
    assert fila.object_path == v2["object_path"]
    # Sin esto, el siguiente refresh vería v2 > v1 y le ofrecería al autor
    # «actualizar» a su propio trabajo.
    assert fila.available_version == 2
    assert fila.available_checksum == v2["checksum"]
    assert fila.locally_modified is False


def test_publicar_un_modulo_sin_manifiesto_no_lo_crea(cliente):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    assert _manifiesto(cliente, "m1") is None


def test_el_ensayo_no_toca_el_manifiesto(cliente):
    v1 = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    _vincular(cliente, "m1", version=1, checksum=v1["checksum"])
    _editar_titulo(cliente, "m1")
    ok(cliente.post(PUBLICAR.format("m1"), json={"dry_run": True}), 200)
    fila = _manifiesto(cliente, "m1")
    assert fila.installed_version == 1
    assert fila.locally_modified is True


# ═══════════ #14 · editar un módulo vinculado enciende la marca ══════════════


def test_editar_el_modulo_vinculado_lo_marca_modificado(cliente):
    _vincular(cliente, "m1", version=1, checksum="a" * 64)
    assert _manifiesto(cliente, "m1").locally_modified is False
    _editar_titulo(cliente, "m1")
    assert _manifiesto(cliente, "m1").locally_modified is True


def test_crear_una_leccion_en_el_modulo_vinculado_lo_marca(cliente):
    _vincular(cliente, "m1", version=1, checksum="a" * 64)
    crear_leccion(cliente, "nueva", order=90)
    assert _manifiesto(cliente, "m1").locally_modified is True


def test_mover_una_leccion_marca_el_modulo_de_origen(cliente):
    """Sacar una lección de un módulo vinculado también lo cambia."""
    _vincular(cliente, "m1", version=1, checksum="a" * 64)
    crear_leccion(cliente, "movil", order=90, module_id="m2")
    assert _manifiesto(cliente, "m1").locally_modified is False
    detalle = ok(cliente.get("/api/v1/admin/lessons/movil"))
    cuerpo = {
        k: detalle[k]
        for k in (
            "title", "order", "estimated_minutes", "content_markdown",
            "video_url", "enabled", "completion_rule", "pass_threshold",
            "recommended",
        )
        if k in detalle
    }
    ok(cliente.put("/api/v1/admin/lessons/movil", json={**cuerpo, "module_id": "m1"}))
    assert _manifiesto(cliente, "m1").locally_modified is True

    _vincular(cliente, "m1", version=1, checksum="a" * 64)  # vuelve a False
    ok(cliente.put("/api/v1/admin/lessons/movil", json={**cuerpo, "module_id": "m2"}))
    assert _manifiesto(cliente, "m1").locally_modified is True


def test_borrar_el_quiz_de_una_leccion_vinculada_la_marca(cliente):
    _vincular(cliente, "m1", version=1, checksum="a" * 64)
    crear_leccion(cliente, "conquiz", order=90)
    _vincular(cliente, "m1", version=1, checksum="a" * 64)
    ok(
        cliente.put(
            "/api/v1/admin/lessons/conquiz/quiz",
            json={
                "pass_threshold": 0.6,
                "questions": [
                    {
                        "order": 1,
                        "text": "¿Qué hace parallel?",
                        "options": [
                            {"key": "a", "text": "Abre una región"},
                            {"key": "b", "text": "Nada"},
                        ],
                        "correct_key": "a",
                        "explanation": "Abre la región paralela.",
                    }
                ],
            },
        )
    )
    assert _manifiesto(cliente, "m1").locally_modified is True
    _vincular(cliente, "m1", version=1, checksum="a" * 64)
    ok(cliente.delete("/api/v1/admin/lessons/conquiz/quiz"))
    assert _manifiesto(cliente, "m1").locally_modified is True


def test_editar_un_modulo_sin_manifiesto_no_falla(cliente):
    _editar_titulo(cliente, "m2")
    assert _manifiesto(cliente, "m2") is None


# ═══════════════ 41.1 · retirar una publicación del catálogo ═════════════════


def test_retirar_quita_la_entrada_y_conserva_los_bundles(cliente, raiz):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    ok(cliente.post(PUBLICAR.format("m2"), json={}), 201)

    data = ok(cliente.delete(RETIRAR.format("m1")))
    assert data == {"module_id": "m1", "retired_version": 1}

    ids = [e.id for e in indice(raiz).modules]
    assert ids == ["m2"]
    # No se borra ningún bundle: quien lo tenga incorporado sigue pudiendo
    # verificarlo, y la versión sigue siendo inmutable.
    assert versiones_subidas(raiz, "m1") == ["v1.json"]
    assert ok(cliente.get(ESTADO.format("m1")))["state"] == "never_published"


def test_republicar_tras_retirar_sale_con_la_version_siguiente(cliente, raiz):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    ok(cliente.delete(RETIRAR.format("m1")))
    data = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    assert data["version"] == 2
    assert versiones_subidas(raiz, "m1") == ["v1.json", "v2.json"]
    assert [e.id for e in indice(raiz).modules] == ["m1"]


def test_retirar_un_modulo_que_no_esta_en_el_indice_es_404(cliente):
    ok(cliente.post(PUBLICAR.format("m2"), json={}), 201)
    falla(cliente.delete(RETIRAR.format("m1")), 404, "REMOTE_MODULE_NOT_FOUND")


def test_retirar_un_modulo_inexistente_es_404(cliente):
    falla(cliente.delete(RETIRAR.format("noExiste")), 404, "MODULE_NOT_FOUND")


def test_retirar_sin_credencial_es_403(tmp_path, raiz, fake_docker, real_content):
    from fastapi.testclient import TestClient

    from test_admin_catalog import app_admin, hacer_settings

    ajustes = hacer_settings(tmp_path, clave=None, raiz=raiz)
    with TestClient(app_admin(ajustes, fake_docker)) as c:
        falla(c.delete(RETIRAR.format("m1")), 403, "CATALOG_CREDENTIALS_INVALID")


def _estado_local(cliente, module_id: str):
    db = cliente.app.state.db

    async def _lee():
        return await catalog_repo.get_published_state(db, module_id)

    return cliente.portal.call(_lee)


def test_si_el_bucket_falla_no_se_toca_nada(cliente, raiz, monkeypatch):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    antes_local = _estado_local(cliente, "m1")
    antes_indice = (raiz / "modulos" / "index.json").read_bytes()

    async def sin_red(self, data, *, if_generation_match):
        raise catalog_publisher.PublisherUnavailable("network")

    monkeypatch.setattr(catalog_publisher.LocalCatalogPublisher, "write_index", sin_red)
    falla(cliente.delete(RETIRAR.format("m1")), 503, "CATALOG_UNAVAILABLE")

    assert (raiz / "modulos" / "index.json").read_bytes() == antes_indice
    assert _estado_local(cliente, "m1") == antes_local


def test_retirar_reintenta_el_cas_una_vez(cliente, raiz, monkeypatch):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    original = catalog_publisher.LocalCatalogPublisher.write_index
    intentos: list[int] = []

    async def falla_la_primera(self, data, *, if_generation_match):
        intentos.append(1)
        if len(intentos) == 1:
            raise catalog_publisher.IndexCasFailed("otro publicó a la vez")
        return await original(self, data, if_generation_match=if_generation_match)

    monkeypatch.setattr(
        catalog_publisher.LocalCatalogPublisher, "write_index", falla_la_primera
    )
    ok(cliente.delete(RETIRAR.format("m1")))
    assert len(intentos) == 2
    assert indice(raiz).modules == []


def test_retirar_con_contencion_persistente_es_409(cliente, raiz, monkeypatch):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)

    async def cas_siempre_falla(self, data, *, if_generation_match):
        raise catalog_publisher.IndexCasFailed("otro publicó a la vez")

    monkeypatch.setattr(
        catalog_publisher.LocalCatalogPublisher, "write_index", cas_siempre_falla
    )
    error = falla(cliente.delete(RETIRAR.format("m1")), 409, "VERSION_CONFLICT")
    assert error["details"]["stage"] == "index"
    assert [e.id for e in indice(raiz).modules] == ["m1"]


@pytest.mark.parametrize("basura", [b"{no es json", b'{"index_format": 99}'])
def test_retirar_con_indice_ilegible_no_lo_sobrescribe(cliente, raiz, basura):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    (raiz / "modulos" / "index.json").write_bytes(basura)
    falla(cliente.delete(RETIRAR.format("m1")), 422, "CONTENT_VALIDATION_ERROR")
    assert (raiz / "modulos" / "index.json").read_bytes() == basura
