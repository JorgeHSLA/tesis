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
