"""``services/module_updater`` — CU-39 contra SQLite de verdad.

``test_module_merge`` congela la DOCTRINA (qué debería pasarle a cada lección);
esto congela la EJECUCIÓN: que lo que el plan decide es exactamente lo que
queda escrito, y que ningún camino —ni el feliz, ni el que se corta a mitad,
ni el hostil— consigue quitarle al estudiante lo que ya hizo.

El test que da sentido al archivo es
``test_ninguna_fila_de_avance_desaparece_al_encadenar_versiones``: siembra
avance en TODAS las lecciones de un módulo y le pasa por encima cuatro versiones
que añaden, quitan, mueven, renumeran y reescriben quizzes. Si alguna vez se
pone rojo, la promesa de la fase dejó de cumplirse y hay que parar.

Ningún test toca la red: el catálogo entra por ``FakeCatalogService``, el
``typing.Protocol`` inyectado, igual que Docker entra por ``FakeDockerService``.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import NamedTuple

import pytest
import pytest_asyncio

from app import db as db_module
from app.config import Settings
from app.db import apply_schema, open_db
from app.errors import ApiException
from app.repositories import catalog as repo_catalog
from app.repositories.content import ContentRepository
from app.schemas.catalog import ModuleBundle
from app.schemas.updates import MergeConflict
from app.services import module_updater as updater
from app.services.catalog_client import CatalogUnavailable
from app.services.catalog_hash import bundle_checksum
from app.services.content_writer import _persist
from app.services.module_merge import (
    AVISO_LECCION_RETIRADA,
    AVISO_PROGRESO_PURGADO,
    build_plan,
)

from fakes.fake_catalog import FakeCatalogService

MODULO = "m2"
PUBLICADO = "2026-08-29T10:15:00.000Z"

#: Tablas cuyo contenido NO puede moverse cuando una actualización falla.
TABLAS = (
    "modules",
    "lessons",
    "examples",
    "quiz_questions",
    "lesson_progress",
    "quiz_attempts",
    "jobs",
    "installed_modules",
    "module_update_log",
)
#: Lo que define el CONTENIDO del curso (sin marcas de tiempo de manifiesto).
TABLAS_CONTENIDO = ("modules", "lessons", "examples", "quiz_questions")


# ───────────────────────────── constructores ────────────────────────────────


class Paquete(NamedTuple):
    """Un bundle en sus tres formas: payload, bytes publicables y modelo.

    Los BYTES importan: el checksum de §11.8.2 se calcula sobre el payload
    descargado, no sobre el modelo (que materializa los opcionales con su
    default y daría otro digest). El fake sirve exactamente estos bytes.
    """

    payload: dict
    raw: bytes
    bundle: ModuleBundle
    checksum: str


def opciones(pares=(("a", "Verdadero"), ("b", "Falso"))):
    return [{"key": clave, "text": texto} for clave, texto in pares]


def pregunta(qid, order=1, *, correcta="a", texto=None, pares=None):
    return {
        "id": qid,
        "order": order,
        "text": texto or f"Enunciado {order}",
        "options": opciones(pares or (("a", "Verdadero"), ("b", "Falso"))),
        "correct_key": correcta,
        "explanation": "Porque el reparto es estático.",
    }


def quiz(preguntas, umbral=0.6):
    return {"pass_threshold": umbral, "questions": list(preguntas)}


def ejemplo(eid, *, codigo="print('hola')\n", filename="demo.py"):
    return {
        "id": eid,
        "filename": filename,
        "title": "Demo",
        "difficulty": 2,
        "teaches": "Reparto de trabajo",
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
        "expected_output_note": "Imprime hola",
        "takeaways": ["Se reparte por hilos"],
        "source_code": codigo,
    }


def leccion(
    lid,
    order,
    *,
    titulo=None,
    markdown=None,
    minutos=10,
    video=None,
    habilitada=True,
    regla=None,
    umbral=0.6,
    recomendadas=(),
    ejemplo_=None,
    quiz_=None,
):
    return {
        "id": lid,
        "order": order,
        "title": titulo or f"Lección {lid}",
        "estimated_minutes": minutos,
        "content_markdown": markdown or f"# {lid}\n\nTexto de {lid}.",
        "video_url": video,
        "enabled": habilitada,
        "completion_rule": regla or ("quiz" if quiz_ else "viewed"),
        "pass_threshold": umbral,
        "recommended": [
            {"lesson_id": destino, "label": "Ver", "tag": "Práctica"}
            for destino in recomendadas
        ],
        "example": ejemplo_,
        "quiz": quiz_,
    }


def paquete(
    *lecciones,
    module_id=MODULO,
    version=1,
    hint=1,
    titulo="Módulo de pruebas",
    checksum=None,
) -> Paquete:
    payload = {
        "bundle_format": 1,
        "module": {
            "id": module_id,
            "order_hint": hint,
            "title": titulo,
            "description": "Descripción del módulo.",
            "level": "Básico",
            "version": version,
            "published_at": PUBLICADO,
            "author_label": "Curso Telar",
            "notes": "",
        },
        "lessons": list(lecciones),
    }
    payload["checksum"] = checksum or bundle_checksum(payload)
    crudo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return Paquete(
        payload, crudo, ModuleBundle.model_validate(payload), payload["checksum"]
    )


def con_quiz(lid, order, *, correcta="a", preguntas=2, umbral=0.6, **kw):
    """Atajo: lección con quiz de ``preguntas`` preguntas, todas igual de fáciles.

    ``umbral`` se pone en la lección Y en el quiz porque el umbral EFECTIVO es
    el máximo de los dos: declararlo en un solo sitio dejaría el otro en 0.6 y
    los tests de umbral estarían midiendo otra cosa.
    """
    return leccion(
        lid,
        order,
        umbral=umbral,
        quiz_=quiz(
            [
                pregunta(f"{lid}-q{n}", n, correcta=correcta)
                for n in range(1, preguntas + 1)
            ],
            umbral=umbral,
        ),
        **kw,
    )


# ─────────────────────────────── fixtures ───────────────────────────────────


def _settings(**over) -> Settings:
    base = dict(
        db_path=":memory:",
        jobs_dir="/tmp/telar-tests",
        catalog_bucket="telar-tests",
        max_code_bytes=262144,
    )
    base.update(over)
    return Settings(**base)


async def _app_nueva(settings: Settings | None = None):
    """App mínima con el mismo cableado que el lifespan usa para escribir.

    No se levanta FastAPI: ``_persist`` y el actualizador solo necesitan
    ``db``, ``settings``, los dos locks, el snapshot y el puerto del catálogo.
    Montar routers aquí no probaría nada más y ataría estos tests a un router
    que todavía no existe.
    """
    conn = await open_db(":memory:")
    await apply_schema(conn)
    app = SimpleNamespace(state=SimpleNamespace())
    app.state.db = conn
    app.state.settings = settings or _settings()
    app.state.write_lock = db_module.ReentrantWriteLock()
    app.state.content_read_lock = asyncio.Lock()
    app.state.content = await ContentRepository.load(conn)
    app.state.catalog = FakeCatalogService()
    return app


@pytest_asyncio.fixture
async def app():
    aplicacion = await _app_nueva()
    yield aplicacion
    await aplicacion.state.db.close()


@pytest_asyncio.fixture
async def app_b():
    """Segunda app independiente, para comparar dos historias de versiones."""
    aplicacion = await _app_nueva()
    yield aplicacion
    await aplicacion.state.db.close()


# ─────────────────────────────── utilidades ─────────────────────────────────


async def filas(db, sql, params=()) -> list[dict]:
    cursor = await db.execute(sql, params)
    return [dict(fila) for fila in await cursor.fetchall()]


async def volcado(db, tablas=TABLAS) -> dict[str, list[dict]]:
    """Foto de la base para afirmar «no se escribió absolutamente nada»."""
    return {
        tabla: await filas(db, f"SELECT * FROM {tabla} ORDER BY rowid")
        for tabla in tablas
    }


async def rowids(db, tabla="lessons") -> dict[str, int]:
    """``id`` → ``rowid``. Si una fila se borra y se recrea, su rowid cambia."""
    return {
        fila["id"]: fila["rowid"]
        for fila in await filas(db, f"SELECT rowid, id FROM {tabla}")
    }


def publicar(app, paq: Paquete) -> str:
    return app.state.catalog.publicar_modulo(
        paq.bundle.module.id, paq.bundle.module.version, paq.raw
    )


async def instalar(app, paq: Paquete):
    """Instalación inicial: el mismo ``apply_plan`` que usará el instalador.

    CU-36 no es de este archivo, pero el aplicador sí: sembrar con él (en vez de
    con INSERTs a mano) hace que la idempotencia se pruebe contra lo que de
    verdad quedaría escrito.
    """
    publicar(app, paq)
    db = app.state.db
    async with app.state.write_lock:
        local = await updater.read_local_state(db, paq.bundle.module.id)
        plan = build_plan(local, paq.bundle)
        recogido = []

        async def _escribir() -> None:
            recogido.append(
                await updater.apply_plan(
                    db,
                    plan,
                    paq.bundle,
                    local,
                    object_path=(
                        f"modulos/{paq.bundle.module.id}/"
                        f"v{paq.bundle.module.version}.json"
                    ),
                )
            )

        await _persist(app, _escribir)
    return recogido[0]


async def actualizar(app, paq: Paquete, **kw):
    """Publica el paquete y lanza ``update_module`` hacia su versión."""
    publicar(app, paq)
    return await updater.update_module(
        app, paq.bundle.module.id, to_version=paq.bundle.module.version, **kw
    )


async def sembrar_progreso(
    db,
    lesson_id,
    *,
    viewed=True,
    completed=True,
    best=2,
    via="quiz",
    job_id=None,
):
    await db.execute(
        "INSERT INTO lesson_progress "
        "(lesson_id, viewed, completed, best_quiz_score, last_job_id, "
        " completed_via, completed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, '2026-08-01T00:00:00.000Z')",
        (lesson_id, int(viewed), int(completed), best, job_id, via),
    )
    await db.commit()


async def sembrar_intento(db, attempt_id, lesson_id, respuestas, *, score=2, total=2):
    await db.execute(
        "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total, passed) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            attempt_id,
            lesson_id,
            json.dumps(respuestas),
            score,
            total,
            int(score >= total),
        ),
    )
    await db.commit()


async def sembrar_job(db, job_id, lesson_id):
    await db.execute(
        "INSERT INTO jobs (id, source_kind, lesson_id, filename, source_code, "
        "threads, timeout_s, runner_image, status) "
        "VALUES (?, 'editor', ?, 'main.py', 'print(1)', 2, 30, "
        "'telar-runner:0.5.1', 'completed')",
        (job_id, lesson_id),
    )
    await db.commit()


async def progreso_de(db, lesson_id) -> dict | None:
    encontradas = await filas(
        db, "SELECT * FROM lesson_progress WHERE lesson_id = ?", (lesson_id,)
    )
    return encontradas[0] if encontradas else None


# ═══════════════════════ EL TEST QUE DA SENTIDO AL RESTO ════════════════════


def _historia_de_cuatro_versiones() -> list[Paquete]:
    """v1 → v4 con TODO lo que puede salir mal a la vez.

    v2 añade y retira; v3 reordena, cambia una clave y devuelve a la vida una
    lección archivada; v4 reescribe quizzes enteros y renumera de nuevo. Cada
    salto toca lecciones donde el estudiante ya tiene avance.
    """
    v1 = paquete(
        con_quiz("l1", 1, ejemplo_=ejemplo("ej-l1")),
        con_quiz("l2", 2),
        con_quiz("l3", 3, ejemplo_=ejemplo("ej-l3")),
        con_quiz("l4", 4),
        version=1,
    )
    # v2: nace l5, se retira l2 (que TIENE avance ⇒ se archiva), y todo se
    # renumera con un intercambio l1↔l3 de por medio.
    v2 = paquete(
        con_quiz("l3", 1, ejemplo_=ejemplo("ej-l3")),
        con_quiz("l1", 2, ejemplo_=ejemplo("ej-l1")),
        con_quiz("l4", 3),
        con_quiz("l5", 4),
        version=2,
    )
    # v3: l1 gana una pregunta (el set cambia ⇒ su nota se anula), l4 pierde el
    # quiz entero, y l2 VUELVE con su avance intacto.
    v3 = paquete(
        con_quiz("l3", 1, ejemplo_=ejemplo("ej-l3")),
        con_quiz("l1", 2, preguntas=3, ejemplo_=ejemplo("ej-l1")),
        leccion("l4", 3, regla="viewed"),
        con_quiz("l2", 4),
        version=3,
    )
    # v4: se retira l5 (que para entonces ya tiene avance ⇒ se archiva), l3
    # cambia de ejemplo y todo vuelve a moverse.
    v4 = paquete(
        con_quiz("l2", 1),
        con_quiz("l1", 2, preguntas=3, correcta="b", ejemplo_=ejemplo("ej-l1")),
        con_quiz("l3", 3, ejemplo_=ejemplo("ej-l3-bis")),
        leccion("l4", 4, regla="viewed", markdown="# l4\n\nReescrita."),
        version=4,
    )
    return [v1, v2, v3, v4]


@pytest.mark.asyncio
async def test_ninguna_fila_de_avance_desaparece_al_encadenar_versiones(app):
    """LA promesa de CU-39, con cuatro versiones hostiles encima del avance.

    Se siembra progreso, intentos y jobs en TODAS las lecciones y se aplican
    versiones que añaden, quitan, mueven, renumeran y reescriben quizzes. Al
    final, cuatro cosas tienen que seguir siendo ciertas:

    * ninguna fila de ``lesson_progress`` desapareció,
    * ninguna fila de ``quiz_attempts`` desapareció,
    * ningún ``completed`` pasó de ``True`` a ``False``,
    * ningún informe declaró pérdida alguna.
    """
    db = app.state.db
    v1, v2, v3, v4 = _historia_de_cuatro_versiones()
    await instalar(app, v1)

    for numero, lid in enumerate(("l1", "l2", "l3", "l4"), start=1):
        await sembrar_job(db, f"job{numero}", lid)
        await sembrar_progreso(db, lid, best=2, job_id=f"job{numero}")
        await sembrar_intento(
            db, f"at{numero}", lid, {f"{lid}-q1": "a", f"{lid}-q2": "a"}
        )

    progreso_inicial = {
        fila["lesson_id"]: fila for fila in await filas(db, "SELECT * FROM lesson_progress")
    }
    intentos_iniciales = {
        fila["id"] for fila in await filas(db, "SELECT id FROM quiz_attempts")
    }
    assert len(progreso_inicial) == 4

    completados = {lid for lid, f in progreso_inicial.items() if f["completed"]}
    informes = []

    for paq in (v2, v3, v4):
        informe = await actualizar(app, paq)
        informes.append(informe)

        if paq is v2:  # l5 nace aquí; se le siembra avance para el salto a v3
            await sembrar_job(db, "job5", "l5")
            await sembrar_progreso(db, "l5", best=2, job_id="job5")
            await sembrar_intento(db, "at5", "l5", {"l5-q1": "a", "l5-q2": "a"})
            intentos_iniciales.add("at5")
            completados.add("l5")

        vivas = {
            fila["lesson_id"]: fila
            for fila in await filas(db, "SELECT * FROM lesson_progress")
        }
        # 1 · ninguna fila de progreso desapareció
        assert set(progreso_inicial) <= set(vivas), f"progreso perdido en v{paq.bundle.module.version}"
        # 2 · ninguna fila de intento desapareció
        assert intentos_iniciales <= {
            fila["id"] for fila in await filas(db, "SELECT id FROM quiz_attempts")
        }
        # 3 · ningún completed bajó
        for lid in completados:
            assert vivas[lid]["completed"] == 1, f"'{lid}' perdió su completado"
        # 4 · el informe no declara pérdidas
        assert informe.progress.lost == []

    # `viewed` es un HECHO observado: pase lo que pase con el contenido, sigue.
    final = {
        fila["lesson_id"]: fila
        for fila in await filas(db, "SELECT * FROM lesson_progress")
    }
    assert all(final[lid]["viewed"] == 1 for lid in progreso_inicial)
    # Y ninguna lección con avance acabó borrada de `lessons`.
    ids_lecciones = {fila["id"] for fila in await filas(db, "SELECT id FROM lessons")}
    assert set(final) <= ids_lecciones
    # El historial de jobs sigue apuntando a lecciones resolubles.
    for fila in await filas(db, "SELECT lesson_id FROM jobs"):
        assert fila["lesson_id"] in ids_lecciones


# ═══════════════════════════ idempotencia y versión ═════════════════════════


@pytest.mark.asyncio
async def test_reinstalar_la_misma_version_no_toca_el_contenido(app):
    """Actualizar a lo que ya tienes es un no-op declarado, no un no-op de suerte."""
    db = app.state.db
    v1 = paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1)
    await instalar(app, v1)
    await sembrar_progreso(db, "l1", best=2)
    antes = await volcado(db, TABLAS_CONTENIDO + ("lesson_progress",))

    informe = await actualizar(app, v1)

    assert informe.status == "up_to_date"
    assert informe.lessons.added == [] and informe.lessons.archived == []
    assert await volcado(db, TABLAS_CONTENIDO + ("lesson_progress",)) == antes
    # Lo único que cambia es la marca de «cuándo se miró el bucket».
    manifiesto = await repo_catalog.get_installed(db, MODULO)
    assert manifiesto is not None and manifiesto.last_checked_at is not None


@pytest.mark.asyncio
async def test_aplicar_dos_veces_el_mismo_bundle_deja_las_mismas_filas(app):
    """La idempotencia del APLICADOR, sin el atajo de ``up_to_date``.

    ``update_module`` corta antes cuando el par (versión, checksum) ya es el
    instalado, así que ese camino no probaría el aplicador. Aquí se le manda el
    mismo plan dos veces a la cara: las filas tienen que quedar idénticas.
    """
    db = app.state.db
    v1 = paquete(
        con_quiz("l1", 1, ejemplo_=ejemplo("ej-l1")),
        con_quiz("l2", 2),
        version=1,
    )
    await instalar(app, v1)
    primera = await volcado(db, TABLAS_CONTENIDO)

    await instalar(app, v1)

    assert await volcado(db, TABLAS_CONTENIDO) == primera


@pytest.mark.asyncio
async def test_bajar_de_version_se_rechaza_y_no_escribe_nada(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=3))
    antes = await volcado(db)

    with pytest.raises(ApiException) as excinfo:
        await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    assert excinfo.value.code == "VERSION_CONFLICT"
    assert excinfo.value.status_code == 409
    assert excinfo.value.details == {"reason": "downgrade"}
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_la_misma_version_con_otro_checksum_se_rechaza(app):
    """Una versión publicada es INMUTABLE: si cambia bajo el mismo número,
    «¿hay actualización?» deja de ser decidible y el mecanismo entero se cae."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=2))
    antes = await volcado(db)

    # Mismo número de versión, otro contenido ⇒ otro checksum legítimo.
    with pytest.raises(ApiException) as excinfo:
        await actualizar(app, paquete(con_quiz("l1", 1), version=2, titulo="Otro"))

    assert excinfo.value.code == "VERSION_CONFLICT"
    assert excinfo.value.details == {"reason": "tampered"}
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_el_downgrade_explicito_archiva_en_vez_de_borrar(app):
    """Volver atrás es legal si se pide a mano, y sigue sin destruir avance."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=3))
    await sembrar_progreso(db, "l2", best=2)

    informe = await actualizar(
        app, paquete(con_quiz("l1", 1), version=2), allow_downgrade=True
    )

    assert informe.lessons.archived == ["l2"]
    assert (await progreso_de(db, "l2"))["completed"] == 1
    assert {aviso.code for aviso in informe.warnings} >= {"DOWNGRADE"}


@pytest.mark.asyncio
async def test_saltar_de_v2_a_v5_equivale_a_encadenar(app, app_b):
    """Un salto largo no puede dar un resultado distinto a los saltos cortos.

    El bundle es un ESTADO completo, no un parche, así que aplicar v5 sobre v2
    tiene que dejar exactamente el mismo contenido que pasar por v3 y v4. Si no
    fuera así, quien actualiza poco tendría un curso distinto de quien actualiza
    a menudo, y el número de versión dejaría de significar algo.
    """
    v2 = paquete(con_quiz("l1", 1), con_quiz("l2", 2), con_quiz("l3", 3), version=2)
    v3 = paquete(
        con_quiz("l1", 1), con_quiz("l2", 2), con_quiz("l3", 3),
        con_quiz("l4", 4), version=3,
    )
    v4 = paquete(
        con_quiz("l1", 1), con_quiz("l3", 2), con_quiz("l4", 3), version=4
    )
    v5 = paquete(
        con_quiz("l3", 1), con_quiz("l4", 2),
        con_quiz("l1", 3, correcta="b"), version=5,
    )

    for aplicacion in (app, app_b):
        await instalar(aplicacion, v2)
        for numero, lid in enumerate(("l1", "l2", "l3"), start=1):
            await sembrar_progreso(aplicacion.state.db, lid, best=2)
            await sembrar_intento(
                aplicacion.state.db, f"at{numero}", lid,
                {f"{lid}-q1": "a", f"{lid}-q2": "a"},
            )

    for paq in (v3, v4, v5):  # el camino largo
        await actualizar(app, paq)
    await actualizar(app_b, v5)  # el salto

    def sin_fechas(instantanea):
        for fila in instantanea["lessons"]:
            fila["archived_at"] = fila["archived_at"] is not None
        return instantanea

    assert sin_fechas(await volcado(app.state.db, TABLAS_CONTENIDO)) == sin_fechas(
        await volcado(app_b.state.db, TABLAS_CONTENIDO)
    )
    quitar = {"updated_at", "completed_at"}
    limpio_a = [
        {k: v for k, v in fila.items() if k not in quitar}
        for fila in await filas(app.state.db, "SELECT * FROM lesson_progress ORDER BY lesson_id")
    ]
    limpio_b = [
        {k: v for k, v in fila.items() if k not in quitar}
        for fila in await filas(app_b.state.db, "SELECT * FROM lesson_progress ORDER BY lesson_id")
    ]
    assert limpio_a == limpio_b


# ══════════════════════════ archivar en vez de borrar ═══════════════════════


@pytest.mark.asyncio
async def test_la_leccion_archivada_sigue_siendo_legible_con_su_progreso(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    await sembrar_intento(db, "at1", "l2", {"l2-q1": "a", "l2-q2": "a"})

    informe = await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    assert informe.lessons.archived == ["l2"]
    archivada = (await filas(db, "SELECT * FROM lessons WHERE id = 'l2'"))[0]
    assert archivada["archived_at"] is not None
    assert archivada["content_markdown"]  # sigue siendo legible por URL
    progreso = await progreso_de(db, "l2")
    assert (progreso["viewed"], progreso["completed"], progreso["best_quiz_score"]) == (
        1, 1, 2,
    )
    assert len(await filas(db, "SELECT * FROM quiz_attempts WHERE lesson_id='l2'")) == 1
    # Fuera de la ruta lineal: el snapshot no la encadena con sus vecinas.
    assert app.state.content.lesson("l2").archived is True
    assert {aviso.code for aviso in informe.warnings} >= {AVISO_LECCION_RETIRADA}


@pytest.mark.asyncio
async def test_el_historial_de_jobs_sobrevive_al_archivado(app):
    """Sin la fila de ``lessons`` el historial diría «lección desconocida».

    ``jobs.lesson_id`` no tiene FK (§8.3), así que borrar la lección no borra el
    job: lo deja apuntando al vacío. Archivar conserva el título resoluble.
    """
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_job(db, "job1", "l2")
    await sembrar_progreso(db, "l2", best=2, job_id="job1")

    await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    jobs = await filas(db, "SELECT id, lesson_id FROM jobs")
    assert jobs == [{"id": "job1", "lesson_id": "l2"}]
    titulo = await filas(db, "SELECT title FROM lessons WHERE id = 'l2'")
    assert titulo and titulo[0]["title"]
    # `last_job_id` es un hecho observado: la recalificación no lo toca.
    assert (await progreso_de(db, "l2"))["last_job_id"] == "job1"


@pytest.mark.asyncio
async def test_una_leccion_que_nadie_toco_se_borra_limpiamente(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))

    informe = await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    assert informe.lessons.removed == ["l2"]
    assert informe.lessons.archived == []
    assert await filas(db, "SELECT id FROM lessons WHERE id = 'l2'") == []
    assert informe.progress.lost == []


@pytest.mark.asyncio
async def test_una_version_posterior_devuelve_la_leccion_archivada_a_la_vida(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    informe = await actualizar(
        app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=3)
    )

    assert informe.lessons.restored == ["l2"]
    resucitada = (await filas(db, "SELECT * FROM lessons WHERE id='l2'"))[0]
    assert resucitada["archived_at"] is None
    assert (await progreso_de(db, "l2"))["completed"] == 1


@pytest.mark.asyncio
async def test_purge_es_el_unico_camino_que_destruye_avance(app):
    """Y cuando destruye, lo dice: ``lost`` deja de estar vacío."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    await sembrar_intento(db, "at1", "l2", {"l2-q1": "a"})

    informe = await actualizar(
        app, paquete(con_quiz("l1", 1), version=2), on_removed_lessons="purge"
    )

    assert informe.progress.lost == ["l2"]
    assert informe.lessons.removed == ["l2"]
    assert await progreso_de(db, "l2") is None
    assert await filas(db, "SELECT * FROM quiz_attempts WHERE lesson_id='l2'") == []
    assert {aviso.code for aviso in informe.warnings} >= {AVISO_PROGRESO_PURGADO}


