"""Dependencias compartidas de los routers admin.

El modo autoría (admin) es una **variante de despliegue**, no un login: se
enciende con la env var ``TELAR_ADMIN_MODE`` (``settings.admin_enabled``). Con el
modo apagado —el despliegue "estudiante" por defecto— ``require_admin`` responde
``401 UNAUTHORIZED``. No hay token ni sesión: la app es local, en loopback, y el
despliegue con el modo admin se distribuye solo a administradores. Ver
api-contract §10.0.
"""

from __future__ import annotations

from fastapi import Request

from app.config import Settings
from app.errors import ApiException

#: Mensaje genérico de fallo de auth (modo admin apagado en este despliegue).
_UNAUTHORIZED_MESSAGE = "Modo autoría no disponible en este despliegue."


def get_settings_state(request: Request) -> Settings:
    """``Settings`` activo del proceso (poblado por el lifespan en app.state)."""
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        raise RuntimeError("app.state.settings no está inicializado (lifespan)")
    return settings


async def require_admin(request: Request) -> None:
    """Guard único de los endpoints admin: gatea SOLO por ``TELAR_ADMIN_MODE``.

    Modo admin habilitado por despliegue (``settings.admin_enabled``) ⇒ pasa (no
    hay token que devolver). Deshabilitado (despliegue "estudiante") ⇒
    ``401 UNAUTHORIZED``.
    """
    settings = get_settings_state(request)
    if not settings.admin_enabled:
        raise ApiException("UNAUTHORIZED", _UNAUTHORIZED_MESSAGE)
