"""Suite 6b (architecture §11): routers de contenido contra el CONTRATO
(api-contract §3-§6) con los fixtures REALES de WP4.

Regla de oro §5: ``correct_key``/``explanation`` JAMÁS salen en el GET del
quiz; la corrección es 100 % server-side y el progreso se actualiza
atómicamente con el intento.
"""

from __future__ import annotations

import pytest

from test_routers_jobs import assert_error_envelope, assert_ok_envelope


def correct_answers(real_content, lesson_id: str) -> dict[str, str]:
    quiz = real_content.quiz(lesson_id)
    return {q.id: q.correct_key for q in quiz.questions}


# ─────────────────────────── examples §3 ─────────────────────────────────────


def test_examples_listado_14_sin_codigo(client):
    data = assert_ok_envelope(client.get("/api/v1/examples"))["data"]
    examples = data["examples"]
    assert len(examples) == 14
    assert [e["order"] for e in examples] == list(range(1, 15))
    for example in examples:
        assert "source_code" not in example  # §3.1: listado SIN código
        assert example["parser_id"] in {
            "none", "sweep_pi", "sweep_transporte", "pair_openmp_numpy",
            "pair_openmp_blas", "pair_parallel_serial",
        }
    gpu = next(e for e in examples if e["id"] == "sumaVectoresGPU")
    assert gpu["enabled"] is False and gpu["requires_gpu"] is True
    spmd = next(e for e in examples if e["id"] == "spmd")
    assert spmd["threads_configurable"] is False
    assert spmd["sweeps_threads"] is True
    assert spmd["fixed_threads"] is None  # sweep: el slider muestra 1·2·4·8


def test_example_detalle_con_codigo_y_takeaways(client):
    data = assert_ok_envelope(client.get("/api/v1/examples/spmd"))["data"]
    assert data["source_code"].strip()
    assert data["lesson_id"] == "spmd"
    assert data["expected_output_note"]
    assert 3 <= len(data["takeaways"]) <= 4
    assert "quiz" not in data  # el quiz NO viaja en el detalle


def test_example_detalle_404(client):
    assert_error_envelope(
        client.get("/api/v1/examples/no-existe"), 404, "EXAMPLE_NOT_FOUND"
    )


# ─────────────────────────── modules §4.1 ────────────────────────────────────


def test_modules_catalogo_completo(client):
    data = assert_ok_envelope(client.get("/api/v1/modules"))["data"]
    modules = data["modules"]
    assert len(modules) == 8
    assert [m["order"] for m in modules] == list(range(1, 9))
    all_lessons = [lesson for m in modules for lesson in m["lessons"]]
    assert len(all_lessons) == 14
    assert data["summary"] == {
        "lessons_total": 14,
        "lessons_enabled": 13,
        "lessons_completed": 0,
        "quizzes_total": 14,
        "questions_enabled_total": 60,
    }
    first = all_lessons[0]
    assert first["progress"] == {
        "viewed": False, "completed": False,
        "best_quiz_score": None, "quiz_total": first["quiz_question_count"],
    }
    gpu_lesson = next(l for l in all_lessons if l["id"] == "sumaVectoresGPU")
    assert gpu_lesson["enabled"] is False


def test_modules_reflejan_progreso(client, real_content):
    lesson_id = real_content.lessons()[0].id
    client.put(f"/api/v1/progress/lessons/{lesson_id}", json={"viewed": True})
    answers = correct_answers(real_content, lesson_id)
    client.post(f"/api/v1/lessons/{lesson_id}/quiz/attempts",
                json={"answers": answers})
    data = assert_ok_envelope(client.get("/api/v1/modules"))["data"]
    lesson = next(
        l for m in data["modules"] for l in m["lessons"] if l["id"] == lesson_id
    )
    assert lesson["progress"]["viewed"] is True
    assert lesson["progress"]["completed"] is True  # aprobó con todo correcto
    assert lesson["progress"]["best_quiz_score"] == len(answers)
    assert data["summary"]["lessons_completed"] == 1


# ─────────────────────────── lessons §4.2 ────────────────────────────────────


def test_lesson_completa(client, real_content):
    data = assert_ok_envelope(client.get("/api/v1/lessons/spmd"))["data"]
    assert data["id"] == "spmd"
    assert data["example_id"] == "spmd"  # lesson_id == example_id
    assert data["content_markdown"].strip()
    assert data["has_quiz"] is True
    assert data["quiz_question_count"] >= 1
    assert data["prev_lesson_id"] is not None  # spmd no es la primera
    assert data["next_lesson_id"] is not None
    for recommended in data["recommended"]:
        assert set(recommended) == {"lesson_id", "label", "tag"}
        assert real_content.exists_lesson(recommended["lesson_id"])
    assert data["progress"]["viewed"] is False


