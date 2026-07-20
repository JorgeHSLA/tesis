# Fase 4 — Autoría de cursos (admin) · Diseño integrado

> Documento síntesis de los 4 slices (persistencia, auth, endpoints, UI), con conflictos
> resueltos. Es la fuente para **extender** los contratos congelados (`api-contract.md`,
> `data-model.md`, `schemas.py`, `types.ts`) y luego implementar en paralelo (§10).
> Extiende; no rompe. Todo GET público de contenido conserva su shape byte-idéntico.

---

## 0. Conflictos entre slices y resolución (1 línea c/u)

| # | Conflicto | Slices | Elegido | Por qué |
|---|-----------|--------|---------|---------|
| C1 | Rutas de auth | `POST /admin/login` \| `POST /admin/session` | **`POST /admin/login`, `POST /admin/logout`, `GET /admin/session`** | Verbos explícitos, 2/3 slices coinciden; login no es CRUD de recurso. |
| C2 | Códigos de error de auth | `UNAUTHORIZED` único \| `ADMIN_UNAUTHORIZED`+`ADMIN_INVALID_PASSWORD`+`ADMIN_DISABLED` | **`UNAUTHORIZED` (401) + `ADMIN_DISABLED` (403)** | Un solo código de fallo de credencial (login o bearer); `ADMIN_DISABLED` separado porque la UI necesita distinguir "falta la env var". |
| C3 | Modo deshabilitado en login | 401 indistinguible \| 403 `ADMIN_DISABLED` | **403 `ADMIN_DISABLED`** | Herramienta local mono-usuario en loopback: el valor UX de avisar "define EHPC_ADMIN_PASSWORD" supera el riesgo nulo de enumeración. |
| C4 | TTL de sesión | fijo 8h \| deslizante | **fijo 8h, sin sliding** | Más simple; el admin re-loguea; `GET /session` no renueva. |
| C5 | Store de sesión | clase `AdminSessionStore` \| `dict[str,float]` | **clase `AdminSessionStore`** | Tipada, testeable, encapsula purga/tope; internamente usa dict. |
| C6 | Shape de `GET /session` | `{valid,expires_at}` \| `{authenticated,expires_at}` | **`{authenticated, expires_at}`** | 2/3 slices; nombre consistente con la UI. |
| C7 | Alta/baja de ejemplos | `POST/DELETE /admin/examples` \| solo edición (nacen con la lección) | **Sin POST/DELETE de ejemplos; nacen/mueren con la lección** | Invariante `example_id == lesson_id` es total hoy (content.py:312,479); romperlo cambia GETs congelados. |
| C8 | Método de update módulo/lección | PATCH parcial \| PUT total | **PUT (reemplazo total de campos editables)** | El editor ya tiene el objeto completo; validación server-side más simple y uniforme. |
| C9 | Campo de respuesta correcta del quiz | `correct` \| `correct_key` | **`correct_key`** | Coincide con DB y con el DTO público `QuizAttemptAnswer.correct_key` (schemas.py:270). |
| C10 | Ubicación de DTOs admin en frontend | `types.ts §9` \| `api/admin-types.ts` | **`api/admin-types.ts` (DTOs) + `types.ts` (solo unión `ApiErrorCode`)** | Mantiene `types.ts` como transcripción congelada mínima; mejor propiedad de archivos para paralelizar y aislar el chunk admin. |
| C11 | Loader DB / reload | `ContentRepository.load(db)` + `reload_content(app)` \| `build_content_from_db(db)` + `content_writer.mutate` | **`ContentRepository.load(db)` + `reload_content(app)`; `content_writer` los invoca** | Un solo nombre canónico; el writer orquesta, no reimplementa el loader. |
| C12 | Subida de código | `POST /code` \| `PUT /code` | **`POST /admin/examples/{id}/code`** | Reutiliza literalmente el lector por chunks + validadores de `jobs.py:256-297` (multipart o JSON). |

---

## 1. Resumen y principios

1. **Backward-compat estricta de los GET.** La interfaz de lectura de `ContentRepository`
   (content.py:496-524: `modules/lessons/lesson/examples/example/quiz/exists_lesson/exists_example`)
   queda **byte-idéntica** en firma y semántica (síncrona, en memoria). Solo cambia de dónde se
   construye el snapshot. Los routers públicos y los DTOs de lectura no se tocan.
2. **Fixtures = fuente de seed versionada; DB = fuente runtime.** Tras el primer arranque, SQLite es
   autoritativa. `content/` se conserva como semilla canónica; un **seeder idempotente** migra los
   14 ejemplos + 60 preguntas habilitadas byte-idénticos.
3. **Persistencia = SQLite.** 4 tablas nuevas en `-- migration 2` (`schema_version` → 2 vía el
   mecanismo existente de `db.py`).
4. **Auth = admin único por `EHPC_ADMIN_PASSWORD`.** Sin la var, modo admin **deshabilitado**
   (todo `/admin/*` responde `403 ADMIN_DISABLED`). El estudiante nunca hace login; todos sus flujos
   quedan intactos.
5. **Bearer token + sesiones server-side en memoria** (`app.state.admin_sessions`, patrón de
   `app.state.jobs`). Se descarta cookie httpOnly por la CORS congelada (`allow_credentials=False`,
   main.py:130) y `file://`→`Origin: null` de Electron (§5.7).
6. **Sandbox del runner intacto.** El `.py` subido por el admin es **no confiable**, igual que el del
   estudiante; se ejecuta en el runner existente sin relajar nada. `prepare_code(source_code: str)`
   ya recibe string → servirlo desde DB es transparente.
7. **Snapshot inmutable + swap atómico** en cada escritura admin: validar → persistir bajo
   `write_lock` → `reload_content(app)` construye un `ContentRepository` nuevo y reemplaza la
   referencia `app.state.content`. Ningún GET concurrente ve estado a medias.

---

## 2. Modelo de datos

### 2.1 Decisiones de forma

- **Listas cortas, ordenadas y opacas → JSON TEXT** con `CHECK(json_valid(...))`: `directives`,
  `takeaways` (examples), `recommended` (lessons), `options` (quiz_questions). Nunca se filtran ni se
  hace JOIN por ellas; una tabla hija añadiría 3-4 tablas + columnas de orden para cero beneficio. El
  orden se preserva por ser array JSON.
- **Relaciones consultadas → FK normalizada**: `lessons.module_id`, `quiz_questions.lesson_id`,
  `examples.id → lessons.id` (PK compartida = invariante 1:1:1).
- **`module.lessons` NO se almacena redundante**: se deriva de
  `SELECT id FROM lessons WHERE module_id=? ORDER BY "order"`. `lessons.module_id` es la única fuente
  de pertenencia; el orden intra-módulo se deriva del orden global (verificado idéntico en fixtures).
- **Campos derivados NO se almacenan** (los calcula `load()`, igual que hoy): `Lesson.example_id`
  (==id), `has_quiz`, `quiz_question_count`, `enabled` (desde `examples.enabled`),
  `prev_lesson_id`/`next_lesson_id`; `Example.module_id`/`order`/`lesson_id` (del join con `lessons`).
- **`pass_threshold` (nivel-quiz) vive en `lessons`** (1 quiz por lección) → 4 tablas exactas, sin
  tabla `quizzes`.
- **Booleanos → INTEGER 0/1** (convención de `jobs`); `"order"` entre comillas dobles (keyword).
- Los conteos mágicos 14/60 **no** se codifican en DDL (contenido mutable); pasan a validación
  runtime al escribir (§6.2).

