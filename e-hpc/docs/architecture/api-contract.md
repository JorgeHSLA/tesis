# E-HPC — Contrato de API (REST + WebSocket)

> **Estado: CONGELADO (Fase 1).** Los implementadores de Fase 3 no pueden
> añadir, quitar ni renombrar campos/endpoints sin actualizar este documento.
> Complementa a `architecture.md` (flujos) y `data-model.md` (persistencia).

- Base REST: `{API_BASE}/api/v1` — `API_BASE` es `""` (web via nginx, mismo
  origen) o `http://localhost:8000` (Electron/dev).
- Base WS: `{WS_BASE}/ws` — `WS_BASE` es `""`→`ws(s)://<host>` (web) o
  `ws://localhost:8000` (Electron/dev).
- Sin autenticación: herramienta local mono-usuario (ver `data-model.md` §1).
  CORS: `allow_origins=["http://localhost:5173","http://localhost:8080","null"]`,
  `allow_credentials=False`. El origen `"null"` existe SOLO porque Electron
  carga `file://`; **riesgo residual documentado**: cualquier página puede
  disparar `POST /jobs` en modo no-cors y un iframe sandbox (`Origin: null`)
  podría leer respuestas. Mitigaciones adoptadas: puertos ligados a
  `127.0.0.1` (nadie de la LAN llega), sandbox estricto del runner, y
  migración futura de Electron a `protocol app://` (elimina `null`). El WS
  valida `Origin` contra la misma lista (§8.1).
- Codificación: UTF-8, JSON. Timestamps: ISO-8601 UTC con sufijo `Z`
  (`2026-07-12T15:04:05.123Z`).

---

## 1. Envelope de respuesta

Todas las respuestas REST (excepto `GET /health` y la descarga de output)
usan el envelope:

```json
{ "success": true,  "data": { }, "error": null, "meta": null }
```

```json
{ "success": false, "data": null,
  "error": { "code": "JOB_NOT_FOUND", "message": "No existe el job 01a2…", "details": null },
  "meta": null }
```

- `meta` solo se puebla en listados paginados: `{"total": 37, "limit": 20, "offset": 0}`.
- `error.details` es opcional: objeto libre con contexto (p. ej. errores de
  validación por campo).
- Los errores de validación de pydantic (422 nativo de FastAPI) se re-formatean
  al envelope con `code="VALIDATION_ERROR"` y `details` = lista de FastAPI.

### 1.1 Catálogo de códigos de error

