# Mapa de impacto FRONTEND — módulos publicables (bucket GCS) + refactors E1/E2/E4

Solo lectura. Todas las referencias son `archivo:línea` verificadas contra el árbol actual (`git status` limpio salvo `docs/diagrams/casos-de-uso.drawio`).

---

## 0. Resumen ejecutivo (lo que hay que saber antes de leer el detalle)

| Hallazgo | Severidad |
|---|---|
| `LearnScreen.tsx:103` hace `getExample(lesson.example_id)` **encadenado y obligatorio**: con `example_id = null` la lección entera se vuelve inalcanzable (404 → ErrorState). Es la rotura más grave de E1. | 🔴 bloqueante |
| `ModuleAccordion.tsx:25` emite una fila `kind: 'example'` para **toda** lección, sin mirar si tiene ejemplo. El catálogo mentiría con `Ejemplo · —`. | 🔴 bloqueante |
| El *join* `examplesIndex?.get(l.example_id)` aparece en **5 sitios** y todos tienen fallback silencioso (`?? !l.enabled`, `?? true`). Ninguno lanza; todos degradan a datos falsos. | 🔴 silencioso |
| `ContinueCard.tsx:24,27` tiene el id `'primerEjemplo'` **hardcodeado**. Con catálogo à la carte ese id puede no estar instalado → «Empezar» lleva a un 404. | 🟠 |
| `loadExamplesIndex()` (`api/content.ts:75-87`) es una caché **a nivel de módulo ES**, y ni `CatalogScreen.tsx:63` ni `LearnScreen.tsx:85` la invalidan. Tras instalar/actualizar un módulo, los ejemplos nuevos no existen en el índice → metas en `—` hasta recargar la app. | 🟠 |
| `ModuleDto.order` es global: instalar módulos sueltos deja **huecos visibles** (`01, 03, 07`) en `ModuleAccordion.tsx:66` y `LearnScreen.tsx:196`. | 🟠 |
| No existe ninguna UI que ponga `completed: true` sin quiz. `progressStore` solo expone `markViewed` (`stores/progressStore.ts:31,66`), aunque `putLessonProgress` ya acepta `completed` (`api/content.ts:61`, `types.ts:295-298`). E4 es **UI nueva**, no solo backend. | 🟠 |
| **Recomendación de fondo**: mover `est_run_seconds` y `requires_gpu` a `ModuleLessonDto` y **borrar el join con `/examples`**. Mata las 5 llamadas frágiles de golpe y elimina la necesidad de invalidar la caché tras instalar. | ⭐ |

---

## 1. Qué rompe si `example_id` pasa a ser opcional

Cambios de tipo que originan todo: `api/types.ts:153` (`ModuleLessonDto.example_id`) y `api/types.ts:196` (`LessonDetailDto.example_id`) → `string | null`.
Colateral a decidir: `ExampleDetailDto.lesson_id` (`types.ts:132`) — si un ejemplo puede existir sin lección, también es nullable, y eso pega en `SimulatorIdle.tsx:118`.

### 1.1 Lo que TypeScript SÍ caza (error de compilación, ruido sano)

| Archivo:línea | Expresión | Por qué falla |
|---|---|---|
| `features/catalog/ModuleAccordion.tsx:58` | `examplesIndex?.get(l.example_id)` | `Map<string,_>.get()` no acepta `string \| null` → TS2345 |
| `features/catalog/ModuleAccordion.tsx:110` | `examplesIndex?.get(lesson.example_id)?.est_run_seconds` | ídem |
| `features/catalog/ModuleAccordion.tsx:112` | `examplesIndex?.get(lesson.example_id)?.requires_gpu ?? true` | ídem |
| `features/catalog/ContinueCard.tsx:27` | `hasProgress ? lesson.example_id : 'primerEjemplo'` | `string \| null` → `string` |
| `features/learn/LessonSidebar.tsx:55` | `examplesIndex?.get(lesson.example_id)?.est_run_seconds` | ídem |
| `features/learn/LearnScreen.tsx:103` | `getExample(lesson.example_id)` | `getExample(exampleId: string)` (`api/content.ts:25`) |
| `features/simulator/ExamplePicker.tsx:32` | `<option value={l.example_id}>` | `value` no acepta `null` |
| `features/admin/dashboard/LessonAdminRow.tsx:67` | `` navigate(`/admin/ejemplos/${lesson.example_id}`) `` | **NO falla en TS** (interpolación de `null` es legal) → ver 1.2 |

