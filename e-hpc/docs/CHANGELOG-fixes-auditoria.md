# CHANGELOG — Fixes de la auditoría de lógica de negocio

Correcciones derivadas de [`audits/business-logic-audit.md`](audits/business-logic-audit.md),
aplicadas por sesiones de alcance cerrado. Cada entrada referencia el hallazgo
(BL-nn) de la auditoría.

## Sesión 1 (2026-07-19) — Hotfix del desktop empaquetado · rama `fix/auditoria-s1-desktop`

Regresión crítica: el compose empaquetado del desktop
(`desktop/resources/compose/compose.yaml`) reintrodujo dos bugs de infra ya
corregidos en el compose raíz y marcados como "no re-introducir" en
`CLAUDE.md`.

### BL-02 (critical) — volumen `ehpc_submissions` sin `name:` explícito

- **Causa:** el compose empaquetado fija `name: ehpc` como proyecto pero
  declaraba el volumen `ehpc_submissions:` sin `name:` explícito. Compose
  creaba `ehpc_ehpc_submissions` mientras el runner monta el literal de
  `TELAR_SUBMISSIONS_VOLUME` (`ehpc_submissions`) → el runner montaba un
  volumen vacío autocreado y **todos los jobs del simulador fallaban** con
  "no such file or directory" en Modo A (instalador con imágenes GHCR).
- **Fix:** `name: ehpc_submissions` en el volumen, igual que el compose raíz
  (con comentario explicando el porqué, espejo del raíz).

### BL-12 (high) — `TELAR_ALLOWED_ORIGINS` sin variantes `127.0.0.1`

- **Causa:** el compose empaquetado conservaba la lista vieja de orígenes
  (`localhost` + `null`); el navegador manda `Origin: http://127.0.0.1:8080`
  → CORS/WS bloqueados para quien abra la URL publicada en su navegador.
- **Fix:** lista igualada a la del compose raíz (variantes `localhost` y
  `127.0.0.1` para 5173 y 8080, más `null` para Electron `file://`).

### Test de paridad (nuevo) — `backend/tests/test_compose_parity.py`

6 tests que comparan los campos críticos entre `compose.yaml` raíz y
`desktop/resources/compose/compose.yaml`: `name:` explícito del volumen
`ehpc_submissions` en ambos, `TELAR_ALLOWED_ORIGINS` idéntica, y
`TELAR_SUBMISSIONS_VOLUME` idéntica entre composes **y** coincidente con el
`name:` real del volumen (paridad env↔volumen). Escrito RED contra la
regresión (TDD) y verde tras el fix: esta desincronización ya no puede volver
a pasar silenciosa.

### BL-39 (low) — spec de CSP desactualizada (**actualización deliberada de spec**)

`docs/architecture/electron-spec.md` §7.1 (CONGELADO) declaraba
`font-src 'self'`, pero el código correcto (`desktop/src/security.ts`) usa
`font-src 'self' data:` porque Vite inlinea los subsets pequeños de fuentes
@fontsource (< `assetsInlineLimit`) como `data:font/woff2` dentro del CSS —
sin `data:` la CSP los bloquea al cargar por `file://`. Se actualiza la spec
para reflejar el comportamiento correcto del código (el código NO cambia).
En la misma edición, el compose de ejemplo de §6.1 incorpora el
`name: ehpc_submissions` del fix BL-02 para no volver a documentar el compose
defectuoso.

### Verificación

- `tests/test_compose_parity.py`: RED antes del fix (3 failed), verde después
  (6 passed); revierte a rojo si se revierte el fix.
- Suite backend completa verde sin daemon Docker (`DOCKER_HOST` inválido +
  fakes), cobertura ≥ 80 % mantenida.
- `docker compose -f desktop/resources/compose/compose.yaml config` parsea
  sin errores tras el fix.

## Sesión 2 (2026-07-19) — Integridad de progreso y quiz (backend) · rama `fix/auditoria-s2-progreso`

Los seis hallazgos de integridad de datos de progreso/quiz del backend
(§3 y zonas grises 1, 4 y 7 de la auditoría). Todos con TDD: test RED que
reproduce el escenario del reporte → implementación mínima → suite completa
en verde (293 tests tras la ronda de review, cobertura 91.0%, goldens de GET
públicos intactos).

### BL-04 (high) — `submit_attempt` no era atómico

- **Causa:** `QuizAttemptRepository.create()` y `ProgressRepository.upsert()`
  comiteaban cada uno por su cuenta; el `rollback()` del servicio era un no-op
  para el primer paso ya confirmado. Un fallo entre ambos commits dejaba el
  intento persistido sin actualizar jamás `best_quiz_score`/`completed`.
- **Fix:** variantes `create_no_commit`/`upsert_no_commit` en los repos (las
  firmas congeladas `create`/`upsert` las reutilizan y conservan su semántica)
  y un ÚNICO `commit()`/`rollback()` en `QuizService.submit_attempt` dentro de
  `write_lock` (patrón build-then-commit de `content_writer._persist`).

### BL-01 (critical) — borrar lección dejaba progreso/intentos huérfanos

- **Causa:** `lesson_progress`/`quiz_attempts` no tienen FK a `lessons`;
  `delete_lesson` no las tocaba. Reutilizar el id resucitaba `completed:true`
  y `best_quiz_score` ajenos, irreparables por el MAX/COALESCE del upsert.
- **Decisión (zona gris 1):** PURGA en la misma transacción del DELETE (no
  tombstone). Documentado como extensión deliberada en api-contract §10.1.

### BL-06 (high) — editar/borrar el quiz no reconciliaba el progreso

- **Causa:** `replace_quiz`/`delete_quiz` no tocaban `lesson_progress`:
  `best_quiz_score` podía superar el `quiz_total` vigente y `completed`
  quedaba evaluado contra un quiz que ya no existe.
- **Decisión:** si cambia el nº de preguntas o el `pass_threshold` (y siempre
  al borrar el quiz) se resetea `best_quiz_score=NULL`/`completed=false` en la
  misma transacción; las ediciones cosméticas no tocan el progreso y `viewed`
  se conserva. Documentado como extensión deliberada en api-contract §10.5.
  El estado previo se lee ANTES del reemplazo, dentro del `write_lock`.

### BL-05 (high) — `lesson_progress.last_job_id` nunca se escribía