| HTTP | `error.code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/query inválido no cubierto por pydantic (p. ej. ni `code` ni `example_id` presentes) |
| 404 | `JOB_NOT_FOUND` / `EXAMPLE_NOT_FOUND` / `LESSON_NOT_FOUND` / `QUIZ_NOT_FOUND` | Recurso inexistente |
| 409 | `EXAMPLE_DISABLED` | Ejecutar un ejemplo con `enabled=false` (GPU) |
| 409 | `JOB_NOT_CANCELLABLE` | Cancelar un job ya terminal |
| 409 | `JOB_NOT_FINISHED` | Descargar output de un job aún no terminal |
| 413 | `CODE_TOO_LARGE` | Código > `max_code_bytes` (`EHPC_MAX_CODE_BYTES`, por defecto 262 144; JSON o upload; nginx corta antes a 1 MB) |
| 415 | `INVALID_EXTENSION` | Upload con extensión ≠ `.py` |
| 422 | `VALIDATION_ERROR` | Falla de esquema pydantic |
| 422 | `INVALID_ENCODING` | Upload no es UTF-8 válido |
| 429 | `TOO_MANY_JOBS` | Cola interna llena (>10 jobs en `queued`) |
| 500 | `INTERNAL_ERROR` | Excepción no controlada (mensaje genérico; detalle solo en logs del servidor) |
| 503 | `DOCKER_UNAVAILABLE` | El daemon no responde a `ping()` |
| 503 | `RUNNER_IMAGE_MISSING` | La imagen `ehpc-runner` no existe en el daemon |
| 401 | `UNAUTHORIZED` | **(Fase 4, §10)** Endpoint `/admin/*` con el modo autoría apagado (despliegue "estudiante", sin `EHPC_ADMIN_MODE`). _Nota 2026-07-26: ya no hay login/token; el gate es de despliegue (ver §10.0)_ |
| 404 | `MODULE_NOT_FOUND` | **(Fase 4, §10)** id de módulo inexistente |
| 409 | `DUPLICATE_ID` | **(Fase 4, §10)** Crear contenido con un id ya usado (módulo, o lección/ejemplo — comparten namespace) |
| 409 | `ORDER_CONFLICT` | **(Fase 4, §10)** `order` de módulo o de lección colisiona con otro existente |
| 409 | `MODULE_NOT_EMPTY` | **(Fase 4, §10)** Borrar un módulo que aún tiene lecciones |
| 422 | `CONTENT_VALIDATION_ERROR` | **(Fase 4, §10)** Falla una regla de negocio de contenido (refs módulo↔lección, `correct_key` ∈ opciones, `parser_id` válido, markdown fuera del subset, coherencia threads/GPU, unicidad). `details` = lista por campo |

---

## 2. Salud y sistema

### 2.1 `GET /health` — healthcheck de infraestructura (SIN envelope)

Consumido por el healthcheck de compose (one-liner urllib) y por el
RuntimeFooter web. Formato plano deliberadamente (excepción documentada al
envelope).

```json
{ "status": "ok", "checks": { "db": true, "docker": true, "runner_image": true } }
```

**Semántica liveness ≠ readiness** (evita el deadlock de primer arranque):
`200` si la app arrancó y la DB responde — aunque `docker` o `runner_image`
sean `false` (esos checks son **informativos**; la UI guía al usuario vía
`runner_image_present` de `/system`). `503` solo si la DB no responde o la
app no completó el lifespan. Así nginx puede arrancar y mostrar la UI aunque
la imagen runner aún no esté construida.

### 2.2 `GET /api/v1/system` — info para la UI

Alimenta el slider de hilos, el badge de la imagen runner y los límites que la
UI muestra.

`200`:

```json
{
  "success": true,
  "data": {
    "cores": 8,
    "max_threads": 8,
    "runner_image": "ehpc-runner:0.5.1",
    "runner_image_present": true,
    "gpu_examples_enabled": false,
    "versions": { "backend": "1.0.0", "python": "3.12.3", "pyomp": "0.5.1", "api": "v1" },
    "limits": {
      "max_code_bytes": 262144,
      "max_timeout_s": 120,
      "max_concurrent_jobs": 2,
      "max_output_bytes": 262144
    }
  },
  "error": null, "meta": null
}
```

- `max_threads = min(8, cores)` — techo del slider.
- `limits.max_timeout_s` es el valor crudo de `EHPC_MAX_TIMEOUT_S`. El tope de
  timeout es **OPCIONAL**: `0` (o cualquier valor ≤ 0) significa **sin límite**
  y es el valor por defecto. El ejemplo de arriba muestra un despliegue que sí
  fija tope (`120`); con la config por defecto ese campo vale `0` y el cliente
  no debe ofrecer/imponer ningún máximo.
- Errores: `503 DOCKER_UNAVAILABLE` si el daemon no responde (el resto de
  campos se sirven igual con `runner_image_present=false` cuando sea posible).

---

## 3. Catálogo de ejemplos (presets)

Los 14 ejemplos viven como fixtures versionados (ver `data-model.md` §4);
estos endpoints los exponen en solo-lectura.

### 3.1 `GET /api/v1/examples` — listado (sin código fuente)

`200`:

```json
{
  "success": true,
  "data": {
    "examples": [
      {
        "id": "spmd",
        "title": "π con patrón SPMD (false sharing)",
        "module_id": "m2",
        "order": 3,
        "filename": "piSpmd.py",
        "difficulty": 3,
        "teaches": "Reparto cíclico manual; demuestra false sharing (no hay speedup)",
        "directives": ["parallel", "private", "shared"],
        "threads_configurable": false,
        "fixed_threads": null,
        "fixed_threads_note": "Barre 1/2/4/8 hilos internamente con omp_set_num_threads; el slider se deshabilita",
        "sweeps_threads": true,
        "self_measures": true,
        "parser_id": "sweep_pi",
        "default_timeout_s": 60,
        "est_run_seconds": 8,
        "enabled": true,
        "requires_gpu": false
      },
      { "id": "sumaVectoresGPU", "title": "Suma de vectores en GPU (target)",
        "module_id": "m8", "order": 14, "filename": "sumaVectoresGPU.py",
        "difficulty": 4, "teaches": "Offloading a GPU; map(to/tofrom)",
        "directives": ["target", "teams", "distribute", "parallel for", "map"],
        "threads_configurable": false, "fixed_threads": null, "fixed_threads_note": null,
        "sweeps_threads": false, "self_measures": false, "parser_id": "none",
        "default_timeout_s": 90, "est_run_seconds": 10,
        "enabled": false, "requires_gpu": true }
    ]
  },
  "error": null, "meta": null
}
```

Semántica de los flags (valores completos por ejemplo en `data-model.md` §4.2):

| Campo | Significado para la UI |
|---|---|
| `threads_configurable` | `true` → slider de hilos activo (1..`max_threads`); `false` → slider bloqueado mostrando `fixed_threads_note` |
| `fixed_threads` | `int \| null` — valor **parseable** para posicionar el slider bloqueado: `4` para `entornoDatos`/`monteCarloPi`, `null` para los sweep (el slider muestra `1·2·4·8`) y para los configurables |
| `est_run_seconds` | duración estimada de la EJECUCIÓN (para `Ejemplo · ~{n}s` del catálogo); distinta de `estimated_minutes` de la lección (tiempo de estudio) |
| `self_measures` | `true` → los resultados incluirán `parsed_timings` (tiempos internos sin JIT) |
| `sweeps_threads` | `true` → una corrida da la curva 1/2/4/8 completa (gráfica de speedup directa) |
| `enabled` | `false` → visible en el catálogo pero no ejecutable (`POST /jobs` responde `409 EXAMPLE_DISABLED`); la card muestra el motivo (`requires_gpu`) |
| `parser_id` | `none · sweep_pi · sweep_transporte · pair_openmp_numpy · pair_openmp_blas · pair_parallel_serial` (spec en `architecture.md` §7.2) |

### 3.2 `GET /api/v1/examples/{example_id}` — detalle con código

`200`: mismo objeto del listado más:

```json
{
  "source_code": "# piSpmd.py\nfrom numba.openmp import njit, openmp_context as openmp\n…",
  "lesson_id": "spmd",
  "expected_output_note": "4 líneas: hilos = <n> | pi = <float> | tiempo = <float> s",
  "takeaways": [
    "El patrón SPMD reparte trabajo a mano con range(tid, n, nths)",
    "false sharing: casillas contiguas de partial comparten línea de caché",
    "Por qué NO hay speedup aunque haya 8 hilos"
  ]
}
```

- `takeaways`: 3-4 bullets para la card «Lo que vas a aprender» de Learn
  (derivados del resumen del info; viven en `catalog.json`).

Errores: `404 EXAMPLE_NOT_FOUND`.

---

## 4. Cursos: módulos y lecciones

Contenido = fixtures (8 módulos, 14 lecciones, 1 lección por ejemplo,
`lesson_id == example_id`). El progreso (mutable, en SQLite) viene **fusionado**
para que el catálogo se pinte con una sola llamada.

### 4.1 `GET /api/v1/modules` — catálogo completo

`200`:

```json
{
  "success": true,
  "data": {
    "modules": [
      {
        "id": "m2",
        "order": 2,
        "title": "Patrón SPMD y false sharing",
        "description": "Reparto manual con omp_get_thread_num; false sharing y su arreglo (privado + critical).",
        "level": "Intermedio",
        "lessons": [
          {
            "id": "spmd",
            "order": 3,
            "title": "π con patrón SPMD (false sharing)",
            "example_id": "spmd",
            "has_quiz": true,
            "quiz_question_count": 5,
            "estimated_minutes": 20,
            "enabled": true,
            "progress": { "viewed": true, "completed": false, "best_quiz_score": 4, "quiz_total": 5 }
          }
        ]
      }
    ],
    "summary": { "lessons_total": 14, "lessons_enabled": 13, "lessons_completed": 5,
                 "quizzes_total": 14, "questions_enabled_total": 60 }
  },
  "error": null, "meta": null
}
```

- `progress` es `{"viewed":false,"completed":false,"best_quiz_score":null,"quiz_total":n}`
  si no hay registro.
- La lección GPU (`sumaVectoresGPU`) aparece con `enabled:false`.

### 4.2 `GET /api/v1/lessons/{lesson_id}` — lección completa

`200`:

```json
{
  "success": true,
  "data": {
    "id": "spmd",
    "module_id": "m2",
    "order": 3,
    "title": "π con patrón SPMD (false sharing)",
    "content_markdown": "# π con SPMD\n\nCalcula el mismo π que `for/` pero SIN `parallel for`…",
    "example_id": "spmd",
    "has_quiz": true,
    "quiz_question_count": 5,
    "estimated_minutes": 20,
    "enabled": true,
    "prev_lesson_id": "for",
    "next_lesson_id": "spmdCritical",
    "recommended": [
      { "lesson_id": "mandelbrot",   "label": "Data races clásicos",    "tag": "Avanzado" },
      { "lesson_id": "spmdCritical", "label": "El arreglo: critical",   "tag": "Práctica" }
    ],
    "progress": { "viewed": true, "completed": false, "best_quiz_score": null, "quiz_total": 5 }
  },
  "error": null, "meta": null
}
```

- `recommended`: 2-3 lecciones relacionadas definidas estáticamente en
  `catalog.json` (card «Recomendados» de Learn). Puede ser `[]`.

- `content_markdown` = el `info*.md` portado (para `for/`, cuyo info está
  vacío, la lección se redactó desde el código + README — ya prevista en los
  fixtures).
- Errores: `404 LESSON_NOT_FOUND`.

---

## 5. Quizzes

Las preguntas con su respuesta correcta y explicación viven en fixtures **solo
del servidor**; el cliente jamás recibe la clave correcta antes de intentar.

### 5.1 `GET /api/v1/lessons/{lesson_id}/quiz` — preguntas SIN respuestas

`200`:

```json
{
  "success": true,
  "data": {
    "lesson_id": "spmd",
    "question_count": 5,
    "questions": [
      {
        "id": "spmd-q1",
        "order": 1,
        "text": "¿Cómo reparte el trabajo el hilo tid en el patrón SPMD de este ejemplo?",
        "options": [
          { "key": "a", "text": "OpenMP reparte el bucle automáticamente" },
          { "key": "b", "text": "Manualmente con range(tid, num_steps, nths): reparto cíclico (el hilo 0 toma 0, 8, 16…)" },
          { "key": "c", "text": "Cada hilo procesa la mitad izquierda o derecha" },
          { "key": "d", "text": "Un hilo maestro asigna trozos bajo demanda" }
        ]
      }
    ]
  },
  "error": null, "meta": null
}
```

- El orden de opciones es el de los fixtures (estable; no se baraja en v1).
- Errores: `404 LESSON_NOT_FOUND` / `404 QUIZ_NOT_FOUND` (lección sin quiz —
  no ocurre en el contenido actual, pero el código lo contempla).

### 5.2 `POST /api/v1/lessons/{lesson_id}/quiz/attempts` — enviar intento

Request:

```json
{ "answers": { "spmd-q1": "b", "spmd-q2": "c", "spmd-q3": "b", "spmd-q4": "c", "spmd-q5": "b" } }
```

Reglas de validación: deben venir **todas** las preguntas del quiz, claves de
pregunta existentes, valores en `a|b|c|d` → si no, `422 VALIDATION_ERROR`.

`201`:

```json
{
  "success": true,
  "data": {
    "attempt_id": "9f2c4e61b0a14d97a6d0c3f5e8b21a44",
    "lesson_id": "spmd",
    "score": 4,
    "total": 5,
    "passed": true,
    "pass_threshold": 0.8,
    "created_at": "2026-07-12T15:04:05.123Z",
    "results": [
      {
        "question_id": "spmd-q1",
        "selected": "b",
        "correct_key": "b",
        "correct": true,
        "explanation": "El info lo llama \"ESTE es el reparto manual\"; el for es un for de Python normal que OpenMP no toca."
      },
      {
        "question_id": "spmd-q4",
        "selected": "a",
        "correct_key": "c",
        "correct": false,
        "explanation": "omp_get_wtime() es el cronómetro de OpenMP y se usa dentro de la función @njit."
      }
    ]
  },
  "error": null, "meta": null
}
```

Efectos laterales: persiste el intento; actualiza `lesson_progress.best_quiz_score`
si mejora; si `passed=true` marca `lesson_progress.completed=true`.
`passed = score/total >= 0.8`.

### 5.3 `GET /api/v1/lessons/{lesson_id}/quiz/attempts` — historial

> **Opcional / post-MVP**: ninguna pantalla del frontend lo consume en v1
> (la card de quiz solo muestra `best_quiz_score` vía progreso). Se congela
> el shape por si se añade la lista de intentos; implementarlo es trivial
> (el repositorio ya lo expone) pero NO es criterio de aceptación de Fase 3.

Query: `limit` (default 10, máx 50). `200`:

```json
{
  "success": true,
  "data": { "attempts": [
    { "attempt_id": "9f2c…", "score": 4, "total": 5, "passed": true,
      "created_at": "2026-07-12T15:04:05.123Z" }
  ] },
  "error": null,
  "meta": { "total": 3, "limit": 10, "offset": 0 }
}
```

---

## 6. Progreso

### 6.1 `GET /api/v1/progress` — mapa completo

`200`:

```json
{
  "success": true,
  "data": {
    "lessons": {
      "primerEjemplo": { "viewed": true, "completed": true,  "best_quiz_score": 4, "quiz_total": 4,
                          "last_job_id": "01a2…", "updated_at": "2026-07-11T10:00:00Z" },
      "spmd":          { "viewed": true, "completed": false, "best_quiz_score": null, "quiz_total": 5,
                          "last_job_id": null, "updated_at": "2026-07-12T09:30:00Z" }
    },
    "summary": { "lessons_completed": 5, "lessons_enabled": 13,
                 "modules_completed": 2, "modules_total": 8 }
  },
  "error": null, "meta": null
}
```

(Solo aparecen lecciones con algún registro; las demás se asumen en cero.)

### 6.2 `PUT /api/v1/progress/lessons/{lesson_id}` — actualizar

Request (campos opcionales; solo se tocan los enviados):

```json
{ "viewed": true, "completed": false }
```

`200`: el registro resultante (mismo shape que una entrada de `lessons` en 6.1).
Errores: `404 LESSON_NOT_FOUND`, `422 VALIDATION_ERROR`.
Nota: `completed` también se activa automáticamente al aprobar el quiz (§5.2);
`viewed` lo marca el frontend al abrir la lección. `best_quiz_score` y
`last_job_id` NO son escribibles por este endpoint (los gestiona el backend).

---

## 7. Jobs (ejecuciones)

### 7.1 `POST /api/v1/jobs` — crear job (editor o preset)

Request — **al menos una** fuente (`example_id` y/o `code`). Semántica:

- Solo `example_id` → se ejecuta el fixture tal cual (`source_kind="example"`).
- Solo `code` → código propio (`source_kind="editor"`, `parser_id="none"`).
- `example_id` **+** `code` → se ejecuta `code`; `example_id` aporta el
  parser, el filename por defecto y la trazabilidad. `source_kind="example"`
  si `code` es byte-idéntico al fixture, `"editor"` si difiere (ejemplo
  editado: conserva `parsed_timings` si el formato de stdout sigue casando).

```json
{
  "example_id": "transporteParticulas",
  "code": null,
  "filename": null,
  "threads": null,
  "timeout_s": null,
  "lesson_id": "transporteParticulas"
}
```

o código propio del editor:

```json
{
  "example_id": null,
  "code": "from numba.openmp import njit, openmp_context as openmp\n…",
  "filename": "mi_experimento.py",
  "threads": 4,
  "timeout_s": 60,
  "lesson_id": null
}
```

Validación (pydantic + reglas de negocio):

| Campo | Regla |
|---|---|
| `example_id` / `code` | al menos uno presente → si no, `400 VALIDATION_ERROR`; `example_id` inexistente → `404 EXAMPLE_NOT_FOUND` |
| `code` | `1 ≤ bytes ≤ max_code_bytes` UTF-8 (tope `EHPC_MAX_CODE_BYTES`, por defecto 262144; aplicado en **runtime** en el router, por igual que `/upload` y la vía admin JSON — fix de residuos de auditoría, BL-17) → `413 CODE_TOO_LARGE` |
| `filename` | opcional (default: `filename` del ejemplo, o `main.py`); patrón `^[A-Za-z0-9._-]{1,80}\.py$` |
| `threads` | **opcional**. Si el ejemplo tiene `threads_configurable=false`, se IGNORA por completo (puede omitirse; el backend usa su valor fijo: `min(8, cores)` para sweep, `fixed_threads` para fixed) y la respuesta lleva `threads_note`. En caso contrario: entero `1..max_threads` (de `/system`), default 4 |
| `timeout_s` | opcional; mínimo `5` SIEMPRE. El **máximo es opcional**: solo si `EHPC_MAX_TIMEOUT_S > 0` se rechaza `timeout_s > EHPC_MAX_TIMEOUT_S` → `422 VALIDATION_ERROR`; con `EHPC_MAX_TIMEOUT_S = 0` (por defecto) **no hay tope**. Default = `default_timeout_s` del ejemplo o 60 para código propio |
| `lesson_id` | opcional; si viene, debe existir → `404 LESSON_NOT_FOUND`; al terminar bien el job se actualiza `lesson_progress.last_job_id` |
| ejemplo deshabilitado | `409 EXAMPLE_DISABLED` |
| capacidad | `429 TOO_MANY_JOBS` si la cola interna supera 10 |
| infraestructura | `503 DOCKER_UNAVAILABLE` / `503 RUNNER_IMAGE_MISSING` |

`202 Accepted`:

```json
{
  "success": true,
  "data": {
    "job_id": "01a2b3c4d5e64f789a0b1c2d3e4f5061",
    "status": "queued",
    "threads_effective": 8,
    "threads_note": "Este ejemplo barre 1/2/4/8 hilos internamente; se asignan 8 CPUs.",
    "ws_url": "/ws/jobs/01a2b3c4d5e64f789a0b1c2d3e4f5061",
    "href": "/api/v1/jobs/01a2b3c4d5e64f789a0b1c2d3e4f5061",
    "created_at": "2026-07-12T15:04:05.123Z"
  },
  "error": null, "meta": null
}
```

`threads_effective` = CPUs realmente asignadas (puede diferir de `threads`
para ejemplos de hilos fijos); `threads_note` es `null` si no hubo ajuste.

### 7.2 `POST /api/v1/jobs/upload` — crear job desde archivo `.py`

`multipart/form-data`:

| Parte | Tipo | Regla |
|---|---|---|
| `file` | UploadFile | **filename validado con el MISMO patrón estricto de 7.1** `^[A-Za-z0-9._-]{1,80}\.py$` (rechaza comillas, CR/LF, control chars, longitud > 80) → `415 INVALID_EXTENSION`; lectura por chunks de 64 KB con corte a 256 KB (`413 CODE_TOO_LARGE`); decodificación UTF-8 (`422 INVALID_ENCODING`) |
| `threads` | Form int | igual que 7.1 |
| `timeout_s` | Form int, opcional | igual que 7.1 |
| `lesson_id` | Form str, opcional | igual que 7.1 |

Respuesta y errores: idénticos a 7.1 (`source_kind` del job queda en `upload`).

### 7.3 `GET /api/v1/jobs` — listar recientes

Query: `limit` (default 20, máx 100), `offset` (default 0), `status` (opcional,
uno de los 8 estados).

`200`:

```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "job_id": "01a2b3c4d5e64f789a0b1c2d3e4f5061",
        "filename": "transporteMonteCarlo.py",
        "source_kind": "example",
        "example_id": "transporteParticulas",
        "lesson_id": "transporteParticulas",
        "status": "completed",
        "exit_code": 0,
        "threads": 8,
        "wall_time_ms": 8727,
        "created_at": "2026-07-12T15:04:05.123Z",
        "finished_at": "2026-07-12T15:04:14.337Z"
      }
    ]
  },
  "error": null,
  "meta": { "total": 37, "limit": 20, "offset": 0 }
}
```

(Shape resumido: sin código, sin stdout — para la card "Jobs recientes" del Home.)

> `wall_time_ms = finished_at − started_at` (**excluye** el tiempo en cola;
> misma definición en el listado, el detalle y `data-model.md`).

### 7.4 `GET /api/v1/jobs/{job_id}` — detalle y resultados

`200` (job terminado):

```json
{
  "success": true,
  "data": {
    "job_id": "01a2b3c4d5e64f789a0b1c2d3e4f5061",
    "filename": "transporteMonteCarlo.py",
    "source_kind": "example",
    "example_id": "transporteParticulas",
    "lesson_id": "transporteParticulas",
    "source_code": "from numba.openmp import …",
    "status": "completed",
    "exit_code": 0,
    "oom_killed": false,
    "error_detail": null,
    "threads": 8,
    "timeout_s": 60,
    "created_at": "2026-07-12T15:04:05.123Z",
    "started_at": "2026-07-12T15:04:05.610Z",
    "finished_at": "2026-07-12T15:04:14.337Z",
    "wall_time_ms": 8727,
    "stdout": "hilos = 1 | tiempo = 0.726 s | transmitidas: 2.35 % | …",
    "stderr": "",
    "output_truncated": false,
    "metrics_summary": {
      "samples": 8,
      "cpu_percent_max": 792.4,
      "cpu_percent_avg": 431.0,
      "mem_used_bytes_max": 231211008,
      "mem_limit_bytes": 536870912,
      "pids_max": 12,
      "throttled_periods": 0
    },
    "parsed_timings": {
      "parser_id": "sweep_transporte",
      "kind": "sweep",
      "series": [
        { "threads": 1, "time_s": 0.726, "speedup": 1.0,  "efficiency": 1.0 },
        { "threads": 2, "time_s": 0.256, "speedup": 2.84, "efficiency": 1.42 },
        { "threads": 4, "time_s": 0.173, "speedup": 4.20, "efficiency": 1.05 },
        { "threads": 8, "time_s": 0.091, "speedup": 7.98, "efficiency": 1.0 }
      ],
      "extra": { "transmitidas_pct": 2.35, "reflejadas_pct": 20.85, "absorbidas_pct": 76.8 },
      "correct": null
    }
  },
  "error": null, "meta": null
}
```

Variantes de `parsed_timings` según `parser_id` (spec `architecture.md` §7.2):

```jsonc
// pair_openmp_numpy / pair_openmp_blas / pair_parallel_serial
{ "parser_id": "pair_parallel_serial", "kind": "pair",
  "parallel_time_s": 0.912, "reference_time_s": 0.989,
  "reference_label": "serial",          // "numpy" | "blas" | "serial"
  "speedup_vs_reference": 1.08,
  "correct": true }                     // del assert "correcto?/paralelo == serial?" si existe
// none
null
```

- Mientras el job no es terminal: `stdout/stderr` son `null`,
  `metrics_summary` y `parsed_timings` `null` (el vivo va por WS).
- Si `output_truncated=true`: `parsed_timings=null` (no se parsea output
  incompleto). El `error_detail` **depende de la causa de terminación**, no
  del truncado (ver la precedencia abajo).

**Precedencia `output_truncated` × causa de terminación** (aclaración de
2026-07-19; antes esta sección afirmaba que `output_truncated=true` implicaba
`error_detail="output_limit_exceeded"`, lo que contradecía el
primer-escritor-gana de `architecture.md` §3.3):

- `status` y `error_detail` se derivan **exclusivamente** de
  `kill_reason + exit_code + OOMKilled` (tabla §3.3), y `kill_reason` lo fija
  el primer escritor con la prioridad `cancel > output_limit > timeout`.
- `output_truncated` es un **flag informativo independiente**: describe si el
  presupuesto de 262 144 B se agotó, no por qué murió el job.
- Por tanto, si un job se cancela (o expira su timeout) en la misma ventana en
  que su salida se trunca, gana la causa: la respuesta puede traer
  `status="cancelled"`/`"timeout"` con `error_detail=null`/`"wall_timeout"`
  **y** `output_truncated=true`. Es la combinación esperada, no un error.
- La implicación sí se cumple en el sentido útil: `error_detail =
  "output_limit_exceeded"` ⇒ `output_truncated=true`.
- `error_detail` es un **código estable de catálogo cerrado**:
  `wall_timeout | output_limit_exceeded | oom | orphaned_on_restart |
  sandbox_error | null`. Nunca texto crudo de excepciones docker-py/FastAPI
  (rutas, volúmenes, IDs internos van SOLO a los logs del servidor, igual que
  `500 INTERNAL_ERROR`).
- Errores: `404 JOB_NOT_FOUND`.

### 7.5 `POST /api/v1/jobs/{job_id}/cancel` — cancelar

Sin body. `202`:

```json
{ "success": true, "data": { "job_id": "01a2…", "status": "cancelling" }, "error": null, "meta": null }
```

- Equivalente REST del mensaje WS `cancel` (para la UI de listados y para
  clientes sin WS). Internamente: setea `kill_reason="cancel"` +
  `container.kill()`; el estado final `cancelled` llega por WS/polling.
- Cancelar un job en `queued` setea `cancel_requested` en el registro en
  memoria; el task del job lo comprueba tras adquirir el semáforo y ANTES de
  crear el contenedor (mecanismo exacto en `architecture.md` §3.3 — sin
  carrera: el job jamás llega a ejecutarse tras un cancel aceptado).
- Errores: `404 JOB_NOT_FOUND`; `409 JOB_NOT_CANCELLABLE` si ya es terminal.

### 7.6 `GET /api/v1/jobs/{job_id}/output` — descargar stdout

Query: `stream` = `combined` (default) | `stdout` | `stderr`.

`200`: **sin envelope** — `text/plain; charset=utf-8` con
`Content-Disposition: attachment; filename="transporteMonteCarlo-01a2b3c4.txt"`.
El stem del filename procede de `jobs.filename`, que ya cumple el patrón
estricto de 7.1/7.2 (solo `[A-Za-z0-9._-]`) — imposible inyectar comillas o
CR/LF en la cabecera.
Si el output fue truncado, se añade una última línea
`\n--- [E-HPC] output truncado a 262144 bytes ---\n`.

Errores (con envelope JSON): `404 JOB_NOT_FOUND`; `409` con
`code="JOB_NOT_FINISHED"`, `message="El job aún no ha terminado"` si el job
no es terminal (añadir `JOB_NOT_FINISHED` al catálogo de §1.1); `422
VALIDATION_ERROR` si `stream` no es `combined`/`stdout`/`stderr` (BL-36).

### 7.7 Estados del job (máquina de fases)

```
queued → creating → compiling → running → completed   (exit_code == 0)
   |         |          |          |    → failed       (exit_code != 0 | OOM | error sandbox | output_limit)
   |         |          |          |    → timeout      (wall-clock excedido → kill)
   └─────────┴──────────┴──────────┴──── cancelled     (cancel del usuario → kill)
```

| Fase | Significado |
|---|---|
| `queued` | Aceptado; esperando slot del semáforo (`max_concurrent_jobs`) |
| `creating` | Escribiendo código + `containers.create/start` en curso |
| `compiling` | Contenedor vivo, **aún sin primer byte de stdout** (JIT de PyOMP; también cubre programas sin output) |
| `running` | Primer byte de stdout recibido |
| `completed` | Exit 0 |
| `failed` | Exit ≠ 0 (incluye 137+OOM, 139 segfault, errores de directivas no soportadas por pyomp), error del sandbox, u output truncado (`error_detail="output_limit_exceeded"`) |
| `timeout` | Matado por el timeout duro (`error_detail="wall_timeout"`) |
| `cancelled` | Matado a petición del usuario |

Terminales: `completed | failed | timeout | cancelled`.

---

## 8. Protocolo WebSocket

### 8.1 Conexión

- URL: `{WS_BASE}/ws/jobs/{job_id}` — un WS multiplexa todos los tipos de
  mensaje del job (logs + métricas + estado + errores).
- **N conexiones simultáneas al mismo job son válidas** (dos pestañas, el
  doble-mount de React StrictMode): el drainer del job (`architecture.md`
  §3.2) hace **fan-out** replicando cada mensaje a una cola por conexión;
  cada suscriptor recibe el stream completo (backlog al suscribirse + vivo).
  Cerrar una conexión no afecta a las demás ni al job.
- Handshake: WS estándar (uvicorn `websockets`). CORS no aplica a WS; el
  backend valida `Origin` manualmente contra la misma lista del CORS
  (aceptando también `null` y ausencia de header para clientes no-navegador).
- Job inexistente → el servidor acepta y cierra inmediatamente con código
  **4404** y reason `"job not found"` (no se puede rechazar un handshake WS
  con status HTTP arbitrario de forma portable).
- Job ya terminal al conectar → el servidor envía `status` final + replay del
  output almacenado como mensajes `log` + `eof`, y cierra `1000` (soporta F5).
  No existe un close-code especial para «job terminado»: el cliente lo
  detecta por el `status` terminal + `eof`. El replay tiene **dos fuentes**
  según cuándo se conecte (ver §8.2, «Replay de un job terminal»).
- Job activo al conectar → `status` actual + backlog del ring-buffer en
  memoria (últimas ~500 líneas) + stream en vivo.
- **Exhaustividad activo/terminal** (sin ventana ciega): el handler consulta
  primero el registro `app.state.jobs` y después la DB; el job solo se retira
  del registro DESPUÉS de que `finish()` confirme en DB y se hayan emitido
  `status` terminal + `eof` a los suscriptores (orden fijado en
  `architecture.md` §3.4). Si el registro falla y la DB aún no es terminal,
  el handler reintenta una vez tras ~100 ms antes de decidir.
- Reconexión: responsabilidad del cliente (reintento con backoff); el backlog
  cubre lo perdido (huecos detectables por `seq`).

### 8.2 Mensajes servidor → cliente

Todos son JSON de un objeto con `type`. Campos comunes: `job_id`, `ts`
(ISO-8601 UTC).

#### `status` — cambio de fase

Se emite al conectar (snapshot) y en cada transición.

```json
{ "type": "status", "job_id": "01a2…", "ts": "2026-07-12T15:04:05.610Z",
  "phase": "compiling",
  "detail": null }
```

Fase terminal (siempre el penúltimo mensaje, antes de `eof`):

```json
{ "type": "status", "job_id": "01a2…", "ts": "2026-07-12T15:04:14.337Z",
  "phase": "completed",
  "detail": {
    "exit_code": 0,
    "oom_killed": false,
    "wall_time_ms": 8727,
    "output_truncated": false,
    "error_detail": null
  } }
```

`phase` ∈ `queued | creating | compiling | running | completed | failed | timeout | cancelled`.
`detail` solo se puebla en fases terminales. Al recibir una fase terminal el
cliente debe pedir `GET /api/v1/jobs/{id}` para `parsed_timings` y
`metrics_summary` (no viajan por WS).

#### `log` — líneas de salida

```json
{ "type": "log", "job_id": "01a2…", "ts": "2026-07-12T15:04:08.101Z",
  "stream": "stdout",
  "lines": ["hilos = 1 | tiempo = 0.726 s | transmitidas: 2.35 % | reflejadas: 20.85 % | absorbidas: 76.8 %"],
  "seq": 17 }
```

- `stream` ∈ `stdout | stderr` (streams demultiplexados: dos lectores
  `logs(stdout=True)` / `logs(stderr=True)`).
- `lines`: 1..N líneas completas (re-bufferizadas por `\n` en el backend; los
  chunks de Docker no son líneas). Una línea parcial final se emite al EOF.
- `seq`: contador monótono por job (detección de huecos tras reconexión;
  el backlog re-usa los `seq` originales).

**Replay de un job terminal** (precisión de 2026-07-19; antes esta regla se
enunciaba sin distinguir las dos fuentes, y el replay desde DB rompía la
continuidad de `seq` que el cliente asume):

| Fuente | Cuándo | `seq` | `ts` |
|---|---|---|---|
| Ring-buffer del job retenido | Reconexión dentro de los ~10 s posteriores al fin del job (`TERMINAL_HANDLE_RETENTION_S`) | **originales** del stream vivo | reales de cada línea |
| Texto persistido en `jobs.stdout/stderr` | Cualquier conexión posterior (F5, historial) | **renumerados desde 1** (el texto plano no conserva la numeración) | `""` — la DB no guarda el instante de cada línea |

- El cliente **debe** tratar cada conexión como una sesión nueva: resetear su
  estado de dedupe (`lastLogSeq`) al (re)conectar. Con la retención el dedupe
  sigue protegiendo del solapamiento backlog↔vivo dentro de una misma sesión;
  sin ella, un `seq` renumerado no puede compararse con el de la sesión previa.
- `ts: ""` significa «instante desconocido»: la UI no debe fabricar un reloj
  (la terminal lo renderiza como `—`).

#### `metrics` — muestra de `docker stats` (~1/s, lossy)

```json
{ "type": "metrics", "job_id": "01a2…", "ts": "2026-07-12T15:04:09.000Z",
  "cpu_percent": 792.4,
  "online_cpus": 8,
  "mem_used_bytes": 231211008,
  "mem_limit_bytes": 536870912,
  "mem_percent": 43.1,
  "pids": 12,
  "throttled_periods": 0 }
```

- `cpu_percent` con la fórmula oficial cgroups v2:
  `(cpu_delta / system_delta) * online_cpus * 100` — **puede superar 100**
  (N hilos ≈ N·100; la UI puede normalizar con `online_cpus`).
- `mem_used_bytes = usage - inactive_file` (igual que `docker stats`).
- **No hay métricas por hilo**: cgroups v2 no expone `percpu_usage`
  (decisión documentada en `architecture.md` §6).
- La primera muestra del daemon (sin `precpu_stats`) se descarta en el
  backend; muestras finales incompletas también.
- Entrega lossy: si la cola está llena se pierde la muestra (sin error).

#### `error` — error no fatal del stream

```json
{ "type": "error", "job_id": "01a2…", "ts": "2026-07-12T15:04:10.000Z",
  "code": "OUTPUT_TRUNCATED",
  "message": "Salida cortada a 262144 bytes; el job será terminado." }
```

Códigos: `OUTPUT_TRUNCATED` (se alcanzó el límite de 256 KB: se deja de leer,
se mata el contenedor, el job termina `failed` con
`error_detail="output_limit_exceeded"` — patrón glot),
`STREAM_ERROR` (excepción leyendo logs/stats; el job continúa si es posible),
`BAD_CLIENT_MESSAGE` (ver 8.3).
Un `error` **no** cierra la conexión; el cierre siempre lo marca `eof`.

#### `eof` — fin del stream

Último mensaje, tras el `status` terminal; después el servidor cierra con
código 1000.

```json
{ "type": "eof", "job_id": "01a2…", "ts": "2026-07-12T15:04:14.400Z",
  "total_log_bytes": 5122, "truncated": false }
```

### 8.3 Mensajes cliente → servidor

Único comando soportado:

```json
{ "type": "cancel" }
```

- Efecto: `container.kill()` (cierra ejecución + streams a la vez); el job
  termina con `status.phase="cancelled"` + `eof`. Si el job está en `queued`,
  se marca `cancelled` sin crear contenedor. Idempotente: cancelar dos veces
  o cancelar un job terminal se ignora en silencio.
- Cualquier otro mensaje (JSON inválido, `type` desconocido) → el servidor
  responde `{"type":"error","code":"BAD_CLIENT_MESSAGE",...}` y lo ignora;
  no cierra la conexión.

### 8.4 Reglas de flujo, truncado y cierre

| Regla | Valor |
|---|---|
| Flush de logs | Se agrupan líneas y se emite un mensaje `log` como máximo cada **~100 ms** o al acumular **4 KB**, lo que ocurra antes |
| Backpressure de logs | `run_coroutine_threadsafe(queue.put).result(timeout)` — cola `maxsize=1000` consumida SIEMPRE por el **drainer del job** (tarea propia del job_runner, viva haya o no clientes WS; `architecture.md` §3.2). El backpressure frena al productor contra el drainer, **jamás contra un cliente**: un cliente lento solo pierde mensajes de SU cola por-conexión (lossy con hueco de `seq`) |
| Métricas | 1 muestra/s (frecuencia fija del daemon); entrega lossy (`call_soon_threadsafe(put_nowait)`) |
| Truncado | Presupuesto **262 144 bytes** de log por job (stdout+stderr sumados), aplicado por el drainer. Al excederse: `error OUTPUT_TRUNCATED` → kill → `status failed` → `eof {truncated:true}` |
| Desconexión del cliente | Detectada por la tarea lectora (`asyncio.wait FIRST_COMPLETED`). **No cancela el job**: el drainer sigue consumiendo, acumulando y truncando; el cliente puede reconectar (backlog + `seq`) o consultar por REST |
| Cierre normal | `status` terminal → `eof` → `close(1000)` |
| Códigos de cierre | `1000` fin normal · `4404` job inexistente · `1011` error interno del servidor (tras intentar emitir `error`) |
| Ping/pong | Los keepalive de protocolo los gestiona uvicorn/websockets por defecto; sin pings de aplicación |

### 8.5 Secuencia típica (ejemplo completo, transporteParticulas)

```
C → S   [conexión /ws/jobs/01a2…]
S → C   {"type":"status","phase":"queued", …}
S → C   {"type":"status","phase":"creating", …}
S → C   {"type":"status","phase":"compiling", …}          ← silencio del JIT cubierto
S → C   {"type":"metrics","cpu_percent":101.3, …}          ← compilando: ~1 core
S → C   {"type":"status","phase":"running", …}             ← primer byte de stdout
S → C   {"type":"log","stream":"stdout","lines":["hilos = 1 | tiempo = 0.726 s | …"],"seq":1}
S → C   {"type":"metrics","cpu_percent":792.4, …}          ← 8 hilos ≈ 800%
S → C   {"type":"log","stream":"stdout","lines":["hilos = 2 | …","hilos = 4 | …"],"seq":2}
S → C   {"type":"log","stream":"stdout","lines":["hilos = 8 | …"],"seq":3}
S → C   {"type":"status","phase":"completed","detail":{"exit_code":0, …}}
S → C   {"type":"eof","truncated":false, …}
S → C   [close 1000]
C:      GET /api/v1/jobs/01a2…   → parsed_timings (curva de speedup)
```

---

## 9. Resumen de endpoints (tabla congelada)

| Método | Path | Propósito | OK | Errores |
|---|---|---|---|---|
| GET | `/health` | Healthcheck infra (sin envelope) | 200/503 | — |
| GET | `/api/v1/system` | Cores, límites, versiones | 200 | 503 |
| GET | `/api/v1/examples` | Catálogo de 14 presets | 200 | — |
| GET | `/api/v1/examples/{id}` | Preset con código fuente | 200 | 404 |
| GET | `/api/v1/modules` | 8 módulos + lecciones + progreso | 200 | — |
| GET | `/api/v1/lessons/{id}` | Lección con markdown | 200 | 404 |
| GET | `/api/v1/lessons/{id}/quiz` | Preguntas sin respuestas | 200 | 404 |
| POST | `/api/v1/lessons/{id}/quiz/attempts` | Enviar intento | 201 | 404, 422 |
| GET | `/api/v1/lessons/{id}/quiz/attempts` | Historial de intentos (opcional post-MVP, §5.3) | 200 | 404 |
| GET | `/api/v1/progress` | Progreso completo | 200 | — |
| PUT | `/api/v1/progress/lessons/{id}` | Marcar vista/completada | 200 | 404, 422 |
| POST | `/api/v1/jobs` | Crear job (JSON) | 202 | 400, 404, 409, 413, 422, 429, 503 |
| POST | `/api/v1/jobs/upload` | Crear job (archivo .py) | 202 | 404, 409, 413, 415, 422, 429, 503 |
| GET | `/api/v1/jobs` | Listar recientes | 200 | 422 |
| GET | `/api/v1/jobs/{id}` | Detalle + resultados | 200 | 404 |
| POST | `/api/v1/jobs/{id}/cancel` | Cancelar | 202 | 404, 409 |
| GET | `/api/v1/jobs/{id}/output` | Descargar salida (text/plain) | 200 | 404, 409, 422 |
| WS | `/ws/jobs/{id}` | Stream multiplexado del job | — | close 4404 |
| GET | `/api/v1/admin/modules` | Módulos con detalle admin (§10) | 200 | 401 |
| POST | `/api/v1/admin/modules` | Crear módulo (§10) | 201 | 401, 409, 422 |
| PUT | `/api/v1/admin/modules/reorder` | Reordenar módulos por lote (§10) | 200 | 401, 404, 409, 422 |
| PUT | `/api/v1/admin/modules/{id}` | Editar módulo (§10) | 200 | 401, 404, 409, 422 |
| DELETE | `/api/v1/admin/modules/{id}` | Borrar módulo vacío (§10) | 200 | 401, 404, 409 |
| GET | `/api/v1/admin/lessons/{id}` | Lección + ejemplo (admin) (§10) | 200 | 401, 404 |
| POST | `/api/v1/admin/lessons` | Crear lección + ejemplo (§10) | 201 | 401, 404, 409, 413, 422 |
| PUT | `/api/v1/admin/lessons/reorder` | Reordenar lecciones por lote (§10) | 200 | 401, 404, 409, 422 |
| PUT | `/api/v1/admin/lessons/{id}` | Editar lección (§10) | 200 | 401, 404, 409, 422 |
| DELETE | `/api/v1/admin/lessons/{id}` | Borrar lección + ejemplo + quiz (§10) | 200 | 401, 404 |
| GET | `/api/v1/admin/lessons/{id}/quiz` | Quiz CON clave correcta (§10) | 200 | 401, 404 |
| PUT | `/api/v1/admin/lessons/{id}/quiz` | Reemplazar el quiz (§10) | 200 | 401, 404, 422 |
| DELETE | `/api/v1/admin/lessons/{id}/quiz` | Borrar el quiz (§10) | 200 | 401, 404 |
| GET | `/api/v1/admin/examples/{id}` | Ejemplo con código (admin) (§10) | 200 | 401, 404 |
| PUT | `/api/v1/admin/examples/{id}` | Editar metadatos del ejemplo (§10) | 200 | 401, 404, 422 |
| POST | `/api/v1/admin/examples/{id}/code` | Subir el `.py` del ejemplo (§10) | 200 | 401, 404, 413, 415, 422 |

---

## 10. Autoría de cursos (admin) — Fase 4

> **Estado: CONGELADO (Fase 4).** Sección aditiva: **extiende** el contrato sin
> tocar §1–§9. El contenido de cursos (módulos, lecciones, ejemplos, quizzes)
> pasa de fixtures estáticos a **SQLite** (ver `data-model.md` §7); un seeder
> idempotente lo siembra desde los fixtures versionados. Los **GET públicos de
> contenido (§3–§5) conservan su shape byte-idéntico** — solo cambia la fuente
> interna. Estos endpoints permiten a un administrador editar ese contenido.
> DTOs: `backend/app/schemas.py` §10 · `frontend/src/api/admin-types.ts`.

### 10.0 Autorización (variante de despliegue, sin login)

> **Nota 2026-07-26 — cambio de modelo.** La capa de autenticación de Fase 4
> (contraseña `EHPC_ADMIN_PASSWORD`, login/logout/session, token Bearer y
> sesiones en memoria) **se eliminó**. El modo autoría (admin) pasa a ser una
> **variante de despliegue**, no un login. Ya **no existen** los endpoints
> `POST /admin/login`, `POST /admin/logout` ni `GET /admin/session`, ni el
> esquema `Authorization: Bearer`.

- **El modo admin se enciende con la env var `EHPC_ADMIN_MODE`** (`config.py`;
  pydantic castea `"1"`/`"true"`/`"yes"` y variantes a `bool`). Es una decisión
  de despliegue:
  - **Sin la variable** → despliegue **"estudiante"** (el por defecto de los dos
    `compose.yaml`): todo `/api/v1/admin/*` responde `401 UNAUTHORIZED`.
  - **Con `EHPC_ADMIN_MODE`** → despliegue **admin**: los `/api/v1/admin/*`
    quedan habilitados **sin token**. Es seguro porque la app es **local, en
    loopback** (todos los puertos ligados a `127.0.0.1`) y el despliegue con el
    modo admin se distribuye **solo a administradores**.
- **Guard `require_admin`**: todo endpoint de contenido admin lo aplica y gatea
  **solo por `settings.admin_enabled`** (== `EHPC_ADMIN_MODE`). No parsea ningún
  header ni valida tokens. Sin `WWW-Authenticate` (no dispara el diálogo nativo
  del navegador).

No hay endpoints de autenticación. El cliente admin usa directamente los CRUD de
§10.2-§10.6; si el despliegue es "estudiante" recibe `401 UNAUTHORIZED` en todos
ellos.

> **Nota 2026-07-26 — Nivel 3 (dos imágenes desde UN codebase; seguridad por
> AUSENCIA).** El gate `EHPC_ADMIN_MODE` es de *runtime* y presupone que el
> código admin está en la imagen. A nivel de *artefacto* se añade un `ARG` de
> Docker **`EHPC_ADMIN_BUILD`** (`backend/Dockerfile`) que produce **dos
> imágenes** desde el mismo código, como el tree-shaking del frontend:
> - **`EHPC_ADMIN_BUILD=0`** (default, imagen **ESTUDIANTE**): los módulos
>   admin-only (`routers/admin.py`, `routers/admin_deps.py`,
>   `services/content_writer.py`, `services/markdown_validator.py`) **no se
>   copian** al artefacto; `main.py` detecta la ausencia (`ModuleNotFoundError`)
>   y **no registra** el router → `/api/v1/admin/*` responde **`404`** (la ruta
>   no existe), no `401`. **Cero código admin en la imagen.**
> - **`EHPC_ADMIN_BUILD=1`** (imagen **ADMIN**): los módulos están presentes y el
>   router se registra; el runtime lo sigue gateando `EHPC_ADMIN_MODE` (con el
>   modo apagado → `401`, como arriba).
>
> `repositories/content_admin.py` permanece en **ambas** imágenes: lo importa el
> módulo NO-admin `services/quiz_service.py` (§5.2, revalidación atómica del
> intento). Son helpers de repositorio inertes, sin endpoints ni orquestación de
> escritura; el residual está documentado en `README.md` §8.1.

### 10.1 Invariantes de contenido

- **`lesson_id == example_id`** (invariante de dominio de Fase 3) **se mantiene**:
  cada lección tiene exactamente un ejemplo con su mismo id. Por eso **no existen
  POST/DELETE de ejemplos independientes**: un ejemplo nace y muere con su
  lección. `POST /admin/lessons` crea, en una sola transacción, la fila de la
  lección + la del ejemplo pareado (con `source_code`); `DELETE /admin/lessons/{id}`
  borra lección + ejemplo + quiz (CASCADE) y limpia `recommended` colgantes.
- **Purga del estado del estudiante al borrar una lección** *(extensión
  deliberada — fixes de auditoría S2, BL-01)*: `DELETE /admin/lessons/{id}`
  elimina además las filas de `lesson_progress` y `quiz_attempts` de ese
  `lesson_id`, **en la misma transacción** del DELETE. Razón: esas tablas no
  tienen FK a `lessons` (schema v1); sin purga, un id reutilizado heredaría
  `completed`/`best_quiz_score` de un contenido que el estudiante nunca vio
  (irreversible por el MAX/COALESCE del upsert). Borrar una lección es por
  tanto destructivo también para el progreso/historial de quiz de esa
  lección; las filas de `jobs` (con su `lesson_id` textual) se conservan como
  telemetría histórica.
- **`module.lessons` es derivado** (no se envía en el create/update de módulo):
  la pertenencia es `lessons.module_id` y el orden intra-módulo se deriva del
  `order` global de las lecciones.
- **Efecto de toda escritura**: se valida (§10.4) → se persiste bajo `write_lock`
  → se **recarga atómicamente** el snapshot en memoria de contenido. Tras un
  `2xx`, el **siguiente** GET público (§3–§5) ya sirve el contenido nuevo; el
  estudiante ve el curso actualizado de inmediato y nunca un estado a medias.

### 10.2 Módulos

| Método | Path | Request | Data (200/201) | Errores |
|---|---|---|---|---|
| GET | `/admin/modules` | — | `{ "modules": [AdminModule…] }` | 401 |
| POST | `/admin/modules` | `AdminModuleCreate` | `AdminModule` | 401, 409 `DUPLICATE_ID`/`ORDER_CONFLICT`, 422 `CONTENT_VALIDATION_ERROR` |
| PUT | `/admin/modules/reorder` | `AdminReorderRequest` | `{ "modules": [AdminModule…] }` | 401, 404 `MODULE_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 |
| PUT | `/admin/modules/{id}` | `AdminModuleUpdate` | `AdminModule` | 401, 404 `MODULE_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 |
| DELETE | `/admin/modules/{id}` | — | `{ "deleted": true, "id": "…" }` | 401, 404, 409 `MODULE_NOT_EMPTY` |

`AdminModule` = `{ id, order, title, description, level, lessons: [AdminLessonRef…] }`,
`AdminLessonRef` = `{ id, order, title, enabled, has_quiz, quiz_question_count }`.
`AdminModuleCreate` = `AdminModuleBase` + `id`; `AdminModuleUpdate` = `AdminModuleBase`
(`id` por el path). `AdminModuleBase` = `{ order, title, description, level }`.

**Reorden por lote** *(extensión — fix de auditoría S4, BL-20)*: el `order` es
`UNIQUE` global e inmediato, así que un swap directo `A↔B` vía dos `PUT` falla
siempre en el primero con `409 ORDER_CONFLICT`. `PUT /admin/modules/reorder`
reasigna el `order` de varios módulos **en una sola transacción**:
`AdminReorderRequest` = `{ items: [{ id, order }] (≥1) }`. Se valida que cada `id`
exista (`404 MODULE_NOT_FOUND`), que no haya `id` repetido en la petición y que
el conjunto **final** de `order` (los módulos tocados + los intactos) sea único y
`> 0` (`409 ORDER_CONFLICT`); la reasignación se aplica con un *parking* temporal
para no violar el `UNIQUE` a mitad de transacción. Devuelve el listado admin
completo ya reordenado. El mismo `AdminReorderRequest` sirve para lecciones
(§10.3). *(La UI puede seguir usando el workaround de `order` libre temporal; este
endpoint lo hace innecesario.)*

### 10.3 Lecciones (unidad lección + ejemplo pareado)

| Método | Path | Request | Data | Errores |
|---|---|---|---|---|
| GET | `/admin/lessons/{id}` | — | `AdminLessonDetail` | 401, 404 `LESSON_NOT_FOUND` |
| POST | `/admin/lessons` | `AdminLessonCreate` | `AdminLessonDetail` | 401, 404 `MODULE_NOT_FOUND`, 409 `DUPLICATE_ID`/`ORDER_CONFLICT`, 413 `CODE_TOO_LARGE`, 422 |
| PUT | `/admin/lessons/reorder` | `AdminReorderRequest` | `{ "modules": [AdminModule…] }` | 401, 404 `LESSON_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 |
| PUT | `/admin/lessons/{id}` | `AdminLessonUpdate` | `AdminLessonDetail` | 401, 404, 409 `ORDER_CONFLICT`, 422 |
| DELETE | `/admin/lessons/{id}` | — | `{ "deleted": true, "id": "…" }` | 401, 404 |

`AdminLessonBase` = `{ module_id, order, title, estimated_minutes, content_markdown,
recommended: [{lesson_id,label,tag}] }`. `AdminLessonCreate` = base + `{ id, example:
AdminExampleBase, source_code }` (crea el ejemplo pareado). `AdminLessonUpdate` = base.
`AdminLessonDetail` = base + `{ id, enabled, has_quiz, quiz_question_count,
prev_lesson_id, next_lesson_id, example: AdminExample }`.

`PUT /admin/lessons/reorder` reordena lecciones por lote con la misma semántica y
el mismo `AdminReorderRequest` que los módulos (§10.2): `order` de lección es
`UNIQUE` global, cada `id` debe existir (`404 LESSON_NOT_FOUND`) y el conjunto
final de `order` debe ser único y `> 0` (`409 ORDER_CONFLICT`). Devuelve
`{ "modules": [AdminModule…] }` (el listado admin, con las lecciones ya en su
nuevo orden intra-módulo).

### 10.4 Ejemplos (solo edición) y subida de código

| Método | Path | Request | Data | Errores |
|---|---|---|---|---|
| GET | `/admin/examples/{id}` | — | `AdminExample` | 401, 404 `EXAMPLE_NOT_FOUND` |
| PUT | `/admin/examples/{id}` | `AdminExampleUpdate` | `AdminExample` | 401, 404, 422 |
| POST | `/admin/examples/{id}/code` | `multipart` (`file`) **o** JSON `AdminExampleCodeRequest` | `AdminExampleCodeResult` | 401, 404, 413 `CODE_TOO_LARGE`, 415 `INVALID_EXTENSION`, 422 `INVALID_ENCODING`/`VALIDATION_ERROR` |

`AdminExampleBase` (metadatos editables) = `{ title, filename, difficulty, teaches,
directives[], threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
self_measures, parser_id, default_timeout_s, est_run_seconds, enabled, requires_gpu,
expected_output_note, takeaways[] }`. `AdminExample` = base + `{ id, module_id, order,
source_code }`. `POST …/code` reutiliza el **mismo** validador estricto de §7.2
(filename `^[A-Za-z0-9._-]{1,80}\.py$`, ≤ 262 144 bytes leídos por chunks, decode
UTF-8) y guarda `source_code`+`filename` en la fila del ejemplo. `AdminExampleCodeResult`
= `{ example_id, filename, bytes }`.

> **Sandbox intacto**: el `.py` del admin es **no confiable** exactamente igual
> que el del estudiante; se ejecuta en el runner existente (network none,
> non-root, read-only, límites) SIN relajar nada. `prepare_code(source_code)` ya
> recibe un string, así que servirlo desde la DB es transparente. La verificación
> «probar en simulador» de la UI navega a `/simulador?ejemplo={id}` y usa el
> pipeline de jobs de §7 tal cual. *(Un `POST /admin/examples/{id}/test-run`
> dedicado queda como opcional/futuro; no forma parte de este contrato.)*

### 10.5 Quiz (por lección; el GET admin SÍ trae la clave correcta)

| Método | Path | Request | Data | Errores |
|---|---|---|---|---|
| GET | `/admin/lessons/{id}/quiz` | — | `AdminQuiz` | 401, 404 `LESSON_NOT_FOUND`/`QUIZ_NOT_FOUND` |
| PUT | `/admin/lessons/{id}/quiz` | `AdminQuizUpsert` | `AdminQuiz` | 401, 404 `LESSON_NOT_FOUND`, 422 `CONTENT_VALIDATION_ERROR` |
| DELETE | `/admin/lessons/{id}/quiz` | — | `{ "deleted": true, "id": "…" }` | 401, 404 |

`AdminQuizUpsert` = `{ pass_threshold, questions: [AdminQuizQuestion…] }` (reemplazo
**total** del set). `AdminQuizQuestion` = `{ id?, order, text, options: [{key,text}] (2-4),
correct_key, explanation }`. `AdminQuiz` = upsert + `{ lesson_id, question_count }`.
El `id` de pregunta es **opcional** *(fix de auditoría S4, BL-18)*: si el cliente lo
provee debe cumplir el patrón `^[A-Za-z0-9._-]{1,80}$`; si se **omite** (`null` o
ausente), el servidor lo **autogenera** como `{lesson_id}-q{order}` (usando el
`order` de la propia pregunta) antes de validar unicidad e insertar. El `AdminQuiz`
devuelto siempre trae los ids ya resueltos. **Este es el único endpoint que expone
`correct_key`/`explanation`** — el GET público §5.1 los sigue omitiendo.

> **Reconciliación del progreso** *(extensión deliberada — fixes de auditoría
> S2, BL-06)*: si el `PUT` cambia el **número de preguntas** o el
> **`pass_threshold`** respecto al quiz persistido — y siempre en el `DELETE`
> del quiz — el backend resetea `lesson_progress.best_quiz_score = NULL` y
> `completed = false` de esa lección **en la misma transacción**. Un reemplazo
> con igual conteo y umbral (edición cosmética de textos/explicaciones) NO
> toca el progreso; `viewed` se conserva siempre. Razón: un `best_quiz_score`
> sobre un total distinto, o un «aprobado» evaluado con otro umbral, es una
> nota imposible que ni la UI ni el estudiante pueden interpretar.

### 10.6 Reglas de validación de contenido (runtime)

Sustituyen a las invariantes fail-fast de conteo de Fase 3 (14=14=14, 60 preguntas
dejan de ser obligatorias: el contenido es mutable). Se validan **por escritura**,
fail-fast, devolviendo `422 CONTENT_VALIDATION_ERROR` con `details = [{field, reason}]`
salvo donde se indica otro código:

- **Referencial**: `lesson.module_id` existe (`404 MODULE_NOT_FOUND`);
  `recommended[].lesson_id` existe y ≠ la propia lección; borrar módulo con
  lecciones → `409 MODULE_NOT_EMPTY`.
- **Unicidad**: `id` nuevo ya usado (namespace compartido lección/ejemplo, o
  módulo) → `409 DUPLICATE_ID`; ids de pregunta duplicados o keys de opción
  duplicadas → `422`.
- **Orden**: `order` global de lección o `order` de módulo colisiona →
  `409 ORDER_CONFLICT`.
- **Contenido**: `correct_key ∈ keys(options)`; `parser_id` ∈ los 6 de §3.1;
  `filename` cumple el patrón `.py`; `source_code` `1 ≤ bytes ≤ max_code_bytes`
  (`413 CODE_TOO_LARGE`; el tope es `EHPC_MAX_CODE_BYTES`, por defecto 262144, y se
  aplica en **runtime** por igual en las vías JSON y multipart — fix de auditoría
  S4, BL-17); **markdown dentro del subset** de `frontend/src/lib/markdown.ts`
  (h1-h4, listas, código, negrita/cursiva, enlaces `http(s)`/`#`/relativos, tablas
  simples; sin HTML crudo; fences cerrados); **coherencia de hilos** (espeja §7.1):
  `threads_configurable=true ⇒ fixed_threads=null`; `threads_configurable=false ∧
  sweeps_threads=false ∧ requires_gpu=false ⇒ fixed_threads ≥ 1` (los ejemplos GPU
  no usan hilos de CPU, así que quedan exentos de esta regla — fix de auditoría S4,
  BL-11); **GPU**: `requires_gpu=true ⇒ enabled=false`.
- Rangos por DTO (pydantic): `difficulty 1..5`, `default_timeout_s ≥ 5` (sin
  cap estático: el tope es opcional y se aplica en runtime solo si
  `EHPC_MAX_TIMEOUT_S > 0`), `pass_threshold ∈ (0,1]`, `takeaways` no vacío,
  etc. → `422 VALIDATION_ERROR`.
