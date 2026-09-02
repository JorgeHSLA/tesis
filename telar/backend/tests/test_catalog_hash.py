"""``services/catalog_hash`` — la definición ÚNICA del checksum de un bundle.

Estos tests existen por un fallo concreto que no se ve en desarrollo: el
publicador (admin) y el instalador (estudiante) calculan el MISMO checksum en
máquinas distintas y en momentos distintos. Si cada uno serializara por su
cuenta, un ``ensure_ascii`` distinto —o un ``indent``, o un orden de claves—
daría dos digest para el mismo contenido, y el síntoma sería «módulo corrupto»
(``409 CHECKSUM_MISMATCH``) sobre un módulo perfectamente sano.

El ancla es el **golden**: el digest literal de ``fixtures/bundles/m1-v1.json``,
un bundle real del módulo m1 construido desde ``app/content/``. Si alguien
cambia la serialización canónica de §11.8.2, este archivo se pone rojo aquí y
no en la máquina de un estudiante.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.schemas.catalog import ModuleBundle
from app.services.catalog_hash import (
    BundleHashError,
    bundle_checksum,
    canonical_bundle_bytes,
)

FIXTURE = Path(__file__).parent / "fixtures" / "bundles" / "m1-v1.json"

#: GOLDEN — digest literal de m1-v1.json (§11.8.2). NO se recalcula desde el
#: código: si cambia, es porque cambió el contenido del fixture o el algoritmo,
#: y ambas cosas son decisiones conscientes, no efectos colaterales.
GOLDEN = "c29f59c3d6a4e3955609491b8ee39ca55f1a4a195149a8c7cfc57eaa3c5f595a"


@pytest.fixture
def bundle_crudo() -> dict:
    """El fixture tal cual sale de ``json.loads`` — el camino del verificador."""
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def bundle_modelo(bundle_crudo: dict) -> ModuleBundle:
    """El mismo bundle ya validado — el camino del publicador."""
    return ModuleBundle.model_validate(bundle_crudo)


# ────────────────────────────── Golden ───────────────────────────────────────


def test_golden_el_digest_literal_de_m1_v1(bundle_crudo):
    assert bundle_checksum(bundle_crudo) == GOLDEN


def test_el_checksum_que_lleva_dentro_el_fixture_es_el_suyo(bundle_crudo):
    """El bundle publicado se autodescribe: su campo coincide con su digest."""
    assert bundle_crudo["checksum"] == GOLDEN


def test_publicador_e_instalador_obtienen_el_mismo_digest(bundle_crudo, bundle_modelo):
    """Modelo validado y dict crudo son la misma entrada para el hash.

    Es LA propiedad del módulo: el admin hashea el ``ModuleBundle`` que acaba de
    construir y el estudiante hashea el ``dict`` que acaba de descargar.
    """
    assert bundle_checksum(bundle_modelo) == GOLDEN
    assert bundle_checksum(bundle_modelo.model_dump(mode="json")) == GOLDEN
    assert bundle_checksum(bundle_crudo) == bundle_checksum(bundle_modelo)


def test_el_fixture_es_un_bundle_valido_del_modulo_m1(bundle_modelo):
    """Si el fixture dejara de cumplir §11.10, el golden mediría otra cosa."""
    assert bundle_modelo.bundle_format == 1
    assert bundle_modelo.module.id == "m1"
    assert bundle_modelo.module.version == 1
    # E2: order local al módulo, contiguo 1..n.
    assert [lec.order for lec in bundle_modelo.lessons] == [1, 2]
    assert [lec.id for lec in bundle_modelo.lessons] == ["primerEjemplo", "for"]
    # Contenido real, no un esqueleto: markdown, código y quiz de verdad.
    for leccion in bundle_modelo.lessons:
        assert leccion.content_markdown.startswith("#")
        assert leccion.example is not None
        assert "openmp" in leccion.example.source_code
        assert leccion.quiz is not None
        assert len(leccion.quiz.questions) == 4


# ───────────────── El campo checksum no entra en su propio cálculo ───────────


def test_el_checksum_no_influye_en_su_propio_calculo(bundle_crudo):
    """Sin él, con el suyo o con uno falso: los mismos bytes canónicos.

    Es lo que hace posible escribirlo DENTRO del bundle sin circularidad.
    """
    sin_campo = {k: v for k, v in bundle_crudo.items() if k != "checksum"}
    falseado = {**bundle_crudo, "checksum": "f" * 64}

    esperado = canonical_bundle_bytes(bundle_crudo)
    assert canonical_bundle_bytes(sin_campo) == esperado
    assert canonical_bundle_bytes(falseado) == esperado
    assert b'"checksum"' not in esperado
    assert bundle_checksum(sin_campo) == bundle_checksum(falseado) == GOLDEN


def test_solo_se_excluye_el_checksum_de_la_raiz():
    """La exclusión es de la clave RAÍZ, no un barrido en profundidad.

    Importa para el instalador: un ``checksum`` anidado —que §11.10 hoy no
    permite— entraría en el digest como cualquier otro dato, no se borraría en
    silencio.
    """
    assert canonical_bundle_bytes({"a": {"checksum": "x"}, "checksum": "0" * 64}) == (
        b'{"a":{"checksum":"x"}}'
    )


def test_no_muta_el_bundle_que_recibe(bundle_crudo):
    """Borrar el ``checksum`` in-place rompería al llamador que luego lo persiste."""
    copia = deepcopy(bundle_crudo)
    bundle_checksum(bundle_crudo)
    assert bundle_crudo == copia
    assert bundle_crudo["checksum"] == GOLDEN


# ─────────────── Lo que NO puede cambiar el digest (round-trip) ──────────────


def test_el_orden_de_las_claves_es_irrelevante(bundle_crudo):
    """``sort_keys=True``: dos publicadores que emitan las claves al revés coinciden."""
    del_reves = {k: bundle_crudo[k] for k in reversed(list(bundle_crudo))}
    del_reves["module"] = {
        k: bundle_crudo["module"][k] for k in reversed(list(bundle_crudo["module"]))
    }
    assert list(del_reves) != list(bundle_crudo)
    assert bundle_checksum(del_reves) == GOLDEN


def test_el_formato_del_archivo_es_irrelevante(bundle_crudo):
    """Indentado, compacto o con las claves barajadas: el mismo digest.

    Corolario deliberado: hashear los BYTES del archivo NO es el algoritmo
    (§11.8.2 hashea el payload sin ``checksum``, que es lo único no circular).
    """
    for texto in (
        json.dumps(bundle_crudo, ensure_ascii=False, indent=4),
        json.dumps(bundle_crudo, ensure_ascii=True, separators=(",", ":")),
        json.dumps(bundle_crudo, ensure_ascii=False, sort_keys=True) + "\n",
    ):
        assert bundle_checksum(json.loads(texto)) == GOLDEN

    sha_del_archivo = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
    assert sha_del_archivo != GOLDEN


def test_validar_antes_de_hashear_normaliza_los_opcionales_ausentes(bundle_crudo):
    """Un bundle escrito a mano sin ``video_url`` solo cuadra si se valida primero.

    Fija el orden correcto en el instalador —validar y DESPUÉS hashear—: el
    modelo repone el default (``video_url = null``) y recupera el digest del
    publicador; el dict crudo, al que le falta la clave, da otro.
    """
    recortado = deepcopy(bundle_crudo)
    del recortado["lessons"][0]["video_url"]

    assert bundle_checksum(recortado) != GOLDEN
    assert bundle_checksum(ModuleBundle.model_validate(recortado)) == GOLDEN


# ───────────────────────── Unicode y acentos ─────────────────────────────────


def test_los_acentos_viajan_en_utf8_sin_escapar(bundle_crudo):
    """``ensure_ascii=False``: el contenido en español no se convierte en ``\\uXXXX``."""
    crudos = canonical_bundle_bytes(bundle_crudo)
    assert "Región".encode("utf-8") in crudos
    assert "Básico".encode("utf-8") in crudos
    assert "Curso Telar — UN".encode("utf-8") in crudos  # em dash, fuera de latin-1
    assert rb"\u" not in crudos
    assert crudos.decode("utf-8")  # UTF-8 válido de punta a punta


def test_da_igual_como_venga_escrito_el_unicode_en_el_json(bundle_crudo):
    """``\\u00f1`` y ``ñ`` son el mismo texto tras parsear: mismo digest."""
    escapado = json.loads(json.dumps(bundle_crudo, ensure_ascii=True))
    assert bundle_checksum(escapado) == GOLDEN

    assert canonical_bundle_bytes(json.loads(r'{"t":"año"}')) == (
        canonical_bundle_bytes({"t": "año"})
    )


def test_un_cambio_minimo_en_el_contenido_cambia_el_digest(bundle_crudo):
    """El checksum sirve para detectar manipulación: un acento de más se ve."""
    manipulado = deepcopy(bundle_crudo)
    manipulado["module"]["title"] = "Fundamentós"
    assert bundle_checksum(manipulado) != GOLDEN

    otro = deepcopy(bundle_crudo)
    otro["lessons"][1]["example"]["source_code"] += " "
    assert bundle_checksum(otro) != GOLDEN


# ──────────────────── La serialización canónica, en literal ─────────────────


def test_los_bytes_canonicos_son_los_del_contrato():
    """Un payload mínimo con su forma exacta: separadores, orden y unicode.

    El golden protege el algoritmo completo; este test dice EN QUÉ consiste, y
    falla con un diff legible si alguien toca ``separators`` o ``sort_keys``.
    """
    payload = {"b": 1, "a": "ñ", "checksum": "0" * 64, "c": [1, {"z": True, "y": None}]}
    assert canonical_bundle_bytes(payload) == (
        '{"a":"ñ","b":1,"c":[1,{"y":null,"z":true}]}'.encode("utf-8")
    )


def test_el_digest_es_sha256_en_hex_minusculas(bundle_crudo):
    digest = bundle_checksum(bundle_crudo)
    assert digest == hashlib.sha256(canonical_bundle_bytes(bundle_crudo)).hexdigest()
    assert len(digest) == 64
    assert digest == digest.lower()


# ─────────────────────────── Entradas imposibles ─────────────────────────────


@pytest.mark.parametrize(
    "entrada",
    [None, "no soy un bundle", [1, 2, 3], 42],
    ids=["none", "texto", "lista", "entero"],
)
def test_lo_que_no_es_un_objeto_json_se_rechaza(entrada):
    with pytest.raises(BundleHashError):
        canonical_bundle_bytes(entrada)


@pytest.mark.parametrize(
    "payload",
    [
        {"x": float("nan")},  # NaN no es JSON: subiría un objeto irreparable
        {"x": float("inf")},
        {"x": {1, 2}},  # set: json no sabe escribirlo
        {"x": object()},
        {1: "uno", "b": 2},  # sort_keys no puede ordenar claves mixtas
    ],
    ids=["nan", "inf", "set", "objeto", "clave-no-textual"],
)
def test_lo_que_json_no_sabe_escribir_se_rechaza(payload):
    with pytest.raises(BundleHashError):
        canonical_bundle_bytes(payload)
