# Telar — Contrato de API (REST + WebSocket)

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
| 413 | `CODE_TOO_LARGE` | Código > `max_code_bytes` (`TELAR_MAX_CODE_BYTES`, por defecto 262 144; JSON o upload; nginx corta antes a 1 MB) |
| 415 | `INVALID_EXTENSION` | Upload con extensión ≠ `.py` |
| 422 | `VALIDATION_ERROR` | Falla de esquema pydantic |
| 422 | `INVALID_ENCODING` | Upload no es UTF-8 válido |
| 429 | `TOO_MANY_JOBS` | Cola interna llena (>10 jobs en `queued`) |
| 500 | `INTERNAL_ERROR` | Excepción no controlada (mensaje genérico; detalle solo en logs del servidor) |
| 503 | `DOCKER_UNAVAILABLE` | El daemon no responde a `ping()` |
| 503 | `RUNNER_IMAGE_MISSING` | La imagen `telar-runner` no existe en el daemon |
| 401 | `UNAUTHORIZED` | **(Fase 4, §10)** Endpoint `/admin/*` con el modo autoría apagado (despliegue "estudiante", sin `TELAR_ADMIN_MODE`). _Nota 2026-07-26: ya no hay login/token; el gate es de despliegue (ver §10.0)_ |
| 404 | `MODULE_NOT_FOUND` | **(Fase 4, §10)** id de módulo inexistente |
| 409 | `DUPLICATE_ID` | **(Fase 4, §10 · Fase 5, §11)** Crear contenido con un id ya usado, **o** instalar un bundle que reclama un `lesson_id`/`example_id`/id de pregunta que ya pertenece a otro módulo local |
| 409 | `ORDER_CONFLICT` | **(Fase 4, §10)** `order` de módulo colisiona con otro existente, o `order` de lección colisiona **dentro de su mismo módulo** (E2: desde Fase 5 la unicidad es por `(module_id, order)` sobre las lecciones no archivadas, ya no global) |
| 409 | `MODULE_NOT_EMPTY` | **(Fase 4, §10)** Borrar un módulo que aún tiene lecciones |
| 422 | `CONTENT_VALIDATION_ERROR` | **(Fase 4, §10 · Fase 5, §11)** Falla una regla de negocio de contenido (refs módulo↔lección, `correct_key` ∈ opciones, `parser_id` válido, markdown fuera del subset, coherencia threads/GPU, `completion_rule` coherente, `video_url` que no es de YouTube, unicidad). `details` = lista por campo |
| 404 | `REMOTE_MODULE_NOT_FOUND` | **(Fase 5, §11)** El `module_id` (o la `version` pedida) no está en el catálogo remoto |
| 404 | `MODULE_NOT_INSTALLED` | **(Fase 5, §11)** Actualizar o desinstalar un módulo sin fila en `installed_modules` |
| 409 | `MODULE_ALREADY_INSTALLED` | **(Fase 5, §11)** Instalar un módulo ya instalado (la vía es `…/update`) |
| 409 | `VERSION_CONFLICT` | **(Fase 5, §11)** `version` no monótona: publicar una `version` ≤ la ya publicada, o actualizar a una `to_version` ≤ la instalada |
| 409 | `CHECKSUM_MISMATCH` | **(Fase 5, §11)** El sha256 del bundle descargado ≠ el del índice o ≠ el `expected_checksum` del request |
| 413 | `BUNDLE_TOO_LARGE` | **(Fase 5, §11)** Bundle > `TELAR_CATALOG_MAX_BUNDLE_BYTES` |
| 422 | `BUNDLE_INVALID` | **(Fase 5, §11)** El JSON no parsea, `bundle_format` desconocido, campos extra (`extra="forbid"`), tipos o patrones de id inválidos |
| 403 | `CATALOG_CREDENTIALS_INVALID` | **(Fase 5, §11)** Publicar sin credencial de escritura utilizable: `TELAR_GCS_CREDENTIALS` vacío, archivo inexistente o ilegible, permisos más laxos que `0600`, JSON que no es clave de cuenta de servicio, o la cuenta sin permiso sobre el bucket |
| 503 | `CATALOG_DISABLED` | **(Fase 5, §11)** `TELAR_CATALOG_BUCKET` vacío: este despliegue no tiene catálogo remoto |
| 503 | `CATALOG_UNAVAILABLE` | **(Fase 5, §11)** El bucket no responde: DNS/TLS/timeout, 5xx, 429, bucket privado o inexistente, o corrupción de transporte |
| 404 | `STEP_NOT_FOUND` | **(S6, §12)** La lección no es un taller, o no tiene el paso `idx` pedido |

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

**(Enmienda aditiva 2026-09-22, CU-26.1)** `runner_image` es `true | false | null`:
`false` = se comprobó y la imagen **no existe**; `null` = **no se pudo
comprobar** (daemon caído o que no respondió a tiempo, error de permisos o de
conexión). `docker` sigue siendo booleano. Cada llamada a Docker se hace fuera
del event loop con un timeout corto (≈3 s): si el daemon no contesta, `/health`
responde igual con `docker:false, runner_image:null`. Si el cliente de Docker no
se pudo crear al arrancar, `/health` lo reintenta en cada llamada hasta
conseguirlo (CU-26.3).

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
    "runner_image": "telar-runner:0.5.1",
    "runner_image_present": true,
    "gpu_examples_enabled": false,
    "versions": { "backend": "1.0.0", "python": "3.12.3", "pyomp": "0.5.1", "api": "v1" },
    "limits": {
      "max_code_bytes": 262144,
      "max_timeout_s": 120,
      "max_concurrent_jobs": 2,
      "max_output_bytes": 262144
    },
    "catalog": {
      "enabled": true,
      "bucket": "telar-modulos",
      "mode": "anonymous",
      "last_checked_at": "2026-08-29T12:00:00.000Z"
    }
  },
  "error": null, "meta": null
}
```

- `max_threads = min(8, cores)` — techo del slider.
- **(Fase 5)** `catalog` describe el catálogo remoto de módulos (§11).
  `enabled:false` (con `bucket:null`) significa que este despliegue no tiene
  bucket configurado: el frontend **oculta** el item «Módulos disponibles» del
  rail en vez de mostrarlo roto. `mode` es `"anonymous"` en la imagen del
  estudiante (solo lectura) y `"admin"` donde hay credencial de escritura.
  `last_checked_at` es el último sondeo conocido, **nunca** un sondeo hecho
  dentro de esta petición: `/system` no puede bloquearse por la red.
- `limits.max_timeout_s` es el valor crudo de `TELAR_MAX_TIMEOUT_S`. El tope de
  timeout es **OPCIONAL**: `0` (o cualquier valor ≤ 0) significa **sin límite**
  y es el valor por defecto. El ejemplo de arriba muestra un despliegue que sí
  fija tope (`120`); con la config por defecto ese campo vale `0` y el cliente
  no debe ofrecer/imponer ningún máximo.
- Errores: `503 DOCKER_UNAVAILABLE` si el daemon no responde (el resto de
  campos se sirven igual con `runner_image_present=false` cuando sea posible).
  `runner_image_present` sigue siendo booleano: `false` también cuando la
  imagen no se pudo comprobar (el matiz `null` es solo de `/health`).

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

Contenido = los **N módulos instalados** en esta máquina (el baseline sembrado
desde fixtures, más los que el estudiante haya incorporado del catálogo remoto,
§11). Una lección tiene **0 o 1 ejemplo** (E1: `example_id` es nullable y ya
**no** coincide con el `lesson_id`) y su `order` es único **por módulo** (E2).
El progreso (mutable, en SQLite) viene **fusionado** para que el catálogo se
pinte con una sola llamada.

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
        "version": 1,
        "origin": "local",
        "update_available": null,
        "lessons": [
          {
            "id": "spmd",
            "order": 3,
            "title": "π con patrón SPMD (false sharing)",
            "example_id": "spmd",
            "has_quiz": true,
            "has_video": false,
            "quiz_question_count": 5,
            "estimated_minutes": 20,
            "enabled": true,
            "completion_rule": "quiz",
            "progress": { "viewed": true, "completed": false, "best_quiz_score": 4, "quiz_total": 5 }
          }
        ]
      }
    ],
    "summary": { "lessons_total": 14, "lessons_enabled": 13, "lessons_completed": 5,
                 "quizzes_total": 14, "questions_enabled_total": 60,
                 "modules_installed": 8, "modules_updatable": 0 }
  },
  "error": null, "meta": null
}
```

- `progress` es `{"viewed":false,"completed":false,"best_quiz_score":null,"quiz_total":n}`
  si no hay registro.
- La lección GPU (`sumaVectoresGPU`) aparece con `enabled:false`.
- **(Fase 5)** `example_id` es **nullable**: una lección conceptual no tiene
  código y no debe ofrecer affordance de ejecución — no un botón deshabilitado,
  sino ningún botón.
- **(Fase 5)** `completion_rule` ∈ `"quiz" | "viewed" | "run"` dice qué cuenta
  como completar esa lección (E4); `has_video` indica si tiene video de YouTube
  asociado, sin exponer la URL en el listado.
- **(Fase 5)** `Module` gana `version` (entero monótono), `origin`
  (`"local" | "remote"`) y `update_available` (la versión disponible en el
  bucket, o `null`). `modules."order"` **puede tener huecos**: instalar es à la
  carte, así que la UI numera por posición, no por el valor de `order`.
- **(S2 · disponibilidad)** Una lección **cuenta para el progreso** solo si
  `enabled && !archived`. Las **archivadas no aparecen** en `modules[].lessons`
  ni en ningún total de `summary` (siguen legibles por §4.2, con
  `archived:true`). `lessons_enabled` y `lessons_completed` cuentan solo las
  que cuentan; es el denominador único de la UI. `/progress` (§6.1) aplica la
  misma regla.

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
    "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "example_id": "spmd",
    "has_quiz": true,
    "quiz_question_count": 5,
    "estimated_minutes": 20,
    "enabled": true,
    "completion_rule": "quiz",
    "archived": false,
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
- **(Fase 5)** `video_url`: URL del video de **esa** lección en YouTube no
  listado, o `null`. Es **por lección**, no por módulo. El servidor la sirve ya
  normalizada (extrae el id de 11 caracteres y descarta el resto de la URL
  recibida) y el cliente reconstruye el embed sobre `youtube-nocookie.com`.
  Con `null`, el reproductor **no se monta**: no hay marco vacío ni placeholder.
  Los videos **no se descargan nunca**; el contenido transporta el enlace.
- **(Fase 5)** `example_id` nullable y `completion_rule` — ver §4.1.
  `archived: true` marca una lección que desapareció de una versión posterior de
  su módulo: sigue siendo legible y conserva su progreso, pero queda fuera de la
  ruta lineal (`prev_lesson_id`/`next_lesson_id` la saltan) — §11.6.
- **(S2)** La ruta lineal sigue la regla de disponibilidad de §4.1: también
  salta las lecciones **deshabilitadas**, y una lección que no cuenta
  (deshabilitada o archivada) tiene `prev_lesson_id` y `next_lesson_id` `null`.
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

**(S2 · aclaración)** El quiz completa la lección **solo si su
`completion_rule` es `"quiz"`** y la lección cuenta para el progreso
(`enabled && !archived`, §4.1). En cualquier otro caso `passed` se informa y
`best_quiz_score` se guarda igual, pero `completed` no cambia (§6.2).

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

**(Fase 5 · E4) `completion_rule` decide quién puede escribir `completed`:**

| `completion_rule` | Qué completa la lección | `completed:true` del cliente |
|---|---|---|
| `"quiz"` (por defecto) | Aprobar el quiz (§5.2) | **Se ignora**, y la respuesta trae el registro real |
| `"viewed"` | El estudiante la marca como leída | **Se acepta**: es la única vía |
| `"run"` | Terminar bien un job del ejemplo de la lección | **Se ignora**; lo activa el backend al finalizar el job |

**(S2 · aclaración)** Aprobar el quiz de una lección `"viewed"` o `"run"` guarda
`best_quiz_score` pero **no** la completa. `"run"` la completa un job
`completed` creado con `example_id` = el ejemplo de la lección y ese
`lesson_id` (§7.1), con `completed_via:"run"`. Ninguna vía completa una lección
deshabilitada o archivada. `completed` sigue siendo monótono.

Se **ignora**, no se responde `422`, por coherencia con la regla que este mismo
endpoint ya tiene para `best_quiz_score`/`last_job_id`: los campos que el cliente
no gobierna se descartan en silencio y la respuesta dice la verdad. El registro
resultante añade `completed_via ∈ {"quiz","manual","run"} | null`, que es lo que
permite distinguir «aprobó» de «dijo que la leyó» al actualizar el módulo (§11.6).

Una lección con `completion_rule:"quiz"` pero **sin** quiz sería incompletable:
esa combinación se rechaza al escribir contenido (`422 CONTENT_VALIDATION_ERROR`,
§10.6), no al leerlo.

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
| `code` | `1 ≤ bytes ≤ max_code_bytes` UTF-8 (tope `TELAR_MAX_CODE_BYTES`, por defecto 262144; aplicado en **runtime** en el router, por igual que `/upload` y la vía admin JSON — fix de residuos de auditoría, BL-17) → `413 CODE_TOO_LARGE` |
| `filename` | opcional (default: `filename` del ejemplo, o `main.py`); patrón `^[A-Za-z0-9._-]{1,80}\.py$` |
| `threads` | **opcional**. Si el ejemplo tiene `threads_configurable=false`, se IGNORA por completo (puede omitirse; el backend usa su valor fijo: `min(8, cores)` para sweep, `fixed_threads` para fixed) y la respuesta lleva `threads_note`. En caso contrario: entero `1..max_threads` (de `/system`), default 4 |
| `timeout_s` | opcional. **`0` = SIN TIMEOUT** (espera indefinida); cualquier otro valor debe ser `>= 5` → si no, `422 VALIDATION_ERROR`. El **máximo es opcional**: solo si `TELAR_MAX_TIMEOUT_S > 0` se rechaza `timeout_s > TELAR_MAX_TIMEOUT_S` → `422`; ese mismo tope **prohíbe `timeout_s = 0`** (un tope y una espera infinita se contradicen) → `422`. Con `TELAR_MAX_TIMEOUT_S = 0` (por defecto) no hay tope y `0` es válido. Omitirlo NO es «sin timeout»: default = `default_timeout_s` del ejemplo o 60 para código propio |
| `lesson_id` | opcional; si viene, debe existir → `404 LESSON_NOT_FOUND`; al terminar bien el job se actualiza `lesson_progress.last_job_id`. **(S2)** Con `example_id`, este debe ser el ejemplo de esa lección → si no, `422 VALIDATION_ERROR`. Si la lección es `completion_rule:"run"` y el job lleva su ejemplo, terminar en `completed` la completa (§6.2). Las pruebas desde Autoría no envían `lesson_id` |
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
- **(Enmienda aditiva 2026-09-24, CU-08.1/08.3)** `409 JOB_NOT_CANCELLABLE`
  también si el contenedor **ya salió solo** (el job está cerrando): un cancel
  tardío no reclasifica un fin natural. Y un `status` terminal solo es
  `cancelled` si el kill mató al proceso (exit 137 o desconocido); con otro
  exit code se aplica la tabla normal (`completed`/`failed`).
  `503 DOCKER_UNAVAILABLE` si el `kill()` falla: el job queda marcado para
  cancelar y repetir el POST **reintenta** el kill.

### 7.6 `GET /api/v1/jobs/{job_id}/output` — descargar stdout

Query: `stream` = `combined` (default) | `stdout` | `stderr`.

