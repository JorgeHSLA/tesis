"""Regresión de los hallazgos CONFIRMADOS en la review de Fase 4 + E2E.

- **CW-02**: un id de pregunta ya usado por OTRA lección se rechaza con
  ``422 CONTENT_VALIDATION_ERROR`` limpio (no ``IntegrityError`` 500).
- **CW-01**: una mutación rechazada NO deja estado parcial en la conexión
  compartida; una escritura posterior no relacionada sigue funcionando.
- **C2**: la incoherencia del ejemplo al crear una lección lleva el campo
  ``example.<campo>`` (el editor de lección ancla el hint bajo el control).
- **E2E**: modo admin habilitado por despliegue → crear módulo + lección
  (+ejemplo) + quiz + subir ``.py`` → aparece en el catálogo del estudiante (GET
  públicos, con el quiz público SIN ``correct_key``) y corre en el simulador
  (runner fake) con el código del admin.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from conftest import wait_terminal
from test_admin_content import (
    _create_lesson,
    _create_module,
    _example_base,
    _lesson_payload,
    _make_app,
    _quiz_payload,
)


@pytest.fixture
def app(tmp_path):
    return _make_app(tmp_path)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth(client):
    """Modo admin habilitado por despliegue ⇒ no hay header de autorización."""
    return {}


# ── CW-02: id de pregunta global colisionando entre lecciones → 422, no 500 ──


def test_cw02_pregunta_id_de_otra_leccion_es_422(client, auth):
    _create_module(client, auth, mid="mReg", order=91)
    _create_lesson(client, auth, lid="lRegA", module_id="mReg", order=91)
    _create_lesson(client, auth, lid="lRegB", module_id="mReg", order=92)

    q1 = _quiz_payload(lesson_id="lRegA")
    q1["questions"][0]["id"] = "shared-q1"
    assert (
        client.put("/api/v1/admin/lessons/lRegA/quiz", json=q1, headers=auth).status_code
        == 200
    )

    q2 = _quiz_payload(lesson_id="lRegB")
    q2["questions"][0]["id"] = "shared-q1"  # id ya usado por lRegA
    r2 = client.put("/api/v1/admin/lessons/lRegB/quiz", json=q2, headers=auth)
    assert r2.status_code == 422, r2.text
    assert r2.json()["error"]["code"] == "CONTENT_VALIDATION_ERROR"

    # lRegA conserva su quiz intacto (la transacción fallida no lo tocó).
    got = client.get("/api/v1/admin/lessons/lRegA/quiz", headers=auth)
    assert got.status_code == 200
    assert got.json()["data"]["questions"][0]["id"] == "shared-q1"


# ── CW-01: una mutación rechazada no deja transacción parcial pendiente ──


def test_cw01_mutacion_rechazada_no_deja_estado_parcial(client, auth):
    _create_module(client, auth, mid="mReg2", order=93)
    _create_lesson(client, auth, lid="lReg2", module_id="mReg2", order=93)
    _create_lesson(client, auth, lid="lReg3", module_id="mReg2", order=94)

    q = _quiz_payload(lesson_id="lReg2")
    q["questions"][0]["id"] = "dup-q1"
    assert (
        client.put("/api/v1/admin/lessons/lReg2/quiz", json=q, headers=auth).status_code
        == 200
    )

    q_bad = _quiz_payload(lesson_id="lReg3")
    q_bad["questions"][0]["id"] = "dup-q1"  # rechazado (id global en uso)
    assert (
        client.put("/api/v1/admin/lessons/lReg3/quiz", json=q_bad, headers=auth).status_code
        == 422
    )

    # lReg3 sigue SIN quiz (nada quedó a medias) …
    got = client.get("/api/v1/admin/lessons/lReg3/quiz", headers=auth)
    assert got.status_code == 404
    assert got.json()["error"]["code"] == "QUIZ_NOT_FOUND"

    # … y una escritura posterior NO relacionada funciona (conexión limpia).
    ok = client.put(
        "/api/v1/admin/lessons/lReg3/quiz",
        json=_quiz_payload(lesson_id="lReg3"),
        headers=auth,
    )
    assert ok.status_code == 200, ok.text


# ── C2: incoherencia del ejemplo al crear lección → field 'example.fixed_threads' ──


def test_c2_incoherencia_ejemplo_lleva_prefijo_example(client, auth):
    _create_module(client, auth, mid="mReg4", order=95)
    payload = _lesson_payload(lid="lReg4", module_id="mReg4", order=95)
    # threads_configurable=True + fixed_threads=4 es incoherente (§10.6).
    payload["example"] = _example_base(threads_configurable=True, fixed_threads=4)
    r = client.post("/api/v1/admin/lessons", json=payload, headers=auth)
    assert r.status_code == 422, r.text
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert "example.fixed_threads" in fields, fields


# ── E2E: modo admin → crear contenido → el estudiante lo ve y lo ejecuta ──


def test_e2e_admin_crea_estudiante_ve_y_corre(client):
    auth = {}  # modo admin habilitado por despliegue (TELAR_ADMIN_MODE)

    _create_module(client, auth, mid="mE2E", order=96, title="Módulo E2E")
    code = "# ejemplo creado por el admin\nprint('desde el admin')\n"
    _create_lesson(
        client,
        auth,
        lid="nuevoTema",
        module_id="mE2E",
        order=96,
        title="Nuevo tema",
        source_code=code,
        example=_example_base(title="Ej E2E", filename="nuevo.py"),
    )
    quiz = _quiz_payload(lesson_id="nuevoTema", correct_key="b")
    assert (
        client.put("/api/v1/admin/lessons/nuevoTema/quiz", json=quiz, headers=auth).status_code
        == 200
    )
    up = client.post(
        "/api/v1/admin/examples/nuevoTema/code",
        json={"filename": "nuevo.py", "source_code": code},
        headers=auth,
    )
    assert up.status_code == 200, up.text

    # aparece en el catálogo del estudiante (GET públicos, shape de Fase 3)
    mods = client.get("/api/v1/modules").json()["data"]
    assert any(m["id"] == "mE2E" for m in mods["modules"])
    assert client.get("/api/v1/lessons/nuevoTema").json()["data"]["title"] == "Nuevo tema"
    assert client.get("/api/v1/examples/nuevoTema").json()["data"]["source_code"] == code

    # el quiz PÚBLICO no filtra la clave correcta ni la explicación
    pub_quiz = client.get("/api/v1/lessons/nuevoTema/quiz").json()["data"]
    assert pub_quiz["question_count"] == 1
    for question in pub_quiz["questions"]:
        assert "correct_key" not in question
        assert "explanation" not in question

    # corre en el simulador (runner fake): el código del admin fue el ejecutado
    job = client.post(
        "/api/v1/jobs", json={"example_id": "nuevoTema", "lesson_id": "nuevoTema"}
    )
    assert job.status_code == 202, job.text
    detail = wait_terminal(client, job.json()["data"]["job_id"])
    assert detail["status"] in {"completed", "failed", "timeout", "cancelled"}
    assert detail["source_code"] == code
