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
    timeout_s         INTEGER NOT NULL CHECK (timeout_s = 0 OR timeout_s >= 5),
                                                     -- 0 = SIN TIMEOUT (espera
                                                     -- indefinida); >= 5 = límite
                                                     -- en segundos. Sin techo: el
                                                     -- tope es opcional y vive en
                                                     -- TELAR_MAX_TIMEOUT_S.
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
    default_timeout_s     INTEGER NOT NULL CHECK (default_timeout_s >= 5),
                                                 -- sin techo (el tope es opcional,
                                                 -- TELAR_MAX_TIMEOUT_S). A diferencia
                                                 -- de jobs.timeout_s NO admite 0: un
                                                 -- ejemplo del curso siempre trae un
                                                 -- límite; "sin timeout" es una
                                                 -- elección del estudiante.
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

-- migration 4
-- "Sin timeout": el tope de `timeout_s` deja de existir en la DB y aparece el
-- centinela 0 = espera indefinida. Los CHECK viejos
-- (`timeout_s BETWEEN 5 AND 120`, `default_timeout_s BETWEEN 5 AND 120`) ya no
-- valen: capaban el valor DESPUÉS de que el router lo aceptara, así que un
-- timeout largo pasaba la validación y reventaba el INSERT con IntegrityError.
--
-- SQLite no permite alterar un CHECK in-place, así que hay que reconstruir la
-- tabla (procedimiento oficial: sqlite.org/lang_altertable.html#otheralter).
-- `jobs` tiene una FK ENTRANTE (lesson_progress.last_job_id), por eso el
-- foreign_keys=OFF durante el intercambio; al renombrar, la FK vuelve a
-- resolver contra la tabla nueva. Los índices se recrean al final porque
-- DROP TABLE se los lleva por delante.
--
-- El bloque base y la migration 2 ya traen los CHECK nuevos: esto es solo para
-- DBs creadas antes (schema_version < 4).
PRAGMA foreign_keys = OFF;

CREATE TABLE jobs_m4 (
    id                TEXT PRIMARY KEY,
    source_kind       TEXT NOT NULL
                      CHECK (source_kind IN ('example','editor','upload')),
    example_id        TEXT,
    lesson_id         TEXT,
    filename          TEXT NOT NULL,
    source_code       TEXT NOT NULL,
    threads           INTEGER NOT NULL CHECK (threads BETWEEN 1 AND 16),
    timeout_s         INTEGER NOT NULL CHECK (timeout_s = 0 OR timeout_s >= 5),
    runner_image      TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','creating','compiling','running',
                                        'completed','failed','timeout','cancelled')),
    container_id      TEXT,
    error_detail      TEXT,
    exit_code         INTEGER,
    oom_killed        INTEGER NOT NULL DEFAULT 0,
    stdout            TEXT,
    stderr            TEXT,
    output_truncated  INTEGER NOT NULL DEFAULT 0,
    metrics_summary   TEXT,
    parsed_timings    TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    started_at        TEXT,
    finished_at       TEXT,
    wall_time_ms      INTEGER
);
INSERT INTO jobs_m4 SELECT
    id, source_kind, example_id, lesson_id, filename, source_code, threads,
    timeout_s, runner_image, status, container_id, error_detail, exit_code,
    oom_killed, stdout, stderr, output_truncated, metrics_summary,
    parsed_timings, created_at, started_at, finished_at, wall_time_ms
FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_m4 RENAME TO jobs;

CREATE INDEX IF NOT EXISTS idx_jobs_created  ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status   ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_lesson   ON jobs (lesson_id)  WHERE lesson_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_example  ON jobs (example_id) WHERE example_id IS NOT NULL;