- **Causa:** regla explícita de api-contract §7.1 sin implementar (anomalía
  conocida WP9-02 en `test_anomalies.py`); `JobRunner` no conocía el
  `lesson_id` ni tenía acceso a `ProgressRepository`.
- **Decisión (zona gris 7):** implementar la regla tal cual está escrita.
  `JobRunner` recibe el repo de progreso; al derivar `completed` en un job con
  `lesson_id` hace `upsert(last_job_id)` bajo `write_lock` ANTES del finish
  terminal (quien observa `completed` ya ve `last_job_id`). Jobs
  failed/timeout/cancelled no escriben. `test_ANOMALIA_WP9_02` invertido a
  test de comportamiento correcto.

### BL-21 (medium) — el auto-seed re-sembraba un catálogo vaciado a propósito

- **Causa:** la condición era `COUNT(*) FROM lessons == 0`, que no distingue
  "nunca sembrada" de "vaciada por el admin".
- **Decisión (zona gris 4):** marcador persistente `content_seeded_at` en la
  nueva tabla `app_meta` (migración 3) como condición del auto-seed. El seeder
  escribe el marcador en su misma transacción; DBs pobladas pre-migración
  reciben backfill del marcador sin tocar su contenido.

### BL-38 (low) — `lessons_completed` no filtraba lecciones deshabilitadas

- **Causa:** `GET /modules` y `GET /progress` contaban lecciones completadas
  aunque estuvieran deshabilitadas: `lessons_completed` podía superar
  `lessons_enabled`.
- **Fix:** ambas métricas filtran por `lesson.enabled`; el registro de
  progreso del estudiante se conserva (reaparece al rehabilitar la lección).

### Notas de alcance

- `schemas.py` y los DTOs congelados: SIN cambios. Los GET públicos §3–§5
  siguen byte-idénticos (goldens verificados).
- `api-contract.md` solo ganó las dos reglas nuevas de §10.1/§10.5 como
  extensión deliberada (este changelog es su registro).
- Nuevos tests: `test_quiz_atomicity.py` (6: 3 de atomicidad + 3 de carrera
  F1), `test_admin_content.py` (+6), `test_job_runner.py` (+4),
  `test_app_lifespan.py` (+3), `test_seed_content.py` (+1 rollback F3),
  WP9-02 invertido. Total suite: 293.

### Ronda de review de la Sesión 2 (python-reviewer + database-reviewer)

- **F1 (high, corregido)** — `submit_attempt` puntuaba contra el snapshot en
  memoria ANTES de tomar `write_lock`: un reemplazo/borrado admin commiteado
  mientras el intento esperaba el lock era pisado por el intento obsoleto,
  derrotando la purga de BL-01 y el reset de BL-06 (permanente por el MAX de
  `best_quiz_score`). Fix: revalidación contra la DB DENTRO del lock
  (`_ensure_content_current`): lección inexistente → 404 `LESSON_NOT_FOUND`;
  quiz borrado → 404 `QUIZ_NOT_FOUND`; ids de pregunta o umbral distintos →
  422 `VALIDATION_ERROR` («el quiz cambió; recarga la lección»). Sin códigos
  nuevos de error. Cambios cosméticos no abortan (espeja §10.5).
- **F3 (low, corregido)** — `seed_content_into` era la única unidad de
  escritura sin `rollback` ante fallo (gap pre-existente): el cuerpo se
  extrajo a `_apply_seed_statements` y la unidad hace commit/rollback único.
- **F2 (residual aceptado)** — el upsert de `last_job_id` y el `finish`
  terminal de un job son dos unidades commiteadas en secuencia (deliberado:
  quien ve `completed` ya ve `last_job_id`). Ventana residual: un crash entre
  ambas deja `last_job_id` apuntando a un job que el reaper marcará
  `orphaned_on_restart`. Análogo residual: un `PUT /progress` o un job en
  vuelo durante un `DELETE` de lección puede recrear una fila de progreso
  (sin `completed`/`best` de quiz — la vía quiz quedó cerrada por F1).
- Follow-ups anotados (no bloqueantes): tipado `Any` de dependencias del
  runner (convención pre-existente del archivo).

---

## Sesión 3 (2026-07-19) — Jobs, parsers y WebSocket · rama `fix/auditoria-s3-jobs-ws`

14 hallazgos del ciclo de vida de jobs, los parsers de stdout y el protocolo
WebSocket, más las decisiones de las zonas grises 3 y 6. Un test de regresión
por hallazgo (TDD RED→GREEN). Contratos congelados (`schemas.py`,
`frontend/src/ws/messages.ts`, `api/types.ts`): SIN cambios.

### Parsers (`output_parser.py`)

- **BL-03 (critical)** — una línea `hilos = 0` en el stdout de un sweep
  (posible con el código editado por el estudiante) lanzaba `ZeroDivisionError`
  al calcular `speedup/threads`. La excepción escapaba del módulo —cuyo
  docstring promete «jamás lanza»— y el manejo de errores del `job_runner`
  reclasificaba un job con `exit 0` como `failed`/`sandbox_error`. Reproducido
  primero en un test; `threads<=0` ahora devuelve `None`, igual que `time_s<=0`.
- **BL-25 (medium)** — el guard de los parsers `pair` solo cubría
  `parallel_s<=0`: una referencia que imprimiera `0.000 s` daba
  `speedup_vs_reference=0.0`, mostrado como «0x» en vez de descartar el
  parseo. Extendido a `reference_s<=0`; la regla «algún `time_s<=0` ⇒ `None`»
  queda uniforme.
- **BL-26 (medium)** — `_sweep_series` acumulaba cada línea sin deduplicar:
  dos líneas del mismo N (re-impresión por un bug del estudiante) producían
  puntos repetidos que la `SpeedupChart` pintaba como curva válida. Ahora la
  serie con hilos duplicados se descarta entera. Un barrido **parcial** sin
  duplicados sigue siendo válido: el conjunto de hilos no está en contrato.
- **BL-37 (low)** — `efficiency` se derivaba del `speedup` ya redondeado a 2
  decimales (doble redondeo que desviaba el segundo decimal). Se calcula desde
  los tiempos crudos, `t(1)/(t(n)·n)`, con un solo redondeo.

### Ciclo de vida de jobs

