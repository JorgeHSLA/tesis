"""ContentRepository: carga válida + fail-fast ante cada invariante roto."""

from __future__ import annotations

from pathlib import Path

import pytest
from content_factory import DISABLED_ID, LESSON_IDS, make_content, rewrite_json

from app.repositories.content import ContentError, ContentRepository


def test_valid_content_loads(content_repo: ContentRepository) -> None:
    assert len(content_repo.lessons()) == 14
    assert len(content_repo.examples()) == 14
    assert len(content_repo.modules()) == 4
    assert content_repo.exists_lesson("l01")
    assert content_repo.exists_example("l01")
    assert not content_repo.exists_lesson("nope")

    lesson = content_repo.lesson("l01")
    assert lesson is not None
    assert lesson.content_markdown.startswith("# Lección l01")
    assert lesson.has_quiz and lesson.quiz_question_count == 5

    example = content_repo.example("l01")
    assert example is not None
    assert 'print("main de l01")' in example.source_code

    quiz = content_repo.quiz("l01")
    assert quiz is not None
    assert quiz.questions[0].correct_key == "b"  # interno: SÍ tiene la clave


def test_prev_next_follow_global_order(content_repo: ContentRepository) -> None:
    lessons = content_repo.lessons()
    assert lessons[0].prev_lesson_id is None
    assert lessons[0].next_lesson_id == lessons[1].id
    assert lessons[-1].next_lesson_id is None
    assert lessons[-1].prev_lesson_id == lessons[-2].id


def test_disabled_lesson_reflects_example(content_repo: ContentRepository) -> None:
    lesson = content_repo.lesson(DISABLED_ID)
    assert lesson is not None and lesson.enabled is False
    assert sum(1 for lesson in content_repo.lessons() if lesson.enabled) == 13


def _expect_error(root: Path, fragment: str) -> None:
    with pytest.raises(ContentError) as excinfo:
        ContentRepository(root)
    assert fragment in str(excinfo.value)


def test_missing_catalog_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    (root / "catalog.json").unlink()
    _expect_error(root, "catalog.json")


def test_invalid_json_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    (root / "catalog.json").write_text("{no json", encoding="utf-8")
    _expect_error(root, "JSON inválido")


def test_missing_main_py_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    (root / "examples" / "l05" / "main.py").unlink()
    _expect_error(root, "examples/l05/main.py")


def test_non_utf8_main_py_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    (root / "examples" / "l05" / "main.py").write_bytes(b"\xff\xfe\x00bad")
    _expect_error(root, "UTF-8")


def test_missing_lesson_markdown_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    (root / "lessons" / "l07.md").unlink()
    _expect_error(root, "l07")


def test_unknown_parser_id_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    rewrite_json(
        root / "catalog.json",
        lambda c: c["examples"]["l01"].__setitem__("parser_id", "sweep_magico"),
    )
    _expect_error(root, "esquema inválido")


def test_correct_key_not_in_options_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")

    def mutate(quiz: dict) -> None:
        quiz["questions"][0]["options"] = quiz["questions"][0]["options"][:3]
        quiz["questions"][0]["correct_key"] = "d"

    rewrite_json(root / "quizzes" / "l02.json", mutate)
    _expect_error(root, "correct_key")


def test_59_enabled_questions_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    rewrite_json(
        root / "quizzes" / "l01.json",
        lambda quiz: quiz["questions"].pop(),
    )
    _expect_error(root, "60")


def test_missing_quiz_file_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    (root / "quizzes" / "l03.json").unlink()
    _expect_error(root, "l03")


def test_quiz_lesson_id_mismatch_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    rewrite_json(
        root / "quizzes" / "l03.json",
        lambda quiz: quiz.__setitem__("lesson_id", "otro"),
    )
    _expect_error(root, "lesson_id interno")


def test_duplicate_question_id_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    rewrite_json(
        root / "quizzes" / "l01.json",
        lambda quiz: quiz["questions"][1].__setitem__("id", "l01-q1"),
    )
    _expect_error(root, "duplicada")


def test_module_referencing_unknown_lesson_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    rewrite_json(
        root / "catalog.json",
        lambda c: c["modules"][0]["lessons"].append("fantasma"),
    )
    _expect_error(root, "fantasma")


def test_lesson_count_mismatch_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")

    def mutate(catalog: dict) -> None:
        del catalog["lessons"]["l13"]
        del catalog["examples"]["l13"]
        catalog["modules"][2]["lessons"].remove("l13")

    rewrite_json(root / "catalog.json", mutate)
    # 13 ≠ 14: salta el invariante de conteo (antes que el extra en disco)
    _expect_error(root, "14 lecciones")


def test_examples_lessons_id_mismatch_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    rewrite_json(
        root / "catalog.json",
        lambda c: c["examples"].__setitem__("l99", c["examples"].pop("l06")),
    )
    _expect_error(root, "mismos ids")


def test_recommended_unknown_lesson_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    rewrite_json(
        root / "catalog.json",
        lambda c: c["lessons"]["l01"]["recommended"][0].__setitem__(
            "lesson_id", "fantasma"
        ),
    )
    _expect_error(root, "recommended")


def test_extra_example_dir_fails(tmp_path: Path) -> None:
    root = make_content(tmp_path / "content")
    extra = root / "examples" / "colado"
    extra.mkdir()
    (extra / "main.py").write_text("print()\n", encoding="utf-8")
    _expect_error(root, "colado")


def test_all_lesson_ids_present(content_repo: ContentRepository) -> None:
    assert {lesson.id for lesson in content_repo.lessons()} == set(LESSON_IDS)
