"""Regresiones de la auditoría de seguridad del catálogo remoto.

Los cuatro de aquí los encontró una verificación adversarial atacando la
frontera con contenido no confiable, no leyéndola. Ninguno lo cubría la suite
original, y los cuatro estaban en verde.

La promesa que defienden: **un bundle hostil no puede hacer nada peor que un
422/413 limpio**. Ni un 500, ni una escritura, ni —esto es lo que casi se
escapa— dejar sin servicio a los demás estudiantes.
"""

from __future__ import annotations

import json
import time

import pytest
from pydantic import ValidationError

from app.errors import ApiException
from app.schemas.catalog import CatalogIndexEntry, ModuleBundle
from app.services.markdown_validator import validate as validar_markdown
from app.services.module_installer import parse_index

FECHA = "2026-08-30T12:00:00.000Z"


# ────────────────── 1 · enteros sin techo: el 500 escondido ──────────────────


def _entrada_de_indice(**cambios) -> dict:
    base = {
        "id": "mX", "title": "Módulo", "description": "d", "level": "Básico",
        "order_hint": 1, "version": 1, "checksum": "a" * 64,
        "object_path": "modulos/mX/v1.json", "size_bytes": 10,
        "published_at": FECHA, "author_label": "Telar",
        "lessons_count": 1, "questions_count": 0,
        "estimated_minutes_total": 5, "requires_gpu": False,
    }
    base.update(cambios)
    return base


@pytest.mark.parametrize(
    "campo", ["order_hint", "version", "size_bytes", "lessons_count",
              "questions_count", "estimated_minutes_total"]
)
def test_un_entero_desmedido_en_el_indice_se_rechaza_en_el_esquema(campo):
    """`ge=` sin `le=` no era media validación: era un 500.

    SQLite guarda enteros de 64 bits. Un `version: 2**63` llegaba al INSERT, el
    driver lanzaba OverflowError, `_persist` lo convertía en INTERNAL_ERROR y el
    estudiante veía un 500 con un bundle por lo demás impecable. Peor: bastaba
    con que el bucket reescribiera el ÍNDICE para que `/catalog/refresh` lo
    escribiera en `installed_modules`, o sea que el 500 lo disparaba la pantalla
    del catálogo sin que nadie pidiera nada.
    """
    with pytest.raises(ValidationError):
        CatalogIndexEntry.model_validate(_entrada_de_indice(**{campo: 2**63}))


def test_los_topes_dejan_pasar_los_valores_legitimos():
    """Los topes acotan lo absurdo, no lo legítimo."""
    assert CatalogIndexEntry.model_validate(
        _entrada_de_indice(version=999_999, order_hint=9_999)
    ).version == 999_999


# ─────────── 2 · el bundle que congelaba el backend para todos ───────────────


def test_el_validador_de_markdown_no_es_cuadratico():
    """Una línea larguísima costaba SEGUNDOS, con el event loop parado.

    `_HTML_TAG_RE` y `_LINK_RE` hacen backtracking cuadrático, y
    `content_markdown` admite 64 KiB en UNA línea: 14,4 s de CPU por lección, y
    como el parseo era síncrono, durante esos segundos no se atendía a NADIE —ni
    WebSocket, ni /health, ni los jobs de los demás—. Con 63 lecciones así en un
    bundle de 4 MiB eran ~15 minutos por petición, con un bundle *válido* que se
    podía repetir.

    El arreglo tiene dos mitades: el tope de línea (esto) y sacar el parseo del
    hilo del event loop (`asyncio.to_thread`, en installer/updater/router).
    """
    inicio = time.perf_counter()
    problemas = validar_markdown("[" * 65_536)
    transcurrido = time.perf_counter() - inicio

    assert problemas, "una línea de 64 KiB no es contenido legítimo: se rechaza"
    assert transcurrido < 0.5, f"tardó {transcurrido:.2f} s: el coste volvió a dispararse"


def test_el_coste_no_crece_al_cuadrado_con_el_largo():
    """Cuadruplicar la entrada multiplicaba el tiempo por dieciséis."""
    def coste(n: int) -> float:
        inicio = time.perf_counter()
        validar_markdown("[" * n)
        return time.perf_counter() - inicio

    assert coste(65_536) < max(coste(4_000), 0.01) * 8


# ───────────── 3 · el índice no recibía el barrido que prometía ──────────────


def test_el_indice_rechaza_marcas_bidi_y_secuencias_de_control():
    """`parse_index` afirmaba en su docstring que daba «el mismo trato» que a un
    bundle, y no era cierto: se saltaba el barrido de texto.

    Consecuencia: una marca RLO (Trojan Source) o una secuencia ANSI llegaban
    verbatim a la pantalla «Explorar» —lo que el estudiante ve ANTES de instalar
    nada— y se persistían en la caché del índice. El mismo texto dentro de un
    bundle daba 422.
    """
    hostil = {
        "index_format": 1, "generated_at": FECHA,
        "modules": [_entrada_de_indice(title="Curso ‮PMnepO‬ \x1b[31m")],
    }
    with pytest.raises(ApiException) as excinfo:
        parse_index(json.dumps(hostil, ensure_ascii=False).encode(), max_bytes=100_000)
    assert excinfo.value.code == "CONTENT_VALIDATION_ERROR"


def test_un_indice_limpio_sigue_pasando():
    limpio = {"index_format": 1, "generated_at": FECHA, "modules": [_entrada_de_indice()]}
    indice = parse_index(json.dumps(limpio).encode(), max_bytes=100_000)
    assert [m.id for m in indice.modules] == ["mX"]


# ──────────── 4 · la frontera no confiable, más laxa que la de confianza ─────


def test_una_leccion_no_puede_recomendarse_a_si_misma():
    """La vía admin ya lo prohibía; la del bundle no lo miraba.

    Impacto cosmético —una tarjeta «sigue con…» que apunta a donde ya estás—,
    pero el principio importa: la frontera con lo NO confiable no puede aplicar
    una regla con menos rigor que la de confianza.
    """
    from app.services.bundle_guard import BundleContentInvalid, parse_bundle

    bundle = {
        "bundle_format": 1, "checksum": "a" * 64,
        "module": {"id": "mX", "order_hint": 1, "title": "M", "description": "d",
                   "level": "Básico", "version": 1, "published_at": FECHA,
                   "author_label": "Telar", "notes": ""},
        "lessons": [{
            "id": "solo", "order": 1, "title": "Sola", "estimated_minutes": 5,
            "content_markdown": "# Sola\n\nTexto.", "video_url": None,
            "enabled": True, "completion_rule": "viewed", "pass_threshold": 0.6,
            "recommended": [{"lesson_id": "solo", "label": "Yo misma", "tag": "Raro"}],
            "example": None, "quiz": None,
        }],
    }
    with pytest.raises(BundleContentInvalid) as excinfo:
        parse_bundle(json.dumps(bundle, ensure_ascii=False).encode(), max_bytes=100_000)
    assert any(
        "recomendarse a sí misma" in d["reason"] for d in (excinfo.value.details or [])
    )
