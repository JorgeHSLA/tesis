"""CU-36 · Incorporar un módulo del catálogo remoto (api-contract §11.6.1).

La suite entera corre **sin red**: el bucket es ``FakeCatalogService``, que
cumple el ``typing.Protocol`` ``CatalogReadPort`` sobre un dict en memoria
(misma costura que ``FakeDockerService``).

El test que sostiene el caso de uso es
``test_instalar_m1_en_base_vacia_conserva_los_recommended_cross_modulo``: el m1
REAL del repo recomienda lecciones de m2, m4 y m6, así que incorporar un módulo
suelto tiene que funcionar con enlaces a contenido que todavía no está. Si eso
falla, el primer clic del estudiante falla siempre.
"""

from __future__ import annotations

import asyncio
import json
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import pytest
from pydantic import ValidationError as PydanticValidationError
import pytest_asyncio
from fastapi import FastAPI

from app import db as db_module
from app.db import apply_schema, open_db
from app.errors import ApiException
from app.repositories import catalog as catalog_repo
from app.repositories.content import ContentRepository
from app.repositories.progress import ProgressRepository
from app.schemas.catalog import CatalogIndex, InstallRequest, ModuleBundle
from app.services import module_installer
from app.services.catalog_client import (
    CatalogObjectNotFound,
    CatalogObjectTooLarge,
    CatalogUnavailable,
)
from app.services.catalog_hash import bundle_checksum
from app.services.module_installer import install_module
from app.tools.seed_content import SEED_MARKER_KEY, get_seed_marker

from fakes.fake_catalog import FakeCatalogService

BUNDLES_DIR = Path(__file__).parent / "fixtures" / "bundles"
M1_V1 = BUNDLES_DIR / "m1-v1.json"

#: Golden de ``tests/test_catalog_hash.py``: el digest canónico de m1 v1. Se
#: repite aquí a propósito — si alguien cambia el fixture, los dos tests caen y
#: queda claro que lo que cambió es el CONTENIDO, no el algoritmo.
CHECKSUM_M1_V1 = "c29f59c3d6a4e3955609491b8ee39ca55f1a4a195149a8c7cfc57eaa3c5f595a"

MARKDOWN = "# Título\n\nUn párrafo dentro del subset.\n"


# ─────────────────────────── app de integración ─────────────────────────────


@asynccontextmanager
async def app_con_db(settings, *, semilla=None) -> AsyncIterator[FastAPI]:
    """App mínima con el estado REAL que exige ``content_writer._persist``.

    No usa ``conftest.build_app`` porque ese siembra los 6 módulos del repo y
    aquí lo que se ejerce es justo lo contrario: una base VACÍA en la que el
    estudiante incorpora módulos uno a uno.
    """
    app = FastAPI()
    conn = await open_db(":memory:")
    try:
        await apply_schema(conn)
        if semilla is not None:
            await semilla(conn)
        app.state.db = conn
        app.state.settings = settings
        app.state.write_lock = db_module.write_lock
        app.state.content_read_lock = asyncio.Lock()
        app.state.progress = ProgressRepository(conn)
        app.state.content = await ContentRepository.load(conn)
        yield app
    finally:
        await conn.close()


@pytest_asyncio.fixture
async def app_vacia(settings) -> AsyncIterator[FastAPI]:
    async with app_con_db(settings) as app:
        yield app


@pytest.fixture
def catalogo() -> FakeCatalogService:
    return FakeCatalogService()


# ─────────────────────────── fábricas de bundles ────────────────────────────


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


def pregunta(order: int = 1, *, qid: str | None = None, **over) -> dict:
    base: dict[str, Any] = {
        "order": order,
        "text": "¿Qué hace #pragma omp parallel?",
        "options": [
            {"key": "a", "text": "Abre una región paralela"},
            {"key": "b", "text": "Cierra el programa"},
        ],
        "correct_key": "a",
        "explanation": "Abre la región paralela.",
    }
    if qid is not None:
        base["id"] = qid
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
    """Valida, calcula el checksum canónico y serializa.

    El orden importa (``test_catalog_hash``): se hashea DESPUÉS de validar,
    porque el modelo repone los opcionales ausentes y un dict escrito a mano da
    otro digest. Publicar desde ``model_dump`` es lo que hace que el objeto del
    bucket reproduzca su propio checksum al releerse.
    """
    modelo = ModuleBundle.model_validate({**payload, "checksum": "0" * 64})
    datos = modelo.model_dump(mode="json")
    datos["checksum"] = bundle_checksum(datos)
    return datos, json.dumps(datos, ensure_ascii=False).encode("utf-8")


def bundle(
    module_id: str,
    *lecciones: dict,
    version: int = 1,
    order_hint: int = 1,
    **modulo_over,
) -> tuple[dict, bytes]:
    modulo = {
        "id": module_id,
        "order_hint": order_hint,
        "title": f"Módulo {module_id}",
        "description": "Descripción",
        "level": "Básico",
        "version": version,
        "published_at": "2026-08-29T12:00:00.000Z",
        "author_label": "Curso Telar — UN",
        "notes": "",
    }
    modulo.update(modulo_over)
    lista = list(lecciones) or [leccion(f"{module_id}-l1")]
    return sellar({"bundle_format": 1, "module": modulo, "lessons": lista})


def entrada_de(datos: dict, raw: bytes, **over) -> dict:
    """Fila del índice DERIVADA del bundle real (``size_bytes == len(raw)``)."""
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
        "size_bytes": len(raw),
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


def publicar(
    catalogo: FakeCatalogService,
    datos: dict,
    raw: bytes,
    *,
    generation: int | None = None,
    **entrada_over,
) -> dict:
    """Deja el objeto en el bucket y devuelve su fila de índice."""
    catalogo.publicar_modulo(
        datos["module"]["id"],
        datos["module"]["version"],
        raw,
        generation=generation,
    )
    return entrada_de(datos, raw, **entrada_over)


def indice(*entradas: dict) -> dict:
    return {
        "index_format": 1,
        "generated_at": "2026-08-29T12:00:00.000Z",
        "modules": list(entradas),
    }


def montar(catalogo: FakeCatalogService, *pares: tuple[dict, bytes]) -> None:
    """Publica varios módulos y su índice coherente, en un solo gesto."""
    catalogo.publicar_indice(indice(*[publicar(catalogo, d, r) for d, r in pares]))


def m1_real() -> tuple[dict, bytes]:
    """El m1 del repo tal cual se publicó: bytes EXACTOS del fixture."""
    raw = M1_V1.read_bytes()
    return json.loads(raw.decode("utf-8")), raw


