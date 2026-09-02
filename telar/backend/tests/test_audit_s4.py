"""Regresiones de la auditoría — Sesión 4 (admin, autoría, auth, contrato).

Cubre los fixes S4: BL-11 (carve-out GPU en coherencia de hilos), BL-17
(``max_code_bytes`` en runtime también por la vía JSON), BL-18 (id de pregunta
autogenerado), BL-19 (GET admin con lock de lectura dedicado, no el ``write_lock``
transversal), BL-20 (reorden por lote), BL-35 (filename inválido → 415 también en
JSON) y BL-36 (``stream`` inválido → 422 documentado).

Reutiliza los builders/fixtures de ``test_admin_content`` (app admin real sobre
``:memory:``, modo admin habilitado por ``TELAR_ADMIN_MODE``).
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.routers import admin

from conftest import build_app
from fakes.fake_docker import FakeDockerService
from test_admin_content import (
    _create_lesson,
    _create_module,
    _example_base,
    _lesson_payload,
    _make_app,
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


def _make_app_code_limit(tmp_path, max_code_bytes: int):
    """App admin con ``max_code_bytes`` bajo (para BL-17)."""
    settings = Settings(
        db_path=str(tmp_path / "telar.db"),
        jobs_dir=str(tmp_path / "jobs"),
        allowed_origins="http://localhost:5173,null",
        code_delivery="bind",
        runner_image="telar-runner:0.5.1",
        max_timeout_s=120,
        max_concurrent_jobs=2,
        max_code_bytes=max_code_bytes,
        max_output_bytes=262144,
        admin_mode=True,
    )
    app = build_app(settings=settings, docker=FakeDockerService())
    app.include_router(admin.router)
    return app


def _err(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code, body


# ───────────────────────────── BL-11 · carve-out GPU ────────────────────────


def test_bl11_ejemplo_gpu_es_editable(client, auth):
    """Un ejemplo GPU (``requires_gpu``, sin hilos configurables ni barrido y
    ``fixed_threads=null``) NO viola la coherencia de hilos: es creable/editable."""
    _create_module(client, auth, mid="mGpu", order=91)
    gpu_example = _example_base(
        filename="gpu.py",
        threads_configurable=False,
        sweeps_threads=False,
        fixed_threads=None,
        requires_gpu=True,
        enabled=False,  # requires_gpu ⇒ enabled=false
    )
    response = client.post(
        "/api/v1/admin/lessons",
        json=_lesson_payload(
            lid="lGpu", module_id="mGpu", order=92, example=gpu_example
        ),
        headers=auth,
    )
    assert response.status_code == 201, response.text
    assert response.json()["data"]["example"]["requires_gpu"] is True


def test_bl11_no_gpu_sigue_exigiendo_fixed_threads(client, auth):
    """El carve-out es SOLO para GPU: sin GPU, hilos fijos ausentes ⇒ 422."""
    _create_module(client, auth, mid="mCpu", order=93)
    bad_example = _example_base(
        filename="cpu.py",
        threads_configurable=False,
        sweeps_threads=False,
        fixed_threads=None,
        requires_gpu=False,
    )
    response = client.post(
        "/api/v1/admin/lessons",
        json=_lesson_payload(
            lid="lCpu", module_id="mCpu", order=94, example=bad_example
        ),
        headers=auth,
    )
    _err(response, 422, "CONTENT_VALIDATION_ERROR")
    fields = {d["field"] for d in response.json()["error"]["details"]}
    assert "example.fixed_threads" in fields


# ─────────────────────────── BL-17 · max_code_bytes ─────────────────────────


def test_bl17_json_honra_max_code_bytes_bajo(tmp_path):
    """Con ``TELAR_MAX_CODE_BYTES`` bajo, la vía JSON también rechaza (413)."""
    app = _make_app_code_limit(tmp_path, max_code_bytes=64)
    with TestClient(app) as client:
        auth = {}
        big_code = "print('x')\n" * 50  # ~550 bytes > 64
        # Lección (source_code por JSON)
        r1 = client.post(
            "/api/v1/admin/lessons",
            json=_lesson_payload(source_code=big_code),
            headers=auth,
        )
        _err(r1, 413, "CODE_TOO_LARGE")
        # Subida de código del ejemplo (JSON)
        r2 = client.post(
            "/api/v1/admin/examples/anyId/code",
            json={"filename": "x.py", "source_code": big_code},
            headers=auth,
        )
        _err(r2, 413, "CODE_TOO_LARGE")


def test_bl17_json_honra_max_code_bytes_alto(tmp_path):
    """Paridad JSON↔multipart: subir el tope permite código > 262144 por JSON
    (el límite es 100% runtime, sin cap estático de pydantic)."""
    app = _make_app_code_limit(tmp_path, max_code_bytes=400_000)
    with TestClient(app) as client:
        auth = {}
        _create_module(client, auth, mid="mBig", order=79)
        big_code = "x = 1\n" + "y = 2\n" * 50_000  # ~306 KB, > 262144, < 400000
        assert len(big_code.encode()) > 262144
        resp = client.post(
            "/api/v1/admin/lessons",
            json=_lesson_payload(
                lid="lBig", module_id="mBig", order=78, source_code=big_code
            ),
            headers=auth,
        )
        assert resp.status_code == 201, resp.text


# ──────────────────────────── BL-18 · autogen id ────────────────────────────


def test_bl18_id_pregunta_autogenerado(client, auth):
    """Una pregunta sin ``id`` recibe ``{lesson_id}-q{order}`` server-side."""
    _create_module(client, auth, mid="mQ", order=95)
    _create_lesson(client, auth, lid="lQ", module_id="mQ", order=96)
    quiz = {
        "pass_threshold": 0.6,
        "questions": [
            {  # sin id → autogenerado
                "order": 1,
                "text": "¿Autogenera?",
                "options": [
                    {"key": "a", "text": "Sí"},
                    {"key": "b", "text": "No"},
                ],
                "correct_key": "a",
                "explanation": "Lo hace el servidor.",
            },
            {  # id de cliente → se conserva
                "id": "lQ-custom",
                "order": 2,
                "text": "¿Y este?",
                "options": [
                    {"key": "a", "text": "Sí"},
                    {"key": "b", "text": "No"},
                ],
                "correct_key": "b",
                "explanation": "Se conserva.",
            },
        ],
    }
    response = client.put("/api/v1/admin/lessons/lQ/quiz", json=quiz, headers=auth)
    assert response.status_code == 200, response.text
    ids = {q["id"] for q in response.json()["data"]["questions"]}
    assert ids == {"lQ-q1", "lQ-custom"}
    # el GET admin lo persiste igual
    got = client.get("/api/v1/admin/lessons/lQ/quiz", headers=auth)
    assert {q["id"] for q in got.json()["data"]["questions"]} == {"lQ-q1", "lQ-custom"}


def test_bl18_id_cliente_colisiona_con_autogenerado_422(client, auth):
    """Un id de cliente que coincide con uno que se autogeneraría se detecta
    como duplicado (422), no colisiona en silencio."""
    _create_module(client, auth, mid="mCol", order=97)
    _create_lesson(client, auth, lid="lCol", module_id="mCol", order=98)
    quiz = {
        "pass_threshold": 0.6,
        "questions": [
            {  # id de cliente == el que se autogeneraría para la otra pregunta
                "id": "lCol-q2",
                "order": 1,
                "text": "A",
                "options": [{"key": "a", "text": "x"}, {"key": "b", "text": "y"}],
                "correct_key": "a",
                "explanation": "e",
            },
            {  # sin id, order 2 → autogenera "lCol-q2" → colisión
                "order": 2,
                "text": "B",
                "options": [{"key": "a", "text": "x"}, {"key": "b", "text": "y"}],
                "correct_key": "b",
                "explanation": "e",
            },
        ],
    }
    resp = client.put("/api/v1/admin/lessons/lCol/quiz", json=quiz, headers=auth)
    _err(resp, 422, "CONTENT_VALIDATION_ERROR")


def test_bl18_id_autogenerado_demasiado_largo_422(client, auth):
    """Un `order` absurdo ya no llega a generar un id imposible.

    Antes esto se atrapaba a mano, comprobando el largo del id derivado. Ahora
    `AdminQuizQuestion.order` tiene tope (10 000), así que pydantic lo rechaza
    ANTES —con `VALIDATION_ERROR` de esquema en vez de `CONTENT_VALIDATION_ERROR`
    de negocio— y el peligro deja de ser algo que haya que cazar: con un
    `lesson_id` de 64 caracteres y el order máximo, el id derivado mide 71, por
    debajo de los 80 del patrón. El tope se puso porque un entero sin cota
    superior revienta el INSERT de SQLite y sale por un 500.
    """
    long_id = "l" + "a" * 63  # 64 chars (máximo de ID_PATTERN)
    _create_module(client, auth, mid="mLong", order=99)
    _create_lesson(client, auth, lid=long_id, module_id="mLong", order=100)
    quiz = {
        "pass_threshold": 0.6,
        "questions": [
            {  # sin id, order enorme → id autogenerado de 81 chars
                "order": 10**14,
                "text": "A",
                "options": [{"key": "a", "text": "x"}, {"key": "b", "text": "y"}],
                "correct_key": "a",
                "explanation": "e",
            }
        ],
    }
    resp = client.put(f"/api/v1/admin/lessons/{long_id}/quiz", json=quiz, headers=auth)
    _err(resp, 422, "VALIDATION_ERROR")


# ─────────────────────────── BL-19 · lock dedicado ──────────────────────────


async def test_bl19_get_admin_no_espera_el_write_lock(tmp_path):
    """Con el ``write_lock`` transversal RETENIDO por otra tarea, un GET admin
    responde igual (usa el ``content_read_lock`` dedicado, no el transversal)."""
    app = _make_app(tmp_path)
    async with app.router.lifespan_context(app):
        auth = {}
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            held = asyncio.Event()
            release = asyncio.Event()

            async def _hold_write_lock():
                async with app.state.write_lock:
                    held.set()
                    await release.wait()

            holder = asyncio.create_task(_hold_write_lock())
            await held.wait()
            try:
                resp = await asyncio.wait_for(
                    ac.get("/api/v1/admin/modules", headers=auth), timeout=2.0
                )
                assert resp.status_code == 200, resp.text
            finally:
                release.set()
                await holder


async def test_bl19_content_read_lock_evita_dirty_reads(tmp_path):
    """Control: con el ``content_read_lock`` retenido, el GET admin SÍ espera
    (así sigue sin observar una mutación admin a medias — CW-04)."""
    app = _make_app(tmp_path)
    async with app.router.lifespan_context(app):
        auth = {}
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            held = asyncio.Event()
            release = asyncio.Event()

            async def _hold_read_lock():
                async with app.state.content_read_lock:
                    held.set()
                    await release.wait()

            holder = asyncio.create_task(_hold_read_lock())
            await held.wait()
            try:
                with pytest.raises(asyncio.TimeoutError):
                    await asyncio.wait_for(
                        ac.get("/api/v1/admin/modules", headers=auth), timeout=0.3
                    )
            finally:
                release.set()
                await holder


# ───────────────────────────── BL-20 · reorder ──────────────────────────────


def test_bl20_reorder_modulos_swap(client, auth):
    """Intercambiar el ``order`` de dos módulos en una sola petición (antes daba
    409 por el swap directo A↔B)."""
    _create_module(client, auth, mid="mA", order=80)
    _create_module(client, auth, mid="mB", order=81)
    resp = client.put(
        "/api/v1/admin/modules/reorder",
        json={"items": [{"id": "mA", "order": 81}, {"id": "mB", "order": 80}]},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    orders = {m["id"]: m["order"] for m in resp.json()["data"]["modules"]}
    assert orders["mA"] == 81 and orders["mB"] == 80


def test_bl20_reorder_modulo_inexistente_404(client, auth):
    _create_module(client, auth, mid="mA", order=82)
    resp = client.put(
        "/api/v1/admin/modules/reorder",
        json={"items": [{"id": "mA", "order": 83}, {"id": "nope", "order": 82}]},
        headers=auth,
    )
    _err(resp, 404, "MODULE_NOT_FOUND")


def test_bl20_reorder_orden_duplicado_final_409(client, auth):
    """Mover mA al order de mB sin mover mB ⇒ conjunto final con duplicado."""
    _create_module(client, auth, mid="mA", order=84)
    _create_module(client, auth, mid="mB", order=85)
    resp = client.put(
        "/api/v1/admin/modules/reorder",
        json={"items": [{"id": "mA", "order": 85}]},
        headers=auth,
    )
    _err(resp, 409, "ORDER_CONFLICT")


def test_bl20_reorder_id_repetido_en_peticion_422(client, auth):
    _create_module(client, auth, mid="mA", order=86)
    resp = client.put(
        "/api/v1/admin/modules/reorder",
        json={"items": [{"id": "mA", "order": 86}, {"id": "mA", "order": 87}]},
        headers=auth,
    )
    _err(resp, 422, "CONTENT_VALIDATION_ERROR")


def test_bl20_reorder_lecciones_swap(client, auth):
    _create_module(client, auth, mid="mL", order=88)
    _create_lesson(client, auth, lid="lA", module_id="mL", order=70)
    _create_lesson(client, auth, lid="lB", module_id="mL", order=71)
    resp = client.put(
        "/api/v1/admin/lessons/reorder",
        json={"items": [{"id": "lA", "order": 71}, {"id": "lB", "order": 70}]},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    detail = client.get("/api/v1/admin/lessons/lA", headers=auth)
    assert detail.json()["data"]["order"] == 71


# ─────────────────────── BL-35 · filename inválido 415 ──────────────────────


def test_bl35_filename_invalido_json_es_415(client, auth):
    """La vía JSON de ``/code`` da 415 INVALID_EXTENSION (igual que multipart),
    no el 422 genérico de pydantic."""
    resp = client.post(
        "/api/v1/admin/examples/anyId/code",
        json={"filename": "malo.txt", "source_code": "print(1)\n"},
        headers=auth,
    )
    _err(resp, 415, "INVALID_EXTENSION")


# ─────────────────────── BL-36 · stream inválido 422 ────────────────────────


def test_bl36_output_stream_invalido_422(client):
    """``?stream=foo`` en ``GET /jobs/{id}/output`` da 422 (documentado en §9)."""
    resp = client.get("/api/v1/jobs/whatever/output?stream=foo")
    _err(resp, 422, "VALIDATION_ERROR")