### 1.2 Lo que falla EN SILENCIO (lo peligroso)

**a) `ModuleAccordion.tsx:57-59` — el chip GPU fantasma**
```ts
const requiresGpu = module.lessons.some(
  (l) => examplesIndex?.get(l.example_id)?.requires_gpu ?? !l.enabled,
)
```
El `?? !l.enabled` es un *proxy*: «si no conozco el ejemplo, asumo que si la lección está deshabilitada es por GPU». Con E1, una lección **sin ejemplo** que el backend marque `enabled: false` (porque no hay nada que ejecutar) hace que el módulo entero muestre `Chip tone="amber" requiere GPU NVIDIA + gcc` (`ModuleAccordion.tsx:79`) y despliegue el banner de `ModuleAccordion.tsx:95-102`. Nadie ve un error: se ve una mentira.
Además, mientras `examplesIndex === null` (los ~200 ms de `CatalogScreen.tsx:61-73`) el mismo fallback ya se dispara hoy.

**b) `ModuleAccordion.tsx:112` — filas legibles bloqueadas**
```ts
disabled={!lesson.enabled || (gpuLocked && (examplesIndex?.get(lesson.example_id)?.requires_gpu ?? true))}
```
El `?? true` («ante la duda, deshabilita») convierte una lección **teórica y perfectamente legible** en un botón `disabled` en cuanto `gpuLocked` es cierto o el índice no cargó.

**c) `ModuleAccordion.tsx:22-28` (`visibleRows`) — la fila `example` incondicional**
```ts
if (filter !== 'quiz') rows.push({ lesson, kind: 'example', index: i + 1 })
```
Toda lección genera una fila de ejemplo. Con E1 hace falta un **tercer `kind`** (`'reading'` / `'lectura'`), que arrastra:
- `LessonRow.tsx:13` (`kind: 'example' | 'quiz'`),
- `LessonRow.tsx:45-47` (`className={'cat-lesson-icon ' + kind}` y el icono),
- `LessonRow.tsx:58-62` (el literal `Ejemplo · ~{n}s` vs `Quiz · {n} preguntas`),
- CSS `styles/screens/catalog.css:366-367` (`.cat-lesson-icon.example` / `.quiz` — falta `.reading`).

**d) `ContinueCard.tsx:24,27` — `'primerEjemplo'` hardcodeado**
Con catálogo à la carte ese id puede no estar instalado: `targetId = 'primerEjemplo'` → `/cursos/primerEjemplo` → `LearnScreen.tsx:127-145` pinta *«Esta lección no existe en el catálogo»*. Además `est` (`:28`) se calcula sobre un id que no existe. Debe derivarse de la primera lección del primer módulo **instalado**.

**e) `LessonAdminRow.tsx:67` — `/admin/ejemplos/null`**
Interpola `null` sin protestar → `AdminExampleEditor.tsx:45` hace `getAdminExample('null')` → 404 → ErrorState. El botón `Ejemplo` (`:66-68`) debe pasar a `+ Añadir ejemplo` o quedar `disabled` cuando `example_id == null`.

**f) `SimulatorIdle.tsx:96-97` — centinela equivocado**
```ts
.find((l) => l.enabled && l.example_id !== '')
```
El centinela es `!== ''`, no `!= null`. Con `null` la lección pasa el filtro y `selectExample(null)` → `getExample(null)` → 404 → `setLaunchError` (`:79-81`) en el primer pintado del simulador.

**g) `ExamplePicker.tsx:32` — opción indistinguible**
`<option value={null}>` React lo serializa a `""`, que es exactamente el valor de *«Código propio (editor)»* (`:28`). Elegir una lección teórica silenciosamente equivale a «sin ejemplo». Hay que filtrar esas lecciones del `<select>`.

### 1.3 LearnScreen: el rediseño obligatorio

