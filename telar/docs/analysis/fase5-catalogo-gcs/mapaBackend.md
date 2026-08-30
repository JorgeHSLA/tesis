# Mapa de impacto BACKEND — módulos publicables (E1 · E2 · versión/checksum · manifiesto)

Rutas relativas a `/mnt/d/universidad/tesis/telar/backend/`.

---

## 0. Hechos del mecanismo que condicionan todo lo demás

- `app/db.py:120-144` `apply_schema`: ejecuta **siempre** el bloque base (`executescript`, `CREATE ... IF NOT EXISTS`) y luego cada bloque `-- migration N` **solo si `schema_version < N`**, cada uno en su propio `executescript` + `INSERT INTO schema_version` + `commit()`, con `rollback()` ante excepción (`app/db.py:136-144`).
- `app/schema.sql:91-92` inserta `version = 1` en el bloque base ⇒ **en una DB nueva también corren las migraciones 2, 3, 4 y correrá la 5**. Por eso las tablas de contenido viven en la migración 2 y **las tablas nuevas deben ir SOLO dentro del bloque `-- migration 5`**, nunca en el bloque base (mismo patrón que `migration 2`/`migration 3`).
- `app/db.py:85` `_MIGRATION_MARK = ^--\s*migration\s+(\d+)\s*$` → el marcador debe ir **solo en su línea**, sin texto a la derecha.
- Precedente obligado para cambiar CHECK/UNIQUE: `app/schema.sql:196-272` (migración 4) — `PRAGMA foreign_keys = OFF` → tabla `*_m4` → `INSERT ... SELECT` → `DROP` → `RENAME` → recrear índices → `PRAGMA foreign_keys = ON`. **E1 y E2 obligan a ese procedimiento** (SQLite no altera CHECK ni UNIQUE in-place).

---

## 1. E1 — romper el 1:1 lección↔ejemplo

### 1.1 El punto de origen (DDL)

| Ubicación | Qué asume |
|---|---|
| `app/schema.sql:127` | `examples.id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE` — el id del ejemplo **es** el id de la lección; sin ejemplo no hay fila, y sin lección no puede haber ejemplo. |
| `app/schema.sql:241` | Copia literal del mismo constraint en `examples_m4` (la reconstrucción de la migración 4). **Hay que tocar los dos sitios o la migración 4 revive el constraint viejo en DBs antiguas.** |

**Diseño recomendado (mínima fricción):** invertir la FK.
`examples(id TEXT PRIMARY KEY, lesson_id TEXT UNIQUE REFERENCES lessons(id) ON DELETE CASCADE, …)`.
Ventajas concretas: (a) “lección sin ejemplo” = simplemente no hay fila en `examples`; (b) el `ON DELETE CASCADE` de `content_admin.delete_lesson` sigue funcionando **sin cambios**; (c) el seeder puede escribir `lesson_id = example.id` y **los fixtures actuales no cambian ni un byte** (round-trip byte-idéntico intacto, `tests/test_seed_content.py:52`). La variante “`lessons.example_id` FK → `examples(id)`” solo hace falta si se quiere un ejemplo compartido por varias lecciones (biblioteca); es más cara y rompe el CASCADE.

### 1.2 Puntos que asumen “toda lección tiene ejemplo” (rompen RUIDOSAMENTE)

| Archivo:línea | Qué pasa |
|---|---|
| `app/repositories/content.py:213` | `Lesson.example_id: str` → debe ser `str \| None`. |
| `app/repositories/content.py:498` | `example_id=lesson_id` en `_build_lessons` (hardcode del 1:1). |
| `app/repositories/content.py:501` | `enabled=catalog.examples[lesson_id].enabled` → **KeyError** con una lección sin ejemplo. |
| `app/repositories/content.py:433` | `_validate_enabled_questions`: `catalog.examples[lid].enabled` → **KeyError**. |
| `app/repositories/content.py:448` | `_build_examples`: `catalog.lessons[example_id]` → **KeyError** si un ejemplo no tiene lección. |
| `app/repositories/content.py:322-327` | `_validate_ids`: exige `set(examples) == set(lessons)`; es LA regla del 1:1 en fixtures. |
| `app/repositories/content.py:657` | `_load_lessons_from_db`: `example_id=lesson_id` hardcode. |
| `app/repositories/content.py:769-771` | `SELECT e.*, l.module_id, l."order" FROM examples e JOIN lessons l ON l.id = e.id` — **INNER JOIN por igualdad de id**. Con la FK invertida pasa a `JOIN lessons l ON l.id = e.lesson_id` (y si se admiten ejemplos huérfanos, `LEFT JOIN` + `module_id`/`order` nulos). |
| `app/repositories/content.py:575` | `lesson_id=example_id` en `_load_examples_from_db`. |
| `app/repositories/content_admin.py:335-355` | `insert_lesson_with_example`: inserta SIEMPRE el ejemplo con `body.id`. Necesita variante “lección sola” y `example_id` propio. |
| `app/repositories/content_admin.py:583-584` | `select_admin_example`: `JOIN lessons l ON l.id = e.id`. |
| `app/schemas/content.py:27` y `:73` | `ModuleLesson.example_id: str` / `LessonDetail.example_id: str` → `str \| None`. **Cambio de contrato: exige tocar `docs/architecture/api-contract.md` §4.1/§4.2 ANTES.** |
| `app/routers/modules.py:182`, `app/routers/lessons.py:46` | Propagan `lesson.example_id` al DTO. |
| `app/repositories/content_admin.py:89-92` | `example_exists` consulta `examples.id`; sigue valiendo, pero su semántica deja de ser “existe la lección”. |
| `app/schemas/admin.py:159-165` | `AdminLessonCreate` exige `example: AdminExampleBase` y `source_code: str` (obligatorios) → deben pasar a opcionales (`None` ⇒ lección sin ejemplo). Contrato §10.5. |
| `app/schemas/admin.py:172-181` | `AdminLessonDetail.example: AdminExample` obligatorio → `AdminExample \| None`. |

