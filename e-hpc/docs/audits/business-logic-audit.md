# Telar — Auditoría de lógica de negocio

- **Fecha:** 2026-07-16 (working tree con el rediseño visual del frontend sin commitear; el backend no tiene cambios pendientes)
- **Alcance:** revisión estática de coherencia de lógica de negocio de toda la plataforma (backend FastAPI, frontend React/TS, shell Electron, runner/compose, fixtures de contenido) contra la fuente de verdad `docs/architecture/` (`api-contract.md` manda).
- **Método:** workflow multi-agente en 3 fases — 13 revisores especializados por subsistema → verificación adversarial de cada hallazgo por 2-3 escépticos independientes (que intentan refutarlo leyendo el código real; la mayoría refuta ⇒ se descarta) → crítico de completitud + ronda extra sobre los huecos detectados. Detalle en el Apéndice.
- **Regla de entrada:** ningún hallazgo sin evidencia `archivo:línea` citada del código real. Todos los hallazgos de este reporte quedaron **CONFIRMED** (38 por panel adversarial de 2-3 escépticos; BL-37 y BL-38 por verificación directa del sintetizador sobre el código, anotada en su detalle).

---

## 1. Resumen ejecutivo

**40 hallazgos únicos** (tras fusionar 6 grupos duplicados entre áreas). **8 candidatos adicionales fueron refutados** por la verificación adversarial y no entran al reporte (Apéndice C).

| Severidad | Nº | | Categoría | Nº |
|---|---|---|---|---|
| critical | 3 | | inconsistency | 11 |
| high | 9 | | logic-bug | 6 |
| medium | 19 | | contract-violation | 6 |
| low | 9 | | missing-business-logic | 5 |
| **Total** | **40** | | domain-semantics | 4 |
| | | | edge-case | 4 |
| | | | race-condition | 3 |
| | | | security | 1 |

### Top riesgos

1. **BL-02 (critical)** — El `compose.yaml` empaquetado del desktop **reintroduce el bug del volumen `ehpc_submissions` sin `name:`** que `CLAUDE.md` marca como "corregido — no reintroducir": en el Modo A del instalador **todos los jobs del simulador fallarían** con "no such file or directory". Su gemelo BL-12 reintroduce además el bug de CORS 127.0.0.1.
2. **BL-01 (critical)** — Borrar una lección deja huérfanas sus filas de `lesson_progress`/`quiz_attempts` (sin FK ni limpieza); si el admin reutiliza el mismo id, el estudiante **hereda `completed:true`/`best_quiz_score` de un contenido que nunca vio**, y el `MAX`/`COALESCE` del upsert impide que se corrija jamás.
3. **BL-03 (critical)** — Una línea `hilos = 0` en el stdout (posible con código editado por el estudiante) lanza `ZeroDivisionError` en el parser de sweep y **reclasifica un job exitoso como `failed`/`sandbox_error`**, rompiendo la promesa "jamás lanza" del propio módulo.
4. **BL-09 + BL-10 (high)** — La pareja replay-de-`seq` (backend reinicia `seq` en el replay terminal; frontend no resetea `lastLogSeq` en el retry manual) hace que tras una reconexión el estudiante pueda ver **la terminal vacía o sin la salida del job**.
5. **BL-05 (high)** — `lesson_progress.last_job_id` **nunca se escribe**: regla explícita de `api-contract.md` §7.1 sin implementar (el propio repo la tiene registrada como anomalía WP9-02 en `test_anomalies.py`).
6. **BL-30 (medium, pero central para una plataforma educativa)** — Las observaciones de resultados **invierten la Ley de Amdahl sobre el ratio OpenMP-vs-NumPy/BLAS** y le presentan al estudiante un "% paralelizable" fabricado: enseña mal un concepto clave de HPC.
7. **BL-22 (medium, security)** — El 422 de validación de `/admin/login` puede **devolver la contraseña literal** dentro de `error.details[].input` (pydantic v2 incluye el input por defecto).

**BUG-01 (conocido):** confirmado como **RESUELTO** en el código actual — no se cuenta entre los 40 (ver §5).

---

## 2. Tabla de hallazgos

Todos los veredictos son CONFIRMED. Detalle completo (escenario de fallo y recomendación) en §3.

