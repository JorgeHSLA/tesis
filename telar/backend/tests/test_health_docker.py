"""Salud y sistema con Docker lento, a medias o ausente (CU-26.1–26.3).

- 26.1: ``checks.runner_image`` es ``null`` cuando la imagen NO se pudo
  comprobar (daemon caído, error, timeout) y ``false`` solo si se confirmó
  que falta.
- 26.2: las llamadas a Docker van a un hilo con un timeout corto; un daemon
  colgado no deja a ``/health`` ni a ``/api/v1/system`` esperando 120 s.
- 26.3: si el cliente no se pudo crear al arrancar, ``/health`` lo reintenta y,
  cuando lo consigue, lo entrega también al ``JobRunner``.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.main import create_app
from app.routers import system as system_router

from fakes.fake_docker import FakeDockerService


# ───────────────────────────── 26.1 · null aditivo ───────────────────────────


def test_health_imagen_ausente_confirmada_es_false(client, fake_docker):
    fake_docker.image_ok = False
    checks = client.get("/health").json()["checks"]
    assert checks == {"db": True, "docker": True, "runner_image": False}


def test_health_imagen_no_comprobable_es_null(client, fake_docker):
    fake_docker.image_ok = None  # el puerto no pudo comprobarla
    checks = client.get("/health").json()["checks"]
    assert checks["docker"] is True
    assert checks["runner_image"] is None


def test_health_imagen_que_lanza_es_null(client, fake_docker, monkeypatch):
    def _boom():
        raise RuntimeError("socket roto")

    monkeypatch.setattr(fake_docker, "image_present", _boom)
    assert client.get("/health").json()["checks"]["runner_image"] is None


def test_health_docker_caido_no_comprueba_la_imagen(client, fake_docker):
    fake_docker.ping_ok = False
    checks = client.get("/health").json()["checks"]
    assert checks["docker"] is False
    assert checks["runner_image"] is None  # no se miró: no es «ausente»


def test_system_imagen_no_comprobable_se_sirve_como_false(client, fake_docker):
    # /system conserva su bool (§2.2): el null es solo de /health.
    fake_docker.image_ok = None
    data = client.get("/api/v1/system").json()["data"]
    assert data["runner_image_present"] is False


# ─────────────────────────── 26.2 · timeout corto ────────────────────────────


def test_health_no_espera_a_un_daemon_colgado(client, fake_docker, monkeypatch):
    monkeypatch.setattr(system_router, "DOCKER_CHECK_TIMEOUT_S", 0.2)

    def _colgado():
        time.sleep(1.5)
        return True

    monkeypatch.setattr(fake_docker, "ping", _colgado)
    t0 = time.monotonic()
    response = client.get("/health")
    elapsed = time.monotonic() - t0
    assert response.status_code == 200
    assert response.json()["checks"]["docker"] is False
    assert response.json()["checks"]["runner_image"] is None
    assert elapsed < 1.0


def test_system_no_espera_a_un_daemon_colgado(client, fake_docker, monkeypatch):
    monkeypatch.setattr(system_router, "DOCKER_CHECK_TIMEOUT_S", 0.2)

    def _colgado():
        time.sleep(1.5)
        return True

    monkeypatch.setattr(fake_docker, "image_present", _colgado)
    t0 = time.monotonic()
    data = client.get("/api/v1/system").json()["data"]
    assert time.monotonic() - t0 < 1.0
    assert data["runner_image_present"] is False


def test_docker_checks_corre_fuera_del_event_loop(client, fake_docker, monkeypatch):
    """El ping síncrono se ejecuta en un hilo sin event loop propio."""
    import asyncio

    en_loop: list[bool] = []

    def _ping():
        try:
            asyncio.get_running_loop()
            en_loop.append(True)
        except RuntimeError:
            en_loop.append(False)
        return True

    monkeypatch.setattr(fake_docker, "ping", _ping)
    client.get("/health")
    assert en_loop == [False]


# ─────────────────────── 26.3 · reintento del cliente ────────────────────────


def test_health_reintenta_crear_el_cliente_y_lo_entrega_al_runner(
    settings, monkeypatch
):
    fake = FakeDockerService()
    intentos = {"n": 0}

    def builder(cfg):
        intentos["n"] += 1
        if intentos["n"] == 1:
            raise RuntimeError("sin daemon al arrancar")
        return fake

    monkeypatch.setattr(app_main, "_build_docker_service", builder)
    application = create_app(settings=settings)
    with TestClient(application) as client:
        assert application.state.docker is None
        # Primer /health: reintenta, ahora sí hay daemon.
        checks = client.get("/health").json()["checks"]
        assert checks["docker"] is True
        assert checks["runner_image"] is True
        assert application.state.docker is fake
        assert application.state.docker_service is fake
        assert application.state.job_runner.docker_service is fake
        # Con cliente ya creado no se vuelve a construir.
        client.get("/health")
        assert intentos["n"] == 2


def test_health_sigue_sin_cliente_si_el_reintento_falla(settings, monkeypatch):
    def builder(cfg):
        raise RuntimeError("sin daemon")

    monkeypatch.setattr(app_main, "_build_docker_service", builder)
    application = create_app(settings=settings)
    with TestClient(application) as client:
        checks = client.get("/health").json()["checks"]
        assert checks == {"db": True, "docker": False, "runner_image": None}
        assert application.state.docker is None


def test_health_el_reintento_colgado_respeta_el_timeout_y_no_se_duplica(
    settings, monkeypatch
):
    """Un builder colgado no bloquea /health, no se relanza en cada sondeo
    (un solo hilo en vuelo) y su resultado se recoge cuando llega."""
    monkeypatch.setattr(system_router, "DOCKER_CHECK_TIMEOUT_S", 0.2)
    llamadas = {"n": 0}
    fake = FakeDockerService()

    def builder(cfg):
        llamadas["n"] += 1
        if llamadas["n"] == 1:
            raise RuntimeError("sin daemon")
        time.sleep(0.8)
        return fake

    monkeypatch.setattr(app_main, "_build_docker_service", builder)
    application = create_app(settings=settings)
    with TestClient(application) as client:
        t0 = time.monotonic()
        assert client.get("/health").json()["checks"]["docker"] is False
        assert time.monotonic() - t0 < 0.7
        assert client.get("/health").json()["checks"]["docker"] is False
        assert llamadas["n"] == 2  # arranque + UN solo reintento en vuelo
        time.sleep(0.9)
        assert client.get("/health").json()["checks"]["docker"] is True
        assert application.state.docker is fake
        assert llamadas["n"] == 2


def test_system_tambien_reintenta_crear_el_cliente(settings, monkeypatch):
    fake = FakeDockerService()
    intentos = {"n": 0}

    def builder(cfg):
        intentos["n"] += 1
        if intentos["n"] == 1:
            raise RuntimeError("sin daemon al arrancar")
        return fake

    monkeypatch.setattr(app_main, "_build_docker_service", builder)
    application = create_app(settings=settings)
    with TestClient(application) as client:
        assert client.get("/api/v1/system").status_code == 200
        assert application.state.job_runner.docker_service is fake


def test_post_jobs_tambien_reintenta_crear_el_cliente(settings, monkeypatch):
    """Si Docker no estaba al arrancar y nadie consultó /health todavía,
    lanzar un job reintenta crear el cliente en vez de responder 503."""
    fake = FakeDockerService()
    intentos = {"n": 0}

    def builder(cfg):
        intentos["n"] += 1
        if intentos["n"] == 1:
            raise RuntimeError("sin daemon al arrancar")
        return fake

    monkeypatch.setattr(app_main, "_build_docker_service", builder)
    application = create_app(settings=settings)
    with TestClient(application) as client:
        assert application.state.docker is None
        respuesta = client.post(
            "/api/v1/jobs", json={"filename": "main.py", "code": "print(1)\n"}
        )
        assert respuesta.status_code == 202, respuesta.text
        assert application.state.job_runner.docker_service is fake