### 2.2 DDL literal — append a `backend/app/schema.sql`

El bloque va **al final** del archivo (tras la línea 87). No inserta `schema_version` (lo hace
`apply_schema`, db.py:133-139). El marcador `-- migration 2` cumple el regex
`_MIGRATION_MARK = ^--\s*migration\s+(\d+)\s*$` (db.py:85). `foreign_keys=ON` ya lo fija `open_db`
(db.py:95); el orden de inserción del seeder es `modules → lessons → examples → quiz_questions`.

```sql
-- migration 2
-- Fase 4: el contenido de cursos migra de fixtures estáticos a SQLite.
-- Semilla: app.tools.seed_content (o auto-seed en el lifespan si 'lessons' está vacía).
-- Listas cortas/opacas (directives, takeaways, recommended, options) -> JSON TEXT con
-- CHECK json_valid; relaciones consultadas -> FK. Conteos 14/60 -> validacion runtime, no DDL.
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
    id           TEXT PRIMARY KEY,               -- p.ej. 'spmd-q1' (globalmente unico)
    lesson_id    TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    "order"      INTEGER NOT NULL CHECK ("order" > 0),
    text         TEXT NOT NULL CHECK (length(text) > 0),
    options_json TEXT NOT NULL CHECK (json_valid(options_json)),  -- [{"key":"a","text":...}], 2-4
    correct_key  TEXT NOT NULL CHECK (correct_key IN ('a','b','c','d')),
    explanation  TEXT NOT NULL,
    UNIQUE (lesson_id, "order")
);
CREATE INDEX IF NOT EXISTS idx_quiz_lesson ON quiz_questions (lesson_id, "order");
```

Actualizar `data-model.md` §1 (tabla contenido-vs-estado): el contenido pasa de "fixtures estáticos"
a "SQLite sembrada desde fixtures"; añadir §ADMIN documentando las 4 tablas y `schema_version=2`.

---

## 3. Seeder idempotente — `backend/app/tools/seed_content.py` (nuevo)

### 3.1 Firma / CLI

```python
async def seed_content_into(
    db: aiosqlite.Connection,
    *,
    content_dir: Path = CONTENT_DIR,
    prune_extra: bool = False,   # DELETE de filas cuyo id no está en fixtures
) -> "SeedReport":
    """Siembra/actualiza el contenido en DB desde los fixtures validados.
    Idempotente (UPSERT keyed por id). Fuente = ContentRepository.from_fixtures(content_dir):
    el MISMO objeto validado de Fase 3 -> byte-idéntico, cero pérdida."""

def main() -> int:   # python -m app.tools.seed_content [--db P] [--content D] [--prune] [--check]
    ...
```

`SeedReport` = dataclass frozen `{modules, lessons, examples, questions}` (insertados+actualizados)
para logs/verificación. `--check` hace diff DB↔fixtures y sale ≠0 (útil en CI).

### 3.2 Algoritmo (no-pérdida garantizada)

1. `repo = ContentRepository.from_fixtures(content_dir)` — reutiliza el parseo + validación fail-fast
   existente **incluidas** las invariantes 14/60 (aquí SÍ aplican: el baseline canónico son los 14).
   Si algo está roto → `ContentError`, aborta sin tocar DB.
2. `await apply_schema(db)` (crea tablas de migración 2 si faltan).
3. **Todo dentro de `async with write_lock:` y una sola transacción**, commit único al final:
   - `modules`: por cada `repo.modules()` → UPSERT.
   - `lessons`: `content_markdown`, `pass_threshold=repo.quiz(id).pass_threshold`,
     `recommended_json=json.dumps([asdict(r) for r in lesson.recommended], ensure_ascii=False)`.
   - `examples`: `source_code`, `directives_json`/`takeaways_json` = `json.dumps(list(...), ensure_ascii=False)`.
   - `quiz_questions`: `options_json=json.dumps([{"key":o.key,"text":o.text} for o in q.options], ensure_ascii=False)`.
   - si `prune_extra`: `DELETE FROM <t> WHERE id NOT IN (…ids de fixtures…)` (CASCADE limpia hijos).
4. `await db.commit()`.

Patrón UPSERT por tabla: `INSERT … VALUES(…) ON CONFLICT(id) DO UPDATE SET col=excluded.col, …`
(clave = PK `id` → segunda corrida = UPDATE con los mismos bytes; cero filas nuevas, cero pérdida).

### 3.3 Auto-seed vs CLI (ambos, roles distintos)

- **CLI** `python -m app.tools.seed_content`: reset explícito al baseline versionado (`--prune` quita
  contenido añadido por el admin).
- **Auto-seed en el lifespan** (main.py, tras `apply_schema`): condición = **tabla `lessons` vacía**
  (no pisa ediciones admin en DB no-vacía; instalaciones nuevas arrancan solas):
  ```python
  cur = await db_conn.execute("SELECT COUNT(*) FROM lessons")
  if (await cur.fetchone())[0] == 0:
      await seed_content_into(db_conn)
  app.state.content = await ContentRepository.load(db_conn)   # sustituye _load_content() (main.py:55,120)
  ```

**Garantía de no-pérdida** (test `test_seed_no_data_loss`): igualdad de snapshot campo-a-campo contra
`ContentRepository.from_fixtures(CONTENT_DIR)` (records `frozen` → `==` compara todo, incl.
`source_code`, `content_markdown`, `takeaways`, `recommended`, `options`, `prev/next`); conteos
(8 módulos, 14 lecciones/ejemplos, 60 preguntas habilitadas); bytes de archivo idénticos;
idempotencia (2ª corrida sin cambios); golden HTTP de los GET públicos.

---

## 4. Refactor `ContentRepository` (interfaz de lectura CONGELADA)

Los 8 métodos de lectura (content.py:496-524) quedan byte-idénticos. Solo cambia la **fuente** del
snapshot. Constructor privado + dos fábricas:

```python
class ContentRepository:
    def __init__(self, *, modules, lessons, examples, quizzes):
        self._modules  = modules      # tuple[Module, ...] ordenada por order
        self._lessons  = lessons      # dict[str, Lesson]
        self._examples = examples     # dict[str, Example]
        self._quizzes  = quizzes      # dict[str, Quiz]

    @classmethod
    def from_fixtures(cls, content_dir: Path) -> "ContentRepository":
        """Carga+valida fixtures (fail-fast, invariantes 14/60). La usa el SEEDER y
        unit-tests de baseline. Cuerpo = el __init__/_build_* actual movido aquí."""

    @classmethod
    async def load(cls, db: aiosqlite.Connection) -> "ContentRepository":
        """Reconstruye el MISMO snapshot inmutable desde DB (producción Fase 4)."""
```

**`load(db)` — construcción** (mismos records, distinta fuente):
- `SELECT * FROM modules ORDER BY "order"`; `lesson_ids` derivados con
  `SELECT id FROM lessons WHERE module_id=? ORDER BY "order"`.
- `SELECT * FROM lessons ORDER BY "order"`; `recommended=json.loads(recommended_json)`; `enabled` de
  `examples.enabled`; `has_quiz`/`quiz_question_count` de conteo; `prev/next` por posición
  (idéntico a content.py:487-490).
- `SELECT e.*, l.module_id, l."order" FROM examples e JOIN lessons l ON l.id=e.id`;
  `directives`/`takeaways = json.loads(...)`.
- `SELECT * FROM quiz_questions WHERE lesson_id=? ORDER BY "order"` por lección; `pass_threshold` de
  `lessons` → `Quiz(...)`.

