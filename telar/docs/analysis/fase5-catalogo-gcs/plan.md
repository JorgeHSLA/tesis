# Plan de implementación — Módulos publicables (Fase 5) · Telar

Raíz: `/mnt/d/universidad/tesis/telar`. Rutas de backend relativas a `backend/`, de frontend a `frontend/`.
Sin `make` en el entorno (`which make` → vacío): los comandos van directos (`cd backend && pytest`, `npm --prefix frontend run test`).

---

## 0. Reconciliaciones previas (los cuatro documentos se contradicen; esto decide)

Antes de escribir una línea hay que cerrar seis conflictos entre los documentos de diseño. **`api-contract.md` manda**, pero su §11 está marcada *PROPUESTO — pendiente de congelar*, así que se puede enmendar; lo que no se puede es implementar algo distinto de lo que diga §11 una vez escrita.

| # | Conflicto | Decisión | Por qué |
|---|---|---|---|
| **R1** | Formato del bundle: `"schema": "telar.module.bundle/1"` (doc JSON) vs `bundle_format: 1` + `checksum` embebido (api-contract §11.10) | **Gana api-contract**: `bundle_format`, `index_format`, `checksum` dentro del bundle. Del doc JSON se importan íntegras las **reglas de endurecimiento** (§4.1–§4.4: claves duplicadas, control chars, bidi/Trojan Source, nombres reservados, ruta derivada, topes por capas) | El contrato es la autoridad; el endurecimiento es aditivo y no colisiona |
| **R2** | Checksum: «sha256 de los bytes exactos, nunca re-serializar» (doc JSON) vs «sha256 del bundle **sin** su campo `checksum`, canónico `sort_keys=True, separators=(",",":")`» (api-contract §11.8.2) | **Gana api-contract** (con `checksum` embebido, hashear los bytes crudos es circular). El footgun de re-serialización se mata con **una única función compartida**, `catalog_hash.canonical_bundle_bytes()`, usada por publicador **e** instalador, más un **golden test** que fija como literal el digest de `m1 v1`. Además `index.size_bytes == len(raw)` **exacto** como detector barato de truncado, antes del sha256 | Un solo algoritmo, un solo sitio, un test que se rompe si alguien cambia `ensure_ascii` |
| **R3** | Lecciones que desaparecen: `progress: "orphaned"` + fila de `lessons` borrada (api-contract §11.6.2) vs **archivado** `archived_at` (doc de merge, A4/§6-bis) | **Gana el archivado.** Se enmienda §11.6.2/§11.6.3: `ProgressEffect` pasa de `preserved\|reset\|orphaned\|none` a **`preserved\|rescored\|archived\|none`**, y `on_removed_lessons` de `keep_progress\|purge` a **`archive`(default)`\|purge`** | Con `orphaned` la fila de `lessons` desaparece y `quiz_attempts.lesson_id`/`jobs.lesson_id` (sin FK) quedan sin título resoluble: el historial de jobs pasa a decir «lección desconocida». Archivar es reversible a coste cero (caso A6) |
| **R4** | `reset` de `completed` al cambiar el quiz (api-contract §11.6.2, hereda BL-06) vs **monotonía de `completed`** (doc de merge, P2) | **Gana la monotonía.** Una actualización **nunca** baja `completed`; solo anula/recalcula `best_quiz_score` (por eso el efecto se llama `rescored`, no `reset`). El reset ciego se conserva **solo** en la ruta admin (`content_writer:543-553`), que es acto del autor sobre su propia máquina | Si actualizar puede empeorarte, nadie actualiza y el mecanismo entero muere |
| **R5** | Lección retirada ⇒ `409 LESSON_REMOVAL_REQUIRES_CONFIRM` (doc JSON §5.3) vs archivar en silencio con warning (doc merge A4) | **Se elimina el 409.** Se archiva sin bloquear; el aviso vive en `GET …/update/preview` (§11.6.2) y en `report.warnings`. `LESSON_REMOVAL_REQUIRES_CONFIRM` **no entra** en `errors.py` | Con archivado no se pierde nada: un 409 bloqueante solo añade fricción sin proteger nada |
| **R6** | `recommended` cross-módulo: podar al leer vs podar al instalar vs `409` | **Podar al leer.** `content.py:676` `_validate_recommended_from_db` deja de lanzar `ContentError` y descarta del snapshot en memoria las entradas cuyo destino no está instalado; `recommended_json` conserva la lista completa del autor | Sin esto, instalar `m1` en base vacía revienta: sus 4 `recommended` apuntan a m2/m4/m6 → `ContentError` dentro de `_persist` → `500`. Es un fallo garantizado del primer caso de uso |
| **R7** | `AdminReorderItem` gana `module_id` vs endpoint nuevo `PUT /admin/modules/{id}/lessons/reorder` | **`AdminReorderItem.module_id: str \| None = None`**, resuelto en servidor contra el módulo actual de la lección cuando falta | El payload de `tests/test_audit_s4.py:372-388` sigue validando ⇒ ese test no se rompe. Cambiar la ruta lo rompería sin ganancia |

**Decisión adicional (no está en ningún documento, y es la que hace el E2E posible):**

**R8 — `TELAR_CATALOG_DRIVER ∈ {gcs, http_local}`.** El puerto de lectura tiene dos adaptadores; el de escritura, dos también:

- `gcs` (producción): lectura **anónima con `httpx`** contra `storage.googleapis.com` (dos GET, sin SDK — mantiene `requests`/`urllib3`/`google-auth`/`google-crc32c` **fuera** del árbol de la imagen estudiante); escritura con el SDK + OAuth, solo en la imagen admin.
- `http_local` (tests/E2E/desarrollo): lectura con el mismo `httpx` contra `TELAR_CATALOG_ENDPOINT`; escritura a `TELAR_CATALOG_LOCAL_ROOT` (un directorio). **Se rechaza en arranque si `TELAR_CATALOG_ENDPOINT` no es loopback.**

Ambos drivers recorren **exactamente** el mismo código de validación, checksum, instalación y merge. Es lo que permite el journey E2E completo sin GCP.

---

## 1. Orden de commits

> Regla transversal: la spec de `docs/architecture/` va **siempre** antes del código que la implementa. `pytest` se corre desde `backend/`; `npm --prefix frontend run test && npm --prefix frontend run typecheck` desde la raíz (o desde `~/.telar-build/repo` por la regla WSL/ext4 del Makefile).

### Fase 0 — Spec (contratos congelados)

**C1 · `docs(contract): §11 catálogo remoto — reconciliaciones R1..R8 y ediciones a §1.1/§2.2/§4/§6.2/§9/§10`**
Archivos: `docs/architecture/api-contract.md`.
Contenido exacto: las 13 filas nuevas de §11.13 en la tabla de §9; las 12 filas de códigos en §1.1 (**menos** `LESSON_REMOVAL_REQUIRES_CONFIRM`, R5); bloque `catalog` en §2.2; §4.1 `ModuleLesson.example_id → str|null`, `+completion_rule`, `Module.version/origin/update_available`, `ModulesSummary.modules_installed/modules_updatable`, nota de huecos en `order`; §4.2 idem + `archived: bool`; §6.2 E4 (`completed=true` legítimo solo si `completion_rule != "quiz"`); §10.1 deroga `lesson_id == example_id`; §10.3 `AdminLessonCreate.example/source_code` opcionales, `AdminReorderItem.module_id` opcional (R7); §10.4 `AdminExample.id` propio + `lesson_id`, endpoints `POST/DELETE /admin/lessons/{id}/example`; §10.6 `ORDER_CONFLICT` por `(module_id, order)`; §11 completa con R1–R5 aplicadas (`ProgressEffect = preserved|rescored|archived|none`, `on_removed_lessons = archive|purge`).
Verde: `pytest -q` y `npm --prefix frontend run test` **sin cambios** (205 backend / suite frontend).

