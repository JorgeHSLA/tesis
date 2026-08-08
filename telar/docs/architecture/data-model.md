# Telar — Modelo de datos (SQLite + fixtures)

> **Estado: CONGELADO (Fase 1).** DDL, interfaces de repositorio y reparto
> código-vs-DB definitivos para Fase 3. Complementa `architecture.md` y
> `api-contract.md`.

---

## 1. Principios y reparto contenido-vs-estado

**Decisión central: el contenido es código; el estado es base de datos.**

| Vive en **fixtures versionados** (repo, solo lectura) | Vive en **SQLite** (mutable) |
|---|---|
| 14 ejemplos (código fuente + metadatos) | `jobs` (telemetría y config de cada ejecución) |
| 8 módulos y 14 lecciones (catálogo + markdown) | `quiz_attempts` (intentos de quiz) |
| 14 quizzes / 65 preguntas (60 habilitadas sin GPU) con respuesta correcta y explicación | `lesson_progress` (vista/completada/mejor score) |
| — | `schema_version` (migraciones manuales) |

Justificación (por qué modules/lessons/quizzes **no** van en DB):

1. **El contenido cambia con el código, no en runtime**: no hay UI de
   administración ni multi-autor; cada corrección de una lección es un commit
   revisable (diff de markdown), no un UPDATE opaco.
2. **Cero migraciones de contenido**: sembrar/actualizar contenido en DB
   exigiría seeds idempotentes y versionado paralelo al de git. Los fixtures
   se cargan y validan en el lifespan (pydantic) y quedan en memoria —
   14 lecciones caben de sobra.
3. **Seguridad del quiz**: las respuestas correctas jamás salen del proceso
   (el endpoint las filtra); tenerlas en DB no añade nada.
4. **Reproducibilidad de la tesis**: un checkout del repo = el contenido
   exacto de esa versión.

El vínculo entre ambos mundos son **IDs de texto estables**
(`lesson_id == example_id ==` nombre de carpeta del repo de aprendizaje:
`primerEjemplo`, `for`, `spmd`, `spmdCritical`, `entornoDatos`,
`sumaVectores`, `matrices`, `mandelbrot`, `monteCarloPi`, `tareas`,
`fibonacciTareas`, `stencilCalor`, `transporteParticulas`, `sumaVectoresGPU`).
SQLite no puede validar FKs contra fixtures: la integridad referencial de
`lesson_id`/`example_id` se valida **en la capa de servicio** contra
`ContentRepository` antes de cada INSERT.

**Sin tabla `users`**: herramienta local mono-usuario (alcance de la tesis).
El progreso es "del instalador". Multi-usuario = trabajo futuro documentado
(añadir `user_id` a las 3 tablas de estado + auth).

---

## 2. Configuración de la conexión

Una única conexión `aiosqlite` creada en el lifespan (serializa escrituras de
forma natural — un solo writer, correcto para SQLite):

```python
# db.py
async def open_db(path: str) -> aiosqlite.Connection:
    db = await aiosqlite.connect(path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")    # lectores no bloquean al escritor
    await db.execute("PRAGMA busy_timeout=5000")   # espera 5s ante lock
    await db.execute("PRAGMA synchronous=NORMAL")  # seguro con WAL
    await db.execute("PRAGMA foreign_keys=ON")     # OFF por defecto en SQLite
    await db.commit()
    return db
```

- **Lock de escritura (regla transversal)**: la conexión única comparte el
  estado transaccional entre tasks concurrentes (un `commit()` ajeno
  confirmaría a medias la transacción de otra task). `db.py` expone
  `write_lock = asyncio.Lock()`: **toda unidad de escritura** (cada
  `finish()`, cada upsert, y en especial la secuencia multi-statement
  quiz-attempt→progress) toma el lock, ejecuta sus statements y hace
  `commit()`/`rollback()` **dentro de él**. Con un solo writer real el coste
  es nulo a esta escala; las lecturas no toman el lock (WAL).
- Ruta: `TELAR_DB_PATH` (compose: `/app/data/telar.db` en el volumen
  `telar_data`; dev: `~/.telar/telar.db` — ext4, nunca `/mnt/d`).
- Esquema: `schema.sql` idempotente (`CREATE TABLE IF NOT EXISTS …`)
  ejecutado en el lifespan; `schema_version` gobierna migraciones manuales
  (bloques `-- migration N` aplicados si `version < N`).

---

## 3. DDL completo