### 1.3 Los que rompen EN SILENCIO (los peligrosos)

1. **`app/repositories/content.py:648-649`**
   ```python
   example = examples.get(lesson_id)
   enabled = bool(example.enabled) if example is not None else False
   ```
   Una lección sin ejemplo queda `enabled=False` **sin ningún error**: desaparece de `lessons_enabled` (`app/routers/modules.py:150`), de `questions_enabled_total` (`:161-163`), del `ProgressSummary` (`app/routers/progress.py:85`) y del cómputo de módulo completado (`app/routers/progress.py:46-59`). El estudiante instala un módulo teórico y ve “0 lecciones habilitadas”. **`enabled` debe dejar de derivarse del ejemplo y pasar a columna propia de `lessons`.**

2. **`app/repositories/content_admin.py:642-645`** (`select_admin_lesson_detail`)
   ```python
   example = await select_admin_example(db, lesson_id)
   if example is None:
       # No debería ocurrir (invariante 1:1) — el grafo estaría roto.
       return None
   ```
   → `GET /api/v1/admin/lessons/{id}` devuelve **404 LESSON_NOT_FOUND para una lección que existe** (`app/routers/admin.py:134-137`). Además `content_writer.create_lesson:344-345` y `update_lesson:375-376` hacen `assert result is not None` ⇒ **AssertionError → 500** al crear/editar una lección sin ejemplo.

3. **`app/repositories/content_admin.py:520-542`** (`_lesson_refs`): ya usa `LEFT JOIN examples`, pero `enabled=bool(row["enabled"])` con `NULL` → `False` silencioso en todo el dashboard admin.

4. **`app/tools/seed_content.py:336`**
   ```python
   await _delete_not_in("examples", lesson_ids)
   ```
   `--prune` borra todo ejemplo cuyo `id` no sea un id de lección. Con ids de ejemplo desacoplados, **`--prune` destruye ejemplos válidos sin avisar**. Debe filtrar por `example_ids`, no por `lesson_ids`.

5. **`app/repositories/content.py:490 / 647`** `question_count = len(quiz.questions) if quiz else 0` y `has_quiz` — ya toleran ausencia de quiz; **la asimetría es que el ejemplo no la tolera**. Es la evidencia de que E1 y E4 son el mismo agujero.

6. **`app/tools/validate_content.py:78-82`** cuenta preguntas habilitadas con `lesson.enabled`, que hoy viene del ejemplo (ver punto 1).

---

## 2. E2 — `order` único por módulo (hoy UNIQUE GLOBAL)

### 2.1 DDL

| Ubicación | Qué hay |
|---|---|
| `app/schema.sql:117` | `"order" INTEGER NOT NULL UNIQUE CHECK ("order" > 0), -- orden GLOBAL` → pasa a `UNIQUE (module_id, "order")` como constraint de tabla. Requiere **reconstrucción de `lessons`** (procedimiento de la migración 4). |
| `app/schema.sql:124` | `idx_lessons_module ON lessons (module_id, "order")` — `DROP TABLE` se lo lleva; hay que recrearlo. |
| `app/schema.sql:108` | `modules."order" UNIQUE` **se queda global** (los módulos sí son un orden global). Ojo: publicar módulos de autores distintos hará chocar `modules."order"` → ver §3.4. |

### 2.2 Lo que deja de tener sentido: “orden global de lección”

Con E2, el orden de la ruta lineal pasa a ser la tupla **`(modules."order", lessons."order")`**. Todos estos sitios ordenan/validan por `lessons."order"` solo:

| Archivo:línea | Cambio |
|---|---|
| `app/repositories/content.py:764` | `SELECT * FROM lessons ORDER BY "order"` → `JOIN modules m … ORDER BY m."order", l."order"`. |
| `app/repositories/content.py:629-632` | `orders = [row["order"] …]; if len(orders) != len(set(orders)): raise "order global duplicado en DB"` → **falla en el primer módulo instalado**. Pasa a validar unicidad por `(module_id, order)`. |
| `app/repositories/content.py:667-670` | `prev/next_lesson_id` derivados del recorrido lineal; correcto solo si `ordered` viene con la clave compuesta. |
| `app/repositories/content.py:483` | `_build_lessons`: `sorted(catalog.lessons.items(), key=lambda kv: kv[1].order)` (fixtures). |
| `app/repositories/content.py:506-509` | prev/next de fixtures, mismo problema. |
| `app/repositories/content.py:364-370` | `_validate_orders`: “order de lección duplicado” global. |
| `app/repositories/content.py:743-745` | `lesson_ids=tuple(sorted(m.lessons, key=lambda lid: lessons[lid].order))`. |
| `app/repositories/content.py:807` | `lessons()` → `sorted(..., key=lambda l: l.order)`. Necesita clave compuesta (el record `Lesson` no lleva el order del módulo: hay que añadir un campo derivado o resolver contra `self._modules`). |
| `app/repositories/content.py:815` | `examples()` → mismo problema; y `Example.order` (`:186`) es el order **de la lección** (`:560`). |
| `app/repositories/content_admin.py:615-628` | `_adjacent_lesson_ids`: `WHERE "order" < ? ORDER BY "order" DESC LIMIT 1` — **prev/next global**. Con orders repetidos entre módulos devuelve vecinos de otro módulo. |

### 2.3 Validación de unicidad y reorder por lote

| Archivo:línea | Qué rompe |
|---|---|
| `app/repositories/content_admin.py:106-114` | `lesson_order_taken(db, order, exclude_id)` — consulta global, **sin `module_id`**. Debe pasar a `lesson_order_taken(db, module_id, order, exclude_id=…)`. |
| `app/services/content_writer.py:325-328` | `create_lesson` la llama sin módulo → rechazaría con `ORDER_CONFLICT` una lección legítima de otro módulo. |
| `app/services/content_writer.py:362-367` | `update_lesson` idem; **y aquí `body.module_id` puede MOVER la lección de módulo**: la comprobación debe hacerse contra el módulo **destino**. |
| `app/repositories/content_admin.py:180-183` | `all_lesson_orders` devuelve `{lesson_id: order}` plano → debe devolver `{lesson_id: (module_id, order)}`. |
| `app/services/content_writer.py:427-433` | El chequeo del conjunto final (`len(set(final.values())) != len(final)`) es global → debe agrupar por módulo. |
| `app/repositories/content_admin.py:225-251` | `_reorder` en dos fases: `SELECT COALESCE(MAX("order"),0) FROM {table}` y aparca en `park_base + offset` **global**. Con `UNIQUE(module_id,"order")` sigue siendo válido (aparcar por encima del máximo global nunca choca), pero **el `MAX` debe seguir siendo global aunque el UNIQUE sea por módulo** — si se “optimiza” a `MAX` por módulo se rompe el aparcado cuando el lote toca varios módulos. Documentarlo o hacer el aparcado por `(module_id, MAX+offset)`. |
| `app/repositories/content_admin.py:260-263` | `reorder_lessons` pasa `list[tuple[str,int]]`; con E2 necesita `module_id` por item (o restringir el reorder a un solo módulo). |
| `app/schemas/admin.py:77-88` | `AdminReorderItem(id, order)` — **no lleva `module_id`**. Cambio de contrato §10.2/§10.3: o se añade `module_id`, o el endpoint pasa a `PUT /admin/modules/{module_id}/lessons/reorder`. |

---

## 3. Tablas nuevas y DDL de la `-- migration 5`

### 3.1 Qué hace falta

1. **Versión + checksum del módulo** → columnas en `modules` (`ALTER TABLE ADD COLUMN` basta: verificado que SQLite 3.45 acepta `CHECK` y `NOT NULL DEFAULT` constante en `ADD COLUMN`; no acepta `UNIQUE` ni `PRIMARY KEY`).
2. **Manifiesto de selección** → tabla nueva `installed_modules` (una fila por módulo que el estudiante decidió incorporar, con la versión/checksum instalados y lo último visto en el bucket).
3. **E1 + E2** → reconstrucción de `lessons` y `examples`.
4. **E4** → columna de criterio de completado en `lessons` (§4 abajo).

### 3.2 Propuesta de bloque (estilo del archivo)