**Validación en `load`** = solo integridad estructural (los conteos 14/60 dejan de exigirse):
`lessons.module_id` y `module` referenciado existen; `correct_key ∈ keys(options)`; `parser_id` en el
enum; `content_markdown` no vacío; `order` global sin duplicados; targets de `recommended` existen.
Fallo → `ContentError` (aborta arranque). Los conteos migran a validación al escribir (§6.2).

**Reload atómico** — `services/content_state.py` (nuevo, propiedad PKG-A):
```python
async def reload_content(app: FastAPI) -> None:
    new = await ContentRepository.load(app.state.db)   # construye COMPLETO primero
    app.state.content = new                             # swap atómico
```
Correcto en single event loop porque: (1) snapshot inmutable (`frozen`+tuplas); (2) los 8 lectores
son síncronos y no ceden el loop; (3) los handlers ligan `content = request.app.state.content` una
vez al inicio del request (patrón `get_content`). **Invariante a documentar**: no re-leer
`app.state.content` entre `await`s dentro de un handler.

**Wiring de tests — `backend/tests/conftest.py`** (propiedad PKG-A):
- `build_app` lifespan (conftest.py:153-184): reemplazar `content=` por
  `await seed_content_into(conn, content_dir=CONTENT_DIR)` + `app.state.content = await ContentRepository.load(conn)`.
  Eliminar el parámetro `content` de `build_app` y del fixture `app` (conftest.py:142-149,210-212).
- Helper + fixture que reemplaza `real_content` (conftest.py:95-98):
  ```python
  async def make_content_repo(content_dir=CONTENT_DIR):
      db = await open_db(":memory:"); await apply_schema(db)
      await seed_content_into(db, content_dir=content_dir)
      return db, await ContentRepository.load(db)

  @pytest_asyncio.fixture
  async def content_repo():
      db, repo = await make_content_repo(); yield repo; await db.close()
  ```
  Tests que pedían `real_content` pasan a `content_repo` (mismo tipo, misma interfaz, asserts sin
  cambios). `_fresh_write_lock` (conftest.py:61-67) ya cubre el lock del seeder.

---

## 5. Auth

> **Corrección del lead — `ADMIN_DISABLED` NO existe (supersede a C2/C3 y a toda
> mención de `403 ADMIN_DISABLED` en este documento).** El contrato congelado
> (`api-contract.md` §10.0) y la implementación (`admin_auth.py`,
> `admin_deps.py`) resuelven el modo admin deshabilitado, la credencial errónea y
> el Bearer inválido/expirado **todos** como `401 UNAUTHORIZED` **indistinguible**:
> no se filtra el estado del servidor (se descarta la enumeración de T5 por
> mínima que sea). La UI trata cualquier 401 del login como "credencial o modo no
> disponibles". Los fragmentos de §5.3/§5.4/§5.6 abajo ya reflejan esta decisión;
> las filas C2/C3 de §0 y las menciones sueltas de `403`/`ADMIN_DISABLED` en el
> resto del doc quedan **obsoletas** (BL-34).

### 5.1 Config — `backend/app/config.py`

```python
admin_password: str = ""   # EHPC_ADMIN_PASSWORD; "" ⇒ modo admin DESHABILITADO

@property
def admin_enabled(self) -> bool:
    return bool(self.admin_password.strip())
```
No hay default de contraseña. `EHPC_ADMIN_PASSWORD` es un secreto: nunca se logea (ni su longitud).
Inyectada por entorno (compose `environment:` / `.env` no versionado).

### 5.2 Store de sesión — `backend/app/services/admin_auth.py` (nuevo)

```python
TOKEN_TTL_S = 8 * 60 * 60          # 8h fijo (sin sliding, C4)
MAX_ACTIVE_SESSIONS = 16

@dataclass(frozen=True)
class AdminSession:
    token: str
    expires_at: float              # epoch UTC segundos

class AdminSessionStore:
    """Sesiones admin en memoria (proceso único uvicorn). Operaciones síncronas y
    atómicas respecto al event loop (patrón app.state.jobs). No toca DB ni write_lock."""
    def __init__(self, ttl_s: int = TOKEN_TTL_S) -> None:
        self._sessions: dict[str, float] = {}   # token -> expires_at
        self._ttl_s = ttl_s
    def create(self, *, now=None) -> AdminSession: ...   # purga + tope + token_urlsafe(32)
    def validate(self, token: str, *, now=None) -> bool: ...  # limpieza perezosa de expirados
    def revoke(self, token: str) -> None: ...            # idempotente (pop)
    def peek_expiry(self, token: str) -> float | None: ...   # para GET /session
```
- Token opaco `secrets.token_urlsafe(32)` (256 bits), revocable vía store (no JWT).
- Limpieza perezosa en `create`/`validate`; tope `MAX_ACTIVE_SESSIONS` descarta la sesión más próxima
  a expirar. No persiste: un reinicio invalida todas las sesiones (aceptado).

Verificación en **tiempo constante**:
```python
def verify_password(candidate: str, configured: str) -> bool:
    expected = (configured or "").strip()
    if not expected:                                   # deshabilitado: dummy compare, mismo perfil
        secrets.compare_digest(candidate.encode(), b"\x00" * 32)
        return False
    return secrets.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))
```

`LoginThrottle` (backoff incremental global, proceso único): `delay = min(0.5 * fallos_consecutivos, 5.0)`;
`await asyncio.sleep(delay)` antes de responder un fallo; `record_failure()`/`reset()`. Aloja en
`app.state.admin_throttle`.

### 5.3 Endpoints de auth — router `admin_auth.py`, `prefix="/api/v1/admin"`

| Método | Path | Request | Response `data` | OK | Errores |
|---|---|---|---|---|---|
| POST | `/admin/login` | `AdminLoginRequest{password}` | `AdminLoginResult{token, expires_at}` | 200 | 401 `UNAUTHORIZED`, 422 `VALIDATION_ERROR` |
| POST | `/admin/logout` | — (Bearer) | `{revoked: true}` | 200 | 401 `UNAUTHORIZED` |
| GET | `/admin/session` | — (Bearer) | `AdminSessionInfo{authenticated, expires_at}` | 200 | 401 `UNAUTHORIZED` |

`login`: SIEMPRE ejecuta `verify_password` (dummy compare en tiempo constante si
`not settings.admin_enabled`) y responde `401 UNAUTHORIZED` indistinguible tanto si el modo está
deshabilitado como si la contraseña es incorrecta (no revela el estado — BL-34, supersede C3). El
fallo pasa por `throttle.register_failure()` (serializa lee-espera-incrementa, BL-23) con mensaje
genérico; el éxito hace `store.create()` + `reset()`. `expires_at` en ISO-8601 UTC `Z`.
`GET /session` no renueva TTL (C4).

### 5.4 `require_admin` — `backend/app/routers/admin_deps.py` (nuevo)

```python
def get_admin_sessions(request) -> AdminSessionStore:   # lee app.state.admin_sessions
    ...
def _extract_bearer(request) -> str | None:             # 'Authorization: Bearer <token>' estricto
    ...
async def require_admin(request) -> str:
    # BL-34: deshabilitado, token ausente/ inválido/expirado ⇒ el MISMO 401
    # indistinguible (no se filtra el estado del servidor). No existe ADMIN_DISABLED.
    if not request.app.state.settings.admin_enabled:
        raise ApiException("UNAUTHORIZED", "Sesión inválida o expirada.")
    token = _extract_bearer(request)
    if token is None or not get_admin_sessions(request).validate(token):
        raise ApiException("UNAUTHORIZED", "Sesión inválida o expirada.")
    return token
```
`require_admin` es la **única** puerta: todo endpoint admin de contenido declara
`Depends(require_admin)` (login/logout/session-GET son del propio router de auth: login sin dep,
logout/session validan el bearer explícitamente). Omitir `WWW-Authenticate` (no disparar el diálogo
nativo del navegador).

