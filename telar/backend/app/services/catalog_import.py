"""Importar un módulo del bucket para editarlo — api-contract §11.7 (CU-37, admin).

Dos modos, y lo que los separa **es el manifiesto**, no el contenido:

* **Vinculado** (default) — es una incorporación de §11.6.1 y nada más. El
  módulo queda editable por §10 y **conserva su fila en ``installed_modules``**,
  que es lo que le permite al admin saber sobre qué versión base está editando y
  a ``publish`` exigir la siguiente. Se delega en ``module_installer``: repetir
  aquí la incorporación sería mantener dos veces la misma regla.

* **Bifurcado** (``as_module_id``) — se reescriben los ids y nace contenido
  NUEVO: ``origin='local'``, ``version=1``, ``checksum=NULL`` y **sin fila en
  ``installed_modules``**. No recibe actualizaciones porque ya no es el módulo
  del bucket: es una copia con identidad propia que se publicará bajo su id.

La reescritura del fork tiene una trampa que no se ve hasta que falla: las
``recommended`` de una lección referencian ``lesson_id``. Si solo se reprefijan
las lecciones y no sus referencias, el fork queda apuntando a las lecciones del
módulo ORIGINAL — que pueden no existir en este equipo, o peor, existir y ser
otra cosa. Se remapean también, y hay un test que lo fija.

Todas las comprobaciones sobre contenido que viene de fuera (tope de bytes,
guard, checksum, identidad, §10.6, unicidad de ids) las hace
``module_installer.descargar_y_validar``, compartida con CU-36 a propósito: una
segunda copia de esa lista sería una segunda copia que se olvida de actualizar.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.errors import ApiException
from app.repositories import content_admin
from app.schemas.admin_catalog import AdminImportRequest, AdminImportResult
from app.schemas.catalog import InstallRequest, ModuleBundle
from app.services.catalog_hash import bundle_checksum
from app.services.content_writer import _persist
from app.services.module_installer import (
    UPSERT_EXAMPLE,
    UPSERT_LESSON,
    UPSERT_QUESTION,
    ESTADO_HTTP,
    descargar_y_validar,
    dumps_json,
    install_module,
    params_ejemplo,
    params_leccion,
)
from app.services import module_installer as _inst

if TYPE_CHECKING:  # pragma: no cover - solo tipos
    import aiosqlite
    from fastapi import FastAPI

    from app.services.catalog_client import CatalogReadPort

logger = logging.getLogger("telar.catalog_import")

#: §11.7 — el módulo bifurcado nace en la 1: es contenido nuevo, no la
#: continuación de la versión del bucket de la que salió.
VERSION_INICIAL_FORK = 1

_INSERT_MODULE_LOCAL = """
INSERT INTO modules
    (id, "order", title, description, level,
     version, checksum, origin, published_at)
