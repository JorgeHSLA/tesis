"""Validador conservador del subset de markdown permitido en las lecciones.

Puerto backend de ``frontend/src/lib/markdown.ts`` (el renderer del estudiante):
el editor admin escribe markdown y el estudiante lo ve renderizado por ese mismo
subset, así que el contenido debe quedar DENTRO de él. Este validador es
deliberadamente conservador (rechaza lo dudoso) para no permitir constructos que
el renderer trataría como texto plano o —peor— que abrieran un vector no
contemplado:

- **Sin HTML crudo**: ``<tag>`` / ``</tag>`` fuera de bloques/código en línea →
  rechazo (el renderer los escaparía; en el subset no se permiten).
- **Enlaces seguros**: ``[texto](url)`` solo con ``http(s)://``, ``#`` o rutas
  relativas (``/`` o ``./``). Cualquier otro esquema (``javascript:``,
  ``data:``…) → rechazo. Espeja ``safeHref`` de ``markdown.ts``.
- **Fences cerrados**: el número de líneas ```` ``` ```` debe ser par (todo
  bloque abierto se cierra).
- **Encabezados h1-h4**: ``#####`` (h5+) no pertenece al subset → rechazo.

``validate(md) -> list[dict]`` devuelve una lista de ``{"field","line","reason"}``
(vacía ⇒ OK) apta para ``ApiError.details``. El campo siempre es
``content_markdown``.
"""

from __future__ import annotations

import re

#: Marca de bloque de código fenced (igual que ``markdown.ts``: ``/^\s*```/``).
_FENCE_RE = re.compile(r"^\s*```")
#: Encabezado h5+ (fuera del subset h1-h4).
_H5_PLUS_RE = re.compile(r"^\s*#{5,}\s")
#: Etiqueta HTML cruda de apertura/cierre (``<tag ...>`` / ``</tag>``).
_HTML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
#: Código en línea (se elimina antes de buscar HTML: ``<...>`` ahí es contenido).
_INLINE_CODE_RE = re.compile(r"`[^`]*`")
#: Enlaces markdown ``[texto](url)`` (misma forma que ``markdown.ts``).
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
#: Esquemas de href admitidos (espejo de ``safeHref``): http(s), ``#`` o relativo.
_SAFE_HREF_RE = re.compile(r"^(https?://|#|\.?/)", re.IGNORECASE)

#: Nombre de campo reportado en los ``details``.
_FIELD = "content_markdown"


def _issue(line: int, reason: str) -> dict:
    return {"field": _FIELD, "line": line, "reason": reason}


def validate(md: str) -> list[dict]:
    """Devuelve los problemas del markdown frente al subset (vacío ⇒ válido)."""
    issues: list[dict] = []
    lines = md.replace("\r\n", "\n").split("\n")

    fence_count = 0
    in_fence = False
    for index, line in enumerate(lines, start=1):
        if _FENCE_RE.match(line):
            fence_count += 1
            in_fence = not in_fence
            continue
        if in_fence:
            # Dentro de un bloque de código todo es contenido literal.
            continue

        if _H5_PLUS_RE.match(line):
            issues.append(
                _issue(index, "solo se permiten encabezados h1-h4 (#, ##, ###, ####)")
            )

        # Se protege el código en línea antes de buscar HTML crudo/enlaces.
        without_code = _INLINE_CODE_RE.sub("", line)

        if _HTML_TAG_RE.search(without_code):
            issues.append(
                _issue(index, "HTML crudo no permitido en el subset de markdown")
            )

        for _text, url in _LINK_RE.findall(without_code):
            if not _SAFE_HREF_RE.match(url.strip()):
                issues.append(
                    _issue(
                        index,
                        f"enlace con esquema no permitido: {url!r} "
                        "(usa http(s)://, # o una ruta relativa)",
                    )
                )

    if fence_count % 2 != 0:
        issues.append(
            _issue(len(lines), "bloque de código sin cerrar (``` sin su cierre)")
        )

    return issues