### 5.5 Wiring en lifespan (main.py, junto a `app.state.jobs`, línea 90)

```python
from app.services.admin_auth import AdminSessionStore, LoginThrottle
app.state.admin_sessions = AdminSessionStore()
app.state.admin_throttle = LoginThrottle()
```
No se toca CORS, `allow_credentials`, ni la lista de orígenes.

### 5.6 Threat model (herramienta local mono-usuario, loopback)

| # | Amenaza | Mitigación | Residual |
|---|---------|-----------|----------|
| T1 | Fuerza bruta password | `compare_digest` + `LoginThrottle` + loopback | Bajo |
| T2 | Timing sobre password | Tiempo constante siempre (dummy compare si deshabilitado) | Insignificante |
| T3 | Robo del bearer por XSS | CSP `script-src 'self'`, TTL 8h, logout revoca, `sessionStorage` | Documentado/aceptado |
| T4 | CSRF a mutaciones admin | Bearer en header custom (no ambient) + `allow_credentials=False` | Nulo para mutaciones |
| T5 | Enumerar si admin activo | `401` indistinguible en login y `/admin/*` (no existe `ADMIN_DISABLED`; BL-34) | Nulo (no se filtra el estado) |
| T6 | Escalado vía `.py` subido | Sandbox NO relajado (§0.6, §6.3) | Igual al del estudiante |
| T7 | Sesiones colgadas | TTL + purga perezosa + tope 16 | Nulo |

### 5.7 Por qué Bearer y no cookie httpOnly (decisión documentada)

- CORS congelada `allow_credentials=False` (main.py:130) → el navegador no envía/acepta cookies en
  peticiones CORS y el server no puede responder `Access-Control-Allow-Credentials: true`.
- Electron carga `file://` ⇒ `Origin: null`: `Set-Cookie` desde `http://localhost:8000` no se adjunta
  a peticiones lanzadas desde un documento `file://`. Las cookies **no llegan** al backend.
- Pasar a `allow_credentials=True` obligaría a enumerar orígenes (no `*`) y excluir `"null"`,
  rompiendo el desktop y reintroduciendo CSRF. Se descarta.
- Bearer en `Authorization` viaja idéntico en web y `file://`; `allow_headers=["*"]` (main.py:132) ya
  lo permite en el preflight. No hay ambient credential → sin vector CSRF clásico → sin token CSRF.
- Coste: token en cliente (`sessionStorage`, §9.E). Riesgo XSS aceptado (CSP dura + TTL + logout +
  mono-usuario loopback). httpOnly protegería de exfiltración por XSS pero es inviable por
  CORS+`file://`: el trade-off es forzado por el contrato congelado.

---

## 6. Endpoints admin de contenido

Router `admin.py`, `prefix="/api/v1/admin"`, todos `Depends(require_admin)`. Envelope
`{success,data,error,meta}` (helpers `envelope_ok`/`envelope_error`). Errores 401 `UNAUTHORIZED` /
403 `ADMIN_DISABLED` aplican a todos.

### 6.1 Tabla completa

**Módulos**
| Método | Path | Request | Response | OK | Errores |
|---|---|---|---|---|---|
| GET | `/admin/modules` | — | `AdminModulesResponse` | 200 | — |
| POST | `/admin/modules` | `AdminModuleCreate` | `AdminModule` | 201 | 409 `DUPLICATE_ID`, 409 `ORDER_CONFLICT`, 422 `CONTENT_VALIDATION_ERROR` |
| PUT | `/admin/modules/{id}` | `AdminModuleUpdate` | `AdminModule` | 200 | 404 `MODULE_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 `CONTENT_VALIDATION_ERROR` |
| DELETE | `/admin/modules/{id}` | — | `{deleted}` | 200 | 404 `MODULE_NOT_FOUND`, 409 `MODULE_NOT_EMPTY` |

**Lecciones** (unidad = lección + ejemplo pareado con mismo id + quiz; §6.4)
| Método | Path | Request | Response | OK | Errores |
|---|---|---|---|---|---|
| GET | `/admin/lessons/{id}` | — | `AdminLessonDetail` | 200 | 404 `LESSON_NOT_FOUND` |
| POST | `/admin/lessons` | `AdminLessonCreate` | `AdminLessonDetail` | 201 | 409 `DUPLICATE_ID`, 404 `MODULE_NOT_FOUND`, 409 `ORDER_CONFLICT`, 413 `CODE_TOO_LARGE`, 422 `CONTENT_VALIDATION_ERROR` |
| PUT | `/admin/lessons/{id}` | `AdminLessonUpdate` | `AdminLessonDetail` | 200 | 404 `LESSON_NOT_FOUND`, 404 `MODULE_NOT_FOUND`, 409 `ORDER_CONFLICT`, 422 `CONTENT_VALIDATION_ERROR` |
| DELETE | `/admin/lessons/{id}` | — | `{deleted}` | 200 | 404 `LESSON_NOT_FOUND` |

**Quiz** (por lección; el GET admin SÍ trae `correct_key`/`explanation`)
| Método | Path | Request | Response | OK | Errores |
|---|---|---|---|---|---|
| GET | `/admin/lessons/{id}/quiz` | — | `AdminQuiz` | 200 | 404 `LESSON_NOT_FOUND`, 404 `QUIZ_NOT_FOUND` |
| PUT | `/admin/lessons/{id}/quiz` | `AdminQuizUpsert` | `AdminQuiz` | 200 | 404 `LESSON_NOT_FOUND`, 422 `CONTENT_VALIDATION_ERROR` |
| DELETE | `/admin/lessons/{id}/quiz` | — | `{deleted}` | 200 | 404 `LESSON_NOT_FOUND`, 404 `QUIZ_NOT_FOUND` |

**Ejemplos** (solo edición; alta/baja van con la lección, §6.4)
| Método | Path | Request | Response | OK | Errores |
|---|---|---|---|---|---|
| GET | `/admin/examples/{id}` | — | `AdminExample` | 200 | 404 `EXAMPLE_NOT_FOUND` |
| PUT | `/admin/examples/{id}` | `AdminExampleUpdate` | `AdminExample` | 200 | 404 `EXAMPLE_NOT_FOUND`, 422 `CONTENT_VALIDATION_ERROR` |
| POST | `/admin/examples/{id}/code` | `multipart` (`file`) **o** `AdminExampleCodeRequest` (JSON) | `AdminExampleCodeResult` | 200 | 404 `EXAMPLE_NOT_FOUND`, 413 `CODE_TOO_LARGE`, 415 `INVALID_EXTENSION`, 422 `INVALID_ENCODING`, 422 `VALIDATION_ERROR` |
| POST | `/admin/examples/{id}/test-run` *(OPCIONAL)* | — | `JobCreated` (reusa §7.1 del contrato) | 202 | 404 `EXAMPLE_NOT_FOUND`, 409 `EXAMPLE_DISABLED`, 429 `TOO_MANY_JOBS`, 503 `DOCKER_UNAVAILABLE`/`RUNNER_IMAGE_MISSING` |

`POST /admin/examples/{id}/code` reutiliza el lector por chunks + validadores de `jobs.py:256-297`
(patrón `FILENAME_PATTERN` schemas.py:369, corte a `max_code_bytes`, decode UTF-8); guarda
`source_code`+`filename` en la fila del ejemplo. `test-run` invoca el pipeline de jobs existente
(sandbox intacto) y devuelve `JobCreated` con `ws_url`.

### 6.2 Reglas de validación al escribir (runtime; reemplaza el fail-fast de conteo)

Se **elimina** el fail-fast de conteos mágicos (content.py:20-22,318-322,415-425) del arranque; se
sustituye por validación por-escritura + re-check estructural en el reload. Orden fail-fast:

- **Referencial**: `lesson.module_id` existe → `404 MODULE_NOT_FOUND`; `recommended[].lesson_id`
  existe y ≠ la propia → `422 CONTENT_VALIDATION_ERROR`; `DELETE module` con ≥1 lección →
  `409 MODULE_NOT_EMPTY`.
- **Unicidad**: `id` nuevo colisiona (namespace compartido lección/ejemplo, o módulo) →
  `409 DUPLICATE_ID`; ids de pregunta duplicados o keys de opción duplicadas → `422 CONTENT_VALIDATION_ERROR`.
- **Orden** (global-único de lecciones y de módulos; prev/next depende de él, content.py:463-491):
  colisión → `409 ORDER_CONFLICT`.
- **Contenido**: `correct_key ∈ keys(options)` → `422`; `parser_id` en los 6 (Literal); `filename` con
  `FILENAME_PATTERN`; `source_code` `1 ≤ bytes ≤ 262144` → `413 CODE_TOO_LARGE`; **markdown en el
  subset** (`markdown_validator.validate(md)` — puerto de `frontend/src/lib/markdown.ts`: solo h1-h4,
  sin HTML crudo, hrefs `http(s)`/`#`/relativos, fences cerrados) → `422 CONTENT_VALIDATION_ERROR`
  con `details=[{line, reason}]`; **coherencia threads** (espeja jobs.py:131-153):
  `threads_configurable=true ⇒ fixed_threads=null`; `threads_configurable=false ∧ sweeps_threads=false ⇒ fixed_threads≥1`;
  **GPU**: `requires_gpu=true ⇒ enabled=false`.