VALUES (?, ?, ?, ?, ?, ?, NULL, 'local', NULL)
"""


def _api(code: str, mensaje: str, *, details: Any = None) -> ApiException:
    return ApiException(
        code, mensaje, status_code=ESTADO_HTTP.get(code), details=details
    )


# ═══════════════════════════ la reescritura de ids ═══════════════════════════


def _prefijo(body: AdminImportRequest) -> str:
    """``id_prefix`` explícito, o ``as_module_id + "-"`` (§11.7).

    Un prefijo vacío explícito (``id_prefix: ""``) se respeta: significa «cambia
    el id del módulo pero deja las lecciones como están». Es legítimo cuando el
    autor quiere quedarse con los ids originales y solo republicar bajo otro
    módulo, y por eso se distingue de «no lo mandó» con ``is None``.
    """
    if body.id_prefix is not None:
        return body.id_prefix
    return f"{body.as_module_id}-"


def reescribir_bundle(
    bundle: ModuleBundle, *, as_module_id: str, prefijo: str
) -> tuple[ModuleBundle, dict[str, str]]:
    """Bundle del bucket → bundle bifurcado, + el mapa de lo que se renombró.

    Se reescriben módulo, lecciones, ejemplos, ids de pregunta **y las
    referencias ``recommended``**. Esas referencias son lo fácil de olvidar y lo
    caro de descubrir: sin remapearlas el fork apunta a lecciones del módulo
    original, que en este equipo pueden no existir o ser otra cosa.

    El ``checksum`` se recalcula para que el objeto quede internamente coherente,
    pero **no se persiste**: un fork tiene ``checksum = NULL`` en la base porque
    no corresponde a ningún objeto publicado.
    """
    datos = bundle.model_dump(mode="json")
    remap: dict[str, str] = {bundle.module.id: as_module_id}
    datos["module"]["id"] = as_module_id
    # Un fork es contenido nuevo: no hereda la versión ni la fecha del bucket.
    datos["module"]["version"] = VERSION_INICIAL_FORK

    # 1ª pasada: fijar el id nuevo de cada lección, para poder resolver después
    # las referencias cruzadas con el mapa ya completo.
    for leccion in datos["lessons"]:
        remap[leccion["id"]] = f"{prefijo}{leccion['id']}"

    for leccion in datos["lessons"]:
        viejo = leccion["id"]
        leccion["id"] = remap[viejo]
        if leccion.get("example") is not None:
            eid = leccion["example"]["id"]
            remap[eid] = f"{prefijo}{eid}"
            leccion["example"]["id"] = remap[eid]
        if leccion.get("quiz") is not None:
            for numero, pregunta in enumerate(leccion["quiz"]["questions"]):
                # El id de pregunta puede ser explícito o derivado
                # (`{lesson_id}-q{order}`, BL-18). Si es derivado se deja en
                # `None` y lo vuelve a derivar el instalador con el id NUEVO de
                # la lección; prefijarlo a mano daría `m9bis-task-intro-q1`
                # partiendo del id viejo y quedaría descuadrado.
                if pregunta.get("id"):
                    pregunta["id"] = f"{prefijo}{pregunta['id']}"
        for rec in leccion.get("recommended", []):
            # Solo se remapea lo que apunta DENTRO del bundle. Una referencia a
            # una lección de otro módulo se deja intacta: el fork no puede
            # inventarse que también se llevó ese otro contenido.
            if rec["lesson_id"] in remap:
                rec["lesson_id"] = remap[rec["lesson_id"]]

    reescrito = ModuleBundle.model_validate(datos)
    return (
        reescrito.model_copy(update={"checksum": bundle_checksum(reescrito)}),
        remap,
    )


# ════════════════════════════ escritura del fork ═════════════════════════════


async def _escribir_fork(
    db: "aiosqlite.Connection",
    bundle: ModuleBundle,
    preguntas: dict[str, list[tuple[str, Any]]],
    *,
    local_order: int,
) -> None:
    """Los INSERT del fork, SIN commit: la unidad la cierra ``_persist``.

    Mismo orden que el seeder (``modules → lessons → examples → quiz_questions``)
    y las MISMAS sentencias de lección/ejemplo/pregunta que la incorporación. Lo
    único propio es la cabecera del módulo, y es propio por las tres cosas que
    definen un fork: ``origin='local'``, ``version=1``, ``checksum=NULL``.

    **No se escribe fila en ``installed_modules``.** Es la diferencia que hace
    que el fork no reciba actualizaciones, y por eso el INSERT no existe en vez
    de existir detrás de un `if`.
    """
    modulo = bundle.module
    await db.execute(
        _INSERT_MODULE_LOCAL,
        (
            modulo.id,
            local_order,
            modulo.title,
            modulo.description,
            modulo.level,
            VERSION_INICIAL_FORK,
        ),
    )
    for leccion in bundle.lessons:
        await db.execute(UPSERT_LESSON, params_leccion(leccion, modulo.id))
    for leccion in bundle.lessons:
        if leccion.example is not None:
            await db.execute(UPSERT_EXAMPLE, params_ejemplo(leccion))
    for leccion in bundle.lessons:
        for qid, pregunta in preguntas.get(leccion.id, []):
            await db.execute(
                UPSERT_QUESTION,
                (
                    qid,
                    leccion.id,
                    pregunta.order,
                    pregunta.text,
                    dumps_json(
                        [{"key": o.key, "text": o.text} for o in pregunta.options]
                    ),
                    pregunta.correct_key,
                    pregunta.explanation,
                ),
            )


# ══════════════════════════════ caso de uso CU-37 ════════════════════════════


async def import_module(
    app: "FastAPI", body: AdminImportRequest, *, catalog: "CatalogReadPort"
) -> AdminImportResult:
    """§11.7 ``POST /api/v1/admin/catalog/import``.

    Quien decide que este despliegue no tiene catálogo (``503 CATALOG_DISABLED``)
    es el router: aquí ya llega un puerto construido.
    """
    if body.as_module_id is None:
        return await _importar_vinculado(app, body, catalog=catalog)
    return await _importar_bifurcado(app, body, catalog=catalog)


async def _importar_vinculado(
    app: "FastAPI", body: AdminImportRequest, *, catalog: "CatalogReadPort"
) -> AdminImportResult:
    """Modo vinculado: **es** una incorporación de §11.6.1.

    Se delega entera en ``module_installer``. No hay nada que añadir: el módulo
    ya queda editable por §10 —el CRUD admin no distingue por ``origin``— y la
    fila de ``installed_modules`` que escribe el instalador es justo la que
    sostiene «sé sobre qué versión base estoy editando».
    """
    resultado = await install_module(
        app,
        InstallRequest(module_id=body.module_id, version=body.version),
        catalog=catalog,
    )
    modulo = await content_admin.select_admin_module(app.state.db, body.module_id)
    assert modulo is not None  # lo acaba de escribir la misma transacción
    return AdminImportResult(
        mode="linked",
        module=modulo,
        base_version=resultado.installed_version,
        id_remap=None,
    )


async def _importar_bifurcado(
    app: "FastAPI", body: AdminImportRequest, *, catalog: "CatalogReadPort"
) -> AdminImportResult:
    """Modo fork: copia con ids propios que ya no sigue al bucket."""
    as_module_id = body.as_module_id
    assert as_module_id is not None  # lo garantiza `import_module`

    # ── 1. FUERA del write_lock: red y validación del bundle ORIGINAL ───────
    traido = await descargar_y_validar(
        app,
        InstallRequest(module_id=body.module_id, version=body.version),
        catalog=catalog,
    )

    bundle, remap = reescribir_bundle(
        traido.bundle, as_module_id=as_module_id, prefijo=_prefijo(body)
    )
    # Revalidar DESPUÉS de reescribir: los ids son otros, así que las reglas que
    # dependen de ellos —unicidad de ids de pregunta, §10.6— no las cubre lo ya
    # comprobado sobre el bundle original.
    _inst._verificar_contenido(app, bundle)
    preguntas = _inst._ids_de_preguntas(bundle)

    # ── 2. DENTRO del write_lock: comprobar la base y escribir ──────────────
    db = app.state.db
    async with app.state.write_lock:
        await _inst._verificar_modulo_libre(db, bundle.module.id)
        await _inst._verificar_ids_libres(db, bundle, preguntas)
        local_order, _ = await _inst._resolver_order(db, bundle.module.order_hint)
        await _persist(
            app,
            lambda: _escribir_fork(db, bundle, preguntas, local_order=local_order),
        )
        modulo = await content_admin.select_admin_module(db, bundle.module.id)

    assert modulo is not None
    logger.info(
        "fork de '%s' v%s → '%s' (%d ids renombrados)",
        body.module_id, traido.bundle.module.version, as_module_id, len(remap),
    )
    return AdminImportResult(
        mode="forked",
        module=modulo,
        # `None` a propósito: una copia con ids propios no tiene versión base que
        # seguir, y fingir que la tiene invitaría a «actualizarla» desde el bucket.
        base_version=None,
        id_remap=remap,
    )


__all__ = ["import_module", "reescribir_bundle", "VERSION_INICIAL_FORK"]
