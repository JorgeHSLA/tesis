"""Tests de autenticación admin (Fase 4, PAQUETE C) — SELF-CONTAINED.

No depende del ``conftest`` de contenido: monta su propia app FastAPI mínima con
``register_error_handlers`` + el router ``admin_auth`` + ``app.state`` poblado
(settings, admin_sessions, admin_throttle), y usa ``TestClient``.

Cubre api-contract §10.0 y la corrección del lead: **no existe** ``ADMIN_DISABLED``;
login con password malo, modo deshabilitado y Bearer inválido/expirado son TODOS
``401 UNAUTHORIZED`` indistinguibles.
"""

from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import register_error_handlers
from app.routers import admin_auth
from app.services.admin_auth import (
    AdminSession,
    AdminSessionStore,
    LoginThrottle,
    verify_password,
)

ADMIN_PASSWORD = "s3cr3t-áéí"  # incluye no-ASCII para probar el encode UTF-8


# ─────────────────────────────── App mínima ─────────────────────────────────


def _build_app(*, password: str = ADMIN_PASSWORD, ttl_s: int = 8 * 60 * 60) -> FastAPI:
    """App FastAPI aislada con el router de auth y ``app.state`` poblado."""
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(admin_auth.router)
    app.state.settings = Settings(admin_password=password)
    app.state.admin_sessions = AdminSessionStore(ttl_s=ttl_s)
    app.state.admin_throttle = LoginThrottle(step_s=0.0, max_s=0.0)  # sin sleeps en test
    return app


@pytest.fixture
def client() -> TestClient:
    with TestClient(_build_app()) as c:
        yield c


def _assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"]["code"] == code


def _login_token(client: TestClient, password: str = ADMIN_PASSWORD) -> str:
    response = client.post("/api/v1/admin/login", json={"password": password})
    assert response.status_code == 200
    return response.json()["data"]["token"]


# ─────────────────────────────── login ──────────────────────────────────────


