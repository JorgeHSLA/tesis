"""Dependencias compartidas de los routers admin (Fase 4).

Providers que leen ``app.state`` (patrón ``_state_attr`` de ``modules.py``),
parseo estricto del header ``Authorization: Bearer`` y el guard ``require_admin``.

Corrección del lead sobre el design: **no existe** ``ADMIN_DISABLED``. Con el modo
admin deshabilitado (``settings.admin_enabled`` falso), ``require_admin`` responde
``401 UNAUTHORIZED`` —indistinguible de un token ausente/ inválido/expirado— para no
filtrar el estado del servidor. Sin ``WWW-Authenticate`` (no dispara el diálogo
nativo del navegador). Ver api-contract §10.0.
"""

from __future__ import annotations

from fastapi import Request

from app.config import Settings
from app.errors import ApiException
from app.services.admin_auth import AdminSessionStore, LoginThrottle

#: Mensaje genérico único de fallo de auth (no revela la causa concreta).
_UNAUTHORIZED_MESSAGE = "Sesión inválida o expirada."


def get_settings_state(request: Request) -> Settings:
    """``Settings`` activo del proceso (poblado por el lifespan en app.state)."""
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        raise RuntimeError("app.state.settings no está inicializado (lifespan)")
    return settings


def get_admin_sessions(request: Request) -> AdminSessionStore:
    """Store de sesiones admin (``app.state.admin_sessions``)."""
    store = getattr(request.app.state, "admin_sessions", None)
    if store is None:
        raise RuntimeError(
            "app.state.admin_sessions no está inicializado (lifespan)"
        )
    return store


def get_admin_throttle(request: Request) -> LoginThrottle:
    """Throttle de login (``app.state.admin_throttle``)."""
    throttle = getattr(request.app.state, "admin_throttle", None)
    if throttle is None:
        raise RuntimeError(
            "app.state.admin_throttle no está inicializado (lifespan)"
        )
    return throttle


def _extract_bearer(request: Request) -> str | None:
    """Parsea ``Authorization: Bearer <token>`` de forma estricta.

    Devuelve el token o ``None`` si el header falta o no cumple el esquema
    (``Bearer`` exacto, un único token no vacío).
    """
    header = request.headers.get("Authorization")
    if not header:
        return None
    parts = header.split(" ")
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme != "Bearer" or not token:
        return None
    return token


async def require_admin(request: Request) -> str:
    """Guard único de los endpoints admin: devuelve el token o lanza 401.

    Deshabilitado, token ausente, inválido o expirado ⇒ ``401 UNAUTHORIZED`` con
    el mismo mensaje genérico (no se filtra la causa concreta).
    """
    settings = get_settings_state(request)
    if not settings.admin_enabled:
        raise ApiException("UNAUTHORIZED", _UNAUTHORIZED_MESSAGE)
    token = _extract_bearer(request)
    if token is None or not get_admin_sessions(request).validate(token):
        raise ApiException("UNAUTHORIZED", _UNAUTHORIZED_MESSAGE)
    return token
