"""``services/youtube`` — la URL de video es entrada no confiable.

Esa URL llega hoy del admin y, desde Fase 5, dentro de un bundle descargado del
bucket. El módulo no valida-y-deja-pasar: extrae el id, lo comprueba y
RECONSTRUYE la URL. Estos tests fijan justo eso — que nada de la URL original
sobrevive salvo el id— porque es lo que impide que una URL hostil llegue entera
hasta el ``<iframe>`` del estudiante.

Espejo de ``frontend/tests/features/learn/LessonMedia.test.tsx``, que prueba la
misma tabla de casos sobre ``resolveYouTubeEmbed``.
"""

from __future__ import annotations

import pytest

from app.services.youtube import VideoUrlError, issues, normalizar

ID = "dQw4w9WgXcQ"  # 11 caracteres, formato real
CANONICA = f"https://www.youtube.com/watch?v={ID}"


@pytest.mark.parametrize(
    "entrada",
    [
        f"https://www.youtube.com/watch?v={ID}",
        f"https://youtube.com/watch?v={ID}",
        f"https://m.youtube.com/watch?v={ID}",
        f"https://youtu.be/{ID}",
        f"https://www.youtube.com/embed/{ID}",
        f"https://www.youtube-nocookie.com/embed/{ID}",
        f"https://www.youtube.com/shorts/{ID}",
        f"  https://youtu.be/{ID}  ",
    ],
)
def test_todas_las_formas_de_youtube_colapsan_a_la_canonica(entrada):
    assert normalizar(entrada) == CANONICA


def test_es_idempotente(entrada=CANONICA):
    assert normalizar(normalizar(entrada)) == CANONICA


def test_la_query_extra_de_la_url_original_no_sobrevive():
    """Lo importante: se reconstruye, no se sanea. Nada arrastra parámetros."""
    sucia = f"https://www.youtube.com/watch?v={ID}&list=PLmalvado&si=rastreador"
    assert normalizar(sucia) == CANONICA


def test_vacio_y_none_significan_sin_video_no_error():
    assert normalizar(None) is None
    assert normalizar("") is None
    assert normalizar("   ") is None


@pytest.mark.parametrize(
    "hostil",
    [
        f"http://www.youtube.com/watch?v={ID}",       # sin TLS
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        f"https://evil.example/watch?v={ID}",          # otro host
        f"https://youtube.com.evil.example/watch?v={ID}",  # sufijo engañoso
        f"//www.youtube.com/watch?v={ID}",             # protocol-relative
        "https://www.youtube.com/watch?v=corto",       # id inválido
        "https://www.youtube.com/watch?v=" + "a" * 12,
        "https://www.youtube.com/watch",               # sin v
        "https://www.youtube.com/",                    # sin video
        "no soy una url",
        "media/videos/a.mp4",                          # la forma vieja: .mp4 local
    ],
)
def test_lo_que_no_es_un_video_de_youtube_se_rechaza(hostil):
    with pytest.raises(VideoUrlError):
        normalizar(hostil)


def test_issues_devuelve_el_detalle_por_campo_para_el_422():
    assert issues(CANONICA) == []
    detalles = issues("https://evil.example/x")
    assert len(detalles) == 1
    assert detalles[0]["field"] == "video_url"
    assert "YouTube" in detalles[0]["reason"]