```sql
-- schema.sql · versión 1
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

------------------------------------------------------------------------------
-- jobs: una fila por ejecución, con toda su telemetría y config
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id                TEXT PRIMARY KEY,              -- uuid4().hex (32 chars)
    -- procedencia del código
    source_kind       TEXT NOT NULL
                      CHECK (source_kind IN ('example','editor','upload')),
    example_id        TEXT,                          -- id de fixture; NULL si editor/upload
    lesson_id         TEXT,                          -- lección asociada (opcional)
    filename          TEXT NOT NULL,                 -- p.ej. 'piSpmd.py' | 'main.py'
    source_code       TEXT NOT NULL,                 -- snapshot exacto (≤ 262144 bytes)
    -- configuración de ejecución (lo que se pasó a docker_service)
    threads           INTEGER NOT NULL CHECK (threads BETWEEN 1 AND 16),
                                                     -- threads_effective (CPUs asignadas)
    timeout_s         INTEGER NOT NULL CHECK (timeout_s = 0 OR timeout_s >= 5),
                                                     -- 0 = SIN TIMEOUT (migration 4)
    runner_image      TEXT NOT NULL,                 -- p.ej. 'telar-runner:0.5.1'
    -- ciclo de vida
    status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','creating','compiling','running',
                                        'completed','failed','timeout','cancelled')),
    container_id      TEXT,                          -- id Docker (para el reaper/debug)
    error_detail      TEXT,                          -- catálogo CERRADO: 'wall_timeout' | 'output_limit_exceeded'
                                                     -- | 'orphaned_on_restart' | 'oom' | 'sandbox_error'
                                                     -- (NUNCA texto crudo de excepciones: eso va a logs del servidor)
    -- resultado
    exit_code         INTEGER,                       -- NULL hasta terminar
    oom_killed        INTEGER NOT NULL DEFAULT 0,    -- bool (137 desambiguado con reload())
    stdout            TEXT,                          -- salida completa post-mortem (≤ presupuesto)
    stderr            TEXT,
    output_truncated  INTEGER NOT NULL DEFAULT 0,    -- bool
    metrics_summary   TEXT,                          -- JSON (§3.1)
    parsed_timings    TEXT,                          -- JSON (§3.1) | NULL
    -- tiempos
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    started_at        TEXT,                          -- start del contenedor
    finished_at       TEXT,
    wall_time_ms      INTEGER                        -- finished-started (presupuesto, NO speedup)
);

CREATE INDEX IF NOT EXISTS idx_jobs_created  ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status   ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_lesson   ON jobs (lesson_id)  WHERE lesson_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_example  ON jobs (example_id) WHERE example_id IS NOT NULL;
```

> **Nota (timeout).** El techo desapareció en la **migration 4**: el
> `CHECK (timeout_s BETWEEN 5 AND 120)` pasó a
> `CHECK (timeout_s = 0 OR timeout_s >= 5)`, donde **`0` es el centinela de
> «sin timeout»** (espera indefinida). El máximo a nivel de aplicación sigue
> siendo OPCIONAL (`TELAR_MAX_TIMEOUT_S = 0` ⇒ sin límite, api-contract §7.1)
> y es lo único que puede acotar el valor; con un tope configurado el router
> rechaza `timeout_s = 0` con 422, porque un tope y una espera infinita se
> contradicen. En `examples.default_timeout_s` el CHECK quedó en `>= 5`: a
> diferencia de un job, un ejemplo del curso **no** admite 0 — «sin timeout»
> es una elección del estudiante, no un default de contenido.
>
> Consecuencia operativa: un job con `timeout_s = 0` nunca produce
> `wall_timeout` y retiene su puesto del semáforo (`TELAR_MAX_CONCURRENT_JOBS`)
> hasta que termine solo o lo cancelen.

```sql

------------------------------------------------------------------------------
-- quiz_attempts: cada envío de quiz (historial completo)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id          TEXT PRIMARY KEY,                    -- uuid4().hex
    lesson_id   TEXT NOT NULL,                       -- validado contra fixtures en servicio
    answers     TEXT NOT NULL,                       -- JSON {"spmd-q1":"b", ...}
    score       INTEGER NOT NULL CHECK (score >= 0),
    total       INTEGER NOT NULL CHECK (total > 0),
    passed      INTEGER NOT NULL DEFAULT 0,          -- bool (score/total >= 0.8)
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_lesson
    ON quiz_attempts (lesson_id, created_at DESC);

------------------------------------------------------------------------------
-- lesson_progress: una fila por lección tocada
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_progress (
    lesson_id        TEXT PRIMARY KEY,               -- validado contra fixtures en servicio
    viewed           INTEGER NOT NULL DEFAULT 0,     -- bool
    completed        INTEGER NOT NULL DEFAULT 0,     -- bool
    best_quiz_score  INTEGER,                        -- NULL si nunca intentó
    last_job_id      TEXT REFERENCES jobs(id) ON DELETE SET NULL,
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO schema_version (version)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version WHERE version = 1);
```

