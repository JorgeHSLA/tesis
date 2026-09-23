"""S2 · completitud por regla (diseño A) y una sola regla de disponibilidad.

Cada lección tiene UNA ``completion_rule`` y solo esa vía la completa:

* ``quiz``   — aprobar el quiz (la nota se guarda siempre, sea cual sea la regla);
* ``viewed`` — el estudiante la marca como leída (PUT §6.2);
* ``run``    — un job ``completed`` DEL EJEMPLO de esa lección.

Y una lección cuenta para el progreso solo si ``enabled and not archived``:
ni el quiz ni el job completan una lección deshabilitada o archivada, y las
archivadas salen de ``/modules`` (ids y totales).

Las 14 lecciones base son ``quiz``; aquí se cambian por el PUT admin solo
dentro de la DB en memoria del test.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.routers import admin
from app.services.content_state import reload_content

from conftest import build_app, wait_registry_empty, wait_terminal
from fakes.fake_docker import FakeDockerService, FakeExecution

LECCION = "spmd"  # su ejemplo pareado también es `spmd`
OTRO_EJEMPLO = "primerEjemplo"

_BASE = (
    "module_id", "order", "title", "estimated_minutes", "content_markdown",
    "video_url", "enabled", "completion_rule", "recommended",
)


@pytest.fixture
def docker() -> FakeDockerService:
    return FakeDockerService()


@pytest.fixture
def cliente(tmp_path, docker):
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
    app = build_app(settings=settings, docker=docker)
    app.include_router(admin.router)
    with TestClient(app) as c:
        yield c


def _ajustar(cliente, lesson_id: str, **cambios) -> None:
    """PUT admin con la lección completa y solo ``cambios`` distintos."""
    detalle = cliente.get(f"/api/v1/admin/lessons/{lesson_id}").json()["data"]
    cuerpo = {k: detalle[k] for k in _BASE} | cambios
    respuesta = cliente.put(f"/api/v1/admin/lessons/{lesson_id}", json=cuerpo)
    assert respuesta.status_code == 200, respuesta.text


def _archivar(cliente, lesson_id: str) -> None:
    app = cliente.app

    async def _hazlo() -> None:
        await app.state.db.execute(
            "UPDATE lessons SET archived_at='2026-09-22T00:00:00.000Z' WHERE id=?",
            (lesson_id,),
        )
        await app.state.db.commit()
        await reload_content(app)

    cliente.portal.call(_hazlo)


def _respuestas(cliente, lesson_id: str, correctas: bool = True) -> dict[str, str]:
    quiz = cliente.app.state.content.quiz(lesson_id)
    return {
        q.id: q.correct_key if correctas else next(
            o.key for o in q.options if o.key != q.correct_key
        )
        for q in quiz.questions
    }


def _progreso(cliente, lesson_id: str) -> dict | None:
    datos = cliente.get("/api/v1/progress").json()["data"]
    return datos["lessons"].get(lesson_id)


def _aprobar(cliente, lesson_id: str) -> dict:
    respuesta = cliente.post(
        f"/api/v1/lessons/{lesson_id}/quiz/attempts",
        json={"answers": _respuestas(cliente, lesson_id)},
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["data"]


def _job(cliente, docker, **cuerpo) -> dict:
    docker.queue_execution(FakeExecution(stdout=[b"ok\n"]))
    respuesta = cliente.post("/api/v1/jobs", json=cuerpo)
    assert respuesta.status_code == 202, respuesta.text
    job_id = respuesta.json()["data"]["job_id"]
    detalle = wait_terminal(cliente, job_id)
    wait_registry_empty(cliente.app, job_id)
    return detalle


# ─────────────────────────────── quiz ────────────────────────────────────────


def test_quiz_aprobado_en_leccion_quiz_completa(cliente):
    _aprobar(cliente, LECCION)
    progreso = _progreso(cliente, LECCION)
    assert progreso["completed"] is True
    assert progreso["completed_via"] == "quiz"


def test_quiz_aprobado_en_leccion_run_no_completa_pero_guarda_nota(cliente):
    _ajustar(cliente, LECCION, completion_rule="run")
    resultado = _aprobar(cliente, LECCION)
    assert resultado["passed"] is True  # el intento sí aprueba
    progreso = _progreso(cliente, LECCION)
    assert progreso["completed"] is False
    assert progreso["completed_via"] is None
    assert progreso["best_quiz_score"] == resultado["total"]


def test_quiz_aprobado_en_leccion_viewed_no_completa(cliente):
    _ajustar(cliente, LECCION, completion_rule="viewed")
    _aprobar(cliente, LECCION)
    assert _progreso(cliente, LECCION)["completed"] is False


def test_quiz_de_leccion_deshabilitada_no_completa(cliente):
    _ajustar(cliente, LECCION, enabled=False)
    _aprobar(cliente, LECCION)
    progreso = _progreso(cliente, LECCION)
    assert progreso["completed"] is False
    assert progreso["best_quiz_score"] is not None


def test_quiz_de_leccion_archivada_no_completa(cliente):
    _archivar(cliente, LECCION)
    _aprobar(cliente, LECCION)
    assert _progreso(cliente, LECCION)["completed"] is False


# ─────────────────────────────── run ─────────────────────────────────────────


def test_job_completed_del_ejemplo_de_la_leccion_run_completa(cliente, docker):
    _ajustar(cliente, LECCION, completion_rule="run")
    detalle = _job(cliente, docker, example_id=LECCION, lesson_id=LECCION)
    assert detalle["status"] == "completed"
    progreso = _progreso(cliente, LECCION)
    assert progreso["completed"] is True
    assert progreso["completed_via"] == "run"
    assert progreso["last_job_id"] == detalle["job_id"]


def test_job_de_leccion_quiz_no_completa(cliente, docker):
    detalle = _job(cliente, docker, example_id=LECCION, lesson_id=LECCION)
    progreso = _progreso(cliente, LECCION)
    assert progreso["completed"] is False
    assert progreso["last_job_id"] == detalle["job_id"]


def test_job_sin_ejemplo_no_completa_leccion_run(cliente, docker):
    _ajustar(cliente, LECCION, completion_rule="run")
    _job(cliente, docker, code="print(1)\n", lesson_id=LECCION)
    progreso = _progreso(cliente, LECCION)
    assert progreso is None or progreso["completed"] is False


def test_job_con_otro_ejemplo_se_rechaza(cliente, docker):
    """BL-22: ``lesson_id`` debe corresponder al ejemplo que se ejecuta."""
    _ajustar(cliente, LECCION, completion_rule="run")
    respuesta = cliente.post(
        "/api/v1/jobs", json={"example_id": OTRO_EJEMPLO, "lesson_id": LECCION}
    )
    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["error"]["code"] == "VALIDATION_ERROR"
    assert _progreso(cliente, LECCION) is None


def test_job_fallido_no_completa_leccion_run(cliente, docker):
    _ajustar(cliente, LECCION, completion_rule="run")
    docker.queue_execution(FakeExecution(stdout=[b"boom\n"], exit_code=1))
    respuesta = cliente.post(
        "/api/v1/jobs", json={"example_id": LECCION, "lesson_id": LECCION}
    )
    job_id = respuesta.json()["data"]["job_id"]
    assert wait_terminal(cliente, job_id)["status"] == "failed"
    wait_registry_empty(cliente.app, job_id)
    progreso = _progreso(cliente, LECCION)
    assert progreso is None or progreso["completed"] is False


def test_job_de_leccion_run_deshabilitada_no_completa(cliente, docker):
    _ajustar(cliente, LECCION, completion_rule="run", enabled=False)
    _job(cliente, docker, example_id=LECCION, lesson_id=LECCION)
    assert _progreso(cliente, LECCION)["completed"] is False


def test_prueba_admin_sin_lesson_id_no_toca_progreso(cliente, docker):
    """CU-22.2: la prueba desde Autoría ejecuta el ejemplo sin ``lesson_id``."""
    _ajustar(cliente, LECCION, completion_rule="run")
    _job(cliente, docker, example_id=LECCION)
    assert _progreso(cliente, LECCION) is None


# ─────────────────────────────── viewed y monotonía ─────────────────────────


def test_viewed_marcada_como_leida_completa(cliente):
    _ajustar(cliente, LECCION, completion_rule="viewed")
    respuesta = cliente.put(
        f"/api/v1/progress/lessons/{LECCION}", json={"viewed": True, "completed": True}
    )
    assert respuesta.status_code == 200, respuesta.text
    progreso = _progreso(cliente, LECCION)
    assert progreso["completed"] is True and progreso["viewed"] is True


def test_completed_es_monotono(cliente, docker):
    """Completada por quiz, un quiz suspendido o un job después no la bajan."""
    _aprobar(cliente, LECCION)
    cliente.post(
        f"/api/v1/lessons/{LECCION}/quiz/attempts",
        json={"answers": _respuestas(cliente, LECCION, correctas=False)},
    )
    _ajustar(cliente, LECCION, completion_rule="run")
    _job(cliente, docker, code="print(1)\n", lesson_id=LECCION)
    progreso = _progreso(cliente, LECCION)
    assert progreso["completed"] is True
    assert progreso["completed_via"] == "quiz"


# ─────────────────────────── disponibilidad en /modules ─────────────────────


def _modulo_de(datos: dict, lesson_id: str) -> dict:
    return next(
        m for m in datos["modules"] if any(l["id"] == lesson_id for l in m["lessons"])
    )


def test_modules_excluye_archivadas_de_lecciones_y_totales(cliente):
    antes = cliente.get("/api/v1/modules").json()["data"]
    modulo = _modulo_de(antes, LECCION)
    _archivar(cliente, LECCION)
    despues = cliente.get("/api/v1/modules").json()["data"]
    ids = [l["id"] for m in despues["modules"] for l in m["lessons"]]
    assert LECCION not in ids
    mismo = next(m for m in despues["modules"] if m["id"] == modulo["id"])
    assert len(mismo["lessons"]) == len(modulo["lessons"]) - 1
    assert despues["summary"]["lessons_total"] == antes["summary"]["lessons_total"] - 1
    assert (
        despues["summary"]["lessons_enabled"] == antes["summary"]["lessons_enabled"] - 1
    )
    # sigue siendo legible por URL, con el aviso de archivada
    leccion = cliente.get(f"/api/v1/lessons/{LECCION}").json()["data"]
    assert leccion["archived"] is True


def test_modules_no_cuenta_completada_archivada(cliente):
    _aprobar(cliente, LECCION)
    antes = cliente.get("/api/v1/modules").json()["data"]["summary"]
    _archivar(cliente, LECCION)
    despues = cliente.get("/api/v1/modules").json()["data"]["summary"]
    assert despues["lessons_completed"] == antes["lessons_completed"] - 1
    progreso = cliente.get("/api/v1/progress").json()["data"]["summary"]
    assert progreso["lessons_completed"] == despues["lessons_completed"]
    assert progreso["lessons_enabled"] == despues["lessons_enabled"]