def m1_publicable() -> tuple[dict, bytes]:
    """El m1 REAL con el ``example.id`` desacoplado del ``lesson.id`` (E1).

    Contenido idéntico al del repo —markdown, quizzes y, lo que importa aquí,
    los ``recommended`` que apuntan a m2/m4/m6—; lo único que cambia es el id
    del ejemplo.

    Por qué hay que cambiarlo: ``bundle_guard._registrar_id`` trata lección y
    ejemplo como un mismo espacio de nombres SIN exceptuar la pareja, así que
    hoy rechaza ``example.id == lesson.id`` — que es exactamente lo que produce
    el backfill de la migración 5 (``INSERT INTO examples_m5 SELECT id, id, …``)
    y lo único que la vía admin sabe crear (``content_admin._example_insert_params``).
    Está fijado abajo en ``test_el_m1_real_del_repo_se_instala_tal_cual``.
    """
    datos, _ = m1_real()
    lecciones = []
    for original in datos["lessons"]:
        lec = dict(original)
        if lec.get("example"):
            lec["example"] = {**lec["example"], "id": f"{lec['id']}-ej"}
        lecciones.append(lec)
    return sellar({**datos, "lessons": lecciones})


# ───────────────────────────── helpers de DB ────────────────────────────────


async def filas(db, sql: str, params: tuple = ()) -> list:
    cursor = await db.execute(sql, params)
    return await cursor.fetchall()


async def escalar(db, sql: str, params: tuple = ()) -> Any:
    fila = (await filas(db, sql, params))[0]
    return fila[0]


async def db_intacta(db) -> None:
    """Ni una fila de contenido ni de manifiesto: el rechazo no escribió nada."""
    for tabla in ("modules", "lessons", "examples", "quiz_questions",
                  "installed_modules", "module_update_log"):
        assert await escalar(db, f"SELECT COUNT(*) FROM {tabla}") == 0, tabla


# ═══════════════════════════ EL TEST QUE MANDA ══════════════════════════════


async def test_instalar_m1_en_base_vacia_conserva_los_recommended_cross_modulo(
    app_vacia, catalogo
):
    """R6: m1 recomienda lecciones de m2/m4/m6 y aun así se incorpora.

    Es el primer clic del estudiante en una instalación limpia. La poda vive en
    ``ContentRepository._podar_recommended`` y es del SNAPSHOT: la columna
    conserva lo que escribió el autor, para que el enlace reaparezca solo cuando
    llegue el módulo que faltaba.
    """
    datos, raw = m1_publicable()
    montar(catalogo, (datos, raw))

    resultado = await install_module(
        app_vacia, InstallRequest(module_id="m1"), catalog=catalogo
    )

    assert resultado.module_id == "m1"
    assert resultado.installed_version == 1
    assert resultado.installed_checksum == datos["checksum"]
    assert resultado.object_path == "modulos/m1/v1.json"
    assert resultado.lessons_added == ["primerEjemplo", "for"]
    assert resultado.lessons_updated == [] and resultado.lessons_removed == []
    assert resultado.questions_total == 8
    assert resultado.installed_at

    db = app_vacia.state.db
    # La columna conserva las 5 recomendaciones ORIGINALES, incluidas las tres
    # que apuntan a módulos que no están instalados.
    guardado = json.loads(
        await escalar(
            db, "SELECT recommended_json FROM lessons WHERE id = ?", ("for",)
        )
    )
    assert [r["lesson_id"] for r in guardado] == ["spmd", "sumaVectores", "tareas"]

    # El SNAPSHOT solo enseña los enlaces que se pueden seguir.
    snapshot = app_vacia.state.content
    assert [r.lesson_id for r in snapshot.lesson("for").recommended] == []
    assert [r.lesson_id for r in snapshot.lesson("primerEjemplo").recommended] == [
        "for"
    ]


async def test_instalar_el_modulo_que_faltaba_reaviva_el_enlace_sin_reinstalar(
    app_vacia, catalogo
):
    """El enlace podado reaparece solo, sin volver a tocar m1."""
    datos_m1, raw_m1 = m1_publicable()
    m2 = bundle("m2", leccion("spmd", order=1), order_hint=2)
    montar(catalogo, (datos_m1, raw_m1), m2)

    await install_module(app_vacia, InstallRequest(module_id="m1"), catalog=catalogo)
    assert [
        r.lesson_id for r in app_vacia.state.content.lesson("for").recommended
    ] == []

    await install_module(app_vacia, InstallRequest(module_id="m2"), catalog=catalogo)

    assert [
        r.lesson_id for r in app_vacia.state.content.lesson("for").recommended
    ] == ["spmd"]
    # Y m1 no se reescribió: sigue en su versión y su checksum.
    fila = await catalog_repo.get_installed(app_vacia.state.db, "m1")
    assert fila is not None and fila.installed_version == 1


# ══════════════════════════ contenido persistido ════════════════════════════


async def test_escribe_las_cuatro_tablas_y_marca_el_modulo_como_remoto(
    app_vacia, catalogo
):
    datos, raw = m1_publicable()
    montar(catalogo, (datos, raw))

    await install_module(app_vacia, InstallRequest(module_id="m1"), catalog=catalogo)

    db = app_vacia.state.db
    modulo = (await filas(db, "SELECT * FROM modules WHERE id = 'm1'"))[0]
    assert modulo["origin"] == "remote"
    assert modulo["version"] == 1
    assert modulo["checksum"] == datos["checksum"]
    assert modulo["published_at"] == "2026-08-29T12:00:00.000Z"
    assert await escalar(db, "SELECT COUNT(*) FROM lessons") == 2
    assert await escalar(db, "SELECT COUNT(*) FROM examples") == 2
    assert await escalar(db, "SELECT COUNT(*) FROM quiz_questions") == 8


async def test_el_ejemplo_conserva_su_id_propio_y_se_ata_por_lesson_id(
    app_vacia, catalogo
):
    """E1: desde la migración 5 el ejemplo ya no comparte clave con su lección."""
    b = bundle("m9", leccion("teoria", example=ejemplo("ej-propio")))
    montar(catalogo, b)

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    fila = (await filas(app_vacia.state.db, "SELECT * FROM examples"))[0]
    assert fila["id"] == "ej-propio"
    assert fila["lesson_id"] == "teoria"


async def test_una_leccion_sin_ejemplo_ni_quiz_se_instala(app_vacia, catalogo):
    """E1/E4: la lección conceptual es representable y debe poder viajar."""
    b = bundle(
        "m9",
        leccion("teoria", example=None, quiz=None, completion_rule="viewed"),
    )
    montar(catalogo, b)

    resultado = await install_module(
        app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
    )

    assert resultado.questions_total == 0
    db = app_vacia.state.db
    assert await escalar(db, "SELECT COUNT(*) FROM examples") == 0
    assert await escalar(db, "SELECT completion_rule FROM lessons") == "viewed"


