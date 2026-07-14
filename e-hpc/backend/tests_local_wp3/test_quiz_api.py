"""Endpoints de quiz (api-contract §5) contra la app con fakes."""

from __future__ import annotations

from content_factory import full_answers


def test_get_quiz_never_leaks_correct_key_nor_explanation(client) -> None:
    response = client.get("/api/v1/lessons/l01/quiz")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True and body["error"] is None
    assert "correct_key" not in response.text
    assert "explanation" not in response.text
    data = body["data"]
    assert data["lesson_id"] == "l01"
    assert data["question_count"] == 5
    first = data["questions"][0]
    assert set(first) == {"id", "order", "text", "options"}
    assert [o["key"] for o in first["options"]] == ["a", "b", "c", "d"]


def test_get_quiz_unknown_lesson_404_envelope(client) -> None:
    response = client.get("/api/v1/lessons/nope/quiz")
    assert response.status_code == 404
    body = response.json()
    assert body["success"] is False and body["data"] is None
    assert body["error"]["code"] == "LESSON_NOT_FOUND"


def test_post_attempt_scores_and_updates_progress(
    client, attempts_repo, progress_repo
) -> None:
    response = client.post(
        "/api/v1/lessons/l01/quiz/attempts",
        json={"answers": full_answers("l01", "b")},
    )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["score"] == 5 and data["total"] == 5 and data["passed"] is True
    assert data["pass_threshold"] == 0.8
    assert data["lesson_id"] == "l01"
    assert len(data["attempt_id"]) == 32
    assert data["created_at"].endswith("Z")
    # results[] con feedback completo (§5.2)
    assert len(data["results"]) == 5
    result = data["results"][0]
    assert set(result) == {
        "question_id", "selected", "correct_key", "correct", "explanation",
    }
    assert result["correct"] is True and result["explanation"]
    # efectos laterales atómicos
    assert len(attempts_repo.rows) == 1
    assert attempts_repo.create_calls[0]["lock_held"] is True
    assert progress_repo.upsert_calls[0]["lock_held"] is True
    stored = progress_repo.rows["l01"]
    assert stored.completed is True and stored.best_quiz_score == 5


def test_post_attempt_failing_score_does_not_complete(client, progress_repo) -> None:
    answers = full_answers("l01", "b")
    answers["l01-q1"] = "a"
    answers["l01-q2"] = "a"  # 3/5 = 0.6 < 0.8
    response = client.post(
        "/api/v1/lessons/l01/quiz/attempts", json={"answers": answers}
    )
    data = response.json()["data"]
    assert data["score"] == 3 and data["passed"] is False
    assert progress_repo.rows["l01"].completed is False
    assert progress_repo.rows["l01"].best_quiz_score == 3


def test_post_attempt_incomplete_answers_422_envelope(client, attempts_repo) -> None:
    answers = full_answers("l01")
    del answers["l01-q2"]
    response = client.post(
        "/api/v1/lessons/l01/quiz/attempts", json={"answers": answers}
    )
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any("l01-q2" in str(d) for d in body["error"]["details"])
    assert attempts_repo.rows == []  # nada persistido


def test_post_attempt_bad_option_value_422(client) -> None:
    answers = full_answers("l01")
    answers["l01-q1"] = "e"  # fuera de a|b|c|d → pydantic (handler envelope)
    response = client.post(
        "/api/v1/lessons/l01/quiz/attempts", json={"answers": answers}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_attempt_unknown_lesson_404(client) -> None:
    response = client.post(
        "/api/v1/lessons/nope/quiz/attempts", json={"answers": {}}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "LESSON_NOT_FOUND"


def test_attempt_failure_rolls_back_and_500s(client, attempts_repo, fake_db) -> None:
    attempts_repo.fail_on_create = True
    try:
        response = client.post(
            "/api/v1/lessons/l01/quiz/attempts",
            json={"answers": full_answers("l01")},
        )
        assert response.status_code == 500
    except RuntimeError:
        pass  # sin handler global (WP1), TestClient re-lanza: también vale
    assert fake_db.rollbacks == 1


def test_attempts_history_shape_and_meta(client) -> None:
    for _ in range(3):
        client.post(
            "/api/v1/lessons/l02/quiz/attempts",
            json={"answers": full_answers("l02")},
        )
    response = client.get("/api/v1/lessons/l02/quiz/attempts?limit=2")
    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]["attempts"]) == 2
    assert body["meta"] == {"total": 3, "limit": 2, "offset": 0}
    attempt = body["data"]["attempts"][0]
    assert set(attempt) == {"attempt_id", "score", "total", "passed", "created_at"}
    assert "answers" not in response.text  # el historial no re-expone respuestas


def test_attempts_history_unknown_lesson_404(client) -> None:
    response = client.get("/api/v1/lessons/nope/quiz/attempts")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "LESSON_NOT_FOUND"
