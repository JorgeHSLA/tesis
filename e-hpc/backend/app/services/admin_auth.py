"""Autenticación admin: store de sesiones en memoria + password + throttle.

Implementa fase4-autoria-design §5.2 y api-contract §10.0 (CONGELADO), con la
corrección del lead: **no existe** ``ADMIN_DISABLED``. Cuando el modo admin está
deshabilitado (var ausente), ``login`` / ``require_admin`` responden
``401 UNAUTHORIZED`` —indistinguible de credencial errónea/token inválido— y la
comparación de contraseña es SIEMPRE en tiempo constante (``dummy compare``).

- ``AdminSessionStore``: token → epoch de expiración, TTL fijo 8 h, tope
  ``MAX_ACTIVE_SESSIONS``, purga perezosa. Operaciones síncronas y atómicas
  respecto al event loop (proceso único uvicorn, patrón ``app.state.jobs``).
  No toca DB ni ``write_lock``.
- ``verify_password``: comparación en tiempo constante (``secrets.compare_digest``);
  dummy compare + ``False`` cuando no hay contraseña configurada.
- ``LoginThrottle``: backoff incremental global por fallos consecutivos.

El backend NUNCA logea la contraseña ni su longitud.
"""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass

#: TTL fijo de la sesión admin: 8 horas (sin renovación deslizante — C4).
TOKEN_TTL_S = 8 * 60 * 60
#: Tope de sesiones activas simultáneas; al exceder se descarta la más próxima
#: a expirar (evita crecimiento no acotado del dict en memoria).
MAX_ACTIVE_SESSIONS = 16
#: Bytes de entropía del token opaco → ``secrets.token_urlsafe(32)`` (256 bits).
TOKEN_BYTES = 32

#: Backoff del throttle de login (fallos consecutivos → segundos de espera).
_THROTTLE_STEP_S = 0.5
_THROTTLE_MAX_S = 5.0


@dataclass(frozen=True)
class AdminSession:
    """Sesión admin emitida por el store (inmutable)."""

    token: str
    expires_at: float  # epoch UTC en segundos


class AdminSessionStore:
    """Sesiones admin en memoria (proceso único uvicorn).

    Operaciones síncronas y atómicas respecto al event loop (no ceden el loop),
    igual que ``app.state.jobs``. No persiste: un reinicio invalida todas las
    sesiones (aceptado — herramienta local).
    """

    def __init__(self, ttl_s: int = TOKEN_TTL_S) -> None:
        self._sessions: dict[str, float] = {}  # token → expires_at (epoch)
        self._ttl_s = ttl_s

    def _now(self, now: float | None) -> float:
        return time.time() if now is None else now

    def _purge(self, now: float) -> None:
        """Elimina las sesiones expiradas (limpieza perezosa)."""
        expired = [t for t, exp in self._sessions.items() if exp <= now]
        for token in expired:
            del self._sessions[token]

    def create(self, *, now: float | None = None) -> AdminSession:
        """Crea una sesión nueva: purga + tope + ``token_urlsafe`` opaco."""
        current = self._now(now)
        self._purge(current)
        # Tope: si aún se supera, descarta la sesión más próxima a expirar.
        while len(self._sessions) >= MAX_ACTIVE_SESSIONS:
            soonest = min(self._sessions, key=self._sessions.__getitem__)
            del self._sessions[soonest]
        token = secrets.token_urlsafe(TOKEN_BYTES)
        expires_at = current + self._ttl_s
        self._sessions[token] = expires_at
        return AdminSession(token=token, expires_at=expires_at)

    def validate(self, token: str, *, now: float | None = None) -> bool:
        """``True`` si el token existe y no ha expirado (purga perezosa)."""
        if not token:
            return False
        current = self._now(now)
        expires_at = self._sessions.get(token)
        if expires_at is None:
            return False
        if expires_at <= current:
            # Expirado: limpieza perezosa de esta entrada.
            self._sessions.pop(token, None)
            return False
        return True

    def revoke(self, token: str) -> None:
        """Invalida un token. Idempotente (no falla si no existe)."""
        self._sessions.pop(token, None)

    def peek_expiry(self, token: str) -> float | None:
        """Epoch de expiración del token si sigue vigente; ``None`` si no.

        No renueva el TTL (``GET /session`` no desliza — C4).
        """
        expires_at = self._sessions.get(token)
        if expires_at is None:
            return None
        if expires_at <= time.time():
            self._sessions.pop(token, None)
            return None
        return expires_at