```sql
-- migration 5
-- Módulos publicables (Fase 5). Tres cosas a la vez, porque las tres exigen
-- reconstruir tablas y SQLite no altera CHECK/UNIQUE in-place
-- (sqlite.org/lang_altertable.html#otheralter, mismo procedimiento que la
-- migración 4):
--
-- E1 — el 1:1 lección↔ejemplo se rompe. `examples.id` dejaba de ser un id
--   propio (era `PRIMARY KEY REFERENCES lessons(id)`): una lección teórica NO
--   PODÍA existir sin código. Ahora `examples` tiene id propio y apunta a su
--   lección con `lesson_id UNIQUE` (0..1 ejemplo por lección). Se conserva el
--   ON DELETE CASCADE: borrar la lección sigue llevándose su ejemplo.
-- E2 — `lessons."order"` era UNIQUE GLOBAL: publicar un módulo nuevo obligaba
--   a renumerar el curso entero y hacía imposible actualizar un módulo sin
--   tocar los demás. Pasa a UNIQUE (module_id, "order"); la ruta lineal se
--   deriva de (modules."order", lessons."order").
-- E4 — criterio de completado para lecciones SIN quiz: `completion_rule`.
--   Hasta ahora `completed` solo lo escribía un quiz aprobado, así que una
--   lección sin quiz era incompletable salvo por PUT manual del cliente.
--
-- El backfill preserva el estado actual: todo ejemplo existente conserva su id
-- y hereda `lesson_id = id` (los fixtures NO cambian y el round-trip del
-- seeder sigue siendo byte-idéntico); `enabled` deja de derivarse del ejemplo
-- y se materializa en la lección con el valor vigente; `completion_rule` sale
-- de si la lección tiene o no preguntas hoy.
PRAGMA foreign_keys = OFF;

CREATE TABLE lessons_m5 (
    id                TEXT PRIMARY KEY,
    module_id         TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    "order"           INTEGER NOT NULL CHECK ("order" > 0),  -- orden DENTRO del módulo
    title             TEXT NOT NULL CHECK (length(title) > 0),
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 1),
    content_markdown  TEXT NOT NULL CHECK (length(content_markdown) > 0),
    pass_threshold    REAL NOT NULL CHECK (pass_threshold > 0.0 AND pass_threshold <= 1.0),
    recommended_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recommended_json)),
    enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
                                                 -- E1: ya NO se deduce de
                                                 -- examples.enabled (una lección
                                                 -- sin ejemplo quedaba oculta)
    completion_rule   TEXT NOT NULL DEFAULT 'quiz'
                      CHECK (completion_rule IN ('quiz','viewed','run')),
                                                 -- E4: 'quiz' exige aprobar el
                                                 -- quiz; 'viewed' se completa al
                                                 -- marcarla vista; 'run' al
                                                 -- terminar bien un job de su
                                                 -- ejemplo (job_runner, BL-05)
    UNIQUE (module_id, "order")                  -- E2: único POR MÓDULO
);
INSERT INTO lessons_m5
SELECT l.id, l.module_id, l."order", l.title, l.estimated_minutes,
       l.content_markdown, l.pass_threshold, l.recommended_json,
       COALESCE((SELECT e.enabled FROM examples e WHERE e.id = l.id), 1),
       CASE WHEN EXISTS (SELECT 1 FROM quiz_questions q WHERE q.lesson_id = l.id)
            THEN 'quiz' ELSE 'viewed' END
FROM lessons l;
DROP TABLE lessons;
ALTER TABLE lessons_m5 RENAME TO lessons;

CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_id, "order");

CREATE TABLE examples_m5 (
    id                    TEXT PRIMARY KEY,      -- id PROPIO (ya no == lesson_id)
    lesson_id             TEXT UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
                                                 -- NULL = ejemplo suelto (no lo
                                                 -- produce el CRUD admin, pero el
                                                 -- DDL ya no lo prohíbe); UNIQUE
                                                 -- = a lo sumo 1 ejemplo por lección
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
INSERT INTO examples_m5 SELECT
    id, id, filename, title, difficulty, teaches, directives_json,
    threads_configurable, fixed_threads, fixed_threads_note, sweeps_threads,
    self_measures, parser_id, default_timeout_s, est_run_seconds, enabled,
    requires_gpu, expected_output_note, takeaways_json, source_code
FROM examples;
DROP TABLE examples;
ALTER TABLE examples_m5 RENAME TO examples;

CREATE INDEX IF NOT EXISTS idx_examples_lesson
    ON examples (lesson_id) WHERE lesson_id IS NOT NULL;

PRAGMA foreign_keys = ON;

-- Identidad publicable del módulo. `version` es un entero MONÓTONO fijado por
-- el admin al publicar; `checksum` es el sha256 (64 hex) del bundle canónico y
-- es lo que permite decidir "hay actualización" sin descargar el contenido.
-- Un módulo local nunca publicado se queda en version=1 / checksum NULL.
ALTER TABLE modules ADD COLUMN version   INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE modules ADD COLUMN checksum  TEXT
     CHECK (checksum IS NULL OR length(checksum) = 64);
ALTER TABLE modules ADD COLUMN origin    TEXT NOT NULL DEFAULT 'local'
     CHECK (origin IN ('local','remote'));
ALTER TABLE modules ADD COLUMN published_at TEXT;   -- ISO-8601 UTC | NULL

-- MANIFIESTO DE SELECCIÓN (lo que el estudiante decidió incorporar y en qué
-- versión). Vive en SQLite, no en un archivo suelto: el JSON es formato de
-- INTERCAMBIO, no almacén local. CERO PII: aquí no hay identidad ni progreso,
-- solo la procedencia del contenido. Una fila por módulo instalado; se borra
-- con el módulo (CASCADE) porque desinstalar == quitar el módulo.
CREATE TABLE IF NOT EXISTS installed_modules (
    module_id           TEXT PRIMARY KEY REFERENCES modules(id) ON DELETE CASCADE,
    object_path         TEXT NOT NULL,             -- ruta del objeto en el bucket
    installed_version   INTEGER NOT NULL CHECK (installed_version >= 1),
    installed_checksum  TEXT NOT NULL CHECK (length(installed_checksum) = 64),
    available_version   INTEGER CHECK (available_version IS NULL
                                       OR available_version >= 1),
                                                   -- última versión vista en el
                                                   -- catálogo remoto (NULL = sin
                                                   -- comprobar); > installed ⇒
                                                   -- "actualización disponible"
    available_checksum  TEXT CHECK (available_checksum IS NULL
                                    OR length(available_checksum) = 64),
    last_checked_at     TEXT,                      -- ISO-8601 UTC | NULL
    installed_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_installed_pendientes
    ON installed_modules (module_id)
    WHERE available_version IS NOT NULL AND available_version > installed_version;
```