`200`: **sin envelope** — `text/plain; charset=utf-8` con
`Content-Disposition: attachment; filename="transporteMonteCarlo-01a2b3c4.txt"`.
El stem del filename procede de `jobs.filename`, que ya cumple el patrón
estricto de 7.1/7.2 (solo `[A-Za-z0-9._-]`) — imposible inyectar comillas o
CR/LF en la cabecera.
Si el output fue truncado, se añade una última línea
`\n--- [Telar] output truncado a 262144 bytes ---\n`.

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
`BAD_CLIENT_MESSAGE` (ver 8.3),
`CANCEL_FAILED` (**enmienda aditiva 2026-09-24, CU-08.3**: el `kill()` pedido
por un `cancel` falló; el job sigue marcado para cancelar y otro `cancel`
reintenta el kill).
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
  o cancelar un job terminal se ignora en silencio (repetirlo sobre un job
  vivo vuelve a pedir el kill). Si el kill falla, el servidor responde
  `error CANCEL_FAILED` (ver 8.2).
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
| POST | `/api/v1/jobs/{id}/cancel` | Cancelar | 202 | 404, 409, 503 |
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
| POST | `/api/v1/admin/lessons/{id}/example` | Crear/reemplazar el ejemplo de una lección (§10.4) | 200 | 401, 404, 409, 413, 422 |
| DELETE | `/api/v1/admin/lessons/{id}/example` | Quitar el ejemplo (la lección pasa a teórica) (§10.4) | 200 | 401, 404 |
| GET | `/api/v1/catalog/status` | Qué está instalado y qué tiene actualización (**offline-safe**) (§11.4) | 200 | — |
| POST | `/api/v1/catalog/refresh` | Comprobar el bucket y refrescar el estado (§11.4) | 200 | 422, 503 |
| GET | `/api/v1/catalog/remote` | Catálogo remoto (red o caché) (§11.5) | 200 | 422, 503 |
| GET | `/api/v1/catalog/remote/{id}` | Detalle de un módulo remoto, sin instalar (§11.5) | 200 | 404, 409, 413, 422, 503 |
| POST | `/api/v1/catalog/install` | Incorporar un módulo (§11.6) | 201 | 404, 409, 413, 422, 503 |
| GET | `/api/v1/catalog/modules/{id}/update/preview` | Diff de actualización: qué conservo, qué pierdo (§11.6) | 200 | 404, 409, 413, 422, 503 |
| POST | `/api/v1/catalog/modules/{id}/update` | Actualizar conservando el progreso (§11.6) | 200 | 404, 409, 413, 422, 503 |
| DELETE | `/api/v1/catalog/modules/{id}` | Quitar un módulo incorporado (§11.6) | 200 | 404 |
| GET | `/api/v1/admin/catalog/credentials` | Estado de la clave de la cuenta de servicio (§11.8) | 200 | 401, 503 |
| POST | `/api/v1/admin/catalog/import` | Descargar un módulo para editarlo (§11.7) | 201 | 401, 404, 409, 413, 422, 503 |
| POST | `/api/v1/admin/modules/{id}/publish` | Publicar el módulo en el bucket (§11.8) | 201/200 | 401, 403, 404, 409, 413, 422, 503 |
| GET | `/api/v1/admin/modules/{id}/publish/status` | ¿Hay cambios sin publicar? (§11.8.3, S5) | 200 | 401, 404, 422 |
| DELETE | `/api/v1/admin/modules/{id}/publish` | Retirar el módulo del catálogo (§11.8.4, S7d) | 200 | 401, 403, 404, 409, 422, 503 |
| PUT | `/api/v1/progress/lessons/{id}/steps/{idx}` | Marcar/desmarcar «Lo hice» en un paso de un taller (§12.2, S6) | 200 | 404, 422 |
| POST | `/api/v1/admin/lessons/{id}/steps` | Añadir un paso al taller (§12.3, S6) | 201 | 401, 404, 422 |
| PUT | `/api/v1/admin/lessons/{id}/steps/reorder` | Reordenar los pasos (§12.3, S6) | 200 | 401, 404, 422 |
| PUT | `/api/v1/admin/lessons/{id}/steps/{idx}` | Editar un paso (§12.3, S6) | 200 | 401, 404, 422 |
| DELETE | `/api/v1/admin/lessons/{id}/steps/{idx}` | Borrar un paso (§12.3, S6) | 200 | 401, 404 |

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
> (contraseña `TELAR_ADMIN_PASSWORD`, login/logout/session, token Bearer y
> sesiones en memoria) **se eliminó**. El modo autoría (admin) pasa a ser una
> **variante de despliegue**, no un login. Ya **no existen** los endpoints
> `POST /admin/login`, `POST /admin/logout` ni `GET /admin/session`, ni el
> esquema `Authorization: Bearer`.

- **El modo admin se enciende con la env var `TELAR_ADMIN_MODE`** (`config.py`;
  pydantic castea `"1"`/`"true"`/`"yes"` y variantes a `bool`). Es una decisión
  de despliegue:
  - **Sin la variable** → despliegue **"estudiante"** (el por defecto de los dos
    `compose.yaml`): todo `/api/v1/admin/*` responde `401 UNAUTHORIZED`.
  - **Con `TELAR_ADMIN_MODE`** → despliegue **admin**: los `/api/v1/admin/*`
    quedan habilitados **sin token**. Es seguro porque la app es **local, en
    loopback** (todos los puertos ligados a `127.0.0.1`) y el despliegue con el
    modo admin se distribuye **solo a administradores**.
- **Guard `require_admin`**: todo endpoint de contenido admin lo aplica y gatea
  **solo por `settings.admin_enabled`** (== `TELAR_ADMIN_MODE`). No parsea ningún
  header ni valida tokens. Sin `WWW-Authenticate` (no dispara el diálogo nativo
  del navegador).

No hay endpoints de autenticación. El cliente admin usa directamente los CRUD de
§10.2-§10.6; si el despliegue es "estudiante" recibe `401 UNAUTHORIZED` en todos
ellos.

> **Nota 2026-07-26 — Nivel 3 (dos imágenes desde UN codebase; seguridad por
> AUSENCIA).** El gate `TELAR_ADMIN_MODE` es de *runtime* y presupone que el
> código admin está en la imagen. A nivel de *artefacto* se añade un `ARG` de
> Docker **`TELAR_ADMIN_BUILD`** (`backend/Dockerfile`) que produce **dos
> imágenes** desde el mismo código, como el tree-shaking del frontend:
> - **`TELAR_ADMIN_BUILD=0`** (default, imagen **ESTUDIANTE**): los módulos
>   admin-only (`routers/admin.py`, `routers/admin_deps.py`,
>   `services/content_writer.py`, `services/markdown_validator.py`) **no se
>   copian** al artefacto; `main.py` detecta la ausencia (`ModuleNotFoundError`)
>   y **no registra** el router → `/api/v1/admin/*` responde **`404`** (la ruta
>   no existe), no `401`. **Cero código admin en la imagen.**
> - **`TELAR_ADMIN_BUILD=1`** (imagen **ADMIN**): los módulos están presentes y el
>   router se registra; el runtime lo sigue gateando `TELAR_ADMIN_MODE` (con el
>   modo apagado → `401`, como arriba).
>
> `repositories/content_admin.py` permanece en **ambas** imágenes: lo importa el
> módulo NO-admin `services/quiz_service.py` (§5.2, revalidación atómica del
> intento). Son helpers de repositorio inertes, sin endpoints ni orquestación de
> escritura; el residual está documentado en `README.md` §8.1.

### 10.1 Invariantes de contenido

- **`lesson_id == example_id` queda DEROGADO en Fase 5** (era invariante de
  dominio de Fase 3). Ese acoplamiento —el ejemplo compartía clave primaria con
  la lección— hacía **imposible** una lección sin código, y con ella todo el
  track conceptual («¿qué es un hilo?», «concurrencia vs paralelismo») que un
  curso de paralelismo necesita antes del primer `parallel for`. Desde Fase 5:
  - el ejemplo tiene **id propio** y una columna `lesson_id UNIQUE` nullable:
    **0 o 1 ejemplo por lección**, y un ejemplo pertenece como mucho a una;
  - `POST /admin/lessons` acepta `example: null` (lección teórica) y sigue
    creando lección + ejemplo en una sola transacción cuando se envía;
  - existen `POST /admin/lessons/{id}/example` y
    `DELETE /admin/lessons/{id}/example` para añadir o quitar el código de una
    lección ya creada, sin borrarla;
  - `DELETE /admin/lessons/{id}` sigue borrando lección + ejemplo + quiz
    (CASCADE) y limpiando `recommended` colgantes.
- **El `order` de lección es único por `(module_id, order)`**, ya no global
  (E2). La unicidad se aplica solo a las lecciones **no archivadas**: una
  lección archivada (§11.6) libera su hueco. Colisión ⇒ `409 ORDER_CONFLICT`.
  `modules."order"` **sigue** siendo único global, y por eso el instalador de
  módulos remotos reasigna el `order` cuando el sugerido ya está tomado.
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
  la pertenencia es `lessons.module_id` y el orden intra-módulo es el `order`
  de las lecciones dentro de ese módulo. La ruta lineal del curso
  (`prev_lesson_id`/`next_lesson_id`) se deriva de `(modules."order",
  lessons."order")` y **salta las lecciones archivadas**.
- **`completion_rule` decide qué completa una lección** (E4): `"quiz"` (aprobar
  el quiz, por defecto), `"viewed"` (el estudiante la marca) o `"run"` (ejecutar
  bien su ejemplo). Debe ser coherente con lo que la lección tiene: `"quiz"`
  exige quiz y `"run"` exige ejemplo, o `422 CONTENT_VALIDATION_ERROR` (§10.6).
  Sin esta regla, una lección teórica con la regla por defecto sería
  **incompletable** y bloquearía el progreso de su módulo.
- **`video_url` es opcional y por lección**: URL de YouTube no listado. Se
  valida y se **normaliza** al escribir (se extrae el id del video y se descarta
  el resto de la URL). Los videos no se almacenan ni se distribuyen: viaja el
  enlace.
- **Efecto de toda escritura**: se valida (§10.4) → se persiste bajo `write_lock`
  → se **recarga atómicamente** el snapshot en memoria de contenido. Tras un
  `2xx`, el **siguiente** GET público (§3–§5) ya sirve el contenido nuevo; el
  estudiante ve el curso actualizado de inmediato y nunca un estado a medias.

  > **Nota (S5, decisión D+ — no cambia la semántica anterior).** En una
  > instalación con autoría, lo que muestra `/aprender` es el **borrador** del
  > autor: el mismo snapshot que edita. El estudiante de otra máquina solo
  > recibe contenido por un bundle **publicado** (§11.8), así que borrador y
  > publicado ya están separados entre máquinas. Para que el autor no confunda
  > los dos, el build admin pinta en las rutas `/aprender` un aviso fijo
  > («Vista previa: estás viendo tu borrador. Los estudiantes ven la última
  > versión publicada.») y el diálogo de publicar compara el contenido local con
  > la versión vigente (§11.8.3). No hay tablas de borrador ni snapshot publicado.

### 10.2 Módulos

| Método | Path | Request | Data (200/201) | Errores |
|---|---|---|---|---|
| GET | `/admin/modules` | — | `{ "modules": [AdminModule…] }` | 401 |
| POST | `/admin/modules` | `AdminModuleCreate` | `AdminModule` | 401, 409 `DUPLICATE_ID`/`ORDER_CONFLICT`, 422 `CONTENT_VALIDATION_ERROR` |
| PUT | `/admin/modules/reorder` | `AdminReorderRequest` | `{ "modules": [AdminModule…] }` | 401, 404 `MODULE_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 |
| PUT | `/admin/modules/{id}` | `AdminModuleUpdate` | `AdminModule` | 401, 404 `MODULE_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 |
| DELETE | `/admin/modules/{id}[?cascade=true]` | — | `{ "deleted": true, "id": "…" }` | 401, 404, 409 `MODULE_NOT_EMPTY` (sin `cascade`), 422 |

**(Enmienda aditiva 2026-09-26, CU-16.1)** `DELETE /admin/modules/{id}?cascade=true`
borra el módulo **junto con todas sus lecciones** (ejemplo, quiz, progreso e
intentos de cada una, como `DELETE /admin/lessons/{id}`) en una sola
transacción: o se borra todo o nada. Sin el parámetro (o con `cascade=false`)
el comportamiento no cambia: un módulo con lecciones → `409 MODULE_NOT_EMPTY`.
Las lecciones **archivadas** no cuentan como contenido para ese 409; al borrar
el módulo se purgan igual.

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

### 10.3 Lecciones (con ejemplo opcional desde Fase 5)