**C2 · `docs(data-model): migración 5, installed_modules y por qué el progreso sobrevive`**
Archivos: `docs/architecture/data-model.md`.
§3 DDL completo del bloque `-- migration 5`; §3.1 esquemas de bundle e índice como *formato de intercambio, no almacén*; §5 `Lesson.example_id: str|None`, `enabled` como columna propia, `+completion_rule/+archived_at`, `Example.lesson_id`, orden lineal `(modules."order", lessons."order")`, `EXPECTED_*` degradadas a invariantes **del baseline de fixtures** (R6 incluido: poda al leer); §7.2 quitar `Lesson.example_id (==id)` y `enabled (de examples.enabled)` de «campos derivados»; §7.4 el instalador usa `_persist`, nunca `content_state.reload_content`; **§8 nueva** (manifiesto, ausencia deliberada de FK `lesson_progress → lessons`, cero PII).
Verde: igual que C1.

### Fase 1 — DDL

**C3 · `feat(db): migración 5 — E1, E2, E4, archivado y manifiesto de selección`**
Archivos: `backend/app/schema.sql` (bloque `-- migration 5`, marcador solo en su línea por `db.py:85`), `backend/tests/test_migration5.py` (nuevo).
Contenido: reconstrucción `lessons_m5` (`enabled` propio, `completion_rule`, `archived_at`, **sin** `UNIQUE` de tabla) + `CREATE UNIQUE INDEX idx_lessons_order_vivas ON lessons(module_id,"order") WHERE archived_at IS NULL` (índice **parcial**, no constraint: si no, una lección archivada sigue ocupando su slot y la nueva revienta con `IntegrityError`); reconstrucción `examples_m5` (`id` propio + `lesson_id TEXT UNIQUE REFERENCES lessons(id) ON DELETE CASCADE`, backfill `lesson_id = id`); `ALTER TABLE modules ADD COLUMN version/checksum/origin/published_at/archived_at`; `ALTER TABLE lesson_progress ADD COLUMN completed_via/completed_at`; `CREATE TABLE installed_modules` (+`locally_modified`); `CREATE TABLE module_update_log`. Procedimiento `PRAGMA foreign_keys=OFF` → `*_m5` → `INSERT…SELECT` → `DROP` → `RENAME` → recrear índices → `ON`, calcado de la migración 4 (`schema.sql:196-272`).
**Propiedad clave:** en el baseline `example.id == lesson.id`, así que el `JOIN … ON l.id = e.id` de `content.py:769` **sigue funcionando** y la suite entera queda verde con la migración aplicada y cero cambios de código.
Verde: `pytest -q` completa (205) + `pytest tests/test_migration5.py` (backfill: `examples.lesson_id = id` en las 14 filas, `lessons.enabled` = el `enabled` del ejemplo → 13/14, `completion_rule='quiz'` en las 14, índice parcial deja archivar y reusar el `order`).

### Fase 2 — Snapshot y repositorios (E1 · E2 · E4 locales)

**C4 · `refactor(content): example_id opcional y enabled propio en el snapshot de DB`**
Archivos: `backend/app/repositories/content.py` (`Lesson.example_id: str|None` :213; `_load_lessons_from_db` :657 deja de hardcodear; `enabled` sale de `lessons.enabled`, no de `content.py:648-649`; `_load_examples_from_db` :575; el `SELECT` de :769-771 pasa a `JOIN lessons l ON l.id = e.lesson_id`), `backend/app/tools/seed_content.py` (UPSERT de `lessons` con `enabled` + `completion_rule`; de `examples` con `lesson_id`; **`--prune` :336 filtra por `example_ids`, no por `lesson_ids`**).
**No se toca `from_fixtures`**: `EXPECTED_LESSON_COUNT`/`EXPECTED_ENABLED_QUESTIONS` y `set(examples)==set(lessons)` (:322-327) siguen vigentes ahí, porque esa ruta solo valida el baseline versionado. Eso salva 6 tests que el mapa daba por rotos.
Verde: `pytest tests/test_seed_content.py tests/test_content.py tests/test_routers_content.py` — en particular `test_seed_no_data_loss` (round-trip byte-idéntico) y `test_modules_catalogo_completo` (`13/14/14/60`, el canario del refactor de `enabled`). Luego `pytest -q` completa.

**C5 · `refactor(content): ruta lineal por (modules.order, lessons.order) y poda de recommended`**
Archivos: `backend/app/repositories/content.py` (:764 `ORDER BY m."order", l."order"`; :629-632 unicidad por `(module_id, order)`; :667-670 prev/next sobre el orden compuesto; :743-745, :807, :815 claves de orden compuestas; **:676 `_validate_recommended_from_db` deja de lanzar y poda**, R6).
Verde: `pytest tests/test_content.py::test_ruta_lineal_prev_next` + suite completa. `catalog.json` **no se renumera** (sus orders 1..14 globales siguen siendo válidos bajo el índice parcial y producen la misma secuencia) ⇒ `test_examples_listado_14_sin_codigo` sigue verde.

**C6 · `feat(schemas): example_id nullable, completion_rule y archived en los DTO de §4`**
Archivos: `backend/app/schemas/content.py` (:27, :73), `backend/app/routers/modules.py` (:182), `backend/app/routers/lessons.py` (:46).
Verde: `pytest tests/test_routers_content.py tests/test_review_fixes.py`.

**C7 · `feat(admin): lección sin ejemplo, orden por módulo y ejemplo como recurso propio`**
Archivos: `backend/app/repositories/content_admin.py` (`insert_lesson_with_example` :335-355 se parte en `insert_lesson` + `insert_example`; `lesson_order_taken(db, module_id, order, exclude_id)` :106-114; `all_lesson_orders` :180-183 → `{id: (module_id, order)}`; `select_admin_example` :583-584 JOIN por `lesson_id`; `select_admin_lesson_detail` :642-645 **deja de devolver `None`** cuando no hay ejemplo — hoy es un 404 sobre una lección que existe; `_lesson_refs` :520-542 `enabled` desde la lección; nuevo `example_ids_in_other_modules`), `backend/app/services/content_writer.py` (:325-328, :362-367 contra el módulo **destino**; :427-433 agrupando por módulo; :344-345 y :375-376 quitan el `assert result is not None`), `backend/app/schemas/admin.py` (:159-165, :172-181, `AdminReorderItem.module_id` opcional), `backend/app/routers/admin.py` (+`POST/DELETE /admin/lessons/{id}/example`).
Verde: `pytest tests/test_admin_content.py tests/test_audit_s4.py` + 2 tests nuevos: mismo `order` en **otro** módulo ⇒ `201`; crear lección sin `example` ⇒ `201` y `GET /admin/lessons/{id}` ⇒ `200` con `example: null`.

**C8 · `feat(progress): completion_rule, completed_via y rescore absoluto`**
Archivos: `backend/app/repositories/content_admin.py` (**`rescore_progress_no_commit`**, hermano de `reset_quiz_progress` :501-514 pero con valor: `UPDATE` absoluto que **sí puede bajar y escribir `NULL`**), `backend/app/routers/progress.py` (E4: `completed=true` del cliente solo si `completion_rule != 'quiz'`, deja `completed_via='manual'`), `backend/app/services/quiz_service.py` (:150-152 escribe `completed_via='quiz'`), `backend/app/services/job_runner.py` (:675-690 concede `completed` cuando `completion_rule='run'`), `backend/app/schemas/progress.py`.
Verde: `pytest tests/test_quiz_atomicity.py` + nuevo `test_progress_e4.py`, con el test que demuestra que **`ProgressRepository.upsert` NO sirve** (su `_UPSERT_SQL` aplica `MAX()` y `COALESCE()`: es incapaz de bajar `best_quiz_score` o de escribir `NULL`; un merge que pase por ahí deja la nota obsoleta pegada para siempre).

### Fase 3 — Catálogo remoto (backend)