### 3.3 Consecuencias mecánicas del bloque

- `DROP TABLE lessons` con `foreign_keys = OFF` **no** cascadea a `quiz_questions`; al renombrar, su FK vuelve a resolver por nombre (comentario ya documentado en `app/schema.sql:189-192`).
- `lesson_progress` (`app/schema.sql:82-89`) y `quiz_attempts` (`:66-74`) **no tienen FK a `lessons`** — por eso el progreso sobrevive a la reconstrucción. Es exactamente la propiedad que hace viable “actualizar sin perder progreso”; no añadir esa FK.
- Hay que reflejar el DDL en `docs/architecture/data-model.md` §3/§7 (líneas 597-608 describen hoy `examples (id PK FK→lessons …)` y `lessons ("order" UNIQUE …)`) y el cambio de `example_id` a nullable en `api-contract.md` §4.1/§4.2/§10.5 **antes** de tocar código.

### 3.4 Riesgos de colisión que la migración NO resuelve (decidir en diseño)

- `modules."order" UNIQUE` global (`app/schema.sql:108`): dos módulos publicados por autores distintos con `order = 3` ⇒ `IntegrityError` en la instalación. El instalador debe **reasignar** el order al final (`MAX(order)+1`) y guardar el order “sugerido” del bundle aparte, o el UNIQUE debe caer.
- `quiz_questions.id TEXT PRIMARY KEY` **global** (`app/schema.sql:157`): ids de pregunta de módulos distintos pueden chocar. Ya existe el detector `content_admin.question_ids_in_other_lessons` (`app/repositories/content_admin.py:155-171`, CW-02); el instalador debe usarlo y rechazar el bundle con un error limpio en vez de reventar con `IntegrityError`.

---

## 4. Instalar un módulo desde un bundle JSON, reutilizando lo que existe

### 4.1 Forma del servicio (`app/services/module_installer.py`, nuevo)

```
install_module(app, bundle) -> AdminModule
  1. VALIDAR EN MEMORIA (fuera del lock, sin tocar DB)
  2. async with app.state.write_lock:            # reentrante, app/db.py:26-77
        …chequeos que leen DB (dentro del lock)…
        await content_writer._persist(app, _write)   # UNA unidad, UN commit
```

### 4.2 Qué se reutiliza, literal