| Método | Path | Request | Data | Errores |
|---|---|---|---|---|
| GET | `/admin/lessons/{id}` | — | `AdminLessonDetail` | 401, 404 `LESSON_NOT_FOUND` |
| POST | `/admin/lessons` | `AdminLessonCreate` | `AdminLessonDetail` | 401, 404 `MODULE_NOT_FOUND`, 409 `DUPLICATE_ID`/`ORDER_CONFLICT`, 413 `CODE_TOO_LARGE`, 422 |
| PUT | `/admin/lessons/reorder` | `AdminReorderRequest` | `{ "modules": [AdminModule…] }` | 401, 404 `LESSON_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 |
| PUT | `/admin/lessons/{id}` | `AdminLessonUpdate` | `AdminLessonDetail` | 401, 404, 409 `ORDER_CONFLICT`, 422 |
| DELETE | `/admin/lessons/{id}` | — | `{ "deleted": true, "id": "…" }` | 401, 404 |
| POST | `/admin/lessons/{id}/example` | `{ example: AdminExampleBase, source_code }` | `AdminExample` | 401, 404, 409 `DUPLICATE_ID`, 413 `CODE_TOO_LARGE`, 422 |
| DELETE | `/admin/lessons/{id}/example` | — | `{ "deleted": true, "lesson_id": "…" }` | 401, 404 |

`AdminLessonBase` = `{ module_id, order, title, estimated_minutes, content_markdown,
video_url, enabled, completion_rule, recommended: [{lesson_id,label,tag}] }`.
`AdminLessonCreate` = base + `{ id, example: AdminExampleBase | null, source_code:
str | null }`. `AdminLessonUpdate` = base.
`AdminLessonDetail` = base + `{ id, has_quiz, quiz_question_count, archived,
prev_lesson_id, next_lesson_id, example: AdminExample | null }`.

**Fase 5 — la lección puede no tener ejemplo.** `example` y `source_code` son
opcionales en `AdminLessonCreate`: enviarlos crea lección + ejemplo en una sola
transacción (como en Fase 4), omitirlos crea una **lección teórica**.
`AdminLessonDetail.example` es `null` en ese caso — y `GET /admin/lessons/{id}`
responde **`200`**, no `404`: la lección existe aunque no tenga código.
`enabled` deja de derivarse del ejemplo y pasa a ser un campo propio de la
lección; sin él, una lección sin ejemplo quedaría deshabilitada en silencio.

`PUT /admin/lessons/reorder` reordena lecciones por lote con la misma semántica y
el mismo `AdminReorderRequest` que los módulos (§10.2). Desde Fase 5 el `order`
de lección es único **por módulo**, así que `AdminReorderItem` gana
**`module_id: str | null`** (opcional; si falta, el servidor lo resuelve contra
el módulo actual de la lección, de modo que los payloads de Fase 4 siguen siendo
válidos). Cada `id` debe existir (`404 LESSON_NOT_FOUND`) y el conjunto final de
`(module_id, order)` debe ser único y con `order > 0` (`409 ORDER_CONFLICT`).
Enviar `module_id` mueve además la lección a ese módulo. Devuelve
`{ "modules": [AdminModule…] }`.

### 10.4 Ejemplos (id propio desde Fase 5) y subida de código

| Método | Path | Request | Data | Errores |
|---|---|---|---|---|
| GET | `/admin/examples/{id}` | — | `AdminExample` | 401, 404 `EXAMPLE_NOT_FOUND` |
| PUT | `/admin/examples/{id}` | `AdminExampleUpdate` | `AdminExample` | 401, 404, 422 |
| POST | `/admin/examples/{id}/code` | `multipart` (`file`) **o** JSON `AdminExampleCodeRequest` | `AdminExampleCodeResult` | 401, 404, 413 `CODE_TOO_LARGE`, 415 `INVALID_EXTENSION`, 422 `INVALID_ENCODING`/`VALIDATION_ERROR` |

`AdminExampleBase` (metadatos editables) = `{ title, filename, difficulty, teaches,
directives[], threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
self_measures, parser_id, default_timeout_s, est_run_seconds, enabled, requires_gpu,
expected_output_note, takeaways[] }`. `AdminExample` = base + `{ id, lesson_id, module_id, order,
source_code }`. **Fase 5**: `id` es **propio del ejemplo** y ya no coincide con
el de su lección; `lesson_id` (`str | null`) dice a qué lección pertenece, con
unicidad — una lección tiene 0 o 1 ejemplo. `module_id` y `order` se derivan de
esa lección por `JOIN`, y son `null` para un ejemplo sin lección asignada. `POST …/code` reutiliza el **mismo** validador estricto de §7.2
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
dejan de ser obligatorias: el contenido es mutable). **Desde Fase 5 se aplican
igual al contenido que llega del bucket** (§11.10): un bundle remoto es entrada
no confiable y pasa por estas mismas reglas antes de tocar la base de datos. Se validan **por escritura**,
fail-fast, devolviendo `422 CONTENT_VALIDATION_ERROR` con `details = [{field, reason}]`
salvo donde se indica otro código:

- **Referencial**: `lesson.module_id` existe (`404 MODULE_NOT_FOUND`);
  `recommended[].lesson_id` existe y ≠ la propia lección; borrar módulo con
  lecciones vivas sin `?cascade=true` → `409 MODULE_NOT_EMPTY`.
- **Unicidad**: `id` nuevo ya usado (namespace compartido lección/ejemplo, o
  módulo) → `409 DUPLICATE_ID`; ids de pregunta duplicados o keys de opción
  duplicadas → `422`.
- **Orden**: `order` de módulo (único **global**) o `order` de lección (único
  **por `(module_id, order)`** entre las lecciones no archivadas, E2) colisiona
  → `409 ORDER_CONFLICT`.
- **Completitud (E4)**: `completion_rule ∈ {"quiz","viewed","run"}`, coherente
  con lo que la lección tiene — `"quiz"` exige quiz, `"run"` exige ejemplo. Una
  lección con `"quiz"` y sin quiz sería incompletable y bloquearía el progreso
  de su módulo, así que se rechaza al escribir, no al leer.
- **Video**: `video_url` vacío o `null` ⇒ sin video. Si viene, debe ser una URL
  `https` de YouTube (`youtube.com/watch?v=`, `youtu.be/`, `/embed/`,
  `/shorts/`) con un id válido de 11 caracteres; se **normaliza** al guardarla
  (se conserva el id, se descarta el resto). Cualquier otro host o esquema →
  `422`. Los videos nunca se descargan ni se sirven desde Telar.
- **Contenido**: `correct_key ∈ keys(options)`; `parser_id` ∈ los 6 de §3.1;
  `filename` cumple el patrón `.py`; `source_code` `1 ≤ bytes ≤ max_code_bytes`
  (`413 CODE_TOO_LARGE`; el tope es `TELAR_MAX_CODE_BYTES`, por defecto 262144, y se
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
  `TELAR_MAX_TIMEOUT_S > 0`), `pass_threshold ∈ (0,1]`, `takeaways` no vacío,
  etc. → `422 VALIDATION_ERROR`.

---

## 11. Catálogo remoto de módulos publicables (Fase 5)

> **Estado: CONGELADO (Fase 5).** Sección **aditiva**:
> extiende el contrato sin romper §1–§9, pero **sí obliga a editar** §1.1, §2.2,
> §4.1, §4.2, §9 y §10 (lista exacta de ediciones en §11.12). El módulo del curso
> pasa a ser la **unidad publicable y distribuible**: un admin lo publica como un
> JSON en un bucket de Google Cloud Storage; un estudiante ve el catálogo remoto,
> **elige** qué módulos incorporar, los descarga y más tarde los actualiza **sin
> perder su progreso**.
> DTOs: `backend/app/schemas/catalog.py` + `backend/app/schemas/admin_catalog.py`
> · `frontend/src/api/catalog-types.ts` + `frontend/src/api/admin-types.ts`.

### 11.0 Principios de la sección (leer antes que cualquier endpoint)

1. **El bucket guarda SOLO contenido educativo.** Jamás progreso, identidad ni
   telemetría. **Cero PII.** Ningún endpoint de §11 envía al bucket nada
   derivado de `lesson_progress`, `quiz_attempts` o `jobs`.
2. **SQLite sigue siendo el almacén local de TODO lo local**: jobs, progreso,
   intentos de quiz y **también el contenido ya instalado**. El JSON es el
   **formato de intercambio**, no el almacén.
3. **El manifiesto de selección vive en SQLite**, tabla `installed_modules`
   (`data-model.md` §8.2), no en un archivo suelto. Qué módulos y en qué versión
   decidió instalar el estudiante.
4. **El frontend nunca habla con GCS.** Solo consume los endpoints locales de
   §11. Razones: la CSP de Electron (`electron-spec.md` §7.1) solo abre
   `youtube-nocookie.com`; `config.ts` resuelve `API_BASE` en runtime justo para
   no hornear orígenes; y la validación del contenido no confiable tiene que
   ocurrir donde vive el `write_lock` y el patrón `_persist`.
5. **Lectura anónima, escritura con cuenta de servicio.** El estudiante **no se
   loguea nunca**: el bucket concede `roles/storage.objectViewer` a `allUsers` y
   se lee sin credencial (dos GET a `storage.googleapis.com`). El **admin**
   escribe con una **cuenta de servicio** cuya clave JSON vive en
   `TELAR_GCS_CREDENTIALS` (§11.8.1).
   *Alternativa descartada — OAuth loopback con la cuenta Google del admin:* es
   viable (Authorization Code + PKCE contra `127.0.0.1`, RFC 8252) y más vistoso,
   pero con la pantalla de consentimiento en modo *Testing* la autorización —y su
   `refresh_token`— **caduca a los 7 días**, y `devstorage.read_write` es un scope
   sensible que exige verificación de Google para publicar la app. Para un
   despliegue con **un solo admin**, re-autenticarse cada semana para poder
   publicar es peor que custodiar un archivo de clave.
6. **Contenido remoto = ENTRADA NO CONFIABLE.** Se valida con el mismo rigor que
   el código del estudiante: DTOs con `extra="forbid"`, topes de tamaño **antes**
   de descargar, y las mismas reglas de §10.6 sobre el contenido del bundle.
7. **INVARIANTE CENTRAL: los `lesson_id` son ESTABLES entre versiones de un
   módulo.** El progreso se ancla en `lesson_id`. Actualizar es un **UPSERT**
   sobre los mismos ids, nunca «borrar y recrear» (eso purgaría
   `lesson_progress`/`quiz_attempts`, §10.1 BL-01). Un `lesson_id` que
   desaparece entre versiones es una **pérdida de avance anunciada** (§11.6).
8. **`/cursos` NO puede bloquearse por el bucket.** El modo offline es un caso de
   uso, no un fallo (§11.9).

**Alternativa rechazada — jobs + WebSocket para la descarga.** Los bundles están
acotados a `TELAR_CATALOG_MAX_BUNDLE_BYTES` (4 MiB por defecto): instalar es una
request **síncrona** con timeout `TELAR_CATALOG_TIMEOUT_S`. No se reutiliza la
máquina de fases de §7.7 ni el WS de §8 — eso es para ejecuciones de código, no
para descargas de texto.

### 11.1 Configuración (env vars nuevas, `config.py`)

| Var | Default | Para qué |
|---|---|---|
| `TELAR_CATALOG_BUCKET` | `""` | Nombre del bucket. **Vacío ⇒ catálogo remoto DESACTIVADO**: todo §11 responde `503 CATALOG_DISABLED` y `/system` reporta `catalog.enabled=false` |
| `TELAR_CATALOG_PREFIX` | `"modulos/"` | Prefijo de los objetos de módulo |
| `TELAR_CATALOG_INDEX` | `"modulos/index.json"` | Objeto del índice del catálogo (§11.10) |
| `TELAR_CATALOG_MAX_BUNDLE_BYTES` | `4194304` | Tope de bytes de un bundle. Se comprueba **con el `size` del listado, antes de descargar**, y otra vez sobre los bytes recibidos |
| `TELAR_CATALOG_TIMEOUT_S` | `15` | Timeout por operación contra el bucket |
| `TELAR_CATALOG_CACHE_TTL_S` | `900` | Frescura del índice cacheado; pasado el TTL, `GET /catalog/remote` sirve caché con `stale=true` |
| `TELAR_GCS_CREDENTIALS` | `""` | **Solo admin.** Ruta al archivo de clave JSON de la **cuenta de servicio** que publica. Vacío ⇒ publicar responde `403 CATALOG_CREDENTIALS_INVALID`. Se exige `0600` o más restrictivo: si el archivo es legible por otros, el arranque **avisa** y `POST …/publish` responde `403` |
| `TELAR_GCS_PROJECT_ID` | `""` | **Solo admin.** Opcional: la clave de servicio ya trae `project_id` embebido y es el valor por defecto. Solo hace falta para forzar otro proyecto |

`TELAR_CATALOG_BUCKET` y el prefijo son configuración de **despliegue**, igual que
`TELAR_ADMIN_MODE`: dos alumnos con buckets distintos son dos despliegues distintos.

### 11.2 Reparto por build (extiende §10.0, «seguridad por AUSENCIA»)

| Archivo | Imagen ESTUDIANTE (`TELAR_ADMIN_BUILD=0`) | Imagen ADMIN (`=1`) |
|---|---|---|
| `services/catalog_client.py` (`CatalogReadPort` + adaptador anónimo) | **sí** | sí |
| `services/module_installer.py` | **sí** | sí |
| `schemas/catalog.py`, `routers/catalog.py` | **sí** | sí |
| `services/catalog_publisher.py` (`CatalogWritePort`, SDK + OAuth) | **NO se copia** | sí |
| `schemas/admin_catalog.py`, `routers/admin_catalog.py` | **NO se copia** | sí |

Consecuencia idéntica a §10.0: en la imagen estudiante `/api/v1/admin/catalog/*`
y `/api/v1/admin/modules/{id}/publish` responden **`404`** (la ruta no existe), no
`401`. `google-cloud-storage` solo se instala en la imagen admin (`requirements-admin.txt`): la imagen del estudiante lee el bucket con el `httpx` que el backend ya trae, sin arrastrar `requests`/`urllib3`/`google-auth`.

**Patrón de puerto** (réplica literal de `DockerServicePort`, `services/docker_service.py:108-131`):
`typing.Protocol` con `listar(prefijo)` / `descargar(object_path, *, generation, tamano_max)`
para lectura y `publicar(object_path, cuerpo, *, content_type, metadatos, solo_si_no_existe)`
para escritura. Los tests inyectan un `FakeCatalog` en `app.state` (como
`tests/fakes/fake_docker.py`); **ningún test toca la red**.

### 11.3 Códigos de error nuevos (se añaden a §1.1)

| HTTP | `error.code` | Cuándo |
|---|---|---|
| 404 | `REMOTE_MODULE_NOT_FOUND` | El `module_id` (o la `version` pedida) no está en el catálogo remoto |
| 404 | `MODULE_NOT_INSTALLED` | Actualizar/desinstalar un módulo sin fila en `installed_modules` |
| 409 | `MODULE_ALREADY_INSTALLED` | Instalar un módulo que ya está instalado (usar `…/update`) |
| 409 | `VERSION_CONFLICT` | `version` no monótona: publicar una `version` ≤ la ya publicada (o que ya existe como objeto), o actualizar a una `to_version` ≤ `installed_version` |
| 409 | `CHECKSUM_MISMATCH` | El sha256 del bundle descargado ≠ el del índice o ≠ `expected_checksum` del request |
| 409 | `DUPLICATE_ID` | *(reusado de §10)* Un `lesson_id`/`example_id`/id de pregunta del bundle ya pertenece a **otro** módulo local |
| 413 | `BUNDLE_TOO_LARGE` | Bundle > `TELAR_CATALOG_MAX_BUNDLE_BYTES` (se detecta por `size` antes de descargar cuando el listado lo trae) |
| 422 | `BUNDLE_INVALID` | El JSON no parsea, `bundle_format` desconocido, campos extra (`extra="forbid"`), tipos o patrones de id inválidos |
| 422 | `CONTENT_VALIDATION_ERROR` | *(reusado de §10.6)* El contenido del bundle es sintácticamente válido pero rompe una regla de negocio. `details = [{field, reason}]` |
| 403 | `CATALOG_CREDENTIALS_INVALID` | Publicar sin credencial de escritura utilizable: `TELAR_GCS_CREDENTIALS` vacío, archivo inexistente o ilegible, permisos más laxos que `0600`, JSON que no es una clave de cuenta de servicio, o la cuenta no tiene permiso sobre el bucket (403 de GCS) |
| 503 | `CATALOG_DISABLED` | `TELAR_CATALOG_BUCKET` vacío: este despliegue no tiene catálogo remoto |
| 503 | `CATALOG_UNAVAILABLE` | El bucket no responde: DNS/TLS/timeout, 5xx, 429, bucket privado o inexistente, o corrupción de transporte |

**Mapa de excepciones → `CATALOG_UNAVAILABLE`** (verificado contra
`google-cloud-storage` 3.13.1). El `except` mínimo correcto **no es**
`except GoogleCloudError`:

```python
from google.api_core.exceptions import GoogleAPICallError, NotFound, RetryError
from google.auth.exceptions import GoogleAuthError      # ← imprescindible
from google.cloud.storage.exceptions import DataCorruption
from requests.exceptions import RequestException
```

| Situación real | Excepción | Se traduce a |
|---|---|---|
| Bucket u objeto inexistente | `google.api_core.exceptions.NotFound` (404) | `REMOTE_MODULE_NOT_FOUND` (objeto) / `CATALOG_UNAVAILABLE` (bucket) |
| **Bucket existe pero NO es público** | `google.auth.exceptions.InvalidOperation` («Anonymous credentials cannot be refreshed») — es `GoogleAuthError`, **no** `GoogleAPICallError` | `CATALOG_UNAVAILABLE` |
| `generation` no coincide (objeto sobreescrito a mitad) | `PreconditionFailed` (412) | `CHECKSUM_MISMATCH` |
| Checksum crc32c/md5 del transporte | `DataCorruption` | `CATALOG_UNAVAILABLE` (reintentable) |
| Rate limit | `TooManyRequests` (429) | `CATALOG_UNAVAILABLE` |
| Timeout/DNS/TLS | `RequestException`, `RetryError` | `CATALOG_UNAVAILABLE` |

`error.details` de `CATALOG_UNAVAILABLE` = `{"reason": "network"|"forbidden"|"corrupt"|"rate_limit"|"server", "retry_after_s": int|null}`.
**Nunca** el texto crudo de la excepción (mismo criterio que `jobs.error_detail`, §3 de `data-model.md`).

### 11.4 Estado del catálogo (offline-safe) — el endpoint que pinta `/cursos`

#### 11.4.1 `GET /api/v1/catalog/status` — qué está instalado y qué tiene actualización

**Lee SOLO SQLite. Nunca toca la red.** Responde `200` siempre (aunque el bucket
esté caído, aunque no haya bucket configurado).

`200`:

```json
{
  "success": true,
  "data": {
    "catalog_enabled": true,
    "bucket": "telar-modulos",
    "last_checked_at": "2026-08-29T10:12:00.000Z",
    "modules": [
      {
        "module_id": "m2",
        "title": "Patrón SPMD y false sharing",
        "origin": "remote",
        "state": "update_available",
        "installed_version": 3,
        "installed_checksum": "9f2c…",
        "available_version": 5,
        "available_checksum": "1ab7…",
        "object_path": "modulos/m2/v5.json",
        "installed_at": "2026-08-01T09:00:00.000Z",
        "updated_at": "2026-08-20T18:40:00.000Z",
        "last_checked_at": "2026-08-29T10:12:00.000Z",
        "lessons_total": 3,
        "lessons_completed": 2
      },
      {
        "module_id": "m1",
        "title": "Primeros pasos con OpenMP",
        "origin": "local",
        "state": "local_only",
        "installed_version": null,
        "installed_checksum": null,
        "available_version": null,
        "available_checksum": null,
        "object_path": null,
        "installed_at": null,
        "updated_at": null,
        "last_checked_at": null,
        "lessons_total": 2,
        "lessons_completed": 2
      }
    ],
    "summary": { "modules_total": 8, "installed": 5, "updatable": 1,
                 "local_only": 3, "never_checked": 0 }
  },
  "error": null, "meta": null
}
```

- `state` ∈ `"local_only" | "installed" | "update_available"` — derivado, **no**
  almacenado: `local_only` = módulo sin fila en `installed_modules` (baseline
  sembrado o creado por el admin); `update_available` =
  `available_version > installed_version`.
- `lessons_completed` sale de `lesson_progress` — **es local y jamás sale del
  equipo**. Existe para poder decir *«si actualizas, conservas 2/3»* (§11.6).
- Sin bucket configurado: `catalog_enabled=false`, `bucket=null`, todos los
  módulos con `state="local_only"`. **`200`, no error.**

#### 11.4.2 `POST /api/v1/catalog/refresh` — comprobar el bucket (única vía que sale a la red)

Request: `{}` (sin cuerpo). Descarga el índice (§11.10), actualiza
`available_version` / `available_checksum` / `last_checked_at` de cada fila de
`installed_modules` en **una sola transacción bajo `write_lock`**, y devuelve el
**mismo `CatalogStatusResponse`** de §11.4.1.

| Código | Cuándo |
|---|---|
| 200 | Índice descargado y estado actualizado |
| 503 `CATALOG_DISABLED` | Sin `TELAR_CATALOG_BUCKET` |
| 503 `CATALOG_UNAVAILABLE` | Bucket inalcanzable — **`installed_modules` queda INTACTA** (ni `last_checked_at` se toca) |
| 422 `BUNDLE_INVALID` | El índice no cumple el esquema de §11.10 |

**Contrato de UI**: `/aprender` llama a `GET /catalog/status` (bloqueante, siempre
funciona) y **luego**, como efecto no bloqueante, a `POST /catalog/refresh`. Si el
refresh falla, no hay chips de actualización y **no se pinta ningún `ErrorState`**.

**La relectura forzada se salta la caché de borde de Google.** `POST
/catalog/refresh` —y `GET /catalog/remote?refresh=true`— añaden a la URL un
parámetro de un solo uso (`telar_nocache=<aleatorio>`), porque cambiar la **clave
de caché** es lo único que obliga al borde a devolver el objeto vigente: ver la
medición en §11.8.2. Es defensa en profundidad y no sustituye a publicar el
índice con `no-cache`; existe porque el backend **no controla** qué metadatos
puso el admin, y la promesa de CU-38 no puede depender de que alguien se acordara
de una cabecera. La lectura **normal** no lo añade a propósito: es la que se hace
al pintar la pantalla, y aprovechar el borde es lo que mantiene el catálogo
holgadamente dentro del nivel gratuito.

### 11.5 CU-35 · Explorar el catálogo de módulos disponibles (cualquier usuario)

#### 11.5.1 `GET /api/v1/catalog/remote` — listado del bucket

Query: `refresh` (`bool`, default `false`). Con `false` sirve el índice cacheado en
SQLite si su edad < `TELAR_CATALOG_CACHE_TTL_S`; si está vencido o `refresh=true`,
va al bucket.

`200`:

```json
{
  "success": true,
  "data": {
    "bucket": "telar-modulos",
    "source": "network",
    "fetched_at": "2026-08-29T10:12:00.000Z",
    "stale": false,
    "unavailable_reason": null,
    "modules": [
      {
        "id": "m9",
        "title": "Tasks y dependencias",
        "description": "omp task, taskwait y el grafo de dependencias.",
        "level": "Avanzado",
        "order_hint": 9,
        "version": 2,
        "checksum": "1ab7c0…",
        "object_path": "modulos/m9/v2.json",
        "generation": 1755001234567890,
        "size_bytes": 48211,
        "published_at": "2026-08-22T11:00:00.000Z",
        "author_label": "Curso Telar — UN",
        "lessons_count": 4,
        "questions_count": 18,
        "estimated_minutes_total": 75,
        "requires_gpu": false,
        "state": "available",
        "installed_version": null,
        "installed_checksum": null
      }
    ]
  },
  "error": null, "meta": null
}
```

- `source` ∈ `"network" | "cache"`; `stale=true` ⇔ `source=="cache"` y la caché
  venció (o el bucket falló y se degradó a caché).
- `state` es el **cruce** con `installed_modules`: `"available"`, `"installed"`,
  `"update_available"`. Se calcula en el backend para que el frontend no
  duplique la lógica de diff en dos sitios.
- `order_hint` es el orden **sugerido** por el autor. **No es el `order` local**:
  `modules."order"` es `UNIQUE` global y dos autores pueden publicar ambos con
  `order = 3`. El instalador **reasigna** (§11.6.1).
- `meta` es `null` (listado no paginado; el catálogo se dimensiona en decenas).

| Código | Cuándo |
|---|---|
| 200 | Listado servido (de red o de caché) |
| 503 `CATALOG_DISABLED` | Sin bucket configurado |
| 503 `CATALOG_UNAVAILABLE` | Bucket inalcanzable **y sin caché previa** (si hay caché → `200` + `stale=true` + `unavailable_reason`) |
| 422 `BUNDLE_INVALID` | Índice fuera de esquema |

#### 11.5.2 `GET /api/v1/catalog/remote/{module_id}` — detalle antes de instalar

Descarga y **valida** el bundle (sin escribir nada en SQLite) para poder mostrar
qué trae el módulo. Query: `version` (`int`, opcional; default = la última del índice).

*(S5, CU-34.2)* El índice se lee **fresco** (relectura forzada de §11.4.2), no
de la caché de `TELAR_CATALOG_CACHE_TTL_S`: el detalle es el paso previo a
incorporar y no puede enseñar una versión ya sustituida ni un módulo retirado.
Sin red se degrada a la caché como el listado (§11.9).

`200` — `RemoteModuleDetail` = el summary de §11.5.1 más:

```json
{
  "lessons": [
    { "lesson_id": "task-intro", "order": 1, "title": "La directiva task",
      "estimated_minutes": 20, "has_example": true, "has_quiz": true,
      "quiz_question_count": 5, "requires_gpu": false,
      "completion_rule": "quiz", "status": "new" }
  ],
  "content_warnings": []
}
```

- `status` de la lección ∈ `"new" | "present" | "changed"` respecto a lo ya
  instalado (`"present"`/`"changed"` solo si el módulo está instalado).
- `content_warnings` = lista de `{code, message, lesson_id?}` no bloqueantes
  (p. ej. `LESSON_ID_REMOVED` si esta versión pierde una lección que hoy tienes).

| Código | Cuándo |
|---|---|
| 200 | Bundle descargado y validado (**no instalado**) |
| 404 `REMOTE_MODULE_NOT_FOUND` | id o `version` inexistentes en el bucket |
| 409 `CHECKSUM_MISMATCH` | sha256 del bundle ≠ el del índice |
| 413 `BUNDLE_TOO_LARGE` | > `TELAR_CATALOG_MAX_BUNDLE_BYTES` |
| 422 `BUNDLE_INVALID` / `CONTENT_VALIDATION_ERROR` | Esquema / reglas de §10.6 |
| 503 `CATALOG_DISABLED` / `CATALOG_UNAVAILABLE` | — |

### 11.6 CU-36 · Descargar e incorporar un módulo (estudiante) · CU-39 · Actualizar

#### 11.6.1 `POST /api/v1/catalog/install` — incorporar un módulo

Request:

```json
{ "module_id": "m9", "version": 2, "expected_checksum": "1ab7c0…" }
```

- `version` opcional (default = la última del índice). `expected_checksum`
  opcional: si viene, ancla lo que el usuario **vio** en la pantalla y cierra el
  TOCTOU (bucket reescrito entre el listado y el clic) → `409 CHECKSUM_MISMATCH`.
- Internamente la descarga usa `if_generation_match=<generation del índice>`
  cuando se conoce, que es el ancla exacta de versión del objeto.

`201`:

```json
{
  "success": true,
  "data": {
    "module_id": "m9",
    "installed_version": 2,
    "installed_checksum": "1ab7c0…",
    "object_path": "modulos/m9/v2.json",
    "local_order": 9,
    "order_reassigned": false,
    "lessons_added": ["task-intro", "task-deps", "taskloop", "task-quiz"],
    "lessons_updated": [],
    "lessons_removed": [],
    "questions_total": 18,
    "progress": { "preserved": [], "rescored": [], "archived": [] },
    "installed_at": "2026-08-29T10:15:00.000Z"
  },
  "error": null, "meta": null
}
```

**Semántica de escritura** (obligatoria, no negociable):

1. Validar **en memoria, fuera del lock**: esquema (`extra="forbid"`), checksum,
   tamaño, reglas de §10.6 sobre cada lección/ejemplo/quiz, tope
   `settings.max_code_bytes` por `source_code`.
2. `async with app.state.write_lock:` → chequeos que **leen** DB (id de módulo
   libre, `lesson_id`/`example_id` libres, ids de pregunta que no pertenezcan a
   otra lección) → `content_writer._persist(app, _write)`: **una unidad, un
   commit**, revalidación del grafo completo con `ContentRepository.load(db)`
   antes del commit, y swap atómico de `app.state.content`. Un bundle inválido
   **no deja nada a medias**.
3. Orden de inserción: `modules → lessons → examples → quiz_questions` (el mismo
   que ya resuelve el seeder). Todo por `INSERT … ON CONFLICT(id) DO UPDATE`.
4. **`modules."order"` es `UNIQUE` global**: si el `order_hint` del bundle está
   tomado, el instalador asigna `MAX("order") + 1` y responde
   `order_reassigned: true`. Nunca `IntegrityError`.
5. Se escribe la fila de `installed_modules` (manifiesto de selección) en la
   **misma** transacción.
6. **No se toca el marcador `content_seeded_at`** ni el auto-seed del lifespan.

| Código | Cuándo |
|---|---|
| 201 | Módulo instalado |
| 404 `REMOTE_MODULE_NOT_FOUND` | id/`version` no están en el bucket |
| 409 `MODULE_ALREADY_INSTALLED` | Ya hay fila en `installed_modules` → usar `…/update` |
| 409 `DUPLICATE_ID` | Un id del bundle (lección, ejemplo o pregunta) ya lo usa **otro** módulo local. `details = [{field, id, owner_module_id}]` |
| 409 `CHECKSUM_MISMATCH` | sha256 ≠ índice o ≠ `expected_checksum` |
| 413 `BUNDLE_TOO_LARGE` | — |
| 422 `BUNDLE_INVALID` / `CONTENT_VALIDATION_ERROR` | — |
| 503 `CATALOG_DISABLED` / `CATALOG_UNAVAILABLE` | — |

#### 11.6.2 `GET /api/v1/catalog/modules/{module_id}/update/preview` — «qué conservo, qué pierdo»

**Este endpoint sostiene la promesa de producto.** Descarga y valida la versión
nueva **sin escribir**, y devuelve el diff anclado en `lesson_id`. Query:
`to_version` (opcional).

`200`:

```json
{
  "success": true,
  "data": {
    "module_id": "m2",
    "from_version": 3,
    "to_version": 5,
    "to_checksum": "1ab7…",
    "lessons": [
      { "lesson_id": "spmd",         "change": "updated",   "progress": "preserved", "reason": null },
      { "lesson_id": "spmdCritical", "change": "updated",   "progress": "rescored",
        "reason": "QUIZ_CHANGED" },
      { "lesson_id": "false-sharing","change": "added",     "progress": "none",      "reason": null },
      { "lesson_id": "spmdViejo",    "change": "removed",   "progress": "archived",
        "reason": "LESSON_ID_REMOVED" }
    ],
    "progress_summary": { "preserved": 1, "rescored": 1, "archived": 1, "unaffected": 0 },
    "warnings": [
      { "code": "LESSON_ID_REMOVED", "lesson_id": "spmdViejo",
        "message": "La versión 5 ya no incluye esta lección; tu avance en ella dejará de mostrarse." }
    ]
  },
  "error": null, "meta": null
}
```

Reglas de `progress` (derivadas del mecanismo real, no inventadas):

| `progress` | Cuándo |
|---|---|
| `preserved` | El `lesson_id` sigue existiendo y el quiz mantiene **el mismo conjunto de preguntas** y su `pass_threshold`. `viewed`, `completed` y `best_quiz_score` intactos |
| `rescored` | El `lesson_id` sigue, pero **cambió el conjunto de preguntas** o el `pass_threshold`. La nota vieja deja de ser comparable: se **recalcula** desde `quiz_attempts.answers` si los ids y las opciones lo permiten, y si no se anula (`best_quiz_score = NULL`). `viewed` se conserva **siempre**, y **`completed` NUNCA baja** |
| `archived` | El `lesson_id` desaparece de la versión nueva. La lección **no se borra**: se marca `archived_at`, sigue siendo legible por URL y conserva su progreso y su historial de jobs, pero queda fuera de la ruta lineal. Si una versión futura reintroduce el id, vuelve a la ruta sin haber perdido nada |
| `none` | Lección nueva, sin progreso previo |

> **Por qué `archived` y no «huérfano»**, y por qué `rescored` y no `reset` —las
> dos correcciones que este contrato hace sobre el diseño inicial—:
>
> Con la fila de `lessons` borrada, `quiz_attempts.lesson_id` y `jobs.lesson_id`
> (que no tienen FK) quedan apuntando a un id sin título resoluble: el historial
> de ejecuciones del estudiante pasaría a decir «lección desconocida». Archivar
> es reversible a coste cero y no rompe nada aguas abajo.
>
> Y **una actualización nunca puede empeorar al estudiante**: por eso el efecto
> se llama `rescored` y no `reset`. Se recalcula la NOTA, jamás se revoca un
> aprobado ya ganado. Si actualizar pudiera quitarte lo que ya aprobaste, nadie
> actualizaría y el mecanismo entero dejaría de tener sentido. El `reset` ciego
> se conserva **solo** en la ruta admin (§10.5, BL-06), que es un acto del autor
> sobre su propia máquina, no algo que le ocurra a un estudiante por actualizar.

#### 11.6.3 `POST /api/v1/catalog/modules/{module_id}/update` — actualizar

Request:

```json
{ "to_version": 5, "expected_checksum": "1ab7…", "on_removed_lessons": "archive" }
```

- `to_version` opcional (default = `available_version`). **Debe ser `>` que
  `installed_version`** → si no, `409 VERSION_CONFLICT` (la versión es monótona;
  no hay downgrade en este contrato).
- `on_removed_lessons` ∈ `"archive"` **y nada más** en esta ruta. La lección
  retirada se marca `archived_at` y **conserva su progreso**. Mandar `"purge"`
  es `422 VALIDATION_ERROR`, no un borrado silencioso.

  Antes se admitía `"purge"`, que borraba las filas de
  `lesson_progress`/`quiz_attempts` de las lecciones desaparecidas. Se retiró de
  la ruta del estudiante porque **contradecía lo que la propia UI promete** en
  esta misma pantalla («tu progreso se conserva»), y porque dejaba dos caminos
  distintos —este y `purge_progress` de §11.6.4— para destruir lo único que el
  estudiante no puede recuperar. El motor de merge conserva la política `purge`
  internamente (`schemas/updates.OnRemovedLessons`): lo que desaparece es la
  capacidad de **pedirla desde la API del estudiante**. Borrar avance de verdad
  es del camino admin (§10.1, BL-01).

`200` — mismo shape que `InstallResult` (§11.6.1) con `lessons_updated`/
`lessons_removed` poblados y `progress` detallado.

**Cómo se actualiza (y cómo NO):** UPSERT por PK sobre los mismos `lesson_id`,
más `replace_quiz` por lección. **Prohibido** el camino «borrar lección + recrear»:
`DELETE /admin/lessons/{id}` purga `lesson_progress` y `quiz_attempts` a propósito
(§10.1, BL-01) y destruiría exactamente lo que este caso de uso debe garantizar.

| Código | Cuándo |
|---|---|
| 200 | Actualizado |
| 404 `MODULE_NOT_INSTALLED` | Sin fila en `installed_modules` |
| 404 `REMOTE_MODULE_NOT_FOUND` | La `to_version` no está en el bucket, o *(S5, CU-41.2)* el índice leído sin caché ya no anuncia el módulo o anuncia otra versión: se comprueba **antes** de descargar, y también en la vista previa (§11.6.2) |
| 409 `VERSION_CONFLICT` | `to_version ≤ installed_version` |
| 409 `CHECKSUM_MISMATCH` / `DUPLICATE_ID` | — |
| 413 `BUNDLE_TOO_LARGE` · 422 `BUNDLE_INVALID`/`CONTENT_VALIDATION_ERROR` | — |
| 503 `CATALOG_DISABLED` / `CATALOG_UNAVAILABLE` | — |

> **Efecto colateral documentado**: un intento de quiz «en vuelo» sobre una
> lección que esta actualización toca aborta con `422` (revalidación atómica de
> §5.2, `_ensure_content_current`). Es el comportamiento correcto; la UI debe
> mostrar *«el contenido se actualizó, recarga»*, no un error genérico.

#### 11.6.4 `DELETE /api/v1/catalog/modules/{module_id}` — quitar un módulo incorporado

Sin query params. **Esta ruta no borra progreso jamás.**

`200`:

```json
{ "success": true,
  "data": { "removed": true, "module_id": "m9", "lessons_removed": 4,
            "progress_purged": false, "progress_archived": 4 },
  "error": null, "meta": null }
```

El contenido se borra (CASCADE lección → ejemplo → quiz) pero **el progreso
sobrevive huérfano**: reinstalar el módulo restaura el avance, porque los
`lesson_id` son estables y `lesson_progress` no tiene FK a `lessons`. La UI ya lo
promete así: *«Quitar módulo — tu progreso se conserva»*.

`progress_purged` se mantiene en la respuesta y vale **siempre `false`**: es el
shape estable de §11.6.4 y quitarlo rompería clientes por un campo que ahora es
una constante honesta.

Antes existía `purge_progress` (`bool`, default `false`), que borraba
`lesson_progress` y `quiz_attempts`. Se retiró: dejaba que **cualquier cliente
del estudiante** destruyera el avance que esta misma pantalla promete conservar,
y que es lo único que el estudiante no puede volver a bajarse del bucket. La
purga real vive solo en el camino admin (`DELETE /admin/lessons/{id}`, §10.1
BL-01), que la hace a propósito y exige `TELAR_ADMIN_MODE`.

| Código | Cuándo |
|---|---|
| 200 | Desinstalado |
| 404 `MODULE_NOT_INSTALLED` | El módulo no está en `installed_modules` (un módulo `local_only` **no se desinstala por aquí**: eso es `DELETE /admin/modules/{id}`) |

### 11.7 CU-37 · Descargar un módulo para edición (admin)

Requiere imagen admin (§11.2) + `TELAR_ADMIN_MODE` (§10.0). **No requiere OAuth**:
leer sigue siendo anónimo.

`POST /api/v1/admin/catalog/import`

```json
{ "module_id": "m9", "version": 2, "as_module_id": null, "id_prefix": null }
```

Dos modos, y la diferencia es **el manifiesto**:

| Modo | `as_module_id` | Efecto |
|---|---|---|
| **Vinculado** (default) | `null` | Idéntico a `POST /catalog/install`, pero además el módulo queda **editable** por §10 y **conserva la fila de `installed_modules`**: el admin sabe sobre qué versión base está editando y `publish` puede exigir `version = installed_version + 1` |
| **Bifurcado (fork)** | `"m9bis"` | Se reescriben los ids: el módulo pasa a `as_module_id`, y cada `lesson_id`/`example_id`/id de pregunta se prefija con `id_prefix` (default `as_module_id + "-"`). **Sin fila en `installed_modules`** (no recibe actualizaciones), `modules.version = 1`, `checksum = NULL`, `origin = 'local'`. Es contenido nuevo que se publicará bajo su propio id |

`201`:

```json
{
  "success": true,
  "data": {
    "mode": "linked",
    "module": { "id": "m9", "order": 9, "title": "Tasks y dependencias",
                "description": "…", "level": "Avanzado",
                "version": 2, "checksum": "1ab7c0…", "origin": "remote",
                "published_at": "2026-08-22T11:00:00.000Z",
                "lessons": [ { "id": "task-intro", "order": 1, "title": "La directiva task",
                               "enabled": true, "has_example": true,
                               "has_quiz": true, "quiz_question_count": 5 } ] },
    "base_version": 2,
    "id_remap": null
  },
  "error": null, "meta": null
}
```

Con `mode: "forked"`, `id_remap` = `{ "task-intro": "m9bis-task-intro", … }`,
para que la UI admin pueda mostrar exactamente qué se renombró.

| Código | Cuándo |
|---|---|
| 201 | Importado |
| 401 `UNAUTHORIZED` | Modo admin apagado (imagen estudiante → `404`) |
| 404 `REMOTE_MODULE_NOT_FOUND` · 409 `MODULE_ALREADY_INSTALLED`/`DUPLICATE_ID`/`CHECKSUM_MISMATCH` | — |
| 413 `BUNDLE_TOO_LARGE` · 422 `BUNDLE_INVALID`/`CONTENT_VALIDATION_ERROR` | — |
| 503 `CATALOG_DISABLED` / `CATALOG_UNAVAILABLE` | — |

### 11.8 CU-38 · Publicar un módulo (admin)

#### 11.8.1 Credencial de escritura del admin

La escritura usa una **cuenta de servicio** de Google Cloud. Su clave JSON vive
en la ruta que indique `TELAR_GCS_CREDENTIALS` y **nunca** en SQLite, en el
bucket ni en el repositorio.

- Rol mínimo sobre el bucket: **`roles/storage.objectCreator`** si los bundles
  son inmutables y el índice se reescribe con CAS por `generation`
  (§11.8.2); **`roles/storage.objectAdmin`** si se quiere poder sobreescribir.
  `roles/storage.admin` añade gestionar políticas IAM: no hace falta.
- Se exige que el archivo tenga permisos `0600` o más restrictivos. Si es
  legible por otros usuarios, el arranque lo registra como aviso y
  `POST …/publish` responde `403 CATALOG_CREDENTIALS_INVALID`: una clave de
  servicio legible por todo el sistema no es una credencial.
- La clave trae `project_id` embebido; `TELAR_GCS_PROJECT_ID` solo sirve para
  forzar otro proyecto.
- **Rotación:** basta con sustituir el archivo. No hay estado en la aplicación,
  no hay token que caduque y no hay flujo interactivo que relanzar — que es
  justamente lo que se compra renunciando a OAuth (§11.0, principio 5).

| Método | Path | Request | Data (200) | Errores |
|---|---|---|---|---|
| GET | `/api/v1/admin/catalog/credentials` | — | `AdminCatalogCredentialStatus` | 401, 503 `CATALOG_DISABLED` |

Es **solo de lectura**: comprueba la credencial configurada y no la modifica.
No escribe en el bucket; verifica que la clave parsea, que los permisos del
archivo son correctos y (si `probe=true` en query) que la cuenta puede listar el
prefijo del catálogo.

`AdminCatalogCredentialStatus`:

```json
{ "configured": true, "usable": true,
  "client_email": "telar-publisher@telar-tesis.iam.gserviceaccount.com",
  "project_id": "telar-tesis", "bucket": "telar-modulos",
  "file_mode": "0600", "probed": true, "reason": null }
```

`reason` ∈ `null | "absent" | "unreadable" | "insecure_mode" | "malformed" | "forbidden"`
— nunca el texto crudo de la excepción (mismo criterio que `jobs.error_detail`).

#### 11.8.2 `POST /api/v1/admin/modules/{module_id}/publish`

Request:

```json
{ "version": 3, "dry_run": false, "notes": "Añade la lección de taskloop" }
```

- `version` opcional; default = `modules.version + 1`. Debe ser **estrictamente
  mayor** que la última publicada, o `409 VERSION_CONFLICT`.
- `dry_run: true` → **no escribe en el bucket**: valida, serializa, calcula el
  checksum y devuelve el mismo cuerpo con `published=false`. Es la vía para ver
  los avisos de ids antes de publicar.

`201` (o `200` con `dry_run`):

```json
{
  "success": true,
  "data": {
    "published": true,
    "module_id": "m9",
    "version": 3,
    "checksum": "7d3e1f…",
    "object_path": "modulos/m9/v3.json",
    "generation": 1755009999999999,
    "bytes": 51204,
    "published_at": "2026-08-29T12:00:00.000Z",
    "index_updated": true,
    "lesson_ids": ["task-intro", "task-deps", "taskloop"],
    "warnings": [
      { "code": "LESSON_ID_REMOVED", "lesson_id": "task-viejo",
        "message": "La v2 publicada incluía esta lección; quien actualice perderá su avance en ella." }
    ]
  },
  "error": null, "meta": null
}
```

**Renombrado de ids de ejemplo al publicar.** Lecciones y ejemplos comparten
espacio de nombres (§10.6), pero el contenido histórico del repo tiene
`examples.id == lessons.id` — es lo que dejó el backfill de la migración 5. Un
bundle con esa colisión lo rechaza `bundle_guard` en la máquina del estudiante,
así que sin tratarla **ninguno de los 8 módulos del baseline sería publicable**.

El publicador la resuelve al construir el bundle: si el id de un ejemplo choca
con el de alguna lección del propio bundle, se publica como `<lesson_id>-ej` y se
emite un `EXAMPLE_ID_RENAMED` por cada caso. El renombrado afecta **solo al
bundle publicado**; la base local no se toca. Consecuencia que el admin debe
conocer, y por eso es un aviso y no un silencio: reimportar (§11.7) un módulo
propio traerá el id derivado, no el original.

Mecánica de escritura en el bucket (fijada por la investigación, no libre):

1. Serialización **canónica**: `json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")`, con `payload` = el bundle **sin** el campo `checksum`. `checksum` = `sha256(bytes).hexdigest()` (64 hex). El mismo algoritmo lo reejecuta el instalador: es la definición del invariante.
2. `blob.content_type = "application/json"`,
   `metadata = {"telar-module-id", "telar-version", "telar-sha256"}`. Los metadatos
   del blob son **un índice barato, no la fuente de verdad**: `version` y `checksum`
   viven **dentro** del JSON, que es lo que se valida y lo que se persiste en SQLite.

   **`cache_control` no es libre y no es el mismo para los dos tipos de objeto.**
   Un bundle `modulos/<id>/v<n>.json` es **inmutable** por el punto 3, así que se
   publica con `public, max-age=31536000, immutable`: cachearlo es correcto y
   además ahorra operaciones Clase B del nivel gratuito. El índice **muta** en
   cada publicación (punto 4) y se publica con `no-cache, max-age=0,
   must-revalidate`.

   Omitirlo **no** es una opción neutra: GCS sirve los objetos públicos con
   `Cache-Control: public, max-age=3600` por defecto, y la caché de borde de
   Google entrega esa copia **aunque el objeto ya se haya reescrito**. Medido
   contra el bucket real el 2026-08-30: publicada la v2, la API JSON seguía
   devolviendo el índice v1 con `age=227` y la generación anterior. Con el
   default, el aviso de «hay versión nueva» de §11.6.2 (CU-38) tarda **hasta una
   hora** en llegarle al estudiante. Mandar `Cache-Control: no-cache` en la
   *petición* no lo evita: se probó y el borde siguió entregando la copia vieja;
   lo único que cambia la respuesta es cambiar la **clave de caché**, o sea la
   URL — que es lo que hace la relectura forzada de §11.4.2.
3. Subida con **`if_generation_match=0`** («crear solo si no existe»): una versión
   publicada es **inmutable**. Si el objeto ya existe → `PreconditionFailed` →
   `409 VERSION_CONFLICT`.
4. El índice (`TELAR_CATALOG_INDEX`) sí muta: se reescribe con
   **`if_generation_match=<generation leída>`** (compare-and-swap optimista). Si
   falla el CAS, se reintenta una vez releyendo; a la segunda → `409 VERSION_CONFLICT`
   con `details.stage="index"` (el objeto del módulo **ya está publicado**;
   `index_updated=false`).
5. Tras el `201`, `modules.version`, `modules.checksum` y `modules.published_at`
   se actualizan localmente bajo `write_lock`.

| Código | Cuándo |
|---|---|
| 201 / 200 (`dry_run`) | Publicado / validado |
| 401 `UNAUTHORIZED` | Modo admin apagado (imagen estudiante → `404`) |
| 403 `CATALOG_CREDENTIALS_INVALID` | Credencial de escritura ausente, ilegible, con permisos laxos, malformada o sin permiso sobre el bucket |
| 404 `MODULE_NOT_FOUND` | — |
| 409 `VERSION_CONFLICT` | `version` ≤ la publicada, o el objeto ya existe **con otro contenido** (S5: con el mismo, ver abajo) |
| 413 `BUNDLE_TOO_LARGE` | El bundle serializado supera el tope |
| 422 `CONTENT_VALIDATION_ERROR` · 422 `BUNDLE_INVALID` | El bundle construido no pasa lo que exige el importador (**no se publica contenido roto**; ver abajo) |
| 503 `CATALOG_DISABLED` · 503 `CATALOG_UNAVAILABLE` | — |

**Códigos de `warnings`** (no bloquean; el admin decide):
`EXAMPLE_ID_RENAMED` (el ejemplo tenía el id de su propia lección y se publica
con `<lesson_id>-ej`; ver abajo),
`LESSON_ID_REMOVED` (un id publicado desaparece → pérdida de avance aguas abajo),
`LESSON_ID_ADDED`, `QUIZ_SHAPE_CHANGED` (cambia nº de preguntas o `pass_threshold`
→ reset de nota aguas abajo), `ORDER_HINT_TAKEN` (el `order` chocará en muchos
destinos), `GPU_LESSON_INCLUDED`.

**Enmiendas S5 (aditivas; el checksum y su algoritmo NO cambian — los clientes
ya publicados lo verifican al instalar):**

- **Validación del importador (CU-37.1).** Antes de subir, **y también con
  `dry_run`**, el bundle construido pasa por `bundle_guard.parse_bundle` sobre
  los bytes que se subirían y por las reglas que el guard deja fuera
  (coherencia threads/GPU, tope de código, umbrales, ids de pregunta). Es la
  misma pareja que corre al actualizar, así que lo publicado es instalable.
  Cada entrada de `error.details` que señala una lección lleva además
  `lesson_id` (`{field, reason, lesson_id?}`).
- **Orden renumerado.** `lessons[].order` del bundle es `1..n` en el orden
  local; los huecos locales (lecciones borradas o archivadas) no se copian.
- **Reintento idempotente (CU-37.3).** Si el objeto `v<n>.json` ya existe y su
  contenido (`content_hash`, §11.8.3) es el local, no es conflicto: es la misma
  publicación a medias, y se completa el índice y el estado local con el objeto
  que ya está en el bucket (su `checksum` y su `published_at`). `generation`
  vale `null` en ese caso.
- **Desfase local (CU-37.4).** Si el índice anuncia una versión mayor que la
  registrada en local y con el contenido local, publicar no sube nada: reescribe
  esa entrada y la registra. Si el contenido difiere, la siguiente versión se
  cuenta desde la del índice.
- **`local_state_updated`** (`bool`, default `true`) en la respuesta: `false`
  si el bucket quedó publicado pero falló el paso 5. Se responde `201` igual (la
  versión ya es inmutable); reintentar reconcilia sin crear otra versión.
- **Manifiesto del autor (S7d, §2.3 #15).** Si el módulo publicado tiene fila
  en `installed_modules` (import vinculado, §11.7), el paso 5 la alinea en la
  misma transacción: `installed_*` y `available_*` pasan a la versión y el
  checksum recién publicados y `locally_modified` vuelve a `false`. Sin eso el
  autor se vería a sí mismo con «actualización disponible». Sin fila no se crea
  ninguna.
- **`locally_modified` (S7d, §2.3 #14).** Toda escritura de §10 sobre un módulo
  con fila en `installed_modules` (el módulo, sus lecciones —también la que sale
  o entra al moverla—, sus ejemplos y sus quizzes) la pone a `true`. El
  reorden de lecciones solo marca las que de verdad cambian de `(módulo, order)`;
  el de módulos no marca, porque su `order` es local y no viaja en el bundle. Actualizar
  sobre él sigue sin bloquear: `POST …/update` lo aplica y deja el aviso
  `MODULE_LOCALLY_MODIFIED` en el informe.

#### 11.8.3 `GET /api/v1/admin/modules/{module_id}/publish/status` — ¿hay cambios sin publicar? *(S5, D+)*

Compara la huella del contenido local con la de la versión **vigente** del
índice, leído sin caché. No escribe nada.

`content_hash` = `sha256` del JSON canónico de §11.8.2 (paso 1) del bundle
**sin** `checksum` **ni** los metadatos de la publicación
`module.published_at`, `module.version` y `module.notes`. No es el checksum: no
se publica ni se guarda en el índice (que no admite campos nuevos,
`extra="forbid"`). La huella de la versión vigente se cachea en memoria por
`(id, version, checksum)` —un bundle publicado es inmutable—.

`200` — `AdminPublishStatus`:

```json
{ "module_id": "m1", "state": "changed", "published_version": 2,
  "local_version": 2, "content_hash": "9c1e…", "reason": null }
```

| `state` | Significado |
|---|---|
| `never_published` | El índice no tiene el módulo |
| `unchanged` | Mismo contenido que la vigente y registrada en local ⇒ nada que publicar |
| `changed` | Hay cambios sin publicar |
| `out_of_sync` | Mismo contenido que la vigente, pero el estado local no la registró (publicar reconcilia) |
| `unknown` | No se pudo leer el catálogo; `reason` = `"disabled"` o el `reason` de §11.3. **No impide publicar** |

| Código | Cuándo |
|---|---|
| 200 | Siempre que el módulo exista (también sin red: `unknown`) |
| 401 `UNAUTHORIZED` | Modo admin apagado (imagen estudiante → `404`) |
| 404 `MODULE_NOT_FOUND` | — |
| 422 `CONTENT_VALIDATION_ERROR` | El módulo no tiene lecciones publicables |

#### 11.8.4 `DELETE /api/v1/admin/modules/{module_id}/publish` — retirar del catálogo *(S7d, CU-41.1)*

«Curso» = el módulo publicable (§3.10 del informe de evaluación). Retirar
**quita la entrada del índice** con el mismo CAS de §11.8.2 paso 4 (un
reintento). **No borra ningún bundle**: las versiones siguen siendo inmutables
y quien ya incorporó el módulo lo conserva, marcado «Ya no publicado» por
`GET /catalog/status`/`remote` como cualquier módulo que sale del índice.

Exige la misma credencial de escritura que publicar (§11.8.1) y que el módulo
exista en local. **No escribe nada local**: si el bucket falla, todo queda
como estaba; si va bien, `modules.version`/`published_at` se conservan, así
que republicar después sale con la versión siguiente (nunca reutiliza un
número ya subido) y `GET …/publish/status` responde `never_published`.

Sin cuerpo. `200` — `AdminUnpublishResult`:

```json
{ "module_id": "m1", "retired_version": 3 }
```

| Código | Cuándo |
|---|---|
| 200 | Entrada quitada del índice |
| 401 `UNAUTHORIZED` | Modo admin apagado (imagen estudiante → `404`) |
| 403 `CATALOG_CREDENTIALS_INVALID` | Sin credencial de escritura utilizable, o sin permiso sobre el bucket |
| 404 `MODULE_NOT_FOUND` | El módulo no existe en local |
| 404 `REMOTE_MODULE_NOT_FOUND` | El índice no anuncia el módulo |
| 409 `VERSION_CONFLICT` | El CAS falló dos veces (`details.stage = "index"`); nada cambió, reintentar |
| 422 `CONTENT_VALIDATION_ERROR` | El índice del bucket es ilegible: no se sobrescribe |
| 503 `CATALOG_DISABLED` · 503 `CATALOG_UNAVAILABLE` | — |

### 11.9 Sin red: qué sigue funcionando (requisito de escritorio)

La app de escritorio **debe seguir siendo plenamente usable con lo ya instalado**.
Regla estructural: **ningún endpoint de §3–§8 toca el bucket, jamás.** Todo el
contenido se sirve desde SQLite igual que en Fase 4.

| Endpoint | Sin red |
|---|---|
| `GET /health`, `GET /api/v1/system` | **200.** `catalog.reachable` no se sondea aquí (sería un bloqueo en el arranque): se reporta `null` o el último valor conocido |
| §3, §4, §5, §6, §7, §8 (ejemplos, módulos, lecciones, quizzes, progreso, jobs, WS) | **Idénticos.** Cero dependencia del bucket |
| `GET /api/v1/catalog/status` | **200 siempre** — lee solo SQLite. `last_checked_at` queda viejo; `state` sigue siendo el último conocido |
| `POST /api/v1/catalog/refresh` | **503 `CATALOG_UNAVAILABLE`**; `installed_modules` **intacta** |
| `GET /api/v1/catalog/remote` | **200 + `source:"cache"` + `stale:true` + `unavailable_reason`** si hay índice cacheado; **503 `CATALOG_UNAVAILABLE`** si nunca se cacheó |
| `GET /api/v1/catalog/remote/{id}` | **503 `CATALOG_UNAVAILABLE`** (requiere descargar el bundle) |
| `POST /catalog/install`, `…/update`, `…/update/preview` | **503 `CATALOG_UNAVAILABLE`**. Ninguna escritura parcial: la validación previa al `write_lock` ni siquiera llega a abrirlo |
| `DELETE /catalog/modules/{id}` | **200.** Desinstalar es 100 % local |
| `POST /admin/catalog/import`, `POST /admin/modules/{id}/publish` | **503 `CATALOG_UNAVAILABLE`** |
| `GET /admin/modules/{id}/publish/status` (S5) | **200** con `state="unknown"`: no poder comprobar no impide publicar |
| `DELETE /admin/modules/{id}/publish` (S7d) | **503 `CATALOG_UNAVAILABLE`**; nada local cambia |
| `GET /admin/catalog/credentials` | **200.** Comprobar la credencial es local (parseo del JSON y permisos del archivo); solo `?probe=true` sale a la red y entonces devuelve `usable:false, reason:"forbidden"` |
| §10 completo (autoría admin local) | **Idéntico.** Crear/editar módulos, lecciones y quizzes es 100 % local |

**Contrato de UI derivado**: la pantalla `/modulos` (catálogo remoto) es la
**única** que puede mostrar `ErrorState` por falta de red, y con `onRetry`. En
`/cursos`, un bucket caído solo significa *no hay chips de actualización*.

### 11.10 Formato de intercambio (lo que vive en el bucket)

Layout: `modulos/<module_id>/v<version>.json` (bundle, **inmutable**) +
`modulos/index.json` (índice, **mutable** por CAS).

> **S6 (§12.5):** un bundle con talleres lleva `lessons[].kind`/`steps` y se
> publica como `bundle_format: 2`; sin talleres sigue siendo `1`, byte a byte
> igual. El checksum (§11.8.2) y el índice no cambian.

**Índice** (`CatalogIndex`, `index_format: 1`):

```json
{
  "index_format": 1,
  "generated_at": "2026-08-29T12:00:00.000Z",
  "modules": [
    { "id": "m9", "title": "Tasks y dependencias", "description": "…",
      "level": "Avanzado", "order_hint": 9, "version": 3,
      "checksum": "7d3e1f…", "object_path": "modulos/m9/v3.json",
      "size_bytes": 51204, "published_at": "2026-08-29T12:00:00.000Z",
      "author_label": "Curso Telar — UN",
      "lessons_count": 3, "questions_count": 14,
      "estimated_minutes_total": 60, "requires_gpu": false }
  ]
}
```

El índice es una **conveniencia** (permite listar sin bajar cada módulo); la
verdad es el bundle, y el `checksum` del índice se **verifica** contra el sha256
del bundle descargado (`409 CHECKSUM_MISMATCH` si no cuadra).

**Bundle** (`ModuleBundle`, `bundle_format: 1`):

```json
{
  "bundle_format": 1,
  "checksum": "7d3e1f…",
  "module": {
    "id": "m9", "order_hint": 9, "title": "Tasks y dependencias",
    "description": "…", "level": "Avanzado",
    "version": 3, "published_at": "2026-08-29T12:00:00.000Z",
    "author_label": "Curso Telar — UN", "notes": "Añade taskloop"
  },
  "lessons": [
    {
      "id": "taskloop", "order": 3, "title": "taskloop",
      "estimated_minutes": 25, "content_markdown": "# taskloop\n…",
      "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "enabled": true, "completion_rule": "quiz", "pass_threshold": 0.6,
      "recommended": [ { "lesson_id": "task-deps", "label": "Dependencias", "tag": "Práctica" } ],
      "example": {
        "id": "taskloopDemo", "filename": "taskloop.py", "title": "taskloop sobre un for",
        "difficulty": 3, "teaches": "…", "directives": ["taskloop"],
        "threads_configurable": true, "fixed_threads": null, "fixed_threads_note": null,
        "sweeps_threads": false, "self_measures": false, "parser_id": "none",
        "default_timeout_s": 30, "est_run_seconds": 8, "enabled": true,
        "requires_gpu": false, "expected_output_note": "…",
        "takeaways": ["…"], "source_code": "from numba import njit\n…"
      },
      "quiz": {
        "pass_threshold": 0.6,
        "questions": [
          { "id": "taskloop-q1", "order": 1, "text": "…",
            "options": [ {"key":"a","text":"…"}, {"key":"b","text":"…"} ],
            "correct_key": "a", "explanation": "…" }
        ]
      }
    }
  ]
}
```

Reglas del formato (todas verificadas en la validación, entrada no confiable):

- `checksum` se calcula sobre el bundle **sin** ese campo, con la serialización
  canónica de §11.8.2. Es el único algoritmo aceptado.
- `example` y `quiz` son **`null`-ables** (E1 y E4: una lección teórica no
  necesita código ni quiz). `example.id` es **propio**, ya **no** igual al
  `lesson_id`.
- `video_url` es **opcional** (`null` = la lección no tiene video) y **por
  lección**, no por módulo: los guiones de `docs/plan-clases-fundamentos.md`
  están escritos como un video de 3-5 min por concepto. Solo se aceptan URLs de
  YouTube (`youtube.com/watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`) sobre
  `https`; el servidor **extrae el id de 11 caracteres y descarta el resto de la
  URL**, y el frontend reconstruye el embed canónico sobre
  `youtube-nocookie.com` (`resolveYouTubeEmbed`). Los videos **no se descargan
  nunca**: el bundle transporta el enlace, no el medio. Cualquier otra cosa
  ⇒ `422 CONTENT_VALIDATION_ERROR`.
- `completion_rule` ∈ `"quiz" | "viewed" | "run"` (E4). Con `quiz` requiere
  `quiz != null`; con `run` requiere `example != null`. Se rechaza lo contrario
  (`422 CONTENT_VALIDATION_ERROR`).
- `lessons[].order` es **único dentro del bundle** y contiguo `1..n` (E2: el
  `order` es por módulo, ya no global).
- El bundle **no lleva `order` local ni progreso**: `order_hint` es una sugerencia
  y el instalador puede reasignarlo. **Cero PII, por construcción del esquema**:
  ningún campo del bundle puede transportar identidad ni avance.
- Todos los DTOs de bundle usan `model_config = ConfigDict(extra="forbid")`.

### 11.11 DTOs

#### 11.11.1 pydantic — `backend/app/schemas/catalog.py` (ambas imágenes)

```python
"""DTOs pydantic (v2) del contrato de API de Telar — §11 Catálogo remoto (Fase 5).

TRANSCRIPCIÓN LITERAL de docs/architecture/api-contract.md §11.
Los DTOs de BUNDLE validan ENTRADA NO CONFIABLE: extra="forbid" y topes en todo.
Espejo TS: frontend/src/api/catalog-types.ts.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .admin import (
    ID_PATTERN, QUESTION_ID_PATTERN, AdminExampleBase,
    AdminQuizQuestion, AdminRecommended,
)

BUNDLE_FORMAT = 1
INDEX_FORMAT = 1
#: sha256 en hex, 64 chars.
CHECKSUM_PATTERN = r"^[0-9a-f]{64}$"
#: ruta de objeto en el bucket.
OBJECT_PATH_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$"

CompletionRule = Literal["quiz", "viewed", "run"]          # E4
ModuleOrigin = Literal["local", "remote"]
RemoteState = Literal["available", "installed", "update_available"]
InstalledState = Literal["local_only", "installed", "update_available"]
CatalogSource = Literal["network", "cache"]
ProgressEffect = Literal["preserved", "rescored", "archived", "none"]
LessonChange = Literal["added", "updated", "unchanged", "removed"]


# ── §11.10 Formato de intercambio (ENTRADA NO CONFIABLE) ─────────────────────

class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BundleExample(_Strict, AdminExampleBase):
    """Ejemplo del bundle. E1: id PROPIO, ya no == lesson_id."""

    id: str = Field(pattern=ID_PATTERN)
    source_code: str = Field(min_length=1)                 # tope en runtime


class BundleQuizQuestion(_Strict, AdminQuizQuestion):
    """Idéntico a §10.5; ``id`` opcional (se autogenera ``{lesson_id}-q{order}``)."""


class BundleQuiz(_Strict):
    pass_threshold: float = Field(gt=0.0, le=1.0)
    questions: list[BundleQuizQuestion] = Field(min_length=1, max_length=50)


class BundleLesson(_Strict):
    id: str = Field(pattern=ID_PATTERN)
    order: int = Field(ge=1)                               # E2: único POR MÓDULO
    title: str = Field(min_length=1, max_length=160)
    estimated_minutes: int = Field(ge=1, le=600)
    content_markdown: str = Field(min_length=1, max_length=65536)
    video_url: str | None = Field(default=None, max_length=2048)  # YouTube, por lección
    enabled: bool = True                                   # E1: columna propia
    completion_rule: CompletionRule = "quiz"               # E4
    pass_threshold: float = Field(default=0.6, gt=0.0, le=1.0)
    recommended: list[AdminRecommended] = Field(default_factory=list, max_length=6)
    example: BundleExample | None = None                   # E1: opcional
    quiz: BundleQuiz | None = None


class BundleModule(_Strict):
    id: str = Field(pattern=ID_PATTERN)
    order_hint: int = Field(ge=1)                          # sugerencia, no el order local
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=2000)
    level: str = Field(min_length=1, max_length=40)
    version: int = Field(ge=1)                             # MONÓTONA
    published_at: str
    author_label: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2000)


class ModuleBundle(_Strict):
    """§11.10 — el JSON publicado. ``checksum`` NO entra en su propio cálculo."""

    bundle_format: Literal[1]
    checksum: str = Field(pattern=CHECKSUM_PATTERN)
    module: BundleModule
    lessons: list[BundleLesson] = Field(min_length=1, max_length=100)


class CatalogIndexEntry(_Strict):
    id: str = Field(pattern=ID_PATTERN)
    title: str
    description: str = ""
    level: str = ""
    order_hint: int = Field(ge=1)
    version: int = Field(ge=1)
    checksum: str = Field(pattern=CHECKSUM_PATTERN)
    object_path: str = Field(pattern=OBJECT_PATH_PATTERN)
    size_bytes: int = Field(ge=1)
    published_at: str
    author_label: str = ""
    lessons_count: int = Field(ge=0)
    questions_count: int = Field(ge=0)
    estimated_minutes_total: int = Field(ge=0)
    requires_gpu: bool = False


class CatalogIndex(_Strict):
    index_format: Literal[1]
    generated_at: str
    modules: list[CatalogIndexEntry] = Field(max_length=500)


# ── §11.5 CU-35 Explorar ─────────────────────────────────────────────────────

class RemoteModuleSummary(BaseModel):
    id: str
    title: str
    description: str
    level: str
    order_hint: int
    version: int
    checksum: str
    object_path: str
    generation: int | None            # ancla exacta del objeto (if_generation_match)
    size_bytes: int
    published_at: str
    author_label: str
    lessons_count: int
    questions_count: int
    estimated_minutes_total: int
    requires_gpu: bool
    state: RemoteState                # cruce con installed_modules
    installed_version: int | None
    installed_checksum: str | None


class RemoteCatalogResponse(BaseModel):
    """§11.5.1 ``GET /api/v1/catalog/remote``."""

    bucket: str | None
    source: CatalogSource
    fetched_at: str | None
    stale: bool
    unavailable_reason: str | None    # 'network'|'forbidden'|'corrupt'|… | None
    modules: list[RemoteModuleSummary]


class RemoteLessonPreview(BaseModel):
    lesson_id: str
    order: int
    title: str
    estimated_minutes: int
    has_example: bool
    has_quiz: bool
    quiz_question_count: int
    requires_gpu: bool
    completion_rule: CompletionRule
    status: Literal["new", "present", "changed"]


class ContentWarning(BaseModel):
    code: str
    message: str
    lesson_id: str | None = None


class RemoteModuleDetail(RemoteModuleSummary):
    """§11.5.2 ``GET /api/v1/catalog/remote/{module_id}`` — preview sin instalar."""

    lessons: list[RemoteLessonPreview]
    content_warnings: list[ContentWarning]


# ── §11.4 Estado del catálogo (offline-safe) ─────────────────────────────────

class InstalledModuleStatus(BaseModel):
    module_id: str
    title: str
    origin: ModuleOrigin
    state: InstalledState
    installed_version: int | None
    installed_checksum: str | None
    available_version: int | None
    available_checksum: str | None
    object_path: str | None
    installed_at: str | None
    updated_at: str | None
    last_checked_at: str | None
    lessons_total: int
    lessons_completed: int             # LOCAL; nunca sale del equipo


class CatalogStatusSummary(BaseModel):
    modules_total: int
    installed: int
    updatable: int
    local_only: int
    never_checked: int


class CatalogStatusResponse(BaseModel):
    """§11.4.1 ``GET /catalog/status`` y §11.4.2 ``POST /catalog/refresh``."""

    catalog_enabled: bool
    bucket: str | None
    last_checked_at: str | None
    modules: list[InstalledModuleStatus]
    summary: CatalogStatusSummary


# ── §11.6 CU-36 / CU-39 Instalar y actualizar ────────────────────────────────

class InstallRequest(BaseModel):
    module_id: str = Field(pattern=ID_PATTERN)
    version: int | None = Field(default=None, ge=1)
    expected_checksum: str | None = Field(default=None, pattern=CHECKSUM_PATTERN)


class UpdateRequest(BaseModel):
    to_version: int | None = Field(default=None, ge=1)
    expected_checksum: str | None = Field(default=None, pattern=CHECKSUM_PATTERN)
    on_removed_lessons: Literal["archive"] = "archive"


class LessonDiffEntry(BaseModel):
    lesson_id: str
    title: str | None = None   # legible; el id no le dice nada al estudiante
    change: LessonChange
    progress: ProgressEffect
    reason: str | None                 # 'QUIZ_CHANGED' | 'LESSON_ID_REMOVED' | None


class ProgressEffectSummary(BaseModel):
    preserved: int
    rescored: int
    archived: int
    unaffected: int


class ModuleUpdatePreview(BaseModel):
    """§11.6.2 — «qué conservo, qué pierdo» ANTES de escribir nada."""

    module_id: str
    from_version: int
    to_version: int
    to_checksum: str
    lessons: list[LessonDiffEntry]
    progress_summary: ProgressEffectSummary
    warnings: list[ContentWarning]


class InstallResult(BaseModel):
    """§11.6.1 (201) y §11.6.3 (200)."""

    module_id: str
    installed_version: int
    installed_checksum: str
    object_path: str
    local_order: int
    order_reassigned: bool             # order_hint colisionaba (UNIQUE global)
    lessons_added: list[str]
    lessons_updated: list[str]
    lessons_removed: list[str]
    questions_total: int
    progress: ProgressEffectSummary
    installed_at: str


class UninstallResult(BaseModel):
    """§11.6.4 ``DELETE /catalog/modules/{module_id}``."""

    removed: bool
    module_id: str
    lessons_removed: int
    progress_purged: bool
    progress_archived: int
```

#### 11.11.2 pydantic — `backend/app/schemas/admin_catalog.py` (SOLO imagen admin)

```python
"""§11.7/§11.8 — importar y publicar. ADMIN-ONLY: este archivo NO se copia a la
imagen estudiante (TELAR_ADMIN_BUILD=0). Espejo TS: api/admin-types.ts."""

from typing import Literal

from pydantic import BaseModel, Field

from .admin import ID_PATTERN, AdminModule
from .catalog import CHECKSUM_PATTERN, OBJECT_PATH_PATTERN, ContentWarning


class AdminCatalogCredentialStatus(BaseModel):
    """§11.8.1 — estado de la clave de la cuenta de servicio. SOLO LECTURA."""

    configured: bool                      # TELAR_GCS_CREDENTIALS no vacío
    usable: bool                          # parsea, permisos ok y (si probed) autoriza
    client_email: str | None              # de la clave; identifica a la cuenta
    project_id: str | None
    bucket: str | None
    file_mode: str | None                 # p.ej. "0600"; None si no se pudo leer
    probed: bool                          # ¿se contactó el bucket? (query ?probe=true)
    reason: (
        Literal["absent", "unreadable", "insecure_mode", "malformed", "forbidden"] | None
    )                                     # NUNCA el texto crudo de la excepción


class AdminImportRequest(BaseModel):
    module_id: str = Field(pattern=ID_PATTERN)
    version: int | None = Field(default=None, ge=1)
    as_module_id: str | None = Field(default=None, pattern=ID_PATTERN)  # fork
    id_prefix: str | None = Field(default=None, max_length=32)


class AdminImportResult(BaseModel):
    mode: Literal["linked", "forked"]
    module: AdminModule                 # §10.2 (ya con version/checksum/origin)
    base_version: int | None            # None en fork
    id_remap: dict[str, str] | None     # None en linked


class AdminPublishRequest(BaseModel):
    version: int | None = Field(default=None, ge=1)   # default: modules.version + 1
    dry_run: bool = False
    notes: str = Field(default="", max_length=2000)


class AdminPublishResult(BaseModel):
    published: bool                     # False con dry_run
    module_id: str
    version: int
    checksum: str = Field(pattern=CHECKSUM_PATTERN)
    object_path: str = Field(pattern=OBJECT_PATH_PATTERN)
    generation: int | None
    bytes: int
    published_at: str
    index_updated: bool
    lesson_ids: list[str]
    warnings: list[ContentWarning]
    local_state_updated: bool = True    # S5 (CU-37.4)

# S5 (D+) §11.8.3
PublishState = Literal["never_published", "unchanged", "changed", "out_of_sync", "unknown"]

class AdminPublishStatus(BaseModel):
    module_id: str
    state: PublishState
    published_version: int | None = None
    local_version: int | None = None
    content_hash: str = Field(pattern=CHECKSUM_PATTERN)
    reason: str | None = None

# S7d §11.8.4
class AdminUnpublishResult(BaseModel):
    module_id: str
    retired_version: int                # la versión que el índice dejó de anunciar
```

#### 11.11.3 TypeScript — `frontend/src/api/catalog-types.ts` (nuevo)

```ts
// api/catalog-types.ts — DTOs de §11 Catálogo remoto (Fase 5).
// TRANSCRIPCIÓN LITERAL de docs/architecture/api-contract.md §11 (snake_case).
// Espejo de backend/app/schemas/catalog.py. Los tipos de LECTURA de contenido
// (ModuleDto, LessonDetailDto…) siguen en types.ts y NO se duplican aquí.

export type CompletionRule = 'quiz' | 'viewed' | 'run'
export type ModuleOrigin = 'local' | 'remote'
export type RemoteState = 'available' | 'installed' | 'update_available'
export type InstalledState = 'local_only' | 'installed' | 'update_available'
export type CatalogSource = 'network' | 'cache'
export type ProgressEffect = 'preserved' | 'rescored' | 'archived' | 'none'
export type LessonChange = 'added' | 'updated' | 'unchanged' | 'removed'

export interface ContentWarningDto {
  code: string
  message: string
  lesson_id: string | null
}

/** §11.5.1 GET /api/v1/catalog/remote */
export interface RemoteModuleSummaryDto {
  id: string
  title: string
  description: string
  level: string
  order_hint: number
  version: number
  checksum: string
  object_path: string
  generation: number | null
  size_bytes: number
  published_at: string
  author_label: string
  lessons_count: number
  questions_count: number
  estimated_minutes_total: number
  requires_gpu: boolean
  state: RemoteState
  installed_version: number | null
  installed_checksum: string | null
}

