"""QuizService — corrección server-side de quizzes (WP3).

Implementa la semántica de ``api-contract.md`` §5: el cliente jamás recibe
``correct_key``/``explanation`` antes del intento (§5.1) y el POST de intento
(§5.2) puntúa en el servidor, persiste el intento y actualiza el progreso
como UNA unidad dentro de ``write_lock`` (data-model.md §2 y §5, reglas
transversales).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping, Protocol

from app.repositories import content_admin
from app.repositories.content import ContentRepository, Quiz
from app.repositories.records import QuizAttemptRecord
from app.schemas import (
    QuizAttemptResult,
    QuizOption,
    QuizQuestion,
    QuizQuestionResult,
    QuizResponse,
)


class LessonNotFoundError(LookupError):
    """La lección no existe en los fixtures (→ 404 LESSON_NOT_FOUND)."""


class QuizNotFoundError(LookupError):
    """La lección existe pero no tiene quiz (→ 404 QUIZ_NOT_FOUND)."""


class QuizValidationError(ValueError):
    """Intento inválido (→ 422 VALIDATION_ERROR con ``details``)."""

    def __init__(self, details: list[dict[str, Any]]) -> None:
        super().__init__("Intento de quiz inválido")
        self.details = details


class _AttemptsRepo(Protocol):
    """QuizAttemptRepository: variante sin-commit para la unidad compuesta."""

    async def create_no_commit(self, attempt: QuizAttemptRecord) -> None: ...


class _ProgressRepo(Protocol):
    """ProgressRepository: variante sin-commit para la unidad compuesta."""

    async def upsert_no_commit(
        self,
        lesson_id: str,
        *,
        viewed: bool | None = None,
        completed: bool | None = None,
        best_quiz_score: int | None = None,
        last_job_id: str | None = None,
    ) -> Any: ...


def _now_iso() -> str:
    """ISO-8601 UTC con milisegundos y sufijo Z (api-contract encabezado)."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def public_quiz(quiz: Quiz) -> QuizResponse:
    """§5.1 — proyección del quiz SIN ``correct_key`` ni ``explanation``."""
    return QuizResponse(
        lesson_id=quiz.lesson_id,
        question_count=len(quiz.questions),
        questions=[
            QuizQuestion(
                id=q.id,
                order=q.order,
                text=q.text,
                options=[QuizOption(key=o.key, text=o.text) for o in q.options],
            )
            for q in quiz.questions
        ],
    )