| Pieza existente | Uso en la instalación |
|---|---|
| `app/services/content_writer.py:219-257` `_persist` | El corazón: ejecuta `write()` sin commit → `ContentRepository.load(db)` valida el grafo COMPLETO sobre los cambios sin commitear → `commit()` → swap de `app.state.content`. Rollback ante `ContentError` (grafo roto) y ante cualquier excepción. **Un bundle inválido no deja nada a medias.** Toma `app.state.content_read_lock` por dentro (`:238`) — el instalador no debe tenerlo ya tomado. |
| `app/db.py:26-81` `write_lock` (`ReentrantWriteLock`) | El instalador lo sostiene durante toda la unidad; las validaciones que leen DB (`module_exists`, `lesson_exists`, `question_ids_in_other_lessons`) corren dentro y nadie se intercala. |
| `app/repositories/content_admin.py:200-206` `insert_module` | Alta del módulo (más los campos nuevos `version`/`checksum`/`origin`). |
| `app/repositories/content_admin.py:335-355` `insert_lesson_with_example` | Alta lección+ejemplo por cada entrada del bundle **que traiga ejemplo**; con E1 se parte en `insert_lesson` + `insert_example(lesson_id=…)` para poder insertar lecciones teóricas. |
| `app/repositories/content_admin.py:466-492` `replace_quiz` | Alta del quiz de cada lección: ya hace `UPDATE lessons.pass_threshold` + `DELETE` + `INSERT` de preguntas. |
| `app/services/content_writer.py:91-122` `_example_coherence_issues`, `:166-213` `_quiz_issues`, `:125-146` `_recommended_issues`, `app/services/markdown_validator.validate` | **La validación del contenido remoto es exactamente la del contenido admin.** Reutilizarlas tal cual y devolver `CONTENT_VALIDATION_ERROR` con `details=[{field, reason}]` (`content_writer.py:60-65`). Contenido remoto = entrada no confiable ⇒ mismo rigor, ya está escrito. |
| `app/services/content_writer.py:82-88` `_check_code_size` | Tope de `source_code` de cada ejemplo del bundle contra `settings.max_code_bytes`. |
| `app/repositories/content_admin.py:155-171` `question_ids_in_other_lessons` | Colisión de ids de pregunta entre módulos (§3.4). |
| `app/tools/seed_content.py:59-123` (los 4 `UPSERT … ON CONFLICT(id) DO UPDATE`) | **El camino de ACTUALIZAR un módulo ya instalado es el UPSERT del seeder, no `delete_lesson`.** Es idempotente por PK y por eso no toca `lesson_progress`. |
| `app/tools/seed_content.py:206-308` `_apply_seed_statements` | El orden de inserción correcto ya está resuelto: `modules → lessons → examples → quiz_questions`. Copiarlo. |
| `app/services/docker_service.py:108-131` `DockerServicePort` (`typing.Protocol`) | Patrón a replicar para el bucket: `BucketPort` con `list_catalog()`, `fetch_module(object_path) -> bytes`; el real usa lectura anónima; los tests inyectan un `FakeBucket` en `app.state`, como `tests/fakes/fake_docker.py`. |

### 4.3 Trampas que hay que evitar explícitamente

- **NO usar `content_admin.delete_lesson`** (`app/repositories/content_admin.py:376-391`) para actualizar: purga `lesson_progress` y `quiz_attempts` a propósito (BL-01). Un “update = borrar + recrear” **destruye el progreso** — justo el requisito que este trabajo debe garantizar. Actualizar = UPSERT sobre los mismos `lesson_id` (ese es el porqué del invariante de ids estables).
- **Borrar lo que ya no está en la nueva versión** sí requiere borrado; ahí sí hay que decidir explícitamente si se purga el progreso de la lección desaparecida (hoy `delete_lesson` lo hace).
- **`replace_quiz` + reset de progreso**: `content_writer.py:543-553` resetea `best_quiz_score`/`completed` cuando cambia el nº de preguntas o el umbral (BL-06). Una actualización de módulo que reescriba quizzes disparará ese reset — decidir si el instalador lo aplica (coherente) o lo evita comparando quizzes idénticos.
- **`app/services/quiz_service.py:187-221` `_ensure_content_current`**: revalida dentro del lock que el quiz no cambió mientras el intento esperaba. Una instalación concurrente hará abortar intentos en vuelo con `QuizValidationError` (422). Es el comportamiento correcto, pero hay que documentarlo (y el frontend debe mostrar “el contenido se actualizó, recarga”).
- **El marcador de seed** (`app/tools/seed_content.py:44` `content_seeded_at`, consumido en `app/main.py:61-79`): instalar un módulo **no** debe tocarlo, y `_seed_content_if_unseeded` cuenta `SELECT COUNT(*) FROM lessons` (`app/main.py:74`) — si el primer arranque de un despliegue “solo remoto” encuentra lecciones instaladas hará backfill del marcador y no sembrará el baseline. Comportamiento a decidir a conciencia.
- `app/services/content_state.py:27-30` `reload_content` está **sin usar** en todo el repo (grep sin resultados fuera del propio archivo): hace el swap **sin commit**. No usarlo en el instalador; el camino correcto es `_persist`.

---

## 5. Invariantes que dejan de valer y qué los sustituye