async def test_el_video_se_guarda_normalizado_no_como_vino(app_vacia, catalogo):
    """El guard valida pero NO normaliza (cambiar bytes rompería el checksum);
    reconstruir la URL canónica es del instalador."""
    b = bundle(
        "m9",
        leccion("teoria", video_url="https://youtu.be/dQw4w9WgXcQ?t=42"),
    )
    montar(catalogo, b)

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    assert await escalar(app_vacia.state.db, "SELECT video_url FROM lessons") == (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    )


async def test_los_ids_de_pregunta_sin_id_se_derivan_del_order(app_vacia, catalogo):
    """BL-18: ``{lesson_id}-q{order}``, la MISMA regla que la vía admin."""
    b = bundle(
        "m9",
        leccion("teoria", quiz=quiz(pregunta(1), pregunta(2, qid="explicita"))),
    )
    montar(catalogo, b)

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    ids = [
        f["id"]
        for f in await filas(
            app_vacia.state.db, 'SELECT id FROM quiz_questions ORDER BY "order"'
        )
    ]
    assert ids == ["teoria-q1", "explicita"]


async def test_el_orden_de_insercion_es_el_del_seeder(app_vacia, catalogo, monkeypatch):
    """§11.6.1 paso 3: ``modules → lessons → examples → quiz_questions``.

    No es estilo: ``lessons.module_id`` y ``examples.lesson_id`` son FK con
    ``foreign_keys=ON``, así que cualquier otro orden revienta.
    """
    b = bundle("m9", leccion("teoria"))
    montar(catalogo, b)

    db = app_vacia.state.db
    original = db.execute
    tablas: list[str] = []

    async def espia(sql, *args, **kwargs):
        encontrado = re.search(r"INSERT INTO\s+(\w+)", str(sql))
        if encontrado:
            tablas.append(encontrado.group(1))
        return await original(sql, *args, **kwargs)

    monkeypatch.setattr(db, "execute", espia)
    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    contenido = [t for t in tablas if t in
                 {"modules", "lessons", "examples", "quiz_questions"}]
    assert contenido == ["modules", "lessons", "examples", "quiz_questions"]
    # El manifiesto va en la MISMA unidad, después del contenido (§11.6.1 paso 5).
    assert "installed_modules" in tablas
    assert tablas.index("installed_modules") > tablas.index("quiz_questions")


# ═════════════════════════════ el manifiesto ════════════════════════════════


async def test_registra_el_manifiesto_con_la_version_y_el_objeto(
    app_vacia, catalogo
):
    datos, raw = m1_publicable()
    montar(catalogo, (datos, raw))

    await install_module(app_vacia, InstallRequest(module_id="m1"), catalog=catalogo)

    fila = await catalog_repo.get_installed(app_vacia.state.db, "m1")
    assert fila is not None
    assert fila.installed_version == 1
    assert fila.installed_checksum == datos["checksum"]
    assert fila.object_path == "modulos/m1/v1.json"
    assert fila.locally_modified is False
    # Recién instalado NO puede anunciar actualización disponible.
    assert fila.available_version == 1
    assert fila.available_checksum == datos["checksum"]


async def test_deja_la_instalacion_en_el_historial_con_from_version_nula(
    app_vacia, catalogo
):
    b = bundle("m9", leccion("teoria"))
    montar(catalogo, b)

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    entradas = await catalog_repo.list_update_log(app_vacia.state.db, "m9")
    assert len(entradas) == 1
    assert entradas[0].from_version is None
    assert entradas[0].to_version == 1
    assert entradas[0].report["kind"] == "install"


async def test_no_toca_el_marcador_de_siembra(app_vacia, catalogo):
    """§11.6.1 paso 6: instalar NO es sembrar. ``content_seeded_at`` gobierna el
    auto-seed del lifespan (BL-21) y moverlo aquí cambiaría el arranque."""
    b = bundle("m9", leccion("teoria"))
    montar(catalogo, b)

    db = app_vacia.state.db
    assert await get_seed_marker(db) is None

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    assert await get_seed_marker(db) is None
    assert await escalar(
        db, "SELECT COUNT(*) FROM app_meta WHERE key = ?", (SEED_MARKER_KEY,)
    ) == 0


# ═══════════════════════ el order global del módulo ═════════════════════════


async def test_el_order_hint_libre_se_respeta(app_vacia, catalogo):
    montar(catalogo, bundle("m9", leccion("teoria"), order_hint=7))

    resultado = await install_module(
        app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
    )

    assert resultado.local_order == 7
    assert resultado.order_reassigned is False


async def test_el_order_hint_tomado_se_reasigna_a_max_mas_uno(app_vacia, catalogo):
    """``modules."order"`` es UNIQUE GLOBAL: dos autores publican con el mismo
    ``order_hint`` y los dos módulos son legítimos. Nunca un IntegrityError."""
    montar(
        catalogo,
        bundle("m8", leccion("l8"), order_hint=3),
        bundle("m9", leccion("l9"), order_hint=3),
    )

    primero = await install_module(
        app_vacia, InstallRequest(module_id="m8"), catalog=catalogo
    )
    segundo = await install_module(
        app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
    )

    assert (primero.local_order, primero.order_reassigned) == (3, False)
    assert (segundo.local_order, segundo.order_reassigned) == (4, True)
    ordenes = {
        f["id"]: f["order"]
        for f in await filas(app_vacia.state.db, 'SELECT id, "order" FROM modules')
    }
    assert ordenes == {"m8": 3, "m9": 4}


async def test_la_reasignacion_salta_por_encima_del_maximo_no_al_primer_hueco(
    app_vacia, catalogo
):
    """MAX+1, no «el primer hueco»: reordenar la ruta del estudiante sin pedirle
    permiso sería un efecto lateral suyo, no del autor del módulo."""
    montar(
        catalogo,
        bundle("m1", leccion("l1"), order_hint=1),
        bundle("m9", leccion("l9"), order_hint=9),
        bundle("m5", leccion("l5"), order_hint=1),
    )

    await install_module(app_vacia, InstallRequest(module_id="m1"), catalog=catalogo)
    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)
    tercero = await install_module(
        app_vacia, InstallRequest(module_id="m5"), catalog=catalogo
    )

    assert tercero.local_order == 10
    assert tercero.order_reassigned is True


# ══════════════════════════ colisiones de id (409) ══════════════════════════


def error_de(excinfo) -> ApiException:
    return excinfo.value


