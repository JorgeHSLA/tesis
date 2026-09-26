"""S6 · CU-28 — el taller en el catálogo remoto (api-contract §11.10 y §12).

Un bundle con talleres lleva ``kind`` y ``steps`` en sus lecciones y se publica
como ``bundle_format: 2``. Los bundles sin talleres siguen siendo formato 1,
**byte a byte** iguales que antes: ni el checksum de §11.8.2 ni el formato del
índice cambian. La v1.0.5 rechaza el 2 por esquema (``bundle_format:
Literal[1]`` + ``extra="forbid"`` → ``422 BUNDLE_INVALID``).

Lo que se fija:

* El lector acepta 1 y 2; un formato desconocido da un error que dice qué pasa.
* Un taller en un bundle 1 es un bundle mal formado.
* ``bundle_guard`` valida los pasos: tamaños, caracteres de control, ids, y que
  el ejemplo de cada paso viaje en el mismo bundle.
* Instalar y actualizar escriben ``kind`` y los pasos.
* Publicar elige el formato: 1 sin talleres, 2 con ellos, con el ``example_id``
  de cada paso traducido al id publicado.
"""

from __future__ import annotations

import copy
import json

import pytest

from app.schemas.catalog import ModuleBundle
from app.schemas import InstallRequest
from app.services.bundle_guard import (
    BundleContentInvalid,
    BundleInvalid,
    parse_bundle,
)
from app.services.catalog_hash import bundle_checksum, content_hash
from app.services.module_installer import install_module

from test_module_install import (  # noqa: F401 — fixtures reutilizadas
    app_vacia,
    catalogo,
    ejemplo,
    escalar,
    filas,
    leccion,
    montar,
)

MAX_BYTES = 4 * 1024 * 1024


# ─────────────────────────────── fábricas ────────────────────────────────────


def paso(n: int = 1, **over) -> dict:
    base = {"title": f"Paso {n}", "body_markdown": f"Haz la cosa {n}.\n", "example_id": None}
    base.update(over)
    return base


def taller(lid: str = "tallerHilos", *, order: int = 2, pasos: list | None = None, **over) -> dict:
    campos = {
        "example": None,
        "quiz": None,
        "completion_rule": "viewed",
        "kind": "taller",
        "steps": pasos if pasos is not None else [paso(1), paso(2)],
    }
    campos.update(over)
    return leccion(lid, order=order, **campos)


def payload(*lecciones: dict, formato: int = 2, module_id: str = "m9") -> dict:
    return {
        "bundle_format": formato,
        "checksum": "0" * 64,
        "module": {
            "id": module_id,
            "order_hint": 1,
            "title": f"Módulo {module_id}",
            "description": "Descripción",
            "level": "Básico",
            "version": 1,
            "published_at": "2026-09-26T12:00:00.000Z",
            "author_label": "Curso Telar",
            "notes": "",
        },
        "lessons": list(lecciones),
    }


def crudo(datos: dict) -> bytes:
    return json.dumps(datos, ensure_ascii=False).encode("utf-8")


def sellar(datos: dict) -> tuple[dict, bytes]:
    """Como ``test_module_install.sellar`` pero sin fijar el formato."""
    modelo = ModuleBundle.model_validate(datos)
    limpio = modelo.model_dump(mode="json")
    limpio["checksum"] = bundle_checksum(limpio)
    return limpio, crudo(limpio)


def con_taller() -> dict:
    return payload(
        leccion("base", order=1, example=ejemplo("base-ej")),
        taller(pasos=[paso(1, example_id="base-ej"), paso(2)]),
    )


# ─────────────────────── formato: 1 y 2, y nada más ──────────────────────────


def test_un_bundle_2_con_talleres_se_acepta():
    bundle = parse_bundle(crudo(con_taller()), max_bytes=MAX_BYTES)
    assert bundle.bundle_format == 2
    t = bundle.lessons[1]
    assert t.kind == "taller"
    assert [(p.title, p.example_id) for p in t.steps] == [("Paso 1", "base-ej"), ("Paso 2", None)]


