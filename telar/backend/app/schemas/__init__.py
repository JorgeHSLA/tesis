"""Modelos pydantic (v2) del contrato de API de Telar.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO):
envelope genérico, salud/sistema, ejemplos, módulos/lecciones, quizzes,
progreso, jobs, mensajes WebSocket, autoría/admin (§10) y catálogo remoto
(§11). Sin lógica: solo
shapes. No añadir, quitar ni renombrar campos sin actualizar el contrato
primero.

Este paquete divide el contrato por secciones (``§N``) en módulos, pero
re-exporta TODOS los nombres públicos aquí para que ``from app.schemas import X``
siga funcionando sin cambios en los importadores. El orden de import respeta
las dependencias: ``envelope`` y los tipos compartidos (``ParserId``,
``QuizOptionKey``, ``FILENAME_PATTERN``/``JobStatus``) se cargan antes que
quienes los reutilizan (``jobs`` → ``examples``; ``ws`` → ``jobs``;
``admin`` → ``examples``/``jobs``/``quizzes``; ``catalog`` → ``admin``;
``updates`` → ``catalog``).
"""

# §1 Envelope + tipos compartidos (base del paquete).
from .envelope import (
    ApiError,
    ApiErrorCode,
    ApiMeta,
    Envelope,
    T,
)

# §2 Salud y sistema.
from .system import (
    HealthChecks,
    HealthResponse,
    SystemInfo,
    SystemLimits,
    SystemVersions,
)

# §3 Catálogo de ejemplos (provee ParserId).
from .examples import (
    ExampleDetail,
    ExampleSummary,
    ExamplesList,
    ParserId,
)

# §4 Cursos: módulos y lecciones.
from .content import (
    LessonDetail,
    LessonProgress,
    Module,
    ModuleLesson,
    ModulesResponse,
    ModulesSummary,
    RecommendedLesson,
)

# §5 Quizzes (provee QuizOptionKey).
from .quizzes import (
    QuizAttemptRequest,
    QuizAttemptResult,
    QuizAttemptsList,
    QuizAttemptSummary,
    QuizOption,
    QuizOptionKey,
    QuizQuestion,
    QuizQuestionResult,
    QuizResponse,
)

# §6 Progreso.
from .progress import (
    ProgressEntry,
    ProgressResponse,
    ProgressSummary,
    ProgressUpdateRequest,
)

# §7 Jobs (reutiliza ParserId; provee FILENAME_PATTERN y JobStatus).
from .jobs import (
    FILENAME_PATTERN,
    JobCancelResult,
    JobCreateRequest,
    JobCreated,
    JobDetail,
    JobErrorDetail,
    JobStatus,
    JobSummary,
    JobsList,
    JobTerminalStatus,
    MetricsSummary,
    ParsedTimings,
    ParsedTimingsPair,
    ParsedTimingsSweep,
    SourceKind,
    SweepPoint,
)

# §8 Protocolo WebSocket (reutiliza JobStatus).
from .ws import (
    WsCancelMsg,
    WsEofMsg,
    WsErrorCode,
    WsErrorMsg,
    WsLogMsg,
    WsMetricsMsg,
    WsServerMsg,
    WsStatusDetail,
    WsStatusMsg,
)

# §10 Autoría (admin), Fase 4 (reutiliza ParserId, FILENAME_PATTERN, QuizOptionKey).
from .admin import (
    ID_PATTERN,
    QUESTION_ID_PATTERN,
    AdminDeleteResult,
    AdminExample,
    AdminExampleBase,
    AdminExampleCodeRequest,
    AdminExampleCodeResult,
    AdminExampleUpdate,
    AdminLessonBase,
    AdminLessonCreate,
    AdminLessonExampleCreate,
    AdminLessonDetail,
    AdminLessonRef,
    AdminLessonUpdate,
    AdminModule,
    AdminModuleBase,
    AdminModuleCreate,
    AdminModulesResponse,
    AdminModuleUpdate,
    AdminQuiz,
    AdminQuizOption,
    AdminQuizQuestion,
    AdminQuizUpsert,
    AdminRecommended,
    AdminReorderItem,
    AdminReorderRequest,
)

# §11 Catálogo remoto de módulos publicables, Fase 5 (reutiliza ID_PATTERN,
# AdminExampleBase/AdminQuizQuestion/AdminQuizOption/AdminRecommended de §10).
from .catalog import (
    BUNDLE_FORMAT,
    CHECKSUM_PATTERN,
    INDEX_FORMAT,
    OBJECT_PATH_PATTERN,
    TIMESTAMP_PATTERN,
    BundleExample,
    BundleLesson,
    BundleModule,
    BundleQuiz,
    BundleQuizOption,
    BundleQuizQuestion,
    BundleRecommended,
    CatalogIndex,
    CatalogIndexEntry,
    CatalogSource,
    CatalogStatusResponse,
    CatalogStatusSummary,
    CompletionRule,
    ContentWarning,
    InstallRequest,
    InstallResult,
    InstalledModuleStatus,
    InstalledState,
    LessonChange,
    LessonDiffEntry,
    ModuleBundle,
    ModuleOrigin,
    ModuleUpdatePreview,
    ProgressEffect,
    ProgressEffectSummary,
    RemoteCatalogResponse,
    RemoteLessonPreview,
    RemoteModuleDetail,
    RemoteModuleSummary,
    RemoteState,
    UninstallResult,
    UpdateRequest,
)