def test_lesson_primera_y_ultima_de_la_ruta(client, real_content):
    ordered = real_content.lessons()
    first = assert_ok_envelope(
        client.get(f"/api/v1/lessons/{ordered[0].id}")
    )["data"]
    assert first["prev_lesson_id"] is None
    last = assert_ok_envelope(
        client.get(f"/api/v1/lessons/{ordered[-1].id}")
    )["data"]
    assert last["next_lesson_id"] is None


def test_lesson_404(client):
    assert_error_envelope(
        client.get("/api/v1/lessons/no-existe"), 404, "LESSON_NOT_FOUND"
    )


# ──────────────────────────── quiz §5.1 ──────────────────────────────────────


def test_quiz_jamas_filtra_correct_key(client):
    response = client.get("/api/v1/lessons/spmd/quiz")
    body = assert_ok_envelope(response)
    data = body["data"]
    assert data["lesson_id"] == "spmd"
    assert data["question_count"] == len(data["questions"])
    for question in data["questions"]:
        assert set(question) == {"id", "order", "text", "options"}
        for option in question["options"]:
            assert set(option) == {"key", "text"}
            assert option["key"] in {"a", "b", "c", "d"}
    # ni el texto serializado contiene las claves prohibidas
    assert "correct_key" not in response.text
    assert "explanation" not in response.text


def test_quiz_404(client):
    assert_error_envelope(
        client.get("/api/v1/lessons/no-existe/quiz"), 404, "LESSON_NOT_FOUND"
    )


# ────────────────────────── attempts §5.2 ────────────────────────────────────


def test_attempt_todo_correcto_201(client, real_content):
    answers = correct_answers(real_content, "spmd")
    response = client.post(
        "/api/v1/lessons/spmd/quiz/attempts", json={"answers": answers}
    )
    data = assert_ok_envelope(response, 201)["data"]
    assert data["lesson_id"] == "spmd"
    assert data["score"] == data["total"] == len(answers)
    assert data["passed"] is True
    assert data["pass_threshold"] == 0.8
    assert data["created_at"].endswith("Z")
    assert len(data["results"]) == len(answers)
    for result in data["results"]:
        assert result["correct"] is True
        assert result["selected"] == result["correct_key"]
        assert result["explanation"]  # el feedback SÍ lleva explicación


def test_attempt_con_fallos_score_parcial(client, real_content):
    quiz = real_content.quiz("spmd")
    answers = correct_answers(real_content, "spmd")
    first_q = quiz.questions[0]
    wrong = next(
        o.key for o in first_q.options if o.key != first_q.correct_key
    )
    answers[first_q.id] = wrong
    data = assert_ok_envelope(
        client.post("/api/v1/lessons/spmd/quiz/attempts",
                    json={"answers": answers}),
        201,
    )["data"]
    assert data["score"] == data["total"] - 1
    failed = next(r for r in data["results"] if r["question_id"] == first_q.id)
    assert failed["correct"] is False
    assert failed["selected"] == wrong
    assert failed["correct_key"] == first_q.correct_key


def test_attempt_actualiza_progreso_atomicamente(client, real_content):
    answers = correct_answers(real_content, "spmd")
    client.post("/api/v1/lessons/spmd/quiz/attempts", json={"answers": answers})
    progress = assert_ok_envelope(client.get("/api/v1/progress"))["data"]
    entry = progress["lessons"]["spmd"]
    assert entry["completed"] is True
    assert entry["best_quiz_score"] == len(answers)

    # un intento PEOR después no degrada el best_score
    first_q = real_content.quiz("spmd").questions[0]
    wrong = next(
        o.key for o in first_q.options if o.key != first_q.correct_key
    )
    worse = dict(answers, **{first_q.id: wrong})
    client.post("/api/v1/lessons/spmd/quiz/attempts", json={"answers": worse})
    progress = assert_ok_envelope(client.get("/api/v1/progress"))["data"]
    entry = progress["lessons"]["spmd"]
    assert entry["best_quiz_score"] == len(answers)
    assert entry["completed"] is True  # aprobar es pegajoso


