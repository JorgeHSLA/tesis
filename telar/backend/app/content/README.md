# backend/app/content/ — fixtures de contenido (dueño: WP4)

Este directorio contiene el contenido versionado del curso. WP0 solo deja
este README con el formato; **poblarlo es responsabilidad exclusiva de WP4**
(los shapes los validan `ContentRepository` de WP3 y `api-contract.md` §3-§5).

## Layout (data-model.md §4.1)

```
content/
├── catalog.json                 # módulos + lecciones + metadatos de ejemplos
├── examples/
│   └── <id>/main.py             # copia LITERAL del script del repo de
│                                #   aprendizaje (14 carpetas, nombre = id)
├── lessons/
│   └── <id>.md                  # info*.md portado al subset markdown de
│                                #   frontend-spec §1 (for.md se redacta nuevo)
└── quizzes/
    └── <id>.json                # preguntas con correct_key + explanation
```

## IDs estables (data-model.md §1)

`lesson_id == example_id ==` nombre de carpeta del repo de aprendizaje:
`primerEjemplo`, `for`, `spmd`, `spmdCritical`, `entornoDatos`,
`sumaVectores`, `matrices`, `mandelbrot`, `monteCarloPi`, `tareas`,
`fibonacciTareas`, `stencilCalor`, `transporteParticulas`, `sumaVectoresGPU`.

## Esquemas

- `catalog.json`: data-model.md §4.2 — cada ejemplo con TODOS los campos
  (incluidos `est_run_seconds`, `fixed_threads`, `fixed_threads_note`,
  `takeaways`, `expected_output_note`, `parser_id` ∈ los 6 válidos) y cada
  lección con `module_id`, `order`, `title`, `estimated_minutes`,
  `content_file`, `recommended[]`.
- `quizzes/<id>.json`: data-model.md §4.3 — `lesson_id`, `pass_threshold`
  (0.8) y `questions[]` con `id`, `order`, `text`, `options[a-d]`,
  `correct_key` (JAMÁS sale por la API antes del intento) y `explanation`.

## Invariantes (validados fail-fast en el lifespan, data-model.md §4.4)

- 17 ejemplos = 17 lecciones = 17 quizzes.
- Cada `lesson.example_id` y `module.lessons[*]` existen.
- `parser_id` ∈ {none, sweep_pi, sweep_transporte, pair_openmp_numpy,
  pair_openmp_blas, pair_parallel_serial}.
- `main.py` y `lessons/*.md` existen y son UTF-8.
- Total de preguntas habilitadas == 75 (80 − 5 de GPU).
- `correct_key` ∈ opciones de su pregunta.
