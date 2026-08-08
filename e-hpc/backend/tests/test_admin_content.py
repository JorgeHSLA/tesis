"""Tests de los endpoints de contenido admin (Fase 4, PAQUETE D).

Monta una app de integración reusando ``conftest.build_app`` (routers públicos +
estado real sobre ``:memory:`` sembrada desde los fixtures) y le AÑADE el router
``admin``. El modo admin es una variante de DESPLIEGUE gateada por
``TELAR_ADMIN_MODE`` (``Settings(admin_mode=True)``): sin login ni token. No edita
``conftest`` (es de A).

Cubre api-contract §10.2-§10.6:
- CRUD feliz de módulo / lección(+ejemplo) / quiz / ejemplo.
- ``409 DUPLICATE_ID`` / ``ORDER_CONFLICT`` / ``MODULE_NOT_EMPTY``.
- ``422 CONTENT_VALIDATION_ERROR`` (markdown malo, ``correct_key`` fuera de
  opciones, coherencia threads/GPU).
- Subida ``.py``: ``413`` / ``415`` / ``422``.
- Backward-compat / reload: tras crear vía admin, los GET públicos reflejan el
  contenido nuevo y el quiz público NO trae ``correct_key``.
- En modo estudiante (sin ``TELAR_ADMIN_MODE``), ``/admin/*`` → ``401``.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.routers import admin

from conftest import build_app
from fakes.fake_docker import FakeDockerService


# ─────────────────────────────── app + fixtures ─────────────────────────────


def _make_app(tmp_path, *, admin_mode: bool = True):
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
        admin_mode=admin_mode,
    )
    app = build_app(settings=settings, docker=FakeDockerService())
    app.include_router(admin.router)
    return app


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


# ─────────────────────────────── payload builders ───────────────────────────


def _module_payload(mid="mTest", order=90, **over):
    base = dict(
        id=mid,
        order=order,
        title="Módulo de prueba",
        description="Un módulo creado por el test.",
        level="Intermedio",
    )
    base.update(over)
    return base


def _example_base(**over):
    base = dict(
        title="Ejemplo de prueba",
        filename="prueba.py",
        difficulty=2,
        teaches="algo útil",
        directives=["parallel"],
        threads_configurable=True,
        fixed_threads=None,
        fixed_threads_note=None,
        sweeps_threads=False,
        self_measures=False,
        parser_id="none",
        default_timeout_s=30,
        est_run_seconds=3,
        enabled=True,
        requires_gpu=False,
        expected_output_note="una línea",
        takeaways=["aprendí esto"],
    )
    base.update(over)
    return base


def _lesson_payload(lid="lTest", module_id="mTest", order=90, **over):
    base = dict(
        id=lid,
        module_id=module_id,
        order=order,
        title="Lección de prueba",
        estimated_minutes=10,
        content_markdown="# Título\n\nTexto con **negrita** y `código`.",
        recommended=[],
        example=_example_base(),
        source_code="print('hola')\n",
    )
    base.update(over)
    return base


def _quiz_payload(lesson_id="lTest", correct_key="a"):
    return {
        "pass_threshold": 0.6,
        "questions": [
            {
                "id": f"{lesson_id}-q1",
                "order": 1,
                "text": "¿Una pregunta de prueba?",
                "options": [
                    {"key": "a", "text": "Opción A"},
                    {"key": "b", "text": "Opción B"},
                ],
                "correct_key": correct_key,
                "explanation": "Porque sí.",
            }
        ],
    }


def _err(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code, body


def _create_module(client, auth, **over):
    response = client.post("/api/v1/admin/modules", json=_module_payload(**over), headers=auth)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def _create_lesson(client, auth, **over):
    response = client.post("/api/v1/admin/lessons", json=_lesson_payload(**over), headers=auth)
    assert response.status_code == 201, response.text
    return response.json()["data"]


# ───────────────────────────────── auth gate ────────────────────────────────


def test_modo_estudiante_todos_los_admin_401(tmp_path):
    """Despliegue "estudiante" (sin ``TELAR_ADMIN_MODE``): todo ``/admin/*`` → 401."""
    app = _make_app(tmp_path, admin_mode=False)
    with TestClient(app) as client:
        for method, path in [
            ("get", "/api/v1/admin/modules"),
            ("post", "/api/v1/admin/modules"),
            ("put", "/api/v1/admin/modules/mX"),
            ("delete", "/api/v1/admin/modules/mX"),
            ("get", "/api/v1/admin/lessons/lX"),
            ("post", "/api/v1/admin/lessons"),
            ("get", "/api/v1/admin/lessons/lX/quiz"),
            ("get", "/api/v1/admin/examples/eX"),
        ]:
            response = getattr(client, method)(path)
            _err(response, 401, "UNAUTHORIZED")


def test_modo_admin_habilitado_permite_acceso(client):
    """Con ``TELAR_ADMIN_MODE`` habilitado, ``/admin/*`` responde sin token."""
    response = client.get("/api/v1/admin/modules")
    assert response.status_code == 200


# ───────────────────────────────── módulos ──────────────────────────────────


def test_crud_modulo_feliz(client, auth):
    created = _create_module(client, auth)
    assert created["id"] == "mTest"
    assert created["order"] == 90
    assert created["lessons"] == []

    listing = client.get("/api/v1/admin/modules", headers=auth)
    ids = [m["id"] for m in listing.json()["data"]["modules"]]
    assert "mTest" in ids

    payload = _module_payload(title="Título editado")
    del payload["id"]  # el id va por el path
    updated = client.put("/api/v1/admin/modules/mTest", json=payload, headers=auth)
    assert updated.status_code == 200
    assert updated.json()["data"]["title"] == "Título editado"

    deleted = client.delete("/api/v1/admin/modules/mTest", headers=auth)
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True, "id": "mTest"}


def test_modulo_duplicate_id_409(client, auth):
    _create_module(client, auth)
    dup = client.post("/api/v1/admin/modules", json=_module_payload(), headers=auth)
    _err(dup, 409, "DUPLICATE_ID")


def test_modulo_order_conflict_409(client, auth):
    _create_module(client, auth, mid="mUno", order=90)
    other = client.post(
        "/api/v1/admin/modules", json=_module_payload(mid="mDos", order=90), headers=auth
    )
    _err(other, 409, "ORDER_CONFLICT")


def test_modulo_update_no_existe_404(client, auth):
    payload = _module_payload()
    del payload["id"]
    response = client.put("/api/v1/admin/modules/noexiste", json=payload, headers=auth)
    _err(response, 404, "MODULE_NOT_FOUND")


def test_modulo_no_vacio_409(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    response = client.delete("/api/v1/admin/modules/mTest", headers=auth)
    _err(response, 409, "MODULE_NOT_EMPTY")


# ────────────────────── lecciones + ejemplo + quiz ──────────────────────────


def test_crud_leccion_ejemplo_quiz_feliz(client, auth):
    _create_module(client, auth)
    lesson = _create_lesson(client, auth)
    assert lesson["id"] == "lTest"
    assert lesson["has_quiz"] is False
    assert lesson["example"]["id"] == "lTest"
    assert lesson["example"]["source_code"] == "print('hola')\n"
    assert lesson["example"]["module_id"] == "mTest"

    got = client.get("/api/v1/admin/lessons/lTest", headers=auth)
    assert got.status_code == 200
    assert got.json()["data"]["title"] == "Lección de prueba"

    example = client.get("/api/v1/admin/examples/lTest", headers=auth)
    assert example.status_code == 200
    assert example.json()["data"]["source_code"] == "print('hola')\n"

    # PUT quiz (crea el set diferido)
    put = client.put(
        "/api/v1/admin/lessons/lTest/quiz", json=_quiz_payload(), headers=auth
    )
    assert put.status_code == 200
    assert put.json()["data"]["question_count"] == 1

    # GET admin quiz trae correct_key
    admin_quiz = client.get("/api/v1/admin/lessons/lTest/quiz", headers=auth)
    assert admin_quiz.status_code == 200
    assert admin_quiz.json()["data"]["questions"][0]["correct_key"] == "a"

    # la lección ahora reporta has_quiz
    got2 = client.get("/api/v1/admin/lessons/lTest", headers=auth)
    assert got2.json()["data"]["has_quiz"] is True
    assert got2.json()["data"]["quiz_question_count"] == 1

    # DELETE quiz y DELETE lección
    assert client.delete("/api/v1/admin/lessons/lTest/quiz", headers=auth).status_code == 200
    assert client.delete("/api/v1/admin/lessons/lTest", headers=auth).status_code == 200
    assert client.get("/api/v1/admin/lessons/lTest", headers=auth).status_code == 404


def test_leccion_modulo_inexistente_404(client, auth):
    response = client.post(
        "/api/v1/admin/lessons",
        json=_lesson_payload(module_id="noexiste"),
        headers=auth,
    )
    _err(response, 404, "MODULE_NOT_FOUND")


def test_leccion_get_inexistente_404(client, auth):
    _err(client.get("/api/v1/admin/lessons/noexiste", headers=auth), 404, "LESSON_NOT_FOUND")


def test_leccion_duplicate_id_409(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    dup = client.post(
        "/api/v1/admin/lessons", json=_lesson_payload(order=91), headers=auth
    )
    _err(dup, 409, "DUPLICATE_ID")


def test_leccion_order_conflict_409(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    other = client.post(
        "/api/v1/admin/lessons",
        json=_lesson_payload(lid="lOtra", order=90),
        headers=auth,
    )
    _err(other, 409, "ORDER_CONFLICT")


def test_update_example_metadatos(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    payload = _example_base(title="Título nuevo del ejemplo")
    response = client.put("/api/v1/admin/examples/lTest", json=payload, headers=auth)
    assert response.status_code == 200
    assert response.json()["data"]["title"] == "Título nuevo del ejemplo"


# ──────────────────────── validación de contenido (422) ─────────────────────


def test_markdown_malo_422(client, auth):
    _create_module(client, auth)
    payload = _lesson_payload(
        content_markdown="# Título\n\n<script>alert(1)</script>\n"
    )
    response = client.post("/api/v1/admin/lessons", json=payload, headers=auth)
    _err(response, 422, "CONTENT_VALIDATION_ERROR")
    assert response.json()["error"]["details"]


def test_correct_key_fuera_de_opciones_422(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    response = client.put(
        "/api/v1/admin/lessons/lTest/quiz",
        json=_quiz_payload(correct_key="c"),  # 'c' no está entre a/b
        headers=auth,
    )
    _err(response, 422, "CONTENT_VALIDATION_ERROR")


def test_threads_incoherentes_422(client, auth):
    _create_module(client, auth)
    # no configurable, sin barrido y sin fixed_threads → incoherente
    example = _example_base(
        threads_configurable=False, sweeps_threads=False, fixed_threads=None
    )
    response = client.post(
        "/api/v1/admin/lessons",
        json=_lesson_payload(example=example),
        headers=auth,
    )
    _err(response, 422, "CONTENT_VALIDATION_ERROR")


def test_gpu_habilitado_incoherente_422(client, auth):
    _create_module(client, auth)
    example = _example_base(requires_gpu=True, enabled=True)
    response = client.post(
        "/api/v1/admin/lessons",
        json=_lesson_payload(example=example),
        headers=auth,
    )
    _err(response, 422, "CONTENT_VALIDATION_ERROR")


# ─────────────────────────── subida de código .py ───────────────────────────


def test_upload_code_json_ok(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    response = client.post(
        "/api/v1/admin/examples/lTest/code",
        json={"filename": "nuevo.py", "source_code": "print('nuevo')\n"},
        headers=auth,
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["example_id"] == "lTest"
    assert data["filename"] == "nuevo.py"
    assert data["bytes"] == len("print('nuevo')\n".encode("utf-8"))
    # el código quedó persistido
    example = client.get("/api/v1/admin/examples/lTest", headers=auth)
    assert example.json()["data"]["source_code"] == "print('nuevo')\n"


def test_upload_code_multipart_ok(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    files = {"file": ("subido.py", b"print('subido')\n", "text/x-python")}
    response = client.post(
        "/api/v1/admin/examples/lTest/code", files=files, headers=auth
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["filename"] == "subido.py"


def test_upload_code_415_extension(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    files = {"file": ("prueba.txt", b"print(1)\n", "text/plain")}
    response = client.post(
        "/api/v1/admin/examples/lTest/code", files=files, headers=auth
    )
    _err(response, 415, "INVALID_EXTENSION")


def test_upload_code_422_encoding(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    files = {"file": ("prueba.py", b"\xff\xfe\x00\x01", "text/x-python")}
    response = client.post(
        "/api/v1/admin/examples/lTest/code", files=files, headers=auth
    )
    _err(response, 422, "INVALID_ENCODING")


def test_upload_code_413_demasiado_grande(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    big = b"x" * (262144 + 1)
    files = {"file": ("grande.py", big, "text/x-python")}
    response = client.post(
        "/api/v1/admin/examples/lTest/code", files=files, headers=auth
    )
    _err(response, 413, "CODE_TOO_LARGE")


def test_upload_code_413_json_multibyte(client, auth):
    """≤262144 chars pero >262144 bytes (multibyte) → 413 por el byte-check."""
    _create_module(client, auth)
    _create_lesson(client, auth)
    # '#' + 200000 caracteres de 2 bytes = 400001 bytes, 200001 chars (< límite de chars)
    source = "# " + ("á" * 200000)
    response = client.post(
        "/api/v1/admin/examples/lTest/code",
        json={"filename": "m.py", "source_code": source},
        headers=auth,
    )
    _err(response, 413, "CODE_TOO_LARGE")


def test_upload_code_ejemplo_inexistente_404(client, auth):
    response = client.post(
        "/api/v1/admin/examples/noexiste/code",
        json={"filename": "m.py", "source_code": "print(1)\n"},
        headers=auth,
    )
    _err(response, 404, "EXAMPLE_NOT_FOUND")


# ─────────────────── backward-compat / reload de contenido ───────────────────


def test_reload_refleja_en_gets_publicos(client, auth):
    _create_module(client, auth)
    _create_lesson(client, auth)
    client.put("/api/v1/admin/lessons/lTest/quiz", json=_quiz_payload(), headers=auth)

    # GET público /api/v1/modules refleja el módulo + lección nuevos
    public_modules = client.get("/api/v1/modules").json()["data"]["modules"]
    module = next((m for m in public_modules if m["id"] == "mTest"), None)
    assert module is not None
    lesson_ids = [lesson["id"] for lesson in module["lessons"]]
    assert "lTest" in lesson_ids

    # GET público /api/v1/lessons/{id} refleja el markdown
    public_lesson = client.get("/api/v1/lessons/lTest").json()["data"]
    assert public_lesson["content_markdown"].startswith("# Título")
    assert public_lesson["has_quiz"] is True

    # GET público /api/v1/examples/{id} refleja el código
    public_example = client.get("/api/v1/examples/lTest").json()["data"]
    assert public_example["source_code"] == "print('hola')\n"

    # el quiz PÚBLICO NO trae correct_key/explanation
    public_quiz = client.get("/api/v1/lessons/lTest/quiz").json()["data"]
    question = public_quiz["questions"][0]
    assert "correct_key" not in question
    assert "explanation" not in question


def test_delete_lesson_limpia_recommended_colgante(client, auth):
    """Borrar una lección referida por 'recommended' de otra no rompe el reload."""
    _create_module(client, auth)
    _create_lesson(client, auth, lid="lA", order=90)
    # lB recomienda lA
    _create_lesson(
        client,
        auth,
        lid="lB",
        order=91,
        recommended=[{"lesson_id": "lA", "label": "Ver lA", "tag": "Práctica"}],
    )
    # borrar lA no debe dejar un ref colgante (el reload fallaría → 500)
    deleted = client.delete("/api/v1/admin/lessons/lA", headers=auth)
    assert deleted.status_code == 200
    # lB sigue accesible y su recommended quedó vacío
    lb = client.get("/api/v1/admin/lessons/lB", headers=auth)
    assert lb.status_code == 200
    assert lb.json()["data"]["recommended"] == []


# ───────────── BL-01/BL-06 (auditoría §3): integridad del progreso ───────────


def _quiz_payload_n(lesson_id="lTest", n=2, pass_threshold=0.5, text_suffix=""):
    """Quiz de ``n`` preguntas (correcta siempre 'a') para tests de progreso."""
    return {
        "pass_threshold": pass_threshold,
        "questions": [
            {
                "id": f"{lesson_id}-q{i}",
                "order": i,
                "text": f"¿Pregunta {i}{text_suffix}?",
                "options": [
                    {"key": "a", "text": "Correcta"},
                    {"key": "b", "text": "Incorrecta"},
                ],
                "correct_key": "a",
                "explanation": "Porque sí.",
            }
            for i in range(1, n + 1)
        ],
    }


def _put_quiz(client, auth, lesson_id="lTest", **over):
    response = client.put(
        f"/api/v1/admin/lessons/{lesson_id}/quiz",
        json=_quiz_payload_n(lesson_id, **over),
        headers=auth,
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _pass_quiz(client, lesson_id="lTest", n=2):
    """Intento público con todas las respuestas correctas (aprueba)."""
    answers = {f"{lesson_id}-q{i}": "a" for i in range(1, n + 1)}
    response = client.post(
        f"/api/v1/lessons/{lesson_id}/quiz/attempts", json={"answers": answers}
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["passed"] is True
    return data


def _progress_entry(client, lesson_id="lTest"):
    progress = client.get("/api/v1/progress").json()["data"]["lessons"]
    return progress.get(lesson_id)


def test_bl01_borrar_y_recrear_id_no_resucita_progreso(client, auth):
    """BL-01: borrar la lección purga progreso e intentos; reutilizar el id
    NO hereda ``completed``/``best_quiz_score`` de un contenido que ya no existe."""
    _create_module(client, auth)
    _create_lesson(client, auth)
    _put_quiz(client, auth, n=2)
    _pass_quiz(client, n=2)

    entry = _progress_entry(client)
    assert entry is not None and entry["completed"] is True
    assert entry["best_quiz_score"] == 2

    deleted = client.delete("/api/v1/admin/lessons/lTest", headers=auth)
    assert deleted.status_code == 200

    # recrear una lección NUEVA y distinta con el MISMO id
    _create_lesson(client, auth, title="Otra lección distinta")
    assert _progress_entry(client) is None  # sin progreso heredado

    # el historial de intentos también quedó purgado
    _put_quiz(client, auth, n=1)
    history = client.get("/api/v1/lessons/lTest/quiz/attempts")
    assert history.status_code == 200, history.text
    assert history.json()["data"]["attempts"] == []
    assert history.json()["meta"]["total"] == 0


def test_bl06_replace_quiz_menos_preguntas_resetea_progreso(client, auth):
    """BL-06: cambiar el nº de preguntas invalida best_quiz_score/completed
    (evita la nota imposible best=2 sobre quiz_total=1)."""
    _create_module(client, auth)
    _create_lesson(client, auth)
    _put_quiz(client, auth, n=2)
    _pass_quiz(client, n=2)
    # viewed lo marca el estudiante y debe SOBREVIVIR al reset
    client.put("/api/v1/progress/lessons/lTest", json={"viewed": True})

    _put_quiz(client, auth, n=1)  # quiz reemplazado con MENOS preguntas

    entry = _progress_entry(client)
    assert entry is not None, "la fila de progreso no debe desaparecer"
    assert entry["best_quiz_score"] is None
    assert entry["completed"] is False
    assert entry["quiz_total"] == 1
    assert entry["viewed"] is True


def test_bl06_replace_quiz_solo_threshold_resetea_progreso(client, auth):
    """BL-06: cambiar pass_threshold también invalida el progreso previo
    (un 'aprobado' con el umbral viejo no vale con el nuevo)."""
    _create_module(client, auth)
    _create_lesson(client, auth)
    _put_quiz(client, auth, n=2, pass_threshold=0.5)
    _pass_quiz(client, n=2)

    _put_quiz(client, auth, n=2, pass_threshold=0.9)  # mismas preguntas

    entry = _progress_entry(client)
    assert entry["best_quiz_score"] is None
    assert entry["completed"] is False


def test_bl06_replace_quiz_identico_no_resetea(client, auth):
    """Editar solo el texto (mismo nº de preguntas y umbral) NO borra el
    progreso del estudiante — el reset es por cambio estructural, no cosmético."""
    _create_module(client, auth)
    _create_lesson(client, auth)
    _put_quiz(client, auth, n=2)
    _pass_quiz(client, n=2)

    _put_quiz(client, auth, n=2, text_suffix=" (texto corregido)")

    entry = _progress_entry(client)
    assert entry["best_quiz_score"] == 2
    assert entry["completed"] is True


def test_bl06_delete_quiz_resetea_progreso(client, auth):
    """BL-06: borrar el quiz deja best=NULL/completed=false (no best=2 sobre
    un quiz_total de 0)."""
    _create_module(client, auth)
    _create_lesson(client, auth)
    _put_quiz(client, auth, n=2)
    _pass_quiz(client, n=2)

    deleted = client.delete("/api/v1/admin/lessons/lTest/quiz", headers=auth)
    assert deleted.status_code == 200

    entry = _progress_entry(client)
    assert entry is not None
    assert entry["best_quiz_score"] is None
    assert entry["completed"] is False
    assert entry["quiz_total"] == 0


# ───────── BL-38 (auditoría §3): lessons_completed filtra enabled ────────────


def test_bl38_leccion_completada_y_deshabilitada_no_cuenta(client, auth):
    """Una lección completada que luego se deshabilita no debe contar en
    ``lessons_completed`` (podría superar ``lessons_enabled``)."""
    put = client.put("/api/v1/progress/lessons/spmd", json={"completed": True})
    assert put.status_code == 200
    before = client.get("/api/v1/modules").json()["data"]["summary"]
    assert before["lessons_completed"] == 1
    assert before["lessons_enabled"] == 13

    # el admin deshabilita el ejemplo (la lección deja de estar disponible)
    example = client.get("/api/v1/admin/examples/spmd", headers=auth).json()["data"]
    body = {
        k: v
        for k, v in example.items()
        if k not in ("id", "module_id", "order", "source_code")
    }
    body["enabled"] = False
    updated = client.put("/api/v1/admin/examples/spmd", json=body, headers=auth)
    assert updated.status_code == 200, updated.text

    summary = client.get("/api/v1/modules").json()["data"]["summary"]
    assert summary["lessons_enabled"] == 12
    assert summary["lessons_completed"] == 0  # ya no cuenta la deshabilitada

    progress = client.get("/api/v1/progress").json()["data"]
    assert progress["summary"]["lessons_completed"] == 0
    assert "spmd" in progress["lessons"]  # el registro del estudiante persiste


# ─────────── tope de timeout OPCIONAL: DTO admin sin cap estático ───────────


def test_admin_example_dto_sin_cap_estatico_de_default_timeout():
    """CONTRATO §10.4: ``AdminExampleBase.default_timeout_s`` ya no lleva
    ``le=120``.

    El máximo dejó de ser un cap estático del DTO y pasó a ser OPCIONAL vía
    ``TELAR_MAX_TIMEOUT_S`` (0 = sin límite). El mínimo (5 s) sigue fijo.

    NOTA: persistir un valor > 120 aún choca contra el CHECK de ``schema.sql``
    (``content_examples.default_timeout_s BETWEEN 5 AND 120``); esto valida
    solo la capa de contrato/DTO.
    """
    import pydantic

    from app.schemas import AdminExampleBase

    base = dict(
        title="x", filename="x.py", difficulty=1, teaches="x", directives=[],
        threads_configurable=True, fixed_threads=None, fixed_threads_note=None,
        sweeps_threads=False, self_measures=False, parser_id="none",
        est_run_seconds=1, enabled=True, requires_gpu=False,
        expected_output_note="", takeaways=["x"],
    )
    assert AdminExampleBase(**base, default_timeout_s=3600).default_timeout_s == 3600
    with pytest.raises(pydantic.ValidationError):
        AdminExampleBase(**base, default_timeout_s=4)