| Línea | Qué hay hoy | Qué exige E1 |
|---|---|---|
| `LearnScreen.tsx:49-52` | `interface LoadedLesson { lesson; example: ExampleDetailDto }` | `example: ExampleDetailDto \| null` |
| `LearnScreen.tsx:101-108` | `getLesson().then(async l => { const example = await getExample(l.example_id) …})` | condicionar el segundo fetch; **nunca** dejar que su 404 tumbe la lección |
| `LearnScreen.tsx:176` | `const { lesson, example } = loaded` | narrowing |
| `LearnScreen.tsx:181-182` | `gpuLocked = example.requires_gpu …` / `runDisabled = gpuLocked \|\| !example.enabled` | sin ejemplo **no hay nada que ejecutar**: no es «disabled», es «no existe la affordance» |
| `LearnScreen.tsx:238-243` | banner `gpu-banner` | solo si hay ejemplo |
| `LearnScreen.tsx:244` | `<LessonMedia exampleId={example.id} filename={example.filename} …/>` | `LessonMedia.tsx:21-22` exige `exampleId: string` y `filename: string`. Además `LessonMedia.tsx:36` resuelve el video **por `exampleId`** (`lessonVideos.ts:105-106`, mapa `Record<example_id, url>` en `:33`). → **rekeyear el mapa de videos por `lesson_id`**, que es el id estable del invariante. Nota: `LessonMedia.tsx:30` ya prevé una prop `videoUrl` servida por la API — ese es el camino natural para el bucket. |
| `LearnScreen.tsx:245` | `<LessonInfo lesson example runDisabled/>` | ver abajo |

**`LessonInfo.tsx` (122 líneas) sin ejemplo:**
- `:18-22` `TABS` fija 3 tabs; `Código` y `Salida esperada` **no tienen contenido** sin ejemplo.
- `:26` `example: ExampleDetailDto` (prop obligatoria).
- `:41-49` `download()` usa `example.source_code` / `example.filename`.
- `:82-93` takeaways (`example.takeaways`).
- `:97` `highlightDirectives(example.source_code)` → con `undefined` revienta o pinta vacío.
- `:102` `example.expected_output_note`.
- `:106-117` los dos CTAs (`Probar en el simulador` con `example.id`, `Descargar {example.filename}`).
→ Con `example = null` la card debe quedarse en **una sola tab** (Descripción, `:77-95`) y sin la fila de CTAs. Es un cambio de estructura, no un `?.`.

### 1.4 Impacto de E2 y E4 en estos mismos archivos

**E2 (`order` único por `(module_id, order)`)** — buena noticia: casi todo el frontend ya ordena y numera **por posición dentro del módulo**, no por `order` global:
- `ModuleAccordion.tsx:21` ordena las lecciones del módulo; `LessonRow` recibe `index: i + 1` (`:25-26`), no `lesson.order`. ✅
- `LearnScreen.tsx:178` calcula `lessonIndex` posicionalmente. ✅
- `LessonSidebar.tsx:19,65` ídem. ✅
- `lib/reorder.ts:29` (`resequence`) reasigna 1..n global, pero **solo se usa para módulos** (`AdminDashboard.tsx:94`). ✅ Si algún día se reordenan lecciones, tendrá que scopearse por módulo.
- ❌ `LessonAdminRow.tsx:57` pinta `#{lesson.order}` — tras E2 ese número es *dentro del módulo*; la copia debe decirlo.
- ❌ `ModuleFormDialog.tsx:33` mapea `ORDER_CONFLICT` a *«Ese número de orden ya está en uso por otro módulo»*; para conflictos de lección (que llegan al banner vía `AdminLessonEditor.tsx:207-210`) el texto debe decir *«dentro de este módulo»*.
- ❌ **Huecos de numeración**: `ModuleAccordion.tsx:66` (`String(module.order).padStart(2,'0')`) y `LearnScreen.tsx:196` (`Módulo {module?.order}`). Con instalación à la carte se verá `01 · 03 · 07`. Recomendación: `order` solo para **ordenar** (`CatalogScreen.tsx:75`), y pintar el índice posicional (nueva prop `index` desde `CatalogScreen.tsx:155-167`).