| ID | Sev | Categoría | Área | Título | Evidencia principal |
|---|---|---|---|---|---|
| BL-01 | critical | logic-bug | Cursos/Admin/Persistencia | Borrar lección deja `lesson_progress`/`quiz_attempts` huérfanos; reutilizar el id resucita progreso ajeno | `backend/app/repositories/content_admin.py:300-304`, `backend/app/schema.sql:63,78` |
| BL-02 | critical | inconsistency | Desktop | Compose empaquetado sin `name: ehpc_submissions` — regresión: todos los jobs fallan en Modo A | `desktop/resources/compose/compose.yaml:52` vs `compose.yaml:67` |
| BL-03 | critical | logic-bug | Parsers | `ZeroDivisionError` con `hilos = 0` en sweep → job exitoso reclasificado `failed`/`sandbox_error` | `backend/app/services/output_parser.py:31,96` |
| BL-04 | high | logic-bug | Quiz/Persistencia | `submit_attempt` no es atómico: dos commits independientes; el rollback conjunto es un no-op | `backend/app/repositories/quiz_attempts.py:50`, `progress.py:82`, `quiz_service.py:149-160` |
| BL-05 | high | missing-business-logic | Jobs/Progreso | `lesson_progress.last_job_id` nunca se escribe (contrato §7.1 incumplido; anomalía WP9-02) | `backend/app/services/job_runner.py:698`, `backend/tests/test_anomalies.py:23,106` |
| BL-06 | high | inconsistency | Cursos/Admin | Editar/borrar el quiz no recalcula el progreso: `best_quiz_score` > `quiz_total`, `completed` obsoleto | `backend/app/repositories/content_admin.py:379-411` |
| BL-07 | high | inconsistency | Jobs | `cancel()` sobre job `queued` no sincroniza `handle.phase`: WS lo ve activo y la cola lo sobrecuenta | `backend/app/services/job_runner.py:267-272,546` |
| BL-08 | high | race-condition | Jobs | TOCTOU en el tope de cola: ráfagas concurrentes superan el límite de 10 (`TOO_MANY_JOBS`) | `backend/app/routers/jobs.py:166-205` |
| BL-09 | high | contract-violation | WebSocket | El replay terminal reinicia `seq` desde 0 (el contrato exige reusar los originales) → el front descarta todo | `backend/app/routers/ws.py:113-121`, `frontend/src/ws/jobSocket.ts:136` |
| BL-10 | high | logic-bug | Frontend | El retry manual del WS borra los logs y luego descarta el replay (no resetea `lastLogSeq`) | `frontend/src/ws/jobSocket.ts:57-64,136`, `frontend/src/stores/jobStore.ts:91` |
| BL-11 | high | inconsistency | Fixtures/Admin | El fixture `sumaVectoresGPU` viola la coherencia de hilos del write-path admin → el ejemplo GPU es ineditable (422) | `backend/app/content/catalog.json:471-474`, `backend/app/services/content_writer.py:89` |
| BL-12 | high | inconsistency | Desktop | `TELAR_ALLOWED_ORIGINS` empaquetado omite las variantes `127.0.0.1` (regresión del bug CORS) | `desktop/resources/compose/compose.yaml:26` vs `compose.yaml:28` |
| BL-13 | medium | contract-violation | Jobs | `output_truncated=true` puede convivir con `status`/`error_detail` de cancel/timeout (contradice §7.4) | `backend/app/services/job_runner.py:395-409,718-720` |
| BL-14 | medium | domain-semantics | Sandbox | `cpuset_cpus` siempre arranca en el core 0: jobs concurrentes comparten los mismos cores físicos | `backend/app/services/docker_service.py:277-278` |
| BL-15 | medium | missing-business-logic | Sandbox | Contenedor huérfano si `start()` falla tras un `create()` exitoso (nadie hace `remove()`) | `backend/app/services/docker_service.py:289-292` |
| BL-16 | medium | domain-semantics | WebSocket | El replay fabrica el `ts` de cada línea con la hora del replay, no la del evento | `backend/app/routers/ws.py:126`, `frontend/.../LiveTerminalCard.tsx:23,80` |
| BL-17 | medium | inconsistency | Admin | `TELAR_MAX_CODE_BYTES` se ignora en las rutas admin JSON (tope 262144 hardcodeado; multipart sí lo honra) | `backend/app/schemas.py:715,743`, `backend/app/services/content_writer.py:50` |
| BL-18 | medium | contract-violation | Admin | La autogeneración de id de pregunta `{lesson_id}-q{n}` prometida en §10.5 no existe (422 en su lugar) | `backend/app/schemas.py:771` vs `docs/architecture/api-contract.md:1053-1054` |
| BL-19 | medium | race-condition | Admin/Persistencia | Los GET admin retienen el `write_lock` transversal durante lecturas N+1: serializan `finish()` de jobs y quiz | `backend/app/routers/admin.py:86`, `backend/app/repositories/content_admin.py:460` |
| BL-20 | medium | missing-business-logic | Admin | Sin reorder por lote: intercambiar el `order` de dos lecciones/módulos da siempre 409 (hay workaround manual) | `backend/app/schema.sql:112`, `backend/app/services/content_writer.py:314` |
| BL-21 | medium | edge-case | Persistencia | El auto-seed re-siembra un catálogo vaciado a propósito por el admin (condición = `lessons` vacía) | `backend/app/main.py:57-63` |
| BL-22 | medium | security | Auth admin | La contraseña puede volver al cliente en `error.details[].input` de un 422 de `/admin/login` | `backend/app/errors.py:116`, `backend/app/schemas.py:603` |
| BL-23 | medium | race-condition | Auth admin | El backoff de `LoginThrottle` es evadible con N logins concurrentes (lee-espera-incrementa sin lock) | `backend/app/services/admin_auth.py:151-157`, `routers/admin_auth.py:88` |
| BL-24 | medium | missing-business-logic | Frontend admin | La coherencia GPU⇒deshabilitado anunciada en el editor no está implementada (solo se sincroniza hilos) | `frontend/.../ExampleMetaFields.tsx:115,154,242` |
| BL-25 | medium | edge-case | Parsers | En parsers `pair`, `reference_time_s<=0` no se rechaza (solo `parallel`): speedup `0x` en vez de `None` | `backend/app/services/output_parser.py:168` |
| BL-26 | medium | edge-case | Parsers | `_sweep_series` no deduplica ni valida el conjunto de hilos: líneas repetidas/parciales → serie corrupta | `backend/app/services/output_parser.py:83-87` |
| BL-27 | medium | inconsistency | Fixtures | El catálogo `content/fundamentos/` (4 módulos/23 lecciones) es huérfano: nada lo carga y su esquema es incompatible | `backend/app/content/fundamentos/catalog.json:68`, `backend/app/tools/seed_content.py:39` |
| BL-28 | medium | missing-business-logic | Desktop | `useDockerStatus`/footer no distinguen "Docker ausente" de "servicios detenidos"; `openExternal` sin uso | `frontend/src/hooks/useDockerStatus.ts:42`, `frontend/.../RuntimeFooter.tsx:32` |
| BL-29 | medium | logic-bug | Desktop | El estado "ok" del footer ignora `health`: backend `unhealthy` se muestra en verde | `frontend/src/hooks/useDockerStatus.ts:40` vs `electron-spec.md:559` |
| BL-30 | medium | domain-semantics | Dominio/UI | Ley de Amdahl invertida sobre el ratio vs NumPy/BLAS: "% paralelizable" fabricado para el estudiante | `frontend/src/lib/observations.ts:87-93` |
| BL-31 | medium | inconsistency | Dominio/UI | El front no acota `fixed_threads` por núcleos: muestra un `--cpus` que el backend no asigna | `frontend/.../ThreadsField.tsx:36` vs `backend/app/routers/jobs.py:145` |
| BL-32 | low | inconsistency | Jobs | `threads_note` por defecto se construye ANTES del clamp a `max_threads`: cita más CPUs de las asignadas | `backend/app/routers/jobs.py:139-145` |
| BL-33 | low | contract-violation | WebSocket | El cierre 1011 no emite el mensaje `error` previo que documenta §8.4 | `backend/app/routers/ws.py:88-89` |
| BL-34 | low | inconsistency | Docs/Auth | `fase4-autoria-design.md` aún documenta `403 ADMIN_DISABLED` (contradice contrato e implementación) | `docs/architecture/fase4-autoria-design.md:343,347` |
| BL-35 | low | inconsistency | Admin | Mismo filename inválido: 415 (multipart) vs 422 (JSON) en `POST /admin/examples/{id}/code` | `backend/app/routers/admin.py:261`, `backend/app/schemas.py:714` |
| BL-36 | low | contract-violation | Contrato | `GET /jobs/{id}/output` devuelve 422 (`stream` inválido), status no listado en la tabla §9 | `backend/app/routers/jobs.py:396-397` |
| BL-37 | low | logic-bug | Parsers | `efficiency` se deriva del `speedup` YA redondeado a 2 decimales, no de los tiempos crudos | `backend/app/services/output_parser.py:90,96` |
| BL-38 | low | edge-case | Cursos | `lessons_completed` no filtra lecciones deshabilitadas: puede superar `lessons_enabled` | `backend/app/routers/modules.py:150-155` |
| BL-39 | low | contract-violation | Desktop | La CSP real añade `data:` a `font-src`, desviándose de la spec congelada §7.1 | `desktop/src/security.ts:16` vs `electron-spec.md:471` |
| BL-40 | low | domain-semantics | Dominio/UI | Etiqueta "Procesos/hilos" en Resultados: semántica MPI en un modelo de memoria compartida | `frontend/src/features/results/ResultsCards.tsx:75` |

---

## 3. Detalle de hallazgos

### Critical

**BL-01 — Borrar una lección deja progreso e intentos huérfanos; reutilizar el id resucita estado ajeno** · logic-bug · CONFIRMED (3 paneles independientes, 6 escépticos, 0 refutaciones)
`lesson_progress.lesson_id` y `quiz_attempts.lesson_id` son `TEXT` sin FK a `lessons` (`schema.sql:63,78`), a diferencia de `examples`/`quiz_questions` que sí tienen `ON DELETE CASCADE`. `delete_lesson` (`content_admin.py:300-304`) solo limpia `recommended` colgantes y borra la fila de `lessons`. El chequeo `DUPLICATE_ID` de `create_lesson` (`content_writer.py:269`) solo mira la existencia ACTUAL del id.
*Escenario:* el admin borra `spmd` y luego crea una lección nueva y distinta con el mismo id; `GET /modules`/`GET /lessons/spmd` fusionan el registro huérfano: el estudiante ve `completed:true` y un `best_quiz_score` de un quiz que nunca presentó. Agravante verificado: el upsert usa `MAX(best_quiz_score, :nuevo)` y `completed = COALESCE(:completed, completed)` con `completed=True if passed else None` (`progress.py:22-29`, `quiz_service.py:154`) — aunque el estudiante repruebe el quiz real de la lección nueva, el estado heredado **nunca se revierte**.
*Recomendación:* purgar `lesson_progress` y `quiz_attempts` del `lesson_id` dentro de la misma transacción del DELETE (o añadir FKs `ON DELETE CASCADE` reales), o rechazar la reutilización de ids borrados (tombstone).
*Matiz del panel:* requiere una acción deliberada de un admin autenticado (no es explotable por un estudiante); es un bug de integridad de negocio, no un vector de ataque.