@pytest.mark.asyncio
async def test_sin_purge_el_avance_de_la_retirada_no_se_toca(app):
    """El mismo escenario, con la política por defecto: nada se pierde."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    await sembrar_intento(db, "at1", "l2", {"l2-q1": "a"})

    informe = await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    assert informe.progress.lost == []
    assert await progreso_de(db, "l2") is not None
    assert len(await filas(db, "SELECT * FROM quiz_attempts")) == 1


# ═════════════════════════════ orders en dos fases ══════════════════════════


@pytest.mark.asyncio
async def test_intercambiar_dos_orders_no_revienta_a_mitad_de_transaccion(app):
    """El índice único parcial se valida POR SENTENCIA: sin aparcar, esto revienta."""
    db = app.state.db
    await instalar(
        app,
        paquete(con_quiz("l1", 1), con_quiz("l2", 2), con_quiz("l3", 3), version=1),
    )

    await actualizar(
        app,
        paquete(con_quiz("l1", 1), con_quiz("l3", 2), con_quiz("l2", 3), version=2),
    )

    ordenes = {
        fila["id"]: fila["order"]
        for fila in await filas(db, 'SELECT id, "order" FROM lessons')
    }
    assert ordenes == {"l1": 1, "l3": 2, "l2": 3}


@pytest.mark.asyncio
async def test_la_inversion_completa_del_modulo_no_revienta(app):
    db = app.state.db
    await instalar(
        app,
        paquete(*(con_quiz(f"l{n}", n) for n in range(1, 6)), version=1),
    )

    await actualizar(
        app,
        paquete(*(con_quiz(f"l{n}", 6 - n) for n in range(1, 6)), version=2),
    )

    ordenes = {
        fila["id"]: fila["order"]
        for fila in await filas(db, 'SELECT id, "order" FROM lessons')
    }
    assert ordenes == {"l1": 5, "l2": 4, "l3": 3, "l4": 2, "l5": 1}


@pytest.mark.asyncio
async def test_el_lote_que_mueve_una_leccion_entre_modulos_no_revienta(app):
    """El caso que rompe si el MAX del aparcado se acota por módulo.

    Una fila estacionada dentro de su módulo de origen puede chocar con otra ya
    colocada en su destino; por eso el ``MAX`` se toma sobre toda la tabla.
    """
    db = app.state.db
    await instalar(
        app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1, hint=1)
    )
    await instalar(
        app, paquete(con_quiz("x1", 1), module_id="m9", version=1, hint=2)
    )
    await sembrar_progreso(db, "x1", best=2)

    informe = await actualizar(
        app,
        paquete(
            con_quiz("x1", 1), con_quiz("l1", 2), con_quiz("l2", 3), version=2
        ),
    )

    assert informe.lessons.moved_in == ["x1"]
    ubicacion = {
        fila["id"]: (fila["module_id"], fila["order"])
        for fila in await filas(db, 'SELECT id, module_id, "order" FROM lessons')
    }
    assert ubicacion == {"x1": (MODULO, 1), "l1": (MODULO, 2), "l2": (MODULO, 3)}
    # El progreso viaja gratis: está anclado al lesson_id, no al módulo.
    assert (await progreso_de(db, "x1"))["completed"] == 1


@pytest.mark.asyncio
async def test_actualizar_no_reordena_el_curso_del_estudiante(app):
    """``modules."order"`` es del estudiante (D5): el ``order_hint`` no manda."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1, hint=1))
    await instalar(app, paquete(con_quiz("x1", 1), module_id="m9", version=1, hint=7))
    antes = {
        fila["id"]: fila["order"]
        for fila in await filas(db, 'SELECT id, "order" FROM modules')
    }

    await actualizar(app, paquete(con_quiz("l1", 1), version=2, hint=99))

    despues = {
        fila["id"]: fila["order"]
        for fila in await filas(db, 'SELECT id, "order" FROM modules')
    }
    assert despues == antes