def test_un_bundle_1_sigue_aceptandose():
    datos = payload(leccion("base", order=1), formato=1)
    assert parse_bundle(crudo(datos), max_bytes=MAX_BYTES).bundle_format == 1


def test_un_taller_en_un_bundle_1_esta_mal_formado():
    datos = con_taller()
    datos["bundle_format"] = 1
    with pytest.raises(BundleInvalid) as exc:
        parse_bundle(crudo(datos), max_bytes=MAX_BYTES)
    assert any("bundle_format" in d["field"] for d in exc.value.details)


@pytest.mark.parametrize("formato", [0, 3, 99, "2"])
def test_un_formato_desconocido_da_un_error_claro(formato):
    datos = con_taller()
    datos["bundle_format"] = formato
    with pytest.raises(BundleInvalid) as exc:
        parse_bundle(crudo(datos), max_bytes=MAX_BYTES)
    assert "formato" in exc.value.message.lower()
    assert exc.value.details[0]["field"] == "bundle_format"


def test_un_bundle_1_se_serializa_sin_kind_ni_steps():
    """Lo que blinda el checksum de los bundles ya publicados: validar y volver a
    volcar un bundle 1 no le añade claves (y el golden de m1 sigue valiendo)."""
    datos = payload(leccion("base", order=1), formato=1)
    volcado = ModuleBundle.model_validate(datos).model_dump(mode="json")
    # Exactamente las claves de antes de S6 (el golden de m1 en
    # test_catalog_hash fija además el digest de un bundle real).
    assert set(volcado["lessons"][0]) == {
        "id", "order", "title", "estimated_minutes", "content_markdown",
        "video_url", "enabled", "completion_rule", "pass_threshold",
        "recommended", "example", "quiz",
    }
    assert ModuleBundle.model_validate(volcado).model_dump(mode="json") == volcado


def test_content_hash_incluye_los_pasos():
    base = ModuleBundle.model_validate(con_taller())
    otra = copy.deepcopy(con_taller())
    otra["lessons"][1]["steps"][1]["body_markdown"] = "Otra cosa.\n"
    assert content_hash(ModuleBundle.model_validate(otra)) != content_hash(base)


# ─────────────────────────── reglas del taller ───────────────────────────────


def _rechazo_de_contenido(datos: dict) -> list[dict]:
    with pytest.raises(BundleContentInvalid) as exc:
        parse_bundle(crudo(datos), max_bytes=MAX_BYTES)
    return exc.value.details


def test_un_taller_sin_pasos_se_rechaza():
    detalles = _rechazo_de_contenido(payload(taller(order=1, pasos=[])))
    assert detalles[0]["field"] == "lessons[0].steps"


def test_un_taller_no_lleva_quiz_ni_video():
    from test_module_install import quiz

    detalles = _rechazo_de_contenido(
        payload(taller(order=1, quiz=quiz(), video_url="https://youtu.be/dQw4w9WgXcQ"))
    )
    campos = {d["field"] for d in detalles}
    assert {"lessons[0].quiz", "lessons[0].video_url"} <= campos


def test_la_regla_de_un_taller_publicado_es_viewed():
    detalles = _rechazo_de_contenido(payload(taller(order=1, completion_rule="run")))
    assert any(d["field"] == "lessons[0].completion_rule" for d in detalles)


def test_el_ejemplo_de_un_paso_tiene_que_viajar_en_el_bundle():
    detalles = _rechazo_de_contenido(
        payload(taller(order=1, pasos=[paso(1, example_id="deOtroModulo")]))
    )
    assert detalles[0]["field"] == "lessons[0].steps[0].example_id"


def test_el_markdown_del_paso_usa_el_mismo_subset():
    detalles = _rechazo_de_contenido(
        payload(taller(order=1, pasos=[paso(1, body_markdown="<script>x</script>\n")]))
    )
    assert detalles[0]["field"] == "lessons[0].steps[0].body_markdown"