export interface RemoteCatalogResponseDto {
  bucket: string | null
  source: CatalogSource
  fetched_at: string | null
  stale: boolean
  unavailable_reason: string | null
  modules: RemoteModuleSummaryDto[]
}

/** §11.5.2 GET /api/v1/catalog/remote/{module_id} */
export interface RemoteLessonPreviewDto {
  lesson_id: string
  order: number
  title: string
  estimated_minutes: number
  has_example: boolean
  has_quiz: boolean
  quiz_question_count: number
  requires_gpu: boolean
  completion_rule: CompletionRule
  status: 'new' | 'present' | 'changed'
}

export interface RemoteModuleDetailDto extends RemoteModuleSummaryDto {
  lessons: RemoteLessonPreviewDto[]
  content_warnings: ContentWarningDto[]
}

/** §11.4 Estado del catálogo — OFFLINE-SAFE, solo SQLite. */
export interface InstalledModuleStatusDto {
  module_id: string
  title: string
  origin: ModuleOrigin
  state: InstalledState
  installed_version: number | null
  installed_checksum: string | null
  available_version: number | null
  available_checksum: string | null
  object_path: string | null
  installed_at: string | null
  updated_at: string | null
  last_checked_at: string | null
  lessons_total: number
  lessons_completed: number
}