**BL-02 — El compose empaquetado del desktop reintroduce el bug del volumen `ehpc_submissions`** · inconsistency · CONFIRMED (2/2)
`desktop/resources/compose/compose.yaml` fija `name: ehpc` como proyecto y declara el volumen `ehpc_submissions:` **sin** el `name:` explícito que el `compose.yaml` raíz sí tiene (línea 67, con comentario explicando este mismo bug). Compose creará `ehpc_ehpc_submissions`, mientras `docker_service.py:245` monta el runner con el literal `ehpc_submissions` (env `TELAR_SUBMISSIONS_VOLUME`, línea 28 del propio compose empaquetado); Docker autocrea un volumen vacío con ese nombre. `COMPOSE_PROJECT_NAME` existe en `desktop/src/constants.ts` pero `ipc-docker.ts` nunca lo pasa.
*Escenario:* en Modo A (instalador con imágenes GHCR), **todos los jobs del simulador fallan** con "no such file or directory" — exactamente el bug que `CLAUDE.md` (línea 34) marca como corregido y a no reintroducir. `electron-spec.md` §6.1 reproduce el mismo compose defectuoso.
*Recomendación:* añadir `name: ehpc_submissions` al volumen del compose empaquetado y un check (test/CI) que compare los campos críticos de ambos compose.

**BL-03 — `ZeroDivisionError` con `hilos = 0`: un job exitoso se reclasifica como `sandbox_error`** · logic-bug · CONFIRMED (2/2, reproducido ejecutando el parser)
Las regex de sweep aceptan `(\d+)` = 0 (`output_parser.py:31`) y `_sweep_series` valida `baseline<=0` y `time_s<=0` pero no `threads==0` antes de `speedup/threads` (línea 96).
*Escenario:* un estudiante edita el código de un ejemplo sweep y su stdout incluye una línea `hilos = 0 | ...` junto al baseline; el parser lanza `ZeroDivisionError` (reproducido con `parse_output("sweep_pi", ...)`), la excepción escapa de `output_parser` (cuyo docstring promete "jamás lanza") y el manejo de errores del `job_runner` convierte un job con `exit 0` en `failed`/`sandbox_error`.
*Recomendación:* filtrar `threads<=0` en `_sweep_series` devolviendo `None`, igual que con `time_s<=0`.

### High

**BL-04 — `submit_attempt` no es atómico: dos commits independientes bajo el mismo lock** · logic-bug · CONFIRMED (3 paneles; un panel lo calificó critical)
El docstring de `quiz_service.py` promete "unidad dentro de `write_lock`", pero `QuizAttemptRepository.create()` hace su propio `commit()` (`quiz_attempts.py:50`) y después `ProgressRepository.upsert()` hace otro (`progress.py:82`). El `rollback()` del `except` de `submit_attempt` es un no-op para el primer paso ya confirmado. El lock (reentrante) da exclusión mutua, no atomicidad.
*Escenario:* excepción/caída del proceso entre ambos commits ⇒ el intento queda persistido (incluso aprobado) pero `best_quiz_score`/`completed` no se actualizan jamás para ese intento — historial y progreso quedan permanentemente inconsistentes si el estudiante no repite un score igual o mejor.
*Recomendación:* un único `commit()`/`rollback()` a nivel de la unidad compuesta (variantes de `create`/`upsert` que no comiten), replicando el patrón build-then-commit de `content_writer._persist`.

**BL-05 — `lesson_progress.last_job_id` nunca se escribe (regla §7.1 sin implementar)** · missing-business-logic · CONFIRMED (2 paneles)
`api-contract.md:492`: "al terminar bien el job se actualiza `lesson_progress.last_job_id`". `JobRunner` no recibe `ProgressRepository`; `finish()` solo toca `jobs`; ningún router lo escribe. El propio repo lo registra como anomalía conocida (`test_anomalies.py` — `test_ANOMALIA_WP9_02_last_job_id_no_se_actualiza`) sin corregirla en producción.
*Escenario:* cualquier job `completed` con `lesson_id` deja `last_job_id=NULL` para siempre; `GET /progress` nunca expone el último job de la lección.
*Recomendación:* tras un `finish()` exitoso con `lesson_id`, invocar `progress.upsert(lesson_id, last_job_id=job_id)` dentro de la misma unidad bajo `write_lock`.

**BL-06 — Editar o borrar el quiz no reconcilia el progreso existente** · inconsistency · CONFIRMED (2/2)
`replace_quiz` (`content_admin.py:379-405`) solo actualiza `lessons.pass_threshold` y reemplaza `quiz_questions`; `delete_quiz` (líneas 408-411) solo borra preguntas. Ninguno toca `lesson_progress`, y `quiz_total_for` se calcula en vivo del contenido actual.
*Escenario:* estudiante con `best_quiz_score=8` sobre 10 preguntas; el admin reemplaza el quiz por 5 preguntas (o lo borra): la UI muestra `best_quiz_score: 8 / quiz_total: 5` (o `/0`) — una nota imposible — y `completed:true` nunca evaluado contra el quiz nuevo.
*Recomendación:* al reemplazar/borrar un quiz, resetear o recalcular `best_quiz_score`/`completed` de esa lección en la misma transacción (regla explícita de reconciliación).

**BL-07 — Cancelar un job `queued` deja `handle.phase` desincronizado** · inconsistency · CONFIRMED (2/2)
`cancel()` escribe `cancelled` en DB de inmediato (`job_runner.py:272`) pero `handle.phase` sigue `queued` hasta que la tarea adquiere el semáforo (línea 546) — minutos, si hay jobs largos delante.
*Escenario:* (a) un WS que conecta en esa ventana ve el job "activo" en fase `queued` en vez de recibir status terminal + `eof` (contradice §8.1); (b) `queued_count()` sigue contando el job cancelado: la cola anuncia 429 con capacidad real libre.
*Recomendación:* sincronizar `handle.phase='cancelled'` (y emitir status/eof, o excluirlo del conteo) en el mismo instante que la escritura en DB.

**BL-08 — TOCTOU en el tope de cola (`TOO_MANY_JOBS`)** · race-condition · CONFIRMED (2/2)
`queued_count()` (síncrono, sobre el registro en memoria) se lee una vez (`jobs.py:166-169`) y siguen varios `await` (ping, image_present, `create` con lock) antes de registrar el job (líneas 204-205).
*Escenario:* N POST /jobs concurrentes cerca del límite leen todas `<10` antes de que ninguna registre ⇒ el tope de 10 se supera sin límite efectivo (solo el caso secuencial está testeado).
*Recomendación:* reservar el slot de cola de forma atómica respecto al chequeo (registrar/incrementar antes de cualquier `await` y revertir si falla la validación posterior).

