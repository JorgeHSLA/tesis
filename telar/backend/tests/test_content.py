"""Suite 7 (architecture §11): ContentRepository contra los fixtures REALES
del repo (invariantes data-model §4.4) + fail-fast con fixtures rotos.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from app.repositories.content import (
    EXPECTED_ENABLED_QUESTIONS,
    EXPECTED_LESSON_COUNT,
    ContentError,
    ContentRepository,
)
from app.services.output_parser import PARSER_IDS
from app.tools.validate_content import main as validate_main

from conftest import CONTENT_DIR


# ─────────────────────── invariantes de los fixtures REALES ──────────────────


def test_invariantes_14_14_14(real_content):
    lessons = real_content.lessons()
    examples = real_content.examples()
    assert len(lessons) == EXPECTED_LESSON_COUNT == 14
    assert len(examples) == 14
    assert len(real_content.modules()) == 8
    assert {l.id for l in lessons} == {e.id for e in examples}
    for lesson in lessons:
        assert lesson.example_id == lesson.id  # lesson_id == example_id
        assert lesson.has_quiz is True
        assert real_content.quiz(lesson.id) is not None


def test_60_preguntas_habilitadas(real_content):
    enabled = sum(
        len(real_content.quiz(l.id).questions)
        for l in real_content.lessons()
        if l.enabled
    )
    assert enabled == EXPECTED_ENABLED_QUESTIONS == 60
    total = sum(
        len(real_content.quiz(l.id).questions) for l in real_content.lessons()
    )
    assert total == 65  # 60 habilitadas + 5 de la lección GPU


def test_parser_ids_y_flags_coherentes(real_content):
    for example in real_content.examples():
        assert example.parser_id in PARSER_IDS
        assert example.source_code.strip()
        assert example.filename.endswith(".py")
        # El DTO ya no impone tope (es opcional, TELAR_MAX_TIMEOUT_S); el 120
        # de aquí es el techo que sigue imponiendo el CHECK de schema.sql
        # (content_examples.default_timeout_s BETWEEN 5 AND 120).
        assert 5 <= example.default_timeout_s <= 120
        if example.sweeps_threads:
            assert example.threads_configurable is False
        if example.parser_id != "none":
            assert example.self_measures is True
    sweeps = {e.id for e in real_content.examples() if e.sweeps_threads}
    assert sweeps == {"spmd", "spmdCritical", "transporteParticulas"}
    gpu = real_content.example("sumaVectoresGPU")
    assert gpu.enabled is False and gpu.requires_gpu is True


def test_ruta_lineal_prev_next(real_content):
    ordered = real_content.lessons()
    assert ordered[0].prev_lesson_id is None
    assert ordered[-1].next_lesson_id is None
    for prev_lesson, lesson in zip(ordered, ordered[1:]):
        assert lesson.prev_lesson_id == prev_lesson.id
        assert prev_lesson.next_lesson_id == lesson.id


def test_recommended_apuntan_a_lecciones_existentes(real_content):
    for lesson in real_content.lessons():
        assert len(lesson.recommended) <= 3
        for rec in lesson.recommended:
            assert real_content.exists_lesson(rec.lesson_id)


def test_quiz_correct_keys_dentro_de_opciones(real_content):
    for lesson in real_content.lessons():
        quiz = real_content.quiz(lesson.id)
        assert 0 < quiz.pass_threshold <= 1
        ids = [q.id for q in quiz.questions]
        assert len(ids) == len(set(ids))
        for question in quiz.questions:
            keys = [o.key for o in question.options]
            assert question.correct_key in keys
            assert question.explanation.strip()


def test_interfaz_congelada_lookups(real_content):
    assert real_content.exists_lesson("spmd") is True
    assert real_content.exists_lesson("nope") is False
    assert real_content.exists_example("spmd") is True
    assert real_content.exists_example("nope") is False
    assert real_content.lesson("nope") is None
    assert real_content.example("nope") is None
    assert real_content.quiz("nope") is None


def test_validador_cli_contenido_real(capsys):
    assert validate_main(["--content-dir", str(CONTENT_DIR)]) == 0
    assert "contenido OK" in capsys.readouterr().out


# ───────────────────────── fail-fast con fixtures rotos ──────────────────────


@pytest.fixture(scope="module")
def content_copy_base(tmp_path_factory) -> Path:
    """Copia base (ext4/tmp) del contenido real para corromperla por caso."""
    base = tmp_path_factory.mktemp("content-base") / "content"
    shutil.copytree(CONTENT_DIR, base)
    return base


@pytest.fixture
def broken(content_copy_base: Path, tmp_path: Path) -> Path:
    target = tmp_path / "content"
    shutil.copytree(content_copy_base, target)
    return target


def load_catalog(content_dir: Path) -> dict:
    return json.loads((content_dir / "catalog.json").read_text(encoding="utf-8"))


def dump_catalog(content_dir: Path, catalog: dict) -> None:
    (content_dir / "catalog.json").write_text(
        json.dumps(catalog), encoding="utf-8"
    )


def test_dir_inexistente(tmp_path):
    with pytest.raises(ContentError, match="content_dir no existe"):
        ContentRepository.from_fixtures(tmp_path / "nada")


def test_constructor_posicional_equivale_a_from_fixtures():
    """COMPAT: ``ContentRepository(CONTENT_DIR)`` ≡ ``from_fixtures``."""
    via_ctor = ContentRepository(CONTENT_DIR)
    via_factory = ContentRepository.from_fixtures(CONTENT_DIR)
    assert via_ctor.modules() == via_factory.modules()
    assert via_ctor.lessons() == via_factory.lessons()
    assert via_ctor.examples() == via_factory.examples()
    assert via_ctor.quiz("spmd") == via_factory.quiz("spmd")


def test_constructor_posicional_falla_igual_que_from_fixtures(broken):
    (broken / "catalog.json").write_text("{ roto", encoding="utf-8")
    with pytest.raises(ContentError, match="JSON inválido"):
        ContentRepository(broken)


def test_catalog_json_invalido(broken):
    (broken / "catalog.json").write_text("{ roto", encoding="utf-8")
    with pytest.raises(ContentError, match="JSON inválido"):
        ContentRepository.from_fixtures(broken)


def test_catalog_esquema_invalido(broken):
    catalog = load_catalog(broken)
    del catalog["examples"]["spmd"]["parser_id"]
    dump_catalog(broken, catalog)
    with pytest.raises(ContentError, match="esquema inválido"):
        ContentRepository.from_fixtures(broken)


def test_examples_y_lessons_desalineados(broken):
    catalog = load_catalog(broken)
    del catalog["examples"]["spmd"]
    dump_catalog(broken, catalog)
    with pytest.raises(ContentError, match="mismos ids"):
        ContentRepository.from_fixtures(broken)


def test_menos_de_14_lecciones(broken):
    catalog = load_catalog(broken)
    del catalog["examples"]["spmd"]
    del catalog["lessons"]["spmd"]
    catalog["modules"] = [
        {**m, "lessons": [l for l in m["lessons"] if l != "spmd"]}
        for m in catalog["modules"]
    ]
    dump_catalog(broken, catalog)
    with pytest.raises(ContentError, match="14"):
        ContentRepository.from_fixtures(broken)


def test_leccion_sin_modulo(broken):
    catalog = load_catalog(broken)
    catalog["modules"] = [
        {**m, "lessons": [l for l in m["lessons"] if l != "spmd"]}
        for m in catalog["modules"]
    ]
    dump_catalog(broken, catalog)
    with pytest.raises(ContentError, match="sin módulo"):
        ContentRepository.from_fixtures(broken)


def test_modulo_referencia_leccion_inexistente(broken):
    catalog = load_catalog(broken)
    catalog["modules"][0]["lessons"].append("fantasma")
    dump_catalog(broken, catalog)
    with pytest.raises(ContentError, match="inexistente"):
        ContentRepository.from_fixtures(broken)


def test_falta_quiz(broken):
    (broken / "quizzes" / "spmd.json").unlink()
    with pytest.raises(ContentError, match="falta el archivo"):
        ContentRepository.from_fixtures(broken)


def test_quiz_lesson_id_interno_desalineado(broken):
    quiz_path = broken / "quizzes" / "spmd.json"
    quiz = json.loads(quiz_path.read_text(encoding="utf-8"))
    quiz["lesson_id"] = "otro"
    quiz_path.write_text(json.dumps(quiz), encoding="utf-8")
    with pytest.raises(ContentError, match="lesson_id interno"):
        ContentRepository.from_fixtures(broken)


def test_quiz_correct_key_fuera_de_opciones(broken):
    quiz_path = broken / "quizzes" / "spmd.json"
    quiz = json.loads(quiz_path.read_text(encoding="utf-8"))
    # correct_key válido para el Literal (a|b|c|d) pero SIN opción asociada
    quiz["questions"][0]["options"] = quiz["questions"][0]["options"][:2]
    keys = {o["key"] for o in quiz["questions"][0]["options"]}
    quiz["questions"][0]["correct_key"] = next(
        k for k in ("a", "b", "c", "d") if k not in keys
    )
    quiz_path.write_text(json.dumps(quiz), encoding="utf-8")
    with pytest.raises(ContentError, match="correct_key"):
        ContentRepository.from_fixtures(broken)


def test_total_de_preguntas_habilitadas_roto(broken):
    quiz_path = broken / "quizzes" / "spmd.json"
    quiz = json.loads(quiz_path.read_text(encoding="utf-8"))
    quiz["questions"] = quiz["questions"][:-1]  # 60 → 59
    quiz_path.write_text(json.dumps(quiz), encoding="utf-8")
    with pytest.raises(ContentError, match="preguntas habilitadas"):
        ContentRepository.from_fixtures(broken)


def test_falta_main_py(broken):
    (broken / "examples" / "spmd" / "main.py").unlink()
    with pytest.raises(ContentError, match="falta el archivo"):
        ContentRepository.from_fixtures(broken)


def test_directorio_de_ejemplo_sin_catalogo(broken):
    (broken / "examples" / "intruso").mkdir()
    with pytest.raises(ContentError, match="sin entrada en catalog.json"):
        ContentRepository.from_fixtures(broken)


def test_leccion_no_utf8(broken):
    catalog = load_catalog(broken)
    content_file = catalog["lessons"]["spmd"]["content_file"]
    (broken / content_file).write_bytes(b"\xff\xfe latin1 roto")
    with pytest.raises(ContentError, match="UTF-8"):
        ContentRepository.from_fixtures(broken)


def test_validador_cli_detecta_roto(broken, capsys):
    (broken / "quizzes" / "spmd.json").unlink()
    assert validate_main(["--content-dir", str(broken)]) == 1
    assert "INVÁLIDO" in capsys.readouterr().err
