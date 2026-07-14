# CHANGELOG — Fase 4 (Autoría de cursos · admin)

Resumen de lo entregado en la Fase 4 sobre la base de la Fase 3
(ver [`CHANGELOG-fase3.md`](CHANGELOG-fase3.md)). Objetivo: **un administrador
puede crear/editar módulos, lecciones, quizzes y subir ejemplos `.py` desde una
interfaz nueva**. El contenido de cursos pasa de fixtures estáticos a **SQLite**;
los flujos y las respuestas del estudiante quedan **byte-idénticos** (backward-compat
estricta). Los contratos se **extendieron** (nunca se rompieron): secciones nuevas
`api-contract.md` §10 y `data-model.md` §7, congeladas antes de implementar.

## Decisiones cerradas

- **Persistencia = SQLite.** 4 tablas nuevas (`modules`/`lessons`/`examples`/
  `quiz_questions`) en `schema.sql` **migration 2** (`schema_version → 2`). Un
  **seeder idempotente** (`python -m app.tools.seed_content`) migra los 14 ejemplos
  + 60 preguntas desde los fixtures **sin pérdida**; los fixtures quedan como semilla
  versionada. `ContentRepository` se refactoriza a `from_fixtures()` / `load(db)`
  manteniendo su interfaz de lectura → los GET de contenido no cambian.
- **Auth = admin único por `EHPC_ADMIN_PASSWORD`** (sin la var, modo deshabilitado:
  todo `/admin/*` → `401`, indistinguible, sin filtrar el estado). **Bearer + sesiones
  en memoria** (no cookie: la CORS congelada `allow_credentials=False` + Electron
  `file://` lo impiden). Comparación de contraseña en tiempo constante.
- **Sandbox intacto**: el `.py` del admin se ejecuta en el runner existente sin
  relajar nada; `prepare_code(source_code)` ya recibía un string.

## Modelo de ejecución (olas por paquete, propiedad exclusiva de archivos)

| Ola | Paquetes |
|---|---|
| **Contratos** (lead) | api-contract §10 · data-model §7 · `schema.sql` migration 2 · `schemas.py` §10 (DTOs) · `errors.py` (6 códigos) · `types.ts` + `admin-types.ts` |
| **1** | A backend contenido/seeder/ContentRepository ‖ G1 frontend infra/shell/login/dashboard |
| **2** | C backend auth (Bearer, sesiones, `require_admin`) ‖ G2 frontend editores |
| **3** | D backend endpoints admin (CRUD + subida de código) |
| **4** | E backend integración (lifespan: auto-seed + load + routers admin) |

## Paquetes entregados

| PKG | Entregable |
|---|---|
| A | `schema.sql` migration 2; `tools/seed_content.py` (idempotente, `--prune`/`--check`); `repositories/content.py` (`from_fixtures`/`load`); `services/content_state.py` (reload atómico); `conftest.py` (siembra + carga desde DB); tests de no-pérdida/idempotencia/goldens. |
| B/F | DTOs congelados `Admin*` (backend + `api/admin-types.ts`), 6 códigos de error nuevos (`UNAUTHORIZED`, `MODULE_NOT_FOUND`, `DUPLICATE_ID`, `ORDER_CONFLICT`, `MODULE_NOT_EMPTY`, `CONTENT_VALIDATION_ERROR`). |
| C | `config.py` (`EHPC_ADMIN_PASSWORD`); `services/admin_auth.py` (`AdminSessionStore`, `verify_password` en tiempo constante, `LoginThrottle`); `routers/admin_deps.py` (`require_admin`); `routers/admin_auth.py` (login/logout/session). |
| D | `routers/admin.py` (CRUD módulos/lecciones/quiz/ejemplos + `POST /code`); `services/content_writer.py` (validación §10.6 → persistencia bajo `write_lock` → reload); `services/markdown_validator.py`; `repositories/content_admin.py`. |
| E | `main.py`: auto-seed condicional + `ContentRepository.load(db)` + `app.state.admin_sessions`/`admin_throttle` + routers admin. |
| G1/G2 | Rama `/admin` (HashRouter, shell propio + login gate); `api/admin.ts` (Bearer); `stores/adminSessionStore.ts` (sessionStorage); editores de lección (markdown + preview), quiz, y uploader de ejemplo; `lib/pyfile.ts`. |

## Review adversarial multi-agente → fixes confirmados

5 dimensiones (seguridad/auth · migración/seed · backward-compat · contrato↔UI ·
concurrencia), cada hallazgo verificado adversarialmente. **8 hallazgos confirmados,
todos corregidos** con tests de regresión:

- **CW-01 (alto)** — `content_writer` ahora hace `rollback` ante CUALQUIER error de
  DB (antes solo `ContentError`): ninguna transacción parcial queda pendiente en la
  conexión compartida.
- **CW-02 (medio)** — id de pregunta global colisionando entre lecciones → `422
  CONTENT_VALIDATION_ERROR` limpio (antes `IntegrityError` 500).
- **CW-03 (medio)** — el swap de `app.state.content` ocurre **tras** un `commit`
  exitoso (la memoria nunca se adelanta a la DB).
- **CW-04 (bajo)** — los GET admin leen bajo `write_lock` (sin dirty reads de una
  mutación en curso).
- **C1 (medio)** — el editor de quiz muestra `error.details` del 422 (qué pregunta
  falla) en vez de un mensaje genérico.
- **C2 (bajo)** — la incoherencia del ejemplo al crear una lección lleva el campo
  `example.<campo>` (el editor ancla el hint bajo el control).
- **SEED-1 (bajo)** — `_read_utf8` lee bytes (sin traducción CRLF→LF): byte-identidad
  real de `source_code`/`content_markdown`.
- **SEED-2 (bajo)** — `from_fixtures` deriva `lesson_ids` por orden global (idéntico a
  `load(db)`): sin reordenamiento silencioso en el round-trip.

## Verificación

- **Backend**: 267 tests pytest verdes (205 de Fase 3 intactos + 62 nuevos), incluidos
  no-pérdida del seed, idempotencia, goldens de los GET públicos, CRUD admin, auth
  (login/logout/session/`require_admin`), regresiones CW/C/SEED y un **E2E**
  (login → crear módulo+lección+quiz+subir `.py` → aparece en el catálogo del
  estudiante con el quiz público SIN `correct_key` → corre en el simulador con el
  código del admin → sin sesión, `/admin/*` = 401).
- **`python -m app.tools.seed_content --check`**: fixtures ≡ DB.
- **Frontend**: 202 tests Vitest verdes (Fase 3 + admin), `tsc --noEmit` limpio.
- Pendiente (manual, como en Fase 3): verificación E2E con el stack real
  (`docker compose up`) y navegador/Playwright — no automatizable en WSL2 headless.
