"""Sesión S5 — publicar con garantías (CU-37.1, 37.3, 37.4) y detección de cambios (D+).

Lo que se fija aquí, en el orden en que puede doler:

1. **Un bundle que el estudiante no podría instalar no sale de la máquina del
   autor.** Publicar valida con las MISMAS reglas que el importador, también en
   el ensayo, y falla antes de tocar el bucket.
2. **Publicar es idempotente.** Si el bundle vN ya está subido con el mismo
   contenido (índice o estado local a medias), reintentar completa lo que falta
   en vez de dar ``VERSION_CONFLICT`` o crear una vN+1 idéntica.
3. **La huella de contenido no depende de cuándo se publica.** ``content_hash``
   ignora ``published_at`` (y la versión y las notas, que son metadatos de la
   publicación): sin eso, «¿hay cambios?» diría siempre que sí.

Todo corre con el driver ``http_local`` (publica a ficheros) y un puerto de
lectura que lee esos mismos ficheros: ningún test abre un socket.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.repositories import catalog as catalog_repo
from app.routers import admin as admin_router
from app.schemas.catalog import CatalogIndex, ModuleBundle
from app.services import catalog_publisher
from app.services.catalog_client import CatalogUnavailable
from app.services.catalog_hash import bundle_checksum, content_hash

from conftest import build_app
from fakes.fake_catalog import FakeCatalogService
from test_admin_catalog import (
    escribir_clave,
    falla,
    hacer_settings,
    ok,
)

FIXTURE = Path(__file__).parent / "fixtures" / "bundles" / "m1-v1.json"
PUBLICAR = "/api/v1/admin/modules/{}/publish"
ESTADO = "/api/v1/admin/modules/{}/publish/status"


class CatalogoSobreRaiz(FakeCatalogService):
    """Puerto de LECTURA sobre los ficheros que escribe el publicador local.

    Es el cierre del círculo que en producción hace el bucket: lo que publica
    ``LocalCatalogPublisher`` es exactamente lo que lee el diálogo de publicar.
    """

    def __init__(self, raiz: Path) -> None:
        super().__init__()
        self.raiz = raiz

    def _sincronizar(self) -> None:
        for fichero in self.raiz.rglob("*.json"):
            self.objetos[fichero.relative_to(self.raiz).as_posix()] = fichero.read_bytes()

    async def fetch_index(self, *, max_bytes: int, sin_cache: bool = False):
        self._sincronizar()
        return await super().fetch_index(max_bytes=max_bytes, sin_cache=sin_cache)

    async def fetch_module(self, module_id, version, *, max_bytes, generation=None):
        self._sincronizar()
        return await super().fetch_module(
            module_id, version, max_bytes=max_bytes, generation=generation
        )


@pytest.fixture
def catalogo(raiz) -> CatalogoSobreRaiz:
    return CatalogoSobreRaiz(raiz)


@pytest.fixture
def raiz(tmp_path: Path) -> Path:
    destino = tmp_path / "bucket"
    destino.mkdir()
    return destino


@pytest.fixture
def cliente(tmp_path, raiz, catalogo, fake_docker, real_content):
    ajustes = hacer_settings(tmp_path, clave=escribir_clave(tmp_path), raiz=raiz)
    app = build_app(settings=ajustes, docker=fake_docker, catalog=catalogo)
    from app.routers import admin_catalog

    app.include_router(admin_catalog.router)
    app.include_router(admin_router.router)
    with TestClient(app) as c:
        yield c


def indice(raiz: Path) -> CatalogIndex:
    return CatalogIndex.model_validate_json((raiz / "modulos" / "index.json").read_bytes())


def versiones_subidas(raiz: Path, module_id: str) -> list[str]:
    return sorted(p.name for p in (raiz / "modulos" / module_id).glob("v*.json"))


def crear_leccion(cliente, lid: str, *, order: int, **over) -> None:
    cuerpo = {
        "id": lid,
        "module_id": "m1",
        "order": order,
        "title": f"Lección {lid}",
        "estimated_minutes": 5,
        "content_markdown": "# Hola\n\nUn párrafo.\n",
        "completion_rule": "viewed",
    }
    cuerpo.update(over)
    ok(cliente.post("/api/v1/admin/lessons", json=cuerpo), 201)


# ═══════════════════════ content_hash: la huella estable ═════════════════════


def _fixture() -> ModuleBundle:
    return ModuleBundle.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_content_hash_no_depende_de_published_at_version_ni_notas():
    base = _fixture()
    otra_publicacion = base.model_copy(
        update={
            "checksum": "f" * 64,
            "module": base.module.model_copy(
                update={
                    "published_at": "2030-01-01T00:00:00.000Z",
                    "version": base.module.version + 7,
                    "notes": "otras notas",
                }
            ),
        }
    )
    assert content_hash(otra_publicacion) == content_hash(base)
    # Y el checksum publicado SÍ cambia: su algoritmo no se toca (la v1.0.5 lo
    # verifica al instalar).
    assert bundle_checksum(otra_publicacion) != bundle_checksum(base)


def test_content_hash_cambia_si_cambia_el_contenido():
    base = _fixture()
    leccion = base.lessons[0]
    editada = base.model_copy(
        update={
            "lessons": [leccion.model_copy(update={"title": leccion.title + "!"})]
            + list(base.lessons[1:])
        }
    )
    assert content_hash(editada) != content_hash(base)


def test_content_hash_no_modifica_el_bundle():
    base = _fixture()
    antes = base.model_dump(mode="json")
    content_hash(base)
    assert base.model_dump(mode="json") == antes


# ═════════════════ CU-37.1: validar como el importador ════════════════════════


def test_publicar_un_bundle_invalido_falla_antes_de_subir(cliente, raiz):
    """«quiz» sin quiz: la autoría lo admite (se añade después), el estudiante no."""
    crear_leccion(cliente, "sinQuiz", order=50, completion_rule="quiz")

    for dry_run in (True, False):
        error = falla(
            cliente.post(PUBLICAR.format("m1"), json={"dry_run": dry_run}),
            422,
            "CONTENT_VALIDATION_ERROR",
        )
        problema = next(d for d in error["details"] if d.get("lesson_id") == "sinQuiz")
        assert problema["field"].endswith("completion_rule")
    assert list(raiz.rglob("*.json")) == []


def test_el_bundle_renumera_el_orden_de_las_lecciones(cliente, raiz):
    """Huecos en el orden local (1, 2, 50) → 1..n en el bundle, o el guard lo rechaza."""
    crear_leccion(cliente, "alFinal", order=50)
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)

    bundle = ModuleBundle.model_validate_json(
        (raiz / "modulos" / "m1" / "v1.json").read_bytes()
    )
    assert [l.order for l in bundle.lessons] == list(range(1, len(bundle.lessons) + 1))
    assert bundle.lessons[-1].id == "alFinal"


# ═════════════════════ D+: ¿hay cambios sin publicar? ════════════════════════


def test_estado_de_un_modulo_nunca_publicado(cliente):
    # Un bucket SIN índice es un catálogo inservible (igual que en el adaptador
    # real), no «nada publicado»: se publica otro módulo para que exista.
    ok(cliente.post(PUBLICAR.format("m2"), json={}), 201)
    data = ok(cliente.get(ESTADO.format("m1")))
    assert data["state"] == "never_published"
    assert data["published_version"] is None
    assert len(data["content_hash"]) == 64


def test_recien_publicado_no_hay_cambios_y_editar_los_crea(cliente):
    ok(cliente.post(PUBLICAR.format("m1"), json={"notes": "primera"}), 201)

    data = ok(cliente.get(ESTADO.format("m1")))
    assert data["state"] == "unchanged"
    assert data["published_version"] == 1
    # Dos consultas seguidas dan la misma huella: published_at no entra.
    assert ok(cliente.get(ESTADO.format("m1")))["content_hash"] == data["content_hash"]

    modulo = next(
        m for m in ok(cliente.get("/api/v1/admin/modules"))["modules"] if m["id"] == "m1"
    )
    ok(
        cliente.put(
            "/api/v1/admin/modules/m1",
            json={
                "order": modulo["order"],
                "title": modulo["title"] + " (revisado)",
                "description": modulo["description"],
                "level": modulo["level"],
            },
        )
    )
    cambiado = ok(cliente.get(ESTADO.format("m1")))
    assert cambiado["state"] == "changed"
    assert cambiado["published_version"] == 1


def test_sin_red_el_estado_es_desconocido(cliente, catalogo):
    catalogo.fallar_indice(CatalogUnavailable("network", causa="sin red"))
    data = ok(cliente.get(ESTADO.format("m1")))
    assert data["state"] == "unknown"
    assert data["published_version"] is None


def test_el_estado_lee_el_indice_sin_cache(cliente, catalogo):
    ok(cliente.get(ESTADO.format("m1")))
    assert catalogo.index_calls[-1]["sin_cache"] is True


def test_estado_de_un_modulo_inexistente_es_404(cliente):
    falla(cliente.get(ESTADO.format("noExiste")), 404, "MODULE_NOT_FOUND")


# ═══════════════ CU-37.3: reintento idempotente tras fallar el índice ═════════


def test_reintentar_tras_fallar_el_indice_completa_sin_crear_otra_version(
    cliente, raiz, monkeypatch
):
    original = catalog_publisher.LocalCatalogPublisher.write_index

    async def cas_siempre_falla(self, data, *, if_generation_match):
        raise catalog_publisher.IndexCasFailed("otro publicó a la vez")

    monkeypatch.setattr(catalog_publisher.LocalCatalogPublisher, "write_index", cas_siempre_falla)
    error = falla(cliente.post(PUBLICAR.format("m1"), json={}), 409, "VERSION_CONFLICT")
    assert error["details"]["stage"] == "index"
    assert versiones_subidas(raiz, "m1") == ["v1.json"]

    monkeypatch.setattr(catalog_publisher.LocalCatalogPublisher, "write_index", original)
    data = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)

    assert data["published"] is True and data["index_updated"] is True
    assert data["version"] == 1
    assert versiones_subidas(raiz, "m1") == ["v1.json"]
    subido = ModuleBundle.model_validate_json((raiz / "modulos" / "m1" / "v1.json").read_bytes())
    # Lo que se anuncia es lo que HAY en el bucket, no el bundle recién construido.
    assert data["checksum"] == subido.checksum
    assert data["published_at"] == subido.module.published_at
    entrada = next(e for e in indice(raiz).modules if e.id == "m1")
    assert (entrada.version, entrada.checksum) == (1, subido.checksum)
    assert ok(cliente.get(ESTADO.format("m1")))["state"] == "unchanged"


def test_la_misma_version_con_otro_contenido_sigue_siendo_conflicto(
    cliente, raiz, monkeypatch
):
    async def cas_siempre_falla(self, data, *, if_generation_match):
        raise catalog_publisher.IndexCasFailed("otro publicó a la vez")

    monkeypatch.setattr(catalog_publisher.LocalCatalogPublisher, "write_index", cas_siempre_falla)
    falla(cliente.post(PUBLICAR.format("m1"), json={}), 409, "VERSION_CONFLICT")
    monkeypatch.undo()

    crear_leccion(cliente, "nueva", order=90)
    error = falla(cliente.post(PUBLICAR.format("m1"), json={}), 409, "VERSION_CONFLICT")
    assert error["details"]["stage"] == "bundle"
    assert versiones_subidas(raiz, "m1") == ["v1.json"]


# ═══════════ CU-37.4: publicado en la nube, estado local sin actualizar ═══════


def test_si_falla_el_estado_local_se_dice_y_el_reintento_reconcilia(
    cliente, raiz, monkeypatch
):
    original = catalog_repo.set_published_no_commit

    async def rompe(*args, **kwargs):
        raise RuntimeError("disco lleno")

    monkeypatch.setattr(catalog_repo, "set_published_no_commit", rompe)
    data = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    assert data["published"] is True and data["local_state_updated"] is False

    estado = ok(cliente.get(ESTADO.format("m1")))
    assert estado["state"] == "out_of_sync"
    assert estado["published_version"] == 1

    monkeypatch.setattr(catalog_repo, "set_published_no_commit", original)
    data = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    assert data["version"] == 1 and data["local_state_updated"] is True
    assert versiones_subidas(raiz, "m1") == ["v1.json"]
    assert ok(cliente.get(ESTADO.format("m1")))["state"] == "unchanged"


def test_publicar_normal_declara_el_estado_local_actualizado(cliente):
    data = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    assert data["local_state_updated"] is True


def test_el_desfase_local_con_cambios_publica_la_siguiente(cliente, raiz, monkeypatch):
    """Publicado en la nube sin constancia local y DESPUÉS editado: sale la v2.

    Sin tomar la versión del índice, el reintento chocaría para siempre con la
    v1 ya subida (contenido distinto ⇒ 409) y el módulo quedaría impublicable.
    """
    async def rompe(*args, **kwargs):
        raise RuntimeError("disco lleno")

    monkeypatch.setattr(catalog_repo, "set_published_no_commit", rompe)
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    monkeypatch.undo()

    crear_leccion(cliente, "despues", order=70)
    assert ok(cliente.get(ESTADO.format("m1")))["state"] == "changed"

    data = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    assert data["version"] == 2
    assert versiones_subidas(raiz, "m1") == ["v1.json", "v2.json"]
    assert ok(cliente.get(ESTADO.format("m1")))["state"] == "unchanged"


def test_el_tope_de_codigo_del_importador_tambien_frena_la_publicacion(
    tmp_path, raiz, fake_docker, real_content
):
    """Lo que ``validar_bundle`` exige más allá del guard llega al autor por lección."""
    ajustes = hacer_settings(
        tmp_path, clave=escribir_clave(tmp_path), raiz=raiz
    ).model_copy(update={"max_code_bytes": 64})
    app = build_app(settings=ajustes, docker=fake_docker)
    from app.routers import admin_catalog

    app.include_router(admin_catalog.router)
    with TestClient(app) as c:
        error = falla(
            c.post(PUBLICAR.format("m1"), json={"dry_run": True}),
            422,
            "CONTENT_VALIDATION_ERROR",
        )
    assert error["details"], error
    assert all(d["lesson_id"] for d in error["details"])
    assert all(d["field"].endswith("example.source_code") for d in error["details"])
    assert list(raiz.rglob("*.json")) == []


@pytest.mark.parametrize("manipulacion", ["version", "checksum"])
def test_un_objeto_manipulado_en_el_bucket_no_se_reutiliza(
    cliente, raiz, monkeypatch, manipulacion
):
    """Mismo contenido pero otra versión dentro, o checksum falso: es conflicto.

    `content_hash` ignora esos campos a propósito, así que el reintento
    idempotente tiene que comprobarlos aparte o los anunciaría en el índice.
    """
    async def cas_siempre_falla(self, data, *, if_generation_match):
        raise catalog_publisher.IndexCasFailed("otro publicó a la vez")

    monkeypatch.setattr(catalog_publisher.LocalCatalogPublisher, "write_index", cas_siempre_falla)
    falla(cliente.post(PUBLICAR.format("m1"), json={}), 409, "VERSION_CONFLICT")
    monkeypatch.undo()

    ruta = raiz / "modulos" / "m1" / "v1.json"
    datos = json.loads(ruta.read_bytes())
    if manipulacion == "version":
        datos["module"]["version"] = 7
        datos["checksum"] = bundle_checksum(datos)
    else:
        datos["checksum"] = "e" * 64
    ruta.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")

    error = falla(cliente.post(PUBLICAR.format("m1"), json={}), 409, "VERSION_CONFLICT")
    assert error["details"]["stage"] == "bundle"
    assert not (raiz / "modulos" / "index.json").exists()


def test_el_ensayo_en_desfase_anuncia_la_vigente_y_no_escribe(cliente, raiz, monkeypatch):
    """dry_run tras publicar sin constancia local: describe la vN ya subida."""
    async def rompe(*args, **kwargs):
        raise RuntimeError("disco lleno")

    monkeypatch.setattr(catalog_repo, "set_published_no_commit", rompe)
    publicado = ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    monkeypatch.undo()
    antes = {p: p.read_bytes() for p in raiz.rglob("*.json")}

    data = ok(cliente.post(PUBLICAR.format("m1"), json={"dry_run": True}))
    assert data["published"] is False
    assert (data["version"], data["checksum"]) == (1, publicado["checksum"])
    assert {p: p.read_bytes() for p in raiz.rglob("*.json")} == antes
    assert ok(cliente.get(ESTADO.format("m1")))["state"] == "out_of_sync"
