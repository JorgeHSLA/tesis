"""DTOs del catálogo del lado ADMIN — api-contract §11.7, §11.8, §11.11.4.

Transcripción literal del contrato, igual que ``schemas/catalog.py`` lo es de
§11.11.3. Viven aparte porque son de la **imagen admin**: el ``Dockerfile``
borra este archivo, ``routers/admin_catalog.py`` y ``services/catalog_publisher``
cuando ``TELAR_ADMIN_BUILD=0``, de modo que la imagen del estudiante no lleva ni
los tipos de una operación que no puede hacer (§11.2).

Nada de aquí viaja a la imagen del estudiante y nada de aquí toca la red: el
transporte lo pone ``services/catalog_publisher`` detrás de un ``Protocol``, del
mismo modo que ``CatalogReadPort`` lo hace para leer.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .admin import ID_PATTERN, AdminModule
from .catalog import CHECKSUM_PATTERN, OBJECT_PATH_PATTERN, ContentWarning

#: §11.8.1 — por qué una credencial no sirve. Vocabulario CERRADO, y ninguno de
#: sus valores se deriva del texto de una excepción: el detalle real va al log.
#: Sin esto sería tentador devolver ``str(exc)``, que en el caso de una clave de
#: cuenta de servicio puede llevar dentro la ruta del archivo o el correo de la
#: cuenta.
CredentialReason = Literal[
    "absent",  # TELAR_GCS_CREDENTIALS vacío
    "unreadable",  # el archivo no existe o no se puede abrir
    "insecure_mode",  # permisos más laxos que 0600
    "malformed",  # no es una clave de cuenta de servicio
    "forbidden",  # la cuenta no puede escribir en el bucket (solo con ?probe)
]


class AdminCatalogCredentialStatus(BaseModel):
    """§11.8.1 — estado de la clave de la cuenta de servicio. SOLO LECTURA.

    Existe para que el diálogo de autoría pueda decir *por qué* no se puede
    publicar **antes** de que el admin escriba nada, en vez de dejarle descubrir
    el problema cuando pulse «Publicar» y pierda el contexto.

    Se responde ``200`` incluso cuando la credencial es inservible (§11.9): que
    la clave falte es un estado normal de un despliegue de estudiante, no un
    error del servidor.
    """

    #: ``TELAR_GCS_CREDENTIALS`` no está vacío.
    configured: bool
    #: Parsea, los permisos son correctos y —si se pidió ``?probe=true``— la
    #: cuenta autoriza sobre el bucket.
    usable: bool
    #: Correo de la cuenta de servicio. Identifica *quién* publica, que es justo
    #: lo que el admin necesita ver para saber si es la cuenta que cree.
    client_email: str | None = None
    project_id: str | None = None
    bucket: str | None = None
    #: p. ej. ``"0600"``. ``None`` si el archivo no se pudo consultar.
    file_mode: str | None = None
    #: ¿Se contactó realmente con el bucket? Solo con ``?probe=true``. Se declara
    #: porque ``usable: true`` significa cosas distintas según se haya salido a
    #: la red o no, y adivinarlo desde el cliente sería adivinar.
    probed: bool = False
    #: NUNCA el texto crudo de la excepción.
    reason: CredentialReason | None = None


# ─────────────────────────── §11.7 CU-37 · importar ──────────────────────────


class AdminImportRequest(BaseModel):
    """§11.7 ``POST /api/v1/admin/catalog/import``.

    ``as_module_id``/``id_prefix`` producen un **fork**: una copia con ids
    propios que ya no se actualiza desde el bucket. Sin ellos el import es
    **linked** y conserva el vínculo con la versión publicada.
    """

    module_id: str = Field(pattern=ID_PATTERN)
    version: int | None = Field(default=None, ge=1)
    as_module_id: str | None = Field(default=None, pattern=ID_PATTERN)
    id_prefix: str | None = Field(default=None, max_length=32)


class AdminImportResult(BaseModel):
    mode: Literal["linked", "forked"]
    module: AdminModule
    #: ``None`` en fork: una copia con ids propios no tiene versión base que
    #: seguir, y fingir que la tiene invitaría a «actualizarla» desde el bucket.
    base_version: int | None = None
    #: ``None`` en linked. En fork, qué id pasó a ser cuál, para que la UI pueda
    #: enseñarlo en vez de dejar al admin comparar a ojo.
    id_remap: dict[str, str] | None = None


# ─────────────────────────── §11.8 CU-38 · publicar ──────────────────────────


class AdminPublishRequest(BaseModel):
    """§11.8.2 ``POST /api/v1/admin/modules/{module_id}/publish``.

    ``dry_run`` **no escribe en el bucket**: valida, serializa y calcula el
    checksum. Es la vía para ver los avisos de §11.8.2 —sobre todo
    ``LESSON_ID_REMOVED``, que anuncia pérdida de avance aguas abajo— antes de
    que la versión sea inmutable y ya no haya vuelta atrás.
    """

    #: Default: ``modules.version + 1``. Debe ser ESTRICTAMENTE mayor que la
    #: última publicada, o ``409 VERSION_CONFLICT``.
    version: int | None = Field(default=None, ge=1)
    dry_run: bool = False
    notes: str = Field(default="", max_length=2000)


class AdminPublishResult(BaseModel):
    #: ``False`` con ``dry_run``: el mismo shape sirve para ensayar y para
    #: publicar, y este campo es lo que los distingue sin ambigüedad.
    published: bool
    module_id: str
    version: int
    checksum: str = Field(pattern=CHECKSUM_PATTERN)
    object_path: str = Field(pattern=OBJECT_PATH_PATTERN)
    #: ``generation`` de GCS del objeto subido. ``None`` con ``dry_run`` o si el
    #: transporte no versiona (driver local).
    generation: int | None = None
    bytes: int
    published_at: str
    #: El bundle puede quedar subido y el índice no (§11.8.2 paso 4): son dos
    #: objetos y dos escrituras. Se declara en vez de suponerse.
    index_updated: bool = False
    lesson_ids: list[str] = Field(default_factory=list)
    warnings: list[ContentWarning] = Field(default_factory=list)
    #: S5 (aditivo, CU-37.4): ``False`` si el bucket quedó publicado pero no se
    #: pudo guardar en local la versión publicada. La publicación NO se deshace
    #: —ya es inmutable—; reintentar la reconcilia sin crear otra versión.
    local_state_updated: bool = True


#: S5 (D+) — qué hay entre el contenido local y lo publicado.
PublishState = Literal[
    "never_published",  # el índice no tiene este módulo
    "unchanged",  # mismo contenido que la versión vigente del índice
    "changed",  # hay cambios sin publicar
    "out_of_sync",  # publicado en la nube, pero el estado local no lo registró
    "unknown",  # no se pudo leer el catálogo (sin red, sin bucket…)
]


class AdminPublishStatus(BaseModel):
    """S5 ``GET /admin/modules/{id}/publish/status`` — ¿hay cambios sin publicar?

    Compara ``content_hash`` (contenido sin metadatos de publicación) del bundle
    que se construiría ahora con el de la versión vigente del índice, leído SIN
    caché. No escribe nada, ni en local ni en el bucket.
    """

    module_id: str
    state: PublishState
    #: Versión vigente en el índice. ``None`` si no está o no se pudo leer.
    published_version: int | None = None
    #: Última versión que este equipo registró como publicada. ``None`` si nunca.
    local_version: int | None = None
    #: Huella del contenido local (64 hex).
    content_hash: str = Field(pattern=CHECKSUM_PATTERN)
    #: Solo con ``state="unknown"``: ``"disabled"`` o el ``reason`` de §11.3.
    reason: str | None = None


__all__ = [
    "AdminCatalogCredentialStatus",
    "AdminImportRequest",
    "AdminImportResult",
    "AdminPublishRequest",
    "AdminPublishResult",
    "AdminPublishStatus",
    "CredentialReason",
    "PublishState",
]
