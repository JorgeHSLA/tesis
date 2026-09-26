"""S7a · CU-16.1/16.2 — borrar un módulo junto con sus lecciones.

``DELETE /admin/modules/{id}?cascade=true`` (enmienda ADITIVA, §10.2) borra el
módulo y todas sus lecciones —ejemplo, quiz, progreso e intentos— en UNA sola
transacción, reutilizando ``delete_lesson``. Sin el parámetro sigue el
``409 MODULE_NOT_EMPTY``. Las lecciones archivadas no cuentan como contenido:
no bloquean el borrado, pero su rastro se purga igual.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.repositories import content_admin
from app.routers import admin
from app.services.content_state import reload_content

from conftest import build_app
from fakes.fake_docker import FakeDockerService

MODULO = "mBorrar"


@pytest.fixture
def cliente(tmp_path):
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
    with TestClient(app) as c:
        yield c


def _crear_modulo(cliente) -> None:
    r = cliente.post(
        "/api/v1/admin/modules",
        json={"id": MODULO, "order": 90, "title": "Para borrar", "description": "", "level": "Intro"},
    )
    assert r.status_code == 201, r.text


def _crear_leccion(cliente, lid: str, order: int, *, con_ejemplo: bool = True) -> None:
    cuerpo = {
        "id": lid,
        "module_id": MODULO,
        "order": order,
        "title": f"Lección {lid}",
        "estimated_minutes": 5,
        "content_markdown": "# Hola",
        "recommended": [],
        "completion_rule": "run" if con_ejemplo else "viewed",
        "example": None,
        "source_code": None,
    }
    if con_ejemplo:
        cuerpo["example"] = {
            "title": "Ej", "filename": "ej.py", "difficulty": 1, "teaches": "algo",
            "directives": [], "threads_configurable": True, "fixed_threads": None,
            "fixed_threads_note": None, "sweeps_threads": False, "self_measures": False,
            "parser_id": "none", "default_timeout_s": 30, "est_run_seconds": 3,
            "enabled": True, "requires_gpu": False, "expected_output_note": "",
            "takeaways": ["x"],
        }
        cuerpo["source_code"] = "print(1)\n"
    r = cliente.post("/api/v1/admin/lessons", json=cuerpo)
    assert r.status_code == 201, r.text


def _poner_quiz(cliente, lid: str) -> None:
    r = cliente.put(
        f"/api/v1/admin/lessons/{lid}/quiz",
        json={
            "pass_threshold": 0.6,
            "questions": [{
                "id": f"{lid}-q1", "order": 1, "text": "¿Sí?",
                "options": [{"key": "a", "text": "A"}, {"key": "b", "text": "B"}],
                "correct_key": "a", "explanation": "Porque sí.",
            }],
        },
    )
    assert r.status_code == 200, r.text


def _sql(cliente, sql: str, params: tuple = ()) -> list:
    app = cliente.app

    async def _hazlo() -> list:
        cur = await app.state.db.execute(sql, params)
        filas = list(await cur.fetchall())
        await app.state.db.commit()
        return filas

    return cliente.portal.call(_hazlo)


def _archivar(cliente, lid: str) -> None:
    _sql(cliente, "UPDATE lessons SET archived_at='2026-09-22T00:00:00.000Z' WHERE id=?", (lid,))
    cliente.portal.call(reload_content, cliente.app)


def _cuenta(cliente, tabla: str, columna: str, valor: str) -> int:
    return _sql(cliente, f"SELECT COUNT(*) FROM {tabla} WHERE {columna} = ?", (valor,))[0][0]


def _ids_modulos(cliente) -> list[str]:
    return [m["id"] for m in cliente.get("/api/v1/admin/modules").json()["data"]["modules"]]


def test_sin_cascade_un_modulo_con_lecciones_sigue_dando_409(cliente):
    _crear_modulo(cliente)
    _crear_leccion(cliente, "lA", 1)
    for url in (f"/api/v1/admin/modules/{MODULO}", f"/api/v1/admin/modules/{MODULO}?cascade=false"):
        r = cliente.delete(url)
        assert r.status_code == 409, r.text
        assert r.json()["error"]["code"] == "MODULE_NOT_EMPTY"
    assert MODULO in _ids_modulos(cliente)


def test_cascade_borra_modulo_lecciones_y_su_rastro(cliente):
    _crear_modulo(cliente)
    _crear_leccion(cliente, "lA", 1)
    _crear_leccion(cliente, "lB", 2, con_ejemplo=False)
    _poner_quiz(cliente, "lA")
    assert cliente.put("/api/v1/progress/lessons/lB", json={"viewed": True, "completed": True}).status_code == 200
    _sql(
        cliente,
        "INSERT INTO quiz_attempts (id, lesson_id, answers, score, total, passed) "
        "VALUES ('intento1', 'lA', '{}', 1, 1, 1)",
    )

    r = cliente.delete(f"/api/v1/admin/modules/{MODULO}?cascade=true")

    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"deleted": True, "id": MODULO}
    assert MODULO not in _ids_modulos(cliente)
    for lid in ("lA", "lB"):
        assert cliente.get(f"/api/v1/admin/lessons/{lid}").status_code == 404
        assert _cuenta(cliente, "lesson_progress", "lesson_id", lid) == 0
        assert _cuenta(cliente, "quiz_attempts", "lesson_id", lid) == 0
    assert _cuenta(cliente, "examples", "lesson_id", "lA") == 0
    assert _cuenta(cliente, "quiz_questions", "lesson_id", "lA") == 0
    # El contenido en memoria (lo que ve /modules) ya no lo tiene.
    publicos = [m["id"] for m in cliente.get("/api/v1/modules").json()["data"]["modules"]]
    assert MODULO not in publicos


def test_las_archivadas_no_bloquean_y_se_purgan(cliente):
    _crear_modulo(cliente)
    _crear_leccion(cliente, "lViejo", 1, con_ejemplo=False)
    assert cliente.put("/api/v1/progress/lessons/lViejo", json={"viewed": True}).status_code == 200
    _archivar(cliente, "lViejo")

    r = cliente.delete(f"/api/v1/admin/modules/{MODULO}")

    assert r.status_code == 200, r.text
    assert MODULO not in _ids_modulos(cliente)
    assert _cuenta(cliente, "lessons", "id", "lViejo") == 0
    assert _cuenta(cliente, "lesson_progress", "lesson_id", "lViejo") == 0


def test_cascade_es_atomico_si_falla_a_mitad(cliente, monkeypatch):
    _crear_modulo(cliente)
    _crear_leccion(cliente, "lA", 1)
    _crear_leccion(cliente, "lB", 2)
    original = content_admin.delete_lesson
    llamadas = {"n": 0}

    async def _falla_en_la_segunda(db, lesson_id):
        llamadas["n"] += 1
        if llamadas["n"] == 2:
            raise RuntimeError("fallo simulado")
        await original(db, lesson_id)

    monkeypatch.setattr(content_admin, "delete_lesson", _falla_en_la_segunda)

    r = cliente.delete(f"/api/v1/admin/modules/{MODULO}?cascade=true")

    assert r.status_code == 500, r.text
    assert MODULO in _ids_modulos(cliente)
    assert _cuenta(cliente, "lessons", "module_id", MODULO) == 2


def test_cascade_sobre_un_modulo_inexistente_da_404(cliente):
    r = cliente.delete("/api/v1/admin/modules/noExiste?cascade=true")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "MODULE_NOT_FOUND"


def test_cascade_con_vivas_y_archivadas_purga_todas(cliente):
    _crear_modulo(cliente)
    _crear_leccion(cliente, "lViva", 1)
    _crear_leccion(cliente, "lVieja", 2, con_ejemplo=False)
    assert cliente.put("/api/v1/progress/lessons/lVieja", json={"viewed": True}).status_code == 200
    _archivar(cliente, "lVieja")

    r = cliente.delete(f"/api/v1/admin/modules/{MODULO}?cascade=true")

    assert r.status_code == 200, r.text
    assert _cuenta(cliente, "lessons", "module_id", MODULO) == 0
    assert _cuenta(cliente, "lesson_progress", "lesson_id", "lVieja") == 0


def test_un_cascade_invalido_da_422_y_no_borra(cliente):
    _crear_modulo(cliente)
    r = cliente.delete(f"/api/v1/admin/modules/{MODULO}?cascade=quizas")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert MODULO in _ids_modulos(cliente)
