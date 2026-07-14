"""Handlers de error → envelope (api-contract §1 y §1.1)."""

import pytest
from fastapi import FastAPI
from pydantic import BaseModel
from starlette.testclient import TestClient

from app.errors import (
    DEFAULT_STATUS,
    ApiException,
    error_envelope,
    register_error_handlers,
    success_envelope,
)


class _Body(BaseModel):
    threads: int


def make_app() -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secreto interno: traceback jugoso")

    @app.get("/http-crudo")
    async def http_crudo():
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="nada por aquí")

    @app.get("/http-con-codigo")
    async def http_con_codigo():
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="JOB_NOT_CANCELLABLE")

    @app.get("/not-found")
    async def not_found():
        raise ApiException("JOB_NOT_FOUND", "No existe el job 01a2")

    @app.get("/custom-status")
    async def custom_status():
        # §1.1: VALIDATION_ERROR también puede ser 400 (no cubierto por pydantic)
        raise ApiException(
            "VALIDATION_ERROR", "ni code ni example_id presentes", status_code=400
        )

    @app.post("/validado")
    async def validado(body: _Body):
        return success_envelope({"threads": body.threads})

    return app


@pytest.fixture
def client():
    return TestClient(make_app(), raise_server_exceptions=False)


def test_api_exception_envelope(client):
    r = client.get("/not-found")
    assert r.status_code == 404
    assert r.json() == {
        "success": False,
        "data": None,
        "error": {"code": "JOB_NOT_FOUND", "message": "No existe el job 01a2", "details": None},
        "meta": None,
    }


def test_api_exception_status_explicito(client):
    r = client.get("/custom-status")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_422_pydantic_reformateado(client):
    r = client.post("/validado", json={"threads": "no-numero"})
    assert r.status_code == 422
    body = r.json()
    assert body["success"] is False and body["data"] is None
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert isinstance(body["error"]["details"], list)  # lista nativa de FastAPI
    assert body["error"]["details"][0]["loc"]


def test_500_generico_sin_filtrar_detalle(client):
    r = client.get("/boom")
    assert r.status_code == 500
    body = r.json()
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert "secreto" not in body["error"]["message"]
    assert "traceback" not in str(body)


def test_http_exception_cruda_envelope(client):
    r = client.get("/http-crudo")
    assert r.status_code == 404
    body = r.json()
    assert body["success"] is False
    assert body["error"]["code"] == "NOT_FOUND"
    assert body["error"]["message"] == "nada por aquí"


def test_http_exception_con_codigo_catalogo(client):
    r = client.get("/http-con-codigo")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "JOB_NOT_CANCELLABLE"


def test_ruta_inexistente_envelope(client):
    r = client.get("/no-existe")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


def test_metodo_no_permitido_envelope(client):
    r = client.post("/boom")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_success_envelope_shape():
    assert success_envelope({"a": 1}) == {
        "success": True,
        "data": {"a": 1},
        "error": None,
        "meta": None,
    }
    con_meta = success_envelope([], meta={"total": 0, "limit": 20, "offset": 0})
    assert con_meta["meta"] == {"total": 0, "limit": 20, "offset": 0}


def test_error_envelope_shape():
    env = error_envelope("TOO_MANY_JOBS", "Cola llena", details={"queued": 11})
    assert env["success"] is False
    assert env["error"] == {
        "code": "TOO_MANY_JOBS",
        "message": "Cola llena",
        "details": {"queued": 11},
    }


def test_catalogo_default_status_completo():
    # §1.1 congelado: cada código con su HTTP por defecto
    assert DEFAULT_STATUS == {
        "VALIDATION_ERROR": 422,
        "JOB_NOT_FOUND": 404,
        "EXAMPLE_NOT_FOUND": 404,
        "LESSON_NOT_FOUND": 404,
        "QUIZ_NOT_FOUND": 404,
        "EXAMPLE_DISABLED": 409,
        "JOB_NOT_CANCELLABLE": 409,
        "JOB_NOT_FINISHED": 409,
        "CODE_TOO_LARGE": 413,
        "INVALID_EXTENSION": 415,
        "INVALID_ENCODING": 422,
        "TOO_MANY_JOBS": 429,
        "INTERNAL_ERROR": 500,
        "DOCKER_UNAVAILABLE": 503,
        "RUNNER_IMAGE_MISSING": 503,
    }