export interface CatalogStatusSummaryDto {
  modules_total: number
  installed: number
  updatable: number
  local_only: number
  never_checked: number
}

export interface CatalogStatusResponseDto {
  catalog_enabled: boolean
  bucket: string | null
  last_checked_at: string | null
  modules: InstalledModuleStatusDto[]
  summary: CatalogStatusSummaryDto
}

/** §11.6 Instalar / actualizar / desinstalar. */
export interface InstallRequestDto {
  module_id: string
  version?: number | null
  expected_checksum?: string | null
}

export interface UpdateRequestDto {
  to_version?: number | null
  expected_checksum?: string | null
  on_removed_lessons?: 'archive'
}

export interface LessonDiffEntryDto {
  lesson_id: string
  /** Título legible. La vista previa existe para que el estudiante ENTIENDA
   *  qué cambia, y un id como `f1Concurrencia` no comunica nada. */
  title: string | null
  change: LessonChange
  progress: ProgressEffect
  reason: string | null
}

export interface ProgressEffectSummaryDto {
  preserved: number
  rescored: number
  archived: number
  unaffected: number
}

export interface ModuleUpdatePreviewDto {
  module_id: string
  from_version: number
  to_version: number
  to_checksum: string
  lessons: LessonDiffEntryDto[]
  progress_summary: ProgressEffectSummaryDto
  warnings: ContentWarningDto[]
}