- **BL-07 (high)** — `cancel()` sobre un job `queued` escribía `cancelled` en
  DB al instante pero dejaba `handle.phase='queued'` hasta que la tarea
  adquiría el semáforo (minutos con jobs largos delante): la cola sobrecontaba
  el job cancelado (429 con capacidad real libre) y un WS que conectara en esa
  ventana lo veía activo en vez de recibir el status terminal. La
  sincronización del handle pasa a ser síncrona —antes de cualquier `await`—
  y se emiten `status` terminal + `eof` a los suscriptores conectados.
  Documentado en `architecture.md` §3.3.
- **BL-08 (high, race)** — TOCTOU en el tope de cola: `queued_count()` se leía
  una vez y seguían varios `await` (ping, `image_present`, `create`) antes de
  registrar el job, así que N POST concurrentes cerca del límite superaban los
  10 sin límite efectivo. Se añade una reserva atómica del slot
  (`try_reserve_queue_slot`, síncrona en el event loop) liberada **siempre** en
  un `finally`. Test: 25 POST concurrentes con `asyncio.gather` +
  `httpx.ASGITransport` y un `ping` lento ⇒ exactamente 10×202 y 15×429.
- **BL-32 (low)** — `threads_note` por defecto se construía ANTES del clamp a
  `max_threads`, citando más CPUs de las asignadas (el DTO admin permite
  `fixed_threads` hasta 16 y `max_threads ≤ 8`). El clamp pasa a ser previo.
- **BL-15 (medium)** — si `containers.create()` triunfaba y `start()` lanzaba,
  nadie eliminaba el contenedor (`handle.execution` seguía `None`, así que
  `_cleanup_resources` no limpiaba) y quedaba en el daemon hasta el reaper del
  siguiente arranque. Ahora el `except` hace `remove(force=True, v=True)`; un
  fallo del propio remove se logea sin enmascarar el error original.

### WebSocket

- **BL-09 (high, contract-violation)** — el replay post-terminal reconstruía
  los logs desde el texto plano de la DB y numeraba `seq` desde 0, mientras
  §8.2 promete que el backlog re-usa los originales y el cliente descarta
  `seq <= lastLogSeq`. Si la conexión caía con el job vivo y este terminaba
  durante la desconexión, la reconexión traía un replay que el dedupe
  descartaba entero: **terminal sin salida**.
  **Opción elegida (A), por menor riesgo:** diferir el paso 5 de §3.4 — el
  `JobHandle` terminal se retiene 10 s en el registro (`closed=True`:
  `get_active()` devuelve `None` y la cola no lo cuenta; `get_finished()` lo
  expone al handler WS) y el replay sirve ese backlog TAL CUAL, con `seq` y
  `ts` reales. No toca el formato de los mensajes ni el cliente, y el caso
  frecuente —reconexión por backoff de 1s/2s/4s— cae dentro de la ventana.
  Se descartó la opción B (renumerar y documentar la discontinuidad) porque
  degradaba una garantía del contrato para todos los clientes. Pasado el
  plazo, el replay cae a la vía DB, ahora documentada en §8.2 como sesión
  nueva; el reset del cliente (BL-10) se implementa igualmente como defensa
  en profundidad.
- **BL-16 (medium)** — el replay desde DB fabricaba el `ts` de cada línea con
  la hora del replay y `LiveTerminalCard` lo pintaba como reloj `[HH:MM:SS]`:
  tras un F5, todas las líneas mostraban la hora del refresh como si fuera el
  tiempo real de ejecución. Ahora va `""` (instante desconocido, §8.2) y la
  terminal lo renderiza como `—` sin cambios de código; test de coordinación
  añadido en `LiveTerminalCard.test.tsx`.
- **BL-33 (low)** — la única rama de `close(1011)` cerraba sin enviar nada,
  cuando §8.4 lo define como «error interno (tras intentar emitir `error`)».
  Se emite un `{"type":"error","code":"STREAM_ERROR"}` del catálogo cerrado
  §8.2 antes del cierre.

### Frontend (un solo archivo)

- **BL-10 (high)** — `retry()` → `connect()` reseteaba el store (`logs=[]` vía
  `begin()`) confiando en que el backlog re-poblara, pero `JobSocket` nunca
  reseteaba `lastLogSeq`: el backlog llegaba con los `seq` originales y el
  filtro lo descartaba todo (job `lost` → «Reintentar conexión» → pantalla sin
  ninguna línea). `connect()` pasa a resetear —vía un `resetSession()` privado,
  autocontenido— todo el estado que vive UNA conexión: `lastLogSeq`, `sawEof`,
  `lastPhase`, el buffer pendiente, el `rafId` y el backoff (`retries` +
  temporizador). Con `sawEof` se corrige un efecto colateral de la misma
  familia: el `eof` de una sesión anterior ya no suprime el backoff de la nueva.
  `sawActivePhase` queda **deliberadamente fuera** del reset: su ámbito es la
  instancia del socket (= una visita a la pantalla del job), que es lo que
  distingue «aterricé en un job ya terminado» —F5/historial ⇒ redirigir a
  resultados— de «lo vi correr y se completó mientras reconectaba» ⇒ quedarse
  en el live ya re-poblado. Resetearlo hacía que un job terminado durante la
  desconexión expulsara al usuario del live al pulsar «Reintentar conexión»,
  cuando el mismo job terminando sin caída de conexión lo dejaba ahí con el
  botón «Ver resultados»: dos conductas para el mismo estado final.

### Decisiones de zonas grises (documentación deliberada)

- **BL-13 / zona gris 3 — precedencia `output_truncated` × `kill_reason`:**
  gana la **causa de terminación**. `status`/`error_detail` se derivan
  exclusivamente de `kill_reason + exit_code + OOMKilled` (primer escritor
  gana, comportamiento ya testeado) y `output_truncated` es un flag
  informativo independiente: un job cancelado mientras su salida se truncaba
  responde `cancelled` + `error_detail=null` + `output_truncated=true`. Se
  corrige `api-contract.md` §7.4, que afirmaba la implicación en el sentido
  incorrecto; la implicación válida (`error_detail="output_limit_exceeded"` ⇒
  `output_truncated=true`) queda escrita. Sin cambios de código.
