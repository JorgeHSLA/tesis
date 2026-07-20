"""Router de autenticación admin — ``POST /login``, ``POST /logout``, ``GET /session``.

Implementa api-contract §10.0 y fase4-autoria-design §5.3 (CONGELADO), con la
corrección del lead: **no existe** ``ADMIN_DISABLED``. Login con contraseña
incorrecta, modo deshabilitado o Bearer inválido/expirado ⇒ ``401 UNAUTHORIZED``,
todos indistinguibles (no se filtra el estado del servidor).

- ``POST /login``: aun con el modo deshabilitado se ejecuta ``verify_password``
  (dummy compare, tiempo constante) y se responde 401. Habilitado: throttle →
  ``verify_password`` → 401 (fallo genérico) o ``store.create()`` + ``reset()`` →
  200 ``{token, expires_at}``.
- ``POST /logout`` (Bearer requerido): revoca el token → 200 ``{revoked: true}``.
- ``GET /session`` (Bearer): 200 ``{authenticated: true, expires_at}`` o 401.
  No renueva el TTL.

Sin ``WWW-Authenticate`` (no dispara el diálogo nativo del navegador).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.config import Settings
from app.errors import ApiException
from app.routers.admin_deps import (
    get_admin_sessions,
    get_admin_throttle,
    get_settings_state,
    require_admin,
)
from app.schemas import (
    AdminLoginRequest,
    AdminLoginResult,
    AdminLogoutResult,
    AdminSessionInfo,
)
from app.services.admin_auth import AdminSessionStore, LoginThrottle

#: Mensaje genérico de fallo de credencial/estado (no revela la causa).
_UNAUTHORIZED_MESSAGE = "Sesión inválida o expirada."

router = APIRouter(prefix="/api/v1/admin", tags=["admin-auth"])


# ─────────────────────────── Envelope (§1) ──────────────────────────────────


def _envelope_ok(data: object, *, status_code: int = 200) -> JSONResponse:
    """Respuesta de éxito con el envelope congelado de api-contract §1."""
    payload = data.model_dump(mode="json") if hasattr(data, "model_dump") else data
    return JSONResponse(
        status_code=status_code,
        content={"success": True, "data": payload, "error": None, "meta": None},
    )


def _iso_z(epoch: float) -> str:
    """Epoch UTC → ISO-8601 con sufijo ``Z`` (mismo formato que los ``ts`` del WS)."""
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ─────────────────────────────── Endpoints ──────────────────────────────────


@router.post("/login")
async def login(
    payload: AdminLoginRequest,
    request: Request,
    settings: Settings = Depends(get_settings_state),
    sessions: AdminSessionStore = Depends(get_admin_sessions),
    throttle: LoginThrottle = Depends(get_admin_throttle),
) -> JSONResponse:
    """Autentica al admin y emite un token Bearer opaco (TTL fijo 8 h).

    Con el modo deshabilitado se ejecuta igualmente ``verify_password`` (dummy
    compare, tiempo constante) y se responde 401: indistinguible de contraseña
    incorrecta.
    """
    from app.services.admin_auth import verify_password

    # Comparación en tiempo constante SIEMPRE (dummy compare si deshabilitado).
    ok = verify_password(payload.password, settings.admin_password)
    if not ok:
        # BL-23: espera + incremento del backoff serializados (no evadible con
        # logins concurrentes).
        await throttle.register_failure()
        raise ApiException("UNAUTHORIZED", _UNAUTHORIZED_MESSAGE)
    await throttle.reset()
    session = sessions.create()
    result = AdminLoginResult(token=session.token, expires_at=_iso_z(session.expires_at))
    return _envelope_ok(result, status_code=200)


@router.post("/logout")
async def logout(
    request: Request,
    token: str = Depends(require_admin),
    sessions: AdminSessionStore = Depends(get_admin_sessions),
) -> JSONResponse:
    """Revoca la sesión Bearer actual (idempotente). Requiere Bearer válido."""
    sessions.revoke(token)
    return _envelope_ok(AdminLogoutResult(revoked=True))


@router.get("/session")
async def session_info(
    request: Request,
    token: str = Depends(require_admin),
    sessions: AdminSessionStore = Depends(get_admin_sessions),
) -> JSONResponse:
    """Estado de la sesión Bearer. No renueva el TTL (C4)."""
    expiry = sessions.peek_expiry(token)
    if expiry is None:
        # Expiró entre la validación del guard y este punto (borde raro).
        raise ApiException("UNAUTHORIZED", _UNAUTHORIZED_MESSAGE)
    info = AdminSessionInfo(authenticated=True, expires_at=_iso_z(expiry))
    return _envelope_ok(info)