**BL-09 — El replay terminal reinicia `seq` en vez de reusar los originales** · contract-violation · CONFIRMED (2/2)
El contrato (§8.2) dice "el backlog re-usa los `seq` originales" y el cliente depende de ello (`jobSocket.ts:136` descarta `seq <= lastLogSeq`). En vivo `seq` sale de `handle.seq` (`job_runner.py:349`), pero `_replay_terminal` (`ws.py:113-121`) reconstruye los logs desde el texto plano persistido y numera desde 0.
*Escenario:* la conexión cae con el job vivo (p. ej. `lastLogSeq=40`), el job termina durante la desconexión; al reconectar, el handler sirve replay con `seq` 0..N que el dedupe del cliente descarta íntegro ⇒ terminal sin salida.
*Recomendación:* preservar la numeración real en el replay (persistir seq/chunks o retener el handle un tiempo tras cerrar), o cambiar contrato+cliente para no asumir continuidad de `seq` entre stream vivo y replay.

**BL-10 — El retry manual del frontend descarta el backlog por `lastLogSeq` obsoleto** · logic-bug · CONFIRMED (2/2)
`retry()`→`connect()` resetea el store (logs=[] vía `begin()`, `jobStore.ts:91`) confiando en que el backlog re-puebla, pero `JobSocket` nunca resetea `lastLogSeq` (`jobSocket.ts:57-64`); el backlog del ring-buffer llega con los `seq` originales y el filtro (línea 136) lo descarta todo.
*Escenario:* job en estado `lost` → usuario pulsa "Reintentar conexión" → pantalla queda sin ninguna línea previa. Complementario a BL-09 (misma familia, lado cliente).
*Recomendación:* resetear el estado de dedupe del socket (`lastLogSeq=-1`, revisar `sawEof`/`lastPhase`) en toda reconexión que dispare `begin()`.

**BL-11 — El fixture `sumaVectoresGPU` viola la regla de coherencia de hilos del write-path admin** · inconsistency · CONFIRMED (2/2)
`catalog.json:471-474`: `threads_configurable=false`, `sweeps_threads=false`, `fixed_threads=null`. La regla §10.6 implementada en `_example_coherence_issues` (`content_writer.py:89`) exige `¬configurable ∧ ¬sweeps ⇒ fixed_threads ≥ 1`. `from_fixtures`/`load()` no aplican esa regla (validación solo por escritura), así que el seed la introduce sin error.
*Escenario:* el admin abre el ejemplo GPU y guarda cualquier cambio (p. ej. el título) reenviando los mismos valores ⇒ `422 CONTENT_VALIDATION_ERROR` (`fixed_threads`): el contenido semilla oficial es **ineditable** por la propia UI de autoría.
*Recomendación:* reconciliar regla y fixture — carve-out por `requires_gpu` en la coherencia de hilos, o dar un valor coherente al fixture.

**BL-12 — `TELAR_ALLOWED_ORIGINS` del compose empaquetado omite `127.0.0.1`** · inconsistency · CONFIRMED (2/2)
El compose raíz (línea 28) incluye las variantes `localhost`/`127.0.0.1` para 5173/8080 (bug CORS documentado como corregido en `CLAUDE.md`); el empaquetado (`desktop/resources/compose/compose.yaml:26`) conserva la lista vieja sin `127.0.0.1`.
*Escenario:* el compose empaquetado también publica el frontend en `127.0.0.1:8080`; un usuario del instalador que abra esa URL en su navegador sufre el bloqueo CORS ya conocido (Electron en sí no lo dispara: carga `file://`/Origin `null`).
*Recomendación:* igualar el valor al del compose raíz (mismo check de paridad que BL-02).

### Medium

**BL-13 — `output_truncated=true` con `status`/`error_detail` de cancel/timeout** · contract-violation · CONFIRMED (2/2)
`on_log()` fija `handle.output_truncated=True` incondicionalmente al exceder 256 KB (`job_runner.py:395-409`), pero si `kill_reason` ya era `cancel`/`timeout`, `request_kill()` no lo sobreescribe (primer-escritor-gana, comportamiento testeado) y `_derive_terminal()` (líneas 718-720) produce `cancelled`/`timeout` con `error_detail≠output_limit_exceeded` mientras la fila conserva `output_truncated=true` — contradice §7.4 ("si `output_truncated=true` ⇒ `error_detail=output_limit_exceeded`").
*Recomendación:* decidir y documentar la precedencia real (y alinear §7.4), o no fijar `output_truncated` como verdad absoluta independiente de la causa de terminación.

**BL-14 — `cpuset_cpus` siempre `0..N-1`: jobs concurrentes comparten cores** · domain-semantics · CONFIRMED (2/2)
`run_job` calcula `cpuset_cpus=f"0-{threads-1}"` sin considerar otros contenedores (`docker_service.py:277-278`). Con `max_concurrent_jobs=2`, dos jobs con `threads=4` reciben ambos `0-3` — contradice la garantía de "cores dedicados… mediciones de speedup reproducibles" (`architecture.md:444`).
*Recomendación:* rangos disjuntos por slot del semáforo, o documentar que la reproducibilidad solo aplica con un job a la vez.

**BL-15 — Contenedor huérfano si `start()` falla tras `create()`** · missing-business-logic · CONFIRMED (2/2)
En `run_job`, si `create()` triunfa y `start()` lanza (`docker_service.py:289-292`), el `except` solo re-lanza `DockerServiceError`; `handle.execution` sigue `None`, así que `_cleanup_resources` no limpia. El contenedor queda en el daemon hasta el próximo arranque (reaper).
*Recomendación:* `container.remove(force=True, v=True)` en el `except` cuando `create()` ya ocurrió.

**BL-16 — El replay fabrica `ts` con la hora del replay** · domain-semantics · CONFIRMED (3 votos)
`jobs` solo persiste `stdout/stderr` como texto plano; `_replay_terminal` usa `utc_now_iso()` para cada línea (`ws.py:126`) y `LiveTerminalCard` lo renderiza como reloj `[HH:MM:SS]` por línea (líneas 23, 80).
*Escenario:* tras F5 sobre un job terminado, todas las líneas muestran el mismo timestamp (la hora del refresh), presentado como si fuera el tiempo real de ejecución.
*Recomendación:* no fabricar `ts` en el replay (omitir/marcar el campo) o persistir timestamps reales por línea.

**BL-17 — `TELAR_MAX_CODE_BYTES` ignorado en las rutas admin JSON** · inconsistency · CONFIRMED (3 votos)
`AdminLessonCreate.source_code`/`AdminExampleCodeRequest` usan `max_length=262144` literal (`schemas.py:715,743`) y `content_writer._check_code_size` duplica la constante (línea 50); la variante multipart y `/jobs` sí leen `settings.max_code_bytes` (override testeado en `test_routers_jobs.py`).
*Escenario:* un operador baja el límite global a 8 KB y el admin igualmente inserta 50 KB por la vía JSON — el límite configurado no es uniforme entre transportes.
*Recomendación:* leer `settings.max_code_bytes` en runtime también en el camino JSON/`_check_code_size`.

**BL-18 — Autogeneración de id de pregunta (§10.5) no implementada** · contract-violation · CONFIRMED (2 paneles)
El contrato: "el `id` lo provee el cliente… **o el servidor autogenera `{lesson_id}-q{n}`**" (`api-contract.md:1053-1054`). `AdminQuizQuestion.id` es obligatorio sin default (`schemas.py:771`); ningún módulo genera el fallback ⇒ una pregunta sin `id` recibe `422 Field required`. Hoy lo oculta el frontend (usa `_cid` provisional — parte del fix de BUG-01).
*Recomendación:* implementar el fallback server-side (id opcional + generación en `replace_quiz`), o corregir el contrato para exigir siempre id de cliente.