| Invariante actual | Dónde vive | Estado tras este trabajo |
|---|---|---|
| `EXPECTED_LESSON_COUNT = 14` | `app/repositories/content.py:38`, usada en `:328-332` (`_validate_ids`) | **Muere como invariante del sistema.** Solo tiene sentido como “el bundle baseline versionado en el repo tiene 14 lecciones”. Sustituto: mover el conteo a un chequeo **del fixture baseline** (opt-in en `from_fixtures(..., strict_baseline=True)` o directamente a `app/tools/validate_content.py`), y en el sistema sustituirlo por invariantes **por módulo**: ≥1 lección por módulo, `(module_id, order)` único y contiguo, ids de lección estables entre versiones. |
| `EXPECTED_ENABLED_QUESTIONS = 60` | `app/repositories/content.py:40`, usada en `:427-439` | Igual: deja de ser global. Sustituto: por lección, `has_quiz ⇒ ≥1 pregunta`, `correct_key ∈ opciones` (ya en `:600-604` y `:295-313`), `UNIQUE(lesson_id, order)` (DDL `app/schema.sql:164`), y `question_count` como **dato reportado por módulo**, no como umbral. |
| `set(examples) == set(lessons)` (1:1) | `app/repositories/content.py:322-327` | Muere con E1. Sustituto: `examples.lesson_id` `UNIQUE` + `FK` (el DDL lo garantiza) y “si `lesson.example_id` no es NULL, el ejemplo existe” (lo verifica ya `ContentRepository.load` en `_persist`). |
| `order` de lección globalmente único | `app/repositories/content.py:364-370` (fixtures) y `:629-632` (DB) | Muere con E2. Sustituto: único por `(module_id, order)` + orden de la ruta lineal por `(modules."order", lessons."order")`. |
| `lesson.example_id == lesson.id` | `app/repositories/content.py:498`, `:657`; documentado en `content_admin.py:11-13` | Muere. Sustituto: `example_id` derivado de `examples.lesson_id` y nullable. |
| “`lessons` vacía ⇒ primer arranque” | ya sustituido por `content_seeded_at` (`app/schema.sql:168-178`, `app/main.py:61-79`) | Sigue válido, pero hay que revisarlo para despliegues sin baseline (§4.3). |
| **Nuevos** invariantes que hay que introducir | — | (a) `lesson_id` **estable entre versiones del mismo módulo** — comprobable en la instalación comparando ids instalados vs ids del bundle y avisando de los que desaparecen; (b) `installed_modules.installed_checksum` == sha256 del bundle efectivamente aplicado; (c) `modules.version` monótona: rechazar un bundle con `version <= installed_version` salvo reinstalación forzada. |

---

## 6. Riesgo sobre los 205 tests del backend

### 6.1 Rotura garantizada (hay que reescribir el test)

| Test | Línea | Por qué |
|---|---|---|
| `tests/test_content.py::test_invariantes_14_14_14` | `:31-38` | `len(lessons) == EXPECTED_LESSON_COUNT == 14` y `lesson.example_id == lesson.id`. Ambas premisas mueren. |
| `tests/test_content.py::test_60_preguntas_habilitadas` | `:44-50` | `EXPECTED_ENABLED_QUESTIONS`. |
| `tests/test_content.py::test_menos_de_14_lecciones` | `:186-197` | Espera `ContentError` con `match="14"`; si el conteo deja de validarse, **no lanza** y el test falla. |
| `tests/test_content.py::test_total_de_preguntas_habilitadas_roto` | `:249-256` | Espera `match="preguntas habilitadas"`. Ídem. |
| `tests/test_content.py::test_examples_y_lessons_desalineados` | `:178-184` | Espera `match="mismos ids"` — es la validación del 1:1. |
| `tests/test_content.py` importa las constantes | `:14-15` | `ImportError` si se eliminan ⇒ **el módulo entero (25 tests) falla en colección**. Mantenerlas exportadas aunque solo se usen para el baseline. |
| `tests/test_routers_content.py::test_examples_listado_14_sin_codigo` | `:24-27` | `assert [e["order"] for e in examples] == list(range(1,15))`. Si se renumeran los fixtures a orders per-módulo (1,2,1,2,…) el test cae. **Mitigación fuerte: NO renumerar `app/content/catalog.json` en este trabajo** — sus orders actuales (1..14 globales, verificado) siguen siendo válidos bajo `UNIQUE(module_id,"order")` y el orden compuesto produce la MISMA secuencia. |
| `tests/test_routers_content.py::test_modules_catalogo_completo` | `:61-83` | `summary == {lessons_total:14, lessons_enabled:13, quizzes_total:14, questions_enabled_total:60}` — cualquier deriva de `enabled` (punto 1.3.1) lo rompe en silencio de forma visible aquí. **Es el mejor canario de la refactorización de `enabled`.** |
| `tests/test_seed_content.py::test_seed_report_conteos` / `::test_seed_conteos_snapshot` / `::test_seed_idempotente` | `:42-48`, `:63-73`, `:89-113` | Conteos 8/14/14/65/60 y `COUNT(*)` por tabla. Sobreviven **solo si** el seeder sigue escribiendo 14 ejemplos con `lesson_id = id`; es el argumento para la FK invertida de §1.1. |
| `tests/test_admin_content.py::test_crud_leccion_ejemplo_quiz_feliz` | `:245-291` | Depende de `AdminLessonCreate.example` obligatorio y de `AdminLessonDetail.example` no nulo. |
| `tests/test_audit_s4.py::test_bl20_reorder_lecciones_swap` | `:372-388` | `AdminReorderItem` sin `module_id`; si el DTO cambia, el payload del test deja de validar. |
| `tests/test_audit_s4.py::test_bl20_reorder_*` (módulos) | `:325-371` | Sobreviven si `modules."order"` sigue UNIQUE global; **caen si se relaja** para permitir instalaciones. |