def test_pasos_en_una_leccion_normal_estan_mal_formados():
    datos = payload(leccion("base", order=1, kind="leccion", steps=[paso(1)]))
    with pytest.raises(BundleInvalid):
        parse_bundle(crudo(datos), max_bytes=MAX_BYTES)


@pytest.mark.parametrize(
    "malo",
    [
        {"title": "Paso\x00uno"},
        {"body_markdown": "Texto ‮ invertido\n"},
        {"example_id": "../fuera"},
        {"title": "x" * 161},
        {"body_markdown": "x" * 20_001},
        {"title": ""},
        {"extra": "campo"},
    ],
)
def test_el_guard_endurece_los_pasos(malo):
    datos = payload(taller(order=1, pasos=[paso(1, **malo)]))
    with pytest.raises(BundleInvalid):
        parse_bundle(crudo(datos), max_bytes=MAX_BYTES)


def test_un_taller_admite_como_mucho_50_pasos():
    datos = payload(taller(order=1, pasos=[paso(n) for n in range(51)]))
    with pytest.raises(BundleInvalid):
        parse_bundle(crudo(datos), max_bytes=MAX_BYTES)


# ──────────────────────────────── instalar ───────────────────────────────────


async def test_instalar_un_bundle_2_escribe_kind_y_pasos(app_vacia, catalogo):
    montar(catalogo, sellar(con_taller()))

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    db = app_vacia.state.db
    assert await escalar(db, "SELECT kind FROM lessons WHERE id='tallerHilos'") == "taller"
    assert await escalar(db, "SELECT kind FROM lessons WHERE id='base'") == "leccion"
    pasos = [
        tuple(f)
        for f in await filas(
            db,
            "SELECT idx, title, example_id FROM workshop_steps "
            "WHERE lesson_id='tallerHilos' ORDER BY idx",
        )
    ]
    assert pasos == [(0, "Paso 1", "base-ej"), (1, "Paso 2", None)]
    snapshot = app_vacia.state.content.lesson("tallerHilos")
    assert snapshot.kind == "taller" and len(snapshot.steps) == 2


# ─────────────────────────────── actualizar ──────────────────────────────────


async def test_actualizar_reemplaza_los_pasos_del_taller():
    """El aplicador del actualizador escribe `kind` y reescribe los pasos."""
    from test_module_update import Paquete, _app_nueva, actualizar, instalar

    def paquete2(version: int, pasos: list[dict]) -> Paquete:
        datos = payload(
            leccion("base", order=1, example=ejemplo("base-ej")),
            taller(pasos=pasos),
            module_id="m9",
        )
        datos["module"]["version"] = version
        datos["checksum"] = bundle_checksum(datos)
        raw = crudo(datos)
        return Paquete(datos, raw, ModuleBundle.model_validate(datos), datos["checksum"])

    app = await _app_nueva()
    try:
        await instalar(app, paquete2(1, [paso(1), paso(2), paso(3)]))
        await actualizar(app, paquete2(2, [paso(1, title="Nuevo primero")]))
        pasos = [
            tuple(f)
            for f in await filas(
                app.state.db,
                "SELECT idx, title FROM workshop_steps WHERE lesson_id='tallerHilos' ORDER BY idx",
            )
        ]
        assert pasos == [(0, "Nuevo primero")]
        assert app.state.content.lesson("tallerHilos").kind == "taller"
    finally:
        await app.state.db.close()


# ─────────────────────────────── publicar ────────────────────────────────────


def _cliente_publicador(tmp_path, fake_docker, real_content):
    """El mismo montaje que ``test_publicacion_garantias.cliente``."""
    from fastapi.testclient import TestClient

    from app.routers import admin as admin_router
    from app.routers import admin_catalog

    from conftest import build_app
    from test_admin_catalog import escribir_clave, hacer_settings
    from test_publicacion_garantias import CatalogoSobreRaiz

    raiz = tmp_path / "bucket"
    raiz.mkdir()
    ajustes = hacer_settings(tmp_path, clave=escribir_clave(tmp_path), raiz=raiz)
    app = build_app(settings=ajustes, docker=fake_docker, catalog=CatalogoSobreRaiz(raiz))
    app.include_router(admin_catalog.router)
    app.include_router(admin_router.router)
    return TestClient(app), raiz