export interface InstallResultDto {
  module_id: string
  installed_version: number
  installed_checksum: string
  object_path: string
  local_order: number
  order_reassigned: boolean
  lessons_added: string[]
  lessons_updated: string[]
  lessons_removed: string[]
  questions_total: number
  progress: ProgressEffectSummaryDto
  installed_at: string
}

export interface UninstallResultDto {
  removed: boolean
  module_id: string
  lessons_removed: number
  progress_purged: boolean
  progress_archived: number
}
```

#### 11.11.4 TypeScript — añadidos a `frontend/src/api/admin-types.ts`

```ts
// ── §11.7/§11.8 Catálogo remoto (admin). Tree-shaken por ADMIN_BUILD. ───────
import type { ContentWarningDto } from './catalog-types'

export interface AdminCatalogCredentialStatusDto {
  configured: boolean
  usable: boolean
  client_email: string | null
  project_id: string | null
  bucket: string | null
  file_mode: string | null
  probed: boolean
  reason: 'absent' | 'unreadable' | 'insecure_mode' | 'malformed' | 'forbidden' | null
}

export interface AdminImportRequestDto {
  module_id: string
  version?: number | null
  as_module_id?: string | null
  id_prefix?: string | null
}

export interface AdminImportResultDto {
  mode: 'linked' | 'forked'
  module: AdminModuleDto
  base_version: number | null
  id_remap: Record<string, string> | null
}