async def test_colision_de_lesson_id_con_otro_modulo_da_409_limpio(
    app_vacia, catalogo
):
    """§11.3 DUPLICATE_ID con ``details = [{field, id, owner_module_id}]``,
    NO un IntegrityError convertido en 500."""
    datos, raw = m1_publicable()
    montar(
        catalogo,
        (datos, raw),
        # Ejemplo y pregunta con ids propios: la ÚNICA colisión es el lesson_id.
        bundle(
            "m9",
            leccion(
                "for",
                example=ejemplo("otro-ej"),
                quiz=quiz(pregunta(1, qid="q-m9")),
            ),
            order_hint=9,
        ),
    )
    await install_module(app_vacia, InstallRequest(module_id="m1"), catalog=catalogo)

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "DUPLICATE_ID"
    assert error.status_code == 409
    assert error.details == [
        {"field": "lesson_id", "id": "for", "owner_module_id": "m1"}
    ]
    # Y m9 no dejó rastro.
    db = app_vacia.state.db
    assert await escalar(db, "SELECT COUNT(*) FROM modules") == 1
    assert await catalog_repo.get_installed(db, "m9") is None


async def test_colision_de_example_id_con_otro_modulo(app_vacia, catalogo):
    """Riesgo NUEVO que abre E1: el ejemplo tiene id propio, así que puede
    colisionar aunque la lección que lo trae sea nueva."""
    montar(
        catalogo,
        bundle("m8", leccion("l8", example=ejemplo("compartido")), order_hint=8),
        bundle("m9", leccion("l9", example=ejemplo("compartido")), order_hint=9),
    )
    await install_module(app_vacia, InstallRequest(module_id="m8"), catalog=catalogo)

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "DUPLICATE_ID"
    assert error.details == [
        {"field": "example_id", "id": "compartido", "owner_module_id": "m8"}
    ]


async def test_colision_de_id_de_pregunta_con_otro_modulo(app_vacia, catalogo):
    """``quiz_questions.id`` es PK GLOBAL (CW-02): sin este chequeo el INSERT
    reventaría a mitad de la escritura y saldría como 500."""
    montar(
        catalogo,
        bundle(
            "m8",
            leccion("l8", quiz=quiz(pregunta(1, qid="q-compartida"))),
            order_hint=8,
        ),
        bundle(
            "m9",
            leccion("l9", quiz=quiz(pregunta(1, qid="q-compartida"))),
            order_hint=9,
        ),
    )
    await install_module(app_vacia, InstallRequest(module_id="m8"), catalog=catalogo)

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "DUPLICATE_ID"
    assert error.status_code == 409
    assert error.details == [
        {"field": "question_id", "id": "q-compartida", "owner_module_id": "m8"}
    ]
    assert await escalar(app_vacia.state.db, "SELECT COUNT(*) FROM lessons") == 1


async def test_un_id_entrante_que_choca_con_un_ejemplo_ajeno_tambien_es_colision(
    app_vacia, catalogo
):
    """§10.6: lecciones y ejemplos comparten espacio de nombres."""
    montar(
        catalogo,
        bundle("m8", leccion("l8", example=ejemplo("nombre")), order_hint=8),
        bundle("m9", leccion("nombre", example=ejemplo("ej9")), order_hint=9),
    )
    await install_module(app_vacia, InstallRequest(module_id="m8"), catalog=catalogo)

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    assert error_de(excinfo).details == [
        {"field": "lesson_id", "id": "nombre", "owner_module_id": "m8"}
    ]


async def test_todas_las_colisiones_se_reportan_de_una_vez(app_vacia, catalogo):
    """Media docena de 409 seguidos, uno por id, es una forma cara de no decir
    qué pasa."""
    montar(
        catalogo,
        bundle(
            "m8",
            leccion("a", order=1, example=ejemplo("ej-a")),
            leccion("b", order=2, example=ejemplo("ej-b")),
            order_hint=8,
        ),
        bundle(
            "m9",
            leccion("a", order=1, example=ejemplo("ej-a")),
            leccion("b", order=2, example=ejemplo("ej-b")),
            order_hint=9,
        ),
    )
    await install_module(app_vacia, InstallRequest(module_id="m8"), catalog=catalogo)

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    detalles = {(d["field"], d["id"]) for d in error_de(excinfo).details}
    assert detalles == {
        ("lesson_id", "a"),
        ("lesson_id", "b"),
        ("example_id", "ej-a"),
        ("example_id", "ej-b"),
        # Los ids DERIVADOS de pregunta (BL-18) chocan igual que los explícitos.
        ("question_id", "a-q1"),
        ("question_id", "b-q1"),
    }
    assert all(d["owner_module_id"] == "m8" for d in error_de(excinfo).details)


async def test_el_choque_con_la_pareja_historica_de_ids_se_reporta_una_vez(
    settings, catalogo
):
    """El contenido del repo tiene ``examples.id == lessons.id`` (backfill de la
    migración 5), así que un id entrante choca a la vez con la lección y con su
    ejemplo. Es la misma noticia: una sola fila de ``details``."""
    async def semilla(conn):
        await conn.execute(
            'INSERT INTO modules (id, "order", title, description, level) '
            "VALUES ('m1', 1, 'Local', '', 'Básico')"
        )
        await conn.execute(
            'INSERT INTO lessons (id, module_id, "order", title, '
            "estimated_minutes, content_markdown, pass_threshold) "
            "VALUES ('for', 'm1', 1, 'For', 10, '# x', 0.8)"
        )
        await conn.execute(
            "INSERT INTO examples (id, lesson_id, filename, title, difficulty, "
            "teaches, threads_configurable, sweeps_threads, self_measures, "
            "parser_id, default_timeout_s, est_run_seconds, enabled, "
            "requires_gpu, expected_output_note, source_code) "
            "VALUES ('for', 'for', 'main.py', 'For', 1, 'x', 1, 0, 0, 'none', "
            "30, 5, 1, 0, '', 'print(1)')"
        )
        await conn.commit()

    montar(
        catalogo,
        bundle(
            "m9",
            leccion("for", example=ejemplo("ej9"), quiz=quiz(pregunta(1, qid="q9"))),
            order_hint=9,
        ),
    )

    async with app_con_db(settings, semilla=semilla) as app:
        with pytest.raises(ApiException) as excinfo:
            await install_module(
                app, InstallRequest(module_id="m9"), catalog=catalogo
            )

        assert error_de(excinfo).details == [
            {"field": "lesson_id", "id": "for", "owner_module_id": "m1"}
        ]


async def test_reinstalar_el_mismo_modulo_da_409_module_already_installed(
    app_vacia, catalogo
):
    montar(catalogo, bundle("m9", leccion("l9")))
    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "MODULE_ALREADY_INSTALLED"
    assert error.status_code == 409