- Rango por DTO (`difficulty 1..5`, `default_timeout_s 5..120`, `pass_threshold ∈ (0,1]`, `takeaways`
  no vacío) → `422 VALIDATION_ERROR`.

`details` de `CONTENT_VALIDATION_ERROR`: `[{"field":..., "reason":...}]` (encaja en `ApiError.details`).

### 6.3 Efecto reload (persist + swap atómico) — `services/content_writer.py` (nuevo)

Toda mutación pasa por `content_writer`:
1. **Validación de negocio** (§6.2) — corta 4xx antes de tocar DB.
2. `async with app.state.write_lock:` → INSERT/UPDATE/DELETE + `commit()` dentro del lock →
   `await reload_content(app)` (§4). Si el reload falla (grafo inconsistente) → `rollback()`, se
   descarta el swap, `500 INTERNAL_ERROR` (detalle solo a logs).
3. Fuera del lock: devolver el envelope con el DTO admin.

Efecto observable: tras un `2xx` admin, el **siguiente** GET público sirve el contenido nuevo
(estudiante ve el curso actualizado de inmediato), nunca un estado a medias.

### 6.4 Invariante `lesson_id == example_id` — SE MANTIENE

Total en el modelo actual (content.py:312 `example_ids==lesson_ids`, content.py:479
`example_id=lesson_id`; expuesto en GETs congelados). Consecuencia: **no hay POST/DELETE de ejemplos
independientes** (C7):
- `POST /admin/lessons` crea atómicamente, bajo el mismo id y misma transacción: fila lección + fila
  ejemplo (metadatos + `source_code`) + quiz diferido (hasta el primer `PUT .../quiz`). La atomicidad
  es obligatoria porque el reload re-valida el grafo completo.
- `DELETE /admin/lessons/{id}` borra las tres filas (CASCADE) + limpia entradas `recommended`
  colgantes que apunten a `{id}` en la misma transacción.
- El ejemplo solo tiene `PUT /admin/examples/{id}` (metadatos) y `POST /admin/examples/{id}/code`
  (fuente).

`modules` no lleva columna `lessons[]`: pertenencia = `lessons.module_id`, orden = `lessons.order`.
`ContentRepository.modules()` deriva `lesson_ids` → el GET público `/modules` sale idéntico.

---

## 7. DTOs

### 7.1 Backend — añadir a `backend/app/schemas.py` (sección nueva §9, additive; NO tocar lo existente)

```python
# ───────── §9 Admin (Fase 4) — additive ─────────
ID_PATTERN  = r"^[A-Za-z][A-Za-z0-9_-]{0,63}$"   # ids estables (== nombre de carpeta)
QID_PATTERN = r"^[A-Za-z0-9._-]{1,80}$"

# Auth
class AdminLoginRequest(BaseModel):   password: str = Field(min_length=1, max_length=256)
class AdminLoginResult(BaseModel):    token: str; expires_at: str
class AdminSessionInfo(BaseModel):    authenticated: bool; expires_at: str | None

# Compartidos
class AdminRecommended(BaseModel):
    lesson_id: str; label: str = Field(min_length=1, max_length=120); tag: str = Field(min_length=1, max_length=40)

# Módulos
class AdminModuleBase(BaseModel):
    order: int = Field(ge=1); title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=2000); level: str = Field(min_length=1, max_length=40)
class AdminModuleCreate(AdminModuleBase):  id: str = Field(pattern=ID_PATTERN)
class AdminModuleUpdate(AdminModuleBase):  """id = path param; reemplazo total de editables (C8)."""
class AdminLessonRef(BaseModel):
    id: str; order: int; title: str; enabled: bool; has_quiz: bool; quiz_question_count: int
class AdminModule(AdminModuleBase):        id: str; lessons: list[AdminLessonRef]
class AdminModulesResponse(BaseModel):     modules: list[AdminModule]

# Ejemplo (faceta)
class AdminExampleBase(BaseModel):
    title: str = Field(min_length=1, max_length=160); filename: str = Field(pattern=FILENAME_PATTERN)
    difficulty: int = Field(ge=1, le=5); teaches: str = Field(min_length=1); directives: list[str]
    threads_configurable: bool; fixed_threads: int | None = Field(default=None, ge=1, le=16)
    fixed_threads_note: str | None = None; sweeps_threads: bool; self_measures: bool
    parser_id: ParserId; default_timeout_s: int = Field(ge=5, le=120); est_run_seconds: int = Field(ge=1)
    enabled: bool; requires_gpu: bool; expected_output_note: str
    takeaways: list[str] = Field(min_length=1)
class AdminExampleUpdate(AdminExampleBase): """metadatos; source_code va por /code."""
class AdminExample(AdminExampleBase):        id: str; module_id: str; order: int; source_code: str
class AdminExampleCodeRequest(BaseModel):
    filename: str = Field(pattern=FILENAME_PATTERN); source_code: str = Field(min_length=1, max_length=262144)
class AdminExampleCodeResult(BaseModel):
    example_id: str; filename: str; bytes: int; source_kind: Literal["admin"]

# Lección (unidad)
class AdminLessonBase(BaseModel):
    module_id: str; order: int = Field(ge=1); title: str = Field(min_length=1, max_length=160)
    estimated_minutes: int = Field(ge=1, le=600); content_markdown: str = Field(max_length=65536)
    recommended: list[AdminRecommended] = Field(default_factory=list, max_length=6)
class AdminLessonCreate(AdminLessonBase):
    id: str = Field(pattern=ID_PATTERN); example: AdminExampleBase; source_code: str = Field(min_length=1, max_length=262144)
class AdminLessonUpdate(AdminLessonBase): """faceta lección + markdown; el ejemplo por sus endpoints."""
class AdminLessonDetail(AdminLessonBase):
    id: str; enabled: bool; has_quiz: bool; quiz_question_count: int
    prev_lesson_id: str | None; next_lesson_id: str | None; example: AdminExample

# Quiz
class AdminQuizOption(BaseModel):   key: QuizOptionKey; text: str = Field(min_length=1)
class AdminQuizQuestion(BaseModel):
    id: str = Field(pattern=QID_PATTERN); order: int = Field(ge=1); text: str = Field(min_length=1)
    options: list[AdminQuizOption] = Field(min_length=2, max_length=4)
    correct_key: QuizOptionKey; explanation: str = Field(min_length=1)
class AdminQuizUpsert(BaseModel):
    pass_threshold: float = Field(gt=0.0, le=1.0); questions: list[AdminQuizQuestion] = Field(min_length=1)
class AdminQuiz(AdminQuizUpsert):   lesson_id: str; question_count: int
```
En `PUT .../quiz` (reemplazo total) el server borra las preguntas de la lección e inserta las nuevas;
`id` de pregunta: acepta el provisto (patrón `QID_PATTERN`) o autogenera `{lesson_id}-q{n}`.