**C9 · `feat(catalog): DTOs del formato de intercambio y endurecimiento de entrada`**
Archivos: `backend/app/schemas/catalog.py` (transcripción literal de §11.11.1), `backend/app/services/bundle_guard.py` (parseo con `object_pairs_hook` que **rechaza claves duplicadas**; `RecursionError` → 422 y nunca 500; UTF-8 estricto + rechazo de BOM; prohibición de C0 salvo `\n\t`, de `U+202A..202E`/`U+2066..2069` (Trojan Source) y de zero-width en ids; nombres reservados `con/prn/aux/nul/com1..9/lpt1..9/catalog/index/modulos`; colisión case-insensitive; `FILENAME_PATTERN` + tallo con al menos un alfanumérico; **ruta siempre derivada**, `index.object_path` solo se compara por igualdad).
Verde: `pytest tests/test_bundle_schema.py` (nuevo, ~25 casos hostiles).

**C10 · `feat(catalog): serialización canónica y checksum compartido`**
Archivos: `backend/app/services/catalog_hash.py` (`canonical_bundle_bytes(bundle) -> bytes`, `bundle_checksum(bundle) -> str`), `backend/tests/fixtures/bundles/m1-v1.json` (generado desde `backend/app/content/`), `backend/tests/test_catalog_hash.py` (**golden**: digest literal).
Verde: `pytest tests/test_catalog_hash.py`.

**C11 · `feat(catalog): CatalogReadPort, adaptador httpx anónimo, driver local y FakeCatalog`**
Archivos: `backend/app/services/catalog_client.py` (`typing.Protocol` calcado de `DockerServicePort` en `docker_service.py:108-131`: `fetch_index(*, max_bytes) -> bytes`, `fetch_module(module_id, version, *, max_bytes, generation=None) -> bytes`; el tope de bytes pertenece **al puerto**, para que el fake no pueda olvidarlo; lectura con corte duro durante la transmisión y sobre bytes **descompri­midos**; traducción de errores que incluye `google.auth.exceptions.GoogleAuthError` — un `except GoogleCloudError` **no basta**, un bucket privado sale como `InvalidOperation`, no como `Forbidden`), `backend/tests/fakes/fake_catalog.py`, `backend/app/config.py` (`TELAR_CATALOG_*`, `TELAR_GCS_*`, R8).
Verde: `pytest tests/test_catalog_client.py` (nuevo; cero red).

**C12 · `feat(catalog): plan de merge puro (module_merge)`** ← *el commit que congela la doctrina*
Archivos: `backend/app/services/module_merge.py` (`build_plan(local, bundle, opts) -> MergePlan`, `plan_progress(...)`: **sin DB, sin red, sin FastAPI**), `backend/app/schemas/updates.py`, `backend/tests/test_module_merge_plan.py`.
Reglas encapsuladas: comparación de quiz **por conjunto de ids**, jamás por `total` (trampa B9: 5==5 con otras preguntas); recalificación exacta desde `quiz_attempts.answers` cuando ids y opciones coinciden (B8, B6); `completed = prev.completed or gained` (monotonía, R4); archivar si la lección fue tocada, borrar limpio si nunca lo fue (A4/A5); `order` del módulo **intacto** en actualización (D5); warning `POSIBLE_RENOMBRADO` sin transferir progreso (D8).
Verde: `pytest tests/test_module_merge_plan.py` — toda la tabla §6 (A1–A14, B1–B13, C1–C13, D1–D8, E1–E5) como unit tests sin DB. Es donde se gana la cobertura frente a `--cov-fail-under=80`.

**C13 · `feat(catalog): repositorio del manifiesto de selección y caché del índice`**
Archivos: `backend/app/repositories/catalog.py` (`installed_modules` CRUD sin commit + caché del índice), `backend/tests/test_repo_catalog.py`.
Verde: ese test.

**C14 · `feat(catalog): instalador de módulos sobre _persist`**
Archivos: `backend/app/services/module_installer.py`.
Estructura: validar **fuera** del lock → `async with app.state.write_lock:` → chequeos que leen DB (`module_exists`, `question_ids_in_other_lessons` :155-171, `example_ids_in_other_modules`) → `content_writer._persist(app, _write)` (una unidad, un commit, revalidación del grafo, swap atómico). Orden de inserción `modules → lessons → examples → quiz_questions` (copiado de `seed_content.py:206-308`). Reasignación `modules."order" = MAX+1` con `order_reassigned: true`. **No toca `content_seeded_at`.**
Verde: `pytest tests/test_module_install.py` (nuevo).

**C15 · `feat(catalog): actualizador que preserva el progreso (CU-39)`**
Archivos: `backend/app/services/module_updater.py` (`update_module`, `apply_plan`).
`apply_plan` empieza por **aparcar los `order`** (dos fases, reusando el truco de `content_admin._reorder:225-251`: SQLite valida el índice único *por statement*, un swap l2↔l3 revienta a mitad de transacción). Todo por `UPSERT ON CONFLICT(id)`. **Prohibido `content_admin.delete_lesson`** (`:376-391` purga `lesson_progress` y `quiz_attempts` por diseño, BL-01) y **prohibido `content_state.reload_content`** (`content_state.py:27-30`, hace el swap **sin commit**; además está muerto en todo el repo).
Verde: `pytest tests/test_module_update.py` (nuevo) — incluido `test_cu39_actualizar_nunca_pierde_progreso`.

**C16 · `feat(catalog): endpoints /api/v1/catalog/*`**
Archivos: `backend/app/routers/catalog.py`, `backend/app/errors.py` (12 códigos de §11.3), `backend/app/main.py` (wiring de `app.state.catalog`), `backend/tests/conftest.py` (fixture `fake_catalog` + `include_router(catalog.router)` en `build_app`).
Verde: `pytest -q` completa.

**C17 · `feat(admin-catalog): publicador con OAuth loopback+PKCE y driver local`**
Archivos: `backend/app/services/catalog_publisher.py`, `backend/app/schemas/admin_catalog.py`, `backend/app/routers/admin_catalog.py`, `backend/requirements-admin.txt` (nuevo: `google-cloud-storage>=3.13,<4`, `google-auth-oauthlib>=1.4,<2` — **fuera** de `requirements.txt`), `backend/Dockerfile` (los 3 archivos nuevos a la lista de borrado con `TELAR_ADMIN_BUILD=0`, junto a los de §10.0).
Detalles fijados por la investigación: `InstalledAppFlow.run_local_server(host="127.0.0.1", port=0, timeout_seconds=300, prompt="consent")` — `timeout_seconds=None` es bloqueo **indefinido**; el PKCE S256 ya lo hace la librería (`Flow.authorization_url`); `run_console` **ya no existe** (OOB bloqueado desde 31-ene-2023). Subida con `if_generation_match=0` (versión inmutable) e índice con CAS `if_generation_match=<generation>`. `storage.Client(project=…)` con credencial de usuario **exige** `project` o lanza `OSError`. Token a `TELAR_CATALOG_TOKEN_PATH` con `0600`, **nunca** en SQLite ni en el repo. Captura de `RefreshError`/`invalid_grant` → `403 CATALOG_AUTH_REQUIRED` (el consent screen en modo Testing caduca el `refresh_token` **cada 7 días**).
Verde: `pytest tests/test_admin_catalog.py` (con driver `http_local`, sin red ni OAuth real) + `pytest tests/test_app_lifespan.py::test_bl21_*` (el módulo admin ausente no rompe el arranque).

### Fase 4 — Frontend

**C18 · `feat(api): tipos del catálogo remoto y example_id nullable`**
Archivos: `frontend/src/api/catalog-types.ts` (nuevo, §11.11.3), `frontend/src/api/types.ts` (:153, :196 → `string | null`; `ModuleDto.version/origin/update_available`; 12 códigos en la unión **cerrada** `ApiErrorCode` :29-51), `frontend/src/api/admin-types.ts` (§11.11.4), `frontend/src/api/catalog.ts` (nuevo).
Verde: `npm --prefix frontend run typecheck` **falla a propósito** en los 8 sitios del §1.1 del mapa frontend — es la lista de trabajo de C19. Los tests se corren tras C19.

