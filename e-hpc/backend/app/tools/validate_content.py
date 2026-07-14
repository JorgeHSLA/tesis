"""Validador CLI de los fixtures de contenido (WP3; lo consume WP4).

``python -m app.tools.validate_content [--content-dir DIR]``

Verifica:
1. Carga completa vía ``ContentRepository`` — JSON parseable, esquemas
   pydantic, invariantes de ``data-model.md`` §4.4 (14+14+14, referencias,
   parser_id válidos, UTF-8, 60 preguntas habilitadas, correct_key ∈
   opciones). Fail-fast: el primer invariante roto aborta con detalle.
2. Subset markdown de ``frontend-spec.md`` §1 en cada ``lessons/*.md``:
   h1-h4, párrafos, listas anidadas, código inline + fenced, negrita/cursiva,
   enlaces y tablas simples. Se rechazan h5+, imágenes, blockquotes, HTML
   crudo y fences sin cerrar.

Exit code 0 si todo pasa; 1 con el detalle de problemas si no.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from app.repositories.content import ContentError, ContentRepository

_H5_PLUS = re.compile(r"^\s{0,3}#{5,}\s")
_IMAGE = re.compile(r"!\[")
_BLOCKQUOTE = re.compile(r"^\s{0,3}>")
_INLINE_CODE = re.compile(r"`[^`]*`")
_HTML_TAG = re.compile(
    r"</?(?:div|span|img|br|hr|table|thead|tbody|tr|td|th|script|iframe|"
    r"style|a|p|ul|ol|li|h[1-6]|em|strong|b|i|u|pre|code|blockquote|"
    r"details|summary|font|center|section|article)\b[^>]*>",
    re.IGNORECASE,
)
_FENCE = re.compile(r"^\s{0,3}(```|~~~)")


def lint_markdown_subset(text: str, origin: str) -> list[str]:
    """Problemas del subset markdown (frontend-spec §1) en un lesson .md."""
    problems: list[str] = []
    in_fence = False
    for number, line in enumerate(text.splitlines(), start=1):
        if _FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue  # dentro de código fenced todo vale
        bare = _INLINE_CODE.sub("", line)  # el código inline queda exento
        if _H5_PLUS.match(bare):
            problems.append(f"{origin}:{number}: encabezado h5+ (subset: h1-h4)")
        if _IMAGE.search(bare):
            problems.append(f"{origin}:{number}: imagen (fuera del subset)")
        if _BLOCKQUOTE.match(bare):
            problems.append(f"{origin}:{number}: blockquote (fuera del subset)")
        if _HTML_TAG.search(bare):
            problems.append(f"{origin}:{number}: HTML crudo (fuera del subset)")
    if in_fence:
        problems.append(f"{origin}: bloque de código fenced sin cerrar")
    return problems


def validate_content_dir(content_dir: Path) -> tuple[list[str], str | None]:
    """(problemas, resumen) — resumen solo si la carga básica funcionó."""
    try:
        repo = ContentRepository(content_dir)
    except ContentError as exc:
        return [f"invariantes: {exc}"], None

    problems: list[str] = []
    for lesson in repo.lessons():
        problems.extend(
            lint_markdown_subset(lesson.content_markdown, f"lessons/{lesson.id}.md")
        )

    lessons = repo.lessons()
    enabled_questions = sum(
        len(quiz.questions)
        for lesson in lessons
        if lesson.enabled and (quiz := repo.quiz(lesson.id)) is not None
    )
    summary = (
        f"{len(repo.modules())} módulos · {len(lessons)} lecciones · "
        f"{len(repo.examples())} ejemplos · "
        f"{sum(1 for lesson in lessons if lesson.has_quiz)} quizzes · "
        f"{enabled_questions} preguntas habilitadas"
    )
    return problems, summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.tools.validate_content",
        description="Valida los fixtures de backend/app/content/",
    )
    default_dir = Path(__file__).resolve().parents[1] / "content"
    parser.add_argument(
        "--content-dir",
        type=Path,
        default=default_dir,
        help=f"directorio de contenido (default: {default_dir})",
    )
    args = parser.parse_args(argv)

    problems, summary = validate_content_dir(args.content_dir)
    if problems:
        print(f"contenido INVÁLIDO en {args.content_dir}:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print(f"contenido OK en {args.content_dir}: {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