### 7.2 Frontend — `frontend/src/api/admin-types.ts` (nuevo, propiedad UI; C10)

DTOs snake_case, transcripción de §7.1. Reutiliza tipos de lectura de `types.ts`
(`QuizOptionKey`, `ParserId`, `ModuleDto`, `LessonDetailDto`, `ExampleDetailDto`). Campo del quiz =
`correct_key` (C9). No se toca `types.ts` salvo la unión `ApiErrorCode` (§8).

```ts
export interface AdminLoginRequestDto  { password: string }
export interface AdminLoginResultDto   { token: string; expires_at: string }
export interface AdminSessionInfoDto   { authenticated: boolean; expires_at: string | null }
export interface AdminRecommendedDto   { lesson_id: string; label: string; tag: string }
export interface AdminModuleBaseDto    { order: number; title: string; description: string; level: string }
export interface AdminModuleCreateDto extends AdminModuleBaseDto { id: string }
export type      AdminModuleUpdateDto = AdminModuleBaseDto
export interface AdminLessonRefDto     { id: string; order: number; title: string; enabled: boolean; has_quiz: boolean; quiz_question_count: number }
export interface AdminModuleDto extends AdminModuleBaseDto { id: string; lessons: AdminLessonRefDto[] }
export interface AdminModulesResponseDto { modules: AdminModuleDto[] }
export interface AdminExampleBaseDto {
  title: string; filename: string; difficulty: number; teaches: string; directives: string[]
  threads_configurable: boolean; fixed_threads: number | null; fixed_threads_note: string | null
  sweeps_threads: boolean; self_measures: boolean; parser_id: ParserId
  default_timeout_s: number; est_run_seconds: number; enabled: boolean; requires_gpu: boolean
  expected_output_note: string; takeaways: string[]
}
export type      AdminExampleUpdateDto = AdminExampleBaseDto
export interface AdminExampleDto extends AdminExampleBaseDto { id: string; module_id: string; order: number; source_code: string }
export interface AdminExampleCodeRequestDto { filename: string; source_code: string }
export interface AdminExampleCodeResultDto  { example_id: string; filename: string; bytes: number; source_kind: 'admin' }
export interface AdminLessonBaseDto {
  module_id: string; order: number; title: string; estimated_minutes: number
  content_markdown: string; recommended: AdminRecommendedDto[]
}
export interface AdminLessonCreateDto extends AdminLessonBaseDto { id: string; example: AdminExampleBaseDto; source_code: string }
export type      AdminLessonUpdateDto = AdminLessonBaseDto
export interface AdminLessonDetailDto extends AdminLessonBaseDto {
  id: string; enabled: boolean; has_quiz: boolean; quiz_question_count: number
  prev_lesson_id: string | null; next_lesson_id: string | null; example: AdminExampleDto
}
export interface AdminQuizOptionDto   { key: QuizOptionKey; text: string }
export interface AdminQuizQuestionDto {
  id: string; order: number; text: string; options: AdminQuizOptionDto[]
  correct_key: QuizOptionKey        // SOLO admin — jamás en el GET público
  explanation: string
}
export interface AdminQuizUpsertDto { pass_threshold: number; questions: AdminQuizQuestionDto[] }
export interface AdminQuizDto extends AdminQuizUpsertDto { lesson_id: string; question_count: number }
```

---

## 8. Códigos de error NUEVOS (añadir al catálogo §1.1 — sin modificar los existentes)

Confirmados como inexistentes hoy (schemas.py:16-31, errors.py:26-37). Añadir **7**:

| HTTP | `error.code` | Cuándo |
|---|---|---|
| 401 | `UNAUTHORIZED` | Login con password incorrecto, o endpoint admin sin/`con` Bearer inválido o expirado |
| 403 | `ADMIN_DISABLED` | `EHPC_ADMIN_PASSWORD` ausente → modo admin deshabilitado (login + todo `/admin/*`) |
| 404 | `MODULE_NOT_FOUND` | id de módulo inexistente |
| 409 | `DUPLICATE_ID` | crear con un id ya usado (módulo o lección/ejemplo) |
| 409 | `ORDER_CONFLICT` | `order` de módulo o de lección colisiona |
| 409 | `MODULE_NOT_EMPTY` | borrar un módulo con lecciones |
| 422 | `CONTENT_VALIDATION_ERROR` | reglas de negocio (refs, markdown, correct_key, threads/GPU, unicidad) con `details` por campo |

Cambios:
- `backend/app/schemas.py` `ApiErrorCode` (Literal, línea 16): añadir los 7.
- `backend/app/errors.py` `DEFAULT_STATUS` (línea 26): `"UNAUTHORIZED":401, "ADMIN_DISABLED":403,
  "MODULE_NOT_FOUND":404, "DUPLICATE_ID":409, "ORDER_CONFLICT":409, "MODULE_NOT_EMPTY":409,
  "CONTENT_VALIDATION_ERROR":422`. `ApiException(code, msg)` resuelve el HTTP automáticamente
  (errors.py:86).
- `frontend/src/api/types.ts` `ApiErrorCode`: añadir los 7 a la unión.
- `docs/architecture/api-contract.md` §1.1: añadir las 7 filas; nueva §ADMIN con los endpoints de
  §5.3 y §6.1.

**Reutilizados** en paths admin (ya existen): `LESSON_NOT_FOUND`, `EXAMPLE_NOT_FOUND`,
`QUIZ_NOT_FOUND`, `CODE_TOO_LARGE`(413), `INVALID_EXTENSION`(415), `INVALID_ENCODING`(422),
`VALIDATION_ERROR`(422), `EXAMPLE_DISABLED`(409), `TOO_MANY_JOBS`, `DOCKER_UNAVAILABLE`,
`RUNNER_IMAGE_MISSING`, `INTERNAL_ERROR`.

---

## 9. UI admin (build único web + Electron)

Todo lo del estudiante intacto: `router.tsx` solo gana una rama hermana `/admin`; `client.ts`,
`types.ts` (salvo la unión `ApiErrorCode`), `messages.ts`, `ehpc.d.ts` no se tocan. Chunks admin
`lazy` → fuera del bundle del estudiante.