**C19 · `fix(learn): una lección puede no tener ejemplo`**
Archivos: `LearnScreen.tsx` (:49-52, :101-108, :176, :181-182, :238-243, :244, :245), `LessonInfo.tsx` (tabs 3→1 sin ejemplo, `download()` :41-49, takeaways :82-93, `highlightDirectives` :97, CTAs :106-117), `LessonMedia.tsx` (rekey del mapa de videos a `lesson_id`, `lessonVideos.ts:33/105-106`), `LessonSidebar.tsx:55`, `ModuleAccordion.tsx` (:22-28 tercer `kind: 'reading'`; :57-59 mata el `?? !l.enabled`; :110-112 mata el `?? true`), `LessonRow.tsx` (:13, :45-47, :58-62), `ContinueCard.tsx` (:24,:27 fuera el `'primerEjemplo'` hardcodeado), `ExamplePicker.tsx:32`, `SimulatorIdle.tsx:96-97` (`!== ''` → `!= null`), `admin/dashboard/LessonAdminRow.tsx:66-68`, `styles/screens/catalog.css` (`.cat-lesson-icon.reading`).
Verde: `npm --prefix frontend run typecheck && npm --prefix frontend run test`.

**C20 · `feat(progress): marcar completada sin quiz (E4)`**
Archivos: `stores/progressStore.ts` (`markCompleted` junto a `markViewed` :31/:66-81; saneo de `lastLessonId` colgado en `hydrate` :49-64), `LearnScreen.tsx` (botón tras :245, condicionado a `!lesson.has_quiz` — hoy ese `else` está vacío).
Verde: `tests/stores/progressStore.test.ts` ampliado.

**C21 · `feat(store): catalogStore y catalogDiff`**
Archivos: `frontend/src/lib/catalogDiff.ts`, `frontend/src/stores/catalogStore.ts`, `frontend/tests/lib/catalogDiff.test.ts`, `frontend/tests/stores/catalogStore.test.ts`.
Regla: cada `install/update/remove` con éxito llama `useProgressStore.getState().hydrate(true)` **y** `loadExamplesIndex(true)` (`api/content.ts:77` ya acepta `force`) — sin eso los metas quedan en `—` hasta recargar la app. **Nada se persiste**: el manifiesto vive en SQLite; duplicarlo en localStorage crearía una segunda fuente de verdad.
Verde: ambos tests (`src/lib/**` y `src/stores/**` están en `vitest.config.ts:33` con criterio ≥80 %, así que nacen con test obligatorio).

**C22 · `feat(store): pantalla /modulos`**
Archivos: `frontend/src/features/store/ModuleStoreScreen.tsx` + `StoreToolbar.tsx` + `StoreModuleCard.tsx`, `frontend/src/styles/screens/store.css`, `router.tsx` (ruta hermana `{ path: 'modulos', … }`, **no** `/cursos/algo`: un `lesson_id` remoto llamado `tienda` quedaría inaccesible para siempre), `components/shell/Sidebar.tsx:42-45` (`IconDownload`, no `IconLayers` — ya es «Autoría»), `components/shell/TopBar.tsx:30-41`.
Verde: `npm --prefix frontend run test` con `router.test.tsx` actualizado (7 → 8 rutas, rama nueva en el `fakeFetch` :38-58).

**C23 · `feat(catalog): chips y banner de actualización en /cursos`**
Archivos: `CatalogScreen.tsx` (efecto **no bloqueante**: si el refresh falla, no hay chips y **no** hay `ErrorState` — el modo offline es un caso de uso, no un fallo), `ModuleAccordion.tsx` (chip `tone="blue"` en `.cat-module-meta` :74-80; banner `.cat-update-banner` hermano de `.gpu-banner` :95-102 — **no** un botón dentro del `<button>` de :65), `styles/screens/catalog.css`.
Copy obligatoria: **«Tu progreso se conserva»**. Es la promesa que sostiene el invariante; si no se dice, nadie actualiza.
Verde: suite frontend.

**C24 · `feat(admin-ui): importar y publicar módulos`**
Archivos: `frontend/src/features/admin/catalog/AdminPublishDialog.tsx`, `AdminImportDialog.tsx`, `frontend/src/api/admin-catalog.ts`, `router.tsx` + `Sidebar.tsx:50-59` **dentro del `if (ADMIN_BUILD)`** (para que caiga por tree-shaking en el build estudiante).
Verde: `tests/admin/api-admin-catalog.test.ts` (nuevo).

### Fase 5 — E2E y cierre

**C25 · `test(e2e): journey publicar → incorporar → aprobar → actualizar sin perder progreso`**
Archivos: `e2e/` (nuevo workspace, §5.3).
Verde: `npm --prefix e2e run test:e2e`.

**C26 · `docs: operación del bucket, OAuth del admin y limitación de los 7 días`**
Archivos: `docs/architecture/architecture.md` §10.5 (tabla de env vars), `README.md`, `docs/architecture/implementation-plan.md`.

---

## 2. Archivos nuevos

| Ruta | Responsabilidad |
|---|---|
| `backend/app/schemas/catalog.py` | DTOs de §11.11.1: bundle, índice, estado, install/update/preview. `extra="forbid"` en todo lo que venga del bucket |
| `backend/app/schemas/admin_catalog.py` | DTOs de §11.11.2. **ADMIN-ONLY**: se borra de la imagen con `TELAR_ADMIN_BUILD=0` |
| `backend/app/schemas/updates.py` | `MergePlan`, `ProgressOp`, `UpdateReport` — tipos del plan puro, sin dependencia de FastAPI |
| `backend/app/services/bundle_guard.py` | Parseo endurecido: claves duplicadas, `RecursionError`, UTF-8/BOM, C0, bidi (Trojan Source), zero-width, nombres reservados, colisión case-insensitive, `filename` degenerado, derivación de rutas |
| `backend/app/services/catalog_hash.py` | `canonical_bundle_bytes()` / `bundle_checksum()` — **la** definición del checksum, compartida por publicador e instalador (R2) |
| `backend/app/services/catalog_client.py` | `CatalogReadPort` (`typing.Protocol`) + `HttpxAnonimoAdapter` + `LocalHttpAdapter` + traducción de excepciones (incluye `GoogleAuthError`) |
| `backend/app/services/catalog_publisher.py` | `CatalogWritePort` + `GcsSdkAdapter` (OAuth loopback+PKCE, `if_generation_match=0`, CAS del índice) + `LocalDirAdapter`. **ADMIN-ONLY** |
| `backend/app/services/module_merge.py` | **Función pura** `build_plan()` + `plan_progress()`. Toda la doctrina de §6 del doc de merge. Sin DB, sin red |
| `backend/app/services/module_installer.py` | Instalación inicial sobre `content_writer._persist` |
| `backend/app/services/module_updater.py` | `update_module()` (red fuera del lock, DB dentro) + `apply_plan()` (aparcado de orders, UPSERT, archivado, rescore) |
| `backend/app/repositories/catalog.py` | CRUD sin commit de `installed_modules`, caché del índice, `module_update_log` |
| `backend/app/routers/catalog.py` | §11.4–§11.6: `/catalog/status`, `/refresh`, `/remote`, `/remote/{id}`, `/install`, `/modules/{id}/update[/preview]`, `DELETE /modules/{id}` |
| `backend/app/routers/admin_catalog.py` | §11.7–§11.8: `/admin/catalog/auth` (GET/POST/DELETE), `/admin/catalog/import`, `/admin/modules/{id}/publish`. **ADMIN-ONLY** |
| `backend/requirements-admin.txt` | `google-cloud-storage`, `google-auth-oauthlib` — fuera del árbol de producción del estudiante |
| `backend/tests/fakes/fake_catalog.py` | Bucket en memoria detrás del `Protocol`. Fabrica los casos hostiles (truncado, checksum falso, bomba, clave duplicada, bidi). **Ningún test toca la red** |
| `backend/tests/fixtures/bundles/*.json` | `m1-v1.json`, `m1-v2.json` (una lección más), `m1-v2-rename.json`, `m1-v0-downgrade.json`, `index-v1.json`, `index-v2.json` |
| `backend/tests/test_migration5.py` · `test_bundle_schema.py` · `test_catalog_hash.py` · `test_catalog_client.py` · `test_repo_catalog.py` · `test_module_merge_plan.py` · `test_module_install.py` · `test_module_update.py` · `test_admin_catalog.py` · `test_progress_e4.py` | Ver §5.1 |
| `frontend/src/api/catalog-types.ts` · `catalog.ts` · `admin-catalog.ts` | DTOs y capa de datos del catálogo remoto |
| `frontend/src/lib/catalogDiff.ts` | `diffCatalog(installed, remote)` — puro y testeable (cobertura ≥80 % obligatoria) |
| `frontend/src/stores/catalogStore.ts` | Tercera fuente de verdad: catálogo remoto + estado transitorio de descarga. **No persiste nada** |
| `frontend/src/features/store/ModuleStoreScreen.tsx` (+ `StoreToolbar`, `StoreModuleCard`) | Pantalla `/modulos` |
| `frontend/src/styles/screens/store.css` | Solo tokens existentes; **cero hex nuevos**, cero dark mode manual |
| `frontend/tests/lib/catalogDiff.test.ts` · `stores/catalogStore.test.ts` · `features/store/ModuleStoreScreen.test.tsx` · `admin/api-admin-catalog.test.ts` | Ver §5.2 |
| `e2e/playwright.config.ts` · `e2e/package.json` · `e2e/tests/cu39-modulos.spec.ts` · `e2e/fixtures/bucket/**` · `e2e/scripts/serve-bucket.mjs` | Ver §5.3 |