- **BL-14 / zona gris 6 — aislamiento de cores bajo concurrencia:** NO se
  implementa `cpuset` disjunto por slot. `architecture.md` §4 documenta que el
  rango arranca siempre en el core 0, que con `TELAR_MAX_CONCURRENT_JOBS > 1`
  dos jobs comparten cores físicos, y que la reproducibilidad de las métricas
  aplica **ejecutando un job a la vez**. Test que fija el comportamiento como
  deliberado.

### Verificación

- Backend: 315 tests, cobertura 91.5 % (`DOCKER_HOST=tcp://127.0.0.1:1 pytest
  --cov=app --cov-fail-under=80`).
- Frontend: 210 tests Vitest, `tsc --noEmit` limpio.

### Ronda de review de la Sesión 3 (python-reviewer + typescript-reviewer)

Ambos revisores confirmaron **cero hallazgos CRITICAL/HIGH**. El de backend
verificó explícitamente como correctos los cinco puntos delicados del diff: la
reserva del slot de cola (sin fuga posible, el `finally` cubre también
`CancelledError`), la retención del handle (`get_active` sigue devolviendo
`None`, sin fuga de memoria, sin interferencia de `subscribe`/`cancel`), la
ausencia de doble emisión en el cancel-en-queued, el orden `status → logs →
eof → close(1000)` del replay retenido, y el cleanup de `start()` fallido. El de
frontend comprobó, revirtiendo el fix, que los tests nuevos de BL-10 fallan con
los mensajes exactos del bug auditado (no son tautológicos).

Cuatro hallazgos MEDIUM corregidos en esta misma rama:

- **Frontera Docker en la limpieza de BL-15** — el `except` solo atrapaba
  `docker.errors.DockerException`. Si el daemon se cae a mitad del ciclo
  create→start, el `remove` golpea la misma conectividad rota y docker-py deja
  escapar una excepción cruda de `requests`, rompiendo la regla dura de
  `backend/CLAUDE.md` («`docker_service` es la única frontera con Docker»): el
  llamador recibiría un `requests.*` en vez de `DockerServiceError`. Se atrapan
  ambas familias, replicando la cautela que el propio archivo ya aplica en
  `JobExecution.wait()`. Un `NotFound` pasa a tratarse como la carrera benigna
  que es, sin warning de fallo de limpieza.
- **Drainer del cancel-en-cola** — un job cancelado en `queued` dejaba su
  drainer despertando cada `flush_interval` sin nada que consumir hasta que su
  tarea alcanzaba el semáforo: con la cola llena de jobs largos por delante,
  minutos. Se detiene en el acto (`_stop_drainer` es idempotente; `_run` lo
  re-invoca al despertar).
- **Retenciones vivas al apagar** — efecto colateral de BL-09: un `SIGTERM`
  dentro de la ventana de 10 s dejaba tareas `_expire()` pendientes y CPython
  avisaba «Task was destroyed but it is pending!» en cada redespliegue.
  `JobRunner.shutdown()` las cancela desde el lifespan.
- **`connect()` no autocontenido y ámbito de `sawActivePhase`** (frontend) —
  ver el detalle en BL-10 arriba; incluye una corrección de criterio: resetear
  `sawActivePhase` por conexión expulsaba al usuario del live cuando el job
  terminaba durante la desconexión.

Residuos aceptados (LOW, documentados y no corregidos):

- **Fila DB huérfana si `runner.start()` lanzara tras `job_repo.create()`** —
  pre-existente, no introducido por este diff (crear+arrancar no son una
  transacción conjunta). El `try/finally` nuevo protege el contador de cola,
  **no** la consistencia DB↔registro: conviene no leerlo como si lo hiciera.
- **La entrada en el registro de un job cancelado en cola sobrevive hasta que
  su tarea alcanza el semáforo** (su drainer ya no, ver arriba). No afecta a
  nada observable —`queued_count()` no lo cuenta, `get_active()` lo oculta y un
  WS que conecte recibe el replay terminal correcto— pero es una ventana más
  larga que los 10 s que sugiere `TERMINAL_HANDLE_RETENTION_S`. Cancelar la
  tarea parada en el semáforo se evaluó y se descartó: el `CancelledError`
  interrumpiría los `await` del `finally` de `_run` y podría dejar el drainer
  sin detener — peor que el residuo.

---

## Sesión 4 (2026-07-20) — Admin, autoría, auth y contrato · rama `fix/auditoria-s4-admin-auth`

Bugs de autoría admin, seguridad de auth y conformidad de contrato. Doc-first
donde toca contrato (`api-contract.md`, `fase4-autoria-design.md`), TDD por
hallazgo (una regresión ≥1 por BL en `backend/tests/test_audit_s4.py` y
`frontend/tests/admin/ExampleMetaFields.test.tsx`).

### Seguridad / auth

#### BL-22 (medium, security) — la contraseña podía volver en el 422 de `/admin/login`
El handler global de `RequestValidationError` serializaba `exc.errors()` de
pydantic sin filtrar, y `AdminLoginRequest.password` tiene `max_length=256` (el
input de la UI no acota): un password pegado > 256 chars fallaba validación y su
valor literal viajaba en `error.details[].input`. Nuevo
`errors.sanitize_validation_errors()` elimina `input`/`ctx`/`url` de cada error
(conserva `type`/`loc`/`msg`), aplicado en el handler global y en el
`_parse_json_body` de `admin.py` (donde el mismo riesgo aplica al `source_code`).

#### BL-23 (medium, race) — el backoff de `LoginThrottle` era evadible en concurrencia
`sleep_if_needed()` leía `delay` y sólo tras despertar se llamaba
`record_failure()`: N logins fallidos concurrentes leían el mismo contador bajo
y dormían el mismo delay corto **en paralelo**. Nuevo
`LoginThrottle.register_failure()` serializa lee-espera-incrementa bajo un
`asyncio.Lock` (lee el delay, incrementa, y duerme sin soltar el lock); el
router usa este método único. Se preserva el perfil secuencial (el n-ésimo
fallo espera `step·(n-1)`).

### Contenido admin

