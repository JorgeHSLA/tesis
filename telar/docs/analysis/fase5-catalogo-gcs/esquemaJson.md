# Formato de intercambio JSON — módulos publicables de Telar

Diseño del contrato de bucket: índice de catálogo, bundle de módulo, reglas de validación y un ejemplo real (m1 del repo, generado byte a byte desde `backend/app/content/`).

---

## 0. Layout del bucket y raíz de confianza

```
gs://telar-contenido/
├── catalog/
│   └── index.json                    # índice; se relee en cada "buscar actualizaciones"
└── modules/
    ├── m1/
    │   ├── 1.json                    # versiones INMUTABLES: un objeto por versión
    │   ├── 2.json
    │   └── 3.json                    # la vigente según index.json
    ├── m2/
    │   └── 1.json
    └── …
```

**Regla de inmutabilidad.** `modules/<id>/<version>.json` **nunca se sobrescribe**. Publicar es siempre `version+1` + reescribir `index.json`. Consecuencias que compran mucho: el checksum de una versión es eterno, se puede cachear para siempre (`Cache-Control: public, max-age=31536000, immutable`), y un rollback es "apuntar el índice a la versión anterior" sin mover contenido.

**Qué protege el checksum y qué no.** El bucket es público y se lee por HTTPS anónimo: el operador del bucket **es** la raíz de confianza; un checksum publicado por él mismo no lo autentica. El checksum protege contra lo que sí pasa en la práctica — descarga truncada, escritura parcial del publicador, objeto de una versión servido en la ruta de otra, caché envenenada de un intermediario, corrupción en disco. La defensa contra un bucket hostil o equivocado **es la validación** (§4), no el hash: por eso el bundle se valida con el mismo rigor que el código del estudiante, aunque el hash cuadre.

`index.json` no lleva checksum de sí mismo (sería circular). Es el eslabón que solo se cubre con TLS. Por eso el índice **solo aporta metadatos de descubrimiento**: nada de lo que viene en él se persiste sin haber sido confirmado por el bundle (§4.3, regla de triple coincidencia).

---

## 1. `catalog/index.json`

### 1.1 Esquema

```jsonc
{
  "schema": "telar.catalog.index/1",     // versionado del índice (§1.2)
  "generated_at": "2026-08-29T14:05:00.000Z",
  "modules": [ /* ModuleIndexEntry[] */ ]
}
```

`ModuleIndexEntry`:

| Campo | Tipo | Regla |
|---|---|---|
| `id` | string | `ID_PATTERN` = `^[A-Za-z][A-Za-z0-9_-]{0,63}$` (§4.4) |
| `version` | int | `1 ≤ v ≤ 999999999`; monótona por módulo |
| `title` | string | 1..160 |
| `description` | string | 0..2000 |
| `level` | string | 1..40 (texto libre: el repo usa `Básico`/`Intermedio`/`Intermedio-alto`/`Avanzado`) |
| `lesson_count` | int | 1..100; **debe** coincidir con `len(bundle.lessons)` tras parsear |
| `bytes` | int | 1..`max_bundle_bytes`; **debe** coincidir con el tamaño descargado exacto |
| `checksum` | string | `^[0-9a-f]{64}$` — sha256 de los **bytes exactos** del objeto |
| `published_at` | string | ISO-8601 UTC con `Z`; informativo, **nunca** se usa para decidir "hay actualización" |
| `schema` | string | esquema del **bundle** de esa versión, p. ej. `telar.module.bundle/1` |
| `path` | string | *opcional*; si viene, debe ser **igual** a la ruta derivada (§4.4). Nunca se usa para construirla |

### 1.2 Versionado del propio índice

Identificador `"<namespace>/<major>"`. Solo hay major: **no hay cambios compatibles dentro de un major**; cualquier campo nuevo obliga a `/2`.

| Nivel | Esquema desconocido | Campos desconocidos | Por qué |
|---|---|---|---|
| Índice (`schema` raíz) | **Rechazar el índice entero** → `CATALOG_UNAVAILABLE`, UI: "el catálogo remoto es más nuevo que esta versión de Telar" | **Ignorar** | El índice es la puerta: si no se sabe leer, no se puede descubrir nada con seguridad. Pero debe tolerar que el publicador añada metadatos (`authors`, `tags`) sin dejar fuera a los clientes viejos |
| Entrada de módulo (`schema` del bundle) | **Saltar ese módulo**, seguir con el resto; marcarlo en la UI como "requiere una versión más reciente de Telar" | **Ignorar** | Un módulo publicado con un formato futuro **no puede** dejar ilegible el catálogo entero. Es el motivo de que `schema` sea per-módulo y no solo global |
| Bundle (§2) | Rechazar | **Rechazar** (`extra="forbid"`) | Asimetría deliberada: un campo ignorado en silencio dentro del contenido es *o* material pedagógico perdido sin aviso *o* un canal de contrabando. En contenido, el único mecanismo de extensión válido es subir el major |

### 1.3 Ejemplo (valores reales del repo)

```json
{
  "schema": "telar.catalog.index/1",
  "generated_at": "2026-08-29T14:05:00.000Z",
  "modules": [
    {
      "id": "m1",
      "version": 3,
      "title": "Fundamentos",
      "description": "Región paralela, identidad de hilo, @njit/JIT, primer worksharing con reduction.",
      "level": "Básico",
      "lesson_count": 2,
      "bytes": 16492,
      "checksum": "b7078411daecd8610cb32059ff09a8063f6fa10755b6623bbdd74a0cd1d67719",
      "published_at": "2026-08-29T14:02:11.417Z",
      "schema": "telar.module.bundle/1",
      "path": "modules/m1/3.json"
    },
    {
      "id": "m2",
      "version": 1,
      "title": "Patrón SPMD y false sharing",
      "description": "Reparto manual con omp_get_thread_num; false sharing y su arreglo (privado + critical).",
      "level": "Intermedio",
      "lesson_count": 2,
      "bytes": 19591,
      "checksum": "84bce8463af01dfa57f91d14ecf7afc0af763d6c03f573969e884711689d2a70",
      "published_at": "2026-07-14T09:31:44.002Z",
      "schema": "telar.module.bundle/1",
      "path": "modules/m2/1.json"
    },
    {
      "id": "m8",
      "version": 1,
      "title": "GPU (opcional)",
      "description": "target teams distribute parallel for + map; costo de mover datos por PCIe. Solo con GPU NVIDIA + gcc.",
      "level": "Avanzado",
      "lesson_count": 1,
      "bytes": 10009,
      "checksum": "f83359e0b67ebc97f9d48f80ac5fae5c2dee841d6dd9ded81a49f1065568e995",
      "published_at": "2026-07-14T09:39:12.318Z",
      "schema": "telar.module.bundle/1",
      "path": "modules/m8/1.json"
    }
  ]
}
```

