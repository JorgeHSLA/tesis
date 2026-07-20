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
  `EHPC_SUBMISSIONS_VOLUME` (`ehpc_submissions`) → el runner montaba un
  volumen vacío autocreado y **todos los jobs del simulador fallaban** con
  "no such file or directory" en Modo A (instalador con imágenes GHCR).
- **Fix:** `name: ehpc_submissions` en el volumen, igual que el compose raíz
  (con comentario explicando el porqué, espejo del raíz).

### BL-12 (high) — `EHPC_ALLOWED_ORIGINS` sin variantes `127.0.0.1`

- **Causa:** el compose empaquetado conservaba la lista vieja de orígenes
  (`localhost` + `null`); el navegador manda `Origin: http://127.0.0.1:8080`
  → CORS/WS bloqueados para quien abra la URL publicada en su navegador.
- **Fix:** lista igualada a la del compose raíz (variantes `localhost` y
  `127.0.0.1` para 5173 y 8080, más `null` para Electron `file://`).

### Test de paridad (nuevo) — `backend/tests/test_compose_parity.py`

6 tests que comparan los campos críticos entre `compose.yaml` raíz y
`desktop/resources/compose/compose.yaml`: `name:` explícito del volumen
`ehpc_submissions` en ambos, `EHPC_ALLOWED_ORIGINS` idéntica, y
`EHPC_SUBMISSIONS_VOLUME` idéntica entre composes **y** coincidente con el
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
  rango arranca siempre en el core 0, que con `EHPC_MAX_CONCURRENT_JOBS > 1`
  dos jobs comparten cores físicos, y que la reproducibilidad de las métricas
  aplica **ejecutando un job a la vez**. Test que fija el comportamiento como
  deliberado.

### Verificación

- Backend: 315 tests, cobertura 91.5 % (`DOCKER_HOST=tcp://127.0.0.1:1 pytest
  --cov=app --cov-fail-under=80`).
- Frontend: 210 tests Vitest, `tsc --noEmit` limpio.