#### BL-11 (high) — el fixture GPU era ineditable (422 de coherencia de hilos)
`_example_coherence_issues` exigía `fixed_threads ≥ 1` a todo ejemplo sin hilos
configurables ni barrido, incluido `sumaVectoresGPU` (`requires_gpu`,
`fixed_threads=null`): guardarlo desde la UI daba 422. Carve-out `and not
ex.requires_gpu` (los ejemplos GPU no usan hilos de CPU). El fixture NO se tocó;
`seed_content --check` sigue OK. Contrato: §10.6 documenta la excepción.

#### BL-17 (medium) — `TELAR_MAX_CODE_BYTES` se ignoraba en la vía JSON
`content_writer._check_code_size` usaba una constante `262144` hardcodeada
mientras la vía multipart y `/jobs` leían `settings.max_code_bytes`. Ahora
`_check_code_size(app, source_code)` lee `app.state.settings.max_code_bytes` en
runtime: un operador que baje el tope global lo ve aplicado por igual en JSON.

#### BL-18 (medium) — el id de pregunta autogenerado de §10.5 no existía
`AdminQuizQuestion.id` era obligatorio; una pregunta sin id daba `422 Field
required` pese a que el contrato promete `{lesson_id}-q{n}`. `id` pasa a
opcional (`str | None`, patrón sólo si se provee) y `content_writer` autogenera
`{lesson_id}-q{order}` antes de validar unicidad e insertar. Coherente con el
fix de BUG-01 en el frontend (que hoy suple el id con `_cid`).

#### BL-19 (medium, race) — los GET admin retenían el `write_lock` transversal
`GET /admin/{modules,lessons/{id},lessons/{id}/quiz,examples/{id}}` envolvían
sus lecturas N+1 en el `write_lock` transversal — el mismo con el que `finish()`
de jobs, `submit_attempt` y `progress.upsert` persisten —, acoplando la latencia
de subsistemas sin relación. Nuevo `app.state.content_read_lock` (asyncio.Lock
dedicado): los GET admin lo toman en vez del transversal, y `_persist` lo
adquiere durante su ventana sin commitear. Así se evitan los dirty reads
(CW-04 preservado) SIN que un dashboard admin serialice el `finish()` de un job.

#### BL-20 (medium) — sin reorden por lote (swap de `order` siempre daba 409)
`order` es `UNIQUE` global inmediato: intercambiar dos lecciones/módulos vía dos
PUT fallaba en el primero. Nuevos `PUT /admin/modules/reorder` y
`/admin/lessons/reorder` (`AdminReorderRequest{items:[{id,order}]}`): validan
existencia, sin ids repetidos y unicidad del conjunto FINAL de `order` (409
`ORDER_CONFLICT`), y aplican la reasignación con un *parking* temporal por
encima del máximo (respeta el `CHECK("order">0)` y el `UNIQUE` a mitad de
transacción). Documentado en api-contract §10.2/§10.3 y la tabla §9.

### Contrato / docs

- **BL-34** — `fase4-autoria-design.md` §5.3/§5.4/§5.6 dejan de documentar `403
  ADMIN_DISABLED` (contradecía contrato+código): 401 indistinguible. Nota que
  supersede C2/C3 y toda mención suelta de `ADMIN_DISABLED`.
- **BL-35** — filename inválido en `POST /admin/examples/{id}/code`: la vía JSON
  daba `422 VALIDATION_ERROR` y la multipart `415 INVALID_EXTENSION`. Unificado
  a **415** (pre-check con el mismo `FILENAME_RE` antes de pydantic).
- **BL-36** — `GET /jobs/{id}/output?stream=foo` devuelve `422` (ya lo hacía el
  código); **decisión: documentarlo** (validación estricta, coherente con el
  resto de la API) añadiéndolo a §7.6 y a la tabla §9. No se relaja a `combined`.
- **BL-27** — el catálogo huérfano `backend/app/content/fundamentos/` (4
  módulos / 23 lecciones, incargable e incompatible) se movió a
  `docs/analysis/fundamentos-catalogo-huerfano/` con un README. **Decisión (zona
  gris 8): NO integrarlo** (requeriría extender el modelo a lecciones sin
  ejemplo). `seed_content --check` sigue OK (sólo lee el `catalog.json` superior).

### Frontend

#### BL-24 (medium) — coherencia GPU⇒deshabilitado no implementada en el editor
`ExampleMetaFields.tsx` prometía "coherencia en UI: hilos + GPU" pero sólo
sincronizaba hilos. Ahora marcar **Requiere GPU** fuerza `enabled=false` y bloquea
el checkbox "Ejemplo habilitado" con un aviso inline — coherencia inmediata en la
UI, sin esperar al 422 del backend (regla §10.6).

### Zonas grises resueltas

- **Zona 2 (BL-18)**: implementar el autogen server-side `{lesson_id}-q{n}`.
- **Zona 5 (BL-20)**: sí, endpoint de reorden por lote transaccional.
- **Zona 8 (BL-27)**: material de fase futura → fuera de `app/content/`.
- **Zona 9 (rango `fixed_threads`)**: el DTO se queda en `1..16` y el **clamp
  runtime es la política** (coherente con el carve-out GPU de BL-11); no se acota
  el DTO a 8.

### Verificación

- Backend: **341 passed**, cobertura **91.9%** (`DOCKER_HOST=tcp://127.0.0.1:1`,
  fakes del Protocol). 22 regresiones nuevas en `test_audit_s4.py`.
- Frontend: **vitest 216/216**, `tsc --noEmit` limpio (src + tests; de paso se
  quitó el `within` sin usar pre-existente en `AdminLessonEditor.test.tsx`).
- `seed_content --check` OK tras mover `fundamentos/`.
- Contratos de datos congelados (`schemas.py` §10 sólo id de pregunta opcional +
  source_code sin cap estático + DTOs de reorder aditivos; `types.ts`/`messages.ts`
  sin tocar).

### Ronda de review de la Sesión 4 (security + database + code reviewer, en paralelo)

Sin hallazgos CRITICAL. **1 HIGH + 2 MEDIUM corregidos** antes del commit:

- **HIGH — BL-17 sólo cubría bajar el tope** — el `Field(max_length=262144)`
  estático de pydantic en `source_code` (JSON) rechazaba antes del check runtime:
  subir `TELAR_MAX_CODE_BYTES` por encima de 262144 no tenía efecto por JSON
  (sí por multipart), rompiendo la paridad que el propio fix prometía. Se quitó
  el cap estático de `AdminExampleCodeRequest`/`AdminLessonCreate.source_code`:
  el límite es 100% runtime (`content_writer._check_code_size`), idéntico en JSON
  y multipart. Regresión nueva `test_bl17_json_honra_max_code_bytes_alto`.