def verify_password(candidate: str, configured: str) -> bool:
    """Compara la contraseña en tiempo constante (``secrets.compare_digest``).

    Cuando ``configured`` está vacío (modo admin deshabilitado) se hace un
    ``dummy compare`` con el mismo perfil temporal y se devuelve ``False``: el
    caller no puede distinguir "deshabilitado" de "contraseña incorrecta".
    """
    expected = (configured or "").strip()
    if not expected:
        # Deshabilitado: dummy compare (mismo coste temporal), sin filtrar estado.
        secrets.compare_digest(candidate.encode("utf-8"), b"\x00" * TOKEN_BYTES)
        return False
    return secrets.compare_digest(
        candidate.encode("utf-8"), expected.encode("utf-8")
    )


class LoginThrottle:
    """Backoff incremental global por fallos de login consecutivos.

    Proceso único: un contador global basta. ``delay`` crece con cada fallo y se
    aplica (``asyncio.sleep``) ANTES de responder un fallo; un login correcto lo
    resetea. Ralentiza la fuerza bruta sin bloquear indefinidamente.
    """

    def __init__(
        self, *, step_s: float = _THROTTLE_STEP_S, max_s: float = _THROTTLE_MAX_S
    ) -> None:
        self._failures = 0
        self._step_s = step_s
        self._max_s = max_s
        #: Serializa lee-espera-incrementa (BL-23): sin él, N logins fallidos
        #: concurrentes leerían el mismo contador bajo y dormirían el mismo
        #: delay corto EN PARALELO, evadiendo el backoff.
        self._lock = asyncio.Lock()

    @property
    def delay_s(self) -> float:
        """Segundos de espera para el estado actual de fallos consecutivos."""
        return min(self._step_s * self._failures, self._max_s)

    async def register_failure(self) -> None:
        """Espera el backoff actual y registra el fallo, **serializado** (BL-23).

        Bajo el lock: lee el delay del estado actual, incrementa el contador y
        SÓLO ENTONCES duerme sin soltar el lock. Así N fallos concurrentes se
        encolan y cada uno ve el contador ya incrementado por el anterior — el
        backoff crece de verdad en vez de aplicarse el mismo delay corto en
        paralelo. Preserva el perfil secuencial (el n-ésimo fallo espera
        ``step·(n-1)``).
        """
        async with self._lock:
            delay = self.delay_s
            self._failures += 1
            if delay > 0:
                await asyncio.sleep(delay)

    async def sleep_if_needed(self) -> None:
        """Espera el backoff actual (no espera si no hay fallos previos).

        Se conserva para usos de solo-espera; el camino de login usa
        ``register_failure`` (espera + incremento atómicos).
        """
        async with self._lock:
            delay = self.delay_s
        if delay > 0:
            await asyncio.sleep(delay)

    def record_failure(self) -> None:
        """Incrementa el contador de fallos SIN espera ni lock.

        SOLO para tests unitarios de ``LoginThrottle``. El camino de login de
        producción usa ``register_failure`` (espera + incremento serializados,
        BL-23); NO usar ``record_failure`` ahí o se reintroduce la carrera.
        """
        self._failures += 1

    async def reset(self) -> None:
        """Resetea el contador de fallos (login correcto), bajo el mismo lock.

        Serializado con ``register_failure`` (BL-23): un login correcto que
        corre a la vez que una ráfaga de fallos concurrentes no puede pisar el
        contador a mitad de la ventana espera-incremento — espera a que el fallo
        en vuelo termine antes de resetear.
        """
        async with self._lock:
            self._failures = 0