Notas de diseño:

- **Booleanos como INTEGER 0/1** (convención SQLite); los repositorios los
  mapean a `bool`.
- **JSON como TEXT** (`metrics_summary`, `parsed_timings`, `answers`):
  SQLite moderno permite `json_extract` si algún día se consulta por dentro;
  hoy solo se (de)serializan en el repositorio. No se normalizan en tablas
  hijas: son documentos de resultado inmutables, siempre leídos completos.
- **No se persisten las muestras de métricas en vivo** (≈1 fila/s): el vivo
  va por WS; en DB queda solo `metrics_summary`. Persistir la serie completa
  sería una tabla `job_metrics` (job_id, ts, cpu, mem) — descartado.
  **Consecuencia asumida por frontend-spec §6.4**: la pantalla de Resultados
  pinta «CPU promedio/pico» desde `metrics_summary` y solo muestra la gráfica
  temporal cuando llega directamente del live (serie aún en memoria del
  jobStore); desde el historial/F5 la card degrada al resumen agregado.
- **`stdout`/`stderr` en la fila del job**: presupuesto total ≤ 262 144 bytes
  garantizado por el truncado del runner, así que no hay riesgo de filas
  gigantes; permite "descargar output" y re-render de resultados sin archivos
  sueltos.
- **`threads` guarda el valor efectivo** (CPUs asignadas), que puede diferir
  del pedido en ejemplos de hilos fijos; el pedido original no se conserva
  (irrelevante tras la respuesta 202 con `threads_note`).
- FK real solo `lesson_progress.last_job_id → jobs.id` (ambas tablas en DB).

### 3.1 Esquemas de los documentos JSON embebidos

```jsonc
// jobs.metrics_summary — agregado de las muestras de docker stats
{ "samples": 8,                    // nº de muestras válidas
  "cpu_percent_max": 792.4,
  "cpu_percent_avg": 431.0,
  "mem_used_bytes_max": 231211008,
  "mem_limit_bytes": 536870912,
  "pids_max": 12,
  "throttled_periods": 0 }         // último valor acumulado

// jobs.parsed_timings — kind "sweep" (spmd, spmdCritical, transporteParticulas)
{ "parser_id": "sweep_transporte", "kind": "sweep",
  "series": [ { "threads": 1, "time_s": 0.726, "speedup": 1.0, "efficiency": 1.0 }, … ],
  "extra": { }, "correct": null }

// jobs.parsed_timings — kind "pair" (sumaVectores, matrices, stencilCalor)
{ "parser_id": "pair_parallel_serial", "kind": "pair",
  "parallel_time_s": 0.912, "reference_time_s": 0.989,
  "reference_label": "serial", "speedup_vs_reference": 1.08, "correct": true }

// quiz_attempts.answers
{ "spmd-q1": "b", "spmd-q2": "c", "spmd-q3": "b", "spmd-q4": "c", "spmd-q5": "b" }
```

---

## 4. Fixtures de contenido (versionados en el repo)

### 4.1 Layout

```
backend/app/content/
├── catalog.json                 # módulos + lecciones + metadatos de ejemplos
├── examples/
│   ├── primerEjemplo/main.py    # copia literal de helloOpenMP.py del repo de aprendizaje
│   ├── for/main.py
│   ├── spmd/main.py
│   │   …                        # (14 carpetas, nombre = id)
│   └── sumaVectoresGPU/main.py
├── lessons/
│   ├── primerEjemplo.md         # info*.md portado (formato/estilo unificado)
│   ├── for.md                   # REDACTADO NUEVO (el infoForOpenMP.md original está vacío):
│   │   …                        #   derivado del código + fila 2 del README (loop-level, reduction)
│   └── sumaVectoresGPU.md
└── quizzes/
    ├── primerEjemplo.json       # 4 preguntas
    ├── spmd.json                # 5 preguntas
    │   …                        # 65 preguntas totales; 60 con GPU deshabilitado
    └── sumaVectoresGPU.json     # 5 preguntas (lección disabled por defecto)
```