- **MEDIUM — `LoginThrottle.reset()` no tomaba el lock** — un login correcto
  concurrente con una ráfaga de fallos podía pisar el contador a mitad de la
  ventana espera-incremento (evasión marginal del backoff de BL-23). `reset()`
  pasa a `async` bajo el mismo `asyncio.Lock`; el router hace `await`. Regresión
  `test_bl23_reset_espera_al_fallo_en_vuelo`.
- **MEDIUM — id de pregunta autogenerado sin re-validar** — `{lesson_id}-q{order}`
  con un `lesson_id` de 64 chars + `order` enorme podía superar los 80 chars del
  patrón y persistir un id fuera de contrato (`model_copy` no re-valida). Se
  valida el id final (cliente o autogenerado) contra `QUESTION_ID_PATTERN` en
  `_quiz_issues` → `422 CONTENT_VALIDATION_ERROR`. Regresiones
  `test_bl18_id_cliente_colisiona_con_autogenerado_422` y
  `test_bl18_id_autogenerado_demasiado_largo_422`.

Verificados correctos por los revisores (sin cambios): parking en dos fases del
reorder y unicidad final (BL-20), orden de locks sin deadlock (BL-19), saneado no
evadible del 422 (BL-22), carve-out GPU acotado (BL-11), colisión de ids
cliente↔autogenerado ya detectada (BL-18), y el orden de rutas `/reorder` antes de
`/{id}`. Higiene: `record_failure()` marcado como solo-para-tests.

## Sesión 5 (2026-07-20) — Semántica de dominio OpenMP + verificación E2E de cierre · rama `fix/auditoria-s5-dominio-e2e`

Última sesión de la campaña: los dos restos de semántica de dominio en la UI
(frontend puro, TDD RED→GREEN con Vitest) y la verificación E2E de cierre de
TODO lo corregido en S1-S5.

### BL-30 (medium, central pedagógicamente) — Amdahl invertido sobre el ratio vs NumPy/BLAS

- **Causa:** `pairObservations()` (`frontend/src/lib/observations.ts`) invertía
  la Ley de Amdahl sobre `speedup_vs_reference` con CUALQUIER parser pair. La
  inversión (speedup observado → "% paralelizable") solo es válida cuando la
  referencia es una versión serial equivalente del MISMO algoritmo
  (`parser_id: pair_parallel_serial`); para `pair_openmp_numpy`/
  `pair_openmp_blas` la referencia es OTRA implementación, así que el
  "código con Y% paralelizable, Amdahl predice ~X×" era un dato fabricado
  mostrado al estudiante — error conceptual en el corazón educativo.
- **Fix:** branching por `parser_id`. Serial conserva la inversión de Amdahl
  (y su fallback "Comparación directa" cuando no es derivable, p. ej. 1 hilo);
  numpy/blas reciben una observación honesta: el ratio compara implementaciones
  distintas y no mide el escalado t(1)/t(n) del mismo código. El warn de
  speedup<1 también es coherente por parser: contra serial habla del overhead
  de crear/sincronizar el equipo de hilos (antes citaba "NumPy/BLAS" incluso ahí).
- **Tests:** describe nuevo `pair: semántica por parser_id (BL-30)` (6 casos,
  RED contra el código viejo) + fixture `TIMINGS_PAIR_BLAS`.
