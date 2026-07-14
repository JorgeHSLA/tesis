"""Mini-fixtures sintéticos de contenido para la suite local de WP3.

Genera un árbol ``content/`` VÁLIDO según data-model §4: 14 lecciones =
14 ejemplos = 14 quizzes, con la última lección deshabilitada (GPU) y
60 preguntas habilitadas (65 − 5). Los tests de fixtures rotos mutan el
árbol generado. NO usa los fixtures reales de WP4.
"""

from __future__ import annotations

import json
from pathlib import Path

#: 14 ids sintéticos; l14 es la lección "GPU" deshabilitada.
LESSON_IDS: tuple[str, ...] = tuple(f"l{n:02d}" for n in range(1, 15))
DISABLED_ID = "l14"

#: Preguntas por lección: 8×5 + 5×4 = 60 habilitadas; l14 aporta 5 más (=65).
QUESTION_COUNTS: dict[str, int] = {
    **{lid: 5 for lid in LESSON_IDS[:8]},
    **{lid: 4 for lid in LESSON_IDS[8:13]},
    DISABLED_ID: 5,
}

#: Reparto de lecciones en 4 módulos de mini-fixture (el nº de módulos no es
#: invariante de §4.4; el real trae 8).
MODULE_LESSONS: dict[str, tuple[str, ...]] = {
    "m1": LESSON_IDS[0:4],
    "m2": LESSON_IDS[4:8],
    "m3": LESSON_IDS[8:13],
    "m4": (DISABLED_ID,),
}

VALID_MARKDOWN = """# Lección {lid}

Texto con **negrita**, *cursiva*, `código inline` y un [enlace](https://openmp.org).

## Sección h2

- item uno
  - anidado
- item dos

```python
print("hola <int> dentro de fence")
```

| hilos | tiempo |
|---|---|
| 1 | 0.7 |
"""


def _module_of(lesson_id: str) -> str:
    for module_id, lessons in MODULE_LESSONS.items():
        if lesson_id in lessons:
            return module_id
    raise KeyError(lesson_id)


def _example_entry(lesson_id: str) -> dict:
    enabled = lesson_id != DISABLED_ID
    return {
        "filename": f"{lesson_id}.py",
        "title": f"Ejemplo {lesson_id}",
        "difficulty": 2,
        "teaches": f"Concepto de {lesson_id}",
        "directives": ["parallel"],
        "threads_configurable": lesson_id != "l03",
        "fixed_threads": 4 if lesson_id == "l03" else None,
        "fixed_threads_note": "num_threads(4)" if lesson_id == "l03" else None,
        "sweeps_threads": lesson_id == "l04",
        "self_measures": lesson_id == "l04",
        "parser_id": "sweep_pi" if lesson_id == "l04" else "none",
        "default_timeout_s": 30,
        "est_run_seconds": 5,
        "enabled": enabled,
        "requires_gpu": not enabled,
        "expected_output_note": "N líneas 'Hello from thread <int>'",
        "takeaways": [
            f"takeaway 1 de {lesson_id}",
            f"takeaway 2 de {lesson_id}",
            f"takeaway 3 de {lesson_id}",
        ],
    }


def _lesson_entry(lesson_id: str, order: int) -> dict:
    recommended = []
    if lesson_id == "l01":
        recommended = [
            {"lesson_id": "l02", "label": "Siguiente paso", "tag": "Básico"}
        ]
    return {
        "module_id": _module_of(lesson_id),
        "order": order,
        "title": f"Lección {lesson_id}",
        "estimated_minutes": 15,
        "content_file": f"lessons/{lesson_id}.md",
        "recommended": recommended,
    }


def _quiz(lesson_id: str) -> dict:
    questions = []
    for n in range(1, QUESTION_COUNTS[lesson_id] + 1):
        questions.append(
            {
                "id": f"{lesson_id}-q{n}",
                "order": n,
                "text": f"¿Pregunta {n} de {lesson_id}?",
                "options": [
                    {"key": "a", "text": "opción a"},
                    {"key": "b", "text": "opción b"},
                    {"key": "c", "text": "opción c"},
                    {"key": "d", "text": "opción d"},
                ],
                "correct_key": "b",
                "explanation": f"Explicación {n} de {lesson_id}",
            }
        )
    return {"lesson_id": lesson_id, "pass_threshold": 0.8, "questions": questions}


def make_catalog() -> dict:
    return {
        "modules": [
            {
                "id": module_id,
                "order": index + 1,
                "title": f"Módulo {module_id}",
                "description": f"Descripción de {module_id}",
                "level": "Básico",
                "lessons": list(lessons),
            }
            for index, (module_id, lessons) in enumerate(MODULE_LESSONS.items())
        ],
        "examples": {lid: _example_entry(lid) for lid in LESSON_IDS},
        "lessons": {
            lid: _lesson_entry(lid, order)
            for order, lid in enumerate(LESSON_IDS, start=1)
        },
    }


def make_content(root: Path) -> Path:
    """Escribe el árbol de contenido válido bajo ``root`` y lo devuelve."""
    catalog = make_catalog()
    (root / "examples").mkdir(parents=True, exist_ok=True)
    (root / "lessons").mkdir(parents=True, exist_ok=True)
    (root / "quizzes").mkdir(parents=True, exist_ok=True)
    (root / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    for lid in LESSON_IDS:
        example_dir = root / "examples" / lid
        example_dir.mkdir(parents=True, exist_ok=True)
        (example_dir / "main.py").write_text(
            f'print("main de {lid}")\n', encoding="utf-8"
        )
        (root / "lessons" / f"{lid}.md").write_text(
            VALID_MARKDOWN.format(lid=lid), encoding="utf-8"
        )
        (root / "quizzes" / f"{lid}.json").write_text(
            json.dumps(_quiz(lid), ensure_ascii=False, indent=1), encoding="utf-8"
        )
    return root


def rewrite_json(path: Path, mutate) -> None:
    """Carga un JSON, lo pasa por ``mutate`` (in place) y lo re-escribe."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    mutate(payload)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def full_answers(lesson_id: str, key: str = "b") -> dict[str, str]:
    """Respuestas completas para el quiz sintético (todas con ``key``)."""
    return {
        f"{lesson_id}-q{n}": key
        for n in range(1, QUESTION_COUNTS[lesson_id] + 1)
    }