**BL-19 — Los GET admin retienen el `write_lock` transversal con lecturas N+1** · race-condition · CONFIRMED (2/2)
`GET /admin/modules` y análogos envuelven la lectura en `write_lock` (`admin.py:86`) — el mismo lock con el que `finish()` de jobs, `submit_attempt` y `progress.upsert` persisten — y dentro ejecutan N+1 queries (`content_admin.py:460`).
*Escenario:* mientras el dashboard admin refresca, la persistencia del resultado de un job de un estudiante espera el lock: acoplamiento de latencia entre subsistemas sin relación.
*Recomendación:* lock/snapshot de lectura dedicado para admin (o una sola query con JOIN) para no retener el lock transversal.

**BL-20 — Intercambiar el `order` de dos lecciones/módulos siempre da 409** · missing-business-logic · CONFIRMED (2/2, con matiz)
`order` es `UNIQUE` global inmediato (`schema.sql:112`) y cada PUT valida contra el estado ya commiteado (`content_writer.py:314`): el swap directo A↔B falla siempre en el primer PUT; no hay endpoint de reorder por lote.
*Matiz (panel discrepante):* existe workaround manual — mover primero una lección a un `order` libre temporal — por lo que otro panel refutó un duplicado de este hallazgo como limitación de UX y no de lógica. Se reporta una sola vez, como regla de negocio faltante de severidad media.
*Recomendación:* endpoint de reorden por lote transaccional (o UX explícita del workaround).

**BL-21 — El auto-seed re-siembra un catálogo vaciado a propósito** · edge-case · CONFIRMED (3 votos)
`_seed_content_if_empty` usa `SELECT COUNT(*) FROM lessons` como única condición (`main.py:57-63`): "vacía" no distingue "nunca sembrada" de "vaciada por el admin" (algo que Fase 4 permite lección a lección).
*Escenario:* el admin borra todas las lecciones; al siguiente reinicio reaparecen los 14 fixtures, deshaciendo su decisión en silencio.
*Recomendación:* marcador persistente `content_seeded_at` (o similar) como condición del auto-seed, en vez del conteo de filas.

**BL-22 — Contraseña admin reflejada en `details` de un 422** · security · CONFIRMED (2/2)
El handler global serializa `exc.errors()` de pydantic sin excluir `input` (`errors.py:116`); `AdminLoginRequest.password` (`schemas.py:603`, `max_length=256`) puede fallar validación (p. ej. pegado >256 chars — el input de la UI no tiene `maxLength`).
*Escenario:* el 422 devuelve `error.details[0].input` con la contraseña literal — queda expuesta en el cuerpo de red, consola/telemetría del navegador o logs de un proxy.
*Recomendación:* excluir `input` (y `ctx`/`url`) al serializar errores de validación, al menos para campos sensibles.

**BL-23 — `LoginThrottle` evadible con logins concurrentes** · race-condition · CONFIRMED (2/2)
`sleep_if_needed()` lee `delay_s` y solo tras despertar el handler llama `record_failure()` (`admin_auth.py:151-157`, `routers/admin_auth.py:88`).
*Escenario:* N intentos concurrentes leen el mismo contador bajo y duermen el mismo delay corto **en paralelo**: el backoff anti fuerza bruta solo funciona secuencialmente. (Impacto acotado por el bind a loopback.)
*Recomendación:* serializar lectura-espera-incremento con un lock, o incrementar antes de dormir.

**BL-24 — Coherencia GPU⇒deshabilitado anunciada pero no implementada en el editor** · missing-business-logic · CONFIRMED (2/2)
El comentario del bloque promete "coherencia en UI: hilos + GPU" (`ExampleMetaFields.tsx:115`), pero solo hilos se sincroniza; "Requiere GPU" y "Ejemplo habilitado" son independientes (líneas 154, 242).
*Escenario:* el admin marca GPU dejando habilitado ⇒ solo se entera al guardar, vía 422 genérico del backend (regla `requires_gpu ⇒ enabled=false` de §10.6).
*Recomendación:* sincronizar/deshabilitar el checkbox o aviso inline inmediato, como ya se hace con hilos.

**BL-25 — `reference_time_s <= 0` no se rechaza en parsers `pair`** · edge-case · CONFIRMED (2/2)
El guard de `_parse_pair` solo cubre `parallel_s<=0` (`output_parser.py:168`).
*Escenario:* referencia que imprime `0.000 s` (plausible en hardware rápido) ⇒ `speedup_vs_reference=0.0` mostrado como "0x" en vez de descartar el parseo (`None`), rompiendo la regla general "algún `time_s<=0` ⇒ None".
*Recomendación:* extender el guard a `reference_s<=0`.

**BL-26 — `_sweep_series` acepta hilos duplicados o series incompletas** · edge-case · CONFIRMED (2/2)
Acumula cada línea que matchea sin deduplicar ni validar el conjunto (`output_parser.py:83-87`).
*Escenario:* stdout con dos líneas del mismo N (re-impresión por bug del estudiante) o solo parte del barrido ⇒ `parsed_timings` con puntos duplicados/incompletos que la SpeedupChart pinta como curva válida.
*Recomendación:* validar unicidad (y opcionalmente completitud) del conjunto de hilos; ante inconsistencia, `None`.

**BL-27 — `content/fundamentos/` es contenido huérfano e incompatible** · inconsistency · CONFIRMED (2/2)
Ningún `.py` referencia `fundamentos` (grep repo-wide); el seeder/loader solo leen el `catalog.json` superior (`seed_content.py:39`, `content.py:129`). Su esquema (lecciones sin `examples`, claves distintas) ni siquiera es cargable por `_CatalogFx`.
*Escenario:* 4 módulos / 23 lecciones / 2 quizzes que nunca aparecen en la app; material que parece parte del producto pero está muerto.
*Recomendación:* decidir su estado — integrarlo (extendiendo modelo/seeder para lecciones sin ejemplo) o moverlo fuera de `app/content/` como material de fase futura.

**BL-28 — El footer no distingue "Docker ausente" de "servicios detenidos"; `openExternal` sin uso** · missing-business-logic · CONFIRMED (2/2)
`useDockerStatus` colapsa `ok:false` (docker no instalado) y `ok:true, running==0` en un único `'down'` (`useDockerStatus.ts:42`); el footer siempre dice "servicios detenidos" (`RuntimeFooter.tsx:32`). `window.ehpc.openExternal` no se invoca en ningún punto del frontend, así que el link "Cómo instalar Docker" de `electron-spec.md` §8 (línea 567) no existe.
*Recomendación:* propagar `ok/error` como estado propio (ámbar/rojo según spec) y añadir el link `openExternal` cuando `ok===false`.

**BL-29 — El estado "ok" del footer ignora `health`** · logic-bug · CONFIRMED (2/2)
`useDockerStatus` solo cuenta `state==='running'` (`useDockerStatus.ts:40`) aunque `ComposeService` expone `health`; la spec exige "ok ∧ backend healthy" (`electron-spec.md:559`).
*Escenario:* backend `running` pero `unhealthy` ⇒ footer verde "N contenedores activos" con el backend sin responder.
*Recomendación:* incluir `health` en el cálculo (p. ej. `health !== 'unhealthy'`).

**BL-30 — Amdahl invertido sobre un ratio vs implementación externa** · domain-semantics · CONFIRMED (2/2)
`pairObservations` aplica la inversión de la Ley de Amdahl sobre `speedup_vs_reference` también cuando la referencia es NumPy o BLAS (`observations.ts:87-93`; consumido en `ComparisonBars.tsx:12`).
*Escenario:* `speedup_vs_reference = t_numpy / t_openmp` mide OpenMP contra otra implementación (1 core + SIMD), no el escalado `t(1)/t(n)` del mismo código; derivar de ahí "código con Y% paralelizable, Amdahl predice ~X×" presenta al estudiante un dato **fabricado** — error conceptual en el corazón educativo de la plataforma.
*Recomendación:* aplicar Amdahl solo con `pair_parallel_serial` (referencia = versión serial del mismo código); para NumPy/BLAS, una comparativa honesta sin "% paralelizable".

