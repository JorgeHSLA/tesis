"""``services/bundle_guard`` — la frontera con el contenido del bucket.

Un bundle es entrada NO CONFIABLE: lo publica alguien que no somos nosotros, se
descarga sin que medie una persona y acaba **persistido** y mostrado a todos los
estudiantes del equipo. Estos tests son, uno por uno, un ataque concreto y la
regla que lo para. Están escritos en negativo a propósito: el caso feliz se
prueba en un solo test, y el resto del archivo es lo que NO debe entrar.

Dos invariantes atraviesan todo el archivo:

* **Ningún rechazo puede ser un 500.** Cada fallo sale como
  ``BundleGuardError`` con ``status_code`` 413 o 422 (§11.3). Lo fija
  ``test_ningun_rechazo_hostil_se_convierte_en_500``.
* **Los ``details`` nunca hacen eco del valor rechazado** (BL-22): dicen dónde
  está el problema, no qué decía el contenido hostil.

Cero red, cero DB, cero FastAPI: ``parse_bundle`` es una función pura.
"""

from __future__ import annotations

import copy
import json

import pytest

from app.services.bundle_guard import (
    BundleContentInvalid,
    BundleGuardError,
    BundleInvalid,
    BundleTooLarge,
    parse_bundle,
)

#: Default de ``TELAR_CATALOG_MAX_BUNDLE_BYTES`` (§11.1).
MAX_BYTES = 4 * 1024 * 1024
#: El guard NO verifica el checksum (eso es ``catalog_hash``, §11.8.2): aquí
#: solo tiene que cumplir el patrón de 64 hex.
CHECKSUM = "0" * 64
VIDEO = "https://youtu.be/dQw4w9WgXcQ"


# ─────────────────────────────── fixtures ───────────────────────────────────


def _ejemplo() -> dict:
    return {
        "id": "taskloopDemo",
        "title": "taskloop sobre un for",
        "filename": "taskloop.py",
        "difficulty": 3,
        "teaches": "Reparto de iteraciones con taskloop.",
        "directives": ["taskloop"],
        "threads_configurable": True,
        "fixed_threads": None,
        "fixed_threads_note": None,
        "sweeps_threads": False,
        "self_measures": False,
        "parser_id": "none",
        "default_timeout_s": 30,
        "est_run_seconds": 8,
        "enabled": True,
        "requires_gpu": False,
        "expected_output_note": "Imprime la suma.",
        "takeaways": ["taskloop reparte el bucle en tareas"],
        "source_code": "from numba import njit\n\n\ndef main():\n\tpass\n",
    }


def _quiz() -> dict:
    return {
        "pass_threshold": 0.6,
        "questions": [
            {
                "id": "taskloop-q1",
                "order": 1,
                "text": "¿Qué reparte taskloop?",
                "options": [
                    {"key": "a", "text": "Las iteraciones del bucle"},
                    {"key": "b", "text": "Los hilos del equipo"},
                ],
                "correct_key": "a",
                "explanation": "Reparte las iteraciones en tareas.",
            }
        ],
    }


def _leccion_practica() -> dict:
    return {
        "id": "taskloop",
        "order": 1,
        "title": "taskloop",
        "estimated_minutes": 25,
        "content_markdown": "# taskloop\n\nReparte el bucle en tareas.\n",
        "video_url": VIDEO,
        "enabled": True,
        "completion_rule": "quiz",
        "pass_threshold": 0.6,
        "recommended": [],
        "example": _ejemplo(),
        "quiz": _quiz(),
    }


def _leccion_teorica() -> dict:
    """E1/E4: una lección conceptual no tiene ni código ni quiz."""
    return {
        "id": "taskDeps",
        "order": 2,
        "title": "Dependencias entre tareas",
        "estimated_minutes": 10,
        "content_markdown": "# Dependencias\n\nTeoria.\n",
        "video_url": None,
        "enabled": True,
        "completion_rule": "viewed",
        "pass_threshold": 0.6,
        "recommended": [
            {"lesson_id": "taskloop", "label": "taskloop", "tag": "Práctica"}
        ],
        "example": None,
        "quiz": None,
    }