# ═════════════════════════ UPSERT, nunca borrar y recrear ═══════════════════


@pytest.mark.asyncio
async def test_la_leccion_se_actualiza_en_su_sitio_y_no_se_recrea(app):
    """Prueba mecánica: si la fila se borrara y se reinsertara, su ``rowid``
    cambiaría. Recrear una lección es lo que dispara los CASCADE y lo que la
    ruta admin usa para purgar el avance (BL-01)."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, ejemplo_=ejemplo("ej-l1")), version=1))
    antes_lecciones = await rowids(db, "lessons")
    antes_ejemplos = await rowids(db, "examples")

    await actualizar(
        app,
        paquete(
            con_quiz(
                "l1", 1, markdown="# l1\n\nOtro texto.", ejemplo_=ejemplo("ej-l1")
            ),
            version=2,
        ),
    )

    assert await rowids(db, "lessons") == antes_lecciones
    assert await rowids(db, "examples") == antes_ejemplos
    texto = (await filas(db, "SELECT content_markdown FROM lessons"))[0]
    assert "Otro texto" in texto["content_markdown"]


@pytest.mark.asyncio
async def test_el_ejemplo_que_cambia_de_id_no_choca_con_el_anterior(app):
    """``examples.lesson_id`` es UNIQUE: hay que soltar antes de escribir."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, ejemplo_=ejemplo("ej-viejo")), version=1))

    await actualizar(
        app, paquete(con_quiz("l1", 1, ejemplo_=ejemplo("ej-nuevo")), version=2)
    )

    ejemplos = await filas(db, "SELECT id, lesson_id FROM examples")
    assert ejemplos == [{"id": "ej-nuevo", "lesson_id": "l1"}]