### 9.A Routing — rama top-level `/admin` (NO anidada bajo `AppShell`)

```ts
// router.tsx — AÑADIR objeto al array de createHashRouter
{
  path: '/admin',
  children: [
    { path: 'login', element: screen(AdminLoginScreen) },              // pública
    { element: <AdminGuard><AdminShell/></AdminGuard>, children: [     // gate + shell propio
      { index: true,                 element: screen(AdminDashboard) },
      { path: 'lecciones/nueva',     element: screen(AdminLessonEditor) },
      { path: 'lecciones/:lessonId', element: screen(AdminLessonEditor) },
      { path: 'quiz/:lessonId',      element: screen(AdminQuizEditor) },
      { path: 'ejemplos/:exampleId', element: screen(AdminExampleEditor) },
      { path: '*',                   element: <Navigate to="/admin" replace/> },
    ]},
  ],
}
```
Sin item en `NAV_ITEMS`; el admin llega tecleando `#/admin` (documentado en README). El editor de
ejemplo NO tiene ruta `/nuevo`: los ejemplos nacen con la lección (C7); se editan en
`#/admin/ejemplos/:exampleId`.

### 9.B Árbol de archivos (feature-first, <400 líneas c/u)

```
frontend/src/
├─ api/admin.ts                 # authFetch + funciones tipadas (§9.D)
├─ api/admin-types.ts           # DTOs de escritura admin (§7.2)
├─ stores/adminSessionStore.ts  # Zustand + persist(sessionStorage) (§9.E)
├─ hooks/useAdminResource.ts    # fetch genérico {data,loading,error,reload}
├─ lib/pyfile.ts                # validatePyFile() extraído de CodePanel (DRY)
├─ components/admin/{AdminGuard,AdminShell,AdminTopBar,AdminSaveBar,ConfirmDialog}.tsx
├─ styles/screens/admin.css     # importado en main.tsx; recicla tokens existentes
└─ features/admin/
   ├─ AdminLoginScreen.tsx  AdminDashboard.tsx
   ├─ dashboard/{ModuleGroup,LessonAdminRow,ModuleFormDialog}.tsx
   ├─ lesson/{AdminLessonEditor,LessonMetaFields,MarkdownEditor}.tsx
   ├─ quiz/{AdminQuizEditor,QuestionEditorCard}.tsx
   └─ example/{AdminExampleEditor,ExampleMetaFields,CodeDropzone,TakeawaysEditor}.tsx
```
Cero tokens CSS nuevos: reciclar `.card`, `.btn*`, `.field-*`, `.chip*`, `.markdown`, `.code-editor`,
`.error-state`, `.empty-state`, `.skeleton`. `IconLogOut` se porta a `icons.tsx` si no existe.

### 9.C AdminShell + login gate

- `AdminGuard`: al montar, si no autenticado, `restore()` (verifica contra `GET /admin/session`);
  `status==='restoring'` → `ScreenSkeleton` (sin flash de login); si no autenticado → `Navigate` a
  `/admin/login` guardando `state.from`. `/admin/login` queda fuera del guard (evita bucle).
- `AdminShell`: layout propio (grid header+main), SIN `Sidebar`/`TopBar` del estudiante; borde
  superior distintivo para que el admin sepa que no está en la vista del alumno; botón "Cerrar sesión".

### 9.D `api/admin.ts` — authFetch (sin tocar `client.ts`)

`client.ts` ya mergea `init.headers` en `buildHeaders`, así que basta inyectar el bearer por `init`:
```ts
function authInit(init?: RequestInit): RequestInit {
  const token = useAdminSession.getState().token
  return { ...init, headers: { ...init?.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
}
async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try { return await fetchJson<T>(path, authInit(init)) }
  catch (err) { if (err instanceof ApiError && err.status === 401) useAdminSession.getState().clear(); throw err }
}
```
Funciones: `adminLogin(password)` → `POST /admin/login` (sin bearer); `adminLogout()` →
`POST /admin/logout`; `adminSessionInfo()` → `GET /admin/session`; `createModule/updateModule(PUT)/deleteModule`;
`createLesson/updateLesson(PUT)/deleteLesson`; `getAdminQuiz/putAdminQuiz`;
`getAdminExample/updateExample(PUT)/uploadExampleCode(POST /code)`. **Lecturas del dashboard**
(lista de módulos/lecciones, código default de un ejemplo) **reutilizan `api/content.ts`**
(`getModules`, `getExample`, `getLesson`); solo el quiz con `correct_key` usa el endpoint admin.

### 9.E `stores/adminSessionStore.ts` — Zustand + persist(**sessionStorage**)

`sessionStorage` (no `localStorage`): se limpia al cerrar la ventana → menor blast-radius ante XSS
persistente; la sesión es server-side de vida corta de todos modos. `persist` con
`createJSONStorage(() => sessionStorage)`, `partialize` = `{token, expiresAt}`. Estado:
`{token, expiresAt, status}`; acciones `login` (throws `ApiError` 401/403 para que el form lo
muestre), `logout`, `clear` (limpieza local pura, la usa `authFetch` en 401), `restore` (verifica
contra `GET /admin/session`; si `authenticated:false` → limpia, cubre backend reiniciado).

### 9.F Las 5 pantallas

1. **Login** `#/admin/login`: `Field` password (autoFocus, Enter=submit) + botón "Entrar". `401` →
   error rojo "Contraseña incorrecta". `403 ADMIN_DISABLED` → `EmptyState` "Modo administrador
   deshabilitado / Define EHPC_ADMIN_PASSWORD en el backend" (sin campo). Red → `ErrorState` retry.
   Si ya autenticado al montar → `Navigate` a `state.from ?? '/admin'`.
2. **Dashboard** `#/admin`: `getModules()`; `ModuleGroup` colapsable con acciones CRUD + botón
   "+ Nuevo módulo"/"+ Lección"; `LessonAdminRow` con badges (`enabled`, `has_quiz·count`, ejemplo)
   y acciones [Lección]/[Quiz]/[Ejemplo]/[borrar]. Borrar módulo con lecciones → `409 MODULE_NOT_EMPTY`
   → toast "Vacía el módulo antes de borrarlo".
3. **Editor de lección** `#/admin/lecciones/:lessonId` (y `/nueva`): grid 2col — izq `MarkdownEditor`
   (textarea + preview con el **mismo `renderMarkdown`** del estudiante → WYSIWYG); der
   `LessonMetaFields` (título, id readonly-al-editar, módulo select, orden, minutos, ejemplo,
   enabled, recomendadas). `AdminSaveBar` sticky (dirty/Guardar/Descartar + errores 422 por campo).
   `/nueva` → `createLesson` (incluye `example` + `source_code` pareados, C7); edición → `updateLesson`.
   Bloqueo de navegación con cambios sin guardar.
4. **Editor de quiz** `#/admin/quiz/:lessonId`: `getAdminQuiz`; lista de `QuestionEditorCard`
   (enunciado, 2-4 opciones con radio `correct_key`, explicación, ▲▼ reorder, borrar); add/remove/
   reorder inmutables recomputan `order`. Guardar → `putAdminQuiz` (reemplazo total).