async def test_un_id_de_modulo_tomado_por_contenido_local_da_duplicate_id(
    settings, catalogo
):
    """Distinto de MODULE_ALREADY_INSTALLED: aquí no hay manifiesto que
    actualizar, hay contenido del baseline con el que se choca."""
    async def semilla(conn):
        await conn.execute(
            'INSERT INTO modules (id, "order", title, description, level) '
            "VALUES ('m9', 1, 'Local', '', 'Básico')"
        )
        await conn.commit()

    montar(catalogo, bundle("m9", leccion("l9")))
    async with app_con_db(settings, semilla=semilla) as app:
        with pytest.raises(ApiException) as excinfo:
            await install_module(
                app, InstallRequest(module_id="m9"), catalog=catalogo
            )

        error = error_de(excinfo)
        assert error.code == "DUPLICATE_ID"
        assert error.details == [
            {"field": "module_id", "id": "m9", "owner_module_id": "m9"}
        ]


# ═══════════════════════ el bundle como entrada hostil ══════════════════════


async def test_bundle_invalido_da_422_con_details_y_la_db_intacta(
    app_vacia, catalogo
):
    datos, raw = bundle("m9", leccion("l9"))
    roto = dict(datos)
    roto["campo_inventado"] = "sorpresa"
    catalogo.publicar_modulo("m9", 1, json.dumps(roto).encode())
    catalogo.publicar_indice(indice(entrada_de(datos, raw)))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "BUNDLE_INVALID"
    assert error.status_code == 422
    assert error.details
    await db_intacta(app_vacia.state.db)


async def test_markdown_fuera_del_subset_da_content_validation_error(
    app_vacia, catalogo
):
    montar(
        catalogo,
        bundle(
            "m9",
            leccion("l9", content_markdown="# Hola\n\n<script>alert(1)</script>\n"),
        ),
    )

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CONTENT_VALIDATION_ERROR"
    assert error.status_code == 422
    assert any("content_markdown" in d["field"] for d in error.details)
    await db_intacta(app_vacia.state.db)


async def test_ejemplo_incoherente_en_hilos_da_content_validation_error(
    app_vacia, catalogo
):
    """La coherencia threads/GPU ya tenía dueño en ``content_writer``; el
    instalador la reutiliza en vez de duplicarla (``bundle_guard`` la dejó
    fuera a propósito)."""
    montar(
        catalogo,
        bundle(
            "m9",
            leccion(
                "l9",
                example=ejemplo("ej", threads_configurable=True, fixed_threads=4),
            ),
        ),
    )

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CONTENT_VALIDATION_ERROR"
    assert error.details[0]["field"] == "lessons[0].example.fixed_threads"


async def test_umbral_del_quiz_discrepante_se_rechaza_en_vez_de_elegir(
    app_vacia, catalogo
):
    """``lessons.pass_threshold`` es la columna con la que el servidor califica;
    elegir por el autor entre dos números que él escribió distintos es cómo se
    cuela una nota mal puesta."""
    montar(
        catalogo,
        bundle(
            "m9",
            leccion("l9", pass_threshold=0.8, quiz=quiz(pass_threshold=0.5)),
        ),
    )

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CONTENT_VALIDATION_ERROR"
    assert error.details[0]["field"] == "lessons[0].quiz.pass_threshold"


async def test_id_de_pregunta_explicito_que_choca_con_uno_derivado(
    app_vacia, catalogo
):
    """``bundle_guard`` SALTA las preguntas sin id (aún no existen), así que
    esta colisión solo se puede ver después de resolverlos."""
    montar(
        catalogo,
        bundle(
            "m9",
            leccion("a", order=1, quiz=quiz(pregunta(1))),
            leccion("b", order=2, quiz=quiz(pregunta(1, qid="a-q1"))),
        ),
    )

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CONTENT_VALIDATION_ERROR"
    assert "a-q1" in error.details[0]["reason"]
    await db_intacta(app_vacia.state.db)


async def test_codigo_por_encima_del_tope_da_413(settings, catalogo):
    """BL-17: el tope es ``settings.max_code_bytes``, el MISMO que gobierna la
    vía admin y ``/jobs``, no una constante del instalador."""
    apretado = settings.model_copy(update={"max_code_bytes": 64})
    montar(
        catalogo,
        bundle("m9", leccion("l9", example=ejemplo("ej", source_code="x" * 500))),
    )

    async with app_con_db(apretado) as app:
        with pytest.raises(ApiException) as excinfo:
            await install_module(
                app, InstallRequest(module_id="m9"), catalog=catalogo
            )
        assert error_de(excinfo).code == "CODE_TOO_LARGE"
        assert error_de(excinfo).status_code == 413
        await db_intacta(app.state.db)


async def test_el_modulo_que_se_declara_con_otro_id_se_rechaza(
    app_vacia, catalogo
):
    """Si el checksum cuadra y el id no, quien miente es el índice."""
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_modulo("m8", 1, raw)
    catalogo.publicar_indice(indice(entrada_de(datos, raw, id="m8")))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m8"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CONTENT_VALIDATION_ERROR"
    assert error.details[0]["field"] == "module.id"
    await db_intacta(app_vacia.state.db)


# ═══════════════════════════ el checksum (409) ══════════════════════════════


async def test_checksum_del_indice_distinto_al_del_bundle(app_vacia, catalogo):
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_modulo("m9", 1, raw)
    catalogo.publicar_indice(indice(entrada_de(datos, raw, checksum="a" * 64)))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CHECKSUM_MISMATCH"
    assert error.status_code == 409
    assert error.details[0]["field"] == "index.checksum"
    await db_intacta(app_vacia.state.db)


async def test_bundle_que_miente_sobre_su_propio_checksum(app_vacia, catalogo):
    datos, raw = bundle("m9", leccion("l9"))
    mentiroso = {**datos, "checksum": "b" * 64}
    crudo = json.dumps(mentiroso, ensure_ascii=False).encode("utf-8")
    catalogo.publicar_modulo("m9", 1, crudo)
    # El índice anuncia el checksum REAL del contenido y el tamaño real.
    catalogo.publicar_indice(
        indice(entrada_de(datos, crudo, checksum=bundle_checksum(mentiroso)))
    )

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CHECKSUM_MISMATCH"
    assert error.details[0]["field"] == "bundle.checksum"


async def test_el_tamano_anunciado_detecta_el_truncado_antes_del_sha256(
    app_vacia, catalogo
):
    """R2: ``size_bytes == len(raw)`` exacto es el detector barato de truncado."""
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_modulo("m9", 1, raw)
    catalogo.publicar_indice(indice(entrada_de(datos, raw, size_bytes=len(raw) + 1)))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CHECKSUM_MISMATCH"
    assert error.details[0]["field"] == "size_bytes"