@pytest.mark.asyncio
async def test_una_leccion_puede_quedarse_sin_ejemplo(app):
    """E1: la lección conceptual es representable, y llegar a serla no borra nada."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, ejemplo_=ejemplo("ej-l1")), version=1))
    await sembrar_progreso(db, "l1", best=2)

    await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    assert await filas(db, "SELECT id FROM examples") == []
    assert (await progreso_de(db, "l1"))["completed"] == 1


@pytest.mark.asyncio
async def test_dos_lecciones_pueden_intercambiarse_el_ejemplo(app):
    """El id de ejemplo se muda dentro del módulo sin chocar con el UNIQUE."""
    db = app.state.db
    await instalar(
        app,
        paquete(
            con_quiz("l1", 1, ejemplo_=ejemplo("ej-a")),
            con_quiz("l2", 2, ejemplo_=ejemplo("ej-b")),
            version=1,
        ),
    )

    await actualizar(
        app,
        paquete(
            con_quiz("l1", 1, ejemplo_=ejemplo("ej-b")),
            con_quiz("l2", 2, ejemplo_=ejemplo("ej-a")),
            version=2,
        ),
    )

    pares = {
        fila["id"]: fila["lesson_id"]
        for fila in await filas(db, "SELECT id, lesson_id FROM examples")
    }
    assert pares == {"ej-b": "l1", "ej-a": "l2"}


@pytest.mark.asyncio
async def test_reemplazar_el_quiz_no_borra_los_intentos(app):
    """Los intentos son EVIDENCIA: no tienen FK al quiz precisamente para esto."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await sembrar_intento(db, "at1", "l1", {"l1-q1": "a", "l1-q2": "a"})

    await actualizar(app, paquete(con_quiz("l1", 1, preguntas=3), version=2))

    assert len(await filas(db, "SELECT * FROM quiz_attempts")) == 1
    assert len(await filas(db, "SELECT * FROM quiz_questions")) == 3


# ═════════════════════ recalificación: el UPDATE absoluto ═══════════════════


@pytest.mark.asyncio
async def test_cambiar_el_conjunto_de_preguntas_anula_la_nota_sin_bajar_el_completado(
    app,
):
    """El upsert normal NO podría hacer esto: ``MAX``/``COALESCE`` le impiden
    bajar la nota y escribir ``NULL``, y un 4/4 obsoleto quedaría pegado."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await sembrar_progreso(db, "l1", best=2)
    await sembrar_intento(db, "at1", "l1", {"l1-q1": "a", "l1-q2": "a"})

    informe = await actualizar(app, paquete(con_quiz("l1", 1, preguntas=4), version=2))

    progreso = await progreso_de(db, "l1")
    assert progreso["best_quiz_score"] is None  # la caché se anula
    assert progreso["completed"] == 1  # el logro NO se revoca
    assert progreso["viewed"] == 1
    assert [i.model_dump() for i in informe.progress.scores_invalidated] == [
        {"lesson_id": "l1", "previous_score": 2, "previous_total": 2}
    ]
    # El histórico sigue intacto: anular la caché no pierde nada.
    assert len(await filas(db, "SELECT * FROM quiz_attempts")) == 1


@pytest.mark.asyncio
async def test_corregir_una_clave_equivocada_recalifica_desde_el_historico(app):
    """El docente arregla la respuesta correcta y el punto se recupera solo."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, correcta="b"), version=1))
    await sembrar_progreso(db, "l1", completed=False, best=0, via=None)
    await sembrar_intento(db, "at1", "l1", {"l1-q1": "a", "l1-q2": "a"}, score=0)

    await actualizar(app, paquete(con_quiz("l1", 1, correcta="a"), version=2))

    progreso = await progreso_de(db, "l1")
    assert progreso["best_quiz_score"] == 2
    assert progreso["completed"] == 1
    assert progreso["completed_via"] == "quiz"


@pytest.mark.asyncio
async def test_subir_el_umbral_no_revoca_un_completado_ya_ganado(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, umbral=0.5), version=1))
    await sembrar_progreso(db, "l1", best=1)
    await sembrar_intento(db, "at1", "l1", {"l1-q1": "a"}, score=1)

    await actualizar(app, paquete(con_quiz("l1", 1, umbral=1.0), version=2))

    assert (await progreso_de(db, "l1"))["completed"] == 1


