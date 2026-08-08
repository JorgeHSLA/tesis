"""Modelos pydantic (v2) del contrato de API de E-HPC.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/api-contract.md`` (CONGELADO):
envelope genérico, salud/sistema, ejemplos, módulos/lecciones, quizzes,
progreso, jobs, mensajes WebSocket y autoría/admin (§10). Sin lógica: solo
shapes. No añadir, quitar ni renombrar campos sin actualizar el contrato
primero.

Este paquete divide el contrato por secciones (``§N``) en módulos, pero
re-exporta TODOS los nombres públicos aquí para que ``from app.schemas import X``
siga funcionando sin cambios en los importadores. El orden de import respeta
las dependencias: ``envelope`` y los tipos compartidos (``ParserId``,
``QuizOptionKey``, ``FILENAME_PATTERN``/``JobStatus``) se cargan antes que
quienes los reutilizan (``jobs`` → ``examples``; ``ws`` → ``jobs``;
``admin`` → ``examples``/``jobs``/``quizzes``).
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
    "AdminLessonUpdate",
    "AdminLessonDetail",
    "AdminQuizOption",
    "AdminQuizQuestion",
    "AdminQuizUpsert",
    "AdminQuiz",
    "AdminDeleteResult",
]
