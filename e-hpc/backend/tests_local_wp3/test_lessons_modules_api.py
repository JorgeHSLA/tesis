"""Endpoints de lecciones y módulos (api-contract §4) con progreso fusionado."""

from __future__ import annotations

import asyncio

from content_factory import LESSON_IDS


def test_lesson_detail_full_shape(client) -> None:
    response = client.get("/api/v1/lessons/l01")
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == {
        "id", "module_id", "order", "title", "content_markdown", "example_id",
        "has_quiz", "quiz_question_count", "estimated_minutes", "enabled",
        "prev_lesson_id", "next_lesson_id", "recommended", "progress",
    }
    assert data["content_markdown"].startswith("# Lección l01")
    assert data["example_id"] == "l01"
    assert data["has_quiz"] is True and data["quiz_question_count"] == 5
    assert data["recommended"] == [
        {"lesson_id": "l02", "label": "Siguiente paso", "tag": "Básico"}
    ]
    # sin registro en SQLite → progreso en cero con quiz_total del fixture
    assert data["progress"] == {
        "viewed": False, "completed": False,
        "best_quiz_score": None, "quiz_total": 5,
    }


def test_lesson_prev_next_linear_route(client) -> None:
    first = client.get("/api/v1/lessons/l01").json()["data"]
    assert first["prev_lesson_id"] is None
    assert first["next_lesson_id"] == "l02"
    middle = client.get("/api/v1/lessons/l07").json()["data"]
    assert (middle["prev_lesson_id"], middle["next_lesson_id"]) == ("l06", "l08")
    last = client.get(f"/api/v1/lessons/{LESSON_IDS[-1]}").json()["data"]
    assert last["next_lesson_id"] is None


def test_lesson_merges_progress_record(client, progress_repo) -> None:
    asyncio.run(
        progress_repo.upsert("l02", viewed=True, best_quiz_score=3)
    )
    data = client.get("/api/v1/lessons/l02").json()["data"]
    assert data["progress"] == {
        "viewed": True, "completed": False,
        "best_quiz_score": 3, "quiz_total": 5,
    }


def test_lesson_never_leaks_quiz_keys(client) -> None:
    response = client.get("/api/v1/lessons/l01")
    assert "correct_key" not in response.text


def test_lesson_unknown_404_envelope(client) -> None:
    response = client.get("/api/v1/lessons/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "LESSON_NOT_FOUND"


# ─────────────────────────── GET /api/v1/modules ─────────────────────────────


def test_modules_catalog_merges_progress_and_summary(client, progress_repo) -> None:
    asyncio.run(progress_repo.upsert("l01", viewed=True, completed=True,
                                     best_quiz_score=4))
    asyncio.run(progress_repo.upsert("l05", viewed=True))
    body = client.get("/api/v1/modules").json()
    assert body["success"] is True
    modules = body["data"]["modules"]
    assert [m["id"] for m in modules] == ["m1", "m2", "m3", "m4"]

    lesson_1 = modules[0]["lessons"][0]
    assert lesson_1["id"] == "l01"
    assert set(lesson_1) == {
        "id", "order", "title", "example_id", "has_quiz",
        "quiz_question_count", "estimated_minutes", "enabled", "progress",
    }
    assert lesson_1["progress"] == {
        "viewed": True, "completed": True,
        "best_quiz_score": 4, "quiz_total": 5,
    }
    # con registro parcial: viewed sí, completed no
    lesson_5 = modules[1]["lessons"][0]
    assert lesson_5["id"] == "l05"
    assert lesson_5["progress"]["viewed"] is True
    assert lesson_5["progress"]["completed"] is False
    # sin registro → todo en cero
    lesson_2 = modules[0]["lessons"][1]
    assert lesson_2["progress"] == {
        "viewed": False, "completed": False,
        "best_quiz_score": None, "quiz_total": 5,
    }
    assert body["data"]["summary"] == {
        "lessons_total": 14, "lessons_enabled": 13, "lessons_completed": 1,
        "quizzes_total": 14, "questions_enabled_total": 60,
    }


def test_modules_disabled_lesson_listed_as_disabled(client) -> None:
    modules = client.get("/api/v1/modules").json()["data"]["modules"]
    gpu_module = modules[-1]
    assert gpu_module["id"] == "m4"
    assert gpu_module["lessons"][0]["id"] == "l14"
    assert gpu_module["lessons"][0]["enabled"] is False


def test_modules_never_leak_quiz_keys_nor_markdown(client) -> None:
    response = client.get("/api/v1/modules")
    assert "correct_key" not in response.text
    assert "content_markdown" not in response.text
    assert "source_code" not in response.text