@pytest.mark.asyncio
async def test_bajar_el_umbral_concede_el_completado_desde_el_historico(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, umbral=1.0), version=1))
    await sembrar_progreso(db, "l1", completed=False, best=1, via=None)
    await sembrar_intento(db, "at1", "l1", {"l1-q1": "a", "l1-q2": "b"}, score=1)

    informe = await actualizar(app, paquete(con_quiz("l1", 1, umbral=0.5), version=2))

    assert (await progreso_de(db, "l1"))["completed"] == 1
    assert informe.progress.completed_gained == ["l1"]


@pytest.mark.asyncio
async def test_una_leccion_sin_avance_previo_no_estrena_fila(app):
    """``rescore`` es un UPDATE puro: escribir una fila inventaría avance."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))

    await actualizar(app, paquete(con_quiz("l1", 1, preguntas=3), version=2))

    assert await filas(db, "SELECT * FROM lesson_progress") == []


@pytest.mark.asyncio
async def test_el_umbral_guardado_es_el_efectivo_no_el_de_la_leccion(app):
    """La DB guarda UN umbral (``lessons.pass_threshold``, el que lee
    ``QuizService``) y el bundle declara dos. Se escribe el más exigente, que es
    el que usó el plan: si no, la vista previa prometería un ``completed`` que
    el servidor luego no reconocería."""
    db = app.state.db

    await instalar(
        app,
        paquete(
            leccion(
                "l1",
                1,
                umbral=0.5,
                quiz_=quiz([pregunta("l1-q1")], umbral=0.9),
            ),
            version=1,
        ),
    )

    guardado = (await filas(db, "SELECT pass_threshold FROM lessons"))[0]
    assert guardado["pass_threshold"] == pytest.approx(0.9)


# ═══════════════════════════ nada a medias jamás ════════════════════════════


@pytest.mark.asyncio
async def test_una_descarga_que_falla_no_deja_ni_una_sentencia_escrita(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await sembrar_progreso(db, "l1", best=2)
    antes = await volcado(db)
    app.state.catalog.fallar_modulo(
        MODULO, 2, CatalogUnavailable("network", retry_after_s=5)
    )

    with pytest.raises(ApiException) as excinfo:
        await updater.update_module(app, MODULO, to_version=2)

    assert excinfo.value.code == "CATALOG_UNAVAILABLE"
    assert excinfo.value.status_code == 503
    assert excinfo.value.details == {"reason": "network", "retry_after_s": 5}
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_un_bundle_ilegible_no_deja_nada_escrito(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    antes = await volcado(db)
    app.state.catalog.publicar_modulo(MODULO, 2, b"{esto no es json")

    with pytest.raises(ApiException) as excinfo:
        await updater.update_module(app, MODULO, to_version=2)

    assert excinfo.value.code == "BUNDLE_INVALID"
    assert excinfo.value.status_code == 422
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_un_checksum_que_no_cuadra_no_deja_nada_escrito(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    antes = await volcado(db)
    mentiroso = paquete(con_quiz("l1", 1), version=2, checksum="0" * 64)

    with pytest.raises(ApiException) as excinfo:
        await actualizar(app, mentiroso)

    assert excinfo.value.code == "CHECKSUM_MISMATCH"
    assert excinfo.value.status_code == 409
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_expected_checksum_ancla_lo_que_el_estudiante_vio_en_pantalla(app):
    """Cierra el TOCTOU: el bucket se reescribió entre el listado y el clic."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    antes = await volcado(db)

    with pytest.raises(ApiException) as excinfo:
        await actualizar(
            app, paquete(con_quiz("l1", 1), version=2), expected_checksum="f" * 64
        )

    assert excinfo.value.code == "CHECKSUM_MISMATCH"
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_un_objeto_que_dice_ser_otro_modulo_se_rechaza(app):
    """La ruta se deriva de ``(module_id, version)``; el contenido tiene que
    coincidir con lo que esa ruta prometía, o un bucket mentiroso instalaría
    cualquier cosa bajo el id que el estudiante pidió."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    antes = await volcado(db)
    impostor = paquete(con_quiz("l1", 1), module_id="m9", version=2)
    app.state.catalog.publicar_modulo(MODULO, 2, impostor.raw)

    with pytest.raises(ApiException) as excinfo:
        await updater.update_module(app, MODULO, to_version=2)

    assert excinfo.value.code == "BUNDLE_INVALID"
    assert [detalle["field"] for detalle in excinfo.value.details] == ["module.id"]
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_un_objeto_con_otra_version_dentro_se_rechaza(app):
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    app.state.catalog.publicar_modulo(
        MODULO, 2, paquete(con_quiz("l1", 1), version=7).raw
    )

    with pytest.raises(ApiException) as excinfo:
        await updater.update_module(app, MODULO, to_version=2)

    assert [detalle["field"] for detalle in excinfo.value.details] == ["module.version"]


@pytest.mark.asyncio
async def test_un_id_que_pertenece_a_un_modulo_local_da_409_y_no_escribe(app):
    """La frontera de confianza: lo remoto no le roba contenido a lo autorado aquí."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await db.execute(
        "INSERT INTO modules (id, \"order\", title, description, level, origin) "
        "VALUES ('mio', 9, 'Mío', '', 'Básico', 'local')"
    )
    await db.execute(
        'INSERT INTO lessons (id, module_id, "order", title, estimated_minutes, '
        "content_markdown, pass_threshold) "
        "VALUES ('propia', 'mio', 1, 'Propia', 5, '# propia', 0.6)"
    )
    await db.commit()
    antes = await volcado(db)

    with pytest.raises(ApiException) as excinfo:
        await actualizar(
            app, paquete(con_quiz("l1", 1), con_quiz("propia", 2), version=2)
        )

    assert excinfo.value.code == "DUPLICATE_ID"
    assert excinfo.value.status_code == 409
    assert excinfo.value.details[0]["field"] == "lesson_id"
    assert excinfo.value.details[0]["owner_module_id"] == "mio"
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_apply_plan_no_confirma_ni_toma_el_lock(app):
    """Es una PIEZA de una unidad compuesta: quien la llama sostiene el lock y
    hace el único ``commit``. Si confirmara por su cuenta, un fallo posterior
    dejaría media actualización escrita."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    antes = await volcado(db)
    siguiente = paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=2)

    async with app.state.write_lock:
        local = await updater.read_local_state(db, MODULO)
        plan = build_plan(local, siguiente.bundle)
        await updater.apply_plan(
            db, plan, siguiente.bundle, local, object_path="modulos/m2/v2.json"
        )
        assert db.in_transaction is True
        await db.rollback()

    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_apply_plan_se_niega_a_ejecutar_un_plan_con_conflictos(app):
    """Con conflictos el aplicador no arranca: es un error de PROGRAMACIÓN del
    llamador, no una entrada hostil, y por eso revienta con ``ValueError``."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    siguiente = paquete(con_quiz("l1", 1), version=2)
    async with app.state.write_lock:
        local = await updater.read_local_state(db, MODULO)
        plan = build_plan(local, siguiente.bundle)
    plan.conflicts.append(
        MergeConflict(code="X", field="lesson_id", id="l1", owner_module_id="mio")
    )

    with pytest.raises(ValueError, match="conflictos"):
        await updater.apply_plan(
            db, plan, siguiente.bundle, local, object_path="modulos/m2/v2.json"
        )


# ══════════════════════════════ vista previa ════════════════════════════════