async def test_expected_checksum_desactualizado_corta_antes_de_descargar(
    app_vacia, catalogo
):
    """Cierre del TOCTOU (§11.6.1): el bucket se reescribió entre la pantalla y
    el clic, y no se gasta la descarga para descubrirlo."""
    montar(catalogo, bundle("m9", leccion("l9")))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia,
            InstallRequest(module_id="m9", expected_checksum="c" * 64),
            catalog=catalogo,
        )

    assert error_de(excinfo).code == "CHECKSUM_MISMATCH"
    assert catalogo.module_calls == []


async def test_expected_checksum_correcto_instala(app_vacia, catalogo):
    datos, raw = bundle("m9", leccion("l9"))
    montar(catalogo, (datos, raw))

    resultado = await install_module(
        app_vacia,
        InstallRequest(module_id="m9", expected_checksum=datos["checksum"]),
        catalog=catalogo,
    )

    assert resultado.installed_checksum == datos["checksum"]


# ═══════════════════ el catálogo remoto como frontera ═══════════════════════


async def test_modulo_ausente_del_indice_da_404(app_vacia, catalogo):
    montar(catalogo, bundle("m9", leccion("l9")))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m7"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "REMOTE_MODULE_NOT_FOUND"
    assert error.status_code == 404
    assert catalogo.module_calls == []


async def test_pedir_una_version_que_no_es_la_publicada_da_404(app_vacia, catalogo):
    """El índice publica UNA versión por módulo y es la única cuyo checksum
    conocemos: pedir otra no es «versión antigua», es no verificable."""
    montar(catalogo, bundle("m9", leccion("l9"), version=2))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9", version=1), catalog=catalogo
        )

    assert error_de(excinfo).code == "REMOTE_MODULE_NOT_FOUND"
    assert catalogo.module_calls == []


async def test_pedir_la_version_publicada_explicitamente_funciona(
    app_vacia, catalogo
):
    montar(catalogo, bundle("m9", leccion("l9"), version=3))

    resultado = await install_module(
        app_vacia, InstallRequest(module_id="m9", version=3), catalog=catalogo
    )

    assert resultado.installed_version == 3
    assert resultado.object_path == "modulos/m9/v3.json"


async def test_objeto_anunciado_pero_ausente_del_bucket_da_404(
    app_vacia, catalogo
):
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_indice(indice(entrada_de(datos, raw)))  # sin el objeto

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    assert error_de(excinfo).code == "REMOTE_MODULE_NOT_FOUND"


async def test_bucket_caido_da_503_con_reason_sin_texto_crudo(app_vacia, catalogo):
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_indice(indice(entrada_de(datos, raw)))
    catalogo.fallar_modulo(
        "m9", 1, CatalogUnavailable("network", causa="s3cr3t interno")
    )

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CATALOG_UNAVAILABLE"
    assert error.status_code == 503
    assert error.details == {"reason": "network", "retry_after_s": None}
    assert "s3cr3t" not in json.dumps(error.details)


async def test_indice_inaccesible_da_503(app_vacia, catalogo):
    catalogo.fallar_indice(CatalogUnavailable("rate_limit", retry_after_s=30))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CATALOG_UNAVAILABLE"
    assert error.details == {"reason": "rate_limit", "retry_after_s": 30}


async def test_el_tamano_anunciado_evita_la_descarga_de_un_bundle_enorme(
    app_vacia, catalogo
):
    """§11.3: «se detecta por ``size`` antes de descargar cuando el listado lo
    trae». El tope barato primero; el del puerto, después."""
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_modulo("m9", 1, raw)
    tope = app_vacia.state.settings.catalog_max_bundle_bytes
    catalogo.publicar_indice(indice(entrada_de(datos, raw, size_bytes=tope + 1)))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "BUNDLE_TOO_LARGE"
    assert error.status_code == 413
    assert catalogo.module_calls == []


async def test_un_indice_mentiroso_no_esquiva_el_tope_del_puerto(
    settings, catalogo
):
    """El índice es una CONVENIENCIA, no una fuente de verdad: aunque anuncie un
    tamaño pequeño, el puerto corta sobre los bytes reales."""
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_modulo("m9", 1, raw)
    mentiroso = CatalogIndex.model_validate(
        indice(entrada_de(datos, raw, size_bytes=10))
    )
    apretado = settings.model_copy(update={"catalog_max_bundle_bytes": 64})

    async with app_con_db(apretado) as app:
        with pytest.raises(ApiException) as excinfo:
            await install_module(
                app,
                InstallRequest(module_id="m9"),
                catalog=catalogo,
                index=mentiroso,
            )
        assert error_de(excinfo).code == "BUNDLE_TOO_LARGE"
        assert catalogo.module_calls[-1]["max_bytes"] == 64


async def test_el_tope_del_puerto_es_el_de_config_no_una_constante(
    app_vacia, catalogo
):
    montar(catalogo, bundle("m9", leccion("l9")))

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    tope = app_vacia.state.settings.catalog_max_bundle_bytes
    assert catalogo.index_calls == [{"max_bytes": tope}]
    assert catalogo.module_calls[-1]["max_bytes"] == tope


async def test_un_indice_ya_cacheado_evita_salir_a_la_red(app_vacia, catalogo):
    """``/catalog/refresh`` guarda el índice en ``app_meta``; instalar no tiene
    por qué volver a pedirlo."""
    datos, raw = bundle("m9", leccion("l9"))
    entrada = publicar(catalogo, datos, raw)
    cacheado = CatalogIndex.model_validate(indice(entrada))

    resultado = await install_module(
        app_vacia,
        InstallRequest(module_id="m9"),
        catalog=catalogo,
        index=cacheado,
    )

    assert resultado.module_id == "m9"
    assert catalogo.index_calls == []


async def test_la_generacion_ancla_el_objeto_exacto(app_vacia, catalogo):
    """§11.6.1: la descarga usa ``if_generation_match`` cuando se conoce."""
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_modulo("m9", 1, raw, generation=17)
    catalogo.publicar_indice(indice(entrada_de(datos, raw)))

    await install_module(
        app_vacia, InstallRequest(module_id="m9"), catalog=catalogo, generation=17
    )
    assert catalogo.module_calls[-1]["generation"] == 17


async def test_el_objeto_reescrito_a_mitad_da_409_checksum_mismatch(
    app_vacia, catalogo
):
    datos, raw = bundle("m9", leccion("l9"))
    catalogo.publicar_modulo("m9", 1, raw, generation=17)
    catalogo.publicar_indice(indice(entrada_de(datos, raw)))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia,
            InstallRequest(module_id="m9"),
            catalog=catalogo,
            generation=99,
        )

    error = error_de(excinfo)
    assert error.code == "CHECKSUM_MISMATCH"
    assert error.status_code == 409


# ═══════════════════════ el progreso del estudiante ═════════════════════════