**BL-31 — El front no acota `fixed_threads` por núcleos: `--cpus` mostrado ≠ asignado** · inconsistency · CONFIRMED (2/2)
`effectiveCpus()` acota el caso sweep con `min(8, cores)` pero devuelve `fixed_threads` sin acotar (`ThreadsField.tsx:36`); el backend sí aplica `min(threads_effective, max_threads)` (`jobs.py:145`).
*Escenario:* máquina de 2 núcleos con `entornoDatos` (fixed=4): la pantalla muestra "Núcleos del host: 2" y a la vez "--cpus = 4" (`SimulatorIdle.tsx:254`), contradiciendo la regla `OMP_NUM_THREADS = --cpus` que el propio producto enseña; el live luego muestra 2.
*Recomendación:* replicar el clamp del backend en `effectiveCpus()`.

### Low

**BL-32 — `threads_note` se construye antes del clamp a `max_threads`** · inconsistency · CONFIRMED (2 paneles)
`threads_effective = example.fixed_threads or max_threads` genera la nota por defecto ANTES del `min(..., max_threads)` final (`jobs.py:139-145`). Con `fixed_threads` admin de hasta 16 (`schemas.py:685`) y `max_threads ≤ 8`, el 202 puede responder `threads_effective=8` con nota "fija 16 hilos; se asignan 16 CPUs".
*Recomendación:* aplicar el clamp antes de formatear la nota.

**BL-33 — Cierre 1011 sin el mensaje `error` previo documentado** · contract-violation · CONFIRMED (2/2)
§8.4 define 1011 como "error interno **(tras intentar emitir `error`)**"; la única rama 1011 (`ws.py:88-89`, estado inconsistente tras el retry de ~100 ms) cierra sin enviar nada.
*Recomendación:* intentar emitir `{"type":"error",...}` antes del `close(1011)`.

**BL-34 — `fase4-autoria-design.md` aún documenta `403 ADMIN_DISABLED`** · inconsistency · CONFIRMED (2/2)
El contrato y el código implementan el 401 indistinguible; el doc de diseño (líneas 343, 347 y pseudocódigo §5.4) conserva el diseño anterior que filtra el estado del servidor — riesgo de que un mantenedor lo reintroduzca.
*Recomendación:* actualizar §5.3/§5.4/§5.6 del doc de diseño.

**BL-35 — Filename inválido: 415 (multipart) vs 422 (JSON) en el mismo endpoint** · inconsistency · CONFIRMED (2/2)
§10.4 promete "el MISMO validador de §7.2" (→ 415 `INVALID_EXTENSION`); la variante JSON valida por patrón pydantic (`schemas.py:714`) que el handler degrada a 422 `VALIDATION_ERROR` (`admin.py:261` despacha por Content-Type).
*Recomendación:* unificar en 415 vía el mismo camino de validación.

**BL-36 — 422 no documentado en `GET /jobs/{id}/output`** · contract-violation · CONFIRMED (2/2)
`?stream=foo` responde 422 (`jobs.py:396-397`); la tabla §9 solo declara 404/409 para ese endpoint.
*Recomendación:* añadir 422 a la tabla, o tratar stream desconocido como `combined`.

**BL-37 — `efficiency` derivada del `speedup` ya redondeado** · logic-bug · CONFIRMED (verificación directa del sintetizador; también hallado por el revisor R2 y perdido por un falso-duplicado del dedupe)
`speedup = round(baseline/time_s, 2)` (`output_parser.py:90`) y `efficiency = round(speedup/threads, 2)` (línea 96): doble redondeo que puede desviar el segundo decimal de la eficiencia respecto a `t(1)/(t(n)·n)` crudo.
*Recomendación:* calcular `efficiency` desde los tiempos crudos y redondear una sola vez.

**BL-38 — `lessons_completed` no filtra lecciones deshabilitadas** · edge-case · CONFIRMED (verificación directa del sintetizador sobre `modules.py:150-155`)
`lessons_enabled` filtra por `lesson.enabled` (línea 150) pero `lessons_completed` solo exige `record.completed` + existencia (líneas 151-155).
*Escenario:* lección completada y luego deshabilitada (p. ej. pasa a GPU) sigue contando ⇒ posible `lessons_completed > lessons_enabled` en el catálogo.
*Recomendación:* filtrar también por `enabled` (y revisar la métrica equivalente de módulos en `/progress`).

**BL-39 — CSP real ≠ spec congelada (`font-src` + `data:`)** · contract-violation · CONFIRMED (2/2)
`security.ts:16` añade `data:` a `font-src` (fuentes @fontsource inlineadas por Vite); `electron-spec.md:471` (§7.1, CONGELADO) declara solo `'self'`.
*Recomendación:* actualizar la spec (o eliminar el inlining) para que coincidan.

**BL-40 — Etiqueta "Procesos/hilos" (semántica MPI) en Resultados** · domain-semantics · CONFIRMED (2/2)
`ResultsCards.tsx:75` rotula `pids_max` como "Procesos/hilos". En OpenMP/PyOMP hay UN proceso con N hilos; "procesos" sugiere ranks MPI, contra el modelo de memoria compartida que la plataforma enseña. (El resto de la UI usa "Hilos" consistentemente; el grep anti-MPI no halló más restos semánticos reales — ver matriz.)
*Recomendación:* renombrar a "Hilos (PIDs)" o similar.

---

## 4. Reglas de negocio esperadas vs implementadas (matriz de cobertura del contrato)

Estado: ✓ = verificada y conforme · ⚠ = implementada con desviaciones (ver hallazgos) · ✗ = incumplida · — = no verificada a fondo (ver Apéndice B).