**E4 (criterio de «completado» sin quiz)** — hoy `completed` **solo** lo pone un quiz aprobado (`progressStore.ts:87-93`). No existe UI alguna para marcarlo. Hace falta:
1. Acción nueva `markCompleted(lessonId)` en `progressStore.ts` (junto a `markViewed`, `:31` decl / `:66-81` impl). El endpoint ya existe: `api/content.ts:61-69` + `ProgressUpdateRequestDto` (`types.ts:295-298`).
2. Botón en la columna principal de `LearnScreen.tsx` tras `:245`, **condicionado a `!lesson.has_quiz`** (hoy `:246` solo monta `QuizRunner` si `has_quiz`; ese `else` está vacío).
3. Sin cambios en la lectura: `LessonRow.tsx:25,63`, `CatalogStats.tsx:12`, `TracksCard.tsx:15-17`, `LessonSidebar.tsx:20` ya derivan de `progress.completed`.

---

## 2. Pantalla nueva: catálogo remoto

### 2.1 Ruta — **`/modulos` de primer nivel, NO `/cursos/algo`**

`router.tsx:70-71` tiene `cursos` y `cursos/:leccionId`. React Router 7 rankea estático > dinámico, así que `/cursos/tienda` *funcionaría*… pero **una lección remota que se llamara literalmente `tienda` quedaría inaccesible para siempre**. Los `lesson_id` ahora vienen de un bucket = entrada no confiable → no se puede reservar un segmento del namespace de lecciones. Ruta hermana:

```
// router.tsx:22 (junto a los otros lazy)
const ModuleStoreScreen = lazy(() => import('./features/store/ModuleStoreScreen'))

// router.tsx, insertar entre :71 y :73
{ path: 'modulos', element: screen(ModuleStoreScreen) },
```
Un solo chunk nuevo; el patrón `screen()` (`router.tsx:24-30`) ya aporta Suspense + `ScreenSkeleton`.

### 2.2 Sidebar — `components/shell/Sidebar.tsx:42-45`

La sección `'Aprendizaje'` pasa de 1 a 2 items:
```ts
items: [
  { to: '/cursos',  label: 'Aprender (ZINE)',     icon: IconBook,     match: p => p.startsWith('/cursos') },
  { to: '/modulos', label: 'Módulos disponibles', icon: IconDownload, match: p => p.startsWith('/modulos') },
]
```
`IconDownload` existe (`components/icons/icons.tsx:49`). **No usar `IconLayers`**: ya es el de «Autoría» (`Sidebar.tsx:55`) y el rail es de 56 px con solo icono + tooltip (`data-tip`, `Sidebar.tsx:89`) — dos iconos iguales sería ambiguo.
Si además el admin publica desde la UI, la sección `'Autoría'` (`Sidebar.tsx:50-59`) gana `/admin/publicar` **dentro del `if (ADMIN_BUILD)`** para que siga cayendo por tree-shaking en el build estudiante.

### 2.3 TopBar — `components/shell/TopBar.tsx:30-41`

Insertar antes del fallback de `:41` (el orden importa: `startsWith('/cursos')` no colisiona, pero la tabla es «más específica primero»):
```ts
if (pathname.startsWith('/modulos'))
  return { title: 'Aprendizaje · Módulos disponibles', crumbs: ['Aprendizaje', 'Módulos'] }
```

### 2.4 `config.ts` — **no se toca. Decisión explícita.**

El frontend **no habla nunca con GCS**. Motivos concretos del repo:
- «contenido remoto = entrada no confiable» ⇒ la validación (esquema, checksum sha256, `lesson_id` estables) tiene que ocurrir en el backend, donde ya vive el `write_lock` y el patrón `_persist`.
- La CSP de Electron (`electron-spec.md §7.1`, citada en `LessonMedia.tsx:6`) tendría que abrirse a `storage.googleapis.com`; hoy solo se abre para `youtube-nocookie.com`.
- `config.ts:160-167` resuelve `API_BASE` en runtime justamente para no hornear orígenes.
⇒ La pantalla consume endpoints locales nuevos (p. ej. `GET /api/v1/catalog/remote`, `POST /api/v1/catalog/install`), vía `api/client.ts` sin cambios. `config.ts` queda intacto.