---

## 3. Archivos modificados

| Ruta | Qué cambia |
|---|---|
| `docs/architecture/api-contract.md` | §1.1 (+12 códigos), §2.2 (bloque `catalog`), §4.1/§4.2 (`example_id` nullable, `completion_rule`, `archived`, `version`, `origin`), §6.2 (E4), §9 (+13 filas), §10.1/§10.2/§10.3/§10.4/§10.6, **§11 nueva** |
| `docs/architecture/data-model.md` | §3 (migración 5), §3.1 (bundle/índice), §5 (records), §7.2/§7.4, **§8 nueva** |
| `backend/app/schema.sql` | Bloque `-- migration 5` (marcador solo en su línea, `db.py:85`). **Nada en el bloque base** — se ejecuta siempre |
| `backend/app/repositories/content.py` | :213 `example_id: str\|None`; :575, :629-632, :648-649, :657, :667-670, :743-745, :764, :769-771, :807, :815; :676 poda en vez de lanzar. **`from_fixtures` intacto** |
| `backend/app/repositories/content_admin.py` | :89-92, :106-114, :155-171 (reuso), :180-183, :225-263, :335-355 (split), :520-542, :583-584, :615-628, :642-645; **nuevos** `rescore_progress_no_commit`, `example_ids_in_other_modules`, `archive_lesson`, `unarchive_lesson` |
| `backend/app/services/content_writer.py` | :325-328, :344-345, :362-367, :375-376, :427-433. `_persist` (:219-257), `_example_coherence_issues` (:91-122), `_quiz_issues` (:166-213), `_check_code_size` (:82-88) se **reutilizan sin tocar** desde el instalador |
| `backend/app/services/quiz_service.py` | :150-152 `completed_via='quiz'`. `_ensure_content_current` (:187-221) **no se toca**: es lo que aborta intentos en vuelo durante una instalación concurrente |
| `backend/app/services/job_runner.py` | :675-690 concede `completed` con `completion_rule='run'` |
| `backend/app/tools/seed_content.py` | UPSERTs :59-123 con `lesson_id`/`enabled`/`completion_rule`; **:336 `--prune` por `example_ids`** |
| `backend/app/tools/validate_content.py` | :78-82 `lesson.enabled` ya no viene del ejemplo |
| `backend/app/schemas/content.py` · `admin.py` · `progress.py` | `example_id` nullable, `completion_rule`, `archived`, `completed_via`/`completed_at`, `AdminReorderItem.module_id` opcional |
| `backend/app/routers/modules.py` · `lessons.py` · `progress.py` · `admin.py` | Propagación de DTOs + `POST/DELETE /admin/lessons/{id}/example` |
| `backend/app/errors.py` | 12 códigos de §11.3 (**sin** `LESSON_REMOVAL_REQUIRES_CONFIRM`, R5) |
| `backend/app/config.py` | 9 vars `TELAR_CATALOG_*` / `TELAR_GCS_*` + `TELAR_CATALOG_DRIVER` (R8) |
| `backend/app/main.py` | `app.state.catalog` en el lifespan; `include_router(catalog.router)` y, tras el `try/except ImportError` de :186-210, `admin_catalog.router` |
| `backend/Dockerfile` | 3 archivos más en el borrado de `TELAR_ADMIN_BUILD=0`; `requirements-admin.txt` solo en la imagen admin |
| `backend/tests/conftest.py` | Fixture `fake_catalog`; `app.state.catalog` y `include_router(catalog.router)` en `build_app` (:225-247) |
| `compose.yaml` | Env vars del catálogo, con defaults vacíos (catálogo desactivado ⇒ `503 CATALOG_DISABLED`) |
| `frontend/src/api/types.ts` | :29-51 `ApiErrorCode`, :153, :196, `ModuleDto`, `ModulesSummaryDto` |
| `frontend/src/router.tsx` · `components/shell/Sidebar.tsx` · `TopBar.tsx` | Ruta `/modulos` + navegación |
| `frontend/src/features/learn/*` · `catalog/*` · `simulator/*` · `admin/dashboard/LessonAdminRow.tsx` | E1 (§1 del mapa frontend) |
| `frontend/src/stores/progressStore.ts` | `markCompleted`, saneo de `lastLessonId`, contrato de `hydrate(true)` post-instalación |
| `frontend/src/lib/lessonVideos.ts` | Mapa rekeyado por `lesson_id` |
| `frontend/src/styles/screens/catalog.css` | `.cat-lesson-icon.reading`, `.cat-update-banner` |
| `frontend/tests/fixtures/rest.ts` · `router.test.tsx` · `features/learn/*.test.tsx` · `admin/AdminLessonEditor.test.tsx` | Ver §4 |

---

## 4. Puntos de ruptura

### 4.1 Backend — lo que **NO** se rompe (y por qué), decisiones que lo consiguen

| Test | Sobrevive porque |
|---|---|
| `test_content.py::test_invariantes_14_14_14` (:31-38) | El backfill deja `examples.lesson_id = id` ⇒ `lesson.example_id == lesson.id` sigue siendo cierto **en el baseline** |
| `test_content.py::test_60_preguntas_habilitadas` (:44-50) · `test_routers_content.py::test_modules_catalogo_completo` (:61-83) | El seeder escribe `lessons.enabled` desde el `enabled` del ejemplo del fixture ⇒ sigue siendo 13/14 y 60 preguntas. **Es el canario del refactor de `enabled`: si se olvida el cambio en `seed_content.py`, m8 pasa a `enabled=1` por defecto y el conteo salta a 65** |
| `test_content.py::test_menos_de_14_lecciones`, `::test_total_de_preguntas_habilitadas_roto`, `::test_examples_y_lessons_desalineados` | Usan `from_fixtures`, que **queda estricto**. `EXPECTED_LESSON_COUNT`/`EXPECTED_ENABLED_QUESTIONS` siguen exportadas (:14-15 del test las importa: eliminarlas tumbaría los 25 tests del módulo en colección) |
| `test_routers_content.py::test_examples_listado_14_sin_codigo` (:24-27) | **No se renumera `app/content/catalog.json`**: sus orders 1..14 globales son válidos bajo el índice parcial por módulo y el `ORDER BY` compuesto produce la misma secuencia |
| `test_routers_jobs.py` (58 tests) · `test_content.py::test_interfaz_congelada_lookups` | Los ids de ejemplo no cambian (`example.id` se conserva en el backfill) |
| `test_audit_s4.py::test_bl20_reorder_lecciones_swap` (:372-388) | R7: `AdminReorderItem.module_id` es **opcional**; el payload actual sigue validando |
| `test_admin_content.py::test_leccion_order_conflict_409` (:307-316) | `_lesson_payload` (:109-113) usa el mismo `mTest` ⇒ sigue dando 409 |
| `test_repositories.py::test_migraciones_por_bloques` / `::test_migracion_rota_hace_rollback` | Usan `_MINI_SCHEMA` propio, no `app/schema.sql` |

