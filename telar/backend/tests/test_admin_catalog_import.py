"""§11.7 CU-37 · importar un módulo del bucket para editarlo.

Dos modos y una diferencia que lo decide todo: **el manifiesto**. El vinculado
conserva la fila de ``installed_modules`` —y con ella el «sé sobre qué versión
base edito»—; el fork no la tiene, y por eso no recibe actualizaciones.

Lo que se fija aquí, en orden de lo que más caro sería descubrir tarde:

1. El fork **no** queda enganchado al bucket (sin manifiesto, `origin='local'`,
   `version=1`, `checksum=NULL`). Si lo estuviera, una actualización del módulo
   original pisaría el trabajo del autor.
2. Las referencias ``recommended`` se remapean. Es lo fácil de olvidar: sin eso
   el fork apunta a lecciones del módulo ORIGINAL.
3. El vinculado sí conserva el manifiesto, y el módulo es editable por §10.
4. Un fork sobre un id ya usado no pisa nada: 409.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.repositories import catalog as catalog_repo
from app.routers import admin, admin_catalog

from conftest import build_app
from fakes.fake_catalog import FakeCatalogService
from test_routers_catalog import bundle, falla, fila_de, leccion, ok, publicar_todo

BUCKET = "telar-modulos"


@pytest.fixture
def ajustes(tmp_path: Path) -> Settings:
    return Settings(
        db_path=str(tmp_path / "telar.db"),
        jobs_dir=str(tmp_path / "jobs"),
        allowed_origins="http://localhost:5173,null",
        code_delivery="bind",
        runner_image="telar-runner:0.5.1",
        max_timeout_s=120,
        max_concurrent_jobs=2,
        max_code_bytes=262144,
        max_output_bytes=262144,
        admin_mode=True,
        catalog_bucket=BUCKET,
    )


@pytest.fixture
def catalogo(fake_catalog) -> FakeCatalogService:
    """El bucket en memoria del conftest: ningún test de esta suite toca la red."""
    return fake_catalog


@pytest.fixture
def cliente(ajustes, fake_docker, catalogo, real_content):
    app = build_app(settings=ajustes, docker=fake_docker, catalog=catalogo)
    # Los DOS routers admin: `admin` trae el CRUD de §10 —que es con lo que se
    # comprueba que un módulo importado queda realmente editable— y
    # `admin_catalog` el import de §11.7. `build_app` no monta ninguno porque
    # ambos son opcionales a nivel de artefacto (§11.2).
    app.include_router(admin.router)
    app.include_router(admin_catalog.router)
    with TestClient(app) as c:
        yield c


async def _manifiesto(app, module_id: str):
    return await catalog_repo.get_installed(app.state.db, module_id)


# ═══════════════════════════ modo VINCULADO ══════════════════════════════════


def test_vinculado_incorpora_y_conserva_el_manifiesto(cliente, catalogo):
    """El vinculado ES una incorporación: la fila de `installed_modules` queda.

    Esa fila es lo que le permite al admin saber sobre qué versión base edita, y
    a `publish` exigir la siguiente. Sin ella el import vinculado sería
    indistinguible de un fork con el mismo id.
    """
    publicar_todo(catalogo, bundle("mx", leccion("mx-a"), version=2))

    data = ok(
        cliente.post("/api/v1/admin/catalog/import", json={"module_id": "mx"}), 201
    )

    assert data["mode"] == "linked"
    assert data["base_version"] == 2
    assert data["id_remap"] is None
    assert data["module"]["id"] == "mx"
    assert [l["id"] for l in data["module"]["lessons"]] == ["mx-a"]

    # El manifiesto existe: el módulo sigue el bucket.
    estado = ok(cliente.get("/api/v1/catalog/status"))
    fila = fila_de(estado, "mx")
    assert fila["installed_version"] == 2
    assert fila["state"] != "local_only"


def test_vinculado_deja_el_modulo_editable_por_el_crud_admin(cliente, catalogo):
    """§11.7 — «queda editable por §10». Se comprueba EDITÁNDOLO de verdad."""
    publicar_todo(catalogo, bundle("mx", leccion("mx-a")))
    ok(cliente.post("/api/v1/admin/catalog/import", json={"module_id": "mx"}), 201)

    respuesta = cliente.put(
        "/api/v1/admin/modules/mx",
        json={"order": 77, "title": "Editado", "description": "d", "level": "Básico"},
    )
    assert ok(respuesta)["title"] == "Editado"


def test_importar_lo_que_no_existe_en_el_bucket_es_404(cliente, catalogo):
    publicar_todo(catalogo, bundle("mx", leccion("mx-a")))
    falla(
        cliente.post("/api/v1/admin/catalog/import", json={"module_id": "noExiste"}),
        404,
        "REMOTE_MODULE_NOT_FOUND",
    )


# ═════════════════════════════ modo FORK ═════════════════════════════════════


def test_el_fork_renombra_todo_y_lo_declara(cliente, catalogo):
    """Ids propios, y el mapa de lo renombrado para que la UI lo pueda enseñar."""
    publicar_todo(catalogo, bundle("mx", leccion("mx-a", order=1), leccion("mx-b", order=2)))

    data = ok(
        cliente.post(
            "/api/v1/admin/catalog/import",
            json={"module_id": "mx", "as_module_id": "mxBis"},
        ),
        201,
    )

    assert data["mode"] == "forked"
    assert data["module"]["id"] == "mxBis"
    # `base_version` es None a propósito: un fork no tiene versión que seguir.
    assert data["base_version"] is None
    assert data["id_remap"]["mx"] == "mxBis"
    assert data["id_remap"]["mx-a"] == "mxBis-mx-a"
    assert [l["id"] for l in data["module"]["lessons"]] == ["mxBis-mx-a", "mxBis-mx-b"]


def test_el_fork_NO_sigue_al_bucket(cliente, catalogo):
    """La propiedad que define un fork: sin manifiesto, local, v1, sin checksum.

    Si el fork conservara el manifiesto, una actualización del módulo del que
    salió le pisaría el trabajo al autor — que es exactamente lo que bifurcar
    existe para evitar.
    """
    publicar_todo(catalogo, bundle("mx", leccion("mx-a"), version=4))
    ok(
        cliente.post(
            "/api/v1/admin/catalog/import",
            json={"module_id": "mx", "as_module_id": "mxBis"},
        ),
        201,
    )

    estado = ok(cliente.get("/api/v1/catalog/status"))
    fila = fila_de(estado, "mxBis")
    # `local_only` es precisamente «no tiene fila en installed_modules».
    assert fila["state"] == "local_only"
    assert fila["installed_version"] is None
    # Y no hereda la v4 del bucket: nace en la 1, que es lo que hará que su
    # primera publicación sea la v1 y no la v5 de otro módulo.
    assert fila["available_version"] is None


def test_el_fork_remapea_las_referencias_recommended(cliente, catalogo):
    """Lo fácil de olvidar: `recommended` referencia `lesson_id`.

    Sin remapearlas, el fork apunta a las lecciones del módulo ORIGINAL — que en
    este equipo pueden no existir, o existir y ser otra cosa. El síntoma
    aparecería mucho después, en la pantalla del estudiante.
    """
    datos, crudo = bundle(
        "mx",
        leccion(
            "mx-a",
            order=1,
            recommended=[{"lesson_id": "mx-b", "label": "Sigue", "tag": "next"}],
        ),
        leccion("mx-b", order=2),
    )
    publicar_todo(catalogo, (datos, crudo))

    ok(
        cliente.post(
            "/api/v1/admin/catalog/import",
            json={"module_id": "mx", "as_module_id": "mxBis"},
        ),
        201,
    )

    leccion_forkeada = ok(cliente.get("/api/v1/lessons/mxBis-mx-a"))
    referencias = [r["lesson_id"] for r in leccion_forkeada["recommended"]]
    assert referencias == ["mxBis-mx-b"], "la referencia sigue apuntando al original"


def test_id_prefix_explicito_manda_sobre_el_derivado(cliente, catalogo):
    publicar_todo(catalogo, bundle("mx", leccion("mx-a")))

    data = ok(
        cliente.post(
            "/api/v1/admin/catalog/import",
            json={"module_id": "mx", "as_module_id": "mxBis", "id_prefix": "v2-"},
        ),
        201,
    )
    assert data["id_remap"]["mx-a"] == "v2-mx-a"


def test_un_fork_sobre_un_id_ya_usado_no_pisa_nada(cliente, catalogo):
    """El id del fork lo elige el admin, así que puede chocar. 409, no sobrescribir."""
    publicar_todo(catalogo, bundle("mx", leccion("mx-a")))
    falla(
        cliente.post(
            "/api/v1/admin/catalog/import",
            json={"module_id": "mx", "as_module_id": "m1"},
        ),
        409,
        "DUPLICATE_ID",
    )


def test_el_fork_y_el_original_pueden_convivir(cliente, catalogo):
    """Bifurcar no impide seguir teniendo el módulo del bucket incorporado."""
    publicar_todo(catalogo, bundle("mx", leccion("mx-a")))
    ok(cliente.post("/api/v1/admin/catalog/import", json={"module_id": "mx"}), 201)
    ok(
        cliente.post(
            "/api/v1/admin/catalog/import",
            json={"module_id": "mx", "as_module_id": "mxBis"},
        ),
        201,
    )

    estado = ok(cliente.get("/api/v1/catalog/status"))
    ids = {m["module_id"] for m in estado["modules"]}
    assert {"mx", "mxBis"} <= ids


# ══════════════════════════ el gate de despliegue ════════════════════════════


def test_sin_modo_autoria_no_hay_import(ajustes, fake_docker, catalogo, real_content):
    """§10.0 — el gate es de despliegue, no de sesión."""
    sin_admin = ajustes.model_copy(update={"admin_mode": False})
    app = build_app(settings=sin_admin, docker=fake_docker, catalog=catalogo)
    app.include_router(admin_catalog.router)
    with TestClient(app) as c:
        falla(
            c.post("/api/v1/admin/catalog/import", json={"module_id": "mx"}),
            401,
            "UNAUTHORIZED",
        )


def test_sin_bucket_configurado_el_import_es_503(
    ajustes, fake_docker, real_content
):
    """Importar solo LEE, pero sigue necesitando un bucket del que leer."""
    sin_bucket = ajustes.model_copy(update={"catalog_bucket": ""})
    app = build_app(settings=sin_bucket, docker=fake_docker)
    app.include_router(admin_catalog.router)
    with TestClient(app) as c:
        falla(
            c.post("/api/v1/admin/catalog/import", json={"module_id": "mx"}),
            503,
            "CATALOG_DISABLED",
        )