### 2.5 Composición de la pantalla (reutiliza el esqueleto del catálogo)

`features/store/ModuleStoreScreen.tsx` con `import '../../styles/screens/store.css'` en la línea 1 (mismo patrón que `CatalogScreen.tsx:5` / `LearnScreen.tsx:15`):

1. `.screen-head` + `eyebrow` + `display-lg` (copiar `CatalogScreen.tsx:130-140`).
2. Toolbar de filtros — `.catalog-toolbar/.catalog-search/.fpill` de `catalog.css:77-165` **son globales** (solo `.catalog .screen-head` está scopeado, `catalog.css:11`), así que se reusan tal cual con filtros `Todos | Instalados | Con actualización | Nuevos`.
3. Grid de tarjetas `Card` (una por módulo remoto): título, descripción, `level-tag`, nº de lecciones, `v{n}`, tamaño, y acción.
4. Estados obligatorios: `Skeleton` (calcar `CatalogScreen.tsx:99-119`), `ErrorState` con `onRetry` (patrón `AdminDashboard.tsx:129-139`), `EmptyState` (bucket vacío / búsqueda sin resultados).
5. Confirmación de «Quitar módulo — **tu progreso se conserva**»: `components/admin/ConfirmDialog.tsx`. Ojo/ventaja: su CSS (`.admin-modal*`, `admin.css:322-378`) se carga **global** desde `main.tsx:17`, así que funciona también en el build estudiante pese al nombre.

---

## 3. `progressStore` + store nuevo

### 3.1 Cambios en `stores/progressStore.ts` (136 líneas)

| Línea | Cambio |
|---|---|
| `:29,49-64` `hydrate` | Ningún cambio de código, pero **contrato nuevo**: tras cada `install/update/remove` hay que llamar `hydrate(true)`. Sin eso, `summary` (`:22`) y `modules` quedan obsoletos y `CatalogStats.tsx:12-15` miente. |
| `:31,66-81` `markViewed` | Añadir hermana `markCompleted(lessonId)` para E4 (mismo patrón optimista + `hydrate(true)`). |
| `:83-101` `applyAttemptResult` | Incrementa `summary.lessons_completed` de forma optimista (`:96-99`). Tras instalar un módulo, `lessons_total` cambia por debajo → depende del `hydrate(true)` del punto anterior. |
| `:24,112-114` `lastLessonId` persistido | **Riesgo de puntero colgado**: si el estudiante desinstala/baja de versión un módulo, `lastLessonId` apunta a una lección inexistente. `ContinueCard.tsx:20-22` degrada bien (`hasProgress=false`), pero cae en el `'primerEjemplo'` roto (§1.2.d). Añadir en `hydrate` un saneo: si ningún módulo contiene `lastLessonId`, ponerlo a `null`. |
| `:35,103-109` `moduleProgress` | **Selector muerto**: solo lo usa su propio test (`tests/stores/progressStore.test.ts:148-158`). Es el sitio natural para exponer el progreso por módulo en las tarjetas del catálogo remoto («si actualizas, conservas 4/7»). |
| `ModuleDto` (`types.ts:161-168`) | Necesita `version: number` (y opcionalmente `checksum`) para poder comparar con el remoto. Cambio de contrato → `api-contract.md` + `data-model.md` primero. |

### 3.2 Store nuevo: **sí, separado** — `stores/catalogStore.ts`

Razón alineada con el repo: `progressStore` es «caché de la verdad del servidor local» y `jobStore` es «estado vivo». El catálogo remoto es una **tercera fuente**, con otra cadencia, otro modo de fallo (bucket caído ≠ backend caído) y estado transitorio de descarga que **no debe** contaminar la caché de progreso.