| Regla (fuente) | Estado | Notas / hallazgos |
|---|---|---|
| Envelope `{success,data,error,meta}` en todo salvo `/health` y `/output` (§1) | ✓ | Verificado endpoint a endpoint por el revisor de conformidad. |
| Catálogo cerrado de códigos de error (§1.1) + re-formateo del 422 pydantic | ⚠ | Conforme en general; 422 no documentado en `/output` (BL-36); fallbacks `NOT_FOUND`/`METHOD_NOT_ALLOWED` deliberados y comentados en `errors.py` (refutado como violación). |
| Máquina de 8 fases + guard de terminales en `finish`/`set_phase` (§7.7, data-model §5) | ✓ | Guard `WHERE status NOT IN (terminales)` presente y testeado. |
| `wall_time_ms = finished − started` (excluye cola) (§7.3) | ✓ | Conforme. |
| Validación de `POST /jobs` (fuentes, threads por flags, timeout, `lesson_id`, disabled, 429, 503) (§7.1) | ⚠ | Reglas presentes; TOCTOU en el tope de cola (BL-08); `threads_note` sin clamp (BL-32); UI de hilos fijos sin clamp (BL-31). |
| `source_kind` example/editor/upload con byte-comparación (§7.1) | ✓ | Verificado por el revisor de conformidad. |
| «Al terminar bien el job se actualiza `last_job_id`» (§7.1) | ✗ | **Nunca implementado** (BL-05; anomalía WP9-02 conocida en tests). |
| Cancel sin carrera en `queued`; `kill_reason` cancel>output_limit>timeout (§7.5, arch. §3.3) | ⚠ | El job jamás se ejecuta tras cancel aceptado (✓, verificado); pero `handle.phase` queda desincronizado (BL-07) y la interacción `output_truncated`×`kill_reason` contradice §7.4 (BL-13). |
| `error_detail` de catálogo cerrado, sin texto crudo (§7.4) | ✓ | Conforme (el caso BL-03 lo contamina indirectamente vía `sandbox_error`). |
| Sandbox: flags constantes, sin parámetros de usuario en HostConfig; red none/non-root/read-only (backend/CLAUDE.md) | ✓ | Verificado por el revisor de seguridad; ningún parámetro de usuario llega a HostConfig. |
| `OMP_NUM_THREADS = NUMBA_NUM_THREADS = --cpus` (backend/CLAUDE.md) | ⚠ | Backend conforme (verificado en `docker_service.py`); la UI muestra un `--cpus` sin clamp (BL-31); cores compartidos bajo concurrencia contradicen la reproducibilidad prometida (BL-14). |
| Presupuesto de output 262 144 B (stdout+stderr) → truncado → kill → failed (§8.4) | ⚠ | Aplicado por el drainer (✓); precedencia con cancel/timeout incoherente con §7.4 (BL-13). |
| WS: Origin validado, 4404, replay terminal + `eof` + close 1000, sin ventana ciega (§8.1) | ⚠ | Origin/4404/orden verificados; el replay rompe la continuidad de `seq` (BL-09), fabrica `ts` (BL-16) y el 1011 no emite `error` (BL-33). |
| `seq` monótono; backlog reusa los `seq` originales (§8.2) | ⚠ | Cierto para el backlog en vivo (ring-buffer); falso para el replay post-terminal (BL-09) y el cliente tampoco resetea su dedupe (BL-10). |
| Colas por-conexión lossy; backpressure solo productor↔drainer (§8.4) | ✓ | Verificado (`SUBSCRIBER_QUEUE_MAX` + `put_nowait`); la no-detección de huecos `seq` en el cliente fue refutada como violación (limitación aceptada del contrato). |
| Quiz: `correct_key`/`explanation` jamás en GET público (§5.1) | ✓ | Verificado explícitamente (DTO y serialización). |
| Validación del intento: todas las preguntas, ids existentes, `a\|b\|c\|d` (§5.2) | ✓ | Conforme. |
| `passed = score/total ≥ pass_threshold`; best solo mejora; passed ⇒ completed; unidad bajo `write_lock` (§5.2, data-model §5) | ⚠ | Fórmula y efectos correctos; la "unidad" son dos commits (BL-04); sin reconciliación tras ediciones admin del quiz (BL-06); interacción con ids reutilizados (BL-01). |
| `PUT /progress` solo `viewed`/`completed` (§6.2) | ✓ | `best_quiz_score`/`last_job_id` no escribibles vía API (verificado). |
| Merge de progreso + summary en `/modules` (§4.1) | ⚠ | Merge correcto; `lessons_completed` no filtra deshabilitadas (BL-38). |
| `write_lock` transversal en toda escritura (data-model §2) | ⚠ | Respetado por todos los caminos de escritura (verificado); pero lo retienen también lecturas admin N+1 (BL-19) y no da atomicidad multi-commit (BL-04). |
| Seeder idempotente; auto-seed solo con `lessons` vacía; `--prune` al baseline (data-model §7.3) | ⚠ | Idempotencia y orden padres→hijos verificados; "vacía ≠ nunca sembrada" (BL-21). |
| Recarga atómica del snapshot tras cada escritura admin; no re-leer entre awaits (data-model §7.4) | ✓ | Patrón validar→lock→persist→reload→swap verificado en las 10 mutaciones. |
| Invariante `lesson_id == example_id`; ejemplo nace/muere con la lección (§10.1) | ⚠ | CASCADE lección→ejemplo/quiz correcto; pero el borrado no alcanza `lesson_progress`/`quiz_attempts` (BL-01). |
| Reglas §10.6 (referencial, `DUPLICATE_ID`, `ORDER_CONFLICT`, `MODULE_NOT_EMPTY`, `correct_key`, `parser_id`, markdown subset, coherencia hilos/GPU, rangos) | ⚠ | Implementadas y con códigos correctos (verificado); autogeneración de id de pregunta ausente (BL-18); el propio fixture GPU viola la coherencia (BL-11); swap de `order` imposible en un paso (BL-20); validación solo-por-escritura es diseño documentado (refutada su ausencia en `load()`). |
| Auth admin: 401 indistinguible, dummy compare, Bearer TTL 8 h sin renovación, guard en todo `/admin/*` (§10.0) | ⚠ | Todo verificado endpoint a endpoint (incl. que `/session` no renueva y el token solo va a `/api/v1/admin/*`); throttle evadible en concurrencia (BL-23); password reflejable en 422 (BL-22); doc de diseño desactualizado (BL-34). |
| GET públicos §3–§5 byte-idénticos tras Fase 4 | ✓ | Verificado contra `from_fixtures` vs `load(db)` y goldens. |
| `/health` sin envelope, liveness≠readiness; `max_threads = min(8, cores)` (§2) | ✓ | Conforme. |
| Dominio OpenMP sin restos MPI/Slurm (CLAUDE.md) | ⚠ | Grep exhaustivo en backend, frontend y contenido: lecciones limpias (menciones a MPI son pedagógicas); componentes viz correctos (nombres como `NodeDiamond` son léxico visual, no semántica); restos reales: etiqueta "Procesos/hilos" (BL-40) y el Amdahl fabricado en pair vs librería (BL-30). |
| Contratos congelados frontend (`types.ts`, `messages.ts`, `ehpc.d.ts` byte-idéntico a desktop) | ✓ | `ehpc.d.ts` verificado byte-idéntico con diff; regex de `sweepParse.ts` idénticas a las del backend. |
| Electron-spec: hardening, CSP, IPC whitelist, estados del footer (§7-§8) | ⚠ | Hardening e IPC verificados (canales sin parámetros del renderer); CSP desvía en `font-src` (BL-39); estados del footer no implementan la spec (BL-28, BL-29); composes empaquetados desincronizados (BL-02, BL-12). |

---

## 5. BUG-01 (hallazgo previamente conocido)

**Estado: RESUELTO y verificado en el código actual** (clasificación: logic-bug de UI admin, resuelto el 2026-07-14 según `docs/e2e-visual-report.md` §10). Verificación directa sobre `frontend/src/features/admin/quiz/AdminQuizEditor.tsx`:

- Líneas 75–80: el `404 QUIZ_NOT_FOUND` de la carga inicial se trata como **quiz vacío editable** (`isMissingQuiz` → `emptyQuiz(lessonId)`), no como `ErrorState`.
- Línea 55: las preguntas nuevas usan la clave estable `_cid` como `id` provisional válido (`id: q.id || _cid`), evitando el `422` del contrato §10.6 por id vacío.

No se re-reporta como hallazgo. Dos observaciones colindantes sí forman parte de esta auditoría: el fix descansa en que el cliente siempre provea el id — la autogeneración server-side que promete §10.5 sigue sin existir (**BL-18**) — y la edición admin del quiz sigue sin reconciliar el progreso previo (**BL-06**).

---

## 6. Zonas grises / preguntas para el autor

Ambigüedades del contrato donde la auditoría no puede decidir sola cuál es el comportamiento pretendido:

