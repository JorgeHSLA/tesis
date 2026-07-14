"""Validador CLI ``python -m app.tools.validate_content`` (WP3; lo usa WP4)."""

from __future__ import annotations

from pathlib import Path

import pytest
from content_factory import make_content, rewrite_json

from app.tools.validate_content import (
    lint_markdown_subset,
    main,
    validate_content_dir,
)


def test_cli_passes_on_valid_mini_fixtures(content_dir: Path, capsys) -> None:
    assert main(["--content-dir", str(content_dir)]) == 0
    out = capsys.readouterr().out
    assert "contenido OK" in out
    assert "14 lecciones" in out and "60 preguntas habilitadas" in out


def test_cli_fails_on_broken_catalog(content_dir: Path, capsys) -> None:
    (content_dir / "catalog.json").write_text("{roto", encoding="utf-8")
    assert main(["--content-dir", str(content_dir)]) == 1
    err = capsys.readouterr().err
    assert "INVÁLIDO" in err and "JSON inválido" in err


def test_cli_fails_on_59_enabled_questions(content_dir: Path, capsys) -> None:
    rewrite_json(
        content_dir / "quizzes" / "l01.json",
        lambda quiz: quiz["questions"].pop(),
    )
    assert main(["--content-dir", str(content_dir)]) == 1
    assert "60" in capsys.readouterr().err


def test_cli_fails_on_correct_key_out_of_options(content_dir: Path, capsys) -> None:
    def mutate(quiz: dict) -> None:
        quiz["questions"][0]["options"] = quiz["questions"][0]["options"][:2]
        quiz["questions"][0]["correct_key"] = "d"

    rewrite_json(content_dir / "quizzes" / "l05.json", mutate)
    assert main(["--content-dir", str(content_dir)]) == 1
    assert "correct_key" in capsys.readouterr().err


def test_cli_fails_on_missing_content_dir(tmp_path: Path, capsys) -> None:
    assert main(["--content-dir", str(tmp_path / "no-existe")]) == 1
    assert "no existe" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("bad_markdown", "fragment"),
    [
        ("##### título h5\n", "h5+"),
        ("mira la ![imagen](foo.png)\n", "imagen"),
        ("> cita en blockquote\n", "blockquote"),
        ("texto con <div>html crudo</div>\n", "HTML crudo"),
        ("```python\nprint('fence sin cerrar')\n", "sin cerrar"),
    ],
)
def test_cli_rejects_markdown_outside_subset(
    content_dir: Path, capsys, bad_markdown: str, fragment: str
) -> None:
    lesson = content_dir / "lessons" / "l02.md"
    lesson.write_text(
        lesson.read_text(encoding="utf-8") + "\n" + bad_markdown,
        encoding="utf-8",
    )
    assert main(["--content-dir", str(content_dir)]) == 1
    err = capsys.readouterr().err
    assert fragment in err and "lessons/l02.md" in err


def test_lint_allows_full_valid_subset() -> None:
    valid = (
        "# h1\n## h2\n### h3\n#### h4\n\n"
        "Párrafo con **negrita**, *cursiva*, `código <b>inline</b>` y "
        "[enlace](https://openmp.org).\n\n"
        "- lista\n  - anidada\n1. ordenada\n\n"
        "```python\n##### dentro del fence todo vale <div> > ![img](x)\n```\n\n"
        "| a | b |\n|---|---|\n| 1 | 2 |\n"
    )
    assert lint_markdown_subset(valid, "lessons/x.md") == []


def test_validate_content_dir_reports_summary(content_dir: Path) -> None:
    problems, summary = validate_content_dir(content_dir)
    assert problems == []
    assert summary is not None and "60 preguntas habilitadas" in summary