@pytest.mark.asyncio
async def test_la_vista_previa_no_escribe_una_sola_sentencia(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    antes = await volcado(db)

    informe = await actualizar(
        app, paquete(con_quiz("l1", 1), con_quiz("l3", 2), version=2), preview=True
    )

    assert informe.status == "preview"
    assert informe.lessons.added == ["l3"]
    assert informe.lessons.archived == ["l2"]
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_lo_que_la_vista_previa_promete_es_lo_que_ocurre(app):
    """Un preview que mienta es peor que no tenerlo: por eso preview y ejecución
    comparten plan, tipo de informe y camino."""
    db = app.state.db
    await instalar(
        app,
        paquete(con_quiz("l1", 1), con_quiz("l2", 2), con_quiz("l3", 3), version=1),
    )
    await sembrar_progreso(db, "l1", best=2)
    await sembrar_progreso(db, "l3", best=2)
    await sembrar_intento(db, "at1", "l1", {"l1-q1": "a", "l1-q2": "a"})
    siguiente = paquete(
        con_quiz("l1", 1, preguntas=3), con_quiz("l4", 2), version=2
    )

    previa = await actualizar(app, siguiente, preview=True)
    real = await actualizar(app, siguiente)

    assert previa.model_dump(exclude={"status"}) == real.model_dump(exclude={"status"})
    assert (previa.status, real.status) == ("preview", "updated")


@pytest.mark.asyncio
async def test_la_vista_previa_de_un_modulo_al_dia_no_promete_cambios(app):
    db = app.state.db
    v1 = paquete(con_quiz("l1", 1), version=1)
    await instalar(app, v1)
    antes = await volcado(db)

    informe = await actualizar(app, v1, preview=True)

    assert informe.status == "preview"
    assert informe.lessons.model_dump() == {
        "added": [], "updated": [], "revised": [], "unchanged": [],
        "restored": [], "archived": [], "removed": [], "moved_in": [],
    }
    assert await volcado(db) == antes


# ══════════════════════════ manifiesto y bitácora ═══════════════════════════


@pytest.mark.asyncio
async def test_el_informe_queda_en_la_bitacora(app):
    """La trazabilidad de la promesa: poder responder QUÉ se conservó, en vez de
    pedirle al estudiante que confíe."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)

    await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    entradas = await repo_catalog.list_update_log(db, MODULO)
    assert [(e.from_version, e.to_version) for e in entradas] == [(1, 2), (None, 1)]
    reciente = entradas[0].report
    assert reciente["status"] == "updated"
    assert reciente["lessons"]["archived"] == ["l2"]
    assert reciente["progress"]["lost"] == []


@pytest.mark.asyncio
async def test_el_manifiesto_queda_al_dia_tras_actualizar(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await repo_catalog.set_locally_modified_no_commit(db, MODULO, True)
    await db.commit()
    siguiente = paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=2)

    await actualizar(app, siguiente)

    manifiesto = await repo_catalog.get_installed(db, MODULO)
    assert manifiesto is not None
    assert manifiesto.installed_version == 2
    assert manifiesto.installed_checksum == siguiente.checksum
    assert manifiesto.object_path == "modulos/m2/v2.json"
    # Tras aplicar el bundle, el módulo local vuelve a ser el remoto.
    assert manifiesto.locally_modified is False
    assert manifiesto.available_version == 2


@pytest.mark.asyncio
async def test_editar_en_local_avisa_pero_no_bloquea(app):
    """§11.3 no tiene código de error para esto, así que no se inventa uno: se
    dice en el informe, que es donde el estudiante puede verlo."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await repo_catalog.set_locally_modified_no_commit(db, MODULO, True)
    await db.commit()

    informe = await actualizar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=2))

    assert informe.status == "updated"
    assert updater.AVISO_MODIFICADO_EN_LOCAL in {a.code for a in informe.warnings}


@pytest.mark.asyncio
async def test_el_modulo_recien_aplicado_queda_marcado_como_remoto(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))

    fila = (await filas(db, "SELECT * FROM modules WHERE id = ?", (MODULO,)))[0]
    assert fila["origin"] == updater.ORIGEN_REMOTO
    assert fila["version"] == 1
    assert fila["published_at"] == PUBLICADO


# ═══════════════════════════ puertas de entrada ═════════════════════════════


@pytest.mark.asyncio
async def test_actualizar_un_modulo_no_instalado_da_404(app):
    with pytest.raises(ApiException) as excinfo:
        await updater.update_module(app, "fantasma", to_version=2)

    assert excinfo.value.code == "MODULE_NOT_INSTALLED"
    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_sin_bucket_configurado_el_catalogo_esta_apagado():
    aplicacion = await _app_nueva(_settings(catalog_bucket=""))
    try:
        with pytest.raises(ApiException) as excinfo:
            await updater.update_module(aplicacion, MODULO)
        assert excinfo.value.code == "CATALOG_DISABLED"
        assert excinfo.value.status_code == 503
    finally:
        await aplicacion.state.db.close()


@pytest.mark.asyncio
async def test_una_version_que_el_bucket_no_publica_da_404(app):
    await instalar(app, paquete(con_quiz("l1", 1), version=1))

    with pytest.raises(ApiException) as excinfo:
        await updater.update_module(app, MODULO, to_version=9)

    assert excinfo.value.code == "REMOTE_MODULE_NOT_FOUND"
    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_un_bundle_por_encima_del_tope_da_413(app):
    aplicacion = await _app_nueva(_settings(catalog_max_bundle_bytes=64))
    try:
        # La instalación no pasa por el puerto, así que el tope solo muerde al
        # descargar: es exactamente donde el contrato lo pone (§11.6.1).
        await instalar(aplicacion, paquete(con_quiz("l1", 1), version=1))
        publicar(aplicacion, paquete(con_quiz("l1", 1), version=2))

        with pytest.raises(ApiException) as excinfo:
            await updater.update_module(aplicacion, MODULO, to_version=2)

        assert excinfo.value.code == "BUNDLE_TOO_LARGE"
        assert excinfo.value.status_code == 413
    finally:
        await aplicacion.state.db.close()


@pytest.mark.asyncio
async def test_sin_to_version_se_va_a_la_que_anuncia_el_indice(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    siguiente = paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=4)
    publicar(app, siguiente)
    await repo_catalog.set_available_no_commit(
        db, MODULO, available_version=4, available_checksum=siguiente.checksum
    )
    await db.commit()

    informe = await updater.update_module(app, MODULO)

    assert (informe.from_version, informe.to_version) == (1, 4)


# ═══════════════════════ validación previa al lock ══════════════════════════


def test_validar_bundle_rechaza_el_codigo_que_pasa_del_tope():
    paq = paquete(
        con_quiz("l1", 1, ejemplo_=ejemplo("ej", codigo="x" * 500)), version=1
    )

    with pytest.raises(ApiException) as excinfo:
        updater.validar_bundle(paq.bundle, max_code_bytes=100)

    assert excinfo.value.code == "CONTENT_VALIDATION_ERROR"
    assert excinfo.value.details[0]["field"] == "lessons[0].example.source_code"


def test_validar_bundle_rechaza_el_ejemplo_incoherente():
    ej = ejemplo("ej")
    ej["threads_configurable"] = False
    ej["sweeps_threads"] = False
    ej["fixed_threads"] = None
    paq = paquete(con_quiz("l1", 1, ejemplo_=ej), version=1)

    with pytest.raises(ApiException) as excinfo:
        updater.validar_bundle(paq.bundle, max_code_bytes=262144)

    assert excinfo.value.details[0]["field"] == "lessons[0].example.fixed_threads"


def test_validar_bundle_caza_el_id_de_pregunta_autogenerado_que_choca():
    """El agujero de BL-18: ``bundle_guard`` solo ve los ids EXPLÍCITOS, y el
    omitido se autogenera como ``{lesson_id}-q{order}``. Sin esto, el choque
    sería un ``IntegrityError`` sobre la PK, o sea un 500 en vez de un 422."""
    chocante = leccion(
        "otra",
        2,
        quiz_=quiz([pregunta("l1-q1", 1)]),  # id explícito que pisa el de l1
    )
    sin_id = {**pregunta("x", 1), "id": None}
    paq = paquete(
        leccion("l1", 1, quiz_=quiz([sin_id])),  # se autogenera 'l1-q1'
        chocante,
        version=1,
    )

    with pytest.raises(ApiException) as excinfo:
        updater.validar_bundle(paq.bundle, max_code_bytes=262144)

    assert excinfo.value.code == "CONTENT_VALIDATION_ERROR"
    assert "l1-q1" in excinfo.value.details[0]["reason"]


def test_verificar_checksum_hashea_el_payload_no_el_modelo():
    """Un bundle publicado SIN sus campos opcionales tiene otro digest que el
    modelo (que los materializa con su default). Hashear el modelo haría que un
    módulo perfectamente válido pareciera corrupto."""
    payload = paquete(con_quiz("l1", 1), version=1).payload
    sin_notas = {k: v for k, v in payload.items() if k != "checksum"}
    sin_notas["module"] = {
        k: v for k, v in sin_notas["module"].items() if k != "notes"
    }
    sin_notas["checksum"] = bundle_checksum(sin_notas)
    crudo = json.dumps(sin_notas, ensure_ascii=False).encode("utf-8")

    real = updater.verificar_checksum(crudo, ModuleBundle.model_validate(sin_notas))

    assert real == sin_notas["checksum"]
    assert real != bundle_checksum(ModuleBundle.model_validate(sin_notas))


def test_verificar_checksum_rechaza_el_expected_que_no_cuadra():
    paq = paquete(con_quiz("l1", 1), version=1)

    with pytest.raises(ApiException) as excinfo:
        updater.verificar_checksum(paq.raw, paq.bundle, esperado="a" * 64)

    assert excinfo.value.code == "CHECKSUM_MISMATCH"


# ═════════════════════════ lectura del estado local ═════════════════════════


