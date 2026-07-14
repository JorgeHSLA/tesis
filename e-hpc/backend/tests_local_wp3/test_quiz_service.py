"""QuizService: corrección server-side, atomicidad bajo write_lock, 0.8."""

from __future__ import annotations

import asyncio

import pytest
from content_factory import full_answers

from app.services.quiz_service import (
    LessonNotFoundError,
    QuizNotFoundError,
    QuizService,
    QuizValidationError,
)


@pytest.fixture()
def service(content_repo, attempts_repo, progress_repo, write_lock, fake_db):
    return QuizService(
        content=content_repo,
        attempts=attempts_repo,
        progress=progress_repo,
        write_lock=write_lock,
        db=fake_db,
    )


def test_all_correct_scores_full_and_passes(service, attempts_repo, progress_repo):
    result = asyncio.run(service.submit_attempt("l01", full_answers("l01", "b")))
    assert (result.score, result.total, result.passed) == (5, 5, True)
    assert result.pass_threshold == 0.8
    assert len(result.results) == 5
    assert all(r.correct and r.correct_key == "b" for r in result.results)
    assert all(r.explanation for r in result.results)
    # persistencia
    assert len(attempts_repo.rows) == 1
    record = progress_repo.rows["l01"]
    assert record.completed is True and record.best_quiz_score == 5


def test_threshold_exactly_0_8_passes(service):
    answers = full_answers("l01", "b")
    answers["l01-q5"] = "a"  # 4/5 = 0.8 exacto
    result = asyncio.run(service.submit_attempt("l01", answers))
    assert (result.score, result.passed) == (4, True)
    failed = [r for r in result.results if not r.correct]
    assert len(failed) == 1
    assert failed[0].question_id == "l01-q5"
    assert failed[0].selected == "a" and failed[0].correct_key == "b"


def test_below_threshold_fails_and_does_not_complete(service, progress_repo):
    answers = full_answers("l01", "a")  # 0/5
    result = asyncio.run(service.submit_attempt("l01", answers))
    assert (result.score, result.passed) == (0, False)
    call = progress_repo.upsert_calls[-1]
    assert call["completed"] is None  # None = no tocar (no des-completa)
    assert call["best_quiz_score"] == 0
    assert progress_repo.rows["l01"].completed is False


def test_best_score_only_improves(service, progress_repo):
    asyncio.run(service.submit_attempt("l01", full_answers("l01", "b")))  # 5
    answers = full_answers("l01", "b")
    answers["l01-q1"] = "a"
    asyncio.run(service.submit_attempt("l01", answers))  # 4
    assert progress_repo.rows["l01"].best_quiz_score == 5  # MAX


def test_writes_happen_inside_write_lock(service, attempts_repo, progress_repo):
    asyncio.run(service.submit_attempt("l01", full_answers("l01")))
    assert attempts_repo.create_calls[0]["lock_held"] is True
    assert progress_repo.upsert_calls[0]["lock_held"] is True


def test_insert_failure_skips_progress_and_rolls_back(
    service, attempts_repo, progress_repo, fake_db
):
    attempts_repo.fail_on_create = True
    with pytest.raises(RuntimeError):
        asyncio.run(service.submit_attempt("l01", full_answers("l01")))
    assert progress_repo.upsert_calls == []  # unidad atómica: no upsert
    assert progress_repo.rows == {}
    assert fake_db.rollbacks == 1


def test_missing_answer_raises_validation_error(service):
    answers = full_answers("l01")
    del answers["l01-q3"]
    with pytest.raises(QuizValidationError) as excinfo:
        asyncio.run(service.submit_attempt("l01", answers))
    assert any(d["question_id"] == "l01-q3" for d in excinfo.value.details)


def test_unknown_question_raises_validation_error(service):
    answers = full_answers("l01")
    answers["l01-q99"] = "a"
    with pytest.raises(QuizValidationError):
        asyncio.run(service.submit_attempt("l01", answers))


def test_option_not_in_question_raises(tmp_path, write_lock, fake_db):
    """Valor a|b|c|d pero inexistente en ESA pregunta (3 opciones) → 422."""
    from content_factory import make_content, rewrite_json
    from conftest import FakeProgressRepository, FakeQuizAttemptRepository

    from app.repositories.content import ContentRepository

    root = make_content(tmp_path / "content")

    def mutate(quiz: dict) -> None:
        quiz["questions"][0]["options"] = quiz["questions"][0]["options"][:3]
        quiz["questions"][0]["correct_key"] = "a"

    rewrite_json(root / "quizzes" / "l01.json", mutate)
    service = QuizService(
        content=ContentRepository(root),
        attempts=FakeQuizAttemptRepository(),
        progress=FakeProgressRepository(),
        write_lock=write_lock,
        db=fake_db,
    )
    answers = full_answers("l01")
    answers["l01-q1"] = "d"
    with pytest.raises(QuizValidationError) as excinfo:
        asyncio.run(service.submit_attempt("l01", answers))
    assert "d" in str(excinfo.value.details)


def test_unknown_lesson_raises(service):
    with pytest.raises(LessonNotFoundError):
        asyncio.run(service.submit_attempt("nope", {}))
    with pytest.raises(LessonNotFoundError):
        service.get_quiz("nope")


def test_get_quiz_has_no_keys(service):
    quiz = service.get_quiz("l01")
    payload = quiz.model_dump_json()
    assert "correct_key" not in payload
    assert "explanation" not in payload
    assert quiz.question_count == 5


def test_no_answers_validation_lists_all_missing(service):
    with pytest.raises(QuizValidationError) as excinfo:
        asyncio.run(service.submit_attempt("l01", {}))
    assert len(excinfo.value.details) == 5


def test_quiz_not_found_error_type(content_repo, write_lock, fake_db):
    """Lección sin quiz (no ocurre en el contenido real, pero se contempla)."""

    class NoQuizContent:
        def exists_lesson(self, lesson_id: str) -> bool:
            return lesson_id == "sinquiz"

        def quiz(self, lesson_id: str):
            return None

    service = QuizService(
        content=NoQuizContent(),  # type: ignore[arg-type]
        attempts=None,  # type: ignore[arg-type]
        progress=None,  # type: ignore[arg-type]
        write_lock=write_lock,
        db=fake_db,
    )
    with pytest.raises(QuizNotFoundError):
        service.get_quiz("sinquiz")