- **Spec:** supersede deliberadamente frontend-spec §6.4 ("siempre que haya
  speedup → info Amdahl") — esa regla ERA el error. Ver follow-ups de docs.

### BL-40 (low) — etiqueta "Procesos/hilos" (semántica MPI) en Resultados

- **Causa/Fix:** `DegradedSummary` (`ResultsCards.tsx`) rotulaba `pids_max`
  como "Procesos/hilos" — en OpenMP hay UN proceso con N hilos; "procesos"
  sugiere ranks MPI. Renombrado a **"Hilos (PIDs)"** + assert en el test del
  resumen degradado. Era el último resto real del grep anti-MPI de la auditoría.

### Ronda de review de la Sesión 5 (typescript + code reviewer, en paralelo)

Sin CRITICAL. **1 HIGH + 2 MEDIUM + 1 LOW corregidos antes del commit:**

- **HIGH — el texto "honesto" nuevo reintroducía un dato fabricado más sutil:**
  afirmaba que la referencia corre en "1 core" también para blas. `matrices`
  usa `A @ B` (BLAS dgemm) y el runner fija `OMP_NUM_THREADS` a nivel de TODO
  el proceso (`docker_service.py:65`), que OpenBLAS respeta como fallback de su
  nº de hilos → la referencia BLAS puede correr multi-hilo. El copy ahora se
  diferencia por parser: solo NumPy elementwise (mono-hilo real) afirma
  "1 core"; para blas se describe la biblioteca optimizada "que además puede
  usar varios hilos internamente", sin afirmar conteo. Tests endurecidos
  (el body de blas NO debe contener "1 core").
- **MEDIUM — fallback `p == null` de la rama serial sin cubrir** → test nuevo
  con 1 hilo que fija el texto "Comparación directa" sin Amdahl.
- **MEDIUM — JSDoc impreciso** — "t(1) del MISMO código" sugería re-ejecutar el
  kernel con 1 hilo; la referencia real (p. ej. `stencilCalor`) es una función
  serial equivalente aparte. Reformulado.
- **LOW — comentario redundante** (duplicaba el JSDoc) eliminado.
- Señalado sin acción (preexistente e inalcanzable): `s=0` daría "Infinity×" en
  el título del warn; tras BL-25 (S3) el parser devuelve `None` con tiempos ≤0,
  así que ese valor no puede llegar al frontend.

### Gates de la Sesión 5

- Backend (sin cambios en S5): **341 passed, cobertura 91.88%** (≥80).
- Frontend: `npm run typecheck` (src + tests) limpio; Vitest **221/221**;
  cobertura lib 97.9% / ws 94.3% / stores 97.4% / hooks 95.7% (todos ≥80).
- Imágenes Docker backend y frontend reconstruidas con todos los fixes S1-S5.
- Contratos congelados intactos (`types.ts`, `messages.ts`, `ehpc.d.ts`,
  `schemas.py`): S5 solo tocó `observations.ts`, `ResultsCards.tsx` y tests.

### Verificación E2E de CIERRE de la campaña (stack real + Playwright)

Stack web levantado con `TELAR_ADMIN_PASSWORD` de override e imágenes recién
construidas. Suite completa de `~/.ehpc-verify/e2e/`: **15/15 verdes a la
primera corrida (22.6s), sin retries y SIN modificar ningún assert**. Cero
anomalías: en consola solo los 401/404 esperados y allowlisted de ADM1/ADM4,
y cero errores en los logs del backend.

Probes dirigidos de los 3 critical (evidencia en
`~/.ehpc-verify/e2e/artifacts/closure-s5/`):

- **BL-01 (fix S2) — PASS.** Crear lección+quiz, aprobarla como estudiante
  (`completed:true`, `best_quiz_score:1`), DELETE admin y re-crear una lección
  distinta con EL MISMO id: aparece sin progreso heredado (`viewed:false`,
  `completed:false`, `best_quiz_score:null`, `attempts:[]`) y `/progress` ya no
  tiene la entrada — purga real en la transacción del DELETE, no puesta a cero.
- **BL-03 (fix S3) — PASS.** Código custom con la línea venenosa `hilos = 0`
  ejecutado SOBRE el parser real (`example_id=spmd` + editor ⇒ `parser_id`
  `sweep_pi` se conserva): `status=completed`, `exit_code=0`,
  `parsed_timings=null` — sin ZeroDivisionError ni reclasificación a
  `failed`/`sandbox_error`. (Verificado de paso: un POST con solo `code` fuerza
  `parser_id="none"` y no ejercita el parser — el probe ingenuo no vale.)
- **BL-09/10 (fix S3) — PASS, camino A.** Conexión WS NUEVA 1 ms después del
  `eof` (dentro de la retención de 10 s): el replay devuelve mensajes
  byte-idénticos al live — mismos `seq` y `ts` ORIGINALES — más `status`
  terminal y `eof`. Junto con el reset de `lastLogSeq` del front al reconectar,
  la terminal ya no queda vacía tras una reconexión.

### Cierre de la campaña — estado final de la matriz (40 hallazgos)

| Sesión | Hallazgos resueltos |
|---|---|
| S1 (desktop empaquetado) | BL-02, BL-12, BL-39 |
| S2 (progreso/quiz backend) | BL-01, BL-04, BL-05, BL-06, BL-21, BL-38 |
| S3 (jobs/parsers/WS) | BL-03, BL-07, BL-08, BL-09, BL-10, BL-13*, BL-14*, BL-15, BL-16, BL-25, BL-26, BL-32, BL-33, BL-37 |
| S4 (admin/auth/contrato) | BL-11, BL-17, BL-18, BL-19, BL-20, BL-22, BL-23, BL-24, BL-27, BL-34, BL-35, BL-36 |
| S5 (dominio/UI) | BL-30, BL-40 |

\* BL-13 y BL-14 se resolvieron como decisión de zona gris documentada en
contrato/arquitectura, no como cambio de código (ver §Sesión 3).

**Resueltos: 37/40** — incluidos los 3 critical y los 9 high.
**Diferidos: 3** (todos medium), con motivo:

- **BL-28 y BL-29 (footer de estado del desktop):** requieren trabajo de UI del
  shell Electron (`useDockerStatus`/`RuntimeFooter` + wiring de `openExternal`
  según electron-spec §8) y su verificación exige una pasada Electron dedicada
  (xvfb + `_electron`), fuera del alcance web de S1-S5. Candidatos a una sesión
  desktop propia.
- **BL-31 (el front no acota `fixed_threads` por núcleos):** fix pequeño en
  `ThreadsField.effectiveCpus()` (replicar el clamp del backend), pero fuera
  del alcance cerrado de S5. Candidato a una mini-sesión frontend.

**Follow-ups de documentación pendientes** (no bloqueantes): **RESUELTOS** en la
sesión de cierre de residuos (ver abajo). `architecture.md` §2.2 y `frontend-spec.md`
§6.4 quedaron alineados con el código.

---

## Cierre de residuos (2026-07-20) — rama `fix/auditoria-residuos`

Barrido final de los 5 cabos sueltos que la campaña S1-S5 dejó documentados como
follow-ups (1 medium de seguridad + 4 low). Doc-first donde toca contrato; TDD
(RED→GREEN) en los 3 cambios de código; ronda de review por dominio + code-reviewer.

### BL-22 (medium, security) — el 422 de `POST /jobs` reflejaba el input crudo del cliente
El catch manual de `ValidationError` en `create_job` (`routers/jobs.py`) devolvía
`exc.errors(include_url=False)` **sin sanear**, reflejando el valor rechazado
(`input`/`ctx`) del cliente en `error.details` — el mismo patrón que S4 corrigió en
`/admin/login` y en `admin.py`, pero en la ruta pública `/jobs` (residuo, NO el mismo
endpoint que la fila BL-22 del audit, que apunta a `/admin/login`). Ahora pasa por
`errors.sanitize_validation_errors()`. **Auditoría exhaustiva del backend** (confirmada
por el security-reviewer): son los ÚNICOS 3 puntos que arman respuesta desde
`.errors()` de pydantic — `errors.py:135` (handler global) y `admin.py:73` ya saneados
en S4, y este. Los demás no exponen input crudo: `content.py` es carga de fixtures
server-side (a logs), `quizzes.py` usa un error de dominio con `details` curados (la
opción ecoada es un `Literal["a".."d"]`, acotada), y `/jobs/upload` valida sus Form
params vía el handler global ya saneado.
- **Test:** `test_bl22_post_jobs_422_no_refleja_input_crudo` (el centinela crudo no
  aparece en `response.text`; se conservan `type`/`loc`/`msg`, se van `input`/`ctx`/`url`).

### BL-17 (low, consistency) — `POST /jobs` ignoraba `TELAR_MAX_CODE_BYTES` al SUBIR el tope
`JobCreateRequest.code` conservaba un `max_length=262144` estático de pydantic mientras
la vía admin JSON ya leía `settings.max_code_bytes` en runtime (fix S4). El check runtime
de bytes ya existía en `_create_job` (compartido con `/upload`), así que **bajar** el tope
ya funcionaba; **subir** `TELAR_MAX_CODE_BYTES` por encima de 262144 no tenía efecto por
JSON (pydantic rechazaba antes) — mismo bug que el HIGH que S4 encontró para el
`source_code` admin. **Fix:** se quita el cap estático de `code` (el tope es 100% runtime);
se elimina la rama `string_too_long` de `create_job` (ya inalcanzable) — el 413
`CODE_TOO_LARGE` lo sigue emitiendo `_create_job`. De paso, unifica char↔byte: pydantic
contaba caracteres, el runtime cuenta bytes UTF-8 (como `/upload` y el nombre del setting).
- **Doc-first:** `api-contract.md` §7.1 (tabla de validación de `code`) y la tabla de
  errores §1.1 pasan a documentar el tope runtime, coherentes con §10.6 (admin).
- **Tests:** `test_bl17_jobs_json_honra_max_code_bytes_alto` (RED: subir el tope permite
  código > 262144 por JSON) y `..._bajo` (bajar → 413).

### BL-09/BL-10 (low, robustez WS) — la reconexión AUTOMÁTICA no reseteaba el dedupe
`ws/jobSocket.ts`: la reconexión automática (`scheduleRetry`→`open`) no reseteaba
`lastLogSeq` ni vaciaba el store; solo lo hacían `connect()`/`retry()` (manuales). Era
seguro únicamente porque el backoff acumulado del cliente (~7 s) < `TERMINAL_HANDLE_RETENTION_S`
(10 s): dentro de la ventana el backend sirve el backlog retenido con `seq` reales
(`_replay_retained`); si expira, cae al replay-desde-DB con `seq` renumerado desde 1
(`_replay_terminal`) y el filtro `seq <= lastLogSeq` descartaría el replay entero.
**Opción A (elegida):** la reconexión automática también resetea el dedupe. Se refactorizó
`resetSession()` en `resetDedupe()` (buffer/`lastLogSeq`/`sawEof`/`lastPhase`) + `resetSession`
(dedupe + `retries`=0). El path automático llama `resetDedupe()`, PRESERVANDO `retries`
(presupuesto de backoff, se agota a los 3) y `sawActivePhase` (ámbito de la visita).
- **Refinamiento de la ronda de review (typescript + code reviewer, 1 HIGH + 1 LOW):**
  el `begin()` inicial hacía un reset TOTAL del store en cada reconexión, borrando
  `metrics` (que el backend NO replica → pérdida permanente del `LiveMetricsChart`),
  `startedAt` (el contador saltaba a ~0) y el latch `logsTruncated` (`OUTPUT_TRUNCATED`
  se señaliza una vez, no viaja en el backlog → se perdía el banner). Nuevo
  `jobStore.beginReconnect()`: reset PARCIAL que vacía solo `logs`/`wsError`/`sawEof` y
  preserva `metrics`/`startedAt`/`wallTimeMs`/`exitCode`/`errorDetail`/`logsTruncated`.
- **Tests:** describe `BL-09/10: la reconexión AUTOMÁTICA también resetea el dedupe`
  (replay renumerado re-puebla; `sawActivePhase` preservado; reset PARCIAL preserva
  metrics/startedAt/truncado).

### BL-34 (low, doc-only) — `fase4-autoria-design.md` documentaba `403 ADMIN_DISABLED`
4 ubicaciones autoritativas que aún lo presentaban como vigente → `401 UNAUTHORIZED`
indistinguible, coherente con `api-contract.md` §10.0 y el código (`admin_auth`/`admin_deps`):
cabecera de §6, flujo de login §9.F y los criterios de verificación §11 (1 y 5). El
disclaimer del lead en §5 ya superseded el resto (§0 C2/C3, §8, §10) como obsoletas.

### Docs congelados desincronizados (low, doc-only)
- `architecture.md` §2.2 (y la tabla de env vars §10.5): `TELAR_ALLOWED_ORIGINS` con las
  variantes `127.0.0.1` (el navegador manda ese Origin al abrir `127.0.0.1:8080` — BL-12)
  y el volumen `ehpc_submissions` con `name:` explícito (sin él Compose prefija el proyecto
  y el runner monta un volumen vacío — BL-02). Alineado con `compose.yaml` raíz y `config.py`.
- `frontend-spec.md` §6.4: se corrige la regla vieja "siempre que haya speedup → info
  Amdahl" (que BL-30 supersede). La inversión de Amdahl aplica solo con referencia serial
  del MISMO código (`sweep`, o `pair` con `parser_id: pair_parallel_serial`); con
  `pair_openmp_numpy`/`pair_openmp_blas` la referencia es otra implementación → comparación
  directa honesta. Editado SOLO el bloque §6.4 (el árbol estaba limpio; sin ruido del
  rediseño visual). Coherente con `lib/observations.ts` tras el fix S5.

### Verificación
- **Backend:** `pytest tests -q --cov=app --cov-fail-under=80` → **344 passed, 91.9%**
  (`DOCKER_HOST=tcp://127.0.0.1:1`, fakes del Protocol). Nuevas regresiones en
  `tests/test_audit_residuos.py` (BL-22 + BL-17, RED→GREEN verificado contra `main`).
- **Frontend:** `tsc --noEmit` (src + tests) limpio; **vitest 224/224**; cobertura
  `ws/jobSocket.ts` 94% (≥80).
- **Contratos congelados intactos** (`types.ts`, `messages.ts`, `ehpc.d.ts`): solo se
  tocó `schemas.py` (adaptación al contrato, BL-17) y `api-contract.md` (doc-first).
- **Ronda de review:** security-reviewer (BL-22, sin hallazgos), python-reviewer (BL-17,
  approve), typescript-reviewer (BL-09/10) y code-reviewer (rama) → 1 HIGH + 1 MEDIUM +
  1 LOW, todos corregidos (ver refinamiento de BL-09/10 y esta entrada del changelog).

**Los 3 DIFERIDOS siguen fuera de alcance** (sesión aparte): BL-28 y BL-29 (footer de
estado del shell Electron — requieren pasada Electron con xvfb) y BL-31 (clamp de
`fixed_threads` por núcleos en `ThreadsField.effectiveCpus` del frontend).