@pytest.mark.asyncio
async def test_read_local_state_ve_las_lecciones_de_todos_los_modulos(app):
    """Sin las de fuera, una lección reclamada desde otro módulo llegaría sin su
    estado anterior y su nota obsoleta viajaría intacta con ella."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1, hint=1))
    await instalar(app, paquete(con_quiz("x1", 1), module_id="m9", version=1, hint=2))

    local = await updater.read_local_state(db, MODULO)

    assert set(local.lessons) == {"l1", "x1"}
    assert local.lessons["x1"].module_id == "m9"
    assert local.module_origin == {MODULO: "remote", "m9": "remote"}
    assert local.orders_ocupados == frozenset({2})
    assert local.question_owner["x1-q1"] == "x1"


@pytest.mark.asyncio
async def test_read_local_state_ignora_los_intentos_ilegibles(app):
    """Contarlos como «0 aciertos» tumbaría una nota real: ``max(notas, …)``
    toma el máximo, y un 0 fabricado es peor que no tener evidencia."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await sembrar_progreso(db, "l1", best=2)
    await db.execute(
        "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total, passed) "
        "VALUES ('roto', 'l1', 'no soy json', 0, 2, 0)"
    )
    await db.commit()

    local = await updater.read_local_state(db, MODULO)
    assert local.attempts.get("l1") is None

    # Y el efecto que importa: sin evidencia legible, la nota NO se anula.
    await actualizar(app, paquete(con_quiz("l1", 1, markdown="# l1\n\nOtro."), version=2))
    assert (await progreso_de(db, "l1"))["best_quiz_score"] == 2


@pytest.mark.asyncio
async def test_read_local_state_sin_modulo_instalado_no_inventa_version(app):
    local = await updater.read_local_state(app.state.db, "fantasma")

    assert (local.version, local.checksum, local.order) == (None, None, None)
    assert local.lessons == {}


@pytest.mark.asyncio
async def test_read_local_state_marca_las_lecciones_con_jobs(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await sembrar_job(db, "job1", "l1")

    local = await updater.read_local_state(db, MODULO)

    assert local.lesson_ids_con_jobs == frozenset({"l1"})


# ═══════════════════════════════ detalles ═══════════════════════════════════


@pytest.mark.asyncio
async def test_el_video_se_guarda_normalizado_y_no_parece_cambiar_cada_vez(app):
    """``bundle_guard`` valida el video pero NO lo normaliza (cambiar bytes
    antes de verificar el hash invalidaría el checksum). Normalizar es de aquí,
    y tiene que ocurrir: sin ello un bundle idéntico parecería revisado en cada
    actualización."""
    db = app.state.db
    corta = "https://youtu.be/MLkZGEMpriY?t=30"
    await instalar(app, paquete(con_quiz("l1", 1, video=corta), version=1))

    guardado = (await filas(db, "SELECT video_url FROM lessons"))[0]["video_url"]
    assert guardado == "https://www.youtube.com/watch?v=MLkZGEMpriY"

    informe = await actualizar(
        app, paquete(con_quiz("l1", 1, video=corta), version=2, titulo="Renombrado")
    )
    assert informe.lessons.unchanged == ["l1"]
    assert informe.lessons.updated == []


@pytest.mark.asyncio
async def test_las_recomendaciones_colgantes_se_conservan_en_la_fila(app):
    """El snapshot las poda para no enseñar un enlace roto; la columna guarda la
    lista completa, así que el enlace reaparece solo al instalar lo que faltaba."""
    db = app.state.db

    await instalar(
        app, paquete(con_quiz("l1", 1, recomendadas=("de-otro-modulo",)), version=1)
    )

    guardado = json.loads(
        (await filas(db, "SELECT recommended_json FROM lessons"))[0]["recommended_json"]
    )
    assert [r["lesson_id"] for r in guardado] == ["de-otro-modulo"]
    assert app.state.content.lesson("l1").recommended == ()


@pytest.mark.asyncio
async def test_el_informe_reparte_las_lecciones_sin_solaparlas(app):
    """``plan.updated`` incluye a las inalteradas para que el aplicador haga
    UPSERT de todo; el informe, que se lee como una partición, las resta."""
    db = app.state.db
    await instalar(
        app,
        paquete(con_quiz("l1", 1), con_quiz("l2", 2), con_quiz("l3", 3), version=1),
    )
    await sembrar_progreso(db, "l3", best=2)

    informe = await actualizar(
        app,
        paquete(
            con_quiz("l1", 1),
            con_quiz("l2", 2, markdown="# l2\n\nRevisada."),
            con_quiz("l4", 3),
            version=2,
        ),
    )

    lecciones = informe.lessons
    assert lecciones.added == ["l4"]
    assert lecciones.updated == ["l2"]  # l1 llegó idéntica ⇒ no cuenta como cambio
    assert lecciones.unchanged == ["l1"]
    assert lecciones.revised == ["l2"]
    assert lecciones.archived == ["l3"]
    grupos = [
        set(lecciones.added), set(lecciones.updated),
        set(lecciones.unchanged), set(lecciones.archived), set(lecciones.removed),
    ]
    for indice, grupo in enumerate(grupos):
        for otro in grupos[indice + 1:]:
            assert grupo.isdisjoint(otro)


@pytest.mark.asyncio
async def test_el_snapshot_se_cambia_solo_despues_del_commit(app):
    """CW-03: la memoria nunca se adelanta a la DB."""
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    antes = app.state.content

    await actualizar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=2))

    assert app.state.content is not antes
    assert app.state.content.lesson("l2") is not None


@pytest.mark.asyncio
async def test_un_json_corrupto_en_la_fila_no_tumba_la_lectura(app):
    """Un archivo SQLite copiado a medias es un caso real, no teórico.

    Los ``CHECK json_valid`` impiden ESCRIBIR una columna rota, así que aquí se
    desactivan a propósito para simular el archivo dañado. La lectura tiene que
    degradar a «lista vacía» y seguir: reventar con ``JSONDecodeError`` aquí
    sería un 500 en la cara del estudiante por un dato cosmético.
    """
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, recomendadas=("otra",)), version=1))
    await db.execute("PRAGMA ignore_check_constraints = ON")
    await db.execute("UPDATE lessons SET recommended_json = 'no soy json'")
    await db.execute("UPDATE lessons SET recommended_json = NULL WHERE id IS NULL")
    await db.commit()
    await db.execute("PRAGMA ignore_check_constraints = OFF")

    local = await updater.read_local_state(db, MODULO)

    assert local.lessons["l1"].recommended == ()


@pytest.mark.asyncio
async def test_un_intento_vacio_o_que_no_es_un_mapa_se_descarta(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    for attempt_id, respuestas in (("vacio", ""), ("texto", '"soy un string"')):
        await db.execute(
            "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total, "
            "passed) VALUES (?, 'l1', ?, 0, 2, 0)",
            (attempt_id, respuestas),
        )
    # Y uno legible con un valor no textual: se conserva, sin esa respuesta.
    await db.execute(
        "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total, passed) "
        "VALUES ('mixto', 'l1', '{\"l1-q1\": \"a\", \"l1-q2\": 7}', 1, 2, 0)"
    )
    await db.commit()

    local = await updater.read_local_state(db, MODULO)

    assert [dict(i.answers) for i in local.attempts["l1"]] == [{"l1-q1": "a"}]


@pytest.mark.asyncio
async def test_un_modulo_autorado_en_local_no_tiene_manifiesto_pero_si_version(app):
    """Sin fila en ``installed_modules`` la versión de referencia es la de
    ``modules``: es el caso del módulo que el docente creó aquí y sobre el que
    alguien intenta aplicar un bundle."""
    db = app.state.db
    await db.execute(
        "INSERT INTO modules (id, \"order\", title, description, level, origin, "
        "version, checksum) VALUES ('mio', 4, 'Mío', '', 'Básico', 'local', 3, ?)",
        ("c" * 64,),
    )
    await db.commit()

    local = await updater.read_local_state(db, "mio")

    assert (local.version, local.checksum, local.order) == (3, "c" * 64, 4)


@pytest.mark.asyncio
async def test_un_ejemplo_sin_leccion_no_bloquea_su_id(app):
    """Un ejemplo suelto no tiene módulo dueño, así que no puede ser una
    colisión de pertenencia: el UPSERT lo adopta sin quitarle nada a nadie."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    await db.execute(
        "INSERT INTO examples (id, lesson_id, filename, title, difficulty, "
        "teaches, threads_configurable, sweeps_threads, self_measures, "
        "parser_id, default_timeout_s, est_run_seconds, enabled, requires_gpu, "
        "expected_output_note, source_code) VALUES ('suelto', NULL, 'a.py', "
        "'A', 1, 't', 1, 0, 0, 'none', 30, 1, 1, 0, '', 'print(1)')"
    )
    await db.commit()

    local = await updater.read_local_state(db, MODULO)
    assert "suelto" not in local.example_owner

    await actualizar(
        app, paquete(con_quiz("l1", 1, ejemplo_=ejemplo("suelto")), version=2)
    )
    adoptado = (await filas(db, "SELECT * FROM examples WHERE id='suelto'"))[0]
    assert adoptado["lesson_id"] == "l1"


@pytest.mark.asyncio
async def test_si_el_objeto_se_reescribe_a_mitad_de_descarga_se_aborta(app):
    """``if_generation_match`` falla ⇒ lo que llegaría no es lo que el
    estudiante vio en pantalla: es un ``CHECKSUM_MISMATCH``, no un 500."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    antes = await volcado(db)
    app.state.catalog.publicar_modulo(
        MODULO, 2, paquete(con_quiz("l1", 1), version=2).raw, generation=99
    )

    with pytest.raises(ApiException) as excinfo:
        await updater.update_module(app, MODULO, to_version=2, generation=7)

    assert excinfo.value.code == "CHECKSUM_MISMATCH"
    assert excinfo.value.status_code == 409
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_quedarse_en_una_version_intermedia_no_apaga_el_chip(app):
    """``available_*`` es lo que vio el ÍNDICE, no lo que se acaba de instalar.

    Si el estudiante actualiza a la v3 teniendo la v5 publicada, machacar
    ``available_version`` con un 3 le diría «estás al día» sobre un módulo que
    sí tiene actualización pendiente.
    """
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    v5 = paquete(con_quiz("l1", 1), con_quiz("l5", 2), version=5)
    await repo_catalog.set_available_no_commit(
        db, MODULO, available_version=5, available_checksum=v5.checksum
    )
    await db.commit()

    await actualizar(app, paquete(con_quiz("l1", 1), con_quiz("l3", 2), version=3))

    manifiesto = await repo_catalog.get_installed(db, MODULO)
    assert manifiesto.installed_version == 3
    assert (manifiesto.available_version, manifiesto.available_checksum) == (
        5,
        v5.checksum,
    )


@pytest.mark.asyncio
async def test_comprobar_un_modulo_al_dia_tampoco_apaga_el_chip(app):
    db = app.state.db
    v1 = paquete(con_quiz("l1", 1), version=1)
    await instalar(app, v1)
    v4 = paquete(con_quiz("l1", 1), con_quiz("l4", 2), version=4)
    await repo_catalog.set_available_no_commit(
        db, MODULO, available_version=4, available_checksum=v4.checksum
    )
    await db.commit()

    informe = await actualizar(app, v1)

    assert informe.status == "up_to_date"
    manifiesto = await repo_catalog.get_installed(db, MODULO)
    assert manifiesto.available_version == 4


@pytest.mark.asyncio
async def test_al_ponerse_al_dia_el_chip_se_apaga(app):
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), version=1))
    v2 = paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=2)
    await repo_catalog.set_available_no_commit(
        db, MODULO, available_version=2, available_checksum=v2.checksum
    )
    await db.commit()

    await actualizar(app, v2)

    manifiesto = await repo_catalog.get_installed(db, MODULO)
    assert manifiesto.available_version == manifiesto.installed_version == 2


