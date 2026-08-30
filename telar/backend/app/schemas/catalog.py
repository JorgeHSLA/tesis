"""DTOs pydantic (v2) del contrato de API de Telar — §11 Catálogo remoto (Fase 5).

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` §11.11.1
(CONGELADO). No añadir, quitar ni renombrar campos sin actualizar el contrato
primero. Espejo TS: ``frontend/src/api/catalog-types.ts`` (§11.11.3).

Dos familias de modelos conviven aquí y NO se tratan igual:

* **Formato de intercambio** (§11.10): ``ModuleBundle``, ``CatalogIndex`` y todo
  lo que cuelga de ellos. Sale del bucket, o sea **ENTRADA NO CONFIABLE**: el
  mismo rigor que el ``.py`` del estudiante. Heredan de ``_Strict``
  (``extra="forbid"``, regla explícita de §11.10) y llevan tope de longitud en
  todo campo de texto y patrón restrictivo en todo id. Un campo de más en un
  bundle es señal de que algo no cuadra, no de tolerancia.
* **Respuestas** (§11.4/§11.5/§11.6): las construye el servidor a partir de lo
  ya validado, así que se transcriben tal cual, sin endurecer.

Lo que este módulo NO hace, a propósito: no valida la URL de YouTube
(``services/youtube.py`` la valida y **normaliza**), no valida el markdown
(``services/markdown_validator.py``) y no comprueba el sha256. Todo eso son
reglas de negocio de §10.6/§11.10 que ocurren en el servicio, **fuera** del
``write_lock`` y con el resultado en ``422 CONTENT_VALIDATION_ERROR``; un DTO
solo puede responder ``422 BUNDLE_INVALID``, que es otra cosa.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .admin import (
    ID_PATTERN,
    AdminExampleBase,
    AdminQuizOption,
    AdminQuizQuestion,
    AdminRecommended,
)

#: §11.10 — versión del formato del bundle. Un valor distinto ⇒ ``BUNDLE_INVALID``.
BUNDLE_FORMAT = 1
#: §11.10 — versión del formato del índice del bucket.
INDEX_FORMAT = 1
#: sha256 en hex, 64 chars. Minúsculas: es la forma que emite ``hexdigest()`` y
#: aceptar ambas obligaría a normalizar antes de comparar checksums.
CHECKSUM_PATTERN = r"^[0-9a-f]{64}$"
#: ruta de objeto en el bucket.
OBJECT_PATH_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$"
#: Marca de tiempo ISO-8601 con zona explícita, la forma que ya emiten el
#: backend (``strftime('%Y-%m-%dT%H:%M:%fZ')``) y el publicador de §11.8.
#: Endurecimiento sobre la transcripción: ``published_at`` viene del bucket y
#: sin patrón sería un texto libre que acaba pintado en la UI.
TIMESTAMP_PATTERN = (
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$"
)

CompletionRule = Literal["quiz", "viewed", "run"]  # E4
ModuleOrigin = Literal["local", "remote"]
RemoteState = Literal["available", "installed", "update_available"]
InstalledState = Literal["local_only", "installed", "update_available"]
CatalogSource = Literal["network", "cache"]
#: §11.6.2 — `archived` y `rescored`, no «huérfano» ni «reset». Una lección
#: retirada CONSERVA su fila y su progreso (si se borrara, el historial de
#: jobs quedaría apuntando a un id sin título resoluble), y una nota se
#: RECALCULA sin que el aprobado ya ganado se revoque nunca.
ProgressEffect = Literal["preserved", "rescored", "archived", "none"]
LessonChange = Literal["added", "updated", "unchanged", "removed"]


# ── §11.10 Formato de intercambio (ENTRADA NO CONFIABLE) ─────────────────────


class _Strict(BaseModel):
    """Base de todo lo que llega del bucket: ningún campo desconocido pasa.

    §11.10, última regla: «Todos los DTOs de bundle usan
    ``model_config = ConfigDict(extra="forbid")``». Con ``extra="ignore"`` (el
    default de pydantic) un bundle con un campo inventado se instalaría en
    silencio, y el silencio es exactamente lo que no queremos de una fuente que
    no controlamos.
    """

    model_config = ConfigDict(extra="forbid")


class BundleRecommended(_Strict, AdminRecommended):
    """§11.10 ``lessons[].recommended[]`` — versión estricta de ``AdminRecommended``.

    Mismos campos que §10.2; existe porque ``AdminRecommended`` es tolerante a
    campos extra (viene del admin, que es de confianza) y aquí el objeto llega
    del bucket. Además el ``lesson_id`` gana patrón: es una referencia que el
    validador resolverá contra la DB.
    """

    lesson_id: str = Field(pattern=ID_PATTERN)


class BundleQuizOption(_Strict, AdminQuizOption):
    """§11.10 ``lessons[].quiz.questions[].options[]`` — opción estricta y acotada."""

    text: str = Field(min_length=1, max_length=2000)


class BundleExample(_Strict, AdminExampleBase):
    """§11.10 ``lessons[].example`` — ejemplo del bundle. E1: id PROPIO, ya no == lesson_id.

    Los campos redeclarados NO amplían el shape de ``AdminExampleBase``: le
    ponen tope a los textos que allí quedaron sin acotar porque el autor era de
    confianza. ``source_code`` es la excepción deliberada (ver abajo).
    """

    id: str = Field(pattern=ID_PATTERN)
    # BL-17: el tope de bytes del código se aplica en RUNTIME
    # (``settings.max_code_bytes``, §11.6.1 paso 1), no como cap estático, para
    # que subir o bajar TELAR_MAX_CODE_BYTES afecte por igual al admin y al bundle.
    source_code: str = Field(min_length=1)
    teaches: str = Field(min_length=1, max_length=2000)
    directives: list[str] = Field(max_length=20)
    fixed_threads_note: str | None = Field(default=None, max_length=400)
    expected_output_note: str = Field(max_length=2000)
    takeaways: list[str] = Field(min_length=1, max_length=10)


class BundleQuizQuestion(_Strict, AdminQuizQuestion):
    """§11.10 ``lessons[].quiz.questions[]``.

    Idéntico a §10.5; ``id`` opcional (se autogenera ``{lesson_id}-q{order}``
    en ``content_writer``). Los redeclarados solo acotan longitudes y fuerzan la
    variante estricta de la opción.
    """

    text: str = Field(min_length=1, max_length=2000)
    options: list[BundleQuizOption] = Field(min_length=2, max_length=4)
    explanation: str = Field(min_length=1, max_length=4000)


class BundleQuiz(_Strict):
    """§11.10 ``lessons[].quiz`` — el set completo de preguntas de una lección."""

    pass_threshold: float = Field(gt=0.0, le=1.0)
    questions: list[BundleQuizQuestion] = Field(min_length=1, max_length=50)


class BundleLesson(_Strict):
    """§11.10 ``lessons[]`` — una lección del bundle.

    ``example`` y ``quiz`` son NULLABLES (E1/E4: una lección teórica no necesita
    ni código ni quiz). La coherencia entre ``completion_rule`` y esos dos
    campos es regla de negocio, no de esquema: se comprueba en el servicio y
    responde ``422 CONTENT_VALIDATION_ERROR``, no ``BUNDLE_INVALID``.
    """

    id: str = Field(pattern=ID_PATTERN)
    order: int = Field(ge=1)  # E2: único POR MÓDULO
    title: str = Field(min_length=1, max_length=160)
    estimated_minutes: int = Field(ge=1, le=600)
    content_markdown: str = Field(min_length=1, max_length=65536)
    #: YouTube, POR LECCIÓN (§11.10). El bundle transporta el enlace, nunca el
    #: medio. ``services/youtube.py`` extrae el id de 11 chars y RECONSTRUYE la
    #: URL canónica al instalar: nada del original sobrevive salvo ese id.
    video_url: str | None = Field(default=None, max_length=2048)
    enabled: bool = True  # E1: columna propia, ya no derivada del ejemplo
    completion_rule: CompletionRule = "quiz"  # E4
    pass_threshold: float = Field(default=0.6, gt=0.0, le=1.0)
    recommended: list[BundleRecommended] = Field(default_factory=list, max_length=6)
    example: BundleExample | None = None  # E1: opcional
    quiz: BundleQuiz | None = None


class BundleModule(_Strict):
    """§11.10 ``module`` — la cabecera del módulo publicable.

    No trae ``order`` local ni progreso: ``order_hint`` es una sugerencia del
    autor y ``modules."order"`` es UNIQUE global, así que el instalador puede
    reasignarlo (§11.6.1, paso 4). Cero PII por construcción del esquema.
    """

    id: str = Field(pattern=ID_PATTERN)
    order_hint: int = Field(ge=1)  # sugerencia, no el order local
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=2000)
    level: str = Field(min_length=1, max_length=40)
    version: int = Field(ge=1)  # MONÓTONA
    published_at: str = Field(pattern=TIMESTAMP_PATTERN)
    author_label: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2000)


class ModuleBundle(_Strict):
    """§11.10 — el JSON publicado en ``modulos/<id>/v<version>.json`` (INMUTABLE).

    ``checksum`` NO entra en su propio cálculo: se calcula sobre el bundle
    **sin** ese campo, con la serialización canónica de §11.8.2. El instalador
    lo compara contra el sha256 de los bytes descargados y contra el del índice
    (``409 CHECKSUM_MISMATCH``).
    """

    bundle_format: Literal[1]
    checksum: str = Field(pattern=CHECKSUM_PATTERN)
    module: BundleModule
    lessons: list[BundleLesson] = Field(min_length=1, max_length=100)


class CatalogIndexEntry(_Strict):
    """§11.10 ``modules[]`` del índice — el resumen que permite listar sin descargar.

    El índice es una CONVENIENCIA; la verdad es el bundle. Por eso ``checksum``
    aquí es una promesa que se verifica contra el bundle real, no un dato en el
    que se confíe.
    """

    id: str = Field(pattern=ID_PATTERN)
    title: str = Field(max_length=160)
    description: str = Field(default="", max_length=2000)
    level: str = Field(default="", max_length=40)
    order_hint: int = Field(ge=1)
    version: int = Field(ge=1)
    checksum: str = Field(pattern=CHECKSUM_PATTERN)
    object_path: str = Field(pattern=OBJECT_PATH_PATTERN)
    size_bytes: int = Field(ge=1)
    published_at: str = Field(pattern=TIMESTAMP_PATTERN)
    author_label: str = Field(default="", max_length=120)
    lessons_count: int = Field(ge=0)
    questions_count: int = Field(ge=0)
    estimated_minutes_total: int = Field(ge=0)
    requires_gpu: bool = False

    @field_validator("object_path")
    @classmethod
    def _sin_traversal(cls, valor: str) -> str:
        """Rechaza segmentos ``..`` y barras dobles en la ruta del objeto.

        En GCS el nombre del objeto es literal y ``..`` no «sube» de nivel, pero
        esta ruta llega de fuera y acaba usada como clave de caché y como texto
        en logs. El patrón de §11.10 no puede expresarlo (el motor de regex de
        pydantic no tiene lookahead), así que se comprueba aquí.
        """
        if ".." in valor or "//" in valor:
            raise ValueError("object_path no puede contener '..' ni '//'")
        return valor


class CatalogIndex(_Strict):
    """§11.10 ``modulos/index.json`` — el índice MUTABLE del bucket (por CAS)."""

    index_format: Literal[1]
    generated_at: str = Field(pattern=TIMESTAMP_PATTERN)
    modules: list[CatalogIndexEntry] = Field(max_length=500)


# ── §11.5 CU-35 Explorar ─────────────────────────────────────────────────────


class RemoteModuleSummary(BaseModel):
    """§11.5.1 — una fila del catálogo remoto, ya cruzada con lo instalado."""

    id: str
    title: str
    description: str
    level: str
    order_hint: int
    version: int
    checksum: str
    object_path: str
    generation: int | None  # ancla exacta del objeto (if_generation_match)
    size_bytes: int
    published_at: str
    author_label: str
    lessons_count: int
    questions_count: int
    estimated_minutes_total: int
    requires_gpu: bool
    state: RemoteState  # cruce con installed_modules
    installed_version: int | None
    installed_checksum: str | None


class RemoteCatalogResponse(BaseModel):
    """§11.5.1 ``GET /api/v1/catalog/remote``.

    ``stale=true`` ⇔ ``source == "cache"`` y la caché venció (o el bucket falló
    y se degradó a caché). Con caché previa el endpoint responde 200 aunque el
    bucket esté caído: quedarse sin red no es un error, es un caso de uso.
    """

    bucket: str | None
    source: CatalogSource
    fetched_at: str | None
    stale: bool
    unavailable_reason: str | None  # 'network'|'forbidden'|'corrupt'|… | None
    modules: list[RemoteModuleSummary]


class RemoteLessonPreview(BaseModel):
    """§11.5.2 — una lección del módulo remoto, vista ANTES de instalar."""

    lesson_id: str
    order: int
    title: str
    estimated_minutes: int
    has_example: bool
    has_quiz: bool
    quiz_question_count: int
    requires_gpu: bool
    completion_rule: CompletionRule
    status: Literal["new", "present", "changed"]


class ContentWarning(BaseModel):
    """§11.5.2/§11.8 — aviso NO bloqueante sobre el contenido (p. ej. ``LESSON_ID_REMOVED``)."""

    code: str
    message: str
    lesson_id: str | None = None


class RemoteModuleDetail(RemoteModuleSummary):
    """§11.5.2 ``GET /api/v1/catalog/remote/{module_id}`` — preview sin instalar."""

    lessons: list[RemoteLessonPreview]
    content_warnings: list[ContentWarning]


# ── §11.4 Estado del catálogo (offline-safe) ─────────────────────────────────


class InstalledModuleStatus(BaseModel):
    """§11.4.1 — una fila de ``/cursos``: qué hay instalado y qué tiene actualización.

    ``state`` es DERIVADO, no almacenado: ``local_only`` = sin fila en
    ``installed_modules``; ``update_available`` = ``available_version >
    installed_version``.
    """

    module_id: str
    title: str
    origin: ModuleOrigin
    state: InstalledState
    installed_version: int | None
    installed_checksum: str | None
    available_version: int | None
    available_checksum: str | None
    object_path: str | None
    installed_at: str | None
    updated_at: str | None
    last_checked_at: str | None
    lessons_total: int
    lessons_completed: int  # LOCAL; nunca sale del equipo


class CatalogStatusSummary(BaseModel):
    """§11.4.1 ``summary`` — conteos para los chips de la pantalla de cursos."""

    modules_total: int
    installed: int
    updatable: int
    local_only: int
    never_checked: int


class CatalogStatusResponse(BaseModel):
    """§11.4.1 ``GET /catalog/status`` y §11.4.2 ``POST /catalog/refresh``.

    ``/status`` lee SOLO SQLite y responde 200 siempre —también sin bucket
    configurado, con ``catalog_enabled=false``—: ``/cursos`` no puede quedarse
    bloqueada por el bucket (§11.0.8).
    """

    catalog_enabled: bool
    bucket: str | None
    last_checked_at: str | None
    modules: list[InstalledModuleStatus]
    summary: CatalogStatusSummary


# ── §11.6 CU-36 / CU-39 Instalar y actualizar ────────────────────────────────


class InstallRequest(BaseModel):
    """§11.6.1 ``POST /api/v1/catalog/install``.

    ``expected_checksum`` es opcional pero cierra el TOCTOU: ancla lo que el
    usuario VIO en pantalla, así que un bucket reescrito entre el listado y el
    clic da ``409 CHECKSUM_MISMATCH`` en vez de instalar otra cosa.
    """

    module_id: str = Field(pattern=ID_PATTERN)
    version: int | None = Field(default=None, ge=1)
    expected_checksum: str | None = Field(default=None, pattern=CHECKSUM_PATTERN)


class UpdateRequest(BaseModel):
    """§11.6.3 ``POST /api/v1/catalog/modules/{module_id}/update``.

    ``to_version`` debe ser ``>`` que ``installed_version`` (versión monótona,
    no hay downgrade) → si no, ``409 VERSION_CONFLICT``. El default de
    ``on_removed_lessons`` CONSERVA el progreso: es la promesa de §11.0.7, y el
    valor destructivo tiene que pedirse explícitamente.
    """

    to_version: int | None = Field(default=None, ge=1)
    expected_checksum: str | None = Field(default=None, pattern=CHECKSUM_PATTERN)
    on_removed_lessons: Literal["archive", "purge"] = "archive"


class LessonDiffEntry(BaseModel):
    """§11.6.2 — qué le pasa a UNA lección al actualizar, anclado en ``lesson_id``."""

    lesson_id: str
    change: LessonChange
    progress: ProgressEffect
    reason: str | None  # 'QUIZ_CHANGED' | 'LESSON_ID_REMOVED' | None


class ProgressEffectSummary(BaseModel):
    """§11.6.1/§11.6.2 — conteo por efecto. ``archived`` es el canario de CU-39."""

    preserved: int
    rescored: int
    archived: int
    unaffected: int


class ModuleUpdatePreview(BaseModel):
    """§11.6.2 — «qué conservo, qué pierdo» ANTES de escribir nada.

    Este endpoint sostiene la promesa de producto: el estudiante ve el efecto
    sobre su avance y decide. Descarga y valida la versión nueva sin tocar la DB.
    """

    module_id: str
    from_version: int
    to_version: int
    to_checksum: str
    lessons: list[LessonDiffEntry]
    progress_summary: ProgressEffectSummary
    warnings: list[ContentWarning]


class InstallResult(BaseModel):
    """§11.6.1 (201 instalar) y §11.6.3 (200 actualizar) — mismo shape.

    ``order_reassigned`` no es cosmético: ``modules."order"`` es UNIQUE global y
    dos autores pueden publicar ambos con ``order_hint = 3``; el instalador
    asigna ``MAX("order") + 1`` y lo declara, en vez de fallar con IntegrityError.
    """

    module_id: str
    installed_version: int
    installed_checksum: str
    object_path: str
    local_order: int
    order_reassigned: bool  # order_hint colisionaba (UNIQUE global)
    lessons_added: list[str]
    lessons_updated: list[str]
    lessons_removed: list[str]
    questions_total: int
    progress: ProgressEffectSummary
    installed_at: str


class UninstallResult(BaseModel):
    """§11.6.4 ``DELETE /catalog/modules/{module_id}``.

    Con ``purge_progress=false`` (default) el contenido se borra pero el
    progreso sobrevive HUÉRFANO: reinstalar restaura el avance, porque los
    ``lesson_id`` son estables y ``lesson_progress`` no tiene FK a ``lessons``.
    """

    removed: bool
    module_id: str
    lessons_removed: int
    progress_purged: bool
    progress_archived: int


__all__ = [
    # Constantes y literales
    "BUNDLE_FORMAT",
    "INDEX_FORMAT",
    "CHECKSUM_PATTERN",
    "OBJECT_PATH_PATTERN",
    "TIMESTAMP_PATTERN",
    "CompletionRule",
    "ModuleOrigin",
    "RemoteState",
    "InstalledState",
    "CatalogSource",
    "ProgressEffect",
    "LessonChange",
    # §11.10 Formato de intercambio
    "BundleRecommended",
    "BundleQuizOption",
    "BundleExample",
    "BundleQuizQuestion",
    "BundleQuiz",
    "BundleLesson",
    "BundleModule",
    "ModuleBundle",
    "CatalogIndexEntry",
    "CatalogIndex",
    # §11.5 Explorar
    "RemoteModuleSummary",
    "RemoteCatalogResponse",
    "RemoteLessonPreview",
    "ContentWarning",
    "RemoteModuleDetail",
    # §11.4 Estado
    "InstalledModuleStatus",
    "CatalogStatusSummary",
    "CatalogStatusResponse",
    # §11.6 Instalar / actualizar / desinstalar
    "InstallRequest",
    "UpdateRequest",
    "LessonDiffEntry",
    "ProgressEffectSummary",
    "ModuleUpdatePreview",
    "InstallResult",
    "UninstallResult",
]