CREATE TABLE examples_m4 (
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
    default_timeout_s     INTEGER NOT NULL CHECK (default_timeout_s >= 5),
    est_run_seconds       INTEGER NOT NULL CHECK (est_run_seconds >= 1),
    enabled               INTEGER NOT NULL CHECK (enabled IN (0,1)),
    requires_gpu          INTEGER NOT NULL CHECK (requires_gpu IN (0,1)),
    expected_output_note  TEXT NOT NULL,
    takeaways_json        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(takeaways_json)),
    source_code           TEXT NOT NULL CHECK (length(source_code) > 0)
);
INSERT INTO examples_m4 SELECT
    id, filename, title, difficulty, teaches, directives_json,
    threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
    self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
    requires_gpu, expected_output_note, takeaways_json, source_code
FROM examples;
DROP TABLE examples;
ALTER TABLE examples_m4 RENAME TO examples;

PRAGMA foreign_keys = ON;

-- migration 5
-- Fase 5 (Módulos publicables). Cinco cambios que van juntos porque todos tocan
-- `lessons`/`examples` y SQLite obliga a reconstruir la tabla para alterar un
-- CHECK, una PK o un UNIQUE (procedimiento oficial:
-- sqlite.org/lang_altertable.html#otheralter). Es el mismo baile que la
-- migración 4: foreign_keys=OFF -> tabla *_m5 -> INSERT…SELECT -> DROP ->
-- RENAME -> recrear índices -> ON.
--
-- E1 · La lección deja de estar atada a un ejemplo. Hasta ahora
--   `examples.id TEXT PRIMARY KEY REFERENCES lessons(id)` hacía que el ejemplo
--   COMPARTIERA clave primaria con su lección: una lección sin código no era
--   representable, y con ella quedaba fuera todo el track conceptual (qué es un
--   hilo, concurrencia vs paralelismo, Amdahl) que precede al primer
--   `parallel for`. Ahora el ejemplo tiene `id` propio y una columna
--   `lesson_id UNIQUE` nullable: 0 o 1 ejemplo por lección.
--   BACKFILL: `lesson_id = id`, que es exactamente lo que valía la relación
--   anterior. Por eso el snapshot sigue resolviendo igual y la suite queda verde
--   con la migración aplicada y cero cambios de código.
--
-- E2 · `lessons."order"` deja de ser UNIQUE GLOBAL y pasa a ser único por
--   `(module_id, "order")`. Con el orden global, publicar un módulo nuevo
--   obligaba a renumerar el curso entero y la actualización se volvía frágil.
--   Se implementa como ÍNDICE PARCIAL, no como constraint de tabla: una lección
--   archivada debe LIBERAR su hueco, o archivar sería imposible (la archivada
--   seguiría ocupando el slot y la nueva reventaría con IntegrityError).
--
-- E4 · `completion_rule` dice qué completa una lección: aprobar el quiz (por
--   defecto), leerla, o ejecutar bien su ejemplo. Sin esto, una lección
--   conceptual —sin quiz— sería incompletable y bloquearía el progreso de su
--   módulo. `enabled` deja de derivarse del ejemplo y pasa a columna propia por
--   la misma razón: una lección sin ejemplo quedaría deshabilitada en silencio.
--
-- ARCHIVADO · `lessons.archived_at` marca una lección que desapareció de una
--   versión posterior de su módulo. NO se borra: `lesson_progress` y
--   `quiz_attempts` no tienen FK a `lessons` (a propósito, §8.3), y borrarla
--   dejaría al historial de jobs sin título resoluble. Archivada = legible,
--   fuera de la ruta lineal, con su progreso intacto.
--
-- MANIFIESTO · `installed_modules` es la selección del estudiante: qué módulos
--   incorporó y en qué versión. Vive en SQLite, no en un archivo suelto, para
--   que no haya dos fuentes de verdad.
PRAGMA foreign_keys = OFF;

-- ── lessons: enabled propio, completion_rule, archived_at, sin UNIQUE global ──
CREATE TABLE lessons_m5 (
    id                TEXT PRIMARY KEY,
    module_id         TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    "order"           INTEGER NOT NULL CHECK ("order" > 0),   -- único POR MÓDULO (índice parcial)
    title             TEXT NOT NULL CHECK (length(title) > 0),
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 1),
    content_markdown  TEXT NOT NULL CHECK (length(content_markdown) > 0),
    video_url         TEXT,                                   -- YouTube no listado; NULL = sin video
    pass_threshold    REAL NOT NULL CHECK (pass_threshold > 0.0 AND pass_threshold <= 1.0),
    recommended_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recommended_json)),
    enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    completion_rule   TEXT NOT NULL DEFAULT 'quiz'
                      CHECK (completion_rule IN ('quiz','viewed','run')),
    archived_at       TEXT                                    -- NULL = viva
);
-- `enabled` se hereda del ejemplo, que es de donde se derivaba hasta ahora;
-- `completion_rule` queda en 'quiz' porque las 14 lecciones del baseline lo tienen.
INSERT INTO lessons_m5
    (id, module_id, "order", title, estimated_minutes, content_markdown,
     video_url, pass_threshold, recommended_json, enabled, completion_rule, archived_at)