def test_attempt_validaciones_422(client, real_content):
    answers = correct_answers(real_content, "spmd")
    # falta una pregunta
    incomplete = dict(answers)
    incomplete.pop(next(iter(incomplete)))
    body = assert_error_envelope(
        client.post("/api/v1/lessons/spmd/quiz/attempts",
                    json={"answers": incomplete}),
        422, "VALIDATION_ERROR",
    )
    assert body["error"]["details"]  # detalle por pregunta
    # pregunta inexistente
    extra = dict(answers, **{"spmd-q999": "a"})
    assert_error_envelope(
        client.post("/api/v1/lessons/spmd/quiz/attempts",
                    json={"answers": extra}),
        422, "VALIDATION_ERROR",
    )
    # opción fuera de a|b|c|d
    bad_option = dict(answers)
    bad_option[next(iter(bad_option))] = "z"
    assert_error_envelope(
        client.post("/api/v1/lessons/spmd/quiz/attempts",
                    json={"answers": bad_option}),
        422, "VALIDATION_ERROR",
    )
    # body sin answers
    assert_error_envelope(
        client.post("/api/v1/lessons/spmd/quiz/attempts", json={}),
        422, "VALIDATION_ERROR",
    )


def test_attempt_leccion_inexistente_404(client):
    assert_error_envelope(
        client.post("/api/v1/lessons/no-existe/quiz/attempts",
                    json={"answers": {}}),
        404, "LESSON_NOT_FOUND",
    )


def test_attempts_historial_meta(client, real_content):
    answers = correct_answers(real_content, "spmd")
    for _ in range(2):
        client.post("/api/v1/lessons/spmd/quiz/attempts",
                    json={"answers": answers})
    response = client.get("/api/v1/lessons/spmd/quiz/attempts",
                          params={"limit": 1})
    body = assert_ok_envelope(response)
    assert body["meta"] == {"total": 2, "limit": 1, "offset": 0}
    (attempt,) = body["data"]["attempts"]
    assert set(attempt) == {"attempt_id", "score", "total", "passed", "created_at"}
    assert_error_envelope(
        client.get("/api/v1/lessons/no-existe/quiz/attempts"),
        404, "LESSON_NOT_FOUND",
    )


# ─────────────────────────── progress §6 ─────────────────────────────────────


def test_progress_vacio(client):
    data = assert_ok_envelope(client.get("/api/v1/progress"))["data"]
    assert data["lessons"] == {}  # solo lecciones con registro
    assert data["summary"] == {
        "lessons_completed": 0, "lessons_enabled": 13,
        "modules_completed": 0, "modules_total": 8,
    }


def test_put_progress_viewed(client):
    response = client.put(
        "/api/v1/progress/lessons/spmd", json={"viewed": True}
    )
    data = assert_ok_envelope(response)["data"]
    assert data["viewed"] is True and data["completed"] is False
    assert data["best_quiz_score"] is None
    assert data["quiz_total"] >= 1
    assert data["updated_at"]
    # persiste y aparece en el mapa
    progress = assert_ok_envelope(client.get("/api/v1/progress"))["data"]
    assert progress["lessons"]["spmd"]["viewed"] is True


def test_put_progress_solo_toca_lo_enviado(client):
    client.put("/api/v1/progress/lessons/spmd", json={"viewed": True})
    data = assert_ok_envelope(
        client.put("/api/v1/progress/lessons/spmd", json={"completed": True})
    )["data"]
    assert data["viewed"] is True and data["completed"] is True


def test_put_progress_no_escribe_best_score_ni_last_job(client, real_content):
    """§6.2: best_quiz_score/last_job_id NO son escribibles por PUT."""
    answers = correct_answers(real_content, "spmd")
    client.post("/api/v1/lessons/spmd/quiz/attempts", json={"answers": answers})
    data = assert_ok_envelope(
        client.put(
            "/api/v1/progress/lessons/spmd",
            json={"viewed": True, "best_quiz_score": 0, "last_job_id": "hack"},
        )
    )["data"]
    assert data["best_quiz_score"] == len(answers)  # intacto
    assert data["last_job_id"] is None


def test_put_progress_404_y_422(client):
    assert_error_envelope(
        client.put("/api/v1/progress/lessons/no-existe", json={"viewed": True}),
        404, "LESSON_NOT_FOUND",
    )
    assert_error_envelope(
        client.put("/api/v1/progress/lessons/spmd", json={"viewed": "quizas"}),
        422, "VALIDATION_ERROR",
    )


def test_modules_completed_en_summary(client, real_content):
    """Completar TODAS las lecciones habilitadas de un módulo lo completa."""
    module = real_content.modules()[0]
    enabled = [
        lid for lid in module.lesson_ids
        if real_content.lesson(lid).enabled
    ]
    assert enabled
    for lesson_id in enabled:
        client.put(
            f"/api/v1/progress/lessons/{lesson_id}", json={"completed": True}
        )
    data = assert_ok_envelope(client.get("/api/v1/progress"))["data"]
    assert data["summary"]["modules_completed"] == 1
    assert data["summary"]["lessons_completed"] == len(enabled)