Los 8 módulos del repo, con `bytes`/`checksum` reales (serialización canónica de §2.3):

| id | version | lecciones | bytes | sha256 (12 primeros) |
|---|---|---|---|---|
| m1 | 3 | 2 | 16 492 | `b7078411daec` |
| m2 | 1 | 2 | 19 591 | `84bce8463af0` |
| m3 | 1 | 1 | 10 618 | `32f3b52e4abc` |
| m4 | 2 | 2 | 17 436 | `06b3462a39cb` |
| m5 | 1 | 2 | 22 244 | `a1f32d6f73d6` |
| m6 | 1 | 2 | 19 149 | `f7630e0ed54e` |
| m7 | 1 | 2 | 25 799 | `a5bd58774410` |
| m8 | 1 | 1 | 10 009 | `f83359e0b67e` |

El mayor pesa **25,8 KB**. El tope de 2 MiB (§4.2) deja ~80× de holgura: es un cortafuegos, no un límite operativo.

---

## 2. `modules/<module_id>/<version>.json` — el bundle

### 2.1 Esquema

```jsonc
{
  "schema": "telar.module.bundle/1",
  "module": {
    "id": "m1",
    "version": 3,                       // == versión de la ruta == index.version
    "title": "...",
    "description": "...",
    "level": "Básico",
    "suggested_order": 1,               // SUGERENCIA, no autoridad (§2.2)
    "published_at": "2026-08-29T14:02:11.417Z",
    "authors": ["Jorge Sierra"],        // opcional; texto libre, no identidad verificada
    "license": "CC-BY-4.0"              // opcional
  },
  "lessons": [
    {
      "id": "primerEjemplo",
      "order": 1,                       // LOCAL al módulo, 1..N contiguo (E2)
      "title": "...",
      "estimated_minutes": 15,
      "enabled": true,                  // E1: propio de la lección, ya NO derivado del ejemplo
      "completion_rule": "quiz",        // E4: "quiz" | "viewed" | "run"
      "content_markdown": "# ...",      // markdown embebido, subset validado
      "recommended": [
        { "lesson_id": "spmd", "module_id": "m2", "label": "...", "tag": "..." }
      ],
      "example": { … } | null,          // E1: OPCIONAL — lección teórica ⇒ null
      "quiz": { "pass_threshold": 0.8, "questions": [ … ] } | null
    }
  ]
}
```

`example` (cuando no es `null`): `id`, `filename`, `title`, `difficulty`, `teaches`, `directives[]`, `threads_configurable`, `fixed_threads`, `fixed_threads_note`, `sweeps_threads`, `self_measures`, `parser_id`, `default_timeout_s`, `est_run_seconds`, `enabled`, `requires_gpu`, `expected_output_note`, `takeaways[]`, `source_code` — espejo exacto de `AdminExampleBase` + `source_code` + el `id` propio que aparece con E1.

`quiz.questions[]`: `id`, `order`, `text`, `options[{key,text}]` (2..4), `correct_key`, `explanation` — espejo de `AdminQuizQuestion`.

### 2.2 Decisiones de forma y su porqué

**`order` es local al módulo (E2).** El exportador **renumera 1..N** al empacar; el instalador lo escribe tal cual. La ruta lineal del curso se deriva en el backend de `(modules."order", lessons."order")`. Para m1 los `order` globales del repo (1, 2) ya coinciden con los locales, así que `catalog.json` no se toca y el canario `test_routers_content.py::test_examples_listado_14_sin_codigo` sobrevive; para m2 (globales 3, 4) el bundle lleva 1, 2 — legítimo bajo `UNIQUE(module_id,"order")`.

**`suggested_order` en vez de `order` para el módulo.** `modules."order"` sigue siendo `UNIQUE` global (`schema.sql:108`): dos módulos publicados por autores distintos con `order = 3` reventarían la instalación con `IntegrityError`. El nombre del campo dice la verdad: es una preferencia del autor. El instalador **reasigna** a `MAX(modules."order") + 1` si el sugerido está tomado y devuelve el asignado en el resultado. Nunca es motivo de rechazo.

**`pass_threshold` vive dentro de `quiz`, no en la lección.** Coincide con `AdminQuizUpsert` y evita el campo huérfano en lecciones teóricas. El instalador escribe `lessons.pass_threshold = quiz.pass_threshold`, o **`1.0`** cuando `quiz` es `null` — valor inerte (sin quiz nunca se evalúa) que satisface el `CHECK (pass_threshold > 0.0 AND <= 1.0)` del DDL.

**`recommended[]` lleva `module_id`.** Es la diferencia entre "enlace roto" y "enlace a un módulo que aún no instalaste". Con él la UI puede ofrecer *"esta lección continúa en m2 — instalarlo"* en vez de tragarse el enlace. En m1 esto no es hipotético: 4 de las 5 recomendaciones apuntan fuera (`spmd`→m2, `sumaVectores`→m4, `tareas`→m6). Ver §5.1: hoy esto **impide** instalar m1 solo.

**`enabled` de lección y de ejemplo son campos distintos.** Tras E1, `lessons.enabled` gobierna la visibilidad en el curso y `examples.enabled` gobierna si se puede ejecutar (`409 EXAMPLE_DISABLED`). Para el módulo GPU la combinación correcta en bundles nuevos es `lesson.enabled=true` + `example.enabled=false`: se lee la teoría de GPU aunque no haya GPU. **Ojo**: el backfill de la migración 5 hereda `lesson.enabled` del ejemplo, así que la línea base queda en 13/14 y `test_modules_catalogo_completo` sigue pasando; el bundle m8 exportado del repo reproduce ese `false`. Cambiarlo a `true` es una decisión de contenido, no de formato — pero hay que tomarla a conciencia porque mueve el conteo.

**`example.id` es propio (E1) y por defecto igual a `lesson_id`.** Mantenerlo igual en la línea base preserva `real_content.example("spmd")` y los 58 tests de `test_routers_jobs.py`.

### 2.3 Serialización canónica

**Normativo:** `checksum` = `sha256(bytes exactos del objeto)`. El verificador **hashea los bytes recibidos y jamás re-serializa**. Es lo único que hace el hash inmune al footgun clásico del JSON canónico: verificar re-serializando produce fallos falsos en cuanto cambia una versión de librería, un `ensure_ascii` o el orden de claves.

**Recomendado (solo para reproducibilidad del publicador):** UTF-8 sin BOM, saltos `\n`, `indent=2`, orden de campos = orden de declaración del modelo pydantic (`ModuleBundle.model_dump_json(indent=2)` + `"\n"` final). Así el mismo contenido produce el mismo checksum en dos publicaciones, y el objeto del bucket es legible por un humano que lo inspeccione. Es una obligación del publicador, no una condición de validez.