### 4.2 `catalog.json` — esquema y valores clave

```jsonc
{
  "modules": [
    { "id": "m1", "order": 1, "title": "Fundamentos",
      "description": "Región paralela, identidad de hilo, @njit/JIT, primer worksharing con reduction.",
      "level": "Básico", "lessons": ["primerEjemplo", "for"] },
    { "id": "m2", "order": 2, "title": "Patrón SPMD y false sharing",
      "level": "Intermedio", "lessons": ["spmd", "spmdCritical"], "description": "…" },
    { "id": "m3", "order": 3, "title": "Entorno de datos y sincronización",
      "level": "Intermedio", "lessons": ["entornoDatos"], "description": "…" },
    { "id": "m4", "order": 4, "title": "Worksharing sobre arrays",
      "level": "Básico",     "lessons": ["sumaVectores", "matrices"], "description": "…" },
    { "id": "m5", "order": 5, "title": "Data races y RNG paralelo",
      "level": "Intermedio-alto", "lessons": ["mandelbrot", "monteCarloPi"], "description": "…" },
    { "id": "m6", "order": 6, "title": "Tareas (divide y vencerás)",
      "level": "Avanzado",   "lessons": ["tareas", "fibonacciTareas"], "description": "…" },
    { "id": "m7", "order": 7, "title": "Simulaciones reales: ¿qué escala?",
      "level": "Avanzado",   "lessons": ["stencilCalor", "transporteParticulas"], "description": "…" },
    { "id": "m8", "order": 8, "title": "GPU (opcional)",
      "level": "Avanzado",   "lessons": ["sumaVectoresGPU"], "description": "…" }
  ],
  "examples": {
    "primerEjemplo":  { "filename": "helloOpenMP.py",           "title": "Hola mundo paralelo",
      "difficulty": 1, "threads_configurable": true,
      "fixed_threads": null, "fixed_threads_note": null,
      "sweeps_threads": false, "self_measures": false, "parser_id": "none",
      "default_timeout_s": 30, "est_run_seconds": 5, "enabled": true, "requires_gpu": false,
      "directives": ["parallel"], "teaches": "…", "expected_output_note": "N líneas 'Hello from thread <int>' (orden no determinista)",
      "takeaways": ["…", "…", "…"] },
    "for":            { "filename": "forOpenMP.py",             "difficulty": 1,
      "threads_configurable": true,  "sweeps_threads": false, "self_measures": false,
      "parser_id": "none", "default_timeout_s": 30, "enabled": true, "requires_gpu": false, "…": "…" },
    "spmd":           { "filename": "piSpmd.py",                "difficulty": 3,
      "threads_configurable": false,
      "fixed_threads_note": "Barre 1/2/4/8 hilos con omp_set_num_threads",
      "sweeps_threads": true,  "self_measures": true,  "parser_id": "sweep_pi",
      "default_timeout_s": 60, "enabled": true, "requires_gpu": false, "…": "…" },
    "spmdCritical":   { "filename": "piSpmdCritical.py",        "…": "como spmd" },
    "entornoDatos":   { "filename": "entornoDatos.py",          "difficulty": 2,
      "threads_configurable": false, "fixed_threads": 4,
      "fixed_threads_note": "num_threads(4) en la directiva",
      "sweeps_threads": false, "self_measures": false, "parser_id": "none",
      "default_timeout_s": 30, "…": "…" },
    "sumaVectores":   { "filename": "sumaVectores.py",          "difficulty": 2,
      "threads_configurable": true, "self_measures": true, "parser_id": "pair_openmp_numpy",
      "default_timeout_s": 60, "…": "…" },
    "matrices":       { "filename": "multiplicacionMatrices.py","difficulty": 3,
      "threads_configurable": true, "self_measures": true, "parser_id": "pair_openmp_blas",
      "default_timeout_s": 60, "…": "…" },
    "mandelbrot":     { "filename": "areaMandelbrot.py",        "difficulty": 4,
      "threads_configurable": true, "self_measures": false, "parser_id": "none",
      "default_timeout_s": 90, "…": "…" },
    "monteCarloPi":   { "filename": "piMonteCarlo.py",          "difficulty": 4,
      "threads_configurable": false, "fixed_threads": 4,
      "fixed_threads_note": "Fija 4 hilos con omp_set_num_threads",
      "sweeps_threads": false, "self_measures": false, "parser_id": "none",
      "default_timeout_s": 60, "…": "…" },
    "tareas":         { "filename": "piTask.py",                "difficulty": 4,
      "threads_configurable": true, "self_measures": false, "parser_id": "none",
      "default_timeout_s": 30, "…": "…" },
    "fibonacciTareas":{ "filename": "fibonacciTareas.py",       "difficulty": 4,
      "threads_configurable": true, "self_measures": false, "parser_id": "none",
      "default_timeout_s": 60, "…": "…" },
    "stencilCalor":   { "filename": "calorStencil.py",          "difficulty": 4,
      "threads_configurable": true, "self_measures": true, "parser_id": "pair_parallel_serial",
      "default_timeout_s": 90, "…": "…" },
    "transporteParticulas": { "filename": "transporteMonteCarlo.py", "difficulty": 5,
      "threads_configurable": false,
      "fixed_threads_note": "Barre 1/2/4/8 hilos con omp_set_num_threads",
      "sweeps_threads": true, "self_measures": true, "parser_id": "sweep_transporte",
      "default_timeout_s": 90, "…": "…" },
    "sumaVectoresGPU":{ "filename": "sumaVectoresGPU.py",       "difficulty": 4,
      "threads_configurable": false, "sweeps_threads": false, "self_measures": false,
      "parser_id": "none", "default_timeout_s": 90,
      "enabled": false, "requires_gpu": true, "…": "…" }
  },
  "lessons": {
    "primerEjemplo": { "module_id": "m1", "order": 1, "title": "Hola mundo paralelo",
                       "estimated_minutes": 15, "content_file": "lessons/primerEjemplo.md",
                       "recommended": [ { "lesson_id": "for", "label": "Tu primer parallel for", "tag": "Fundamentos" } ] }
    // … 14 entradas; lesson_id == example_id; order global 1..14 (ruta lineal del README)
  }
}
```

