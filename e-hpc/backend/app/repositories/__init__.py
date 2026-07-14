"""Repositorios de E-HPC (data-model §5).

Solo re-exporta los repositorios de ESTADO y sus records. ``content.py``
(WP3, fixtures en memoria) NO se importa aquí para no acoplar la carga del
paquete a su presencia: se importa explícitamente donde se usa.
"""

from app.repositories.jobs import TERMINAL_STATUSES, JobRepository
from app.repositories.progress import ProgressRepository
from app.repositories.quiz_attempts import QuizAttemptRepository
from app.repositories.records import (
    JobRecord,
    LessonProgressRecord,
    QuizAttemptRecord,
)

__all__ = [
    "TERMINAL_STATUSES",
    "JobRecord",
    "JobRepository",
    "LessonProgressRecord",
    "ProgressRepository",
    "QuizAttemptRecord",
    "QuizAttemptRepository",
]
