"""GET /health y GET /api/v1/system con app parcial (sin WP2/WP3)."""

import os

import httpx
import pytest
from fastapi import FastAPI

from app.config import Settings
from app.errors import register_error_handlers
from app.routers import system as system_router

from conftest import AsyncFakeDocker, FakeDocker

pytestmark = pytest.mark.asyncio


def make_app(db=None, docker=None, settings=None) -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(system_router.router)
    app.state.db = db
    app.state.docker = docker
    app.state.settings = settings or Settings()
    return app


def client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


# ── /health ──────────────────────────────────────────────────────────────────


async def test_health_ok(db, fake_docker):
    async with client(make_app(db=db, docker=fake_docker)) as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json() == {
        "status": "ok",
        "checks": {"db": True, "docker": True, "runner_image": True},
    }


async def test_health_docker_caido_sigue_200(db):
    """Liveness ≠ readiness: docker/runner_image son informativos."""
    async with client(make_app(db=db, docker=FakeDocker(ping_ok=False))) as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json()["checks"] == {"db": True, "docker": False, "runner_image": False}


async def test_health_sin_imagen_runner_sigue_200(db):
    async with client(make_app(db=db, docker=FakeDocker(image_ok=False))) as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json()["checks"]["runner_image"] is False


async def test_health_db_caida_503(db, fake_docker):
    await db.close()  # la conexión muere: liveness degradada
    async with client(make_app(db=db, docker=fake_docker)) as c:
        r = await c.get("/health")
    assert r.status_code == 503
    assert r.json()["checks"]["db"] is False


async def test_health_sin_db_503(fake_docker):
    async with client(make_app(db=None, docker=fake_docker)) as c:
        r = await c.get("/health")
    assert r.status_code == 503


# ── /api/v1/system ───────────────────────────────────────────────────────────


async def test_system_ok_shape_contrato(db, fake_docker):
    async with client(make_app(db=db, docker=fake_docker)) as c:
        r = await c.get("/api/v1/system")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True and body["error"] is None and body["meta"] is None

    data = body["data"]
    cores = os.cpu_count() or 1
    assert data["cores"] == cores
    assert data["max_threads"] == min(8, cores)
    assert data["runner_image"] == "ehpc-runner:0.5.1"
    assert data["runner_image_present"] is True
    assert data["gpu_examples_enabled"] is False
    assert data["versions"]["pyomp"] == "0.5.1"
    assert data["versions"]["api"] == "v1"
    assert data["versions"]["backend"]
    assert data["versions"]["python"].startswith("3.")
    assert data["limits"] == {
        "max_code_bytes": 262144,
        "max_timeout_s": 120,
        "max_concurrent_jobs": 2,
        "max_output_bytes": 262144,
    }


async def test_system_imagen_ausente_200(db):
    async with client(make_app(db=db, docker=FakeDocker(image_ok=False))) as c:
        r = await c.get("/api/v1/system")
    assert r.status_code == 200
    assert r.json()["data"]["runner_image_present"] is False


async def test_system_docker_caido_503(db):
    async with client(make_app(db=db, docker=FakeDocker(ping_ok=False))) as c:
        r = await c.get("/api/v1/system")
    assert r.status_code == 503
    body = r.json()
    assert body["success"] is False and body["data"] is None
    assert body["error"]["code"] == "DOCKER_UNAVAILABLE"


async def test_system_sin_docker_service_503(db):
    async with client(make_app(db=db, docker=None)) as c:
        r = await c.get("/api/v1/system")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "DOCKER_UNAVAILABLE"


async def test_system_y_health_con_puerto_async(db):
    """El router consume el puerto por interfaz: métodos sync o async."""
    async with client(make_app(db=db, docker=AsyncFakeDocker())) as c:
        r1 = await c.get("/health")
        r2 = await c.get("/api/v1/system")
    assert r1.status_code == 200 and r1.json()["checks"]["docker"] is True
    assert r2.status_code == 200 and r2.json()["data"]["runner_image_present"] is True