```
remote: RemoteModuleSummary[] | null
loading, error, lastFetchedAt
op: Record<moduleId, 'idle'|'downloading'|'installing'|'error'>
loadCatalog(force?), install(id, version), update(id), remove(id)
```
Reglas:
- **No persistir nada.** El manifiesto de selección vive en SQLite; duplicarlo en localStorage crearía una segunda fuente de verdad (justo lo que `partialize` de `progressStore.ts:114` evita a propósito).
- Cada `install/update/remove` exitoso llama `useProgressStore.getState().hydrate(true)` **y** `loadExamplesIndex(true)` (`api/content.ts:77` ya acepta `force`) — si no, §0 fila 5.
- El *diff* instalado↔remoto va en una función **pura** `src/lib/catalogDiff.ts` (`diffCatalog(installed, remote) → {installed, updatable, available}`), no dentro del store: `src/lib/**` y `src/stores/**` están en el `coverage.include` de `vitest.config.ts:33` con criterio ≥80 %.

---

## 4. «Hay una versión más reciente de este módulo» en el catálogo local

**Regla de oro: `/cursos` NO puede bloquearse por el bucket.** El patrón ya existe en `CatalogScreen.tsx:61-73` (`loadExamplesIndex` falla → `catch` vacío → la pantalla sigue). El chequeo remoto es un **segundo efecto no bloqueante**: si falla, simplemente no hay chips. Nunca un `ErrorState` en el catálogo local por un bucket inalcanzable (el modo offline es un caso de uso, no un fallo).

**Dos superficies, complementarias:**

**(a) Chip por módulo** — `ModuleAccordion.tsx:74-80`, dentro de `.cat-module-meta`, junto al `level-tag` (`:75`) y al chip GPU (`:79`):
```tsx
{updateAvailable != null && <Chip tone="blue">Actualización · v{updateAvailable}</Chip>}
```
`tone="blue"` (`Chip.tsx:22` → `.chip-blue`, `components.css:541`) hoy **solo se usa en admin** (`LessonAdminRow.tsx:54`), así que en el catálogo del estudiante llega limpio y no compite con el naranja «En curso» (`LessonRow.tsx:52`) ni con el ámbar de GPU. Prop nueva `updateAvailable?: number | null` en `ModuleAccordionProps` (`:31-41`), pasada desde `CatalogScreen.tsx:155-167` junto a `gpuEnabled` (`:165`).

**(b) La acción NO va en la cabecera del acordeón.** `ModuleAccordion.tsx:65` es un `<button>`; anidar un botón dentro es HTML inválido y rompe la semántica de `aria-expanded`. La acción va:
- en un banner dentro del cuerpo abierto, **hermano del `gpu-banner`** (`ModuleAccordion.tsx:95-102`), con clase `.cat-update-banner` y un `Button` «Actualizar a v{n}»; y
- en **una tira global** encima de `.catalog-modules` (`CatalogScreen.tsx:154`): *«3 módulos tienen actualización · Revisar»* → navega a `/modulos?filtro=actualizables`. Sin esto el estudiante tendría que abrir los 8 acordeones para enterarse.

**Copy obligatoria** al actualizar: *«Tu progreso se conserva»* — es la promesa que sostiene el invariante de `lesson_id` estables; si no se dice, nadie actualiza.

---

## 5. Reutilización de UI y CSS nuevo

### 5.1 Se reutiliza tal cual (cero componentes nuevos de bajo nivel)

| Componente | Uso en la pantalla nueva |
|---|---|
| `ui/Card.tsx` (`Card`/`CardPad`/`CardHead`) | tarjeta de módulo remoto |
| `ui/Chip.tsx:5` (`neutral\|green\|orange\|red\|amber\|blue`) | `blue`=actualización · `green`=instalado · `amber`=requiere GPU · `neutral`=disponible · `red`=fallo. **No hace falta ningún tono nuevo.** |
| `ui/Button.tsx:6-7` | `primary`=Incorporar/Actualizar · `outline`=Ver contenido · `ghost`=Quitar |
| `ui/EmptyState.tsx` | bucket vacío / filtro sin resultados |
| `ui/ErrorState.tsx` (con `detail` = `err.code: err.message`, patrón `AdminDashboard.tsx:132-137`) | bucket inalcanzable |
| `ui/Skeleton.tsx` | silueta de N tarjetas |
| `components/admin/ConfirmDialog.tsx` | confirmar «Quitar módulo» |
| `.catalog-toolbar / .catalog-search / .fpill / .fpill-n` (`catalog.css:77-165`) | filtros; son globales, no scopeadas |
| `.gpu-banner` (`catalog.css:382-392`) | plantilla del banner de actualización |
| `.cat-prog-bar` (`catalog.css:276-291`) | barra de progreso de descarga |
| `.admin-toast` (`admin.css:380-398`, global vía `main.tsx:17`) | feedback «Módulo M5 incorporado» |

