"""E1 — una lección puede no tener código, y el ejemplo es un recurso propio.

El acoplamiento 1:1 de Fase 4 (`examples.id PK REFERENCES lessons(id)`) hacía
irrepresentable la lección conceptual: la que explica qué es un hilo, o por qué
existe el multicore, antes de que haya un `parallel for` que ejecutar. Por eso
las 23 lecciones de fundamentos ya escritas vivían fuera de la aplicación.

Aquí se prueba el camino de escritura completo: crear sin ejemplo, leerla sin
404, añadirle código después y quitárselo — y que el progreso del estudiante
sobreviva a todo eso, que es lo que antes obligaba a borrar y recrear.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.routers import admin

from conftest import build_app
from fakes.fake_docker import FakeDockerService


@pytest.fixture
def admin_client(tmp_path):
    settings = Settings(
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
    )
    app = build_app(settings=settings, docker=FakeDockerService())
    app.include_router(admin.router)
    with TestClient(app) as cliente:
        yield cliente


EJEMPLO = {
    "filename": "hilos.py",
    "title": "Ejemplo",
    "difficulty": 1,
    "teaches": "identidad de hilo",
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
    "expected_output_note": "8 líneas",
    "takeaways": ["los hilos comparten memoria"],
}


def _modulo(cliente, mid="mF1", order=201):
    respuesta = cliente.post(
        "/api/v1/admin/modules",
        json={
            "id": mid,
            "order": order,
            "title": "Fundamentos de paralelismo",
            "description": "Track conceptual previo a OpenMP",
            "level": "Básico",
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return mid


def _teorica(cliente, module_id, lesson_id="queEsUnHilo", **extra):
    cuerpo = {
        "id": lesson_id,
        "module_id": module_id,
        "order": 1,
        "title": "¿Qué es un hilo?",
        "estimated_minutes": 5,
        "content_markdown": "# ¿Qué es un hilo?\n\nUna unidad de ejecución.",
        "recommended": [],
        "completion_rule": "viewed",
    }
    cuerpo.update(extra)
    return cliente.post("/api/v1/admin/lessons", json=cuerpo)


# ─────────────────────────── crear sin ejemplo ───────────────────────────────


def test_crear_una_leccion_conceptual_sin_codigo(admin_client):
    modulo = _modulo(admin_client)
    respuesta = _teorica(admin_client, modulo)

    assert respuesta.status_code == 201, respuesta.text
    datos = respuesta.json()["data"]
    assert datos["example"] is None
    assert datos["completion_rule"] == "viewed"
    assert datos["enabled"] is True, "sin ejemplo, pero habilitada (E4)"


def test_leerla_devuelve_200_no_404(admin_client):
    """Antes, no encontrar el ejemplo se trataba como grafo roto → 404."""
    modulo = _modulo(admin_client)
    assert _teorica(admin_client, modulo).status_code == 201

    respuesta = admin_client.get("/api/v1/admin/lessons/queEsUnHilo")
    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["data"]["example"] is None


def test_el_estudiante_la_ve_con_example_id_nulo(admin_client):
    modulo = _modulo(admin_client)
    assert _teorica(admin_client, modulo).status_code == 201

    leccion = admin_client.get("/api/v1/lessons/queEsUnHilo").json()["data"]
    assert leccion["example_id"] is None
    assert leccion["has_quiz"] is False
    assert leccion["completion_rule"] == "viewed"


def test_ejemplo_y_codigo_van_juntos_o_no_van(admin_client):
    """Mandar uno solo es una petición a medias, no una lección conceptual."""
    modulo = _modulo(admin_client)
    respuesta = _teorica(admin_client, modulo, lesson_id="aMedias", example=EJEMPLO)
    assert respuesta.status_code == 422
    campos = {d["field"] for d in respuesta.json()["error"]["details"]}
    assert "source_code" in campos


# ─────────────────── el ejemplo como recurso propio ──────────────────────────


def test_anadir_y_quitar_el_ejemplo_sin_tocar_la_leccion(admin_client):
    modulo = _modulo(admin_client)
    assert _teorica(admin_client, modulo).status_code == 201

    puesto = admin_client.post(
        "/api/v1/admin/lessons/queEsUnHilo/example",
        json={"example": EJEMPLO, "source_code": "print('hola')\n"},
    )
    assert puesto.status_code == 200, puesto.text
    assert puesto.json()["data"]["lesson_id"] == "queEsUnHilo"

    detalle = admin_client.get("/api/v1/admin/lessons/queEsUnHilo").json()["data"]
    assert detalle["example"] is not None

    quitado = admin_client.delete("/api/v1/admin/lessons/queEsUnHilo/example")
    assert quitado.status_code == 200, quitado.text

    detalle = admin_client.get("/api/v1/admin/lessons/queEsUnHilo").json()["data"]
    assert detalle["example"] is None, "vuelve a ser conceptual"
    assert detalle["title"] == "¿Qué es un hilo?", "la lección no se tocó"


def test_quitar_el_ejemplo_conserva_el_progreso_del_estudiante(admin_client):
    """La razón de que el ejemplo sea recurso propio.

    Antes, convertir una lección práctica en conceptual exigía borrarla y
    recrearla — y `DELETE /admin/lessons/{id}` purga `lesson_progress` y
    `quiz_attempts` por diseño (BL-01). El avance se perdía por un cambio
    editorial que no tenía nada que ver con el estudiante.
    """
    modulo = _modulo(admin_client)
    assert _teorica(admin_client, modulo).status_code == 201
    assert admin_client.post(
        "/api/v1/admin/lessons/queEsUnHilo/example",
        json={"example": EJEMPLO, "source_code": "print('hola')\n"},
    ).status_code == 200

    marcado = admin_client.put(
        "/api/v1/progress/lessons/queEsUnHilo", json={"viewed": True, "completed": True}
    )
    assert marcado.status_code == 200, marcado.text

    assert admin_client.delete(
        "/api/v1/admin/lessons/queEsUnHilo/example"
    ).status_code == 200

    progreso = admin_client.get("/api/v1/progress").json()["data"]["lessons"]
    assert progreso["queEsUnHilo"]["completed"] is True
    assert progreso["queEsUnHilo"]["viewed"] is True


def test_no_se_puede_poner_dos_ejemplos_a_la_misma_leccion(admin_client):
    modulo = _modulo(admin_client)
    assert _teorica(admin_client, modulo).status_code == 201
    cuerpo = {"example": EJEMPLO, "source_code": "print('hola')\n"}
    assert admin_client.post(
        "/api/v1/admin/lessons/queEsUnHilo/example", json=cuerpo
    ).status_code == 200

    segundo = admin_client.post(
        "/api/v1/admin/lessons/queEsUnHilo/example", json=cuerpo
    )
    assert segundo.status_code == 409
    assert segundo.json()["error"]["code"] == "DUPLICATE_ID"


def test_quitar_un_ejemplo_que_no_existe_es_404(admin_client):
    modulo = _modulo(admin_client)
    assert _teorica(admin_client, modulo).status_code == 201
    respuesta = admin_client.delete("/api/v1/admin/lessons/queEsUnHilo/example")
    assert respuesta.status_code == 404
    assert respuesta.json()["error"]["code"] == "EXAMPLE_NOT_FOUND"


# ────────────────────────── completion_rule (E4) ─────────────────────────────


def test_run_sin_ejemplo_se_rechaza(admin_client):
    """Decir «se completa ejecutándola» sin nada que ejecutar es incoherente."""
    modulo = _modulo(admin_client)
    respuesta = _teorica(
        admin_client, modulo, lesson_id="soloTeoria", completion_rule="run"
    )
    assert respuesta.status_code == 422
    detalles = respuesta.json()["error"]["details"]
    assert any(d["field"] == "completion_rule" for d in detalles)


def test_quiz_sin_quiz_no_bloquea_la_autoria(admin_client):
    """Es el estado NORMAL: la lección nace sin quiz y el quiz se añade después."""
    modulo = _modulo(admin_client)
    respuesta = _teorica(
        admin_client, modulo, lesson_id="conQuizFuturo", completion_rule="quiz"
    )
    assert respuesta.status_code == 201, respuesta.text