# Fase 5 — tipos del PLAN de actualización (no son contrato HTTP: los produce
# services/module_merge.py). ``ProgressEffect`` se reexporta como
# ``MergeProgressEffect`` a propósito: el del plan es el vocabulario posterior a
# R3/R4 (``rescored``/``archived``) y el de §11.11.1 sigue siendo el del cable
# (``reset``/``orphaned``). Son el mismo mecanismo con distinto nombre y la
# tabla ``EFECTO_A_CONTRATO`` los traduce; darles el mismo símbolo aquí haría
# que uno tapara al otro en silencio.
from .updates import (
    EFECTO_A_CONTRATO,
    POLITICA_DESDE_CONTRATO,
    ConflictField,
    InvalidatedScore,
    LessonMove,
    MergeConflict,
    MergePlan,
    MergeWarning,
    OnRemovedLessons,
    ProgressOp,
    RecommendedPrune,
    UpdateLessonsReport,
    UpdateProgressReport,
    UpdateReport,
    UpdateStatus,
)
from .updates import ProgressEffect as MergeProgressEffect

__all__ = [
    # §1 Envelope
    "ApiErrorCode",
    "T",
    "ApiError",
    "ApiMeta",
    "Envelope",
    # §2 Salud y sistema
    "HealthChecks",
    "HealthResponse",
    "SystemVersions",
    "SystemLimits",
    "SystemInfo",
    # §3 Catálogo de ejemplos
    "ParserId",
    "ExampleSummary",
    "ExamplesList",
    "ExampleDetail",
    # §4 Cursos: módulos y lecciones
    "LessonProgress",
    "ModuleLesson",
    "Module",
    "ModulesSummary",
    "ModulesResponse",
    "RecommendedLesson",
    "LessonDetail",
    # §5 Quizzes
    "QuizOptionKey",
    "QuizOption",
    "QuizQuestion",
    "QuizResponse",
    "QuizAttemptRequest",
    "QuizQuestionResult",
    "QuizAttemptResult",
    "QuizAttemptSummary",
    "QuizAttemptsList",
    # §6 Progreso
    "ProgressEntry",
    "ProgressSummary",
    "ProgressResponse",
    "ProgressUpdateRequest",
    # §7 Jobs
    "JobStatus",
    "JobTerminalStatus",
    "SourceKind",
    "JobErrorDetail",
    "FILENAME_PATTERN",
    "JobCreateRequest",
    "JobCreated",
    "JobSummary",
    "JobsList",
    "MetricsSummary",
    "SweepPoint",
    "ParsedTimingsSweep",
    "ParsedTimingsPair",
    "ParsedTimings",
    "JobDetail",
    "JobCancelResult",
    # §8 Protocolo WebSocket
    "WsErrorCode",
    "WsStatusDetail",
    "WsStatusMsg",
    "WsLogMsg",
    "WsMetricsMsg",
    "WsErrorMsg",
    "WsEofMsg",
    "WsServerMsg",
    "WsCancelMsg",
    # §10 Autoría (admin)
    "ID_PATTERN",
    "QUESTION_ID_PATTERN",
    "AdminRecommended",
    "AdminModuleBase",
    "AdminModuleCreate",
    "AdminModuleUpdate",
    "AdminLessonRef",
    "AdminModule",
    "AdminModulesResponse",
    "AdminReorderItem",
    "AdminReorderRequest",
    "AdminExampleBase",
    "AdminExampleUpdate",
    "AdminExample",
    "AdminExampleCodeRequest",
    "AdminExampleCodeResult",
    "AdminLessonBase",
    "AdminLessonCreate",
    "AdminLessonExampleCreate",
    "AdminLessonUpdate",
    "AdminLessonDetail",
    "AdminQuizOption",
    "AdminQuizQuestion",
    "AdminQuizUpsert",
    "AdminQuiz",
    "AdminDeleteResult",
    # §11 Catálogo remoto (Fase 5) — formato de intercambio
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
    # §11 Catálogo remoto — respuestas
    "RemoteModuleSummary",
    "RemoteCatalogResponse",
    "RemoteLessonPreview",
    "ContentWarning",
    "RemoteModuleDetail",
    "InstalledModuleStatus",
    "CatalogStatusSummary",
    "CatalogStatusResponse",
    "InstallRequest",
    "UpdateRequest",
    "LessonDiffEntry",
    "ProgressEffectSummary",
    "ModuleUpdatePreview",
    "InstallResult",
    "UninstallResult",
    # Fase 5 — plan de actualización (interno, no contrato HTTP)
    "MergeProgressEffect",
    "OnRemovedLessons",
    "UpdateStatus",
    "ConflictField",
    "EFECTO_A_CONTRATO",
    "POLITICA_DESDE_CONTRATO",
    "MergeConflict",
    "MergeWarning",
    "LessonMove",
    "RecommendedPrune",
    "ProgressOp",
    "MergePlan",
    "InvalidatedScore",
    "UpdateLessonsReport",
    "UpdateProgressReport",
    "UpdateReport",
]