(Los `…` son abreviaturas de este documento; el fixture real lleva todos los
campos completos. `teaches`, `directives`, `difficulty` y
`expected_output_note` salen literales de la tabla maestra de
`examples-content.md` §1 y §6. Campos añadidos para la UI —
`est_run_seconds`, `fixed_threads`, `takeaways` en cada ejemplo y
`recommended` en cada lección — se redactan al poblar los fixtures;
shape en `api-contract.md` §3-§4.)

### 4.3 `quizzes/<lesson_id>.json` — esquema

```jsonc
{
  "lesson_id": "spmd",
  "pass_threshold": 0.8,
  "questions": [
    {
      "id": "spmd-q1",
      "order": 1,
      "text": "¿Cómo reparte el trabajo el hilo tid en el patrón SPMD de este ejemplo?",
      "options": [
        { "key": "a", "text": "OpenMP reparte el bucle automáticamente" },
        { "key": "b", "text": "Manualmente con range(tid, num_steps, nths): reparto cíclico…" },
        { "key": "c", "text": "Cada hilo procesa la mitad izquierda o derecha" },
        { "key": "d", "text": "Un hilo maestro asigna trozos bajo demanda" }
      ],
      "correct_key": "b",                       // JAMÁS sale por la API antes del intento
      "explanation": "El info lo llama \"ESTE es el reparto manual\"; …"
    }
  ]
}
```

Las 60/65 preguntas ya están redactadas en `docs/analysis/examples-content.md`
§4 (fuente literal para poblar estos ficheros).

### 4.4 Carga y validación en el lifespan

`ContentRepository` carga todo al arrancar y **falla rápido** si el contenido
está roto (la app no arranca con fixtures inválidos):

- Modelos pydantic para catálogo, ejemplo, lección y quiz.
- Invariantes verificados: 14 ejemplos = 14 lecciones = 14 quizzes; cada
  `lesson.example_id` y `module.lessons[*]` existen; `parser_id` ∈ los 6
  válidos; `main.py` y `lessons/*.md` existen y son UTF-8; total de preguntas
  habilitadas == 60 (65 − 5 de GPU); `correct_key` ∈ opciones de su pregunta.

---

## 5. Repository pattern — interfaces exactas

Records inmutables (`@dataclass(frozen=True)`), SQL explícito, sin ORM.
Los repositorios de estado reciben la conexión `aiosqlite` del lifespan;
`ContentRepository` es síncrono y en memoria.