### 4.2 Backend — lo que **sí** se rompe

| Test | Rotura | Adaptación |
|---|---|---|
| `test_admin_content.py::test_crud_leccion_ejemplo_quiz_feliz` (:245-291) | `AdminLessonDetail.example` pasa a `AdminExample \| None` | El payload sigue enviando `example` ⇒ compila y pasa. **Añadir** `test_crear_leccion_sin_ejemplo` y `test_admin_lesson_detail_sin_ejemplo_da_200` (hoy `content_admin.py:642-645` devuelve `None` ⇒ 404 sobre una lección que existe, y `content_writer:344-345/375-376` revienta con `AssertionError` → 500) |
| `test_admin_content.py` BL-01/BL-06 (:565-660) | Siguen verdes, pero cambian de rol: pasan a **documentar el comportamiento que el actualizador NO hereda** | Añadir docstring que lo diga y enlazar a `test_module_update.py` |
| `test_content.py::test_recommended_apuntan_a_lecciones_existentes` (:82-85) | Con la poda (R6), el snapshot ya no puede contener colgantes… pero el test seguiría pasando trivialmente | Reescribir como: *fixture con recommended a lección inexistente ⇒ `load` **no lanza** y la entrada **no aparece** en el snapshot* |
| `test_app_lifespan.py::test_bl21_*` (:226-262) | `SELECT COUNT(*) FROM lessons` en `main.py:74` cuenta también archivadas | Verde tal cual (en el baseline no hay archivadas), pero **añadir** el filtro `archived_at IS NULL` y un test del despliegue «solo remoto» |
| `test_quiz_atomicity.py` (6 tests, :118-170) | Verdes | **Extender** con `test_actualizacion_concurrente_aborta_intento_en_vuelo` (B12) |
| **Toda la suite** | Un error de sintaxis en el bloque `-- migration 5` tumba **las 205 pruebas de golpe** (la migración corre sobre la DB `:memory:` de `conftest.py:94/:109/:188`) | C3 es un commit aislado que solo avanza si `pytest -q` sigue en 205 verdes |

### 4.3 Frontend

| Test | Rotura | Adaptación |
|---|---|---|
| `tests/router.test.tsx` (:38-58, :75, :108-112) | El catch-all `:57` `envelope(null)` convierte cualquier endpoint nuevo en `ApiError` ⇒ `/modulos` pintaría `ErrorState`; el `describe` dice «7 rutas» | Rama nueva en `fakeFetch` para `/api/v1/catalog/*`; 7 → 8 rutas |
| `tests/features/simulator/CodePanel.test.tsx` (:91, :103-140) | ⚠️ **Trampa**: si la lección sin ejemplo entra en el fixture compartido `MODULES`, el autoselect de `SimulatorIdle.tsx:96-97` la elige y el test *«ejemplo sin editar → example_id + lesson_id»* falla | Fixture **aparte** `MODULES_CON_LECTURA` en `tests/fixtures/rest.ts`. **No contaminar `MODULES`** |
| `tests/features/learn/LessonInfo.test.tsx` (:13-38) | Los 3 `it` existentes sobreviven | Añadir «sin ejemplo ⇒ una sola tab, sin CTAs, sin takeaways» |
| `tests/features/learn/LessonMedia.test.tsx` (:14-17, :22, :41) | El mapa de videos se rekeyea a `lesson_id` ⇒ cambian props y el mock de `resolveLessonVideo` | Reescribir props; la suite sigue siendo el guardián de `resolveYouTubeEmbed` frente a URLs de contenido remoto |
| `tests/admin/AdminLessonEditor.test.tsx` (:30-44, :63) | `EXAMPLE_STUB` + `LESSON_DETAIL.example` obligatorio, invariante C7 (`AdminLessonEditor.tsx:196-201, 236-254`) | Toggle «¿tiene ejemplo ejecutable?»; test de creación sin ejemplo |
| `tests/fixtures/rest.ts` (:70, :81, :91-97, :315-338) | Compila, pero no cubre ningún caso sin ejemplo; si `ModulesSummaryDto` gana campos, cascadea a 4 consumidores (`router.test.tsx:44`, `progressStore.test.ts:7/20/43`, `CodePanel.test.tsx:91`) | Actualizar el fixture en el **mismo** commit que el DTO |
| `tests/features/shell/TopBar.test.tsx` | No se rompe (no asevera `routeMeta` exhaustivamente) | Caso nuevo para `/modulos` |

---

## 5. Plan de pruebas

### 5.1 pytest (backend) — **cero red, siempre**

`FakeCatalogService` (`tests/fakes/fake_catalog.py`) implementa `CatalogReadPort` sobre un `dict[str, bytes]`, exactamente como `FakeDockerService` implementa `DockerServicePort`. Fixture `fake_catalog` en `conftest.py`, inyectado en `app.state.catalog` por `build_app`.

**Migración y esquema** (`test_migration5.py`) — backfill `examples.lesson_id = id` en las 14 filas; `lessons.enabled` heredado (13 en 1, 1 en 0); `completion_rule='quiz'` en las 14; el índice **parcial** permite archivar `l2` y crear otra lección con `order=2` sin `IntegrityError`; idempotencia (`apply_schema` dos veces); `schema_version = 5`.

**Formato de intercambio** (`test_bundle_schema.py`, ~30 casos):
*transporte/bytes* — bundle > `max_bundle_bytes` cortado **durante** la transmisión sin acumular; `Content-Encoding: gzip` que expande por encima del tope (contar solo lo que llega por el cable es el error clásico); `len(raw) != index.size_bytes`; UTF-8 inválido; BOM.
*parseo hostil* — clave JSON duplicada (`correct_key` dos veces: Python se queda con la última en silencio y el validador vería una cosa y el escritor otra); anidamiento profundo ⇒ `RecursionError` capturado, **nunca 500**; raíz que no es objeto; campo extra en bundle (rechazo) vs en índice (ignorado).
*ids y rutas* — `module_id` con `../`, `/`, `%2e%2e`, NUL; `index.object_path` ≠ ruta derivada; `module_id = "CON"`; `Hola` vs `hola`; `filename = "..py"`; `U+202E` en `source_code` (Trojan Source: el código que lee el estudiante no sería el que ejecuta el contenedor — exactamente el ataque a cerrar en una plataforma que enseña leyendo código y luego corriéndolo).
*semántica* — `correct_key` fuera de opciones; `parser_id` inventado; markdown con `<script>`/`javascript:`/fence sin cerrar (delegado a `markdown_validator.validate`, sin tocarlo); `order` con hueco (1,3); `completion_rule="run"` sin ejemplo; `="quiz"` sin quiz; `source_code` > `max_code_bytes`.

**Checksum** (`test_catalog_hash.py`) — golden con digest literal de `m1-v1.json`; round-trip publicador↔instalador; `checksum` distinto ⇒ mismatch.

**Plan de merge** (`test_module_merge_plan.py`) — **puro, sin DB ni red**, toda la tabla §6: A1–A14, B1–B13, C1–C13, D1–D8, E1–E5. Los imprescindibles: `test_mismo_total_distinto_set_invalida_la_nota` (B9), `test_correct_key_corregida_recalifica_intentos` (B8), `test_umbral_baja_concede_completed_desde_historico` (B6), `test_umbral_sube_no_revoca_completed` (B7), `test_quiz_eliminado_conserva_completed_y_attempts` (B4), `test_rename_de_id_avisa_y_no_transfiere_progreso` (D8).

