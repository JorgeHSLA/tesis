-- schema.sql · versión 1
-- TRANSCRIPCIÓN LITERAL de docs/architecture/data-model.md §3 (CONGELADO).
-- Idempotente: se ejecuta completo en cada arranque (lifespan).
-- Migraciones futuras: bloques "-- migration N" al final, aplicados si
-- schema_version < N (ver db.py).
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
    timeout_s         INTEGER NOT NULL CHECK (timeout_s BETWEEN 5 AND 120),
    runner_image      TEXT NOT NULL,                 -- p.ej. 'ehpc-runner:0.5.1'
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

-- migration 2
-- Fase 4 (Autoría de cursos): el contenido de cursos migra de fixtures estáticos
-- a SQLite. Semilla: `python -m app.tools.seed_content` (o auto-seed en el
-- lifespan si `lessons` está vacía). Listas cortas/opacas (directives, takeaways,
-- recommended, options) → JSON TEXT con CHECK json_valid; relaciones consultadas
-- → FK. Los conteos 14/60 dejan de ser invariantes de DDL (contenido mutable):
-- pasan a validación RUNTIME al escribir (data-model §7, api-contract §10).
-- El marcador "-- migration 2" lo aplica db.apply_schema si schema_version < 2.
-- foreign_keys=ON lo fija open_db (db.py). Orden de inserción del seeder:
-- modules → lessons → examples → quiz_questions.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS modules (
    id           TEXT PRIMARY KEY,
    "order"      INTEGER NOT NULL UNIQUE CHECK ("order" > 0),
    title        TEXT NOT NULL CHECK (length(title) > 0),
    description  TEXT NOT NULL,
    level        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
    id                TEXT PRIMARY KEY,
    module_id         TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    "order"           INTEGER NOT NULL UNIQUE CHECK ("order" > 0),   -- orden GLOBAL
    title             TEXT NOT NULL CHECK (length(title) > 0),
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 1),
    content_markdown  TEXT NOT NULL CHECK (length(content_markdown) > 0),
    pass_threshold    REAL NOT NULL CHECK (pass_threshold > 0.0 AND pass_threshold <= 1.0),
    recommended_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recommended_json))
);
CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_id, "order");

CREATE TABLE IF NOT EXISTS examples (
    id                    TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
    filename              TEXT NOT NULL,
    title                 TEXT NOT NULL CHECK (length(title) > 0),
    difficulty            INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
    teaches               TEXT NOT NULL,
    directives_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(directives_json)),
    threads_configurable  INTEGER NOT NULL CHECK (threads_configurable IN (0,1)),
    fixed_threads         INTEGER,
    fixed_threads_note    TEXT,
    sweeps_threads        INTEGER NOT NULL CHECK (sweeps_threads IN (0,1)),
    self_measures         INTEGER NOT NULL CHECK (self_measures IN (0,1)),
    parser_id             TEXT NOT NULL CHECK (parser_id IN
                          ('none','sweep_pi','sweep_transporte',
                           'pair_openmp_numpy','pair_openmp_blas','pair_parallel_serial')),
    default_timeout_s     INTEGER NOT NULL CHECK (default_timeout_s BETWEEN 5 AND 120),
    est_run_seconds       INTEGER NOT NULL CHECK (est_run_seconds >= 1),
    enabled               INTEGER NOT NULL CHECK (enabled IN (0,1)),
    requires_gpu          INTEGER NOT NULL CHECK (requires_gpu IN (0,1)),
    expected_output_note  TEXT NOT NULL,
    takeaways_json        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(takeaways_json)),
    source_code           TEXT NOT NULL CHECK (length(source_code) > 0)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id           TEXT PRIMARY KEY,               -- p.ej. 'spmd-q1' (globalmente único)
    lesson_id    TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    "order"      INTEGER NOT NULL CHECK ("order" > 0),
    text         TEXT NOT NULL CHECK (length(text) > 0),
    options_json TEXT NOT NULL CHECK (json_valid(options_json)),  -- [{"key":"a","text":…}], 2-4
    correct_key  TEXT NOT NULL CHECK (correct_key IN ('a','b','c','d')),
    explanation  TEXT NOT NULL,
    UNIQUE (lesson_id, "order")
);
CREATE INDEX IF NOT EXISTS idx_quiz_lesson ON quiz_questions (lesson_id, "order");

-- migration 3
-- BL-21 (auditoría): metadatos clave→valor de la aplicación. La clave
-- 'content_seeded_at' gobierna el auto-seed del lifespan: "lessons vacía"
-- dejó de ser la condición (no distinguía "nunca sembrada" de "vaciada a
-- propósito por el admin"). El seeder escribe el marcador en su MISMA
-- transacción; para DBs pobladas antes de esta migración el lifespan hace
-- backfill del marcador sin tocar el contenido.
CREATE TABLE IF NOT EXISTS app_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
