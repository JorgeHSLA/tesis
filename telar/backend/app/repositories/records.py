"""Records inmutables de los repositorios de estado.

TRANSCRIPCIÓN LITERAL de ``docs/architecture/data-model.md`` §5 (CONGELADO).
Los booleanos SQLite (INTEGER 0/1) llegan aquí ya mapeados a ``bool`` y los
documentos JSON (``metrics_summary``, ``parsed_timings``, ``answers``) ya
(de)serializados por el repositorio.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class JobRecord:
    id: str
    source_kind: str                 # 'example' | 'editor' | 'upload'
    example_id: str | None
    lesson_id: str | None
    filename: str
    source_code: str
    threads: int
    timeout_s: int
    runner_image: str
    status: str
    container_id: str | None
    error_detail: str | None
    exit_code: int | None
    oom_killed: bool
    stdout: str | None
    stderr: str | None
    output_truncated: bool
    metrics_summary: dict | None     # (de)serializado JSON en el repo
    parsed_timings: dict | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    wall_time_ms: int | None


@dataclass(frozen=True)
class QuizAttemptRecord:
    id: str
    lesson_id: str
    answers: dict[str, str]
    score: int
    total: int
    passed: bool
    created_at: str


@dataclass(frozen=True)
class LessonProgressRecord:
    lesson_id: str
    viewed: bool
    completed: bool
    best_quiz_score: int | None
    last_job_id: str | None
    updated_at: str
    #: Fase 5 (E4): CÓMO se completó. Distinguir «aprobó el quiz» de «dijo que
    #: la leyó» es lo que permite decidir, al actualizar un módulo, si un
    #: `completed` sigue estando justificado.
    completed_via: str | None = None
    completed_at: str | None = None