**Repos** (`test_repo_catalog.py`, `test_progress_e4.py`) — `test_rescore_puede_anular_best_score` **y su pareja** `test_upsert_no_puede_bajar_best_score`, que demuestra que `ProgressRepository._UPSERT_SQL` (con `MAX()`/`COALESCE()`) es incapaz y por eso hace falta el `UPDATE` absoluto.

**Instalación** (`test_module_install.py`) — instalar `m1` en base vacía **con sus 4 `recommended` cross-módulo ⇒ éxito** (el que fija R6); instalar `m2` después ⇒ el enlace `primerEjemplo → spmd` aparece **sin reinstalar m1**; `suggested_order` tomado ⇒ reasignación a `MAX+1` sin error; colisión de `quiz_questions.id` ⇒ `409 DUPLICATE_ID` **limpio, no `IntegrityError`→500**; colisión de `examples.id` (riesgo **nuevo** que abre E1); bundle inválido ⇒ `422` con `details` y **DB intacta**.

**Actualización** (`test_module_update.py`) — el test que da sentido al trabajo:

```python
async def test_cu39_actualizar_nunca_pierde_progreso(client, fake_catalog):
    """Progreso sembrado en TODAS las lecciones de m3; aplicar v2..v6 (que añaden,
    quitan, mueven, renumeran y reescriben quizzes) deja invariante:
      · ninguna fila de lesson_progress desaparece,
      · ninguna fila de quiz_attempts desaparece,
      · ningún `completed` pasa de True a False,
      · report.progress.lost == [] en las cuatro actualizaciones."""
```

Más: `test_descarga_truncada_no_toca_la_db` (la red vive **fuera** del `write_lock`: no hubo ni una sentencia); `test_red_fuera_del_lock_no_bloquea_jobs`; `test_preview_no_escribe_y_coincide_con_lo_aplicado`; `test_salto_v2_a_v5_equivale_a_v4_a_v5`; `test_misma_version_distinto_checksum_se_rechaza`; `test_downgrade_rechazado_por_defecto`; `test_leccion_archivada_accesible_pero_fuera_de_la_ruta`; `test_historial_de_jobs_sobrevive_al_archivado`.

**Cobertura**: `--cov-fail-under=80` (hoy 93,79 %). El grueso lo aporta `test_module_merge_plan.py` — decenas de casos a coste cero por ser el plan una función pura.

### 5.2 vitest (frontend)

- `tests/lib/catalogDiff.test.ts` — instalado vs remoto: igual / desactualizado / nuevo / **desaparecido del bucket**.
- `tests/stores/catalogStore.test.ts` — `install` con éxito ⇒ `hydrate(true)` **y** `loadExamplesIndex(true)`; fallo de red **no** deja `op` colgado en `'downloading'`; el store **no persiste**.
- `tests/stores/progressStore.test.ts` — `markCompleted`; saneo de `lastLessonId` colgado tras desinstalar.
- `tests/features/store/ModuleStoreScreen.test.tsx` — skeleton → lista; `ErrorState` con `onRetry`; `EmptyState`; confirmación «Quitar módulo — **tu progreso se conserva**».
- `tests/features/catalog/CatalogScreen.test.tsx` — **bucket caído ⇒ `/cursos` renderiza igual, sin `ErrorState`, sin chips**. Es el test del requisito offline.
- `tests/features/learn/*` — lección sin ejemplo en `LearnScreen`/`LessonInfo`/`ModuleAccordion`.

### 5.3 Playwright E2E — **no existe hoy** (`find -name playwright.config*` → vacío); se crea en C25

**Workspace nuevo `e2e/`** con `@playwright/test`, Node 22 vía nvm, ejecutado desde `~/.telar-build/repo` (regla WSL/ext4 del Makefile: nunca `npm ci` sobre `/mnt/d`).

**Cómo se simula el bucket sin GCP** — driver `http_local` (R8), tres `webServer` en `playwright.config.ts`:

1. **Bucket**: `node e2e/scripts/serve-bucket.mjs --root $TMPDIR/telar-e2e/bucket --port 8091 --host 127.0.0.1` — servidor estático de ~30 líneas que sirve `modulos/index.json` y `modulos/m1/v1.json` con `Content-Type: application/json`. El mismo directorio es `TELAR_CATALOG_LOCAL_ROOT`, así que **lo que el admin publica aparece servido de inmediato**: publicación y lectura comparten el árbol de archivos, igual que en GCS comparten el bucket.
2. **Backend**: `uvicorn app.main:app --port 8000` con `TELAR_ADMIN_MODE=1`, `TELAR_CATALOG_DRIVER=http_local`, `TELAR_CATALOG_ENDPOINT=http://127.0.0.1:8091`, `TELAR_CATALOG_LOCAL_ROOT=$TMPDIR/telar-e2e/bucket`, `TELAR_CATALOG_BUCKET=telar-e2e`, `TELAR_DB_PATH=$TMPDIR/telar-e2e/telar.db` (DB **limpia por corrida**), `TELAR_ADMIN_MODE=1`.
3. **Frontend**: `VITE_ADMIN=1 vite build && vite preview --port 4173 --host 127.0.0.1` (build admin: la misma app sirve ambos roles, y el journey necesita `/admin/*`).

Todo en loopback, coherente con la restricción del repo. **Cero credenciales, cero GCP, cero OAuth** (con `http_local`, `POST /admin/catalog/auth` devuelve `authenticated: true, token_state: "fresh"` sin flujo).

**Journey `e2e/tests/cu39-modulos.spec.ts`** (un solo `test.describe.serial`, estado compartido):

| Paso | Acción | Aserción |
|---|---|---|
| 1 | Estado inicial: el backend arranca con `content_seeded_at` **ya marcado** y `DELETE` del baseline salvo `m0` (o directamente DB vacía con auto-seed desactivado) | `/cursos` no muestra `m1` |
| 2 | **Admin publica m1 v1**: `/admin` → módulo `m1` → «Publicar» → `dry_run` primero (ver los warnings) → publicar | Aparece `$BUCKET/modulos/m1/v1.json` en disco; `index.json` lista `m1 v1`; el diálogo muestra el checksum |
| 3 | **Estudiante ve el catálogo remoto**: `/modulos` | Tarjeta `m1`, chip `neutral` «Disponible», `v1`, «2 lecciones» |
| 4 | **Incorpora m1**: clic «Incorporar» | `POST /catalog/install` → `201`; toast; la tarjeta pasa a chip `green` «Instalado»; `/cursos` muestra `m1` con sus 2 lecciones |
| 5 | **Hace el quiz y aprueba**: `/cursos/primerEjemplo` → quiz → 4/4 | `ProgressEntry.completed=true`, `best_quiz_score=4`, `completed_via='quiz'`; el catálogo marca la lección completada |
| 6 | **Admin publica m1 v2** con una lección más (`taskloop`) y **sin tocar `primerEjemplo`** | `modulos/m1/v2.json` existe; `index.json` apunta a `v2`; `v1.json` **sigue ahí, intacto** (inmutabilidad) |
| 7 | **Estudiante ve «actualización disponible»**: recarga `/cursos` | Chip `blue` «Actualización · v2» en el acordeón de `m1`; tira global «1 módulo tiene actualización · Revisar» |
| 8 | **Preview**: clic «Revisar» → `/modulos?filtro=actualizables` → «Ver qué cambia» | `GET …/update/preview` → `200`; la UI lista `primerEjemplo: preserved`, `taskloop: added/none`; copy **«Tu progreso se conserva»** visible |
| 9 | **Actualiza**: clic «Actualizar a v2» | `POST …/update` → `200`; `report.progress.lost == []` |
| 10 | **El progreso de la lección vieja SIGUE INTACTO** | `GET /api/v1/progress` ⇒ `primerEjemplo` con `completed=true`, `best_quiz_score=4`, `viewed=true`, `completed_via='quiz'`; `GET /api/v1/lessons/primerEjemplo/quiz/attempts` (o la UI) muestra el intento con su fecha; `/cursos` marca 1/3 completadas (el denominador **subió** por la lección nueva, y la UI lo explica: «el módulo creció») |
| 11 | **Bonus offline**: matar el servidor del bucket y recargar `/cursos` | La pantalla renderiza completa, sin `ErrorState`; `/modulos` sí muestra `ErrorState` con `onRetry`. Es la única pantalla que puede |