SELECT
    l.id, l.module_id, l."order", l.title, l.estimated_minutes, l.content_markdown,
    NULL, l.pass_threshold, l.recommended_json,
    COALESCE((SELECT e.enabled FROM examples e WHERE e.id = l.id), 1),
    'quiz', NULL
FROM lessons l;
DROP TABLE lessons;
ALTER TABLE lessons_m5 RENAME TO lessons;

CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_id, "order");
-- Índice PARCIAL: la unicidad solo rige entre lecciones VIVAS, de modo que una
-- lección archivada libera su hueco y la que la sustituye puede reusar el order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lessons_order_vivas
    ON lessons (module_id, "order") WHERE archived_at IS NULL;

-- ── examples: id propio + lesson_id UNIQUE nullable (E1) ────────────────────
CREATE TABLE examples_m5 (
    id                    TEXT PRIMARY KEY,
    lesson_id             TEXT UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
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
    default_timeout_s     INTEGER NOT NULL CHECK (default_timeout_s >= 5),
    est_run_seconds       INTEGER NOT NULL CHECK (est_run_seconds >= 1),
    enabled               INTEGER NOT NULL CHECK (enabled IN (0,1)),
    requires_gpu          INTEGER NOT NULL CHECK (requires_gpu IN (0,1)),
    expected_output_note  TEXT NOT NULL,
    takeaways_json        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(takeaways_json)),
    source_code           TEXT NOT NULL CHECK (length(source_code) > 0)
);
-- BACKFILL de E1: `lesson_id = id` reproduce exactamente la relación anterior.
INSERT INTO examples_m5
    (id, lesson_id, filename, title, difficulty, teaches, directives_json,
     threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
     self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
     requires_gpu, expected_output_note, takeaways_json, source_code)
SELECT
    id, id, filename, title, difficulty, teaches, directives_json,
    threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
    self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
    requires_gpu, expected_output_note, takeaways_json, source_code
FROM examples;
DROP TABLE examples;
ALTER TABLE examples_m5 RENAME TO examples;

CREATE INDEX IF NOT EXISTS idx_examples_lesson ON examples (lesson_id);

-- ── modules: versión publicable ─────────────────────────────────────────────
-- ALTER TABLE ADD COLUMN basta: no se toca ninguna constraint existente.
-- `modules."order"` SIGUE siendo UNIQUE global; por eso el instalador reasigna
-- el order sugerido cuando ya está tomado.
ALTER TABLE modules ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE modules ADD COLUMN checksum TEXT;
ALTER TABLE modules ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'
                                     CHECK (origin IN ('local','remote'));
ALTER TABLE modules ADD COLUMN published_at TEXT;

-- ── lesson_progress: cómo se completó (E4) ──────────────────────────────────
-- Distinguir «aprobó el quiz» de «dijo que la leyó» es lo que permite decidir,
-- al actualizar, si un `completed` sigue estando justificado (§8.4).
ALTER TABLE lesson_progress ADD COLUMN completed_via TEXT
    CHECK (completed_via IS NULL OR completed_via IN ('quiz','manual','run'));