export interface AdminPublishRequestDto {
  version?: number | null
  dry_run?: boolean
  notes?: string
}

export interface AdminPublishResultDto {
  published: boolean
  module_id: string
  version: number
  checksum: string
  object_path: string
  generation: number | null
  bytes: number
  published_at: string
  index_updated: boolean
  lesson_ids: string[]
  warnings: ContentWarningDto[]
  /** S5 (CU-37.4): `false` ⇒ publicado en la nube, sin constancia local. */
  local_state_updated: boolean
}

// S5 (D+) §11.8.3
export type PublishState =
  | 'never_published'
  | 'unchanged'
  | 'changed'
  | 'out_of_sync'
  | 'unknown'

export interface AdminPublishStatusDto {
  module_id: string
  state: PublishState
  published_version: number | null
  local_version: number | null
  content_hash: string
  reason: string | null
}

// S7d §11.8.4
export interface AdminUnpublishResultDto {
  module_id: string
  retired_version: number
}
```

Y la unión **cerrada** `ApiErrorCode` de `api/types.ts` gana:

```ts
  // §11 Catálogo remoto — Fase 5
  | 'REMOTE_MODULE_NOT_FOUND'
  | 'MODULE_NOT_INSTALLED'
  | 'MODULE_ALREADY_INSTALLED'
  | 'VERSION_CONFLICT'
  | 'CHECKSUM_MISMATCH'
  | 'BUNDLE_TOO_LARGE'
  | 'BUNDLE_INVALID'
  | 'CATALOG_CREDENTIALS_INVALID'
  | 'CATALOG_DISABLED'
  | 'CATALOG_UNAVAILABLE'