Artefactos: `trace: 'on-first-retry'`, `video: 'retain-on-failure'`, screenshots en 4, 7 y 10 (los tres momentos que se llevan a la tesis).

---

## 6. Riesgos

| # | Riesgo | Impacto | Mitigación concreta |
|---|---|---|---|
| **R-1** | Un error de sintaxis en `-- migration 5` tumba **las 205 pruebas** de golpe: `apply_schema` corre sobre la DB `:memory:` de `conftest.py:94/:109/:188` y el fixture falla en *setup* | Suite entera roja, diagnóstico confuso | C3 aislado: solo `schema.sql` + `test_migration5.py`, y no se avanza si `pytest -q` no vuelve a 205 verdes. Verificar antes en sqlite3 CLI: `sqlite3 /tmp/t.db < backend/app/schema.sql` |
| **R-2** | `enabled` deriva hoy del ejemplo (`content.py:648-649`) con fallback `False`: una lección sin ejemplo desaparecería de `lessons_enabled`, del `ProgressSummary` y del cómputo de módulo completado **sin ningún error** | El estudiante instala un módulo teórico y ve «0 lecciones habilitadas» | `enabled` pasa a columna propia en C3/C4, y `test_modules_catalogo_completo` (13/14/14/60) queda como canario explícito en el mensaje de commit |
| **R-3** | `ProgressRepository._UPSERT_SQL` usa `MAX()`/`COALESCE()`: un merge que pase por ahí **no puede** bajar ni anular `best_quiz_score`. El 4/4 obsoleto quedaría pegado para siempre, **en silencio** | Corrupción permanente de la nota tras cada actualización | `rescore_progress_no_commit` con `UPDATE` absoluto (C8) + el test-pareja que **demuestra** que el upsert normal no sirve |
| **R-4** | `UNIQUE(module_id,"order")` como **constraint de tabla** hace imposible archivar: la lección archivada sigue ocupando el slot y la nueva revienta con `IntegrityError` → 500 | El caso A4 (el corazón de CU-39) sería inimplementable | Índice **parcial** `WHERE archived_at IS NULL` (C3). Test explícito en `test_migration5.py` |
| **R-5** | SQLite valida el índice único **por statement**: una v N+1 que intercambia `l2↔l3` revienta a mitad de transacción | 500 en actualizaciones legítimas y frecuentes | Aparcado en dos fases en `apply_plan`, reusando `content_admin._reorder:225-251`. **El `MAX` del aparcado debe seguir siendo global** aunque el UNIQUE sea por módulo: «optimizarlo» a `MAX` por módulo rompe el lote que toca varios módulos |
| **R-6** | `recommended` cross-módulo: instalar `m1` en base vacía lanza `ContentError` dentro de `_persist` → `500 INTERNAL_ERROR` opaco | **Fallo garantizado del primer caso de uso**, con contenido real del repo | R6/C5: poda al leer en `content.py:676`. Test: `test_instalar_m1_en_base_vacia_con_recommended_cross_modulo` |
| **R-7** | Un `except GoogleCloudError` no atrapa el bucket privado: `google-auth` lanza `InvalidOperation` (un `GoogleAuthError`, **no** un `GoogleAPICallError`) al no poder refrescar la credencial anónima | Excepción no manejada → 500 en vez de `503 CATALOG_UNAVAILABLE` | Tupla explícita en `catalog_client.py`: `(GoogleAPICallError, GoogleAuthError, RetryError, DataCorruption, RequestException)`. Test con el fake simulando cada una |
| **R-8** | `requests` + `urllib3` + `google-auth` + `google-crc32c` entrarían al árbol de producción del **estudiante** solo por leer un JSON público | Superficie de dependencias y de CVE innecesaria en la app distribuida | Lectura con el `httpx` que el backend ya trae (`fastapi[standard]`); el SDK vive **solo** en `requirements-admin.txt` y en la imagen admin. El `Protocol` hace la decisión reversible |
| **R-9** | Con el consent screen en modo **Testing**, la autorización del admin —y su `refresh_token`— **caduca a los 7 días** | El admin no puede publicar y ve un 500 críptico | `catalog_publisher` captura `RefreshError`/`invalid_grant` → `403 CATALOG_AUTH_REQUIRED` y la UI ofrece re-autenticar. Documentado en C26 como limitación conocida y aceptada de la tesis |
| **R-10** | `InstalledAppFlow.run_local_server(timeout_seconds=None)` es el **default** y significa bloqueo **indefinido** dentro de un endpoint del backend | El worker de uvicorn se cuelga para siempre | `timeout_seconds=300` obligatorio; `WSGITimeoutError` → `408 OAUTH_TIMEOUT`. Test que lo fija |
| **R-11** | Renumerar `app/content/catalog.json` a orders per-módulo rompería `test_examples_listado_14_sin_codigo` y arrastraría a `real_content` (scope sesión, ~150 pruebas dependientes) | Bola de nieve difícil de diagnosticar | **Decisión explícita: no se renumera.** Los orders 1..14 globales son válidos bajo el índice parcial y producen la misma secuencia con el `ORDER BY` compuesto |
| **R-12** | El fixture compartido `MODULES` (`tests/fixtures/rest.ts:70,81`) contaminado con la lección sin ejemplo hace que el autoselect de `SimulatorIdle.tsx:96-97` la elija y rompa `CodePanel.test.tsx:103` | Rotura lateral en una suite que no tiene nada que ver | Fixture **separado** `MODULES_CON_LECTURA`. Anotado en el commit C19 |
| **R-13** | `loadExamplesIndex()` (`api/content.ts:75-87`) es una caché a nivel de módulo ES que nadie invalida tras instalar | Metas en `—` hasta recargar la app entera | Contrato del `catalogStore`: todo `install/update/remove` con éxito llama `hydrate(true)` **y** `loadExamplesIndex(true)`. Test en `catalogStore.test.ts` |
| **R-14** | `--cov-fail-under=80` (hoy 93,79 %) con instalador, actualizador, puerto y publicador nuevos | El pipeline falla al final, cuando ya no hay tiempo | El plan carga el peso de cobertura en `test_module_merge_plan.py` (función pura, decenas de casos, sin DB ni red), escrito en C12 — **antes** de que exista el actualizador |
| **R-15** | Una instalación concurrente aborta intentos de quiz en vuelo con `422` vía `_ensure_content_current` (`quiz_service.py:187-221`) | El estudiante ve un error genérico y cree que perdió el intento | Es el comportamiento **correcto** (sin él, un intento obsoleto reescribiría la nota justo tras el merge y el `MAX` la haría permanente). Se documenta y el frontend lo traduce a *«el contenido se actualizó, recarga»*. Test B12 en `test_quiz_atomicity.py` |
| **R-16** | `main.py:74` `_seed_content_if_unseeded` cuenta `SELECT COUNT(*) FROM lessons`: en un despliegue «solo remoto», encontrar lecciones instaladas hace backfill del marcador y **no siembra el baseline** | Arranque con contenido inesperado (o sin él) | Filtrar por `archived_at IS NULL` y decidir a conciencia el comportamiento; test nuevo en `test_app_lifespan.py`. Instalar un módulo **nunca** toca `content_seeded_at` |
| **R-17** | El E2E depende de un driver (`http_local`) que no es el de producción: podría ocultar un fallo del adaptador GCS real | Falsa sensación de cobertura | Los dos adaptadores comparten **todo** el código de validación, checksum, instalación y merge; solo difiere el transporte. El adaptador GCS se cubre con `test_catalog_client.py` mockeando `httpx`, y se valida a mano una vez contra un bucket real antes de la defensa (checklist en C26) |