def test_login_ok_devuelve_token_y_expires_at(client):
    response = client.post("/api/v1/admin/login", json={"password": ADMIN_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    data = body["data"]
    assert isinstance(data["token"], str) and len(data["token"]) > 20
    # expires_at en ISO-8601 UTC con sufijo Z.
    assert data["expires_at"].endswith("Z")


def test_login_password_incorrecto_401(client):
    response = client.post("/api/v1/admin/login", json={"password": "mala"})
    _assert_error(response, 401, "UNAUTHORIZED")


def test_login_modo_deshabilitado_401_mismo_codigo(client):
    """Sin EHPC_ADMIN_PASSWORD → 401 UNAUTHORIZED, indistinguible (no ADMIN_DISABLED)."""
    with TestClient(_build_app(password="")) as disabled:
        response = disabled.post(
            "/api/v1/admin/login", json={"password": "cualquiera"}
        )
        _assert_error(response, 401, "UNAUTHORIZED")


def test_login_password_vacio_422(client):
    """El DTO exige min_length=1 → VALIDATION_ERROR (422)."""
    response = client.post("/api/v1/admin/login", json={"password": ""})
    _assert_error(response, 422, "VALIDATION_ERROR")


# ─────────────────────────────── logout ─────────────────────────────────────


def test_logout_revoca_token(client):
    token = _login_token(client)
    auth = {"Authorization": f"Bearer {token}"}
    logout = client.post("/api/v1/admin/logout", headers=auth)
    assert logout.status_code == 200
    assert logout.json()["data"] == {"revoked": True}
    # El mismo token ya no sirve.
    _assert_error(client.get("/api/v1/admin/session", headers=auth), 401, "UNAUTHORIZED")


def test_logout_sin_bearer_401(client):
    _assert_error(client.post("/api/v1/admin/logout"), 401, "UNAUTHORIZED")


# ─────────────────────────────── session ────────────────────────────────────


def test_session_con_token_valido(client):
    token = _login_token(client)
    response = client.get(
        "/api/v1/admin/session", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["authenticated"] is True
    assert data["expires_at"].endswith("Z")


def test_session_sin_bearer_401(client):
    _assert_error(client.get("/api/v1/admin/session"), 401, "UNAUTHORIZED")


def test_session_bearer_malformado_401(client):
    for bad in ("Bearer", "Basic abc", "Bearer a b", "token123", "bearer x"):
        response = client.get(
            "/api/v1/admin/session", headers={"Authorization": bad}
        )
        _assert_error(response, 401, "UNAUTHORIZED")


def test_session_token_invalido_401(client):
    response = client.get(
        "/api/v1/admin/session", headers={"Authorization": "Bearer noexiste"}
    )
    _assert_error(response, 401, "UNAUTHORIZED")


def test_session_token_expirado_401():
    """TTL diminuto → el token expira y el guard responde 401."""
    with TestClient(_build_app(ttl_s=1)) as short:
        token = _login_token(short)
        # Forzar expiración manipulando el reloj del store.
        store: AdminSessionStore = short.app.state.admin_sessions
        store._sessions[token] = time.time() - 1  # ya expirado
        response = short.get(
            "/api/v1/admin/session", headers={"Authorization": f"Bearer {token}"}
        )
        _assert_error(response, 401, "UNAUTHORIZED")


def test_session_no_renueva_ttl(client):
    """GET /session no desliza el TTL: expires_at estable entre llamadas."""
    token = _login_token(client)
    auth = {"Authorization": f"Bearer {token}"}
    first = client.get("/api/v1/admin/session", headers=auth).json()["data"]
    second = client.get("/api/v1/admin/session", headers=auth).json()["data"]
    assert first["expires_at"] == second["expires_at"]


# ───────────────────────── verify_password (unit) ───────────────────────────


def test_verify_password_correcto_e_incorrecto():
    assert verify_password(ADMIN_PASSWORD, ADMIN_PASSWORD) is True
    assert verify_password("otra", ADMIN_PASSWORD) is False
    # Espacios alrededor del configurado se ignoran (strip); no en el candidato.
    assert verify_password(ADMIN_PASSWORD, f"  {ADMIN_PASSWORD}  ") is True


def test_verify_password_deshabilitado_siempre_false():
    assert verify_password("cualquiera", "") is False
    assert verify_password("", "") is False
    assert verify_password("x", "   ") is False


# ─────────────────────── AdminSessionStore (unit) ───────────────────────────


def test_store_create_validate_revoke():
    store = AdminSessionStore()
    session = store.create()
    assert isinstance(session, AdminSession)
    assert store.validate(session.token) is True
    store.revoke(session.token)
    assert store.validate(session.token) is False
    # revoke es idempotente.
    store.revoke(session.token)


def test_store_validate_expirado():
    store = AdminSessionStore(ttl_s=100)
    session = store.create(now=1000.0)
    assert store.validate(session.token, now=1099.0) is True
    assert store.validate(session.token, now=1101.0) is False  # expiró


def test_store_validate_token_vacio_o_ausente():
    store = AdminSessionStore()
    assert store.validate("") is False
    assert store.validate("noexiste") is False


def test_store_peek_expiry():
    store = AdminSessionStore(ttl_s=100)
    session = store.create()
    assert store.peek_expiry(session.token) == pytest.approx(session.expires_at)
    assert store.peek_expiry("noexiste") is None


def test_store_tope_max_sessions():
    from app.services.admin_auth import MAX_ACTIVE_SESSIONS

    store = AdminSessionStore(ttl_s=10_000)
    tokens = [store.create(now=1000.0 + i).token for i in range(MAX_ACTIVE_SESSIONS + 5)]
    # Nunca supera el tope.
    assert len(store._sessions) <= MAX_ACTIVE_SESSIONS
    # Las primeras (más próximas a expirar) fueron descartadas.
    assert store.validate(tokens[0], now=1000.0) is False
    assert store.validate(tokens[-1], now=1000.0) is True


# ───────────────────────────── LoginThrottle (unit) ─────────────────────────


def test_throttle_backoff_y_reset():
    throttle = LoginThrottle(step_s=0.5, max_s=5.0)
    assert throttle.delay_s == 0.0
    throttle.record_failure()
    assert throttle.delay_s == 0.5
    for _ in range(20):
        throttle.record_failure()
    assert throttle.delay_s == 5.0  # tope
    throttle.reset()
    assert throttle.delay_s == 0.0


@pytest.mark.asyncio
async def test_throttle_sleep_no_espera_sin_fallos():
    throttle = LoginThrottle(step_s=10.0, max_s=10.0)
    started = time.monotonic()
    await throttle.sleep_if_needed()  # sin fallos → sin espera
    assert time.monotonic() - started < 0.5
