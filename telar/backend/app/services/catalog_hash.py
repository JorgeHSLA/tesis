"""La definición ÚNICA del checksum de un bundle — api-contract §11.8.2.

El publicador (§11.8, admin) calcula el checksum y lo escribe **dentro** del
JSON que sube al bucket; el instalador (§11.6.1, estudiante) lo recalcula sobre
lo que descargó y lo compara (``409 CHECKSUM_MISMATCH``). Los dos usan estas
funciones y **solo** estas: si cada lado serializara por su cuenta, bastaría un
``ensure_ascii`` distinto —o un ``indent``, o un orden de claves— para que el
digest cambiara sin que cambie ni un carácter del contenido. Ese fallo no se ve
en desarrollo (el mismo proceso publica y verifica): se ve en producción, en la
máquina del estudiante, como «el módulo está corrupto» cuando no lo está.
Por eso hay un solo algoritmo, en un solo archivo, con un golden test
(``tests/test_catalog_hash.py``) que fija el digest de ``m1-v1.json`` como
literal y se rompe si alguien toca la serialización.

Definición (§11.8.2, paso 1), literal y no negociable::

    payload   = el bundle SIN su campo ``checksum``
    canónico  = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":")).encode("utf-8")
    checksum  = sha256(canónico).hexdigest()      # 64 hex, minúsculas

Dos decisiones que parecen detalles y no lo son:

* **Se excluye ``checksum``.** Está dentro del propio bundle, así que hashear el
  objeto entero sería circular: el valor a calcular formaría parte de su
  entrada. Por eso tampoco vale «hashear los bytes exactos del archivo», que es
  lo que proponía el material de diseño previo (``esquemaJson.md`` §2.3) y que
  el contrato descartó.
* **El hash es del payload, no del archivo.** El formato del archivo (``indent``,
  saltos finales, orden en que el publicador escribió las claves) es
  irrelevante: dos archivos distintos byte a byte que parseen al mismo payload
  tienen el mismo checksum. Eso es deseable —el objeto del bucket puede ser
  legible por un humano— y está probado en los tests.

Este módulo **no valida** el bundle: eso es de ``schemas/catalog.py``
(``ModuleBundle``, ``extra="forbid"``) y del servicio de instalación. Aquí solo
se serializa y se hashea. El orden correcto en el instalador es validar primero
y hashear después, porque un payload no validado puede traer campos de más que
sí entran en el digest.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any, TypeAlias

from pydantic import BaseModel

#: El único campo que se excluye del payload (ver docstring del módulo).
CAMPO_EXCLUIDO = "checksum"

#: Lo que aceptan las dos funciones: el modelo ya validado (camino normal) o el
#: ``dict`` recién parseado del JSON descargado (camino del verificador).
Bundle: TypeAlias = BaseModel | Mapping[str, Any]


class BundleHashError(ValueError):
    """El bundle no admite serialización canónica (→ ``422 BUNDLE_INVALID``).

    Es un error de FORMA, no de contenido: el payload no es un objeto JSON, o
    lleva un valor que ``json`` no sabe escribir (``NaN``, un ``set``, una clave
    que no es texto). Nunca debería dispararse con un ``ModuleBundle`` validado;
    existe porque el camino del verificador acepta ``dict`` crudos.
    """


def _payload(bundle: Bundle) -> dict[str, Any]:
    """El bundle como ``dict`` JSON-compatible y **sin** ``checksum``.

    Devuelve siempre un diccionario NUEVO: el ``dict`` que reciba el llamador
    no se toca (borrar su ``checksum`` in-place sería un efecto de borde
    invisible en el mismo objeto que luego se persiste).
    """
    if isinstance(bundle, BaseModel):
        datos: Mapping[str, Any] = bundle.model_dump(mode="json")
    elif isinstance(bundle, Mapping):
        datos = bundle
    else:
        raise BundleHashError(
            "El bundle debe ser un modelo pydantic o un mapeo JSON, "
            f"no {type(bundle).__name__}."
        )
    return {k: v for k, v in datos.items() if k != CAMPO_EXCLUIDO}


def canonical_bundle_bytes(bundle: Bundle) -> bytes:
    """Bytes canónicos del bundle sin su ``checksum`` (§11.8.2, paso 1).

    ``allow_nan=False`` es el único añadido a la llamada del contrato, y no
    cambia la salida de ningún payload válido: solo convierte en error lo que
    ``json`` escribiría como ``NaN``/``Infinity``, que no son JSON y darían un
    objeto irreparable en el bucket.
    """
    payload = _payload(bundle)
    try:
        texto = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise BundleHashError(
            f"El bundle no es serializable como JSON canónico: {exc}"
        ) from exc
    return texto.encode("utf-8")


def bundle_checksum(bundle: Bundle) -> str:
    """sha256 en hex (64 chars, minúsculas) de los bytes canónicos.

    Es el valor que va en ``ModuleBundle.checksum``, en
    ``CatalogIndexEntry.checksum`` y en ``modules.checksum``; y el que el
    instalador compara contra los tres (``409 CHECKSUM_MISMATCH``).
    """
    return hashlib.sha256(canonical_bundle_bytes(bundle)).hexdigest()


#: Campos de ``module`` que describen la PUBLICACIÓN y no el contenido. Cambian
#: en cada «Publicar» aunque no se haya tocado ni una lección: ``published_at``
#: es la hora de la llamada, ``version`` el número siguiente y ``notes`` lo que
#: el autor escriba en el diálogo. Si entraran en la huella de contenido, la
#: comparación «¿hay cambios sin publicar?» diría siempre que sí.
CAMPOS_DE_PUBLICACION = frozenset({"published_at", "version", "notes"})


def content_hash(bundle: BaseModel) -> str:
    """Huella del CONTENIDO del bundle: sha256 del JSON canónico sin metadatos.

    Es la comparación de D+ (¿el contenido local es el mismo que la versión
    publicada?), NO el checksum de §11.8.2: ``bundle_checksum`` sigue siendo el
    único que se publica y el que verifica el instalador, y no cambia.

    Excluye ``checksum`` y los `CAMPOS_DE_PUBLICACION` de ``module``. Recibe el
    modelo validado (no el ``dict`` crudo) para que los dos lados de la
    comparación —el bundle construido en local y el descargado del bucket—
    materialicen los opcionales igual: un bundle publicado sin ``notes`` y uno
    con ``notes=""`` son el mismo contenido.
    """
    datos = bundle.model_dump(mode="json")
    modulo = {
        k: v for k, v in datos.get("module", {}).items() if k not in CAMPOS_DE_PUBLICACION
    }
    return bundle_checksum({**datos, "module": modulo})


__all__ = [
    "CAMPO_EXCLUIDO",
    "CAMPOS_DE_PUBLICACION",
    "Bundle",
    "BundleHashError",
    "canonical_bundle_bytes",
    "bundle_checksum",
    "content_hash",
]