def _publicar(cliente, module_id: str = "m1"):
    return cliente.post(f"/api/v1/admin/modules/{module_id}/publish", json={})


def _bundle_publicado(raiz, module_id: str = "m1") -> dict:
    ficheros = sorted((raiz / "modulos" / module_id).glob("v*.json"))
    return json.loads(ficheros[-1].read_bytes())


def test_publicar_sin_talleres_sigue_siendo_formato_1(tmp_path, fake_docker, real_content):
    cliente, raiz = _cliente_publicador(tmp_path, fake_docker, real_content)
    with cliente:
        respuesta = _publicar(cliente)
        assert respuesta.status_code == 201, respuesta.text
    datos = _bundle_publicado(raiz)
    assert datos["bundle_format"] == 1
    assert all("kind" not in l and "steps" not in l for l in datos["lessons"])


def test_publicar_con_un_taller_es_formato_2_con_los_ids_publicados(
    tmp_path, fake_docker, real_content
):
    cliente, raiz = _cliente_publicador(tmp_path, fake_docker, real_content)
    with cliente:
        from test_taller import crear_taller

        crear_taller(cliente, pasos=2)  # el paso 0 usa `primerEjemplo`, de m1
        respuesta = _publicar(cliente)
        assert respuesta.status_code == 201, respuesta.text
    datos = _bundle_publicado(raiz)
    assert datos["bundle_format"] == 2
    t = next(l for l in datos["lessons"] if l["id"] == "tallerHilos")
    assert t["kind"] == "taller" and t["completion_rule"] == "viewed"
    # `primerEjemplo` choca con el id de su lección y se publica renombrado: el
    # paso tiene que apuntar al id PUBLICADO, o el bundle no se instalaría.
    ids_publicados = {l["example"]["id"] for l in datos["lessons"] if l.get("example")}
    assert t["steps"][0]["example_id"] in ids_publicados
    assert t["steps"][1]["example_id"] is None
    assert all("kind" not in l for l in datos["lessons"] if l["id"] != "tallerHilos")
    # Y lo publicado pasa la misma puerta que usará el estudiante.
    parse_bundle(json.dumps(datos, ensure_ascii=False).encode("utf-8"), max_bytes=MAX_BYTES)


def test_publicar_un_taller_con_un_ejemplo_de_otro_modulo_falla_antes_de_subir(
    tmp_path, fake_docker, real_content
):
    cliente, raiz = _cliente_publicador(tmp_path, fake_docker, real_content)
    with cliente:
        from test_taller import crear_taller

        crear_taller(cliente, pasos=0)
        otro = next(
            e["id"]
            for e in cliente.get("/api/v1/examples").json()["data"]["examples"]
            if e["module_id"] != "m1"
        )
        r = cliente.post(
            "/api/v1/admin/lessons/tallerHilos/steps",
            json={"title": "P", "body_markdown": "x", "example_id": otro},
        )
        assert r.status_code == 201, r.text
        respuesta = _publicar(cliente)
        assert respuesta.status_code == 422, respuesta.text
    assert not (raiz / "modulos" / "m1").exists()


def test_el_fork_traduce_el_ejemplo_de_los_pasos():
    """CU-37: el fork prefija los ids de ejemplo; los pasos tienen que seguirlos."""
    from app.services.catalog_import import reescribir_bundle

    original = ModuleBundle.model_validate(con_taller())
    fork, _ = reescribir_bundle(original, as_module_id="m9bis", prefijo="x-")
    assert fork.lessons[1].steps[0].example_id == "x-base-ej"
    assert fork.lessons[0].example.id == "x-base-ej"
    assert fork.bundle_format == 2