### 6.2 Rotura silenciosa / cambio de semántica (revisar test por test)

| Test | Línea | Riesgo |
|---|---|---|
| `tests/test_admin_content.py::test_leccion_order_conflict_409` | `:307-316` | Usa el **mismo** módulo (`mTest` por defecto en `_lesson_payload`, `:109-113`) ⇒ **sigue dando 409 con E2**. Pero deja de cubrir el caso nuevo: falta un test “mismo order en OTRO módulo ⇒ 201”. |
| `tests/test_admin_content.py::test_delete_lesson_limpia_recommended_colgante` | `:493-511` | Crea `lA` order=90 y `lB` order=91 en el mismo módulo — sobrevive. |
| `tests/test_admin_content.py` BL-01/BL-06 | `:565-660` | Dependen de `delete_lesson` purgando progreso y del reset de quiz. Si el instalador reusa esas rutas, estos tests documentan el comportamiento que hay que **no** heredar en “actualizar módulo”. |
| `tests/test_content.py::test_ruta_lineal_prev_next` | `:73-79` | Pasa mientras el orden compuesto reproduzca la secuencia actual. Es el test que detecta un `ORDER BY` mal compuesto. |
| `tests/test_content.py::test_interfaz_congelada_lookups` | `:100-107` | `exists_example("spmd")` sigue valiendo solo si los ids de ejemplo no cambian. |
| `tests/test_repositories.py::test_schema_idempotente_y_version` | `:27-36` | `version >= 0` — tolerante. Pero **la migración 5 corre también sobre la DB `:memory:` de TODOS los tests** (`tests/conftest.py:94`, `:109`, `:188`): un error de sintaxis SQL en el bloque 5 **tumba las 205 pruebas de golpe** (`apply_schema` lanza y el fixture `db`/`app` falla en setup). |
| `tests/test_repositories.py::test_migraciones_por_bloques` / `::test_migracion_rota_hace_rollback` | `:68-98` | Usan un `_MINI_SCHEMA` propio, no `app/schema.sql` → inmunes. |
| `tests/test_app_lifespan.py::test_bl21_*` | `:226-262` | Dependen de `SELECT COUNT(*) FROM lessons` y del marcador; si el instalador o el DDL alteran el arranque, caen aquí. |
| `tests/test_quiz_atomicity.py` (6 tests) | `:118-170` | `_ensure_content_current`: dependen de que cambiar el quiz “en vuelo” aborte. La instalación concurrente entra por el mismo camino — extender aquí, no romper. |
| `tests/test_review_fixes.py::test_e2e_admin_crea_estudiante_ve_y_corre` | `:128+` | Recorrido admin→público completo: es el test que primero detecta `example_id` nulo mal propagado a los DTO. |
| `tests/test_routers_jobs.py` (58 tests) | `:59-102` | Usan `real_content.example("spmd"/"primerEjemplo")`; solo caen si cambian los ids de ejemplo. Otro argumento para conservarlos. |
| `tests/conftest.py:99-121` `_seed_and_load` + fixture `real_content` (scope `session`) | — | Todo el suite lee el snapshot **desde la DB sembrada**. Cualquier regresión en `ContentRepository.load` (JOIN de examples, ORDER BY compuesto) se propaga a las ~150 pruebas que dependen de `real_content`/`client`. Verificar `load` primero, en aislamiento. |

### 6.3 Orden de trabajo que minimiza el daño

1. Actualizar `docs/architecture/data-model.md` y `api-contract.md` (contratos congelados) — spec antes que código.
2. Escribir el bloque `-- migration 5` y verificarlo solo con `tests/test_repositories.py` + un test nuevo de backfill (`examples.lesson_id = id`, `lessons.enabled` heredado, `completion_rule` derivado).
3. `ContentRepository.load` (JOIN + ORDER BY compuesto + `enabled` propio) con `tests/test_seed_content.py::test_seed_no_data_loss` como red: si el round-trip fixtures↔DB sigue byte-idéntico, el 80 % del suite está a salvo.
4. `content_admin` + `content_writer` (order por módulo, reorder, lección sin ejemplo).
5. Schemas/routers (`example_id` nullable) — aquí caen los tests de contrato.
6. Instalador de bundles + `BucketPort` + `FakeBucket`, sobre `_persist`.

### 6.4 Cobertura

`--cov-fail-under=80` (hoy 93.79 %): el instalador, el `BucketPort` y las ramas nuevas de validación de bundle son código nuevo sin tests; sin pruebas propias el margen se consume rápido. Los caminos que **exigen** test nuevo: bundle con checksum inválido, bundle con `version <= installed_version`, bundle que cambia un `lesson_id` (pérdida de progreso), colisión de `quiz_questions.id`, colisión de `modules."order"`, y actualización que conserva `lesson_progress`.