@pytest.fixture
def bundle() -> dict:
    """Bundle válido y mínimo, copiado en cada test para poder envenenarlo."""
    return copy.deepcopy(
        {
            "bundle_format": 1,
            "checksum": CHECKSUM,
            "module": {
                "id": "m9",
                "order_hint": 9,
                "title": "Tasks y dependencias",
                "description": "Tareas de OpenMP.",
                "level": "Avanzado",
                "version": 3,
                "published_at": "2026-08-29T12:00:00.000Z",
                "author_label": "Curso Telar — UN",
                "notes": "",
            },
            "lessons": [_leccion_practica(), _leccion_teorica()],
        }
    )


def a_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def parse(payload, *, max_bytes: int = MAX_BYTES):
    return parse_bundle(a_bytes(payload), max_bytes=max_bytes)


def campos(exc: BundleGuardError) -> list[str]:
    return [d["field"] for d in exc.details]


# ─────────────────────────── el caso feliz, una vez ─────────────────────────


def test_un_bundle_bien_formado_se_parsea_entero(bundle):
    resultado = parse(bundle)
    assert resultado.bundle_format == 1
    assert resultado.module.id == "m9"
    assert [lec.id for lec in resultado.lessons] == ["taskloop", "taskDeps"]
    assert resultado.lessons[0].example is not None
    assert resultado.lessons[1].example is None  # E1: lección conceptual
    assert resultado.lessons[1].quiz is None


def test_valida_el_video_pero_no_lo_normaliza(bundle):
    """El guard decide si PASA, no cómo se guarda.

    Normalizar cambiaría el modelo respecto de los bytes descargados, y el
    checksum de §11.8.2 se calcula sobre los originales. La normalización de
    ``services/youtube`` la aplica el instalador, después de verificarlo.
    """
    assert parse(bundle).lessons[0].video_url == VIDEO


# ──────────────────────────── 1. bytes recibidos ────────────────────────────


def test_rechaza_el_bundle_que_supera_el_tope(bundle):
    crudo = a_bytes(bundle)
    with pytest.raises(BundleTooLarge) as exc:
        parse_bundle(crudo, max_bytes=len(crudo) - 1)
    assert exc.value.status_code == 413
    assert exc.value.code == "BUNDLE_TOO_LARGE"


def test_el_tope_se_mide_en_bytes_no_en_caracteres(bundle):
    """Un bundle lleno de acentos ocupa más bytes que caracteres.

    Medir ``len(texto)`` dejaría pasar hasta el doble del tope con solo escribir
    en un idioma no ASCII.
    """
    bundle["module"]["description"] = "á" * 1000
    crudo = a_bytes(bundle)
    texto = crudo.decode("utf-8")
    assert len(crudo) > len(texto)
    with pytest.raises(BundleTooLarge):
        parse_bundle(crudo, max_bytes=len(texto))


def test_un_tope_no_positivo_es_error_de_programacion_no_de_entrada(bundle):
    """``max_bytes`` viene de la config, no del atacante: aquí sí es un bug."""
    with pytest.raises(ValueError):
        parse(bundle, max_bytes=0)


# ─────────────────────────── 2. decodificación ──────────────────────────────


def test_rechaza_utf8_invalido():
    with pytest.raises(BundleInvalid):
        parse_bundle(b'{"bundle_format": "\xff\xfe"}', max_bytes=MAX_BYTES)


def test_rechaza_bom_utf8(bundle):
    """El BOM cambia los bytes sin cambiar el texto: dos checksums para lo mismo."""
    with pytest.raises(BundleInvalid) as exc:
        parse_bundle(b"\xef\xbb\xbf" + a_bytes(bundle), max_bytes=MAX_BYTES)
    assert "BOM" in exc.value.details[0]["reason"]


@pytest.mark.parametrize("bom", [b"\xff\xfe", b"\xfe\xff"])
def test_rechaza_bom_de_utf16(bom, bundle):
    """UTF-16 decodificaría como UTF-8 «válido» a base de basura, sin fallar."""
    with pytest.raises(BundleInvalid):
        parse_bundle(bom + a_bytes(bundle), max_bytes=MAX_BYTES)


# ───────────────────────────── 3. parseo JSON ───────────────────────────────


def test_rechaza_claves_json_duplicadas_en_la_raiz(bundle):
    crudo = json.dumps(bundle).replace(
        '"bundle_format": 1', '"bundle_format": 1, "bundle_format": 9', 1
    )
    with pytest.raises(BundleInvalid) as exc:
        parse_bundle(crudo.encode("utf-8"), max_bytes=MAX_BYTES)
    assert "duplicada" in exc.value.message