class QuizService:
    """Corrección server-side + persistencia atómica intento→progreso."""

    def __init__(
        self,
        *,
        content: ContentRepository,
        attempts: _AttemptsRepo,
        progress: _ProgressRepo,
        write_lock: asyncio.Lock,
        db: Any | None = None,
    ) -> None:
        self._content = content
        self._attempts = attempts
        self._progress = progress
        self._write_lock = write_lock
        # Conexión de la unidad compuesta: el ÚNICO commit()/rollback() de
        # intento→progreso lo hace el servicio (BL-04), no los repositorios.
        self._db = db

    def get_quiz(self, lesson_id: str) -> QuizResponse:
        """Quiz público (§5.1). Lanza LessonNotFound/QuizNotFound."""
        quiz = self._require_quiz(lesson_id)
        return public_quiz(quiz)

    async def submit_attempt(
        self, lesson_id: str, answers: Mapping[str, str]
    ) -> QuizAttemptResult:
        """§5.2 — corrige, persiste intento y actualiza progreso (atómico).

        INSERT del intento + upsert de progreso son UNA unidad de escritura:
        statements sin commit (``create_no_commit``/``upsert_no_commit``) y un
        ÚNICO ``commit()``/``rollback()`` DENTRO de ``write_lock`` (data-model
        §2/§5; patrón build-then-commit de ``content_writer._persist``). Un
        fallo en cualquier paso revierte la unidad ENTERA: nunca queda un
        intento persistido sin su progreso (BL-04).
        """
        if self._db is None:
            raise RuntimeError(
                "QuizService.submit_attempt requiere la conexión db para "
                "confirmar la unidad intento→progreso (BL-04)"
            )
        quiz = self._require_quiz(lesson_id)
        self._validate_answers(quiz, answers)

        results = [
            QuizQuestionResult(
                question_id=question.id,
                selected=answers[question.id],  # type: ignore[arg-type]
                correct_key=question.correct_key,  # type: ignore[arg-type]
                correct=answers[question.id] == question.correct_key,
                explanation=question.explanation,
            )
            for question in quiz.questions
        ]
        score = sum(1 for r in results if r.correct)
        total = len(quiz.questions)
        passed = (score / total) >= quiz.pass_threshold

        attempt = QuizAttemptRecord(
            id=uuid.uuid4().hex,
            lesson_id=lesson_id,
            answers=dict(answers),
            score=score,
            total=total,
            passed=passed,
            created_at=_now_iso(),
        )

        async with self._write_lock:
            try:
                await self._ensure_content_current(lesson_id, quiz)
                await self._attempts.create_no_commit(attempt)
                await self._progress.upsert_no_commit(
                    lesson_id,
                    completed=True if passed else None,  # None = no tocar
                    best_quiz_score=score,  # el repo aplica MAX en SQL
                    # E4: queda registrado que el aprobado vino del quiz, no de
                    # que alguien marcara la lección a mano. Al actualizar el
                    # módulo eso decide si el `completed` sigue justificado.
                    completed_via="quiz" if passed else None,
                )
                await self._db.commit()  # ÚNICO commit de la unidad
            except Exception:
                await self._db.rollback()
                raise

        return QuizAttemptResult(
            attempt_id=attempt.id,
            lesson_id=lesson_id,
            score=score,
            total=total,
            passed=passed,
            pass_threshold=quiz.pass_threshold,
            created_at=attempt.created_at,
            results=results,
        )

    # ── Helpers ─────────────────────────────────────────────────────────────

    async def _ensure_content_current(self, lesson_id: str, quiz: Quiz) -> None:
        """Re-valida contra la DB, DENTRO del lock, que el contenido con el
        que se puntuó el intento sigue vigente.

        El snapshot en memoria se lee ANTES de tomar ``write_lock``; un admin
        pudo borrar la lección (BL-01) o reemplazar/borrar el quiz (BL-06) y
        commitear mientras este intento esperaba el lock. Sin esta guarda, el
        intento obsoleto re-crearía las filas purgadas o pisaría el reset — y
        el MAX de ``best_quiz_score`` haría la corrupción permanente. Cambios
        cosméticos (mismos ids de pregunta y mismo umbral) no abortan, igual
        que no disparan el reset de §10.5.
        """
        threshold = await content_admin.lesson_pass_threshold(
            self._db, lesson_id
        )
        if threshold is None:
            raise LessonNotFoundError(lesson_id)
        ids = await content_admin.quiz_question_ids(self._db, lesson_id)
        if not ids:
            raise QuizNotFoundError(lesson_id)
        if (
            set(ids) != {q.id for q in quiz.questions}
            or threshold != quiz.pass_threshold
        ):
            raise QuizValidationError(
                [
                    {
                        "field": "quiz",
                        "error": (
                            "el quiz cambió mientras se enviaba el intento; "
                            "recarga la lección e inténtalo de nuevo"
                        ),
                    }
                ]
            )

    def _require_quiz(self, lesson_id: str) -> Quiz:
        if not self._content.exists_lesson(lesson_id):
            raise LessonNotFoundError(lesson_id)
        quiz = self._content.quiz(lesson_id)
        if quiz is None or not quiz.questions:
            raise QuizNotFoundError(lesson_id)
        return quiz

    @staticmethod
    def _validate_answers(quiz: Quiz, answers: Mapping[str, str]) -> None:
        """§5.2 — TODAS las preguntas, ids existentes, opción de la pregunta."""
        details: list[dict[str, Any]] = []
        question_by_id = {q.id: q for q in quiz.questions}
        for missing in sorted(set(question_by_id) - set(answers)):
            details.append(
                {"question_id": missing, "error": "falta la respuesta"}
            )
        for unknown in sorted(set(answers) - set(question_by_id)):
            details.append(
                {"question_id": unknown, "error": "pregunta inexistente"}
            )
        for question_id, selected in answers.items():
            question = question_by_id.get(question_id)
            if question is None:
                continue
            if selected not in {o.key for o in question.options}:
                details.append(
                    {
                        "question_id": question_id,
                        "error": f"opción '{selected}' inexistente",
                    }
                )
        if details:
            raise QuizValidationError(details)