**No reutilizar**: `ui/StatusChip.tsx` (es la tabla única fase-de-job→chip, acoplada a `ws/messages`). Si hace falta, un `InstallStateChip` propio que imite ese patrón de «tabla única».
**Reutilizable a medias**: `CatalogToolbar.tsx` — su unión `CatalogFilter` (`:9`) y los literales de los pills (`:60,68,76`) están hardcodeados. Sale más barato un `StoreToolbar` que reusa las **clases** que generalizar el componente.
**Dato suelto**: `features/learn/RecommendedCard.tsx` es **código muerto** (ningún importador; retirado en `LearnScreen.tsx:257-260`). Si se toca la carpeta `features/learn`, es candidato a borrado.

### 5.2 CSS nuevo — `src/styles/screens/store.css` (cero hex nuevos)

Solo estas reglas, todas con tokens de `styles/tokens.css`:
- `.store-grid` → `repeat(auto-fit, minmax(var(--col-min-card), 1fr))` (`tokens.css:339`), `gap: var(--grid-gap)` (`:334`).
- `.store-card` / `-head` / `-meta` / `-actions` → `--surface`, `--border`, `--elevation-1/2` (`:261,264`), `--card-pad` (`:333`), `--r-lg` (`:350`).
- `.store-version` → mono tabular, calcando `.cstat-n` (`catalog.css:62`).
- `.store-state--installed` → `--success-soft` / `--success-ink` (`tokens.css:226-228`).
- `.store-state--update` → `--info` / `--info-ink` (`tokens.css:240-241`) — el azul acero CVD-safe, complementario del terracota (`tokens.css:108-113`).
- `.store-state--error` → `--danger*` (`tokens.css:232-234`).

Y en `catalog.css`, un único bloque nuevo junto a `.gpu-banner` (`:382`):
- `.cat-update-banner` — clon de `.gpu-banner` cambiando `--warn` por `--info`.
- El chip de actualización **no necesita CSS**: `.cat-module-meta` (`catalog.css:231`) ya es un flex row.

Todos esos tokens ya se invierten en el bloque de tema oscuro de `tokens.css`, así que **no hay que escribir nada de dark mode**.

---

## 6. Tests de `frontend/tests/` que se rompen

### Rotos por E1 (obligatorio tocarlos)

| Archivo:línea | Qué rompe |
|---|---|
| `tests/fixtures/rest.ts:70,81` | `MODULES.modules[0].lessons[*].example_id: 'spmd' \| 'spmdCritical'`. Sigue compilando con `string \| null`, pero **no hay ningún caso de lección sin ejemplo**: hace falta un fixture nuevo (ver aviso abajo). |
| `tests/fixtures/rest.ts:91-97` | `MODULES.summary`: si `ModulesSummaryDto` gana campos (`examples_total`, `modules_installed`…), error de tipo en el fixture que **cascadea a los 4 consumidores** (`router.test.tsx:44`, `progressStore.test.ts:7,20,43`, `CodePanel.test.tsx:91`). |
| `tests/fixtures/rest.ts:315-338` | `EXAMPLE_BASE.lesson_id: 'spmd'` — solo si se decide nullar también ese lado. |
| `tests/router.test.tsx:38-58` (`fakeFetch`) | Cualquier endpoint nuevo cae en el catch-all `:57` `envelope(null)`, que `client.ts:140-148` convierte en `ApiError` → la pantalla nueva pintaría `ErrorState` en el smoke. Hay que añadir su rama. |
| `tests/router.test.tsx:75,108-112` | El `describe` dice «smoke de las **7** rutas»; con `/modulos` pasan a 8 y falta su `it`. |
| `tests/features/learn/LessonInfo.test.tsx:13-38` | `LESSON` + `<LessonInfo … example={exampleDetail()} …>` seguirá compilando si la prop pasa a `ExampleDetailDto \| null`, pero **faltan los casos nuevos**: «lección sin ejemplo → no hay tabs Código/Salida, ni CTAs, ni takeaways». Los 3 `it` existentes (`:41,48,53`) sobreviven. |
| `tests/features/learn/LessonMedia.test.tsx:41` | `<LessonMedia exampleId="primerEjemplo" …>`: si el mapa de videos se rekeyea a `lesson_id` (§1.3), cambian props y el mock de `resolveLessonVideo` (`:14-17,22`). Ojo: `:5` **ya anticipa** que la URL vendrá del catálogo remoto = contenido no confiable — esa suite es el guardián de la validación de `resolveYouTubeEmbed`. |
| `tests/features/simulator/CodePanel.test.tsx:91,103-140` | ⚠️ **Trampa**: si se mete la lección sin ejemplo en el fixture compartido `MODULES`, el autoselect de `SimulatorIdle.tsx:96-97` la elegirá y el test *«ejemplo sin editar → example_id + lesson_id»* (`:103`) fallará. → crear un fixture **aparte** (`MODULES_CON_LECTURA`), no contaminar `MODULES`. |
| `tests/admin/AdminLessonEditor.test.tsx:30-44,63` | `EXAMPLE_STUB` + `LESSON_DETAIL.example` y el test de create que asume la unidad lección+ejemplo (invariante C7, `AdminLessonEditor.tsx:236-254,196-201`). Cuando `example` sea opcional y aparezca el toggle «¿tiene ejemplo ejecutable?», este test cambia. |