def test_rechaza_correct_key_declarada_dos_veces(bundle):
    """El agujero clásico: Python se queda con la última en SILENCIO.

    Con ``{"correct_key": "a", "correct_key": "b"}`` un revisor humano lee «a» y
    el escritor guarda «b». No hay saneo posible: se rechaza el documento.
    """
    crudo = json.dumps(bundle)
    envenenado = crudo.replace(
        '"correct_key": "a"', '"correct_key": "a", "correct_key": "b"', 1
    )
    assert envenenado != crudo
    with pytest.raises(BundleInvalid):
        parse_bundle(envenenado.encode("utf-8"), max_bytes=MAX_BYTES)


def test_el_anidamiento_que_agota_el_parser_es_422_no_500():
    crudo = ("[" * 100000 + "]" * 100000).encode("utf-8")
    with pytest.raises(BundleInvalid) as exc:
        parse_bundle(crudo, max_bytes=MAX_BYTES)
    assert exc.value.status_code == 422


def test_el_anidamiento_que_agota_el_recorrido_tambien_es_422_no_500():
    """El parser aguanta profundidades que el recorrido en Python no.

    Es el hueco fino: el JSON parsea, y el ``RecursionError`` aparece DESPUÉS,
    en el barrido de texto o en pydantic. También se captura.
    """
    hondo = "[" * 5000 + "]" * 5000
    crudo = ('{"lessons": ' + hondo + "}").encode("utf-8")
    with pytest.raises(BundleInvalid) as exc:
        parse_bundle(crudo, max_bytes=MAX_BYTES)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("crudo", [b"[]", b"42", b'"hola"', b"null", b""])
def test_rechaza_una_raiz_que_no_es_un_objeto(crudo):
    with pytest.raises(BundleInvalid):
        parse_bundle(crudo, max_bytes=MAX_BYTES)