5. **Uploader/editor de ejemplo** `#/admin/ejemplos/:exampleId`: grid 2col — izq `CodeDropzone`
   (accept `.py`, ≤262144 bytes, decode UTF-8 vía `lib/pyfile.validatePyFile`, textarea editable);
   der `ExampleMetaFields` (todos los metadatos; `default_timeout_s` acotado a `max_timeout_s` de
   `/system`; coherencia threads/GPU). Guardar metadatos → `updateExample`; solo código →
   `uploadExampleCode`. Botón "Probar en simulador" (habilitado si sin cambios y enabled) → navega a
   `#/simulador?ejemplo={id}` → pipeline del runner existente (sandbox intacto).

Validación client-side (el backend re-valida siempre): mapea `422` con `details.field` a
`field-hint error`; si no, banner en `AdminSaveBar`.

---

## 10. Plan de paquetes paralelizables

**Propiedad exclusiva de archivos** — ningún archivo tocado por dos paquetes. Archivos compartidos
(`schema.sql`, `schemas.py`, `errors.py`, `main.py`, `conftest.py`, `types.ts`, `router.tsx`,
`main.tsx`) tienen un único dueño; los demás los consumen ya hechos.

| PKG | Título | Archivos (propiedad exclusiva) | Depende de |
|-----|--------|-------------------------------|-----------|
| **A** | DB · seeder · ContentRepository | `backend/app/schema.sql`, `app/repositories/content.py`, `app/tools/seed_content.py`(new), `app/services/content_state.py`(new: `reload_content`), `backend/tests/conftest.py` | — |
| **B** | Contratos backend | `backend/app/schemas.py` (§9 DTOs), `backend/app/errors.py` (7 códigos) | — |
| **C** | Auth backend | `backend/app/config.py`, `app/services/admin_auth.py`(new), `app/routers/admin_deps.py`(new), `app/routers/admin_auth.py`(new) | B |
| **D** | Endpoints de contenido | `backend/app/routers/admin.py`(new), `app/services/content_writer.py`(new), `app/services/markdown_validator.py`(new) | A, B, C |
| **E** | Integración (seam) | `backend/app/main.py` (lifespan seed+load, `app.state.admin_sessions`/`admin_throttle`, registrar `admin_auth.router` + `admin.router`) | A, C, D |
| **F** | Contratos frontend | `frontend/src/api/types.ts` (solo unión `ApiErrorCode`), `frontend/src/api/admin-types.ts`(new) | — (usa este doc) |
| **G** | UI admin | `frontend/src/router.tsx`, `main.tsx` (import css), `api/admin.ts`(new), `stores/adminSessionStore.ts`(new), `hooks/useAdminResource.ts`(new), `lib/pyfile.ts`(new) + edición `simulator/CodePanel.tsx` (extracción sin cambio de comportamiento), `components/admin/*`(new), `features/admin/*`(new), `styles/screens/admin.css`(new) | F |

**Olas de ejecución**: Ola 1 = A, B, F (paralelas). Ola 2 = C (tras B), G (tras F). Ola 3 = D (tras
A,B,C). Ola 4 = E (tras A,C,D). E2E (§11) tras E.

**Criterios de aceptación por comando** (backend sin daemon Docker; puertos 127.0.0.1):
- **A**: `DOCKER_HOST=tcp://127.0.0.1:1 pytest backend/tests -q` verde, incl. `test_seed_no_data_loss`
  (igualdad de snapshot campo-a-campo, conteos 8/14/14/60, idempotencia) y goldens de GET públicos
  idénticos a Fase 3. `python -m app.tools.seed_content --check` sale 0 contra fixtures limpios.
- **B**: `python -c "import app.schemas, app.errors"` ok; `ruff check backend/app/schemas.py app/errors.py`;
  mypy limpio. (Sin runtime; puro additive.)
- **C**: `DOCKER_HOST=tcp://127.0.0.1:1 pytest backend/tests/test_admin_auth.py -q` — login OK emite
  token; password malo → 401 `UNAUTHORIZED`; sin var → 403 `ADMIN_DISABLED`; `require_admin` sin
  bearer → 401; token expirado → 401; `verify_password` tiempo constante (dummy compare).
- **D**: `DOCKER_HOST=tcp://127.0.0.1:1 pytest backend/tests/test_admin_content.py -q` — CRUD módulos/
  lecciones/quiz/ejemplos; `409 DUPLICATE_ID`/`ORDER_CONFLICT`/`MODULE_NOT_EMPTY`;
  `422 CONTENT_VALIDATION_ERROR` (markdown, correct_key, threads/GPU); reload → GET público refleja el
  cambio; subida `.py` `413`/`415`/`422`.
- **E**: `DOCKER_HOST=tcp://127.0.0.1:1 pytest backend/tests -q` verde full; arranque con y sin
  `EHPC_ADMIN_PASSWORD` (sin var: `/admin/*` → 403; estudiante idéntico).
- **F**: `cd frontend && npx tsc --noEmit` limpio.
- **G**: `cd frontend && npx tsc --noEmit && npx vitest run` — tests de §9 (store, guard, authFetch,
  editores, `lib/pyfile`) verdes, ≥80% en stores/hooks/lib nuevos.

---

## 11. Riesgos y verificación E2E

**Riesgos**
- **R1 — Doble fuente de verdad (fixtures vs DB).** Tras el primer boot, DB manda; el auto-seed se
  salta si `lessons` no está vacía. Mitigación: `python -m app.tools.seed_content [--prune]` como reset
  explícito; documentar "fixtures = seed, DB = runtime" en `content/README.md` y `data-model.md`.
- **R2 — Reload concurrente con lecturas en vuelo.** Resuelto por diseño (§4): build-then-swap +
  snapshot inmutable + lecturas síncronas + bind-once en handlers, en un solo event loop. Test:
  N GETs concurrentes durante `reload_content` → cada respuesta internamente consistente.
- **R3 — Round-trip JSON de listas.** `json.dumps(..., ensure_ascii=False)`/`json.loads` preservan
  orden y unicode (acentos/comillas); `source_code`/`content_markdown` a TEXT sin transformación.
  Cubierto por `test_seed_no_data_loss`.
- **R4 — Reload falla tras un write (grafo inconsistente).** `content_writer` hace `rollback()` +
  descarta swap + `500 INTERNAL_ERROR`; el estado servido no cambia. La validación §6.2 previa lo hace
  improbable.
- **R5 — Token robado por XSS.** Aceptado (§5.6 T3): CSP dura + TTL 8h + `sessionStorage` + logout
  revoca; mono-usuario loopback.

**Verificación E2E (flujo crítico, Playwright; precondición: backend con `EHPC_ADMIN_PASSWORD`)**
1. `#/admin/login` con password correcto → dashboard; con password malo → 401 en el form; sin la env
   var → 403 pantalla "modo deshabilitado".
2. Crear módulo → crear lección con markdown (+ ejemplo pareado + `source_code`) → añadir quiz →
   subir/editar `.py`.
3. **Aparece en el catálogo del estudiante**: `GET /api/v1/modules`/`/lessons/{id}`/`/examples/{id}`
   reflejan el contenido nuevo con shape idéntico; el quiz público (`/lessons/{id}/quiz`) **omite**
   `correct_key`/`explanation`.
4. **Corre en el simulador**: "Probar en simulador" → `POST /jobs` ejecuta el `.py` en el runner
   (network none, non-root, read-only, límites) y muestra logs por WS.
5. **Sin sesión, `/admin/*` = 401** (o 403 si la var está ausente); `logout` invalida el token
   (siguiente request → 401).
6. **No-pérdida en seed**: `test_seed_no_data_loss` verde (igualdad de snapshot + conteos +
   idempotencia); goldens HTTP de los GET públicos idénticos a Fase 3.
```
