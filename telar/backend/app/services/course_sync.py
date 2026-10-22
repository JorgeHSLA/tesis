"""Descarga del curso completo desde el catálogo — ``POST /api/v1/catalog/sync``.

El contenido del curso ya no viaja dentro de la app: vive en el catálogo de la
nube (el bucket) y cada instalación lo descarga. Esta unidad incorpora, en el
orden del índice, todos los módulos publicados que este equipo todavía no
tiene. El frontend la llama al arrancar, así que una instalación nueva se llena
sola y un módulo que se publique después llega en la siguiente apertura.

Reglas:

* **Una vez por módulo.** Cada módulo que se incorpora (o que ya estaba
  incorporado) queda anotado en ``app_meta['course_sync_seen']``. Si el
  estudiante lo quita después, no vuelve a aparecer solo: lo puede incorporar
  otra vez desde «Módulos disponibles».
* **Contenido base heredado.** Las versiones de la app anteriores a la 1.0.10
  sembraban ``m1``–``m8`` desde el código, sin manifiesto. Esos módulos se
  cambian por su versión de la nube en una sola transacción y el avance se
  conserva (los ``lesson_id`` son los mismos). Un id tomado por cualquier
  otro módulo local no se toca.
* **Autoría no se llena sola.** En modo admin la base es la del autor: lo que
  hay ahí es lo que se publica, así que no se mezcla con el catálogo.
* **Un fallo no corta el resto.** Cada módulo que falla se informa y se
  reintenta en la siguiente sincronización; los demás se incorporan igual.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING

from app.errors import ApiException
from app.repositories import catalog as catalog_repo
from app.repositories import content_admin
from app.schemas.catalog import CourseSyncFailure, CourseSyncResult, InstallRequest
from app.services import module_installer
from app.services.catalog_client import CatalogReadPort

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    import aiosqlite
    from fastapi import FastAPI

logger = logging.getLogger("telar.course_sync")

#: Módulos que las versiones ≤ 1.0.9 sembraban desde el código. Solo estos ids
#: se reemplazan por su versión de la nube cuando ya existen sin manifiesto.
LEGACY_BASE_MODULE_IDS = frozenset({"m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"})

#: Clave de ``app_meta`` con los módulos que la sincronización ya atendió.
SEEN_KEY = "course_sync_seen"


async def _leer_vistos(db: "aiosqlite.Connection") -> set[str]:
    cursor = await db.execute("SELECT value FROM app_meta WHERE key = ?", (SEEN_KEY,))
    fila = await cursor.fetchone()
    if fila is None:
        return set()
    try:
        valor = json.loads(fila[0])
    except (TypeError, ValueError):
        return set()
    return {v for v in valor if isinstance(v, str)} if isinstance(valor, list) else set()


async def _guardar_vistos(app: "FastAPI", vistos: set[str]) -> None:
    db = app.state.db
    async with app.state.write_lock:
        await db.execute(
            "INSERT INTO app_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (SEEN_KEY, json.dumps(sorted(vistos))),
        )
        await db.commit()


def _lock_de(app: "FastAPI") -> asyncio.Lock:
    """Una sola sincronización a la vez: dos pestañas (o el doble efecto de
    React en desarrollo) no deben incorporar el mismo módulo dos veces."""
    lock = getattr(app.state, "course_sync_lock", None)
    if lock is None:
        lock = asyncio.Lock()
        app.state.course_sync_lock = lock
    return lock


async def sincronizar_curso(
    app: "FastAPI", *, catalog: CatalogReadPort
) -> CourseSyncResult:
    """Incorpora los módulos del catálogo que faltan en este equipo."""
    settings = app.state.settings
    if settings.admin_enabled:
        return CourseSyncResult(installed=[], replaced=[], failed=[], skipped="admin")

    async with _lock_de(app):
        db = app.state.db
        indice = await module_installer.fetch_index(
            catalog, max_bytes=int(settings.catalog_max_bundle_bytes)
        )
        vistos = await _leer_vistos(db)
        instalados = {fila.module_id for fila in await catalog_repo.list_installed(db)}
        locales = set(await content_admin.all_module_orders(db))

        nuevos: list[str] = []
        reemplazados: list[str] = []
        fallidos: list[CourseSyncFailure] = []
        # Lo que ya está incorporado cuenta como atendido: si el estudiante lo
        # quita más adelante, la sincronización no se lo vuelve a poner.
        atendidos = vistos | (instalados & {e.id for e in indice.modules})

        for entrada in sorted(indice.modules, key=lambda e: (e.order_hint, e.id)):
            if entrada.id in atendidos:
                continue
            reemplazar = entrada.id in locales
            if reemplazar and entrada.id not in LEGACY_BASE_MODULE_IDS:
                # Un módulo local que no es el base heredado (p. ej. creado a
                # mano): no se pisa ni se marca, por si deja de existir.
                continue
            try:
                await module_installer.install_module(
                    app,
                    InstallRequest(
                        module_id=entrada.id,
                        version=entrada.version,
                        expected_checksum=entrada.checksum,
                    ),
                    catalog=catalog,
                    index=indice,
                    reemplazar_local=reemplazar,
                )
            except ApiException as exc:
                logger.warning("sync: %s no se incorporó (%s)", entrada.id, exc.code)
                fallidos.append(
                    CourseSyncFailure(
                        module_id=entrada.id, code=exc.code, message=exc.message
                    )
                )
                continue
            atendidos.add(entrada.id)
            (reemplazados if reemplazar else nuevos).append(entrada.id)

        if atendidos != vistos:
            await _guardar_vistos(app, atendidos)

    return CourseSyncResult(installed=nuevos, replaced=reemplazados, failed=fallidos)


__all__ = ["LEGACY_BASE_MODULE_IDS", "SEEN_KEY", "sincronizar_curso"]