---

## 3. Modelos pydantic — `app/schemas/bundle.py` (nuevo)

Aditivo: no toca `schemas/content.py`, `examples.py`, `quizzes.py` ni `admin.py`. Reutiliza `ParserId` (§3), `QuizOptionKey` (§5), `FILENAME_PATTERN` (§7), `ID_PATTERN` y `QUESTION_ID_PATTERN` (§10).

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from .admin import ID_PATTERN, QUESTION_ID_PATTERN
from .examples import ParserId
from .jobs import FILENAME_PATTERN
from .quizzes import QuizOptionKey

BUNDLE_SCHEMA = "telar.module.bundle/1"
INDEX_SCHEMA  = "telar.catalog.index/1"

CHECKSUM_PATTERN = r"^[0-9a-f]{64}$"
ISO_UTC_PATTERN  = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$"

#: E4 — criterio de completado (== CHECK de lessons.completion_rule, migración 5).
CompletionRule = Literal["quiz", "viewed", "run"]


class _Strict(BaseModel):
    """Todo el bundle es entrada NO CONFIABLE: campo desconocido ⇒ rechazo."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


# ── índice ──────────────────────────────────────────────────────────────────
class ModuleIndexEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")   # forward-compat: el índice SÍ tolera
    id: str = Field(pattern=ID_PATTERN)
    version: int = Field(ge=1, le=999_999_999)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=2000)
    level: str = Field(min_length=1, max_length=40)
    lesson_count: int = Field(ge=1, le=100)
    bytes: int = Field(ge=1)
    checksum: str = Field(pattern=CHECKSUM_PATTERN)
    published_at: str = Field(pattern=ISO_UTC_PATTERN)
    schema_: str = Field(alias="schema", min_length=1, max_length=64)
    path: str | None = Field(default=None, max_length=200)


class CatalogIndex(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schema_: str = Field(alias="schema")
    generated_at: str = Field(pattern=ISO_UTC_PATTERN)
    modules: list[ModuleIndexEntry] = Field(max_length=500)


# ── bundle ──────────────────────────────────────────────────────────────────
class BundleRecommended(_Strict):
    lesson_id: str = Field(pattern=ID_PATTERN)
    module_id: str = Field(pattern=ID_PATTERN)
    label: str = Field(min_length=1, max_length=120)
    tag: str = Field(min_length=1, max_length=40)


class BundleExample(_Strict):
    id: str = Field(pattern=ID_PATTERN)
    filename: str = Field(pattern=FILENAME_PATTERN)
    title: str = Field(min_length=1, max_length=160)
    difficulty: int = Field(ge=1, le=5)
    teaches: str = Field(min_length=1, max_length=2000)
    directives: list[str] = Field(max_length=20)
    threads_configurable: bool
    fixed_threads: int | None = Field(default=None, ge=1, le=16)
    fixed_threads_note: str | None = Field(default=None, max_length=500)
    sweeps_threads: bool
    self_measures: bool
    parser_id: ParserId                       # el Literal de 6 valores == CHECK del DDL
    default_timeout_s: int = Field(ge=5, le=86_400)
    est_run_seconds: int = Field(ge=1, le=86_400)
    enabled: bool
    requires_gpu: bool
    expected_output_note: str = Field(max_length=2000)
    takeaways: list[str] = Field(min_length=1, max_length=12)
    source_code: str = Field(min_length=1)    # tope de BYTES en runtime (§4.5)


class BundleQuizOption(_Strict):
    key: QuizOptionKey
    text: str = Field(min_length=1, max_length=500)


class BundleQuizQuestion(_Strict):
    id: str = Field(pattern=QUESTION_ID_PATTERN)   # en bundle es OBLIGATORIO (§4.6)
    order: int = Field(ge=1, le=100)
    text: str = Field(min_length=1, max_length=2000)
    options: list[BundleQuizOption] = Field(min_length=2, max_length=4)
    correct_key: QuizOptionKey
    explanation: str = Field(min_length=1, max_length=2000)


class BundleQuiz(_Strict):
    pass_threshold: float = Field(gt=0.0, le=1.0)
    questions: list[BundleQuizQuestion] = Field(min_length=1, max_length=50)


class BundleLesson(_Strict):
    id: str = Field(pattern=ID_PATTERN)
    order: int = Field(ge=1, le=100)
    title: str = Field(min_length=1, max_length=160)
    estimated_minutes: int = Field(ge=1, le=600)
    enabled: bool
    completion_rule: CompletionRule = "quiz"
    content_markdown: str = Field(min_length=1, max_length=65536)
    recommended: list[BundleRecommended] = Field(default_factory=list, max_length=6)
    example: BundleExample | None = None
    quiz: BundleQuiz | None = None


class BundleModule(_Strict):
    id: str = Field(pattern=ID_PATTERN)
    version: int = Field(ge=1, le=999_999_999)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(max_length=2000)
    level: str = Field(min_length=1, max_length=40)
    suggested_order: int = Field(ge=1, le=9999)
    published_at: str = Field(pattern=ISO_UTC_PATTERN)
    authors: list[str] = Field(default_factory=list, max_length=10)
    license: str | None = Field(default=None, max_length=120)


class ModuleBundle(_Strict):
    schema_: str = Field(alias="schema")
    module: BundleModule
    lessons: list[BundleLesson] = Field(min_length=1, max_length=100)
```

`max_length` en cada string no es decoración: sin ellos, 2 MiB de bundle caben en un solo `title`, y ese título viaja a los DTO y al DOM del estudiante.

---

## 4. Reglas de validación del bundle descargado

Diez puertas, **de la más barata a la más cara**. Ninguna se salta; la primera que falla corta. El objetivo es que nada caro (parsear, validar markdown, tocar SQLite) ocurra sobre bytes que ni siquiera cuadran con lo anunciado.

### 4.1 Transporte

- HTTPS obligatorio; **cero redirecciones** a otro host (la ruta se deriva, no se sigue).
- Timeout de conexión y de lectura (`TELAR_BUCKET_TIMEOUT_S`, por defecto 20).
- `Content-Type` ignorado como autoridad (el bucket puede mentir); el formato lo decide el parseo.
- **Lectura con tope duro mientras se transmite**: se aborta al superar `max_bundle_bytes`, sin acumular. Si el servidor responde con `Content-Encoding: gzip`, el tope se aplica a los bytes **descomprimidos** — un zip bomb de 40 KB puede expandirse a gigabytes; contar solo lo que llega por el cable es el error clásico.

### 4.2 Tamaño

| Objeto | Setting | Defecto | Nota |
|---|---|---|---|
| `catalog/index.json` | `TELAR_MAX_INDEX_BYTES` | 1 MiB | 500 módulos × ~500 B |
| bundle | `TELAR_MAX_BUNDLE_BYTES` | 2 MiB | el mayor real pesa 25,8 KB |
| `source_code` (por ejemplo) | `TELAR_MAX_CODE_BYTES` | 256 KiB | **el mismo** que ya aplica `content_writer._check_code_size` |
| `content_markdown` | (DTO) | 64 KiB | mismo cap que `AdminLessonBase` |

Además: `len(bytes) == index.bytes` **exacto**. Detecta truncado antes de gastar un sha256, y detecta el bundle sustituido antes que el hash.

### 4.3 Checksum y triple coincidencia de versión

1. `sha256(bytes) == index.checksum` → si no, `BUNDLE_CHECKSUM_MISMATCH` (422).
2. Tras parsear: `bundle.module.id == module_id de la ruta == index.id`.
3. `bundle.module.version == version de la ruta == index.version`.
4. `bundle.schema == index.modules[i].schema`.
5. `len(bundle.lessons) == index.lesson_count`.

La triple coincidencia es lo que impide que el bundle de la v2 acabe instalado como v3 (caché mal invalidada, publicación a medias, `index.json` reescrito antes que el objeto). El checksum solo no lo detecta: hashea bien un objeto que es el equivocado.

### 4.4 Decodificación, parseo e ids seguros

**Decodificación**: UTF-8 estricto (`errors="strict"`) → si falla, `BUNDLE_VALIDATION_ERROR`. Rechazar BOM inicial.

**Parseo**:
- `object_pairs_hook` que **rechaza claves duplicadas**. Python se queda con la última en silencio; un `{"correct_key":"a","correct_key":"b"}` haría que el validador viera una cosa y el escritor otra.
- Capturar `RecursionError` (JSON hondamente anidado) → `BUNDLE_VALIDATION_ERROR`, nunca un 500.
- La raíz debe ser un objeto.

**Ids sin path traversal** — `module_id` y `lesson_id` con `ID_PATTERN` = `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Ese patrón ya excluye `/`, `\`, `.`, `..`, `%2e`, `:`, espacios y NUL, y exige inicial alfabética (nada de `-flag` ni ids que empiecen por dígito). Encima:

- **La ruta se DERIVA, nunca se toma**: `object_path = f"modules/{module_id}/{version}.json"`, con `version` validado como entero antes de interpolar. `index.path`, si viene, se compara por igualdad con la derivada; discrepancia ⇒ se salta el módulo. Consumir `path` del índice sería la vía directa a leer objetos arbitrarios.
- **Nombres reservados**: rechazar `module_id`/`lesson_id` cuyo lowercase esté en `{con, prn, aux, nul, com1..com9, lpt1..lpt9, catalog, index, modules}`. Telar se distribuye como app Electron en Windows y el publicador materializa el bucket en disco; `CON` como id de módulo es un fallo real, no teórico.
- **Colisión insensible a mayúsculas**: rechazar `Hola` y `hola` en el mismo bundle o contra ids ya instalados. SQLite los trataría como PK distintas (colación `BINARY`) pero colisionarían al escribirlos en un sistema de archivos insensible.
- `filename` de ejemplo debe cumplir `FILENAME_PATTERN` = `^[A-Za-z0-9._-]{1,80}\.py$` **y además** — regla extra solo del bundle — el tallo (todo lo anterior al `.py` final) debe contener al menos un `[A-Za-z0-9]`. El patrón congelado acepta degenerados como `..py`, `----.py` o `.-.py`; en el contrato admin da igual porque lo escribe un humano autenticado, en un bundle remoto no. El patrón garantiza un nombre *plausible*, no un nombre de archivo *seguro*: si en algún punto se materializa en disco hay que sanearlo aparte.

**Caracteres prohibidos en todo string del bundle**:
- C0 salvo `\n` y `\t` (NUL, `\x1b`, …). Un NUL en un `title` corta strings en C y ensucia SQLite.
- Rangos de anulación bidireccional: `U+202A..U+202E`, `U+2066..U+2069`. Esto es **Trojan Source**: reordenan visualmente el texto sin cambiar los bytes, de modo que el `source_code` que lee el estudiante en el editor no es el que ejecuta el contenedor. En una plataforma cuya función es enseñar leyendo código y luego correrlo, es exactamente el ataque que hay que cerrar.
- Zero-width (`U+200B..U+200D`, `U+FEFF`) dentro de ids: dos ids visualmente idénticos, PK distintas.

**Normalización posterior**: `\r\n` → `\n` en `content_markdown` y `source_code`, **después** de verificar el checksum (normalizar cambia bytes; el hash es sobre los originales). El validador de markdown ya normaliza por su cuenta, pero conviene que lo persistido sea LF.

### 4.5 Esquema pydantic

`ModuleBundle.model_validate(payload)`. Todo `ValidationError` se traduce con el `_strip_input` que ya usa `errors.py` (BL-22) a `details=[{field, reason}]` — nunca se devuelve el `input` al cliente: eco de contenido remoto en un mensaje de error es reflected XSS de manual.

### 4.6 Reglas semánticas (cruzadas), fuera del lock

Todas producen `BUNDLE_VALIDATION_ERROR` (422) con `details=[{field, reason}]`, `field` en notación de ruta (`lessons[1].example.filename`) para que el admin/estudiante localice el fallo.

**Estructura del módulo**
- `lessons[].order` forma exactamente `1..N` **contiguo y sin repeticiones** (más estricto que `UNIQUE(module_id,"order")` del DDL: un hueco en el orden rompería la navegación prev/next que se deriva de `(modules."order", lessons."order")`).
- `lessons[].id` únicos dentro del bundle (y case-insensitively únicos).

**E1 — lección ↔ ejemplo**
- `example` puede ser `null`: es el objetivo del refactor. Lección teórica ⇒ `example: null` **y** `completion_rule != "run"`.
- Si `example != null`: `example.id` único en el bundle.
- Coherencia hilos/GPU — **reutilizar `content_writer._example_coherence_issues` tal cual**: `threads_configurable=true ⇒ fixed_threads=null`; `threads_configurable=false ∧ sweeps_threads=false ∧ requires_gpu=false ⇒ fixed_threads ≥ 1`; `requires_gpu=true ⇒ enabled=false`.
- `len(source_code.encode("utf-8")) ≤ settings.max_code_bytes` — **reutilizar `content_writer._check_code_size`**, que lee el tope en runtime. → `CODE_TOO_LARGE` (413).

**E4 — completado**
- `completion_rule == "quiz"` ⇒ `quiz != null` (regla insatisfacible si no).
- `completion_rule == "run"` ⇒ `example != null ∧ example.enabled` (se completa al terminar bien un job de su ejemplo; un ejemplo deshabilitado no se puede correr).
- `completion_rule == "viewed"` es siempre válido, con o sin quiz.

**Markdown** — **reutilizar `app/services/markdown_validator.validate(md)` sin tocarlo**: es el puerto backend de `frontend/src/lib/markdown.ts`, ya rechaza HTML crudo, `javascript:`/`data:` en enlaces, fences sin cerrar y h5+. Sus issues llegan como `{field, line, reason}`; basta reescribir `field` a `lessons[i].content_markdown` conservando `line`. Que el validador que protege al admin sea el mismo que filtra el bucket es justamente lo que hace defendible "contenido remoto = mismo rigor".

**Quiz** — **reutilizar `content_writer._quiz_issues`**: `correct_key ∈ {o.key}`, keys de opción sin duplicar, ids y `order` de pregunta únicos por lección, id contra `QUESTION_ID_PATTERN`. Diferencia frente al admin: en el bundle el `id` de pregunta es **obligatorio**, no autogenerado. La autogeneración `{lesson_id}-q{order}` de BL-18 es una comodidad para el editor; en un formato de intercambio derivarlo de `order` significaría que reordenar preguntas renombra sus ids, y los ids de pregunta viven en `quiz_attempts`.

**`recommended`** — `lesson_id != lesson.id` (nadie se recomienda a sí mismo). Los que apuntan fuera del bundle **no** se rechazan aquí: ver §5.1.

### 4.7 Reglas que solo se pueden comprobar contra la DB (dentro de `write_lock`)

| Regla | Cómo | Fallo |
|---|---|---|
| **Monotonía de versión** | `bundle.version > installed_modules.installed_version` | `409 MODULE_VERSION_CONFLICT` salvo reinstalación forzada explícita |
| **Estabilidad de `lesson_id`** | ids instalados del módulo vs ids del bundle | ids que desaparecen ⇒ **409, no borrado silencioso** (§5.3) |
| **Colisión de `lessons.id`** | id del bundle que ya existe **en otro `module_id`** | `409 DUPLICATE_ID` |
| **Colisión de `examples.id`** | idem, namespace global (PK) | `409 DUPLICATE_ID` |
| **Colisión de `quiz_questions.id`** | **reutilizar `content_admin.question_ids_in_other_lessons`** (CW-02) | `409 DUPLICATE_ID` — sin esto, `IntegrityError` crudo → 500 |
| **`modules."order"`** | `suggested_order` tomado | **no es error**: reasignar a `MAX+1` |

### 4.8 La última puerta: el grafo

La instalación se persiste con `content_writer._persist(app, _write)`: escribe sin commit → `ContentRepository.load(db)` reconstruye y valida el grafo **completo** sobre los cambios aún sin commitear → `commit()` → swap de `app.state.content`. Cualquier `ContentError` hace `rollback` y no deja nada a medias.

Esto convierte a `load` en la red de seguridad final: aunque una regla de §4.6 se olvide, el bundle inconsistente no llega a persistirse. Y explica por qué **no** hay que usar `content_state.reload_content` (hace el swap sin commit) ni `content_admin.delete_lesson` (purga `lesson_progress`) en el camino de actualización.

### 4.9 Códigos de error nuevos (`app/errors.py`)

```python
"BUNDLE_TOO_LARGE":          413,
"BUNDLE_CHECKSUM_MISMATCH":  422,
"BUNDLE_SCHEMA_UNSUPPORTED": 422,
"BUNDLE_VALIDATION_ERROR":   422,   # details=[{field, reason}] (+ line en markdown)
"MODULE_VERSION_CONFLICT":   409,
"LESSON_REMOVAL_REQUIRES_CONFIRM": 409,
"CATALOG_UNAVAILABLE":       503,
```

Se **reutilizan** `DUPLICATE_ID` (409), `CODE_TOO_LARGE` (413), `MODULE_NOT_FOUND` (404), `INVALID_ENCODING` (422).

### 4.10 `BucketPort` — el puerto

Mismo patrón que `DockerServicePort` (`typing.Protocol` + fake inyectado en `app.state`); el tope de bytes pertenece al puerto, no al llamador, para que el fake no pueda "olvidarlo":

```python
class BucketPort(Protocol):
    async def fetch_index(self, *, max_bytes: int) -> bytes: ...
    async def fetch_module(self, module_id: str, version: int, *, max_bytes: int) -> bytes: ...
```

El adaptador real deriva la ruta y lee de forma anónima; `tests/fakes/fake_bucket.py` sirve bytes de memoria y permite fabricar los casos hostiles (truncado, checksum falso, bomba de tamaño, clave duplicada, Trojan Source) sin red.

---

## 5. Tres choques del formato con el código actual

Estos no son detalles de implementación: cambian lo que el formato *puede* prometer.

### 5.1 `recommended` cross-módulo hoy **impide** instalar m1 solo (bloqueante)

`content.py:676` `_validate_recommended_from_db` lanza `ContentError` si un `recommended[].lesson_id` no existe. En m1 real, `primerEjemplo` recomienda `spmd` (m2) y `for` recomienda `spmd`, `sumaVectores` (m4) y `tareas` (m6). Instalar m1 en una base vacía ⇒ el grafo no valida ⇒ `_persist` hace rollback ⇒ **500 y ninguna instalación posible**. Es un fallo garantizado del primer caso de uso del trabajo, y viene del contenido real, no de un bundle inventado.

**Recomendado — podar al leer, no al escribir.** `recommended_json` conserva la lista **completa** que escribió el autor; `ContentRepository.load` descarta del snacshot en memoria las entradas cuyo destino no está instalado, en vez de lanzar. Propiedades que compra: instalar en cualquier orden funciona; instalar m2 más tarde **reactiva solo** el enlace `primerEjemplo → spmd` sin reinstalar m1; y la UI, con el `module_id` del bundle, puede mostrar *"continúa en m2 (no instalado)"*. Alternativa (podar al instalar) es más simple pero pierde el enlace para siempre y hace la instalación dependiente del orden.

Cualquiera de las dos es un cambio de invariante en `content.py` que hay que documentar en `data-model.md` antes de tocar código.

### 5.2 Tres namespaces globales que el formato no puede blindar solo

`modules.id`, `lessons.id`, `examples.id` y `quiz_questions.id` son PK **globales**. Dos autores independientes que publiquen una lección `hello` colisionan. El formato no lo resuelve (namespacing forzado tipo `m1.hello` rompería `real_content.example("spmd")` y los 58 tests de `test_routers_jobs.py`); lo resuelve **el instalador detectándolo y devolviendo `409 DUPLICATE_ID` limpio** en vez de reventar con `IntegrityError` → 500. Convención recomendada para autores externos, no obligatoria: prefijo propio en los ids.

### 5.3 Lecciones que desaparecen entre versiones = progreso destruido

El invariante central ("`lesson_id` estable ⇒ el progreso sobrevive") solo cubre las lecciones que siguen ahí. Si la v3 de m1 elimina `for`, borrar esa fila arrastra `lesson_progress` y `quiz_attempts` (BL-01). Por eso la actualización debe ser **UPSERT sobre los mismos ids** (el camino del seeder, `seed_content.py:59-123`, idempotente por PK y que por eso no toca el progreso) y, ante ids que desaparecen, **parar**: `409 LESSON_REMOVAL_REQUIRES_CONFIRM` con la lista, y solo proceder con confirmación explícita del estudiante. Actualizar en silencio un módulo y perder el avance es precisamente lo que este trabajo existe para evitar.

Efecto colateral a documentar: si la actualización reescribe un quiz cambiando el nº de preguntas o el umbral, `content_writer:543-553` resetea `best_quiz_score`/`completed` (BL-06). El instalador debe **comparar el quiz y no llamar a `replace_quiz` si es idéntico**; si cambió de verdad, el reset es lo correcto. Y una instalación concurrente aborta intentos de quiz en vuelo vía `_ensure_content_current` (422) — comportamiento correcto que el frontend debe traducir a "el contenido se actualizó, recarga".

---

## 6. Ejemplo completo: `modules/m1/3.json`

Generado desde `backend/app/content/catalog.json` + `lessons/primerEjemplo.md` + `lessons/for.md` + `quizzes/*.json` + `examples/*/main.py`.

- **bytes**: `16492`
- **sha256**: `b7078411daecd8610cb32059ff09a8063f6fa10755b6623bbdd74a0cd1d67719`
- Archivo generado: `/tmp/claude-1000/-mnt-d-universidad-tesis/8ed73b89-b7d2-4f33-b7b0-3f23fa27dbf2/scratchpad/m1-v3.json` (generador: `.../gen_bundle.py`)

```json
{
  "schema": "telar.module.bundle/1",
  "module": {
    "id": "m1",
    "version": 3,
    "title": "Fundamentos",
    "description": "Región paralela, identidad de hilo, @njit/JIT, primer worksharing con reduction.",
    "level": "Básico",
    "suggested_order": 1,
    "published_at": "2026-08-29T14:02:11.417Z",
    "authors": [
      "Jorge Sierra"
    ],
    "license": "CC-BY-4.0"
  },
  "lessons": [
    {
      "id": "primerEjemplo",
      "order": 1,
      "title": "Hola mundo paralelo",
      "estimated_minutes": 15,
      "enabled": true,
      "completion_rule": "quiz",
      "content_markdown": "# Hola mundo paralelo\n\nEste ejemplo es el «hello world» de PyOMP: el primer programa paralelo, igual que el primer *hello world* de Python o de cualquier otro lenguaje. Es además el primer ejemplo que aparece en el [video de presentación de PyOMP](https://www.youtube.com/watch?v=MLkZGEMpriY), la librería que nos permite usar OpenMP en Python.\n\n## Explicación línea a línea\n\n- `@njit` = «no ejecutes esta función como Python normal, **compílala a código máquina nativo** antes de correrla». Esto da eficiencia: lo que corre ya no lo corre el intérprete de Python, lo que lo hace perfecto para evaluar rendimiento real.\n- `def hello():` = una función de Python de toda la vida.\n- `with openmp(\"parallel\"):` = el bloque `with` marca el **inicio y el fin de una región paralela**.\n- `print(\"Hello from thread\", omp_get_thread_num())` = lo que ejecuta cada hilo dentro de la región: imprime su propio número de hilo.\n\n## ¿Cuántos hilos se crean?\n\nSe crean **tantos hilos como procesadores lógicos vea el sistema** (lo que muestra el comando `nproc`), o los que fije la variable de entorno `OMP_NUM_THREADS`.\n\nEn la máquina de referencia, `nproc` devuelve 8, así que el programa produce 8 líneas:\n\n```\nHello from thread 0\nHello from thread 3\nHello from thread 6\nHello from thread 2\nHello from thread 1\nHello from thread 4\nHello from thread 7\nHello from thread 5\n```\n\nFíjate en el orden: **no es 0, 1, 2, …** Los hilos corren concurrentemente y no hay ninguna sincronización de orden, así que cada corrida puede imprimir en un orden distinto. Eso es normal y esperado.\n\n## Fuentes\n\n- [Video de presentación de PyOMP](https://www.youtube.com/watch?v=MLkZGEMpriY)\n",
      "recommended": [
        {
          "lesson_id": "for",
          "module_id": "m1",
          "label": "Tu primer parallel for",
          "tag": "Fundamentos"
        },
        {
          "lesson_id": "spmd",
          "module_id": "m2",
          "label": "Qué hace parallel for por debajo",
          "tag": "Siguiente paso"
        }
      ],
      "example": {
        "id": "primerEjemplo",
        "filename": "helloOpenMP.py",
        "title": "Hola mundo paralelo",
        "difficulty": 1,
        "teaches": "Hola mundo paralelo; identidad del hilo; @njit; OMP_NUM_THREADS",
        "directives": [
          "parallel"
        ],
        "threads_configurable": true,
        "fixed_threads": null,
        "fixed_threads_note": null,
        "sweeps_threads": false,
        "self_measures": false,
        "parser_id": "none",
        "default_timeout_s": 30,
        "est_run_seconds": 5,
        "enabled": true,
        "requires_gpu": false,
        "expected_output_note": "N líneas 'Hello from thread <int>' (orden no determinista)",
        "takeaways": [
          "@njit compila la función a código máquina nativo: lo que corre ya no lo corre Python",
          "El bloque with openmp(\"parallel\") marca el inicio y el fin de la región paralela",
          "Se crean tantos hilos como procesadores lógicos (nproc) o los que fije OMP_NUM_THREADS",
          "El orden de los mensajes es no determinista: los hilos corren concurrentemente"
        ],
        "source_code": "from numba.openmp import njit\nfrom numba.openmp import openmp_context as openmp\nfrom numba.openmp import omp_get_thread_num\n\n@njit \ndef hello():\n    with openmp(\"parallel\"): #tantos hilos como procesadores lógicos vea el sistema. o se puede controlar con la variable de entorno OMP_NUM_THREADS\n        print(\"Hello from thread\", omp_get_thread_num())\n\nhello()\n"
      },
      "quiz": {
        "pass_threshold": 0.8,
        "questions": [
          {
            "id": "primerEjemplo-q1",
            "order": 1,
            "text": "¿Qué hace el decorador @njit en PyOMP?",
            "options": [
              { "key": "a", "text": "Ejecuta la función en un intérprete Python más rápido" },
              { "key": "b", "text": "Compila la función a código máquina nativo antes de correrla" },
              { "key": "c", "text": "Crea automáticamente los hilos de OpenMP" },
              { "key": "d", "text": "Convierte la función a C y la guarda en disco" }
            ],
            "correct_key": "b",
            "explanation": "Según el info: \"no ejecutes esta función como Python normal, compílala a código máquina nativo\"; por eso sirve para medir rendimiento real."
          },
          {
            "id": "primerEjemplo-q2",
            "order": 2,
            "text": "Sin OMP_NUM_THREADS definido, ¿cuántos hilos ejecutan la región parallel?",
            "options": [
              { "key": "a", "text": "Siempre 4" },
              { "key": "b", "text": "Uno solo, hasta que se pida más" },
              { "key": "c", "text": "Tantos como procesadores lógicos vea el sistema (lo que muestra nproc)" },
              { "key": "d", "text": "El doble de los núcleos físicos, siempre" }
            ],
            "correct_key": "c",
            "explanation": "El info lo dice explícitamente y muestra nproc = 8 → 8 líneas de output."
          },
          {
            "id": "primerEjemplo-q3",
            "order": 3,
            "text": "En el output real del ejemplo, los mensajes \"Hello from thread N\" aparecen…",
            "options": [
              { "key": "a", "text": "Siempre en orden 0,1,2,…,7" },
              { "key": "b", "text": "En orden impredecible (0,3,6,2,1,4,7,5 en la corrida del info)" },
              { "key": "c", "text": "Solo el hilo 0 imprime" },
              { "key": "d", "text": "En orden inverso 7,6,5,…" }
            ],
            "correct_key": "b",
            "explanation": "Los hilos corren concurrentemente y no hay sincronización de orden."
          },
          {
            "id": "primerEjemplo-q4",
            "order": 4,
            "text": "¿Qué delimita la región paralela en PyOMP?",
            "options": [
              { "key": "a", "text": "Llaves { } como en C" },
              { "key": "b", "text": "La indentación de la función completa" },
              { "key": "c", "text": "El bloque with openmp(\"parallel\"):" },
              { "key": "d", "text": "El decorador @njit" }
            ],
            "correct_key": "c",
            "explanation": "El info: \"El bloque with marca el inicio y el fin de una región paralela\"."
          }
        ]
      }
    },
    {
      "id": "for",
      "order": 2,
      "title": "Tu primer parallel for",
      "estimated_minutes": 15,
      "enabled": true,
      "completion_rule": "quiz",
      "content_markdown": "# Tu primer parallel for\n\nEste ejemplo calcula π ≈ 3.14159 integrando numéricamente la función 4/(1+x²) entre 0 y 1 con **1.000.000 de pasos**, y lo hace con la directiva más importante de OpenMP: `parallel for` con `reduction`. Según el README del repo, aquí se aprende «worksharing con reducción (π)»: es el patrón **loop-level parallelism**, el primero de los 3 patrones de diseño del paper de PyOMP (los otros dos son SPMD, en `spmd/`, y divide y vencerás, en `tareas/`).\n\n## Explicación línea a línea\n\n- `@njit` = compila `calc_pi` a código máquina nativo (como en `primerEjemplo/`).\n- `step = 1.0 / num_steps` = el ancho de cada rectángulo de la integración numérica.\n- `red_sum = 0.0` = el acumulador de la suma. Aquí está la gracia del ejemplo: **todos los hilos van a sumar sobre él** sin pisarse, gracias a `reduction`.\n- `with openmp(\"parallel for reduction(+:red_sum) schedule(static)\"):` = **una sola directiva hace tres cosas**:\n  - `parallel` crea el equipo de hilos,\n  - `for` reparte las iteraciones del bucle entre ellos (worksharing),\n  - `reduction(+:red_sum)` da a **cada hilo una copia privada** de `red_sum` y las combina con `+` al final. Sin ella, el `red_sum +=` de todos los hilos a la vez sería un data race.\n- `for j in range(num_steps):` = la variable del bucle (`j`) es **privada automáticamente** para cada hilo: es la regla de OpenMP para la variable de control del `for` paralelizado.\n- `x = ((j-1) - 0.5) * step` = el punto donde se evalúa la función (punto medio desplazado; converge igualmente a π con 1M de pasos).\n- `red_sum += 4.0 / (1.0 + x * x)` = cada hilo acumula en **su** copia privada; OpenMP suma las copias al cerrar la región.\n- `pi = step * red_sum` = suma de Riemann: ancho × suma de alturas.\n\n## Sobre `schedule(static)`\n\n`schedule(static)` reparte las iteraciones en bloques contiguos fijos entre los hilos. Es la **única familia de schedule disponible en pyomp 0.5.x**: `schedule(dynamic)` y `schedule(guided)` NO están implementados (los tests del repo oficial los marcan «Unimplemented»), y el chunk de `static` debe ser constante. Esto se ve en detalle en `sumaVectores/`.\n\n## Output real\n\n```\npi = 3.1415926535897523\n```\n\nUna sola línea. Detalle importante: este es el único ejemplo con cómputo pesado **sin warmup del JIT** — la única llamada a `calc_pi` incluye la compilación, así que el tiempo de pared del proceso (unos segundos) está dominado por el JIT, no por el cálculo.\n\n## Fuentes\n\n- Fila 2 de la ruta de aprendizaje del README del repo: «worksharing con reduccion (pi)», directivas `parallel for reduction(+:) schedule(static)`.\n- Con `for/`, `spmd/` y `tareas/` el repo cubre los 3 patrones de diseño del paper de PyOMP.\n",
      "recommended": [
        {
          "lesson_id": "spmd",
          "module_id": "m2",
          "label": "El reparto manual: patrón SPMD",
          "tag": "Fundamentos"
        },
        {
          "lesson_id": "sumaVectores",
          "module_id": "m4",
          "label": "Worksharing sobre arrays",
          "tag": "Práctica"
        },
        {
          "lesson_id": "tareas",
          "module_id": "m6",
          "label": "El tercer patrón: tareas",
          "tag": "Avanzado"
        }
      ],
      "example": {
        "id": "for",
        "filename": "forOpenMP.py",
        "title": "Tu primer parallel for",
        "difficulty": 1,
        "teaches": "Worksharing con reducción (π por integración numérica, 1M pasos)",
        "directives": [
          "parallel for",
          "reduction",
          "schedule"
        ],
        "threads_configurable": true,
        "fixed_threads": null,
        "fixed_threads_note": null,
        "sweeps_threads": false,
        "self_measures": false,
        "parser_id": "none",
        "default_timeout_s": 30,
        "est_run_seconds": 5,
        "enabled": true,
        "requires_gpu": false,
        "expected_output_note": "1 línea: pi = <float> (p.ej. pi = 3.1415926535897523)",
        "takeaways": [
          "parallel for crea los hilos, reparte el bucle y combina resultados en una sola directiva",
          "reduction(+:red_sum) da a cada hilo una copia privada y las suma al final (sin data race)",
          "La variable del bucle es privada automáticamente",
          "Es el patrón loop-level, el primero de los 3 patrones del paper de PyOMP"
        ],
        "source_code": "from numba.openmp import njit\nfrom numba.openmp import openmp_context as openmp\n\n@njit\ndef calc_pi(num_steps):\n    step = 1.0 / num_steps\n    red_sum = 0.0\n    with openmp(\"parallel for reduction(+:red_sum) schedule(static)\"):\n        for j in range(num_steps):\n            x = ((j-1) - 0.5) * step\n            red_sum += 4.0 / (1.0 + x * x)\n\n    pi = step * red_sum\n    return pi\n\nprint(\"pi =\", calc_pi(1000000))"
      },
      "quiz": {
        "pass_threshold": 0.8,
        "questions": [
          {
            "id": "for-q1",
            "order": 1,
            "text": "¿Qué hace reduction(+:red_sum) en la directiva?",
            "options": [
              { "key": "a", "text": "Bloquea red_sum con un mutex en cada suma" },
              { "key": "b", "text": "Da a cada hilo una copia privada de red_sum y las combina con + al final" },
              { "key": "c", "text": "Redondea red_sum al final del bucle" },
              { "key": "d", "text": "Divide red_sum entre el número de hilos" }
            ],
            "correct_key": "b",
            "explanation": "Es la semántica de reduction: evita el data race sin serializar."
          },
          {
            "id": "for-q2",
            "order": 2,
            "text": "En parallel for, la variable del bucle (j) es…",
            "options": [
              { "key": "a", "text": "Compartida: hay que protegerla con critical" },
              { "key": "b", "text": "Privada automáticamente para cada hilo" },
              { "key": "c", "text": "firstprivate por defecto" },
              { "key": "d", "text": "Indefinida: hay que declararla siempre" }
            ],
            "correct_key": "b",
            "explanation": "Regla de OpenMP para la variable de control del for paralelizado (confirmado también en infoSumaVectores e infoMultiplicacionMatrices)."
          },
          {
            "id": "for-q3",
            "order": 3,
            "text": "¿Qué schedule usa este ejemplo y por qué es la única familia disponible en pyomp 0.5.x?",
            "options": [
              { "key": "a", "text": "schedule(dynamic), porque balancea mejor" },
              { "key": "b", "text": "schedule(guided), porque es el default de OpenMP" },
              { "key": "c", "text": "schedule(static); dynamic y guided NO están implementados en pyomp 0.5.x" },
              { "key": "d", "text": "Ninguno: pyomp no acepta la cláusula schedule" }
            ],
            "correct_key": "c",
            "explanation": "El README y los comentarios de sumaVectores lo advierten: los tests de dynamic/guided están marcados \"Unimplemented\"."
          },
          {
            "id": "for-q4",
            "order": 4,
            "text": "¿Qué patrón de diseño del paper de PyOMP ilustra este ejemplo?",
            "options": [
              { "key": "a", "text": "SPMD" },
              { "key": "b", "text": "Divide y vencerás" },
              { "key": "c", "text": "Loop-level parallelism" },
              { "key": "d", "text": "Pipeline" }
            ],
            "correct_key": "c",
            "explanation": "El README indica que for/, spmd/ y tareas/ cubren los 3 patrones; este es el de nivel de bucle."
          }
        ]
      }
    }
  ]
}
```

> **Nota sobre el checksum del ejemplo**: `b707…7719` corresponde a la serialización canónica de §2.3 (`indent=2`, orden de campos declarado, UTF-8/LF, `\n` final). El bloque de arriba muestra `options` compactadas en una línea por legibilidad; los bytes que se publican y se hashean son los del archivo generado en el scratchpad, no los de este render.

---

## 7. Tests que este formato obliga a escribir

`--cov-fail-under=80` (hoy 93,79 %) con un instalador y un puerto nuevos sin cobertura: el margen se consume rápido. Casos que no pueden faltar, todos alimentables desde `FakeBucket`:

**Transporte y bytes** — bundle que excede `max_bundle_bytes` (corte durante la transmisión, sin acumular); `Content-Encoding: gzip` que expande por encima del tope; tamaño ≠ `index.bytes`; checksum que no cuadra; UTF-8 inválido; BOM.

**Parseo hostil** — clave JSON duplicada (`correct_key` dos veces); anidamiento profundo → `RecursionError` capturado, nunca 500; raíz que no es objeto; campo desconocido en el bundle (rechazo) vs. en el índice (ignorado).

**Ids y rutas** — `module_id` con `../`, `/`, `%2e%2e`, NUL; `index.path` distinto de la ruta derivada; `module_id` = `CON`; `Hola` vs `hola`; `filename` degenerado `..py`; string con `U+202E` en `source_code`.

**Semántica** — `correct_key` fuera de las opciones; `parser_id` inventado; markdown con `<script>` / `javascript:` / fence sin cerrar (delegado a `markdown_validator`); `order` con hueco (1, 3); `completion_rule="run"` sin ejemplo; `completion_rule="quiz"` sin quiz; `source_code` por encima de `max_code_bytes`.

**Instalación contra DB** — `version <= installed_version` → 409; colisión de `quiz_questions.id` con otro módulo → `DUPLICATE_ID` limpio, **no** `IntegrityError`; `suggested_order` tomado → reasignación a `MAX+1` sin error; **actualización que conserva `lesson_progress` y `quiz_attempts`** (el test que da sentido al trabajo entero); bundle que elimina una lección → 409 hasta confirmación explícita; instalar m1 en base vacía con sus 4 `recommended` cross-módulo → **éxito** (el que fija §5.1); instalar m2 después → el enlace `primerEjemplo → spmd` aparece sin reinstalar m1.

**Versionado de esquema** — índice con `telar.catalog.index/2` → `CATALOG_UNAVAILABLE`; índice v1 con un módulo `telar.module.bundle/2` → ese módulo se salta y **los demás se instalan**.

Orden de trabajo que minimiza el daño (heredado del mapa de impacto): contratos (`api-contract.md`, `data-model.md`) → migración 5 aislada con `test_repositories.py` → `ContentRepository.load` con `test_seed_content.py::test_seed_no_data_loss` como red → `content_admin`/`content_writer` → schemas/routers → **por último** `bundle.py` + `BucketPort` + instalador sobre `_persist`.