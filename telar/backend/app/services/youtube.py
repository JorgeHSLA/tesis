"""Validación y normalización de las URLs de video de las lecciones.

Los videos de Telar son enlaces a YouTube **no listado**: no se descargan, no se
almacenan y no se sirven desde aquí. Lo que viaja —en el body del admin y, desde
Fase 5, dentro de un bundle del bucket— es la URL, o sea **entrada no confiable**.

Por eso este módulo no «valida y deja pasar»: **extrae el id del video, lo
comprueba contra el formato de YouTube y RECONSTRUYE** una URL canónica. Nada de
lo que venía en la URL original sobrevive salvo ese id (y el segundo de arranque,
si era un entero). Así, una URL hostil no puede colarse entera hasta el
``<iframe>`` del estudiante.

Es el espejo exacto de ``frontend/src/features/learn/lessonVideos.ts``
(``resolveYouTubeEmbed``), con la misma diferencia de rol que hay entre
``markdown_validator.py`` y ``lib/markdown.ts``: el backend decide qué se
GUARDA, el frontend decide qué se MONTA. Y la CSP de Electron
(``electron-spec.md`` §7.1) es la tercera barrera, independiente de las dos.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

#: Id de video de YouTube: 11 caracteres del alfabeto base64url.
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

#: Hosts aceptados, ya sin el prefijo ``www.``/``m.``.
_HOSTS = frozenset({"youtube.com", "youtube-nocookie.com"})

#: Forma canónica en la que se guarda. Se elige ``watch?v=`` (y no el embed)
#: porque es la URL que el admin reconoce al pegarla y la que abre bien fuera de
#: la app; el frontend deriva de aquí el embed sobre ``youtube-nocookie.com``.
_CANONICA = "https://www.youtube.com/watch?v={id}"


class VideoUrlError(ValueError):
    """La URL no es un video de YouTube utilizable (→ 422)."""


def _extraer_id(url: str) -> str | None:
    try:
        partes = urlparse(url)
    except ValueError:
        return None

    # Solo https: descarta de golpe javascript:, data:, file: y http en claro.
    if partes.scheme != "https":
        return None

    host = (partes.hostname or "").lower()
    host = re.sub(r"^(www\.|m\.)", "", host)

    if host == "youtu.be":
        candidato = partes.path.lstrip("/")
        return candidato if _ID_RE.match(candidato) else None

    if host not in _HOSTS:
        return None

    if partes.path == "/watch":
        valores = parse_qs(partes.query).get("v") or []
        candidato = valores[0] if valores else ""
        return candidato if _ID_RE.match(candidato) else None

    segmentos = [s for s in partes.path.split("/") if s]
    if len(segmentos) == 2 and segmentos[0] in ("embed", "shorts"):
        return segmentos[1] if _ID_RE.match(segmentos[1]) else None

    return None


def normalizar(url: str | None) -> str | None:
    """URL de YouTube → forma canónica, o ``None`` si venía vacía.

    Lanza :class:`VideoUrlError` si hay algo que no es un video de YouTube.
    Un valor vacío o solo espacios se trata como «sin video», no como error:
    es lo que envía un formulario cuyo campo se dejó en blanco.
    """
    if url is None:
        return None
    limpio = url.strip()
    if not limpio:
        return None

    video_id = _extraer_id(limpio)
    if video_id is None:
        raise VideoUrlError(
            "Debe ser una URL https de YouTube "
            "(youtube.com/watch?v=…, youtu.be/…, /embed/… o /shorts/…)."
        )
    return _CANONICA.format(id=video_id)


def issues(url: str | None, *, field: str = "video_url") -> list[dict]:
    """Variante para el acumulador de ``details`` del writer (vacía ⇒ OK)."""
    try:
        normalizar(url)
    except VideoUrlError as exc:
        return [{"field": field, "reason": str(exc)}]
    return []