async def test_el_progreso_de_una_leccion_reintroducida_sobrevive_y_se_declara_preservado(
    settings, catalogo
):
    """``lesson_progress`` no tiene FK a ``lessons`` (data-model §8.3): quitar un
    módulo deja el avance huérfano y volver a incorporarlo lo recupera. Esa es
    la promesa que hace viable CU-36/CU-39."""
    async def semilla(conn):
        await conn.execute(
            "INSERT INTO lesson_progress "
            "(lesson_id, viewed, completed, best_quiz_score, completed_via) "
            "VALUES ('primerEjemplo', 1, 1, 4, 'quiz')"
        )
        await conn.commit()

    datos, raw = m1_publicable()
    montar(catalogo, (datos, raw))

    async with app_con_db(settings, semilla=semilla) as app:
        resultado = await install_module(
            app, InstallRequest(module_id="m1"), catalog=catalogo
        )

        assert resultado.progress.preserved == 1
        assert resultado.progress.unaffected == 1
        assert resultado.progress.rescored == 0
        assert resultado.progress.archived == 0
        fila = (
            await filas(
                app.state.db,
                "SELECT * FROM lesson_progress WHERE lesson_id = 'primerEjemplo'",
            )
        )[0]
        assert (fila["completed"], fila["best_quiz_score"]) == (1, 4)
        assert fila["completed_via"] == "quiz"


async def test_sin_progreso_previo_todo_queda_como_no_afectado(
    app_vacia, catalogo
):
    datos, raw = m1_publicable()
    montar(catalogo, (datos, raw))

    resultado = await install_module(
        app_vacia, InstallRequest(module_id="m1"), catalog=catalogo
    )

    assert resultado.progress.preserved == 0
    assert resultado.progress.unaffected == 2


# ══════════════════════ atomicidad y forma de la unidad ═════════════════════


async def test_un_fallo_a_mitad_de_la_escritura_no_deja_nada(
    app_vacia, catalogo, monkeypatch
):
    """CW-01/CW-03: ``_persist`` hace rollback y NO hace el swap del snapshot."""
    montar(catalogo, bundle("m9", leccion("l9")))

    async def revienta(*args, **kwargs):
        raise RuntimeError("disco lleno")

    monkeypatch.setattr(catalog_repo, "log_update_no_commit", revienta)
    snapshot_previo = app_vacia.state.content

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    assert error_de(excinfo).code == "INTERNAL_ERROR"
    await db_intacta(app_vacia.state.db)
    assert app_vacia.state.content is snapshot_previo


async def test_la_red_nunca_se_toca_con_el_write_lock_tomado(app_vacia, catalogo):
    """Si la descarga se sostuviera con el lock, un bucket lento congelaría los
    jobs del estudiante durante 15 s."""
    datos, raw = bundle("m9", leccion("l9"))
    montar(catalogo, (datos, raw))
    lock = app_vacia.state.write_lock
    observado: list[bool] = []

    original_indice = catalogo.fetch_index
    original_modulo = catalogo.fetch_module

    async def espia_indice(**kwargs):
        observado.append(lock.locked())
        return await original_indice(**kwargs)

    async def espia_modulo(module_id, version, **kwargs):
        observado.append(lock.locked())
        return await original_modulo(module_id, version, **kwargs)

    catalogo.fetch_index = espia_indice
    catalogo.fetch_module = espia_modulo

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    assert observado == [False, False]


async def test_el_snapshot_se_cambia_solo_despues_del_commit(app_vacia, catalogo):
    montar(catalogo, bundle("m9", leccion("teoria")))
    previo = app_vacia.state.content
    assert previo.lessons() == []

    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    assert app_vacia.state.content is not previo
    assert [lec.id for lec in app_vacia.state.content.lessons()] == ["teoria"]


async def test_dos_modulos_pueden_reusar_el_mismo_order_de_leccion(
    app_vacia, catalogo
):
    """E2: la unicidad del ``order`` de lección es POR MÓDULO desde la
    migración 5. Instalar à la carte lo vuelve el caso normal, no la excepción."""
    montar(
        catalogo,
        bundle("m8", leccion("l8", order=1), order_hint=8),
        bundle("m9", leccion("l9", order=1), order_hint=9),
    )

    await install_module(app_vacia, InstallRequest(module_id="m8"), catalog=catalogo)
    await install_module(app_vacia, InstallRequest(module_id="m9"), catalog=catalogo)

    ordenes = {
        f["id"]: f["order"]
        for f in await filas(app_vacia.state.db, 'SELECT id, "order" FROM lessons')
    }
    assert ordenes == {"l8": 1, "l9": 1}


# ════════════════════════════ el índice remoto ══════════════════════════════


def test_parse_index_acepta_un_indice_valido():
    datos = indice()
    resultado = module_installer.parse_index(
        json.dumps(datos).encode(), max_bytes=4096
    )
    assert resultado.index_format == 1 and resultado.modules == []


def test_parse_index_rechaza_claves_duplicadas():
    crudo = b'{"index_format":1,"index_format":2,"generated_at":' \
            b'"2026-08-29T12:00:00.000Z","modules":[]}'
    with pytest.raises(ApiException) as excinfo:
        module_installer.parse_index(crudo, max_bytes=4096)
    assert error_de(excinfo).code == "BUNDLE_INVALID"


def test_parse_index_rechaza_el_bom():
    crudo = b"\xef\xbb\xbf" + json.dumps(indice()).encode()
    with pytest.raises(ApiException) as excinfo:
        module_installer.parse_index(crudo, max_bytes=4096)
    assert error_de(excinfo).code == "BUNDLE_INVALID"


def test_parse_index_rechaza_campos_extra():
    datos = {**indice(), "sorpresa": 1}
    with pytest.raises(ApiException) as excinfo:
        module_installer.parse_index(json.dumps(datos).encode(), max_bytes=4096)
    assert error_de(excinfo).code == "BUNDLE_INVALID"


def test_parse_index_rechaza_un_indice_gigante():
    crudo = json.dumps(indice()).encode()
    with pytest.raises(ApiException) as excinfo:
        module_installer.parse_index(crudo, max_bytes=len(crudo) - 1)
    assert error_de(excinfo).code == "BUNDLE_TOO_LARGE"


def test_parse_index_rechaza_una_raiz_que_no_es_objeto():
    with pytest.raises(ApiException) as excinfo:
        module_installer.parse_index(b"[]", max_bytes=4096)
    assert error_de(excinfo).code == "BUNDLE_INVALID"


def test_parse_index_exige_un_tope_positivo():
    with pytest.raises(ValueError):
        module_installer.parse_index(b"{}", max_bytes=0)