@pytest.mark.asyncio
async def test_la_nueva_puede_ocupar_el_hueco_de_la_que_se_archiva(app):
    """El índice único es PARCIAL (``WHERE archived_at IS NULL``) justo para esto:
    si la archivada siguiera ocupando su slot, archivar sería imposible."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)

    await actualizar(app, paquete(con_quiz("l1", 1), con_quiz("l3", 2), version=2))

    ubicacion = {
        fila["id"]: (fila["order"], fila["archived_at"] is not None)
        for fila in await filas(db, 'SELECT id, "order", archived_at FROM lessons')
    }
    assert ubicacion == {"l1": (1, False), "l2": (2, True), "l3": (2, False)}


@pytest.mark.asyncio
async def test_reclamar_una_pregunta_de_una_leccion_archivada_da_409(app):
    """``quiz_questions.id`` es PK global. Sin detectarlo antes de escribir esto
    saldría como ``IntegrityError`` a mitad de transacción, o sea un 500."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    await actualizar(app, paquete(con_quiz("l1", 1), version=2))  # l2 se archiva
    antes = await volcado(db)

    ladrona = leccion("nueva", 2, quiz_=quiz([pregunta("l2-q1", 1)]))
    with pytest.raises(ApiException) as excinfo:
        await actualizar(app, paquete(con_quiz("l1", 1), ladrona, version=3))

    assert excinfo.value.code == "DUPLICATE_ID"
    assert excinfo.value.details[0]["field"] == "question_id"
    assert await volcado(db) == antes


@pytest.mark.asyncio
async def test_el_ejemplo_de_una_leccion_archivada_puede_pasar_a_otra_viva(app):
    """Mismo módulo ⇒ no es robo, y el ``UNIQUE(lesson_id)`` obliga a soltar
    antes de escribir. Es el camino que más fácil revienta si el orden se cambia."""
    db = app.state.db
    await instalar(
        app,
        paquete(
            con_quiz("l1", 1, ejemplo_=ejemplo("ej-a")),
            con_quiz("l2", 2, ejemplo_=ejemplo("ej-b")),
            version=1,
        ),
    )
    await sembrar_progreso(db, "l2", best=2)

    await actualizar(
        app, paquete(con_quiz("l1", 1, ejemplo_=ejemplo("ej-b")), version=2)
    )

    pares = {
        fila["id"]: fila["lesson_id"]
        for fila in await filas(db, "SELECT id, lesson_id FROM examples")
    }
    assert pares == {"ej-b": "l1"}


@pytest.mark.asyncio
async def test_purge_no_desentierra_lo_que_ya_estaba_archivado(app):
    """Una lección archivada por una versión anterior ya salió del reparto: una
    actualización posterior con ``purge`` no vuelve a mirarla, y su avance
    sobrevive. Si no, cada ``purge`` sería una bomba retroactiva."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    await actualizar(app, paquete(con_quiz("l1", 1), version=2))

    informe = await actualizar(
        app,
        paquete(con_quiz("l1", 1, markdown="# l1\n\nOtra."), version=3),
        on_removed_lessons="purge",
    )

    assert informe.progress.lost == []
    assert await progreso_de(db, "l2") is not None
    assert await filas(db, "SELECT id FROM lessons WHERE id='l2'") != []


@pytest.mark.asyncio
async def test_borrar_una_leccion_recomendada_no_rompe_el_grafo(app):
    """El snapshot poda el enlace colgante; la columna guarda la lista entera,
    así que el enlace reaparece si una versión futura devuelve la lección."""
    db = app.state.db
    await instalar(
        app,
        paquete(
            con_quiz("l1", 1, recomendadas=("l2",)), con_quiz("l2", 2), version=1
        ),
    )

    await actualizar(
        app, paquete(con_quiz("l1", 1, recomendadas=("l2",)), version=2)
    )

    assert await filas(db, "SELECT id FROM lessons WHERE id='l2'") == []
    guardado = json.loads(
        (await filas(db, "SELECT recommended_json FROM lessons"))[0]["recommended_json"]
    )
    assert [r["lesson_id"] for r in guardado] == ["l2"]
    assert app.state.content.lesson("l1").recommended == ()


@pytest.mark.asyncio
async def test_el_aplicador_no_borra_avance_aunque_el_plan_venga_equivocado(app):
    """Defensa en profundidad: la política vive en un ``if``, no en la confianza.

    Con ``archive``, ``plan.removed`` solo contiene lecciones que nadie tocó, así
    que los DELETE de ``lesson_progress``/``quiz_attempts`` nunca tendrían nada
    que borrar y su ausencia sería invisible. Aquí se fuerza el plan
    EQUIVOCADO —una lección con avance metida en ``removed``— para comprobar
    que la barrera existe de verdad: la lección se va porque el plan lo pidió,
    su avance no. Y el canario ``lost`` lo dice en voz alta.
    """
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1), con_quiz("l2", 2), version=1))
    await sembrar_progreso(db, "l2", best=2)
    await sembrar_intento(db, "at1", "l2", {"l2-q1": "a"})
    siguiente = paquete(con_quiz("l1", 1), version=2)

    recogido = []
    async with app.state.write_lock:
        local = await updater.read_local_state(db, MODULO)
        plan = build_plan(local, siguiente.bundle)
        assert plan.archived == ["l2"]  # lo que el plan CORRECTO decide
        plan.archived.clear()
        plan.progress_ops.clear()
        plan.removed.append("l2")

        async def _escribir() -> None:
            recogido.append(
                await updater.apply_plan(
                    db, plan, siguiente.bundle, local,
                    object_path="modulos/m2/v2.json",
                )
            )

        await _persist(app, _escribir)

    assert await filas(db, "SELECT id FROM lessons WHERE id='l2'") == []
    assert await progreso_de(db, "l2") is not None
    assert len(await filas(db, "SELECT * FROM quiz_attempts")) == 1
    assert recogido[0].progress.lost == ["l2"]


@pytest.mark.asyncio
async def test_la_recalificacion_puede_BAJAR_la_nota(app):
    """El otro superpoder que el upsert normal no tiene: ``MAX`` dejaría el 2/2
    pegado para siempre aunque con la clave nueva el intento valga 0."""
    db = app.state.db
    await instalar(app, paquete(con_quiz("l1", 1, correcta="a"), version=1))
    await sembrar_progreso(db, "l1", best=2)
    await sembrar_intento(db, "at1", "l1", {"l1-q1": "a", "l1-q2": "a"})

    await actualizar(app, paquete(con_quiz("l1", 1, correcta="b"), version=2))

    progreso = await progreso_de(db, "l1")
    assert progreso["best_quiz_score"] == 0  # el upsert normal habría dejado 2
    assert progreso["completed"] == 1  # y el logro sigue sin revocarse