1. **Reutilización de ids borrados (BL-01):** ¿debe purgarse el estado del estudiante al borrar la lección, o debe prohibirse reutilizar un id ya usado (tombstone)? El contrato solo define el CASCADE de contenido; guarda silencio sobre `lesson_progress`/`quiz_attempts`.
2. **Autogeneración de id de pregunta (BL-18):** ¿se implementa el fallback `{lesson_id}-q{n}` de §10.5, o se corrige el contrato para exigir siempre id de cliente (lo que hoy hace el frontend con `_cid`)?
3. **Precedencia `output_truncated` × `kill_reason` (BL-13):** si un job se cancela justo cuando su output se trunca, ¿qué debe prevalecer en `status`/`error_detail`? §7.4 y el primer-escritor-gana implementado (y testeado) son incompatibles.
4. **Auto-seed (BL-21):** ¿"catálogo vacío ⇒ sembrar" es la semántica deseada, o debe respetarse un catálogo vaciado deliberadamente por el admin?
5. **Reordenamiento (BL-20):** ¿está previsto un endpoint de reorder por lote, o el workaround de `order` temporal es el flujo esperado (y habría que reflejarlo en la UI)?
6. **Aislamiento de cores bajo concurrencia (BL-14):** ¿se acepta que dos jobs concurrentes compartan cores (documentándolo como limitación de las métricas), o se esperan `cpuset` disjuntos por slot?
7. **`last_job_id` (BL-05):** el contrato lo exige pero ninguna pantalla lo consume hoy. ¿Es una feature pendiente (implementarla) o una regla muerta (retirarla del contrato)?
8. **`content/fundamentos/` (BL-27):** ¿material de una fase futura (moverlo fuera de `app/content/`) o contenido que debía servirse (requiere extender el modelo a lecciones sin ejemplo)?
9. **Rango de `fixed_threads` admin (BL-32):** el DTO permite 1..16 pero `max_threads ≤ 8`; ¿debe el DTO acotarse a 8, o el clamp runtime es la política (y solo falta corregir la nota)?
10. **CSP de fuentes (BL-39):** ¿actualizar la spec congelada a `font-src 'self' data:` o cambiar la estrategia de build para no inlinear fuentes?

---

## 7. Apéndice

### A. Metodología

Workflow dinámico multi-agente (revisión estática, mandato estricto de solo lectura):

1. **Scout inline:** extracción de las reglas de negocio esperadas desde `docs/architecture/` (api-contract, data-model) + CLAUDE.md; ese "debe ser" se inyectó a todos los revisores.
2. **Fan-out:** 11 revisores especializados en paralelo (jobs/ciclo de vida, sandbox/aislamiento, WebSocket, cursos/quiz/progreso, admin CRUD, admin SQL, persistencia/seeder, auth admin, frontend, dominio/métricas, conformidad de contrato) con agentes python/typescript/security/database/architect según dominio.
3. **Verificación adversarial:** cada hallazgo fue atacado por 2 escépticos independientes con la consigna de refutarlo leyendo el código real (ante la duda, refutar); un tercero desempataba discrepancias. Mayoría refuta ⇒ descartado. CONFIRMED exige prueba con citas `archivo:línea`.
4. **Crítico de completitud:** detectó 3 huecos reales (parsers de `output_parser.py`, shell Electron, fixtures/paridad de validación) → segunda ronda de fan-out + verificación sobre ellos, más una corrida de cierre para Electron y dominio OpenMP.
5. **Síntesis:** deduplicación entre áreas (6 grupos fusionados, ver C), orden por severidad, verificación directa de 2 ítems perdidos por fallos operativos (BL-37, BL-38).

Volumen: ~130 subagentes útiles, ~7,8 M tokens, ~2 500 llamadas a herramientas de lectura. Incidencias operativas: la primera corrida cayó a mitad por el límite de sesión (se reanudó desde caché sin perder trabajo); 2 revisores fallaron por el tope de reintentos de salida estructurada y sus dominios se recuperaron en la corrida de cierre; una discrepancia entre paneles de verificación (BL-20 vs su gemelo refutado) se documenta en el propio hallazgo.

### B. Qué se revisó y qué quedó fuera

**Revisado a fondo (13 áreas):** todos los routers y services del backend; `schema.sql` completo (v1 + migration 2) y los 5 repositorios; seeder y herramientas; el ciclo completo del WS (backend y cliente); los DTOs congelados contra el contrato endpoint a endpoint; los contratos congelados del frontend y su uso real (stores, hooks, sockets, simulador, quiz, admin); auth admin de punta a punta (incl. enumeración del guard en todos los endpoints y el manejo del token en el cliente); `output_parser.py` completo (con ejecución local de solo-cómputo para reproducir BL-03 y BL-37); `catalog.json` contra data-model §4.2 (los 14 ejemplos, uno a uno, y muestreo de 8 `main.py`); grep anti-MPI en backend, frontend y contenido; shell Electron (`main/preload/ipc-docker/security/constants`, byte-identidad de `ehpc.d.ts`, composes empaquetados).

**Fuera de alcance (honestidad):** ejecución dinámica (no se levantó el stack, no se corrieron pytest/vitest/build; dos verificaciones puntuales ejecutaron el parser en aislamiento); el render markdown real del subset; los 23 `.md` de `fundamentos/` línea a línea; la migración real Fase 3→4 sobre una DB poblada (solo lectura del mecanismo); `nginx.conf` y `scripts/` en detalle; el comportamiento real de Docker/cgroups (solo análisis estático de flags); accesibilidad y capa visual (el rediseño en curso no se auditó como tal).

### C. Duplicados fusionados y falsos positivos filtrados

**Fusiones (mismo defecto hallado independientemente por varias áreas — señal de robustez):** BL-01 (×3: cursos, admin-SQL, persistencia) · BL-04 (×3) · BL-05 (×2) · BL-18 (×2) · BL-32 (×2) · BL-37 (revisor R2 + verificación directa).

**Refutados por la verificación adversarial (no entran al reporte):**

| Candidato | Motivo del descarte |
|---|---|
| `mark_orphans_failed()` no fija `finished_at`/`wall_time_ms` | La firma/cuerpo exactos están CONGELADOS en data-model §5; comportamiento deliberado. |
| Dummy-compare usa `TOKEN_BYTES` público como longitud | Mecánicamente cierto pero sin impacto práctico distinguible en el modelo de amenaza loopback. |
| El cliente no detecta huecos de `seq` hacia adelante | Cierto, pero el contrato define la entrega como lossy y no exige detección en el cliente (limitación aceptada, no violación). |
| Códigos `NOT_FOUND`/`METHOD_NOT_ALLOWED`/`HTTP_ERROR` fuera de §1.1 | Fallback deliberado y comentado en `errors.py` para rutas fuera del contrato. |
| PUT de `order` no soporta intercambio (variante "high") | Refutado como limitación de UX con workaround (order temporal); la variante confirmada quedó como BL-20 (medium) con el matiz. |
| Cancelar solo funciona con WS OPEN, sin fallback REST | El flujo real de la UI mantiene el WS o repone la conexión; la calificación de bug de negocio no se sostuvo al ampliar contexto. |
| `load()`/`from_fixtures` no reaplican §10.6 | Diseño explícito del contrato: la validación §10.6 es "por escritura" (el caso donde esto sí muerde quedó capturado como BL-11). |
| `DOCKER_ACTIONS` sin guarda `hasOwnProperty` | El único canal real invoca acciones con strings literales fijos sin parámetros del renderer; no hay input atacante. |

### D. Trazabilidad

Resultados intermedios del workflow (hallazgos por agente, votos de los escépticos y journal completo) en los transcripts de la sesión: `wf_85f52efb-bfb` (corrida principal + reanudación) y `wf_86eda2ad-0ca` (cierre de huecos). Este reporte es el único archivo escrito en el repositorio por la auditoría.
