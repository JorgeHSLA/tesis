"""FakeCatalogService — implementación EN MEMORIA de ``CatalogReadPort``.

Al estilo de ``tests/fakes/fake_docker.py``: cumple estructuralmente el
``typing.Protocol`` de ``app.services.catalog_client`` sobre un
``dict[str, bytes]`` que hace de bucket, sin abrir un solo socket. Es la costura
que permite que TODA la suite de §11 (catálogo, instalador, actualizador,
routers) corra sin red ni GCP.

Dos cosas que el fake sostiene a propósito, porque un fake permisivo es peor
que no tener fake:

* **Respeta ``max_bytes``.** El tope pertenece al puerto (§11.2): si el fake lo
  ignorase, los tests del instalador pasarían en verde con bundles gigantes que
  producción rechaza.
* **Lanza las MISMAS excepciones que el adaptador real**
  (`CatalogObjectNotFound`, `CatalogObjectTooLarge`, `CatalogGenerationMismatch`,
  `CatalogUnavailable`), no ``Exception`` genéricas: así los tests de los
  routers ejercitan la traducción a ``404/409/413/503`` de verdad.
"""

from __future__ import annotations

import json
from typing import Any

from app.services.catalog_client import (
    CatalogObject,
    CatalogObjectNotFound,
    CatalogObjectTooLarge,
    CatalogGenerationMismatch,
    CatalogUnavailable,
    object_path_for,
)

#: Mismos defaults que ``Settings`` (§11.1), para que el fake y el adaptador
#: real deriven la MISMA ruta de objeto a partir de ``(module_id, version)``.
PREFIJO_POR_DEFECTO = "modulos/"
INDICE_POR_DEFECTO = "modulos/index.json"


def a_bytes(payload: bytes | str | dict[str, Any]) -> bytes:
    """Normaliza el guion a bytes.

    Para tests que comprueban el sha256 hay que pasar los BYTES exactos que
    produce ``services/catalog_hash`` (§11.8.2): el ``json.dumps`` de aquí es
    una comodidad para los tests que no miran el checksum, no la serialización
    canónica del contrato.
    """
    if isinstance(payload, bytes):
        return payload
    if isinstance(payload, str):
        return payload.encode("utf-8")
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class FakeCatalogService:
    """Implementa ``CatalogReadPort``; el bucket es un dict de ruta → bytes."""

    def __init__(
        self,
        *,
        prefix: str = PREFIJO_POR_DEFECTO,
        index_path: str = INDICE_POR_DEFECTO,
    ) -> None:
        self.prefix = prefix
        self.index_path = index_path
        #: El «bucket»: ruta de objeto → bytes crudos.
        self.objetos: dict[str, bytes] = {}
        #: Generación por objeto (ancla de versión, §11.6.1).
        self.generaciones: dict[str, int] = {}
        #: Guion de fallos: ruta de objeto → excepción a lanzar en su lectura.
        self.errores: dict[str, Exception] = {}
        #: Registro de llamadas, para que los tests afirmen sobre el tope.
        self.index_calls: list[dict[str, Any]] = []
        self.module_calls: list[dict[str, Any]] = []
        self.cerrado = False

    # ── guiones ──────────────────────────────────────────────────────────────

    def publicar_indice(
        self, payload: bytes | str | dict[str, Any], *, generation: int | None = None
    ) -> str:
        """Deja el índice en el bucket. Devuelve su ruta."""
        return self._poner(self.index_path, payload, generation)

    def publicar_modulo(
        self,
        module_id: str,
        version: int,
        payload: bytes | str | dict[str, Any],
        *,
        generation: int | None = None,
    ) -> str:
        """Deja ``<prefix><module_id>/v<version>.json``. Devuelve su ruta."""
        return self._poner(
            object_path_for(self.prefix, module_id, version), payload, generation
        )

    def fallar_indice(self, error: Exception) -> None:
        """El próximo (y siguientes) ``fetch_index`` lanza ``error``."""
        self.errores[self.index_path] = error

    def fallar_modulo(self, module_id: str, version: int, error: Exception) -> None:
        """``fetch_module(module_id, version)`` lanza ``error``."""
        self.errores[object_path_for(self.prefix, module_id, version)] = error

    def _poner(
        self,
        object_path: str,
        payload: bytes | str | dict[str, Any],
        generation: int | None,
    ) -> str:
        self.objetos[object_path] = a_bytes(payload)
        if generation is not None:
            self.generaciones[object_path] = generation
        return object_path

    # ── CatalogReadPort ──────────────────────────────────────────────────────

    async def fetch_index(
        self, *, max_bytes: int, sin_cache: bool = False
    ) -> CatalogObject:
        # Se registra `sin_cache` para que un test pueda exigir que la relectura
        # forzada lo pida — el fake no tiene caché de borde que romper, pero sí
        # es donde se comprueba que el router lo propaga.
        self.index_calls.append({"max_bytes": max_bytes, "sin_cache": sin_cache})
        if self.index_path not in self.objetos and self.index_path not in self.errores:
            # Igual que el adaptador real: el índice no es «un módulo», así que
            # su ausencia es catálogo inservible, no REMOTE_MODULE_NOT_FOUND.
            raise CatalogUnavailable("server", causa="índice inexistente")
        return self._leer(self.index_path, max_bytes=max_bytes, generation=None)

    async def fetch_module(
        self,
        module_id: str,
        version: int,
        *,
        max_bytes: int,
        generation: int | None = None,
    ) -> CatalogObject:
        self.module_calls.append(
            {
                "module_id": module_id,
                "version": version,
                "max_bytes": max_bytes,
                "generation": generation,
            }
        )
        try:
            object_path = object_path_for(self.prefix, module_id, version)
        except ValueError as exc:
            raise CatalogObjectNotFound(f"{module_id}/v{version}") from exc
        return self._leer(object_path, max_bytes=max_bytes, generation=generation)

    async def aclose(self) -> None:
        self.cerrado = True

    # ── lectura común ────────────────────────────────────────────────────────

    def _leer(
        self, object_path: str, *, max_bytes: int, generation: int | None
    ) -> CatalogObject:
        if max_bytes < 1:
            raise ValueError(f"max_bytes debe ser >= 1, no {max_bytes!r}")
        error = self.errores.get(object_path)
        if error is not None:
            raise error
        datos = self.objetos.get(object_path)
        if datos is None:
            raise CatalogObjectNotFound(object_path)
        guardada = self.generaciones.get(object_path)
        if generation is not None and guardada is not None and guardada != generation:
            raise CatalogGenerationMismatch(object_path, generation)
        if len(datos) > max_bytes:
            # El tope es del PUERTO: el fake corta igual que el adaptador real.
            raise CatalogObjectTooLarge(object_path, max_bytes, len(datos))
        return CatalogObject(
            object_path=object_path, data=datos, generation=guardada
        )
