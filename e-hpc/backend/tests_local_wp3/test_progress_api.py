"""Endpoints de progreso (api-contract §6) contra la app con fakes."""

from __future__ import annotations

import asyncio

from content_factory import LESSON_IDS, full_answers


def test_progress_map_empty(client) -> None:
    body = client.get("/api/v1/progress").json()
    assert body["success"] is True
    assert body["data"]["lessons"] == {}  # solo lecciones con registro
    assert body["data"]["summary"] == {
        "lessons_completed": 0, "lessons_enabled": 13,
        "modules_completed": 0, "modules_total": 4,
    }


def test_progress_map_entries_and_summary(client, progress_repo) -> None:
    asyncio.run(progress_repo.upsert("l01", viewed=True, completed=True,
                                     best_quiz_score=4))
    asyncio.run(progress_repo.upsert("l02", viewed=True))
    data = client.get("/api/v1/progress").json()["data"]
    assert set(data["lessons"]) == {"l01", "l02"}
    entry = data["lessons"]["l01"]
    assert set(entry) == {
        "viewed", "completed", "best_quiz_score", "quiz_total",
        "last_job_id", "updated_at",
    }
    assert entry["completed"] is True and entry["best_quiz_score"] == 4
    assert entry["quiz_total"] == 5 and entry["last_job_id"] is None
    assert data["summary"]["lessons_completed"] == 1
    assert data["summary"]["modules_completed"] == 0


def test_progress_modules_completed_counts_enabled_only(client, progress_repo) -> None:
    """m3 completo (l09-l13) → 1 módulo; m4 (solo lección GPU) jamás cuenta."""
    for lesson_id in LESSON_IDS[8:13]:
        asyncio.run(progress_repo.upsert(lesson_id, completed=True))
    summary = client.get("/api/v1/progress").json()["data"]["summary"]
    assert summary["modules_completed"] == 1
    assert summary["lessons_completed"] == 5


def test_put_progress_marks_viewed(client, progress_repo) -> None:
    response = client.put(
        "/api/v1/progress/lessons/l01", json={"viewed": True}
    )
    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["viewed"] is True and entry["completed"] is False
    assert entry["quiz_total"] == 5
    assert entry["updated_at"]
    # solo se tocan los campos enviados (None = no tocar)
    call = progress_repo.upsert_calls[-1]
    assert call == {
        "lesson_id": "l01", "viewed": True, "completed": None,
        "best_quiz_score": None, "last_job_id": None, "lock_held": False,
    }


def test_put_progress_partial_does_not_touch_other_fields(client, progress_repo) -> None:
    client.put("/api/v1/progress/lessons/l01", json={"viewed": True})
    client.put("/api/v1/progress/lessons/l01", json={"completed": True})
    record = progress_repo.rows["l01"]
    assert record.viewed is True and record.completed is True


def test_put_progress_protects_non_writable_fields(client, progress_repo) -> None:
    """§6.2 — best_quiz_score y last_job_id NO son escribibles por PUT."""
    # score real vía quiz (5/5)
    client.post(
        "/api/v1/lessons/l01/quiz/attempts",
        json={"answers": full_answers("l01", "b")},
    )
    response = client.put(
        "/api/v1/progress/lessons/l01",
        json={"viewed": True, "best_quiz_score": 999, "last_job_id": "hack"},
    )
    assert response.status_code == 200
    entry = response.json()["data"]
    assert entry["best_quiz_score"] == 5  # intacto (lo gestiona el backend)
    assert entry["last_job_id"] is None
    call = progress_repo.upsert_calls[-1]
    assert call["best_quiz_score"] is None and call["last_job_id"] is None


def test_put_progress_unknown_lesson_404(client) -> None:
    response = client.put(
        "/api/v1/progress/lessons/nope", json={"viewed": True}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "LESSON_NOT_FOUND"


def test_put_progress_invalid_body_422_envelope(client) -> None:
    response = client.put(
        "/api/v1/progress/lessons/l01", json={"viewed": "quizás"}
    )
    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_quiz_pass_reflected_in_progress_map(client) -> None:
    """Integración quiz→progreso: aprobar completa la lección en el mapa §6.1."""
    client.post(
        "/api/v1/lessons/l03/quiz/attempts",
        json={"answers": full_answers("l03", "b")},
    )
    entry = client.get("/api/v1/progress").json()["data"]["lessons"]["l03"]
    assert entry["completed"] is True and entry["best_quiz_score"] == 5