### No rompen pero necesitan casos nuevos

- `tests/stores/progressStore.test.ts:32-45` — el `setState` de reset es parcial, así que añadir `markCompleted` no lo rompe; hace falta un `describe` nuevo para E4 y otro para el saneo de `lastLessonId` colgado.
- `tests/features/shell/TopBar.test.tsx` — no asevera la tabla `routeMeta` de forma exhaustiva (prueba los 2 botones, `:83-91`), así que añadir `/modulos` **no lo rompe**. Sí conviene un caso nuevo.
- `tests/admin/api-admin.test.ts` — intacto; necesita un `describe` para los endpoints de publicación.
- `tests/admin/AdminExampleEditor.test.tsx:37,57` — intacto (va por param de ruta).
- `tests/lib/reorder.test.ts` — intacto (E2 no cambia `resequence`, que solo se usa para módulos).

### Tests nuevos exigidos por la config del repo

`vitest.config.ts:33` mete `src/lib/**` y `src/stores/**` en cobertura con criterio ≥80 %. Todo lo que se cree ahí **nace con test obligatorio**:
- `tests/lib/catalogDiff.test.ts` (instalado vs remoto: igual / desactualizado / nuevo / desaparecido del bucket).
- `tests/stores/catalogStore.test.ts` (install → `hydrate(true)` + `loadExamplesIndex(true)`; fallo de red no deja `op` colgado en `'downloading'`).

---

## 7. Orden de trabajo sugerido (spec antes que código, según CLAUDE.md)

1. `docs/architecture/api-contract.md` + `data-model.md`: `ModuleDto.version/checksum`, `ModuleLessonDto.example_id` nullable (y, si se acepta la recomendación ⭐, `est_run_seconds` + `requires_gpu` en `ModuleLessonDto` para matar el join), `ModulesSummaryDto`, endpoints del catálogo remoto, y los códigos de error nuevos — que van en la unión **cerrada** `ApiErrorCode` de `api/types.ts:29-51`.
2. `backend/app/schema.sql` bloque `-- migration 5` (E1 + E2 + tabla del manifiesto de selección).
3. `api/types.ts` + `api/admin-types.ts` (transcripción literal).
4. E1/E2/E4 en las pantallas existentes (§1) — **antes** de la pantalla nueva: `LearnScreen` y `ModuleAccordion` son el camino crítico.
5. `stores/catalogStore.ts` + `lib/catalogDiff.ts` + sus tests.
6. `features/store/ModuleStoreScreen.tsx` + `styles/screens/store.css` + rutas/Sidebar/TopBar.
7. Chips y banner de actualización en `/cursos` (§4).