def test_parse_index_rechaza_un_anidamiento_que_agota_la_pila():
    """Un JSON hondo puede reventar en el parser, en el barrido o en pydantic;
    en los tres sitios tiene que salir 422, jamás un 500."""
    crudo = b"[" * 200_000
    with pytest.raises(ApiException) as excinfo:
        module_installer.parse_index(crudo, max_bytes=10_000_000)
    assert error_de(excinfo).code == "BUNDLE_INVALID"


def test_traduccion_de_errores_del_puerto_a_codigos_del_contrato():
    """§11.3 en una tabla: el router no vuelve a decidir esto."""
    traducir = module_installer.api_error_from_catalog
    assert traducir(CatalogObjectNotFound("x")).code == "REMOTE_MODULE_NOT_FOUND"
    assert traducir(CatalogObjectTooLarge("x", 10, 11)).status_code == 413
    assert traducir(CatalogUnavailable("server")).status_code == 503



def test_un_error_desconocido_del_puerto_degrada_a_503_no_a_500():
    """Ninguna excepción del puerto puede escaparse como error no controlado."""
    from app.services.catalog_client import CatalogClientError

    error = module_installer.api_error_from_catalog(CatalogClientError("raro"))
    assert error.code == "CATALOG_UNAVAILABLE"
    assert error.status_code == 503
    assert error.details is None


async def test_el_modulo_que_se_declara_con_otra_version_se_rechaza(
    app_vacia, catalogo
):
    datos, raw = bundle("m9", leccion("l9"), version=2)
    catalogo.publicar_modulo("m9", 5, raw)
    catalogo.publicar_indice(indice(entrada_de(datos, raw, version=5)))

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    error = error_de(excinfo)
    assert error.code == "CONTENT_VALIDATION_ERROR"
    assert error.details[0]["field"] == "module.version"
    await db_intacta(app_vacia.state.db)


async def test_un_id_de_pregunta_derivado_impronunciable_se_rechaza(
    app_vacia, catalogo
):
    """El `order` desmedido se rechaza en el esquema, antes de derivar el id.

    `AdminQuizQuestion.order` ya tiene tope (10 000), así que el bundle ni
    siquiera parsea: `{lesson_id}-q{order}` no puede pasarse de los 80 chars de
    QUESTION_ID_PATTERN por construcción. Antes había que cazarlo a mano.
    """
    largo = "l" + "o" * 59  # 60 chars: la lección cabe, el id derivado no cabría

    # Ni siquiera se puede CONSTRUIR el bundle: el tope de `order` lo corta en el
    # esquema. Antes esto se colaba hasta la derivación del id y había que
    # atraparlo a mano; ahora el peligro no existe, porque con el order máximo
    # (10 000) y un lesson_id de 64 chars el id derivado mide 71, bajo los 80 del
    # patrón. El tope se puso por otra razón —un entero sin cota revienta el
    # INSERT de SQLite y sale por un 500— y de paso cerró este agujero.
    with pytest.raises(PydanticValidationError) as excinfo:
        bundle("m9", leccion(largo, quiz=quiz(pregunta(10**20))))

    assert "less than or equal to" in str(excinfo.value)
    await db_intacta(app_vacia.state.db)


async def test_las_colisiones_se_buscan_por_lotes(
    app_vacia, catalogo, monkeypatch
):
    """Un bundle de 100 lecciones × 50 preguntas son 5000 ids: sin trocear, el
    ``IN (...)`` se pasaría del límite de variables de SQLite y el 409 explicado
    se convertiría en un ``OperationalError`` → 500."""
    monkeypatch.setattr(module_installer, "_LOTE_IDS", 2)
    lecciones = [
        leccion(f"l{n}", order=n, example=ejemplo(f"ej{n}")) for n in range(1, 6)
    ]
    montar(
        catalogo,
        bundle("m8", *lecciones, order_hint=8),
        bundle("m9", *lecciones, order_hint=9),
    )
    await install_module(app_vacia, InstallRequest(module_id="m8"), catalog=catalogo)

    with pytest.raises(ApiException) as excinfo:
        await install_module(
            app_vacia, InstallRequest(module_id="m9"), catalog=catalogo
        )

    detalles = error_de(excinfo).details
    assert len([d for d in detalles if d["field"] == "lesson_id"]) == 5
    assert len([d for d in detalles if d["field"] == "example_id"]) == 5
    assert len([d for d in detalles if d["field"] == "question_id"]) == 5


# ═══════════════ el bundle histórico del repo (bloqueo abierto) ═════════════


@pytest.mark.xfail(
    strict=True,
    reason="BLOQUEANTE: bundle_guard._registrar_id mete lección y ejemplo en el "
    "mismo espacio de nombres SIN exceptuar la pareja, así que rechaza "
    "example.id == lesson.id — que es lo que produce el backfill de la "
    "migración 5 y lo único que sabe crear content_admin._example_insert_params. "
    "Con eso, NINGÚN módulo del repo actual es publicable ni instalable. El "
    "arreglo es una condición en _issues_espacio_de_ids: no registrar el id del "
    "ejemplo cuando coincide con el de SU lección. Cuando se arregle este test "
    "pasará (XPASS) y hay que borrar el marker.",
)
async def test_el_m1_real_del_repo_se_instala_tal_cual(app_vacia, catalogo):
    """El fixture INTACTO (mismos bytes que publicaría el admin) debe instalarse.

    Es el golden de ``test_catalog_hash``: si este bundle no entra, el par
    publicar→incorporar no cierra para el contenido que el curso ya tiene.
    """
    datos, raw = m1_real()
    montar(catalogo, (datos, raw))

    resultado = await install_module(
        app_vacia, InstallRequest(module_id="m1"), catalog=catalogo
    )

    assert resultado.installed_checksum == CHECKSUM_M1_V1
    assert resultado.lessons_added == ["primerEjemplo", "for"]


# ═════════════════════ reparto por build (§11.2) ════════════════════════════


@pytest.mark.xfail(
    strict=True,
    reason="BLOQUEANTE: §11.2 exige module_installer en la imagen ESTUDIANTE, "
    "pero el Dockerfile borra ahí content_writer.py (de donde sale _persist) y "
    "markdown_validator.py (que usa bundle_guard). El arreglo es quitarlos del "
    "`rm -f`, con el mismo precedente que ya documenta el propio Dockerfile "
    "para content_admin.py. Cuando se arregle, este test pasará (XPASS) y hay "
    "que borrar el marker.",
)
def test_la_imagen_estudiante_conserva_lo_que_importa_el_instalador():
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(
        encoding="utf-8"
    )
    borrados = set(re.findall(r"app/[\w/]+\.py", dockerfile))
    necesarios = {
        "app/services/content_writer.py",  # _persist, _check_code_size
        "app/services/markdown_validator.py",  # vía bundle_guard
    }
    assert not (borrados & necesarios), sorted(borrados & necesarios)
