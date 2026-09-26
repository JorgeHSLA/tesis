"""El ``module_id`` de la ruta de publicación se valida con ``ID_PATTERN``.

``POST``/``DELETE /admin/modules/{id}/publish`` y ``GET .../publish/status``
recibían el id sin validar: un id mal formado llegaba al repositorio (y, al
publicar o retirar, a las rutas de objeto del bucket). Ahora FastAPI lo rechaza
con ``422 VALIDATION_ERROR`` antes de entrar al handler, igual que los ids que
llegan en el cuerpo (``AdminImportRequest``).
"""

# Los fixtures importados se reciben como parámetros del mismo nombre.
# ruff: noqa: F811

from __future__ import annotations

import pytest

from test_admin_catalog import falla, ok
from test_publicacion_garantias import (  # noqa: F401 — fixtures
    ESTADO,
    PUBLICAR,
    catalogo,
    cliente,
    raiz,
)

IDS_INVALIDOS = [
    "m1..x",  # puntos (candidato a salto de ruta en el bucket)
    "a..",  # «..» a secas lo normaliza el cliente HTTP y ni llega a la ruta
    "m 1",  # espacio
    "1m",  # no empieza por letra
    "a" * 65,  # demasiado largo
]


@pytest.mark.parametrize("module_id", IDS_INVALIDOS)
def test_publicar_con_id_mal_formado_es_422(cliente, module_id):
    falla(
        cliente.post(PUBLICAR.format(module_id), json={"dry_run": True}),
        422,
        "VALIDATION_ERROR",
    )


@pytest.mark.parametrize("module_id", IDS_INVALIDOS)
def test_estado_con_id_mal_formado_es_422(cliente, module_id):
    falla(cliente.get(ESTADO.format(module_id)), 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("module_id", IDS_INVALIDOS)
def test_retirar_con_id_mal_formado_es_422(cliente, module_id):
    falla(cliente.delete(PUBLICAR.format(module_id)), 422, "VALIDATION_ERROR")


def test_los_ids_validos_siguen_funcionando(cliente):
    ok(cliente.post(PUBLICAR.format("m1"), json={}), 201)
    ok(cliente.get(ESTADO.format("m1")))
    ok(cliente.delete(PUBLICAR.format("m1")))


def test_un_id_valido_inexistente_sigue_siendo_404(cliente):
    falla(cliente.get(ESTADO.format("noExiste")), 404, "MODULE_NOT_FOUND")
    falla(cliente.post(PUBLICAR.format("noExiste"), json={}), 404, "MODULE_NOT_FOUND")
