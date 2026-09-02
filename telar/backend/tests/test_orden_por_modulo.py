"""E2 — el ``order`` de lección es único POR MÓDULO, no global.

Con el ``UNIQUE`` global de Fase 4, dos módulos no podían tener cada uno su
lección 1, y anteponer un módulo obligaba a renumerar el curso entero. Eso
convertía «publicar un módulo nuevo» en una operación que tocaba todo el
catálogo, y con ella la actualización se volvía frágil: el ancla del progreso es
el ``lesson_id``, pero el `order` bailando en cascada hace imposible razonar
sobre qué cambió.

Aquí se fija el camino de ESCRITURA (el de lectura vive en test_migration5.py).
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
    """App de integración con el router admin montado (mismo patrón que
    ``test_admin_content``: el modo admin es una variante de DESPLIEGUE)."""
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
        yield cliente, {}   # modo admin por despliegue ⇒ sin header


def _modulo(cliente, admin, module_id: str, order: int) -> None:
    respuesta = cliente.post(
        "/api/v1/admin/modules",
        json={
            "id": module_id,
            "order": order,
            "title": f"Módulo {module_id}",
            "description": "d",
            "level": "Básico",
        },
        headers=admin,
    )
    assert respuesta.status_code == 201, respuesta.text


def _leccion(cliente, admin, lesson_id: str, module_id: str, order: int):
    return cliente.post(
        "/api/v1/admin/lessons",
        json={
            "id": lesson_id,
            "module_id": module_id,
            "order": order,
            "title": f"Lección {lesson_id}",
            "estimated_minutes": 10,
            "content_markdown": "# Contenido\n\nUn párrafo.",
            "recommended": [],
            "source_code": "print('hola')\n",
            "example": {
                "filename": f"{lesson_id}.py",
                "title": f"Ejemplo {lesson_id}",
                "difficulty": 1,
                "teaches": "t",
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
                "expected_output_note": "hola",
                "takeaways": ["algo"],
            },
        },
        headers=admin,
    )


def test_dos_modulos_pueden_tener_cada_uno_su_leccion_1(admin_client):
    """El caso que la Fase 4 rechazaba con 409 y que bloqueaba anteponer módulos."""
    cliente, admin = admin_client
    _modulo(cliente, admin, "mA", 101)
    _modulo(cliente, admin, "mB", 102)

    primera = _leccion(cliente, admin, "lA1", "mA", 1)
    segunda = _leccion(cliente, admin, "lB1", "mB", 1)

    assert primera.status_code == 201, primera.text
    assert segunda.status_code == 201, segunda.text


def test_el_mismo_order_dentro_del_mismo_modulo_sigue_siendo_409(admin_client):
    cliente, admin = admin_client
    _modulo(cliente, admin, "mC", 103)
    assert _leccion(cliente, admin, "lC1", "mC", 1).status_code == 201

    choque = _leccion(cliente, admin, "lC2", "mC", 1)
    assert choque.status_code == 409
    assert choque.json()["error"]["code"] == "ORDER_CONFLICT"


def test_mover_una_leccion_a_otro_modulo_libera_su_order(admin_client):
    """Editar la lección la mueve; el hueco que deja queda disponible."""
    cliente, admin = admin_client
    _modulo(cliente, admin, "mD", 104)
    _modulo(cliente, admin, "mE", 105)
    assert _leccion(cliente, admin, "lD1", "mD", 1).status_code == 201

    detalle = cliente.get("/api/v1/admin/lessons/lD1", headers=admin).json()["data"]
    movida = cliente.put(
        "/api/v1/admin/lessons/lD1",
        json={
            "module_id": "mE",
            "order": 1,
            "title": detalle["title"],
            "estimated_minutes": detalle["estimated_minutes"],
            "content_markdown": detalle["content_markdown"],
            "recommended": [],
        },
        headers=admin,
    )
    assert movida.status_code == 200, movida.text
    assert movida.json()["data"]["module_id"] == "mE"

    # El order 1 de mD quedó libre: otra lección puede ocuparlo.
    assert _leccion(cliente, admin, "lD2", "mD", 1).status_code == 201


def test_reorder_sin_module_id_sigue_valiendo(admin_client):
    """Compatibilidad: el payload de Fase 4 no traía `module_id`."""
    cliente, admin = admin_client
    _modulo(cliente, admin, "mF", 106)
    assert _leccion(cliente, admin, "lF1", "mF", 1).status_code == 201
    assert _leccion(cliente, admin, "lF2", "mF", 2).status_code == 201

    intercambio = cliente.put(
        "/api/v1/admin/lessons/reorder",
        json={"items": [{"id": "lF1", "order": 2}, {"id": "lF2", "order": 1}]},
        headers=admin,
    )
    assert intercambio.status_code == 200, intercambio.text

    modulos = {m["id"]: m for m in intercambio.json()["data"]["modules"]}
    ordenes = {l["id"]: l["order"] for l in modulos["mF"]["lessons"]}
    assert ordenes == {"lF1": 2, "lF2": 1}


def test_reorder_con_module_id_mueve_la_leccion(admin_client):
    """Enviar `module_id` en el item es la vía por lote para mover de módulo."""
    cliente, admin = admin_client
    _modulo(cliente, admin, "mG", 107)
    _modulo(cliente, admin, "mH", 108)
    assert _leccion(cliente, admin, "lG1", "mG", 1).status_code == 201

    respuesta = cliente.put(
        "/api/v1/admin/lessons/reorder",
        json={"items": [{"id": "lG1", "order": 1, "module_id": "mH"}]},
        headers=admin,
    )
    assert respuesta.status_code == 200, respuesta.text

    modulos = {m["id"]: m for m in respuesta.json()["data"]["modules"]}
    assert [l["id"] for l in modulos["mH"]["lessons"]] == ["lG1"]
    assert modulos["mG"]["lessons"] == []


def test_reorder_que_deja_dos_lecciones_iguales_en_un_modulo_es_409(admin_client):
    cliente, admin = admin_client
    _modulo(cliente, admin, "mI", 109)
    assert _leccion(cliente, admin, "lI1", "mI", 1).status_code == 201
    assert _leccion(cliente, admin, "lI2", "mI", 2).status_code == 201

    respuesta = cliente.put(
        "/api/v1/admin/lessons/reorder",
        json={"items": [{"id": "lI1", "order": 2}]},  # lI2 ya tiene el 2
        headers=admin,
    )
    assert respuesta.status_code == 409
    assert respuesta.json()["error"]["code"] == "ORDER_CONFLICT"
