"""Descarga del curso completo — ``POST /api/v1/catalog/sync`` (v1.0.10).

El contenido del curso ya no viaja en la app: vive en el catálogo de la nube y
cada instalación lo descarga. Lo que se defiende aquí:

* una base vacía recibe TODOS los módulos del índice, en su orden;
* sincronizar otra vez no repite nada, y un módulo que el estudiante quitó no
  vuelve solo;
* los módulos base que sembraban las versiones ≤ 1.0.9 (``m1``–``m8``) se
  cambian por su versión de la nube sin perder el avance;
* un id local que no es base heredado no se pisa;
* un fallo de un módulo no impide los demás, y se reintenta después;
* en modo autoría no se descarga nada.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.repositories import catalog as catalog_repo
from app.services.course_sync import SEEN_KEY, sincronizar_curso
from app.services.catalog_client import CatalogUnavailable
from app.tools.seed_content import seed_content_into

from conftest import build_app
from test_module_install import (
    app_con_db,
    bundle,
    catalogo,  # noqa: F401 — fixture
    escalar,
    filas,
    indice,
    leccion,
    m1_publicable,
    montar,
    publicar,
    sellar,
)


async def _ids_instalados(db) -> list[str]:
    return [fila.module_id for fila in await catalog_repo.list_installed(db)]


async def _modulos_por_orden(db) -> list[tuple[str, int]]:
    return [
        (fila[0], fila[1])
        for fila in await filas(db, 'SELECT id, "order" FROM modules ORDER BY "order"')
    ]


# ─────────────────────────── instalación nueva ──────────────────────────────


async def test_base_vacia_recibe_todo_el_curso_en_orden(settings, catalogo):
    montar(
        catalogo,
        bundle("mB", leccion("b1"), order_hint=300),
        bundle("mA", leccion("a1"), leccion("a2", order=2), order_hint=100),
    )
    async with app_con_db(settings) as app:
        resultado = await sincronizar_curso(app, catalog=catalogo)

        assert resultado.installed == ["mA", "mB"]  # por order_hint
        assert resultado.replaced == [] and resultado.failed == []
        assert await _modulos_por_orden(app.state.db) == [("mA", 100), ("mB", 300)]
        assert app.state.content.exists_lesson("a2")


async def test_sincronizar_otra_vez_no_repite_nada(settings, catalogo):
    montar(catalogo, bundle("mA", leccion("a1")))
    async with app_con_db(settings) as app:
        await sincronizar_curso(app, catalog=catalogo)
        segunda = await sincronizar_curso(app, catalog=catalogo)

        assert segunda.installed == [] and segunda.failed == []
        assert await _ids_instalados(app.state.db) == ["mA"]


async def test_un_modulo_quitado_no_vuelve_solo(settings, catalogo):
    montar(catalogo, bundle("mA", leccion("a1")))
    async with app_con_db(settings) as app:
        db = app.state.db
        await sincronizar_curso(app, catalog=catalogo)
        # Lo mismo que hace DELETE /catalog/modules/{id}: CASCADE al manifiesto.
        await db.execute("DELETE FROM modules WHERE id = 'mA'")
        await db.commit()

        resultado = await sincronizar_curso(app, catalog=catalogo)

        assert resultado.installed == []
        assert await _ids_instalados(db) == []


async def test_un_modulo_publicado_despues_llega_en_la_siguiente(settings, catalogo):
    a = bundle("mA", leccion("a1"), order_hint=100)
    montar(catalogo, a)
    async with app_con_db(settings) as app:
        await sincronizar_curso(app, catalog=catalogo)
        montar(catalogo, a, bundle("mNuevo", leccion("n1"), order_hint=200))

        resultado = await sincronizar_curso(app, catalog=catalogo)

        assert resultado.installed == ["mNuevo"]


async def test_lo_que_ya_estaba_incorporado_cuenta_como_atendido(settings, catalogo):
    """Un módulo incorporado a mano antes de esta versión, y quitado después,
    tampoco vuelve: la primera sincronización ya lo anota."""
    montar(catalogo, bundle("mA", leccion("a1")))
    async with app_con_db(settings) as app:
        db = app.state.db
        await sincronizar_curso(app, catalog=catalogo)
        vistos = await escalar(db, "SELECT value FROM app_meta WHERE key = ?", (SEEN_KEY,))
        assert vistos == '["mA"]'


# ───────────────────── contenido base de versiones ≤ 1.0.9 ──────────────────


async def test_el_m1_heredado_se_cambia_por_el_de_la_nube_con_su_avance(
    settings, catalogo
):
    base, _ = m1_publicable()
    # Se publica en el mismo puesto que tenía en la app (400): se vuelve a
    # sellar porque el checksum cubre el `order_hint`.
    datos, raw = sellar({**base, "module": {**base["module"], "order_hint": 400}})
    catalogo.publicar_indice(indice(publicar(catalogo, datos, raw)))

    async def semilla(conn):
        await seed_content_into(conn)  # m1–m8 como los sembraba la app
        await conn.execute(
            "INSERT INTO lesson_progress (lesson_id, viewed, completed, best_quiz_score)"
            " VALUES ('primerEjemplo', 1, 1, 4)"
        )
        await conn.commit()

    async with app_con_db(settings, semilla=semilla) as app:
        db = app.state.db
        assert await _ids_instalados(db) == []  # local_only, sin manifiesto

        resultado = await sincronizar_curso(app, catalog=catalogo)

        assert resultado.replaced == ["m1"] and resultado.failed == []
        assert await _ids_instalados(db) == ["m1"]
        assert await escalar(db, 'SELECT "order" FROM modules WHERE id = ?', ("m1",)) == 400
        avance = await filas(
            db,
            "SELECT viewed, completed, best_quiz_score FROM lesson_progress"
            " WHERE lesson_id = 'primerEjemplo'",
        )
        assert [tuple(f) for f in avance] == [(1, 1, 4)]
        # El ejemplo heredado (id == lección) se fue con el módulo; queda el nuevo.
        assert await escalar(
            db, "SELECT COUNT(*) FROM examples WHERE id = 'primerEjemplo'"
        ) == 0
        assert app.state.content.exists_lesson("primerEjemplo")
        # Los demás módulos heredados siguen ahí hasta que se publiquen.
        assert await escalar(db, "SELECT COUNT(*) FROM modules WHERE id = 'm2'") == 1


async def test_un_id_local_que_no_es_base_heredada_no_se_pisa(settings, catalogo):
    montar(catalogo, bundle("mAutor", leccion("x1")))

    async def semilla(conn):
        await conn.execute(
            "INSERT INTO modules (id, \"order\", title, description, level)"
            " VALUES ('mAutor', 5, 'Mío', 'd', 'Básico')"
        )
        await conn.commit()

    async with app_con_db(settings, semilla=semilla) as app:
        resultado = await sincronizar_curso(app, catalog=catalogo)

        assert resultado.installed == [] and resultado.failed == []
        assert await escalar(
            app.state.db, "SELECT title FROM modules WHERE id = 'mAutor'"
        ) == "Mío"


# ─────────────────────────── fallos y modo autoría ──────────────────────────


async def test_un_fallo_no_impide_los_demas_y_se_reintenta(settings, catalogo):
    malo = bundle("mMalo", leccion("m1l"), order_hint=100)
    bueno = bundle("mBueno", leccion("b1"), order_hint=200)
    montar(catalogo, malo, bueno)
    catalogo.errores["modulos/mMalo/v1.json"] = CatalogUnavailable("caído")

    async with app_con_db(settings) as app:
        primera = await sincronizar_curso(app, catalog=catalogo)
        assert primera.installed == ["mBueno"]
        assert [f.module_id for f in primera.failed] == ["mMalo"]

        del catalogo.errores["modulos/mMalo/v1.json"]
        segunda = await sincronizar_curso(app, catalog=catalogo)
        assert segunda.installed == ["mMalo"]


async def test_en_modo_autoria_no_se_descarga_nada(settings, catalogo):
    montar(catalogo, bundle("mA", leccion("a1")))
    admin = settings.model_copy(update={"admin_mode": True})
    async with app_con_db(admin) as app:
        resultado = await sincronizar_curso(app, catalog=catalogo)

        assert resultado.skipped == "admin" and resultado.installed == []
        assert await _ids_instalados(app.state.db) == []


# ───────────────────────────────── la ruta ──────────────────────────────────


def test_la_ruta_sin_catalogo_responde_503(settings, fake_docker):
    with TestClient(build_app(settings=settings, docker=fake_docker)) as cliente:
        respuesta = cliente.post("/api/v1/catalog/sync")
    assert respuesta.status_code == 503
    assert respuesta.json()["error"]["code"] == "CATALOG_DISABLED"


def test_la_ruta_incorpora_y_responde_el_resumen(settings, fake_docker, catalogo):
    montar(catalogo, bundle("mNube", leccion("nube1"), order_hint=9000))
    con_bucket = settings.model_copy(update={"catalog_bucket": "clasestelar"})
    aplicacion = build_app(settings=con_bucket, docker=fake_docker, catalog=catalogo)
    with TestClient(aplicacion) as cliente:
        respuesta = cliente.post("/api/v1/catalog/sync")
        assert respuesta.status_code == 200
        assert respuesta.json()["data"] == {
            "installed": ["mNube"],
            "replaced": [],
            "failed": [],
            "skipped": None,
        }
        modulos = cliente.get("/api/v1/modules").json()["data"]["modules"]
        assert "mNube" in [m["id"] for m in modulos]