```python
# repositories/records.py
@dataclass(frozen=True)
class JobRecord:
    id: str
    source_kind: str                 # 'example' | 'editor' | 'upload'
    example_id: str | None
    lesson_id: str | None
    filename: str
    source_code: str
    threads: int
    timeout_s: int
    runner_image: str
    status: str
    container_id: str | None
    error_detail: str | None
    exit_code: int | None
    oom_killed: bool
    stdout: str | None
    stderr: str | None
    output_truncated: bool
    metrics_summary: dict | None     # (de)serializado JSON en el repo
    parsed_timings: dict | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    wall_time_ms: int | None

@dataclass(frozen=True)
class QuizAttemptRecord:
    id: str
    lesson_id: str
    answers: dict[str, str]
    score: int
    total: int
    passed: bool
    created_at: str

@dataclass(frozen=True)
class LessonProgressRecord:
    lesson_id: str
    viewed: bool
    completed: bool
    best_quiz_score: int | None
    last_job_id: str | None
    updated_at: str
```

```python
# repositories/jobs.py
class JobRepository:
    def __init__(self, db: aiosqlite.Connection) -> None: ...

    async def create(self, job: JobRecord) -> JobRecord
        # INSERT completo; el job nace 'queued'

    async def find_by_id(self, job_id: str) -> JobRecord | None

    async def list_recent(
        self, *, limit: int = 20, offset: int = 0, status: str | None = None,
    ) -> tuple[list[JobRecord], int]
        # ORDER BY created_at DESC; devuelve (página, total) para meta

    async def set_phase(
        self, job_id: str, status: str, *,
        container_id: str | None = None, started_at: str | None = None,
    ) -> None
        # transiciones no terminales: creating/compiling/running

    async def finish(
        self, job_id: str, *, status: str, exit_code: int | None,
        oom_killed: bool, error_detail: str | None,
        stdout: str, stderr: str, output_truncated: bool,
        metrics_summary: dict | None, parsed_timings: dict | None,
        finished_at: str, wall_time_ms: int | None,
    ) -> None
        # única escritura del resultado (terminal); idempotente por status terminal

    async def mark_orphans_failed(self) -> int
        # UPDATE … SET status='failed', error_detail='orphaned_on_restart'
        # WHERE status IN ('queued','creating','compiling','running');
        # devuelve nº de filas (se llama en el lifespan tras el reaper de contenedores)
```

```python
# repositories/quiz_attempts.py
class QuizAttemptRepository:
    def __init__(self, db: aiosqlite.Connection) -> None: ...
    async def create(self, attempt: QuizAttemptRecord) -> QuizAttemptRecord
    async def list_by_lesson(
        self, lesson_id: str, *, limit: int = 10, offset: int = 0,
    ) -> tuple[list[QuizAttemptRecord], int]
    async def best_score(self, lesson_id: str) -> int | None
```

```python
# repositories/progress.py
class ProgressRepository:
    def __init__(self, db: aiosqlite.Connection) -> None: ...
    async def get(self, lesson_id: str) -> LessonProgressRecord | None
    async def get_all(self) -> list[LessonProgressRecord]
    async def upsert(
        self, lesson_id: str, *,
        viewed: bool | None = None,          # None = no tocar
        completed: bool | None = None,
        best_quiz_score: int | None = None,  # solo si mejora (MAX en SQL)
        last_job_id: str | None = None,
    ) -> LessonProgressRecord
        # INSERT … ON CONFLICT(lesson_id) DO UPDATE (patrón upsert SQLite);
        # updated_at siempre se refresca
```

```python
# repositories/content.py — fixtures en memoria (sin DB)
class ContentRepository:
    def __init__(self, content_dir: Path) -> None
        # carga + valida (§4.4); lanza ContentError si algo está roto

    def modules(self) -> list[Module]                    # ordenados por order
    def lessons(self) -> list[Lesson]
    def lesson(self, lesson_id: str) -> Lesson | None    # incluye content_markdown
    def examples(self) -> list[Example]
    def example(self, example_id: str) -> Example | None # incluye source_code
    def quiz(self, lesson_id: str) -> Quiz | None        # CON correct_key/explanation:
                                                          # solo lo consume el servicio de
                                                          # quizzes, que filtra hacia la API
    def exists_lesson(self, lesson_id: str) -> bool      # validación referencial (§1)
    def exists_example(self, example_id: str) -> bool
```

Reglas transversales:

