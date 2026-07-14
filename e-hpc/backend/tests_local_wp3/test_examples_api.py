"""Endpoints de ejemplos (api-contract §3) contra la app con fakes."""

from __future__ import annotations

from content_factory import LESSON_IDS


def test_list_examples_shape_and_order(client) -> None:
    response = client.get("/api/v1/examples")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True and body["error"] is None
    examples = body["data"]["examples"]
    assert [e["id"] for e in examples] == list(LESSON_IDS)  # order global
    first = examples[0]
    # §3.1: TODOS los flags de la tabla, presentes en cada item
    assert set(first) == {
        "id", "title", "module_id", "order", "filename", "difficulty",
        "teaches", "directives", "threads_configurable", "fixed_threads",
        "fixed_threads_note", "sweeps_threads", "self_measures", "parser_id",
        "default_timeout_s", "est_run_seconds", "enabled", "requires_gpu",
    }
    assert first["est_run_seconds"] == 5


def test_list_examples_has_no_source_code(client) -> None:
    response = client.get("/api/v1/examples")
    assert "source_code" not in response.text
    assert "takeaways" not in response.text  # solo en el detalle


def test_list_examples_disabled_gpu_visible(client) -> None:
    examples = client.get("/api/v1/examples").json()["data"]["examples"]
    gpu = next(e for e in examples if e["id"] == "l14")
    assert gpu["enabled"] is False and gpu["requires_gpu"] is True


def test_detail_includes_code_takeaways_and_fixed_threads(client) -> None:
    response = client.get("/api/v1/examples/l03")
    assert response.status_code == 200
    data = response.json()["data"]
    # §3.2: listado + los 4 campos extra
    assert 'print("main de l03")' in data["source_code"]
    assert data["lesson_id"] == "l03"
    assert data["expected_output_note"]
    assert data["takeaways"] == [
        "takeaway 1 de l03", "takeaway 2 de l03", "takeaway 3 de l03",
    ]
    # slider bloqueado parseable (§3.1 tabla)
    assert data["threads_configurable"] is False
    assert data["fixed_threads"] == 4
    assert data["fixed_threads_note"] == "num_threads(4)"
    assert data["est_run_seconds"] == 5


def test_detail_never_embeds_quiz(client) -> None:
    """El detalle NO incluye el quiz (eso es de /lessons/{id}/quiz)."""
    response = client.get("/api/v1/examples/l01")
    data = response.json()["data"]
    assert "quiz" not in data and "questions" not in data
    assert "correct_key" not in response.text
    assert "explanation" not in response.text


def test_detail_unknown_example_404_envelope(client) -> None:
    response = client.get("/api/v1/examples/nope")
    assert response.status_code == 404
    body = response.json()
    assert body["success"] is False and body["data"] is None
    assert body["error"]["code"] == "EXAMPLE_NOT_FOUND"