```

### 11.12 Ediciones exigidas a los contratos congelados (spec ANTES que código)

#### A · `docs/architecture/api-contract.md`

| Sección | Edición exacta |
|---|---|
| **§1.1** (tabla de códigos, ~L46-70) | Añadir las **12 filas** de §11.3, marcadas `**(Fase 5, §11)**` igual que las de Fase 4. Ampliar la fila `409 DUPLICATE_ID` para incluir «o un id que el bundle instalado reclama y ya pertenece a otro módulo» |
| **§2.2** `GET /api/v1/system` (~L91) | Añadir al `data` el bloque `"catalog": { "enabled": true, "bucket": "telar-modulos", "mode": "anonymous"\|"admin", "last_checked_at": "…Z"\|null }`. Sirve para que el frontend **oculte** el item «Módulos disponibles» del Sidebar cuando no hay bucket. Espejo en `SystemInfoDto` (`types.ts`) y `schemas/system.py` |
| **§4 encabezado** (L214-218) | Reescribir: deja de ser «8 módulos, 14 lecciones, 1 lección por ejemplo, `lesson_id == example_id`». Pasa a «N módulos instalados; una lección tiene **0 o 1** ejemplo (E1) y su `order` es único **por módulo** (E2)» |
| **§4.1** `GET /modules` (L220-260) | `ModuleLesson.example_id: str` → **`str \| null`**; añadir `completion_rule` y `has_video: bool` a la lección. `Module` gana `version: int`, `origin: "local"\|"remote"`, `update_available: int \| null` (la versión disponible, o `null`). `ModulesSummary` gana `modules_installed`, `modules_updatable`. Añadir nota: «el `order` del módulo puede tener huecos (instalación à la carte); la UI numera por posición» |
| **§4.2** `GET /lessons/{id}` (L261-300) | `example_id: str` → **`str \| null`**; añadir `completion_rule: "quiz"\|"viewed"\|"run"` y **`video_url: str \| null`** (URL de YouTube no listado de ESA lección, ya normalizada por el servidor; `null` ⇒ la lección no tiene video y el reproductor **no se monta**). Nota: «sin ejemplo no hay affordance de ejecución; no es un botón deshabilitado» |
| **§6.2** `PUT /progress/lessons/{id}` (L435-450) | **E4**: `completed=true` enviado por el cliente es legítimo **solo** si `completion_rule != "quiz"`. Con `"quiz"` el backend **lo ignora** y responde el registro real —**decidido así**, no `422`, por coherencia con la regla que §6.2 ya tiene («`best_quiz_score` y `last_job_id` no son escribibles: cualquier valor extra del body se ignora»)—. Con `"run"` el backend lo activa al terminar bien un job del ejemplo de la lección |
| **§9** tabla congelada (L923-962) | Añadir las **13 filas** de §11.13 |
| **§10.1** invariantes (L1021-1046) | **Derogar** el bullet «`lesson_id == example_id` se mantiene». Sustituir por: el ejemplo tiene id propio y `lesson_id UNIQUE` (0..1 por lección); existen `POST`/`DELETE /admin/lessons/{id}/example`; el `order` de lección es único **por módulo** |
| **§10.2** (L1047-1074) | `AdminModule` gana `version`, `checksum`, `origin`, `published_at`. Documentar que `modules."order"` **sigue** siendo `UNIQUE` global y que por eso el instalador reasigna |
| **§10.3** (L1075-1097) | `AdminLessonCreate.example` y `.source_code` → **opcionales** (`None` ⇒ lección teórica); `AdminLessonDetail.example` → `AdminExample \| None`; `AdminLessonBase` gana `enabled` y `completion_rule`. `AdminReorderItem` gana **`module_id: str | None = None`** (resuelto en servidor contra el módulo actual de la lección cuando falta) — **decidido así** en vez de una ruta nueva, precisamente para que el payload de `tests/test_audit_s4.py::test_bl20_reorder_lecciones_swap` siga validando |
| **§10.4** (L1098-1122) | `AdminExample` gana `id` propio + `lesson_id: str \| null`. Añadir `POST /admin/lessons/{id}/example` y `DELETE /admin/lessons/{id}/example` |
| **§10.6** (L1151-1180) | Regla «Orden»: `order` de lección único **por `(module_id, order)`** → `409 ORDER_CONFLICT`. Añadir la regla E4 (`completion_rule` coherente con `quiz`/`example`) y la referencia a §11.10 (mismas reglas sobre bundles) |
| **§11 (nueva)** | Esta sección |

#### B · `docs/architecture/data-model.md`

| Sección | Edición exacta |
|---|---|
| **§3 DDL** (L83-213) | Añadir el bloque `-- migration 5` completo (transcripción literal de `schema.sql`): reconstrucción de `lessons` (E2 `UNIQUE (module_id,"order")`, `enabled` como **columna propia**, `completion_rule`) y de `examples` (E1: `id` propio + `lesson_id TEXT UNIQUE REFERENCES lessons(id) ON DELETE CASCADE`), con el procedimiento `PRAGMA foreign_keys=OFF` → tabla `*_m5` → `INSERT…SELECT` → `DROP` → `RENAME` → recrear índices → `ON` (mismo patrón que la migración 4). Más `ALTER TABLE modules ADD COLUMN version/checksum/origin/published_at` y la tabla `installed_modules` |
| **§3.1** documentos JSON (L214-241) | Añadir el esquema del **bundle** y del **índice** (§11.10), marcados como **formato de intercambio, no almacén** |
| **§5** interfaces del repositorio (L402-555) | `Lesson.example_id: str` → **`str \| None`**; `Lesson.enabled` deja de derivarse de `examples.enabled`; `Lesson` gana `completion_rule`; `Example` gana `lesson_id: str \| None` y su `order`/`module_id` salen de un `JOIN … ON l.id = e.lesson_id`. El orden de la ruta lineal pasa a `(modules."order", lessons."order")`. Sustituir las constantes `EXPECTED_LESSON_COUNT=14` / `EXPECTED_ENABLED_QUESTIONS=60` como invariante del **sistema** por invariantes **por módulo** (≥1 lección, `(module_id, order)` único y contiguo, ids estables); mantenerlas exportadas y aplicables solo al **baseline** de fixtures |
| **§7.2** (L593-625) | Reescribir los bullets de `lessons` y `examples`: ya no `"order" UNIQUE [global]` ni `examples(id PK FK→lessons)`. En «campos derivados NO se almacenan», **quitar** `Lesson.example_id (==id)` y `enabled (de examples.enabled)` |
| **§7.4** (L649-661) | Añadir que el instalador de bundles usa el **mismo** `content_writer._persist` (una unidad, un commit, revalidación del grafo, swap atómico) y **nunca** `content_state.reload_content` (que hace el swap **sin commit**) |
| **§8 (nueva) — «Módulos publicables (Fase 5)»** | §8.1 Principio: el bucket guarda solo contenido; SQLite es el almacén de todo lo local. §8.2 DDL de `installed_modules` (manifiesto de selección, `module_id PK REFERENCES modules(id) ON DELETE CASCADE`, `object_path`, `installed_version/checksum`, `available_version/checksum`, `last_checked_at`, `installed_at`, `updated_at`) + caché del índice remoto. §8.3 **Por qué el progreso sobrevive**: `lesson_progress` y `quiz_attempts` **no tienen FK a `lessons`** — es la propiedad que hace viable «actualizar sin perder progreso»; **prohibido añadir esa FK**. §8.4 Instalación/actualización: UPSERT por PK, orden `modules → lessons → examples → quiz_questions`, reasignación de `modules."order"`, detección de colisión de ids de pregunta entre módulos. §8.5 **Cero PII**: enumerar qué campos salen al bucket y por qué ninguno puede transportar identidad ni avance |

#### C · Orden de trabajo (minimiza el daño a los 205 tests del backend)

1. Editar `api-contract.md` (§1.1, §2.2, §4, §6.2, §9, §10, §11) y `data-model.md`
   (§3, §3.1, §5, §7, §8). **Spec antes que código.**
2. Bloque `-- migration 5` en `backend/app/schema.sql` + test de backfill
   (`examples.lesson_id = id`, `lessons.enabled` heredado, `completion_rule`
   derivado de si hay preguntas). *Un error de sintaxis aquí tumba las 205
   pruebas de golpe: la migración corre también sobre la DB `:memory:` de todos
   los tests.*
3. `ContentRepository.load` (JOIN por `lesson_id`, `ORDER BY` compuesto, `enabled`
   propio), con `test_seed_no_data_loss` como red: si el round-trip
   fixtures↔DB sigue byte-idéntico, el 80 % del suite está a salvo. **No
   renumerar `app/content/catalog.json`**: sus orders 1..14 siguen siendo válidos
   bajo `UNIQUE(module_id,"order")` y producen la misma secuencia.
4. `content_admin` + `content_writer` (order por módulo, reorder, lección sin
   ejemplo, `_lesson_refs` con `LEFT JOIN`, `--prune` del seeder filtrando por
   `example_ids` y no por `lesson_ids`).
5. Schemas/routers de §4/§10 (`example_id` nullable, `completion_rule`).
6. `CatalogReadPort` + `FakeCatalog` + `module_installer` sobre `_persist`; luego
   `catalog_publisher` (admin-only).

### 11.13 Filas nuevas para la tabla congelada de §9

| Método | Path | Propósito | OK | Errores |
|---|---|---|---|---|
| GET | `/api/v1/catalog/status` | Qué está instalado y qué tiene actualización (**offline-safe**) (§11.4) | 200 | — |
| POST | `/api/v1/catalog/refresh` | Comprobar el bucket y refrescar el estado (§11.4) | 200 | 422, 503 |
| GET | `/api/v1/catalog/remote` | Catálogo remoto (red o caché) (§11.5) | 200 | 422, 503 |
| GET | `/api/v1/catalog/remote/{id}` | Detalle de un módulo remoto, sin instalar (§11.5) | 200 | 404, 409, 413, 422, 503 |
| POST | `/api/v1/catalog/install` | Incorporar un módulo (§11.6) | 201 | 404, 409, 413, 422, 503 |
| GET | `/api/v1/catalog/modules/{id}/update/preview` | Diff de actualización: qué conservo, qué pierdo (§11.6) | 200 | 404, 409, 413, 422, 503 |
| POST | `/api/v1/catalog/modules/{id}/update` | Actualizar conservando el progreso (§11.6) | 200 | 404, 409, 413, 422, 503 |
| DELETE | `/api/v1/catalog/modules/{id}` | Quitar un módulo incorporado (§11.6) | 200 | 404 |
| GET | `/api/v1/admin/catalog/credentials` | Estado de la clave de la cuenta de servicio (§11.8) | 200 | 401, 503 |
| POST | `/api/v1/admin/catalog/import` | Descargar un módulo para editarlo (§11.7) | 201 | 401, 404, 409, 413, 422, 503 |
| POST | `/api/v1/admin/modules/{id}/publish` | Publicar el módulo en el bucket (§11.8) | 201/200 | 401, 403, 404, 409, 413, 422, 503 |
| GET | `/api/v1/admin/modules/{id}/publish/status` | ¿Hay cambios sin publicar? (§11.8.3, S5) | 200 | 401, 404, 422 |
| DELETE | `/api/v1/admin/modules/{id}/publish` | Retirar el módulo del catálogo (§11.8.4, S7d) | 200 | 401, 403, 404, 409, 422, 503 |

---

## 12. Talleres guiados (S6 · CU-28) — enmienda ADITIVA

Un **taller** es otro *tipo de lección* (`kind = "taller"`), no un componente que
se suma a una lección: una guía de pasos ordenados, estilo Unity Learn. Cada paso
tiene título, instrucciones en Markdown (mismo subset que la lección, §10.6) y,
opcionalmente, un ejemplo con «Abrir en el simulador». Cada paso tiene su casilla
«Lo hice»; al marcar todos, el taller queda completado. **No lleva quiz ni
video.** Diseño: informe de mejoras 2026-09-22 §3.2. DDL: data-model §9.

Todo es aditivo: los campos nuevos tienen valor por defecto y un cliente que no
los conoce sigue funcionando (ve un taller como una lección `viewed` sin quiz).

### 12.1 Lectura (§4)

- `ModuleLesson.kind` y `LessonDetail.kind`: `"leccion" | "taller"`,
  **opcional**, por defecto `"leccion"`.
- `LessonDetail.steps`: lista (vacía si no es taller) en orden de `idx`
  (`0..n-1`, contiguo):

```jsonc
"steps": [
  { "idx": 0, "title": "Lee el código", "body_markdown": "Abre el ejemplo…",
    "example_id": "primerEjemplo", "done": true },
  { "idx": 1, "title": "Piensa", "body_markdown": "¿Cuántos hilos ves?",
    "example_id": null, "done": false }
]
```

`example_id` con valor ⇒ el paso ofrece «Abrir en el simulador» (taller **con**
código); `null` ⇒ solo lectura y acción (taller **sin** código). Un
`example_id` cuyo ejemplo ya no existe llega como `null` (se poda en el snapshot,
como `recommended`).

**`completion_rule` en un taller se ignora**: el servidor guarda `"viewed"` (el
único valor que no exige quiz ni ejemplo) y la respuesta lo refleja, pero lo
único que completa un taller son sus pasos. En particular, `PUT
/progress/lessons/{id}` (§6.2) **ignora** `completed:true` en un taller (sí
acepta `viewed`).

### 12.2 `PUT /api/v1/progress/lessons/{lesson_id}/steps/{idx}` — la casilla

```jsonc
// request
{ "done": true }            // booleano estricto: "sí"/1 ⇒ 422 VALIDATION_ERROR
// 200 → data
{ "lesson_id": "tallerHilos", "idx": 1, "done": true,
  "steps_done": 2, "steps_total": 3, "completed": false }
```

- **Idempotente**: marcar lo marcado o desmarcar lo desmarcado no cambia nada
  (el `done_at` de la primera marca se conserva).
- **Completar**: cuando todos los pasos quedan marcados
  (`taller_completo`, función pura), se escribe `lesson_progress.completed = 1`
  con `completed_via = "manual"`. El taller cuenta en el progreso del módulo como
  cualquier lección; los agregados (§4.1, §6.1) no cambian de fórmula.
- **Monótono**: desmarcar un paso quita la casilla pero **no descompleta** el
  taller (`completed` sigue `true`), igual que un aprobado de quiz no se revoca.
- **Disponibilidad** (la misma regla única de §6.2): un taller deshabilitado o
  archivado **guarda** la casilla —es lo que hizo el estudiante— pero **no se
  completa**. Se evalúa contra la DB dentro del lock de escritura.
- **Marcar = tocar**: toda casilla deja `viewed = true`. Así, si una versión
  nueva del módulo retira el taller, se archiva con sus casillas en vez de
  borrarse (§11.6.2).
- Errores: `404 LESSON_NOT_FOUND`; `404 STEP_NOT_FOUND` si la lección no es un
  taller o no tiene ese `idx`; `422 VALIDATION_ERROR` si el body no es válido.
- **Pasos vigentes**: la lista de pasos se relee de la DB dentro del lock (como
  el quiz): si el autor añadió, borró o reordenó pasos mientras la petición
  esperaba, se decide con la lista actual (`steps_total` la refleja) y un `idx`
  retirado da `404 STEP_NOT_FOUND` sin dejar casilla.

### 12.3 Autoría (§10)

- `AdminLessonBase.kind`: `"leccion" | "taller"`, por defecto `"leccion"` (en
  `POST`/`PUT /admin/lessons` y en el `GET`). Con `kind="taller"`:
  `completion_rule` se guarda como `"viewed"` pida lo que pida el cliente; un
  `video_url` no nulo ⇒ `422 CONTENT_VALIDATION_ERROR` (`field: "video_url"`); y
  convertir en taller una lección **con quiz** ⇒ 422 (`field: "kind"`: borra el
  quiz antes). `PUT /admin/lessons/{id}/quiz` sobre un taller ⇒ 422
  (`field: "kind"`). Volver a `"leccion"` conserva los pasos en la DB (ocultos)
  por si el autor se arrepiente.
- `AdminLessonDetail.steps`: `[{ idx, title, body_markdown, example_id }]`
  (vacío si no es taller).
- Pasos (todas las respuestas: `AdminWorkshopSteps = { lesson_id, steps }`, la
  lista resultante con `idx` recompactados `0..n-1`):

| Método | Path | Body | OK |
|---|---|---|---|
| POST | `/admin/lessons/{id}/steps` | `{ title, body_markdown, example_id? }` | 201 (añade al final) |
| PUT | `/admin/lessons/{id}/steps/{idx}` | `{ title, body_markdown, example_id? }` | 200 |
| PUT | `/admin/lessons/{id}/steps/reorder` | `{ order: [idx…] }`, permutación exacta de los idx actuales; `order[i]` = idx actual del paso que pasa a la posición `i` | 200 |
| DELETE | `/admin/lessons/{id}/steps/{idx}` | — | 200 |

  Validación: `title` 1..160; `body_markdown` 1..20 000 y en el subset (§10.6);
  `example_id` con `ID_PATTERN`, existente y de una lección del **mismo módulo**
  que el taller (lo que publicar exige, §12.5); como mucho 50 pasos; la lección
  tiene que ser un taller. Errores: `404 LESSON_NOT_FOUND`, `404
  STEP_NOT_FOUND`, `422 CONTENT_VALIDATION_ERROR` (`field`: `kind`,
  `body_markdown`, `example_id`, `steps`, `order`), `422 VALIDATION_ERROR`.
  Reordenar y borrar **mueven las casillas con su paso** en esta máquina.
- `DELETE /admin/lessons/{id}` purga también `workshop_step_progress` (BL-01): un
  id reutilizado no resucita casillas de un taller anterior.

### 12.5 Catálogo (§11.10): `bundle_format: 2`

- Un bundle que lleva al menos un taller se publica con `bundle_format: 2`; uno
  sin talleres sigue siendo `1` y se serializa **exactamente** como antes (los
  campos nuevos se omiten cuando faltan), así que su checksum no cambia. **No
  cambian** ni el algoritmo del checksum (§11.8.2) ni el formato del índice
  (`index_format: 1`).
- `BundleLesson` gana dos campos opcionales, solo válidos en el formato 2:

```jsonc
{ "id": "tallerHilos", "…": "…", "completion_rule": "viewed",
  "example": null, "quiz": null, "video_url": null,
  "kind": "taller",
  "steps": [ { "title": "Lee el código", "body_markdown": "…", "example_id": "base-ej" },
             { "title": "Piensa",        "body_markdown": "…", "example_id": null } ] }
```

  La posición de cada paso es su índice en la lista. `BundleStep` es
  `extra="forbid"`: `title` 1..160, `body_markdown` 1..20 000, `example_id` con
  `ID_PATTERN` o `null`; como mucho 50 pasos.
- **Lector** (`bundle_guard.parse_bundle`): acepta 1 y 2. Un formato distinto ⇒
  `422 BUNDLE_INVALID` con mensaje «Formato de módulo no soportado por esta
  versión de Telar; actualiza la aplicación…» (`field: "bundle_format"`), antes
  del esquema. `kind`/`steps` en un bundle 1, o `steps` en una lección que no es
  taller ⇒ `BUNDLE_INVALID`. Reglas de contenido (⇒ `CONTENT_VALIDATION_ERROR`):
  un taller tiene ≥ 1 paso, no lleva quiz ni video, su regla es `viewed`, el
  markdown de cada paso está en el subset, y cada `example_id` es el de un
  ejemplo que viaja en el mismo bundle. `example_id` se endurece como un id
  (barrido de texto: control, BIDI, ancho cero, `..`/`/`).
- **v1.0.5**: su `ModuleBundle` tiene `bundle_format: Literal[1]` y
  `extra="forbid"` (verificado en `schemas/catalog.py` del commit `6b05c1b`), así
  que un bundle 2 sale como `422 BUNDLE_INVALID` «El bundle no cumple el esquema
  de §11.10.» con detalle en `bundle_format`; no se instala nada.
- **Publicar** (§11.8.2) valida igual que en S5 (`parse_bundle` +
  `validar_bundle`/`_verificar_contenido`): un taller cuyo paso apunta a un
  ejemplo de otro módulo falla con 422 antes de subir. El `example_id` de cada
  paso se publica con el id **publicado** del ejemplo (`EXAMPLE_ID_RENAMED`).
  `content_hash` (§11.8.3) incluye `kind` y los pasos.
- **Instalar / actualizar / importar** escriben `lessons.kind` y reescriben los
  pasos de cada lección del bundle. El fork (§11.7) prefija también el
  `example_id` de los pasos.
- **Casillas al actualizar** (CU-38): cada casilla sigue al paso de contenido
  **idéntico** (`title`, `body_markdown`, `example_id`; los duplicados se
  emparejan en orden); la de un paso cambiado o retirado se descarta y un paso
  nuevo nace sin marcar. `lesson_progress.completed` no retrocede. El informe
  (también la vista previa) lo anuncia con el aviso `WORKSHOP_MARKS_RESET` por
  taller. **Al instalar** (p. ej. reinstalar tras desinstalar) las casillas
  huérfanas se descartan: sus pasos se fueron con la lección y no hay con qué
  emparejarlas; el `completed` del taller se recupera con `lesson_progress`.

### 12.4 DTOs

- pydantic: `schemas/catalog.py` (`BundleStep`, `BundleLesson.kind/steps`,
  `ModuleBundle.bundle_format: Literal[1, 2]`, `BUNDLE_FORMAT_TALLERES`),
  `schemas/content.py` (`LessonKind`, `WorkshopStepView`,
  `ModuleLesson.kind`, `LessonDetail.kind/steps`), `schemas/progress.py`
  (`WorkshopStepUpdateRequest`, `WorkshopStepUpdateResult`), `schemas/admin.py`
  (`AdminLessonBase.kind`, `AdminLessonDetail.steps`, `AdminWorkshopStepInput`,
  `AdminWorkshopStep`, `AdminWorkshopStepsReorder`, `AdminWorkshopSteps`).
- TypeScript: `frontend/src/api/types.ts` (`LessonKind`, `WorkshopStepDto`,
  `WorkshopStepUpdateRequestDto`, `WorkshopStepUpdateResultDto`, `kind?`/`steps?`
  opcionales) y `frontend/src/api/admin-types.ts` (`kind?`, `steps?`,
  `AdminWorkshopStep*`).