ALTER TABLE lesson_progress ADD COLUMN completed_at TEXT;

-- ── installed_modules: el manifiesto de selección del estudiante ────────────
CREATE TABLE IF NOT EXISTS installed_modules (
    module_id          TEXT PRIMARY KEY REFERENCES modules(id) ON DELETE CASCADE,
    object_path        TEXT NOT NULL,               -- 'modulos/m9/v3.json'
    installed_version  INTEGER NOT NULL CHECK (installed_version > 0),
    installed_checksum TEXT NOT NULL,
    available_version  INTEGER,                     -- del último refresco del índice
    available_checksum TEXT,
    locally_modified   INTEGER NOT NULL DEFAULT 0 CHECK (locally_modified IN (0,1)),
    last_checked_at    TEXT,
    installed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── module_update_log: qué pasó en cada actualización ───────────────────────
-- Es la trazabilidad de la promesa «no perdiste nada»: guarda el informe de cada
-- merge para poder responderle al estudiante qué se conservó y qué se archivó.
CREATE TABLE IF NOT EXISTS module_update_log (
    id            TEXT PRIMARY KEY,                 -- uuid4().hex
    module_id     TEXT NOT NULL,
    from_version  INTEGER,
    to_version    INTEGER NOT NULL,
    report_json   TEXT NOT NULL CHECK (json_valid(report_json)),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_update_log_module
    ON module_update_log (module_id, created_at DESC);

PRAGMA foreign_keys = ON;

-- migration 6
-- S6 · CU-28: el taller guiado como TIPO de lección (informe de mejoras §3.2).
-- Un taller es una lección con `kind = 'taller'`: una guía de pasos ordenados,
-- cada uno con su casilla «Lo hice». Al marcar todos, la lección se completa
-- (`lesson_progress.completed = 1`, `completed_via = 'manual'`) y cuenta en el
-- progreso del módulo como cualquier otra, sin tocar los agregados.
--
-- `ADD COLUMN` basta: ni se reconstruye `lessons` ni se toca el CHECK de
-- `completion_rule`. En un taller esa regla SE IGNORA y se guarda 'viewed'
-- (el único valor que no exige quiz ni ejemplo); el endpoint genérico de
-- progreso no puede completarlo: solo los pasos (api-contract §12).
ALTER TABLE lessons ADD COLUMN kind TEXT NOT NULL DEFAULT 'leccion'
    CHECK (kind IN ('leccion','taller'));

-- Los pasos del taller, en orden `idx` = 0..n-1. `example_id` es opcional: si
-- existe, el paso ofrece «Abrir en el simulador» (taller CON código); si no, es
-- solo lectura y acción. Sin FK a `examples` a propósito: el snapshot valida la
-- referencia al cargar y la autoría al escribir, y un FK aquí haría que borrar
-- un ejemplo fallara por un paso que lo menciona.
CREATE TABLE IF NOT EXISTS workshop_steps (
    lesson_id      TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    idx            INTEGER NOT NULL CHECK (idx >= 0),
    title          TEXT NOT NULL CHECK (length(title) > 0),
    body_markdown  TEXT NOT NULL,
    example_id     TEXT,
    PRIMARY KEY (lesson_id, idx)
);

-- Las casillas «Lo hice». Sin FK a `lessons`, igual que `lesson_progress`: el
-- avance del estudiante sobrevive a que una versión nueva archive el taller
-- (data-model §8.3). Borrar la lección en autoría lo purga explícitamente
-- (`content_admin.delete_lesson`), como hace con el resto del progreso.
CREATE TABLE IF NOT EXISTS workshop_step_progress (
    lesson_id  TEXT NOT NULL,
    idx        INTEGER NOT NULL CHECK (idx >= 0),
    done_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (lesson_id, idx)
);