def test_rechaza_json_truncado(bundle):
    crudo = a_bytes(bundle)[: len(a_bytes(bundle)) // 2]
    with pytest.raises(BundleInvalid):
        parse_bundle(crudo, max_bytes=MAX_BYTES)


# ─────────────────── 4. caracteres prohibidos en el texto ───────────────────


@pytest.mark.parametrize("control", ["\x00", "\x1b", "\x07", "\x7f"])
def test_rechaza_caracteres_de_control_en_cualquier_texto(bundle, control):
    """Un NUL corta strings en C y ensucia SQLite; un ESC pinta ANSI en consola."""
    bundle["module"]["title"] = f"Tas{control}ks"
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["module.title"]


def test_rechaza_retorno_de_carro(bundle):
    """CR fuera: §11.8.2 serializa con LF, así que un CR delata bytes retocados."""
    bundle["lessons"][0]["content_markdown"] = "# t\r\n\r\nTexto.\r\n"
    with pytest.raises(BundleInvalid):
        parse(bundle)


def test_permite_salto_de_linea_y_tabulador(bundle):
    """Los dos controles que el contenido necesita de verdad: markdown y código."""
    bundle["lessons"][0]["content_markdown"] = "# t\n\n- uno\n- dos\n"
    bundle["lessons"][0]["example"]["source_code"] = "def f():\n\treturn 1\n"
    assert parse(bundle).lessons[0].example.source_code.endswith("return 1\n")


# RLO, LRE, LRI, PDI: override, embedding e isolates de Trojan Source.
@pytest.mark.parametrize("marca", ["\u202e", "\u202a", "\u2066", "\u2069"])
def test_rechaza_marcas_bidi_en_el_codigo_fuente(bundle, marca):
    """Trojan Source: lo que el estudiante LEE deja de ser lo que se EJECUTA.

    En Telar el ciclo es literalmente «lee este código y ahora córrelo en el
    contenedor». Un override bidireccional reordena la presentación sin tocar
    los bytes, así que el ejemplo puede enseñar una cosa y ejecutar otra. No hay
    uso legítimo de estos caracteres en el contenido: el texto RTL de verdad se
    escribe con sus letras, no con overrides.
    """
    bundle["lessons"][0]["example"]["source_code"] = f"x = 1  # {marca}malicia\n"
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[0].example.source_code"]
    assert "bidireccional" in exc.value.details[0]["reason"]


def test_las_marcas_bidi_tambien_se_rechazan_fuera_del_codigo(bundle):
    bundle["lessons"][0]["title"] = "taskloop\u202e"
    with pytest.raises(BundleInvalid):
        parse(bundle)


def test_el_detalle_no_ecoa_el_contenido_rechazado(bundle):
    """BL-22: los ``details`` dicen DÓNDE, nunca QUÉ decía."""
    bundle["lessons"][0]["example"]["source_code"] = "SECRETO_DEL_ATACANTE\u202e\n"
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert "SECRETO_DEL_ATACANTE" not in json.dumps(exc.value.details)


# ──────────────────────────── 5. ids peligrosos ─────────────────────────────


@pytest.mark.parametrize(
    "id_hostil",
    [
        "../otroModulo",
        "a/../b",
        "m9/v1",
        "m9\\v1",
        "%2e%2e",
        "m9\x00",
        "C:m9",
    ],
)
def test_rechaza_ids_que_intentan_salirse_de_su_ruta(bundle, id_hostil):
    """La ruta del objeto se DERIVA del id (``modulos/<id>/v<n>.json``).

    Un id con ``..`` o ``/`` es un intento de leer o escribir otro objeto.
    """
    bundle["module"]["id"] = id_hostil
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    # Un id puede romper varias reglas a la vez ('..' y '/'); todas apuntan al
    # mismo campo, que es lo que el autor necesita para localizarlo.
    assert set(campos(exc.value)) == {"module.id"}


@pytest.mark.parametrize("reservado", ["con", "PRN", "aux", "Nul", "com1", "lpt9"])
def test_rechaza_ids_reservados_de_windows(bundle, reservado):
    """Telar se distribuye como app Electron y cada id acaba siendo una carpeta."""
    bundle["module"]["id"] = reservado
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert "reservado" in exc.value.details[0]["reason"]


@pytest.mark.parametrize("reservado", ["catalog", "index", "modulos"])
def test_rechaza_ids_que_colisionan_con_el_layout_del_bucket(bundle, reservado):
    bundle["lessons"][0]["id"] = reservado
    bundle["lessons"][1]["recommended"][0]["lesson_id"] = reservado
    with pytest.raises(BundleInvalid):
        parse(bundle)


# ZWSP, ZWJ y BOM: invisibles que crean ids distintos e indistinguibles.
@pytest.mark.parametrize("invisible", ["\u200b", "\u200d", "\ufeff"])
def test_rechaza_caracteres_de_ancho_cero_en_los_ids(bundle, invisible):
    """Dos ids visualmente idénticos con claves primarias distintas."""
    bundle["lessons"][0]["id"] = f"task{invisible}loop"
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[0].id"]


def test_rechaza_dos_lecciones_con_el_mismo_id(bundle):
    bundle["lessons"][1]["id"] = "taskloop"
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert "duplicado" in exc.value.details[0]["reason"]


def test_rechaza_ids_que_solo_se_diferencian_por_mayusculas(bundle):
    """SQLite los ve distintos (colación BINARY); un sistema de archivos no.

    Y lecciones y ejemplos comparten espacio de nombres (§10.6), así que la
    colisión cruzada cuenta.
    """
    bundle["lessons"][0]["example"]["id"] = "TaskLoop"  # vs lección 'taskloop'
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert "mayúsculas" in exc.value.details[0]["reason"]


def test_una_pregunta_sin_id_es_valida_y_no_colisiona(bundle):
    """BL-18: el ``id`` de pregunta es opcional; lo autogenera el escritor.

    Dos preguntas sin id no son «dos ids duplicados»: todavía no tienen ninguno.
    """
    for pregunta in bundle["lessons"][0]["quiz"]["questions"]:
        pregunta.pop("id")
    bundle["lessons"][0]["quiz"]["questions"].append(
        {
            "order": 2,
            "text": "¿Y esta?",
            "options": [{"key": "a", "text": "sí"}, {"key": "b", "text": "no"}],
            "correct_key": "b",
            "explanation": "Porque no.",
        }
    )
    resultado = parse(bundle)
    assert [q.id for q in resultado.lessons[0].quiz.questions] == [None, None]


def test_rechaza_ids_de_pregunta_repetidos(bundle):
    bundle["lessons"][0]["quiz"]["questions"].append(
        {
            "id": "taskloop-q1",
            "order": 2,
            "text": "¿Otra?",
            "options": [{"key": "a", "text": "sí"}, {"key": "b", "text": "no"}],
            "correct_key": "a",
            "explanation": "Porque sí.",
        }
    )
    with pytest.raises(BundleInvalid):
        parse(bundle)


# ─────────────────────────── 6. esquema §11.10 ──────────────────────────────


def test_rechaza_campos_extra(bundle):
    """``extra="forbid"``: un campo inventado es señal de que algo no cuadra."""
    bundle["lessons"][0]["puerta_trasera"] = True
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert exc.value.status_code == 422


def test_el_nombre_de_la_clave_desconocida_se_sanea_antes_de_devolverlo(bundle):
    """El ``loc`` de pydantic arrastra texto del atacante hasta la respuesta."""
    bundle["<script>alert(1)</script>"] = 1
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert "<script>" not in json.dumps(exc.value.details)


def test_rechaza_un_bundle_format_desconocido(bundle):
    bundle["bundle_format"] = 2
    with pytest.raises(BundleInvalid):
        parse(bundle)


def test_rechaza_un_parser_id_que_no_esta_en_el_enum(bundle):
    """§10.6: los ``parser_id`` son los 6 de §3.1 y el DTO es quien los fija."""
    bundle["lessons"][0]["example"]["parser_id"] = "exec_arbitrario"
    with pytest.raises(BundleInvalid):
        parse(bundle)


def test_rechaza_un_checksum_que_no_es_sha256(bundle):
    bundle["checksum"] = "no-es-un-hash"
    with pytest.raises(BundleInvalid):
        parse(bundle)


@pytest.mark.parametrize(
    "filename", ["../evil.py", "evil.py\n", "evil.sh", "x" * 90 + ".py"]
)
def test_rechaza_filenames_fuera_del_patron(bundle, filename):
    bundle["lessons"][0]["example"]["filename"] = filename
    with pytest.raises(BundleInvalid):
        parse(bundle)


@pytest.mark.parametrize("degenerado", ["..py", "----.py", ".-.py"])
def test_rechaza_filenames_degenerados_que_el_patron_congelado_acepta(
    bundle, degenerado
):
    """``FILENAME_PATTERN`` garantiza un nombre *plausible*, no uno *seguro*.

    En el camino admin da igual: lo escribe un humano autenticado. En un bundle
    remoto, no.
    """
    bundle["lessons"][0]["example"]["filename"] = degenerado
    with pytest.raises(BundleInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[0].example.filename"]


# ──────────────────── 7. reglas de negocio de §10.6 ─────────────────────────


def test_rechaza_una_respuesta_correcta_que_no_esta_entre_las_opciones(bundle):
    bundle["lessons"][0]["quiz"]["questions"][0]["correct_key"] = "d"
    with pytest.raises(BundleContentInvalid) as exc:
        parse(bundle)
    assert exc.value.code == "CONTENT_VALIDATION_ERROR"
    assert campos(exc.value) == ["lessons[0].quiz.questions[0].correct_key"]


def test_rechaza_opciones_con_la_misma_key(bundle):
    bundle["lessons"][0]["quiz"]["questions"][0]["options"][1]["key"] = "a"
    with pytest.raises(BundleContentInvalid):
        parse(bundle)


def test_rechaza_markdown_fuera_del_subset(bundle):
    """Se DELEGA en ``markdown_validator``: dos validadores serían dos subsets."""
    bundle["lessons"][0]["content_markdown"] = "# t\n\n<script>alert(1)</script>\n"
    with pytest.raises(BundleContentInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[0].content_markdown"]
    assert exc.value.details[0]["line"] == 3  # el detalle del validador se conserva


def test_rechaza_un_enlace_markdown_con_esquema_peligroso(bundle):
    bundle["lessons"][0]["content_markdown"] = "# t\n\n[click](javascript:alert(1))\n"
    with pytest.raises(BundleContentInvalid):
        parse(bundle)


def test_rechaza_un_video_que_no_es_de_youtube(bundle):
    """Se DELEGA en ``services/youtube``, el mismo módulo que usa el admin."""
    bundle["lessons"][0]["video_url"] = "https://evil.example/payload"
    with pytest.raises(BundleContentInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[0].video_url"]


def test_completion_rule_quiz_exige_quiz(bundle):
    """Sin quiz la lección sería incompletable y bloquearía el módulo entero."""
    bundle["lessons"][0]["quiz"] = None
    with pytest.raises(BundleContentInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[0].completion_rule"]


def test_completion_rule_run_exige_ejemplo(bundle):
    bundle["lessons"][1]["completion_rule"] = "run"
    with pytest.raises(BundleContentInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[1].completion_rule"]


def test_completion_rule_viewed_no_exige_nada(bundle):
    """E1/E4: la lección conceptual es legítima, no un bundle a medias."""
    assert parse(bundle).lessons[1].completion_rule == "viewed"


def test_rechaza_un_orden_de_lecciones_con_huecos(bundle):
    """El hueco no rompe el índice único, pero sí la navegación prev/next."""
    bundle["lessons"][1]["order"] = 3
    with pytest.raises(BundleContentInvalid) as exc:
        parse(bundle)
    assert campos(exc.value) == ["lessons[].order"]


def test_rechaza_dos_lecciones_con_el_mismo_order(bundle):
    bundle["lessons"][1]["order"] = 1
    with pytest.raises(BundleContentInvalid):
        parse(bundle)


def test_rechaza_preguntas_con_el_mismo_order(bundle):
    bundle["lessons"][0]["quiz"]["questions"].append(
        {
            "id": "taskloop-q2",
            "order": 1,
            "text": "¿Otra?",
            "options": [{"key": "a", "text": "sí"}, {"key": "b", "text": "no"}],
            "correct_key": "a",
            "explanation": "Porque sí.",
        }
    )
    with pytest.raises(BundleContentInvalid):
        parse(bundle)


# ─────────────────────────── invariantes globales ───────────────────────────


def _catalogo_hostil(base: dict) -> list[bytes]:
    """Una muestra de cada familia de ataque, ya en bytes."""
    con_control = copy.deepcopy(base)
    con_control["module"]["title"] = "a\x00b"
    con_bidi = copy.deepcopy(base)
    con_bidi["lessons"][0]["example"]["source_code"] = "x\u202e\n"
    con_id = copy.deepcopy(base)
    con_id["module"]["id"] = "../fuera"
    reservado = copy.deepcopy(base)
    reservado["module"]["id"] = "nul"
    extra = copy.deepcopy(base)
    extra["sorpresa"] = 1
    sin_quiz = copy.deepcopy(base)
    sin_quiz["lessons"][0]["quiz"] = None
    video = copy.deepcopy(base)
    video["lessons"][0]["video_url"] = "javascript:alert(1)"
    return [
        b"",
        b"[]",
        b"\xff\xfe\x00",
        b"\xef\xbb\xbf{}",
        b"{",
        ("[" * 100000 + "]" * 100000).encode("utf-8"),
        ('{"lessons": ' + "[" * 5000 + "]" * 5000 + "}").encode("utf-8"),
        json.dumps(base)
        .replace('"correct_key": "a"', '"correct_key": "a", "correct_key": "b"')
        .encode("utf-8"),
        *(
            a_bytes(p)
            for p in (con_control, con_bidi, con_id, reservado, extra, sin_quiz, video)
        ),
    ]


def test_ningun_rechazo_hostil_se_convierte_en_500(bundle):
    """La invariante que sostiene el router: 413 o 422, nunca una excepción cruda."""
    for crudo in _catalogo_hostil(bundle):
        with pytest.raises(BundleGuardError) as exc:
            parse_bundle(crudo, max_bytes=MAX_BYTES)
        assert exc.value.status_code in (413, 422), crudo[:40]
        assert exc.value.code in (
            "BUNDLE_TOO_LARGE",
            "BUNDLE_INVALID",
            "CONTENT_VALIDATION_ERROR",
        )


def test_los_details_siempre_traen_field_y_reason(bundle):
    """Shape que el router vuelca en ``error.details`` (§11.3)."""
    for crudo in _catalogo_hostil(bundle):
        with pytest.raises(BundleGuardError) as exc:
            parse_bundle(crudo, max_bytes=MAX_BYTES)
        for detalle in exc.value.details:
            assert {"field", "reason"} <= set(detalle)
            assert isinstance(detalle["field"], str)
            assert isinstance(detalle["reason"], str)


def test_el_numero_de_detalles_esta_acotado(bundle):
    """Un bundle roto en 100 sitios no puede devolver una respuesta enorme."""
    for leccion in bundle["lessons"]:
        leccion["title"] = "a\x00b"
        leccion["content_markdown"] = "a\x00b\n"
    bundle["lessons"] *= 60  # 120 lecciones, todas con control chars
    with pytest.raises(BundleGuardError) as exc:
        parse(bundle)
    assert len(exc.value.details) <= 50
