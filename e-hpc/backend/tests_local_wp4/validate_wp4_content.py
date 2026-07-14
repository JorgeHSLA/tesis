#!/usr/bin/env python3
"""Auto-chequeo local de WP4 (content-fixtures).

Valida backend/app/content/ contra data-model.md §4.2-§4.4,
api-contract.md §3-§5 y el subset markdown de frontend-spec §1,
sin depender de módulos de otros paquetes (WP3 valida con
``app.tools.validate_content`` en la integración).

Uso: python3 backend/tests_local_wp4/validate_wp4_content.py
Exit code 0 = todo en verde.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
CONTENT = BACKEND / "app" / "content"
SOURCE_REPO = Path("/mnt/d/universidad/tesis/simuladores/openmp/aprendizaje")

IDS = [
    "primerEjemplo", "for", "spmd", "spmdCritical", "entornoDatos",
    "sumaVectores", "matrices", "mandelbrot", "monteCarloPi", "tareas",
    "fibonacciTareas", "stencilCalor", "transporteParticulas",
    "sumaVectoresGPU",
]

# Mapeo data-model §4.2: id -> archivo fuente literal
SOURCE_FILES = {
    "primerEjemplo": "helloOpenMP.py",
    "for": "forOpenMP.py",
    "spmd": "piSpmd.py",
    "spmdCritical": "piSpmdCritical.py",
    "entornoDatos": "entornoDatos.py",
    "sumaVectores": "sumaVectores.py",
    "matrices": "multiplicacionMatrices.py",
    "mandelbrot": "areaMandelbrot.py",
    "monteCarloPi": "piMonteCarlo.py",
    "tareas": "piTask.py",
    "fibonacciTareas": "fibonacciTareas.py",
    "stencilCalor": "calorStencil.py",
    "transporteParticulas": "transporteMonteCarlo.py",
    "sumaVectoresGPU": "sumaVectoresGPU.py",
}

VALID_PARSER_IDS = {
    "none", "sweep_pi", "sweep_transporte", "pair_openmp_numpy",
    "pair_openmp_blas", "pair_parallel_serial",
}

EXAMPLE_FIELDS = {
    "filename": str, "title": str, "difficulty": int,
    "threads_configurable": bool, "fixed_threads": (int, type(None)),
    "fixed_threads_note": (str, type(None)), "sweeps_threads": bool,
    "self_measures": bool, "parser_id": str, "default_timeout_s": int,
    "est_run_seconds": int, "enabled": bool, "requires_gpu": bool,
    "directives": list, "teaches": str, "expected_output_note": str,
    "takeaways": list,
}

LESSON_FIELDS = {
    "module_id": str, "order": int, "title": str,
    "estimated_minutes": int, "content_file": str, "recommended": list,
}

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def check_catalog() -> dict:
    path = CONTENT / "catalog.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))

    modules = catalog["modules"]
    if [m["id"] for m in modules] != [f"m{i}" for i in range(1, 9)]:
        err("catalog: los módulos no son m1..m8 en orden")
    lessons_in_modules: list[str] = []
    for m in modules:
        for field in ("id", "order", "title", "description", "level", "lessons"):
            if field not in m:
                err(f"catalog módulo {m.get('id')}: falta '{field}'")
        lessons_in_modules.extend(m["lessons"])
    if sorted(lessons_in_modules) != sorted(IDS):
        err("catalog: modules[*].lessons no cubren exactamente los 14 ids")

    examples = catalog["examples"]
    if sorted(examples) != sorted(IDS):
        err("catalog: examples no tiene exactamente los 14 ids")
    for eid, ex in examples.items():
        for field, typ in EXAMPLE_FIELDS.items():
            if field not in ex:
                err(f"catalog example {eid}: falta '{field}'")
            elif not isinstance(ex[field], typ):
                err(f"catalog example {eid}: '{field}' tipo inválido ({type(ex[field]).__name__})")
        if ex.get("parser_id") not in VALID_PARSER_IDS:
            err(f"catalog example {eid}: parser_id inválido {ex.get('parser_id')!r}")
        if not 3 <= len(ex.get("takeaways", [])) <= 4:
            err(f"catalog example {eid}: takeaways debe tener 3-4 bullets")
        if ex.get("filename") != SOURCE_FILES[eid]:
            err(f"catalog example {eid}: filename {ex.get('filename')!r} != {SOURCE_FILES[eid]!r}")
        if isinstance(ex.get("threads_configurable"), bool) and ex["threads_configurable"]:
            if ex.get("fixed_threads") is not None or ex.get("fixed_threads_note") is not None:
                err(f"catalog example {eid}: configurable pero con fixed_threads/nota")
        if ex.get("sweeps_threads") and ex.get("fixed_threads") is not None:
            err(f"catalog example {eid}: sweep debe llevar fixed_threads null")

    gpu = examples["sumaVectoresGPU"]
    if gpu["enabled"] is not False or gpu["requires_gpu"] is not True:
        err("catalog: sumaVectoresGPU debe ir enabled=false, requires_gpu=true")
    for eid, ex in examples.items():
        if eid != "sumaVectoresGPU" and (ex["enabled"] is not True or ex["requires_gpu"] is not False):
            err(f"catalog example {eid}: debe ir enabled=true, requires_gpu=false")
    if examples["entornoDatos"]["fixed_threads"] != 4 or examples["monteCarloPi"]["fixed_threads"] != 4:
        err("catalog: entornoDatos y monteCarloPi deben llevar fixed_threads=4")

    lessons = catalog["lessons"]
    if sorted(lessons) != sorted(IDS):
        err("catalog: lessons no tiene exactamente los 14 ids (lesson_id == example_id)")
    orders = []
    for lid, lesson in lessons.items():
        for field, typ in LESSON_FIELDS.items():
            if field not in lesson:
                err(f"catalog lesson {lid}: falta '{field}'")
            elif not isinstance(lesson[field], typ):
                err(f"catalog lesson {lid}: '{field}' tipo inválido")
        orders.append(lesson.get("order"))
        module_ids = {m["id"] for m in modules}
        if lesson.get("module_id") not in module_ids:
            err(f"catalog lesson {lid}: module_id inexistente")
        for mod in modules:
            if lesson.get("module_id") == mod["id"] and lid not in mod["lessons"]:
                err(f"catalog lesson {lid}: no listada en su módulo {mod['id']}")
        if lesson.get("content_file") != f"lessons/{lid}.md":
            err(f"catalog lesson {lid}: content_file inesperado")
        recs = lesson.get("recommended", [])
        if not 2 <= len(recs) <= 3:
            err(f"catalog lesson {lid}: recommended debe tener 2-3 entradas")
        for rec in recs:
            if set(rec) != {"lesson_id", "label", "tag"}:
                err(f"catalog lesson {lid}: recommended con claves inválidas {sorted(rec)}")
            elif rec["lesson_id"] not in IDS:
                err(f"catalog lesson {lid}: recommended apunta a lección inexistente {rec['lesson_id']!r}")
            elif rec["lesson_id"] == lid:
                err(f"catalog lesson {lid}: recommended se apunta a sí misma")
    if sorted(orders) != list(range(1, 15)):
        err("catalog: lessons[*].order debe ser 1..14 único (ruta lineal del README)")
    return catalog


def check_examples_binary_diff() -> None:
    for eid in IDS:
        dst = CONTENT / "examples" / eid / "main.py"
        if not dst.is_file():
            err(f"examples/{eid}/main.py no existe")
            continue
        dst.read_text(encoding="utf-8")  # debe ser UTF-8
        src = SOURCE_REPO / eid / SOURCE_FILES[eid]
        if not src.is_file():
            err(f"fuente {src} no existe (no se pudo verificar diff binario)")
        elif src.read_bytes() != dst.read_bytes():
            err(f"examples/{eid}/main.py difiere BINARIAMENTE de {src}")


FENCE_RE = re.compile(r"^```")
HEADING_RE = re.compile(r"^(#{1,6})\s")
HTML_TAG_RE = re.compile(r"<[a-zA-Z/][^>]*>")


def check_lessons_markdown() -> None:
    files = sorted((CONTENT / "lessons").glob("*.md"))
    if sorted(f.stem for f in files) != sorted(IDS):
        err("lessons/: no hay exactamente los 14 .md esperados")
    for f in files:
        text = f.read_text(encoding="utf-8")
        if not text.strip():
            err(f"lessons/{f.name}: vacío")
        in_fence = False
        h1_count = 0
        for i, line in enumerate(text.splitlines(), start=1):
            if FENCE_RE.match(line.strip()):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            m = HEADING_RE.match(line)
            if m:
                if len(m.group(1)) > 4:
                    err(f"lessons/{f.name}:{i}: heading h{len(m.group(1))} fuera del subset (máx h4)")
                if len(m.group(1)) == 1:
                    h1_count += 1
            if line.lstrip().startswith(">"):
                err(f"lessons/{f.name}:{i}: blockquote fuera del subset markdown")
            if "![" in line:
                err(f"lessons/{f.name}:{i}: imagen fuera del subset markdown")
            if HTML_TAG_RE.search(line):
                err(f"lessons/{f.name}:{i}: HTML crudo fuera del subset markdown")
        if in_fence:
            err(f"lessons/{f.name}: fence de código sin cerrar")
        if h1_count != 1:
            err(f"lessons/{f.name}: debe tener exactamente un h1 (tiene {h1_count})")


def check_quizzes(catalog: dict) -> None:
    files = sorted((CONTENT / "quizzes").glob("*.json"))
    if sorted(f.stem for f in files) != sorted(IDS):
        err("quizzes/: no hay exactamente los 14 .json esperados")
    total = 0
    enabled_total = 0
    for f in files:
        quiz = json.loads(f.read_text(encoding="utf-8"))
        lid = f.stem
        if quiz.get("lesson_id") != lid:
            err(f"quizzes/{f.name}: lesson_id != nombre de archivo")
        if quiz.get("pass_threshold") != 0.8:
            err(f"quizzes/{f.name}: pass_threshold debe ser 0.8")
        questions = quiz.get("questions", [])
        if not questions:
            err(f"quizzes/{f.name}: sin preguntas")
        for n, q in enumerate(questions, start=1):
            for field in ("id", "order", "text", "options", "correct_key", "explanation"):
                if field not in q:
                    err(f"quizzes/{f.name} q{n}: falta '{field}'")
            if q.get("id") != f"{lid}-q{n}" or q.get("order") != n:
                err(f"quizzes/{f.name} q{n}: id/order inconsistentes")
            keys = [o.get("key") for o in q.get("options", [])]
            if keys != ["a", "b", "c", "d"]:
                err(f"quizzes/{f.name} q{n}: options deben ser exactamente a,b,c,d en orden")
            if q.get("correct_key") not in keys:
                err(f"quizzes/{f.name} q{n}: correct_key fuera de las opciones")
            if not str(q.get("explanation", "")).strip():
                err(f"quizzes/{f.name} q{n}: explanation vacía")
            for o in q.get("options", []):
                if not str(o.get("text", "")).strip():
                    err(f"quizzes/{f.name} q{n}: opción {o.get('key')} vacía")
        total += len(questions)
        if catalog["examples"][lid]["enabled"]:
            enabled_total += len(questions)
    if total != 65:
        err(f"quizzes: total de preguntas {total} != 65")
    if enabled_total != 60:
        err(f"quizzes: preguntas habilitadas {enabled_total} != 60 (65 - 5 de GPU)")


def main() -> int:
    catalog = check_catalog()
    check_examples_binary_diff()
    check_lessons_markdown()
    check_quizzes(catalog)
    if errors:
        print(f"FAIL — {len(errors)} problema(s):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("OK — contenido WP4 válido:")
    print("  - catalog.json: 8 módulos, 14 ejemplos, 14 lecciones, campos completos")
    print("  - 14 examples/<id>/main.py binariamente idénticos al repo fuente")
    print("  - 14 lessons/*.md dentro del subset markdown (h1-h4, sin HTML/imágenes/blockquotes)")
    print("  - 14 quizzes/*.json: 65 preguntas (60 habilitadas), correct_key ∈ opciones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
