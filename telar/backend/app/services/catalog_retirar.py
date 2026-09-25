"""Retirar un módulo del catálogo — api-contract §11.8.4 (CU-41.1, admin).

«Curso» = el módulo publicable, así que retirar un curso es quitar SU entrada
del índice. Nada más: los bundles se quedan en el bucket y el estado local de
publicación no se toca. Reutiliza las piezas del índice de ``catalog_publish``
(lectura estricta, ``_indice_con`` y el CAS con un reintento) para que publicar
y retirar no puedan divergir en cómo tratan el índice de los demás módulos.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.schemas.admin_catalog import AdminUnpublishResult
from app.services.catalog_publish import _ahora_iso as ahora_iso
from app.services.catalog_publish import _entradas_del_indice as entradas_del_indice
from app.services.catalog_publish import _indice_con as indice_con
from app.services.catalog_publish import _traducir_transporte as traducir_transporte
from app.services.catalog_publisher import (
    CatalogWritePort,
    IndexCasFailed,
    PublisherUnavailable,
)
from app.services.catalog_publisher import _api as api_error

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    from app.config import Settings

logger = logging.getLogger("telar.catalog_retirar")


async def retirar_modulo(
    settings: "Settings", publisher: CatalogWritePort, module_id: str
) -> AdminUnpublishResult:
    """§11.8.4 CU-41.1 — quita ``module_id`` del índice. No borra bundles.

    Mismo CAS con UN reintento que al publicar. Los bundles se quedan: son
    inmutables, quien ya incorporó el módulo lo sigue verificando contra ellos,
    y borrar la versión dejaría libre un número que otro equipo ya instaló.
    Aquí no se escribe nada local: si esto falla, el router no ha tocado nada.
    """
    if not settings.catalog_enabled:
        raise api_error("CATALOG_DISABLED", "Este despliegue no tiene catálogo remoto.")
    for intento in (1, 2):
        try:
            crudo, generation = await publisher.read_index()
        except PublisherUnavailable as exc:
            raise traducir_transporte(exc) from exc
        vigente = next(
            (e for e in entradas_del_indice(crudo) if e.id == module_id), None
        )
        if vigente is None:
            raise api_error(
                "REMOTE_MODULE_NOT_FOUND",
                f"El módulo '{module_id}' no está en el catálogo remoto.",
            )
        datos = indice_con(crudo, None, ahora_iso(), sin=module_id)
        try:
            await publisher.write_index(datos, if_generation_match=generation)
        except IndexCasFailed:
            logger.warning("CAS del índice falló al retirar (intento %d)", intento)
            continue
        except PublisherUnavailable as exc:
            raise traducir_transporte(exc) from exc
        logger.info("retirado %s (v%s) del índice", module_id, vigente.version)
        return AdminUnpublishResult(module_id=module_id, retired_version=vigente.version)
    raise api_error(
        "VERSION_CONFLICT",
        "El índice cambió mientras se retiraba el módulo; no se retiró, "
        "vuelve a intentarlo.",
        details={"stage": "index", "index_updated": False},
    )


__all__ = ["retirar_modulo"]
