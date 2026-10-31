"""Filtro de las rutas de autoría (``/api/v1/admin/*``): solo desde la propia máquina.

El modo autoría no tiene login: se apoya en que la app corre en loopback. Eso
protege de la red, pero **no de las páginas web que el administrador abre en su
propio navegador**:

* CSRF: la lista de orígenes de CORS incluye ``null`` (la necesita Electron, que
  carga la interfaz con ``file://``). Una página cualquiera puede producir un
  ``Origin: null`` desde un ``<iframe sandbox>`` y, con el modo admin encendido,
  llamar a ``/admin/*`` desde el navegador de quien tiene la credencial de
  publicación, incluida la publicación en el bucket.
* DNS rebinding: un dominio ajeno que resuelve a ``127.0.0.1`` hace que el
  navegador trate al backend como «el mismo origen» y lea las respuestas.

Por eso, con el modo admin encendido, este filtro exige en ``/api/v1/admin/*``:

1. ``Host`` de loopback (``localhost``, ``127.0.0.1``, ``::1``): corta el rebinding.
2. Si hay ``Origin``, que esté en ``TELAR_ALLOWED_ORIGINS`` **y no sea** ``null``.
   Un cliente sin ``Origin`` (curl, scripts locales, una lectura del mismo origen)
   pasa: eso ya es código corriendo en la máquina del administrador.

Con el modo admin apagado no se instala (el despliegue de estudiante no cambia),
y en la imagen de estudiante ``/admin/*`` ni siquiera existe.
"""

from __future__ import annotations

from typing import Iterable

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

ADMIN_PREFIX = "/api/v1/admin"

#: Nombres con los que el navegador llega legítimamente al backend local.
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def host_sin_puerto(valor: str) -> str:
    """``localhost:8000`` → ``localhost``; ``[::1]:8000`` → ``::1``."""
    valor = valor.strip().lower()
    if valor.startswith("["):
        return valor[1:].split("]", 1)[0]
    if valor.count(":") == 1:  # host:puerto (un IPv6 sin corchetes tiene varios ':')
        return valor.split(":", 1)[0]
    return valor


class AdminLoopbackGuard:
    """Middleware ASGI puro: rechaza con ``403`` lo que no venga de loopback."""

    def __init__(self, app: ASGIApp, *, allowed_origins: Iterable[str]) -> None:
        self.app = app
        # `null` queda fuera a propósito: es el origen de cualquier página
        # aislada (iframe sandbox, file://), no de la interfaz de autoría.
        self.allowed_origins = frozenset(o for o in allowed_origins if o and o != "null")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith(ADMIN_PREFIX):
            rechazo = self._rechazo(scope)
            if rechazo is not None:
                code, message = rechazo
                respuesta = JSONResponse(
                    {
                        "success": False,
                        "data": None,
                        "error": {"code": code, "message": message, "details": None},
                        "meta": None,
                    },
                    status_code=403,
                )
                await respuesta(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def _rechazo(self, scope: Scope) -> tuple[str, str] | None:
        cabeceras = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        if host_sin_puerto(cabeceras.get("host", "")) not in LOOPBACK_HOSTS:
            return (
                "HOST_NOT_ALLOWED",
                "La autoría solo responde en localhost o 127.0.0.1.",
            )
        origen = cabeceras.get("origin")
        if origen is not None and origen not in self.allowed_origins:
            return (
                "ORIGIN_NOT_ALLOWED",
                "La autoría no acepta peticiones de ese origen.",
            )
        return None