- Los repositorios **no** contienen lógica de negocio (cálculo de score,
  transición de estados, parseo): eso vive en `services/`. Solo SQL + mapeo.
- **Toda escritura toma `db.write_lock`** (§2) alrededor de sus statements +
  `commit()`/`rollback()`. El caso multi-statement quiz-attempt→progress
  (helper `QuizService.submit_attempt`) ejecuta INSERT + UPDATE + `commit()`
  como unidad **dentro del lock** — así ningún `commit()` de otra task (p.
  ej. el `finish()` de un job concurrente) puede confirmarla a medias.
- `finish()` y `set_phase()` llevan guard de terminales:
  `WHERE status NOT IN ('completed','failed','timeout','cancelled')`
  (0 filas ⇒ transición rechazada; ver `architecture.md` §3.3).
- Inmutabilidad: los records nunca se mutan; actualizar = nueva lectura.
- Tests: repositorios probados contra SQLite en memoria
  (`aiosqlite.connect(":memory:")` + `schema.sql`).

---

## 6. Volúmenes y qué archivo vive dónde (resumen operativo)

| Dato | Dev (backend nativo WSL) | Prod/demo (compose) |
|---|---|---|
| SQLite | `~/.telar/telar.db` (ext4) | volumen `telar_data` → `/app/data/telar.db` |
| Código por job (efímero) | `~/.telar/jobs/<job_id>/main.py` → bind `:ro` | volumen `telar_submissions` → `/submissions/<job_id>/` → mount `subpath` `:ro` |
| Fixtures de contenido | **semilla** versionada del repo (seeder → SQLite) | igual (horneados en la imagen, sembrados al arranque) |
| Contenido de cursos runtime | **SQLite** (`modules/lessons/examples/quiz_questions`) | igual (volumen `telar_data`) |
| Logs/salida del job | fila `jobs.stdout/stderr` (≤256 KB) | igual |
| Métricas en vivo | solo WS + ring buffer en memoria | igual |

---

## 7. Contenido de cursos en SQLite (Fase 4 — Autoría admin)

> **Estado: CONGELADO (Fase 4).** Sección aditiva. **Revierte la decisión de §1
> para el contenido**: a partir de Fase 4 el contenido de cursos vive en SQLite
> (editable por el admin, `api-contract.md` §10), no solo en fixtures. Los
> fixtures de `backend/app/content/` pasan a ser la **semilla versionada**; un
> seeder idempotente los migra a la DB. **La interfaz de lectura de
> `ContentRepository` (§5) NO cambia** → todos los GET de contenido (§3–§5 del
> contrato) responden byte-idéntico.

### 7.1 Principio (extiende §1)

| Antes (Fase 3) | Ahora (Fase 4) |
|---|---|
| Contenido = fixtures en memoria (solo lectura, fail-fast 14=14=14) | Contenido = **SQLite** (mutable vía `/admin/*`); fixtures = **seed** versionado |
| `ContentRepository(content_dir)` carga de archivos | `ContentRepository.load(db)` carga de la DB; `.from_fixtures(dir)` sigue existiendo (la usa el seeder y los tests de baseline) |
| Invariantes de conteo en el arranque | Conteos dejan de ser obligatorios; validación **runtime al escribir** (api-contract §10.6). El loader solo valida integridad estructural (refs, `correct_key ∈ opciones`, `parser_id`, markdown no vacío, `order` único) |

El estado del estudiante (`jobs`, `quiz_attempts`, `lesson_progress`) sigue en las
tablas de §3, vinculado por los mismos `lesson_id`/`example_id` de texto estable.
Migrar de Fase 3 a Fase 4 es transparente: la `migration 2` crea las tablas de
contenido vacías y el auto-seed las puebla; el progreso existente sigue válido
(mismos ids).

### 7.2 DDL — `schema.sql` migration 2 (schema_version → 2)

Cuatro tablas (transcripción literal del bloque `-- migration 2` de `schema.sql`):

- **`modules`** `(id PK, "order" UNIQUE, title, description, level)`.
- **`lessons`** `(id PK, module_id FK→modules ON DELETE CASCADE, "order" UNIQUE
  [global], title, estimated_minutes, content_markdown, pass_threshold [nivel-quiz
  vive aquí: 1 quiz por lección], recommended_json)`.
- **`examples`** `(id PK FK→lessons ON DELETE CASCADE [invariante 1:1 con la
  lección], filename, title, difficulty, teaches, directives_json,
  threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
  self_measures, parser_id [CHECK ∈ 6], default_timeout_s, est_run_seconds,
  enabled, requires_gpu, expected_output_note, takeaways_json, source_code)`.
