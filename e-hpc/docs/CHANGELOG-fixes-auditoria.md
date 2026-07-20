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
en verde (289 tests, cobertura 91.0%, goldens de GET públicos intactos).

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
- Nuevos tests: `test_quiz_atomicity.py` (3), `test_admin_content.py` (+6),
  `test_job_runner.py` (+4), `test_app_lifespan.py` (+3), WP9-02 invertido.

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