- **`quiz_questions`** `(id PK, lesson_id FK→lessons ON DELETE CASCADE, "order",
  text, options_json [2-4 `{key,text}`], correct_key [CHECK a|b|c|d], explanation,
  UNIQUE(lesson_id,"order"))`.

Decisiones de forma:

- **Listas cortas/opacas → JSON TEXT** con `CHECK(json_valid(...))`: `directives`,
  `takeaways`, `recommended`, `options`. Nunca se filtran ni se hace JOIN por
  ellas; el orden se preserva por ser array. Una tabla hija añadiría 3-4 tablas y
  columnas de orden para cero beneficio. (De)serialización con
  `json.dumps(..., ensure_ascii=False)` / `json.loads` en el loader.
- **Relaciones consultadas → FK normalizada** (`lessons.module_id`,
  `quiz_questions.lesson_id`, `examples.id → lessons.id`).
- **Campos derivados NO se almacenan** (los calcula el loader, igual que hoy):
  `Lesson.example_id`(==id), `has_quiz`, `quiz_question_count`, `enabled`(de
  `examples.enabled`), `prev/next_lesson_id`; `Example.module_id`/`order`/`lesson_id`
  (del JOIN con `lessons`); `Module.lesson_ids` (`SELECT id FROM lessons WHERE
  module_id=? ORDER BY "order"`).
- Booleanos como INTEGER 0/1 (convención de §3); `"order"` entre comillas (keyword).

### 7.3 Seeder idempotente — `app.tools.seed_content`

- CLI `python -m app.tools.seed_content [--db P] [--content D] [--prune] [--check]`
  y helper `async seed_content_into(db, *, content_dir=CONTENT_DIR, prune_extra=False)`.
- Fuente = `ContentRepository.from_fixtures(content_dir)` (el mismo objeto validado
  de Fase 3, con las invariantes 14/60 que **aquí sí** aplican: el baseline
  canónico son los 14). Roto → `ContentError`, aborta sin tocar la DB.
- **Idempotente**: `INSERT … ON CONFLICT(id) DO UPDATE SET col=excluded.col…` por
  tabla (clave = PK `id`) dentro de `write_lock` y una sola transacción; orden
  `modules → lessons → examples → quiz_questions`. Segunda corrida = UPDATE con los
  mismos bytes ⇒ cero filas nuevas, cero pérdida. `--prune` borra filas cuyo id no
  esté en los fixtures (reset explícito al baseline; CASCADE limpia hijos).
- **Auto-seed en el lifespan** (main.py, tras `apply_schema`): si la tabla
  `lessons` está vacía → `seed_content_into(db)` (no pisa ediciones admin en una
  DB no vacía; instalaciones nuevas arrancan solas). Luego
  `app.state.content = await ContentRepository.load(db)`.
- **No-pérdida garantizada** (test `test_seed_no_data_loss`): igualdad de snapshot
  campo-a-campo contra `ContentRepository.from_fixtures(CONTENT_DIR)` (records
  `frozen` → `==` compara `source_code`, `content_markdown`, `takeaways`,
  `recommended`, `options`, `prev/next`, todos los flags); conteos (8 módulos, 14
  lecciones/ejemplos, 60 preguntas habilitadas); idempotencia (2ª corrida sin
  cambios); goldens HTTP de los GET públicos idénticos a Fase 3.

### 7.4 Refactor de `ContentRepository` y recarga atómica

- Interfaz de lectura de §5 **byte-idéntica** (síncrona, en memoria). Constructor
  privado por records + dos fábricas: `from_fixtures(content_dir)` (fail-fast con
  invariantes 14/60; la usan el seeder y los tests de baseline) y
  `async load(db)` (reconstruye el MISMO snapshot inmutable desde la DB; producción
  Fase 4).
- **Recarga atómica** tras cada escritura admin (`services/content_state.reload_content(app)`):
  construye un `ContentRepository` nuevo desde la DB y reasigna `app.state.content`
  (swap atómico). Correcto en el único event loop porque el snapshot es inmutable
  (`frozen` + tuplas), los 8 lectores son síncronos y los handlers ligan
  `content = request.app.state.content` una vez al inicio del request. **Invariante
  a respetar**: no re-leer `app.state.content` entre `await`s dentro de un handler.
