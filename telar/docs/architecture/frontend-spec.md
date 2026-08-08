# Telar — Especificación de arquitectura del frontend (React + Vite + TS)

> **Estado: CONGELADO para Fase 3.** Cambios posteriores requieren decisión explícita registrada.
>
> **ACTUALIZACIÓN 2026-07-16 — Rediseño visual "plataforma de curso" (decisión registrada).**
> La dirección visual del handoff cálido (crema + Fraunces) queda **SUPERADA** por la dirección
> aprobada por mockup en §5.0: fondo neutro teal clarísimo, tarjetas blancas flotantes, acento
> naranja único para CTAs, teal = progreso, IBM Plex Sans + JetBrains Mono. Todo lo **estructural
> y de comportamiento** de este documento (rutas, estado, WS, contratos, pantallas §6, tests §10)
> sigue vigente; las referencias *pixel-perfect al handoff* en §5.1/§5.5 y los colores literales
> §1.6 quedan superadas por `styles/tokens.css` (única fuente) — ver
> `docs/CHANGELOG-rediseno-visual.md`.
> **`api-contract.md` es la ÚNICA fuente de verdad del contrato de datos**: todos los shapes,
> paths (`/api/v1/*`), envelope `{success,data,error,meta}`, nombres snake_case, las 8 fases de
> job y los mensajes WS de este documento son ESPEJO LITERAL de ese contrato. Ante cualquier
> divergencia residual, gana api-contract.md. `api/types.ts` y `ws/messages.ts` se TRANSCRIBEN
> del contrato, no se inventan.
> Fuentes: `docs/analysis/handoff-design.md` (spec pixel-perfect), `docs/analysis/examples-content.md`
> (14 ejemplos / 8 módulos / 60 quizzes), `docs/research/electron.md`, `docs/research/fastapi-ws.md`.
> Decisiones de Fase 0 que este documento NO re-litiga: Vite `base:'./'`, HashRouter,
> `VITE_API_BASE`/`VITE_WS_BASE` con default `http://localhost:8000`, fuentes self-hosted
> `@fontsource`, iconos portados literalmente, theming por `data-variant` en `<html>`,
> detección de plataforma vía `window.telar`.

---

## 0. Stack y entorno

| Pieza | Versión | Nota |
|---|---|---|
| Node | 22 LTS (nvm, WSL2) | requisito de Vite 7 / Electron 43 |
| Vite | ^7 | `base: './'` obligatorio (web + `file://`) |
| React | ^18.3 | UMD 18.3.1 era la base del prototipo; no hay motivo para React 19 en MVP |
| TypeScript | ~5.6 | `strict: true` |
| react-router-dom | ^7 | **HashRouter** (`createHashRouter`) |
| zustand | ^5 | ver §3 (decisión Zustand vs Context) |
| @fontsource/ibm-plex-sans, @fontsource/jetbrains-mono | latest | rediseño 2026-07: Plex Sans 400/500/600/700 (UI) + JetBrains Mono 400/500/600/700 (datos/terminal); self-hosted, cero requests de red |
| vitest + @testing-library/react + @testing-library/user-event + jsdom | latest | plan de tests §10 |

**Regla WSL2 (obligatoria):** el código vive en `/mnt/d/universidad/tesis/telar/frontend/`, pero
`node_modules`, caché de Vite y builds se hacen en ext4. Estrategia: clonar/worktree de trabajo en
`~/dev/telar/` para `npm ci` + `npm run build` (I/O 9P de `/mnt/d` es 10-50× más lento y los
symlinks de node_modules fallan en NTFS). **Decisión única de build** (architecture.md §10.2):
docker-compose construye el frontend DENTRO de Docker (multi-stage node:22 → nginx, con
`.dockerignore` de node_modules/dist), ejecutando compose desde el clon ext4; electron-builder
consume el `frontend/dist/` de `npm run build` en ese mismo clon. Documentar en el README raíz.

**Sin dependencias de gráficas ni de editores pesados en MVP**: gráficas SVG a mano (§8),
editor de código = `<textarea>` estilizado como el terminal del handoff (§6.2) — Monaco/CodeMirror
quedan como mejora futura documentada (peso: Monaco ~2 MB; el flujo principal es ejecutar
ejemplos provistos, no escribir desde cero).

---

## 1. Estructura de carpetas (feature-first, archivos < 400 líneas)

```
frontend/
├─ index.html                     # <html lang="es" data-variant="v1">, <title>Telar…</title>
├─ vite.config.ts                 # base: './', plugin react, alias '@' → src
├─ tsconfig.json
├─ package.json
├─ public/                        # favicon; nada más (fuentes van por @fontsource import)
└─ src/
   ├─ main.tsx                    # createRoot + RouterProvider + import de estilos/fuentes
   ├─ router.tsx                  # createHashRouter + React.lazy por pantalla (§2)
   ├─ config.ts                   # API_BASE/WS_BASE resueltos en RUNTIME (architecture.md §2.3:
   │                              #   desktop si window.telar || file: → localhost:8000; web → '')
   ├─ api/                        # capa HTTP tipada (fetch nativo, sin axios)
   │  ├─ client.ts                # fetchJson<T>(): desenvuelve el envelope {success,data,error,meta};
   │  │                           #   !success → throw ApiError(error.code, error.message, status)
   │  ├─ types.ts                 # DTOs TRANSCRITOS de api-contract.md (snake_case literal)
   │  ├─ system.ts                # getSystem() → GET /api/v1/system
   │  ├─ content.ts               # getModules(), getExample(id), getLesson(id), getQuiz(lessonId),
   │  │                           #   submitQuizAttempt(), putLessonProgress(), getProgress()
   │  └─ jobs.ts                  # createJob(), uploadJobFile(), getJob(), listJobs(), cancelJob()
   │
   ├─ ws/
   │  ├─ messages.ts              # tipos del canal WS (§4.2) — espejo del api-contract
   │  └─ jobSocket.ts             # clase JobSocket: conexión, parseo, reconexión, cancel()
   │
   ├─ stores/                     # Zustand (§3)
   │  ├─ themeStore.ts            # variant v1|v2 (persist 'telar-variant')
   │  ├─ sidebarStore.ts          # expanded (persist 'telar-sidebar-expanded', default false)
   │  ├─ progressStore.ts         # CACHÉ de progreso del backend (§3.1) + lastLessonId local
   │  └─ jobStore.ts              # job activo: phase, logs (cap), métricas (cap)
   │
   ├─ hooks/
   │  ├─ useJobSocket.ts          # abre/cierra JobSocket ligado a jobId, vuelca en jobStore
   │  ├─ useSimulation.ts         # SOLO animaciones decorativas (tick 700 ms) — §5.3
   │  ├─ useSystemInfo.ts         # GET /api/v1/system cacheado (module-level promise)
   │  ├─ usePlatform.ts           # 'web' | 'desktop' según window.telar
   │  ├─ useDockerStatus.ts       # desktop: poll window.telar.dockerStatus(); web: GET /health
   │  └─ useReducedMotion.ts      # matchMedia('(prefers-reduced-motion: reduce)')
   │
   ├─ styles/
   │  ├─ tokens.css               # §1.2–1.5 handoff: v1 + [data-theme="dark"] + [data-variant="v2"]
   │  ├─ base.css                 # reset, tipografía base, scrollbar, utilidades (.row/.col/…)
   │  ├─ components.css           # botones, cards, chips, inputs, terminal, shell
   │  └─ screens/                 # home.css, simulator.css, results.css, catalog.css, learn.css
   │
   ├─ components/
   │  ├─ icons/                   # Icon.tsx (wrapper) + 29 iconos portados literal (1 archivo
   │  │                           #   icons.tsx ≤ 350 líneas; son paths de 1-3 líneas c/u)
   │  ├─ ui/                      # Button.tsx, Card.tsx, Chip.tsx, Field.tsx, RangeField.tsx,
   │  │                           # Terminal.tsx, MetricCard.tsx, MiniBar.tsx, NodeDiamond.tsx,
   │  │                           # StatusChip.tsx, EmptyState.tsx, ErrorState.tsx, Skeleton.tsx
   │  ├─ shell/                   # AppShell.tsx (grid + Outlet), Sidebar.tsx, TopBar.tsx,
   │  │                           # RuntimeFooter.tsx (estado Docker/health, §6.7)
   │  └─ viz/                     # HomeThreadsDiagram.tsx, ThreadTopology.tsx (config),
   │                              # LiveTopology.tsx, ComparisonBars.tsx,
   │                              # SpeedupChart.tsx, LiveMetricsChart.tsx, Sparkline.tsx
   │                              # (WorkDistributionChart NO se porta: sin pantalla que lo use)
   │
   ├─ features/
   │  ├─ home/                    # HomeScreen.tsx, QuickCard.tsx, RecentJobs.tsx,
   │  │                           # SuggestedLessons.tsx, TutorialTabs.tsx, TutorialCallout.tsx
   │  ├─ simulator/
   │  │  ├─ SimulatorScreen.tsx   # decide idle (sin :jobId) vs live (:jobId) — router §2
   │  │  ├─ ConfigPanel.tsx       # ejemplo + código + hilos + lanzar
   │  │  ├─ CodePanel.tsx         # dropzone + editor/preview
   │  │  ├─ ThreadsField.tsx      # slider de hilos con modos env/fixed/sweep (§9)
   │  │  ├─ LiveHeader.tsx        # eyebrow/chip estado/acciones (detener/cancelar/resultados)
   │  │  ├─ LiveMetricsRow.tsx    # 4 MetricCard con datos reales (§6.3)
   │  │  ├─ LiveNodesCard.tsx     # LiveTopology + warn banner (decorativo, §5.3)
   │  │  ├─ LiveTerminalCard.tsx  # Terminal con logs reales del WS, auto-scroll
   │  │  └─ ThreadsTable.tsx      # "Detalle por hilo" (§6.3.6)
   │  ├─ results/                 # ResultsScreen.tsx, ResultsList.tsx (historial),
   │  │                           # ResultMetricsRow.tsx, OutputCard.tsx, ObservationsCard.tsx
   │  ├─ catalog/                 # CatalogScreen.tsx, ModuleAccordion.tsx, LessonRow.tsx,
   │  │                           # CatalogStats.tsx, CatalogToolbar.tsx, ContinueCard.tsx
   │  └─ learn/                   # LearnScreen.tsx, LessonInfo.tsx (markdown del info*.md),
   │                              # LessonSidebar.tsx, QuizCard.tsx, QuizRunner.tsx,
   │                              # RecommendedCard.tsx, TracksCard.tsx
   │
   ├─ lib/                        # markdown.ts (subset EXACTO: h1-h4, párrafos, listas anidadas,
   │                              #   código inline + fenced, negrita/cursiva, enlaces, tablas
   │                              #   simples — los lessons/*.md se redactan DENTRO de ese subset),
   │                              # format.ts (fmtTime, bytes, %),
   │                              # speedup.ts (curvas, eficiencia, Amdahl), observations.ts (§6.4)
   └─ types/
      └─ telar.d.ts                # declaración global de window.telar (compartida con desktop)
```

Reglas: un componente por archivo; los datos mock del prototipo NO se portan — todo dato visible
viene de la API o de `progressStore`; los textos literales adaptados a OpenMP (§5) viven junto a
cada componente (no hay i18n en MVP, idioma único `es`).

---

## 2. Rutas (HashRouter) y code-splitting

```ts
// router.tsx — createHashRouter; cada pantalla con React.lazy + <Suspense fallback={<ScreenSkeleton/>}>
const routes = [
  { path: '/', element: <AppShell/>, children: [
    { index: true,               lazy: () => import('./features/home/HomeScreen') },
    { path: 'simulador',         lazy: () => import('./features/simulator/SimulatorScreen') },   // idle/config
    { path: 'simulador/:jobId',  lazy: () => import('./features/simulator/SimulatorScreen') },   // live
    { path: 'resultados',        lazy: () => import('./features/results/ResultsList') },         // historial
    { path: 'resultados/:jobId', lazy: () => import('./features/results/ResultsScreen') },
    { path: 'cursos',            lazy: () => import('./features/catalog/CatalogScreen') },
    { path: 'cursos/:leccionId', lazy: () => import('./features/learn/LearnScreen') },
    { path: '*',                 element: <NotFound/> },                                          // vuelve a '/'
  ]},
]
```

- **Un chunk por pantalla** (5 chunks + vendor). `components/ui`, `icons` y `shell` van al chunk
  principal (compartidos por todas).
- Títulos y crumbs del topbar por ruta (tabla §0.4 del handoff, adaptada):

| Ruta | title | crumbs |
|---|---|---|
| `/` | `Inicio` | `['Telar']` |
| `/simulador` | `Simulador · Configurar` | `['Simulador','Configurar']` |
| `/simulador/:jobId` | `Simulador · En vivo` | `['Simulador','En vivo']` |
| `/resultados` | `Resultados` | `['Simulador','Resultados']` |
| `/resultados/:jobId` | `Resultados` | `['Simulador','Resultados']` |
| `/cursos` | `Aprendizaje · Catálogo` | `['Aprendizaje','Catálogo']` |
| `/cursos/:leccionId` | `ZINE · Aprender` | `['Aprendizaje', modulo, leccion]` |

- Navegación conserva el `scrollTo({top:0, behavior:'smooth'})` de `.main` (efecto en AppShell
  sobre cambio de `location.pathname`; con `prefers-reduced-motion` → `behavior:'auto'`).
- `NAV_ITEMS` del sidebar → rutas: Inicio `/`, Simulador `/simulador`, Resultados `/resultados`,
  `Aprender (ZINE)` `/cursos`. El item Simulador queda activo también en `/simulador/:jobId`.

---

## 3. Estado global: decisión Zustand (vs Context)

**Decisión: Zustand ^5.** Justificación concreta (no genérica):

1. **Frecuencia de escritura del canal WS**: logs llegan en ráfagas (decenas/s) y métricas a 1/s.
   Con Context, cada `set` re-renderiza a *todos* los consumidores del provider (topbar, sidebar,
   metric cards…). Zustand permite **suscripción selectiva por selector**
   (`useJobStore(s => s.status)`) — la tarjeta de tiempo no se re-renderiza por cada línea de log.
2. **Escrituras fuera de React**: `JobSocket.onmessage` escribe con `useJobStore.getState().appendLog(...)`
   sin hooks ni refs acrobáticas; con Context habría que canalizar todo por un dispatch dentro
   del árbol.
3. **Batching de logs**: el store acumula líneas en un buffer intermedio y hace un solo `set`
   cada frame (`requestAnimationFrame` flush) — patrón trivial en Zustand, doloroso en Context.
4. **`persist` middleware** resuelve `telar-variant`, `telar-sidebar-expanded` y
   `telar-last-lesson` (el progreso real vive en el backend, §3.1) con claves estables de
   localStorage.
5. Coste: ~1.2 KB gz. Context queda para lo que es de árbol puro (ninguno en MVP).

### 3.1 Stores

```ts
// themeStore.ts
interface ThemeState {
  variant: 'v1' | 'v2'                    // persist key 'telar-variant', default 'v1'
  setVariant(v: 'v1' | 'v2'): void        // efecto: document.documentElement.dataset.variant = v
}
// NOTA: se unifica el doble mecanismo del prototipo (§2.9 handoff): SOLO data-variant en <html>;
// los selectores '.v2 .xxx' se reescriben como '[data-variant="v2"] .xxx' en styles/ (§5.1).

// sidebarStore.ts
interface SidebarState { expanded: boolean; toggle(): void }   // persist 'telar-sidebar-expanded', default false (colapsado)

// progressStore.ts — el BACKEND es la fuente única del progreso (api-contract §4-§6).
// Este store es una CACHÉ hidratada de GET /modules (progress fusionado) y refrescada tras
// cada PUT /progress y POST /quiz/attempts. En localStorage solo persiste lastLessonId
// (estado de UI: "continuar donde lo dejaste"); TODO lo demás viene del servidor.
interface ProgressState {
  modules: ModuleDto[] | null                                // GET /api/v1/modules (con progress)
  summary: ProgressSummaryDto | null
  lastLessonId: string | null                                // persist 'telar-last-lesson' (solo UI)
  hydrate(): Promise<void>                                   // GET /modules → set
  markViewed(lessonId: string): Promise<void>                // PUT /api/v1/progress/lessons/{id} {viewed:true} → refresca
  applyAttemptResult(r: QuizAttemptResultDto): void          // actualiza caché con la 201 de attempts
  moduleProgress(moduleId: string): { done: number; total: number; pct: number }  // derivado de la caché
}

// jobStore.ts — estado del job activo. `phase` usa el VOCABULARIO EXACTO de api-contract §7.7
// (8 fases) más 3 estados locales del cliente: idle | connecting | lost.
type JobPhase = 'queued' | 'creating' | 'compiling' | 'running'
              | 'completed' | 'failed' | 'timeout' | 'cancelled'      // = contrato
type UiPhase  = 'idle' | 'connecting' | 'lost' | JobPhase
interface JobState {
  jobId: string | null
  phase: UiPhase
  exitCode: number | null                  // de status.detail.exit_code (fase terminal)
  errorDetail: string | null               // de status.detail.error_detail
  startedAt: number | null                 // epoch ms local al recibir phase 'running'
  logs: LogLine[]                          // CAP 1000 líneas (slice(-1000) en cada flush)
  logsTruncated: boolean                   // cap local descartó líneas O eof.truncated del backend
  metrics: MetricSample[]                  // CAP 900 muestras (~15 min a 1/s)
  wsError: string | null
  // acciones llamadas por JobSocket (fuera de React):
  begin(jobId: string): void
  appendLogs(lines: LogLine[]): void       // flush batched por rAF
  appendMetric(m: MetricSample): void
  setPhase(p: UiPhase, detail?: StatusDetailDto | null): void
  reset(): void
}
// Modelos UI derivados 1:1 de los mensajes WS (mapeo en JobSocket, §4.2):
interface LogLine  { seq: number; ts: string; stream: 'stdout' | 'stderr'; text: string }
interface MetricSample { ts: string; cpu_percent: number; online_cpus: number
                         mem_used_bytes: number; mem_limit_bytes: number; pids: number }
```

Datos de servidor sin store: `useSystemInfo`, catálogo (`getModules`) y detalle de job terminado
usan fetch + caché simple a nivel de módulo (promise memoizada). No se añade react-query en MVP.

---

## 4. Canal en tiempo real

### 4.1 `JobSocket` (clase en `ws/jobSocket.ts`)

- URL: el cliente recibe `ws_url` (relativa) en la respuesta 202 de `POST /api/v1/jobs`
  y antepone `WS_BASE` — así el frontend no hardcodea el path.
- Ciclo: `connect()` → `onopen` → `jobStore.setPhase('connecting')` hasta el primer `status`
  (snapshot); `onmessage` → parse + validación de `type` (mensaje desconocido se ignora con
  `console.warn`); `onclose` sin `eof` previo → `phase:'lost'` + reintento con backoff 1s/2s/4s
  (máx 3; los jobs son cortos — el backlog + `seq` cubren lo perdido). `cancel()` envía
  `{"type":"cancel"}`.
- **Job ya terminal al conectar** (F5, historial): el servidor envía `status` terminal + replay
  de mensajes `log` + `eof` y cierra 1000 (NO existe close 4409). El cliente procesa el replay
  igual que el vivo; al ver `status` terminal + `eof` sin haber estado nunca en `running` local,
  el hook redirige a `/resultados/{jobId}` (§6.3).
- **Buffer de logs con cap:** las líneas se acumulan en un array local y se vuelcan a
  `jobStore.appendLogs()` como máximo una vez por `requestAnimationFrame`; el store recorta a
  1000 líneas (`logsTruncated = true` al recortar). El backend además trunca el output total a
  256 KB (`error OUTPUT_TRUNCATED` + `eof.truncated`) — ambos flags se muestran en la UI (§6.3.5).
- **Métricas:** cada `{type:'metrics'}` → `appendMetric` directo (1/s, sin batching).
- El backend soporta N conexiones al mismo job con fan-out (api-contract §8.1): el doble-mount
  de StrictMode es inocuo; aun así el hook cierra la conexión duplicada (§4.3).

### 4.2 Mensajes — TRANSCRIPCIÓN LITERAL de api-contract.md §8.2-8.3

```ts
// ws/messages.ts — espejo del contrato; NO renombrar campos.
interface WsBase { job_id: string; ts: string }                      // ts ISO-8601 UTC
type StatusDetailDto = { exit_code: number|null; oom_killed: boolean; wall_time_ms: number|null
                         output_truncated: boolean; error_detail: string|null }
type ServerMsg =
  | WsBase & { type: 'status';  phase: 'queued'|'creating'|'compiling'|'running'
                                      |'completed'|'failed'|'timeout'|'cancelled'
               detail: StatusDetailDto | null }                      // detail solo en terminales
  | WsBase & { type: 'log';     stream: 'stdout'|'stderr'; lines: string[]; seq: number }
  | WsBase & { type: 'metrics'; cpu_percent: number; online_cpus: number
               mem_used_bytes: number; mem_limit_bytes: number; mem_percent: number
               pids: number; throttled_periods: number }
  | WsBase & { type: 'error';   code: 'OUTPUT_TRUNCATED'|'STREAM_ERROR'|'BAD_CLIENT_MESSAGE'
               message: string }                                     // no cierra la conexión
  | WsBase & { type: 'eof';     total_log_bytes: number; truncated: boolean }
// cliente → servidor
type ClientMsg = { type: 'cancel' }
// cierres: 1000 normal (tras eof) · 4404 job inexistente · 1011 error interno.
// NO existe 4409: "job terminal" = replay + status terminal + eof + close 1000.
```

### 4.3 `useJobSocket(jobId)`

```ts
function useJobSocket(jobId: string | undefined): {
  phase: UiPhase; exitCode: number | null; errorDetail: string | null
  logs: LogLine[]; logsTruncated: boolean
  metrics: MetricSample[]
  elapsedSec: number                    // derivado de startedAt con un tick de 1 s propio
  cancel(): void
}
```
Efecto: crea `JobSocket` al montar con `jobId` definido, `reset()` + `close()` al desmontar o
cambiar de job. Idempotente ante StrictMode (guarda instancia en ref y cierra la duplicada).

---

## 5. Sistema de diseño

### 5.0 Rediseño visual 2026-07 — dirección de MARCA (paleta y tono)

> **Superado en superficie/elevación/layout por §5.0.1 y en COLOR por §5.0.2 (2026-07-25).**
> La paleta teal + naranja de esta sección es **histórica**: la marca vigente es la paleta
> cálida de tierra de §5.0.2. Siguen vigentes la tipografía y el criterio de "un solo acento";
> los valores concretos de `--bg`, bordes, sombras, espaciado y tipografía los fija §5.0.1.

Aprobada por mockup (paleta "Teal de progreso + Naranja de logro"). Receta Coursera/Udemy:

- **Superficie**: fondo neutro clarísimo `--bg #F0FDFA` → **tarjetas blancas** `--surface` que
  "flotan" (borde `--border #E2E8F0` + `--shadow-md`); radios generosos (`--r-lg 16px`).
- **UN acento**: naranja `--accent #CC4A0B` SOLO para CTAs primarios y logro (AA 4.61:1 con
  blanco en ambos sentidos; el naranja vivo `--orange-500 #EA580C` queda para usos UI ≥3:1).
  **Teal** `--primary #0D9488` / `--primary-ink #0F766E` = marca, progreso, chips activos.
- **Texto**: principal `--text #134E4A`; secundario `--text-muted #64748B` (slate); sobre
  superficies teñidas (`--surface-2`, `*-soft`) se usa `--text-muted-strong` (AA 6.6:1).
- **Tipografía**: IBM Plex Sans para toda la UI (jerarquía por tamaño/peso: display-xl 40/700,
  display-lg 27/700, eyebrow 12/600 uppercase teal); JetBrains Mono SOLO datos/código/terminal
  con `tabular-nums`.
- **Espacialidad**: escala 4/8pt en tokens `--sp-1..--sp-10` + semánticos `--screen-pad-x/y`,
  `--section-gap 44px`, `--card-pad 24px`, `--grid-gap 18px` (v2 "compacto" los reduce).
- **Gráficas** (siguen SVG a mano, §8): "de-junkeadas" — 3 líneas de grid sólidas `--viz-grid`,
  ideal punteado `--viz-ideal`, serie protagonista `--viz-observed` con área suave; tokens
  `--viz-*` en tokens.css. Terminal siempre oscuro en familia slate: tokens `--term-*`.
- **Variantes**: `data-variant` en `<html>` se mantiene — v1 "curso" (por defecto) y v2
  "compacto" (denso; mismos colores, spacing/radios/sombras reducidos vía tokens). Dark queda
  definido sin toggle.
- **A11y verificada**: contraste AA auditado sobre páginas renderizadas (0 fallos en 4 rutas),
  `prefers-reduced-motion` global, focus visible `--ring`, cero requests de red (fuentes
  self-hosted), semántica accesible intacta (E2E 15/15 sin tocar la suite).

### 5.0.1 Sistema de LAYOUT RESPONSIVE + ELEVACIÓN (2026-07-25) — VIGENTE

Corrige dos defectos **sistémicos** que afectaban a todas las pantallas. La solución vive en
`styles/tokens.css` (capa *semantic*); los componentes consumen tokens, nunca literales.

**Arquitectura de tokens en 3 capas** (skill `design-system`):
`primitive` (rampas de color — hoy sand/clay/estado, §5.0.2 — y tinta de sombra) → `semantic`
(§2-§6 de tokens.css:
superficies, elevación, layout fluido, tipografía fluida, breakpoints) → `component`
(components.css / screens/*.css).

**D1 · Superficies y elevación** — antes `--bg` era `--slate-50` contra `--surface #FFFFFF`
(1.05:1, invisible), `--shadow-sm` era `0 1px 0 rgba(15,23,42,.04)` y `--shadow-cta: none`.

| Token | Valor | Rol | Contraste vs blanco |
|---|---|---|---|
| `--surface` | `#FFFFFF` | tarjeta y chrome (sidebar, topbar) | — |
| `--surface-2` | `#EFF3F8` | sub-superficie DENTRO de la tarjeta (card-head, hovers, chips) | 1.11:1 |
| `--bg` | `#E8EDF4` | lienzo hundido (`.main`) | **1.18:1** |
| `--surface-3` | `#DFE6EE` | pozos: tracks de progreso, barras | 1.26:1 |

- **Escala de elevación** `--elevation-0..4`: 0 base · 1 tarjeta en reposo · 2 tarjeta
  elevada/hover/destacada · 3 overlay (diálogo, dropdown, savebar) · 4 sobre backdrop.
  `--shadow-sm/md/lg` quedan como alias de 1/2/3 (una sola definición de elevación).
- **`--shadow-cta` RECUPERADA** (estaba en `none`): el botón primario vuelve a elevarse.
- **Bordes con dos pesos**: `--border #CFD8E3` estructural (1.44:1, antes 1.23:1) y
  `--border-strong #8294AA` cuando el borde **es** la affordance —inputs, select, buscador,
  dropzone, opciones de quiz— con **3.10:1 ⇒ WCAG 1.4.11 (UI ≥ 3:1)**.
- `--text-muted` sube a `--slate-600`: sobre el lienzo más oscuro da 6.44:1 (el `--slate-500`
  anterior caía a 4.05:1, por debajo de AA).

**D2 · Layout fluido** — antes: un único breakpoint real (980px), `.screen { max-width: 1280px }`
global y el parche puntual `.screen.learn { max-width: 1680px }`.

- **Contenedor fluido**: `.screen` es `width:100%; max-width: var(--screen-max /*2040px*/);
  margin-inline:auto`. Desaparecen el cap de 1280 y el parche de learn. La **medida de lectura**
  se acota aparte y solo sobre columnas de TEXTO (`--measure: 70ch`, `--measure-narrow: 46ch`).
- **Ritmo y tipografía fluidos con `clamp()`**: `--screen-pad-x/y`, `--section-gap`, `--card-pad`,
  `--grid-gap` y la escala `--fs-2xs … --fs-3xl` (px+vw, independiente del `font-size` raíz, que
  también es fluido: 15px → 16.4px).
- **Grillas adaptativas**: `repeat(auto-fit, minmax(min(100%, var(--col-min-*)), 1fr))` en
  métricas, qcards, pasos, stats y opciones avanzadas. Los `1fr` son `minmax(0,1fr)` y los hijos
  de grid llevan `min-width:0` (sin eso el código `white-space:pre` impide encoger la columna).
- **Container queries** donde el reflow depende del ancho de la PROPIA tarjeta, no del viewport:
  `.results-table` (760px), `.threads-table` (520px), `.cat-module-head` (620px), `.metric-card`
  (210px). Sustituyen a los `@media` de viewport, que fallaban con la tarjeta en columna estrecha.
- **Set único de breakpoints** documentado en tokens.css §6: **640 / 768 / 1024 / 1280 / 1536**,
  enfoque *mobile-first* (`min-width`). Los sueltos 980 / 900 / 800 / 720 quedaron migrados.
- **Objetivos táctiles**: `@media (pointer: coarse)` sube botones, nav e inputs a 44px.

**Variante**: la app quedó fija en v2, así que los dos bloques de tokens duplicados
(`:root` cálido + `:root[data-variant="v2"]`) se **consolidaron en un único `:root`**, y los
overrides `[data-variant="v2"] .x` que solo repetían densidad se fundieron en la regla base.
El atributo `data-variant="v2"` **sigue** en `<html>` (index.html + `stores/themeStore`).

**Gráficas** (siguen SVG a mano, cero librerías — §8): `LiveTopology`/`ThreadTopology`/
`HomeThreadsDiagram` pierden el alto fijo y lo derivan del `viewBox` (con `height` fijo el
dibujo encogía y dejaba franja vertical vacía); `Sparkline` pasa a `width:100%` con
`preserveAspectRatio="none"` + `vector-effect="non-scaling-stroke"`.

**Electron**: `WINDOW_BACKGROUND_COLOR` pasa de `#FDF8EE` (crema de la v1 retirada) a `#E8EDF4`
para seguir a `--bg`, y `minWidth` de la ventana baja de 980 a 640 (= `--bp-sm`).

**Verificación medida** (build en Docker + Playwright):

| Criterio | Resultado |
|---|---|
| Franja muerta a la derecha @1920 | **588px → 0px** (learn 188 → 0) |
| Franja muerta @1440 | **108px → 0px** |
| Scroll horizontal / desbordes @1920·1440·1280·1024·768·375 | **0** en las 5 pantallas + admin |
| Contraste AA del texto renderizado | **508 nodos, 0 incumplimientos** |
| E2E Playwright | **16/16** · Vitest **235/235** · `tsc` limpio |
| Electron (WSLg) | app **1908×972 = viewport exacto**, 0 requests de red externas |

### 5.0.2 PALETA CÁLIDA DE TIERRA (2026-07-25) — VIGENTE en color

Sustituye la marca «teal + naranja» de §5.0 por una paleta de tierra. **Solo cambia el color**:
la arquitectura de tokens de 3 capas, la escala de elevación, el layout fluido y los
breakpoints de §5.0.1 siguen intactos; únicamente cambian los VALORES.

**Los cuatro colores de marca y el papel que puede jugar cada uno** (contraste vs blanco):

| Color | Ratio | Papel permitido |
|---|---|---|
| `#FFDBBB` arena | 1.30:1 | SOLO superficie suave / *highlight*. Nunca texto ni borde con significado |
| `#CCBEB1` taupe | 1.82:1 | SOLO superficie / borde decorativo |
| `#997E67` marrón medio | 3.79:1 | Bordes-*affordance* y UI (≥3:1) y texto GRANDE. **Nunca texto de cuerpo** |
| `#664930` marrón oscuro | 8.20:1 | Texto principal ✅ |

**Primitivas nuevas** (capa *primitive*): rampa `--sand-50…--sand-990` (neutro cálido:
superficies, bordes, texto), rampa `--clay-50…--clay-900` (terracota = extensión saturada de
`#FFDBBB`; es el *hue* interactivo), y las familias de estado `--moss-*` / `--ochre-*` /
`--brick-*` más `--stone-500` / `--steel-*` para gráficas. Las rampas teal/naranja/slate se
retiraron y **no queda ninguna referencia** a ellas.

**Decisiones que exigieron desviarse del mapeo ingenuo** (cada una medida, no estimada):

1. **CTA = terracota `#A8501E`, no `#664930`.** Con el marrón de texto el CTA sería idéntico al
   cuerpo y dejaría de ser el elemento más llamativo. La terracota es el mismo matiz que
   `#FFDBBB` con más croma → armoniza por construcción y es lo único saturado de la pantalla.
2. **`--border-strong` = `#997E67` (3.79:1), no `#CCBEB1` (1.82:1).** Los seis sitios que
   consumen ese token son *affordances* (input, dropzone, `kbd`, thumb de scroll, bordes de
   hover), no decoración: WCAG 1.4.11 exige ≥3:1. `#CCBEB1` vive en `--border-accent`, que sí
   es decorativo (equivale al `--teal-400` anterior, 1.86:1 → 1.82:1).
3. **Enlaces de prosa subrayados.** `--primary-ink` no puede ser `#664930` porque `.markdown a`
   no llevaba subrayado y el enlace quedaría indistinguible del cuerpo. Además, en una paleta
   cálida monocroma **es imposible** cumplir WCAG G183 (3:1 entre enlace y texto) manteniendo
   ambos AA: un enlace con ≥3:1 contra `#664930` necesita luminancia ≥0.334, y entonces baja a
   2.32:1 contra el lienzo. Se añade `text-decoration: underline` como indicador no cromático
   (WCAG 1.4.1). Antes la separación la daba el matiz teal vs slate (~3.2:1).
4. **Estados escalonados por LUMINANCIA**, no solo por matiz: `danger` 7.01 < `success` 5.21 <
   `warn` 3.61 (vs blanco), de forma que se distinguen ≥1.31:1 **entre sí en escala de grises**.
   Matices repartidos: 355° carmín · 43° ocre · 100° oliva (el acento vive en 22°).
5. **Foco al 80 % del acento** (antes `--primary-soft`, 1.15:1 = invisible): el halo efectivo da
   3.71:1 sobre tarjeta, 3.50:1 sobre `--surface-2` y 3.28:1 sobre el lienzo (WCAG 2.4.11).

**Gráficas** (siguen SVG a mano, cero librerías): serie 1 terracota `#A8501E` vs serie 2 azul
acero `#4A83C3`. El par pasa los seis checks del validador de la skill `dataviz`: **ΔE 22.1 en
deuteranopía, 26.9 en tritanopía, 24.9 en visión normal**. La referencia «ideal» se distingue
por color (1.66:1 de luminancia contra la observada) **y** por estilo (punteada 1.6 px `3 4`
frente a sólida 2.3 px con puntos).

**Auditoría de contraste** — medida sobre los valores **renderizados** en la app servida
(`audit-tokens.mjs`), no sobre el archivo. El script comprueba **41 pares por tema**; la tabla
recoge los del tema claro (los 10 restantes son los del foco, los rellenos que se invierten y
las variantes sobre `--surface-2`, relevantes sobre todo en oscuro — ver más abajo):

| Par | Frente | Fondo | Ratio | Umbral | AA |
|---|---|---|---|---|---|
| Texto de cuerpo sobre lienzo | `#664930` | `#F0ECE8` | 6.98:1 | 4.5 | ✅ |
| Texto de cuerpo sobre tarjeta | `#664930` | `#FFFFFF` | 8.20:1 | 4.5 | ✅ |
| Texto atenuado sobre lienzo | `#82664E` | `#F0ECE8` | 4.51:1 | 4.5 | ✅ |
| Texto atenuado sobre tarjeta | `#82664E` | `#FFFFFF` | 5.30:1 | 4.5 | ✅ |
| Texto atenuado fuerte sobre pozo | `#6E5540` | `#E5DED6` | 5.19:1 | 4.5 | ✅ |
| Blanco sobre CTA | `#FFFFFF` | `#A8501E` | 5.48:1 | 4.5 | ✅ |
| Blanco sobre CTA hover | `#FFFFFF` | `#8A431A` | 7.25:1 | 4.5 | ✅ |
| CTA como texto sobre tarjeta | `#A8501E` | `#FFFFFF` | 5.48:1 | 4.5 | ✅ |
| Enlace (`--primary-ink`) sobre lienzo | `#8A431A` | `#F0ECE8` | 6.16:1 | 4.5 | ✅ |
| Enlace (`--primary-ink`) sobre tarjeta | `#8A431A` | `#FFFFFF` | 7.25:1 | 4.5 | ✅ |
| Blanco sobre `--primary-ink` (badge) | `#FFFFFF` | `#8A431A` | 7.25:1 | 4.5 | ✅ |
| Tinta de marca sobre `--primary-soft` | `#8A431A` | `#EDE4DA` | 5.77:1 | 4.5 | ✅ |
| Tinta de acento sobre `--accent-soft` | `#8A431A` | `#FFDBBB` | 5.56:1 | 4.5 | ✅ |
| Borde-*affordance* sobre tarjeta | `#997E67` | `#FFFFFF` | 3.79:1 | 3.0 | ✅ |
| Borde-*affordance* sobre lienzo | `#997E67` | `#F0ECE8` | 3.23:1 | 3.0 | ✅ |
| `--primary` como icono | `#997E67` | `#FFFFFF` | 3.79:1 | 3.0 | ✅ |
| Dot *success* sobre tarjeta | `#4F773B` | `#FFFFFF` | 5.21:1 | 3.0 | ✅ |
| Dot *warn* sobre tarjeta | `#AD7F0C` | `#FFFFFF` | 3.61:1 | 3.0 | ✅ |
| Dot *danger* sobre tarjeta | `#A52B35` | `#FFFFFF` | 7.01:1 | 3.0 | ✅ |
| Blanco sobre *danger* (botón/toast) | `#FFFFFF` | `#A52B35` | 7.01:1 | 4.5 | ✅ |
| Tinta *success* sobre su chip | `#406130` | `#E1EDDB` | 5.84:1 | 4.5 | ✅ |
| Tinta *warn* sobre su chip | `#8A650A` | `#F9EED2` | 4.61:1 | 4.5 | ✅ |
| Tinta *danger* sobre su chip | `#85222A` | `#F5D9DB` | 7.01:1 | 4.5 | ✅ |
| Icono *warn* sobre su chip | `#AD7F0C` | `#F9EED2` | 3.13:1 | 3.0 | ✅ |
| Serie 1 de gráfica sobre tarjeta | `#A8501E` | `#FFFFFF` | 5.48:1 | 3.0 | ✅ |
| Serie 2 de gráfica sobre tarjeta | `#4A83C3` | `#FFFFFF` | 3.94:1 | 3.0 | ✅ |
| Referencia «ideal» sobre tarjeta | `#998B7E` | `#FFFFFF` | 3.31:1 | 3.0 | ✅ |
| Etiqueta de eje (es texto) | `#6E5540` | `#FFFFFF` | 6.92:1 | 4.5 | ✅ |
| Texto de terminal | `#EDE2D6` | `#150F0C` | 14.88:1 | 4.5 | ✅ |
| Texto atenuado de terminal | `#B29B85` | `#150F0C` | 7.16:1 | 4.5 | ✅ |
| Acento de terminal (verde de log) | `#6AAF48` | `#150F0C` | 7.09:1 | 4.5 | ✅ |

Separación en **escala de grises** entre estados (objetivo ≥1.30:1): *success* vs *warn*
1.44 base / 1.33 tinta · *success* vs *danger* 1.35 / 1.31 · *warn* vs *danger* 1.94 / 1.75.
Serie observada vs ideal: 1.66:1.

**Terminal y modo oscuro** reescritos en clave cálida (marrón carbón `--sand-975`, sin restos
teal). El acento de la terminal se mantiene **verde** (`--moss-400`, 7.09:1) porque en un log el
verde es semántico, no decorativo: lo cálido es el panel, no el prompt.

#### Tokens que se DESDOBLARON por el tema oscuro

El bloque `[data-theme="dark"]` no tiene *toggle* en el MVP, así que ningún E2E lo cubre: es
donde más fácil se cuela un fallo. Auditarlo (`audit-tokens.mjs … dark`) destapó que **un mismo
token no puede servir a la vez de RELLENO con blanco encima y de TINTA de texto** cuando el tema
invierte las luminancias. Es aritmético: en oscuro, texto ≥4.5:1 sobre `--surface` exige
luminancia ≥0.226 y blanco encima ≥4.5:1 exige ≤0.183 — bandas disjuntas. De ahí dos tokens
nuevos, ambos **sin efecto visual en claro**:

| Token | Claro | Oscuro | Por qué existe |
|---|---|---|---|
| `--accent-ink` | `--clay-700` | `--clay-300` | Texto/icono de acento. `--accent` queda como RELLENO (CTA, con blanco encima) |
| `--on-inverse` | `#FFFFFF` | `--sand-975` | Tinta de los rellenos cuyo fondo se invierte con el tema (`--text`, `--primary-ink`, `--success-ink` como fondo de badge/pill) |

Además se redefinen en oscuro los tokens que caían por debajo de 3:1 contra las superficies
oscuras: `--ring` (2.76 → 3.30), `--success` (2.91 → 5.65), `--danger` (2.16 → 3.20, con
`--brick-400` elegido en la *banda doble* que además mantiene blanco encima a 4.73:1),
`--viz-observed`/`--viz-cpu`/`--viz-packet` (2.76 → 4.41), `--viz-node-warn` (2.85 → 3.22) y
`--viz-ideal` (que con `--sand-500` solo separaba 1.11:1 de la serie 1 → `--sand-450`, 1.39:1 y
la más tenue de las tres series). `--warn` **no** se redefine: el ocre ya da 4.20:1 en oscuro.

**Electron**: `WINDOW_BACKGROUND_COLOR` pasa de `#E8EDF4` a `#F0ECE8` para seguir a `--bg`.

**Verificación medida** (`docs/assets/paleta-calida-2026-07-25/audit-tokens.mjs`, que mide los
valores **renderizados** en la app servida y se ejecuta una vez por tema):

| Criterio | Resultado |
|---|---|
| Tokens declarados que resuelven en el navegador | **169/169** (0 vacíos), en ambos temas |
| Pares de contraste auditados — tema **claro** | **41/41 AA** |
| Pares de contraste auditados — tema **oscuro** | **41/41 AA** |
| Separación en gris de los estados (claro / oscuro) | ≥1.31:1 / ≥1.31:1 |
| Validador `dataviz` del par de series categóricas | **6/6 checks PASS** |
| Hex sueltos fuera de `tokens.css` | **0** (los dots mac pasan a `--term-dot-*`) |
| Referencias a primitivas retiradas (teal/naranja/slate) | **0** |
| E2E Playwright | **16/16** · Vitest **235/235** · `tsc` limpio (frontend y desktop) |
| Electron (WSLg) | `--bg #F0ECE8`, `--accent #A8501E`; 0 requests de red externas |

Capturas antes/después de las 6 pantallas —incluida una **ejecución en vivo** del simulador— y
de Electron en `docs/assets/paleta-calida-2026-07-25/`.

### 5.1 Port de tokens y variantes *(histórico — superado por §5.0/§5.0.1 en lo visual)*

- `styles/tokens.css` porta **literales** los bloques §1.2 (paleta v1), §1.3 (radios/sombras/
  `--ease`), §1.4 (`[data-theme="dark"]` — se conserva definido, sin toggle en MVP) y §1.5
  (tokens v2) del handoff. Los colores hardcodeados de §1.6 (terminal, gradientes de nodos,
  tags) se mantienen hardcodeados donde el handoff los hardcodea (el terminal es oscuro en
  ambas variantes: correcto no tokenizarlo).
- **Unificación de la conmutación de variante** (corrige el doble mecanismo): único atributo
  `data-variant` en `<html>`; TODOS los selectores `.v2 .xxx` del prototipo se reescriben como
  `[data-variant="v2"] .xxx`. Desaparece la clase `v2` en `.app`.
- Nuevos tokens para corregir bugs: `--success: var(--green-500);` en v1 y v2.

### 5.2 Correcciones de los 4 bugs CSS del prototipo (handoff §14)

1. **`.home .hero`**: se implementa el grid intencional `grid-template-columns: 1.15fr 1fr`
   (la regla que el comentario `//` inválido mataba). *(Actualizado en §5.0.1: el hero es
   mobile-first —1 columna— y pasa a `minmax(0,1.15fr) minmax(0,1fr)` desde `--bp-lg`; el
   diagrama fork-join NO se oculta, es el visual educativo central.)*
2. **Bloque huérfano `.hero-stats`**: no se porta (código muerto); se elimina junto con
   `.tutorial-panel`, `.tut-visual`, `TutVisualUpload/Cluster`.
3. **`.v2 .app { grid-template-columns: 52px 1fr }`**: con la unificación el rail v2 **sí
   aplica**. *(Actualizado en §5.0.1: al quedar v2 como única variante, el rail se declara en la
   regla base `.app { --sidebar-w: 56px }` —56 px, para que el ítem de nav llegue a 40 px— y
   sube a 44 px de objetivo táctil bajo `@media (pointer: coarse)`.)*
4. **`var(--ink)`** en `.fpill.active` v2 → `var(--text)`. **`var(--success)`** en `· Completado`
   → token nuevo `--success` (§5.1).

Además (bugs funcionales del handoff §14): la inconsistencia w2/w3 desaparece porque el nodo
idle decorativo se parametriza (§5.3); "Pausar" se ELIMINA del header live (no se puede pausar
un contenedor de forma didácticamente honesta; queda "Detener" = cancel); el `mode-switch` v2
no se implementa (decisión: eliminar, handoff §11.10).

### 5.3 Animaciones: qué se conserva y de dónde salen los datos

Inventario del handoff §10 con destino:

| Animación | Se conserva | Datos |
|---|---|---|
| `@keyframes pulse` (status-dot, now-dot) | Sí | CSS puro |
| Colapso sidebar `.22s` + tooltips | Sí | CSS + sidebarStore |
| SMIL del hero (`HomeThreadsDiagram`) | Sí, portado tal cual (atributos SMIL válidos en TSX); se elimina el `setInterval` 900 ms redundante | decorativo |
| LiveTopology: paquetes ida/vuelta, halo del head | Sí (reinterpretada §5.4) | decorativo (`useSimulation`) |
| Auto-scroll del terminal | Sí (ref + `scrollTop = scrollHeight`; se pausa si el usuario scrollea hacia arriba, con botón "↓ seguir salida") | logs reales |
| Transiciones width de `.metric-progress`, `.mini-bar-fill`, `.bar` | Sí | métricas reales |
| Hovers (qcard, tut-tab, play 1.06, chevrons 90°) | Sí | CSS |
| Tick 700 ms de "simulación" | Solo como **motor decorativo** (`useSimulation`) | decorativo |

**`useSimulation` (SOLO decorativo).** El prototipo simulaba todo; en producción los datos
reales vienen del WS. `useSimulation` queda reducido a alimentar la parte *ilustrativa* de
`LiveTopology` mientras el job corre:

```ts
function useSimulation(opts: { threads: number; running: boolean; reducedMotion: boolean }): {
  nodes: DecorNode[]      // maestro + t0..t{n-1}: actividad 0..1 con jitter por tick 700 ms
}
// - NO genera logs ni métricas ni progreso (eso es del WS).
// - Con reducedMotion: sin tick, nodos estáticos, sin paquetes SMIL.
// - running=false (job terminado): congela el último estado.
```

**`prefers-reduced-motion`**: regla CSS global que desactiva `pulse` y transiciones decorativas
(`@media (prefers-reduced-motion: reduce) { .status-dot, .now-dot { animation: none } ... }`) y
`useReducedMotion` para suprimir los `<animate>/<animateMotion>` SMIL (render condicional) y el
smooth-scroll. El handoff no lo contemplaba; aquí es requisito.

### 5.4 `LiveTopology` reinterpretada: hilo maestro + hilos del proceso

Misma geometría SVG del handoff §5.7 (viewBox 800×280, rombos, codos, dashes, gradientes
`lg-h/lg-w/lg-warn`), nueva semántica:

- Rombo superior = **hilo maestro** (`master`), etiqueta interior `master` (antes `head`).
- Fila inferior = **hilos del equipo** `t0..t{N-1}` con N = hilos del job (antes workers).
- Paquetes naranjas ida / verdes vuelta = **accesos a memoria compartida / sincronizaciones**
  (decorativo, honesto: la card lleva sub-etiqueta `mono-small` `representación didáctica del
  fork-join`).
- Etiqueta bajo cada hilo: `t{i} · activo` alimentada por `useSimulation` (sin % de CPU por hilo:
  no tenemos esa medida real y no se inventa).
- El estado *warning/idle* del prototipo (nodo idle a partir del tick 9) NO se porta como
  comportamiento fijo: solo se muestra si el ejemplo lo justifica (no hay fuente real por-hilo
  en MVP → se elimina el warn-banner del live; las observaciones de resultados §6.4 cubren la
  didáctica del desbalance con datos reales de los ejemplos que barren hilos).
- La metáfora maestro-arriba/hilos-abajo del handoff encaja con fork-join (handoff §13, nota final).

### 5.5 Fuentes e iconos

- **Rediseño 2026-07**: `@fontsource/ibm-plex-sans` (400/500/600/700) +
  `@fontsource/jetbrains-mono` (400/500/600/700). Imports en `main.tsx`; cero requests de red
  (requisito CSP del desktop). *(Histórico: Fraunces + Instrument Sans, retiradas.)*
- Los **29 iconos** de `icons.jsx` se portan literalmente a `components/icons/icons.tsx`
  (wrapper `Icon` con `size=18 stroke=1.75` + un named export por icono, paths idénticos).
  No se usa lucide-react: pixel-perfect manda. Los 4 iconos no usados (`IconMemory`,
  `IconServer`, `IconUser`, `IconPlus`) se portan igualmente (IconMemory se usará en la métrica
  de memoria, §6.3).

---

## 6. Pantallas

Convención de estados en TODAS las pantallas con datos remotos:
- **Carga**: `Skeleton` con la silueta del layout (sin spinners globales).
- **Error**: `ErrorState` (card con IconAlert, mensaje amable + detalle técnico colapsado +
  botón `Reintentar`). El error de red típico en desktop es "backend caído" → CTA adicional
  `Revisar servicios Docker` (→ RuntimeFooter, §6.7).
- **Vacío**: `EmptyState` específico por pantalla (texto indicado en cada sección).

### 6.0 Adaptación MPI→OpenMP — textos globales (aplicación de la tabla §13 del handoff)

Literales nuevos que aplican a varias pantallas (los específicos van en cada pantalla):

| Ubicación | Texto nuevo (exacto) |
|---|---|
| `<title>` | `Telar — Simulador educativo de OpenMP` |
| Sidebar brand-sub | `v1.0 · local` |
| Sidebar footer (web) | `Backend Telar` / `conectado · {cores} núcleos` |
| Sidebar footer (desktop) | `Docker runtime` / `{n} contenedores activos` (§6.7) |
| Topbar usuario | avatar `ES` + `estudiante` (sin auth en MVP) |
| Selector de framework | fijo `OpenMP · PyOMP`; opciones `MPI (mpirun)` y `Slurm (sbatch)` presentes pero `disabled` con sufijo ` — próximamente` |

### 6.1 Home (`/`)

**Componentes:** `HomeScreen` → hero (`HomeThreadsDiagram`), `TutorialTabs`, `TutorialCallout`,
`QuickCard`×3, `RecentJobs`, `SuggestedLessons`.

**Textos exactos (adaptados):**
- Eyebrow `Bienvenido de vuelta`; H1: `Aprende programación paralela` ⏎ `sin un supercomputador.`
- Sub: `Ejecutamos tu código OpenMP real en tu computadora, aislado en contenedores Docker.
  Escribe código, elige cuántos hilos, ejecútalo — y aprende por qué acelera (o por qué no).`
- Botones: primary-xl [IconZap] `Empezar ejecución` → `/simulador` · outline-xl [IconBook]
  `Explorar lecciones` → `/cursos`.
- Caption del diagrama: chip-orange `omp parallel` + mono-small `4 hilos · fork-join`.
- Tut-tabs: 01 IconUpload `Elige o sube tu código` / `Un ejemplo del curso o tu archivo .py.` ·
  02 IconCpu `Configura los hilos` / `Decide cuántos hilos quieres.` · 03 IconPlay
  `Ejecuta y aprende` / `Observa la salida y las métricas en vivo.`
- Callout: `¿Primera vez aquí?` / `Te recomendamos empezar por la lección "¿Qué es el
  paralelismo?" — te da todo el contexto para entender qué estás ejecutando.` + botón
  `Ver lección` → `/cursos/primerEjemplo`. **Regla**: todas las rutas `/cursos/:leccionId`
  usan los IDs LITERALES del catálogo (camelCase, = nombre de carpeta) — jamás slugificar.
- QuickCards: orange IconCpu `Configurar una ejecución` / `Elige un ejemplo del curso, define
  los hilos y ejecútalo en un contenedor aislado.` CTA `Configurar` → `/simulador` · green
  IconPlay `Ver ejecución en vivo` / `Observa la salida, el CPU y la memoria de tu código en
  tiempo real.` CTA `Abrir monitor` → `/simulador` · blue IconBook `Continuar aprendiendo` /
  texto dinámico `Retomas en: {título}. {quizzesRestantes} quizzes pendientes en tu módulo.`
  CTA `Continuar` → `/cursos/{lastLessonId}` (si no hay progreso: `Empieza por: ¿Qué es el
  paralelismo?`).
- `HomeThreadsDiagram`: mismo SVG del handoff §4.4 con labels `master` y `t0..t3` (antes
  head-node/w0..w3).

**Datos que consume:**
- `GET /api/v1/jobs?limit=3` → jobs recientes. Shape del contrato (§7.3): envelope con
  `data.jobs[]` de `{job_id, filename, source_kind, example_id, lesson_id, status, exit_code,
  threads, wall_time_ms, created_at, finished_at}`.
  Render: mono `{filename}` · chips por `status` según la tabla de mapeo de §6.3:
  `completed` → chip-green `OK`; `queued/creating/compiling/running` → chip-orange `EN VIVO`;
  `failed`/`timeout` → chip-red `ERROR`; `cancelled` → chip-amber `Cancelado` ·
  detalle `{threads} hilos · {fmtTime(wall_time_ms)}` · relativo `hace 5 min`.
  Fila → `/resultados/{job_id}` (o `/simulador/{job_id}` si no-terminal).
  **Vacío**: `Aún no has ejecutado nada. Lanza tu primera ejecución →` (link a `/simulador`).
- `GET /api/v1/modules` (compartido con catálogo, §6.5) → 3 lecciones sugeridas usando el
  `progress` FUSIONADO que devuelve el propio endpoint (la primera con `viewed && !completed`
  + 2 siguientes no completadas). Vacío imposible (contenido estático del backend).
- `useSystemInfo` para el footer del sidebar.

### 6.2 Simulador — idle (`/simulador`)

**Componentes:** `SimulatorScreen(idle)` → `ConfigPanel` (grid 1fr 1fr): `CodePanel` (izq),
card de ejecución (der: `ExamplePicker` + `ThreadTopology` + `ThreadsField`), card
`Opciones avanzadas` (abajo).

**Header:** eyebrow `Simulador`; H2 `Configura y lanza tu ejecución`; párrafo: `Elige un ejemplo
del curso o sube tu código, decide cuántos hilos y pulsa **Lanzar ejecución**. Tu código corre
aislado en un contenedor Docker efímero de tu máquina.` Acciones: select de ejemplo compacto
(reemplaza a `Cargar preset`) · primary-lg [IconPlay] `Lanzar ejecución`.

**Card "Tu código"** (`CodePanel`): head IconCode `Tu código` + card-sub `{filename}`.
- Dropzone literal del handoff con `accept=".py"` y textos: `Arrastra tu archivo aquí` /
  `.py · máx 256 KB` / botón `O selecciónalo`. Validación client-side: extensión `.py`, tamaño
  ≤ 262 144 bytes, decode UTF-8 (FileReader) — errores en `field-hint` rojo (`Solo archivos .py`,
  `El archivo supera 256 KB`, `El archivo no es texto UTF-8`).
- Preview (mismo estilo terminal §5.3 handoff): head `{filename}` + chip-orange `Python · OpenMP`;
  body editable: `<textarea class="code-editor">` (mono 11.5px sobre #14100C, sin resaltado en
  MVP). Al elegir ejemplo, se carga su `source_code`; editarlo marca `modificado` (chip-amber)
  y cambia el payload de lanzamiento a `example_id`+`code` (ver Lanzar).
- El contenido default (sin selección) es el código real de `helloOpenMP.py` (viene de la API,
  no se hardcodea `SAMPLE_CODE`).

**Card derecha "Reparto de trabajo"** (antes `Topología del cluster`):
- `ThreadTopology`: SVG estático del handoff §5.4 con labels `master` / `t{i}`; el tamaño de los
  rombos ya no depende de `% cómputo` (control eliminado, ver abajo) sino que es fijo (36 px).
- `ThreadsField` (§9): label `Cantidad de hilos` + mono-small `{n} hilos` + slider
  `min=1 max={cores}` + hint `Más hilos = más paralelismo, pero también más overhead de
  sincronización.`
- Los sliders `% cómputo por worker` / `% cómputo del head` y la `allocation-bar` **se
  eliminan**: no existe un equivalente honesto en OpenMP (no se reparte % de cómputo a mano).
  En su lugar, fila informativa: mono-small `Núcleos del host` + chip `{cores} disponibles` y
  chip-verde/ámbar `--cpus = {n}` explicando que el contenedor se limita a N CPUs.

**Card "Opciones avanzadas"** (adv-grid 3 col):

| Label | Control | Valores |
|---|---|---|
| `Framework` | select | `OpenMP · PyOMP` (fijo) · `MPI (mpirun) — próximamente` disabled · `Slurm (sbatch) — próximamente` disabled |
| `Entorno de ejecución` | readonly | `telar-runner · python 3.12 + pyomp 0.5.1` (de `data.versions` de `GET /api/v1/system`) |
| `Timeout` | select | construido DINÁMICAMENTE desde `data.limits.max_timeout_s`: `30 s` · `60 s` (default o el `default_timeout_s` del ejemplo) · `120 s (límite del backend)`. Jamás ofrecer valores > `max_timeout_s` (el backend valida 5..120 → 422) |

**Precarga por query param:** al montar, si existe `?ejemplo={id}` (navegación desde Learn,
§6.6, o desde `Re-ejecutar` de resultados), seleccionar ese ejemplo en el picker y cargar su
código vía `GET /api/v1/examples/{id}`.

**Datos que consume** (shapes = api-contract.md §2.2, §3, §7.1 — envelope y snake_case):
- `GET /api/v1/modules` → picker de ejemplos agrupado por módulo (deshabilitando
  `enabled:false`, i.e. `sumaVectoresGPU` salvo `gpu_examples_enabled` de `/system`).
- `GET /api/v1/examples/{id}` al seleccionar → `data` con `source_code`, `filename`,
  `threads_configurable`, `fixed_threads`, `fixed_threads_note`, `sweeps_threads`,
  `self_measures`, `parser_id`, `default_timeout_s`, `est_run_seconds`, `enabled`,
  `requires_gpu`, `lesson_id`, `takeaways`, `expected_output_note` (§3.2 del contrato —
  SIN quiz: el quiz vive en `GET /api/v1/lessons/{id}/quiz`, §6.6).
- `GET /api/v1/system` → `data`: `{cores, max_threads, runner_image, runner_image_present,
  gpu_examples_enabled, versions{...}, limits{max_code_bytes, max_timeout_s,
  max_concurrent_jobs, max_output_bytes}}`.
- **Lanzar** — `POST /api/v1/jobs` según la semántica de fuentes del contrato (§7.1):
  - Ejemplo SIN editar → `{ "example_id":"spmd", "lesson_id":"spmd", "timeout_s":60 }`
    (sin `code`; `threads` se OMITE si `threads_configurable=false`, §9).
  - Ejemplo EDITADO → `{ "example_id":"spmd", "code":"<texto editado>", "lesson_id":"spmd",
    "threads":4, "timeout_s":60 }` (se ejecuta `code`; `example_id` conserva el parser).
  - Código propio (upload/editor en blanco) → `{ "code":"...", "filename":"mi.py",
    "threads":4, "timeout_s":60 }`.
  - `lesson_id` se envía siempre que la sesión venga de una lección (`?ejemplo=` o picker con
    lección asociada) — alimenta `lesson_progress.last_job_id`.

  Respuesta `202` (envelope): `data = { job_id, status:"queued", threads_effective,
  threads_note, ws_url, href, created_at }` → mostrar `threads_note` si no es null (toast) y
  `navigate('/simulador/{job_id}')`. Subida de archivo alternativa: `POST /api/v1/jobs/upload`
  multipart (validado por chunks en backend).
- **Errores** (envelope `error.code`): `413 CODE_TOO_LARGE`, `422 VALIDATION_ERROR`,
  `409 EXAMPLE_DISABLED`, `429 TOO_MANY_JOBS`, `503 DOCKER_UNAVAILABLE` /
  `503 RUNNER_IMAGE_MISSING` → banner con CTA `Ver instrucciones`; red caída → ErrorState.

### 6.3 Simulador — live (`/simulador/:jobId`)

**Componentes:** `LiveHeader`, `LiveMetricsRow`, `.running-grid` (1.3fr 1fr): `LiveNodesCard`
(LiveTopology decorativa) + `LiveTerminalCard` (datos reales), `ThreadsTable` abajo.

**Header:** eyebrow `Ejecución en vivo`; H2 `{filename}`; chip de estado con dot pulsante según
la **tabla de mapeo fase→chip** (única en toda la app — Home y ResultsList reutilizan la parte
terminal):

| `phase` (contrato §7.7 + locales) | Chip | Color |
|---|---|---|
| `idle` / `connecting` | `Conectando…` | chip neutro |
| `queued` / `creating` | `Preparando` | chip-orange, dot pulsante |
| `compiling` | `Compilando (JIT)` | chip-orange, dot pulsante |
| `running` | `Ejecutando` | chip-green, dot pulsante |
| `completed` | `Finalizado` | chip-green |
| `failed` | `Error` | chip-red |
| `timeout` | `Timeout` | chip-red |
| `cancelled` | `Cancelado` | chip-amber |
| `lost` | `Conexión perdida` | chip-red |

mono-small `job #{id} · {threads} hilos · OpenMP · PyOMP`. Acciones: outline [IconStop]
`Detener` → `cancel()` con confirm inline (**sin** botón Pausar, §5.2) · primary
`Ver resultados` [IconArrowRight] → `/resultados/{jobId}` (habilitado al terminar; durante la
ejecución muestra outline disabled).

**`LiveMetricsRow`** — 4 `MetricCard`, todas con datos REALES:

| Icono | Label | Value | Hint |
|---|---|---|---|
| IconClock | `Tiempo transcurrido` | `fmtTime(elapsedSec)` | `límite {timeout_s}s` |
| IconCpu | `CPU del contenedor` | `{últimaMuestra.cpu_percent}%` (puede superar 100: N hilos ≈ N·100) | mini `Sparkline` de las últimas 60 muestras, **escala `max = threads_effective·100`** (§8.1) |
| IconMemory | `Memoria` | `{fmtBytes(mem_used_bytes)}` | `de {fmtBytes(mem_limit_bytes)} · barra .metric-progress` |
| IconZap | `Hilos` | `{threads}` | `de {cores} núcleos` (o `barrido 1/2/4/8` si `sweeps_threads`) |

Nota: la métrica `Sincronizaciones` del handoff (§13) NO va en esta fila porque no existe una
medida real por-hilo; el término se usa en los textos didácticos (qcard 2, hint del slider,
observaciones) y en la leyenda decorativa de `LiveTopology`. **La UI no muestra números
inventados.**

**`LiveNodesCard`:** head IconCluster `Hilos en vivo` + mono-small derecha `{threads} hilos ·
1 contenedor`. Contiene `LiveTopology` (§5.4) alimentada por `useSimulation`. Pie de card:
mono-small muted `Animación ilustrativa del modelo fork-join — la salida real está a la derecha.`

**`LiveTerminalCard`:** terminal del handoff con header dots + título
`docker logs -f telar-job-{id} · en vivo`. Cuerpo: `logs` reales del WS con formato
`<span class="term-dim">[{HH:MM:SS}]</span> <span class="{stderr→term-red:term-green}">{stream}</span> <span>{text}</span>`.
Estado vacío (antes del primer log), **dirigido por la fase del WS — sin heurísticas de
tiempo**: `phase=creating` → `term-dim` `Creando contenedor…`; `phase=compiling` →
`Compilando con Numba (la primera vez tarda unos segundos)…` (el backend emite `compiling`
exactamente para cubrir el silencio del JIT; explicar la espera es parte de la didáctica).
Auto-scroll con pausa por scroll manual (§5.3). Si `logsTruncated`:
línea fija `term-amber` `— salida truncada (límite 256 KB) —`.

**`ThreadsTable` "Detalle por hilo"** — honesto con lo medible:
columnas `Hilo` · `Rol` · `Actividad` (decorativa, MiniBar de useSimulation con sub-etiqueta
`ilustrativa`) · `Estado` (chip-green `activo` mientras running). Para ejemplos `sweep`, esta
card se sustituye por `SweepProgressCard`: lista `hilos = 1 · ✓ 0.726 s`, `hilos = 2 · …`
parseada en vivo de los logs usando EXACTAMENTE los regex de **`architecture.md` §7.2**
(parseo presentacional; el `parsed_timings` autoritativo sigue siendo del backend, decisión 8)
— datos 100 % reales y más útiles didácticamente.

**Datos:** `useJobSocket(jobId)` (todo el live) + `GET /api/v1/jobs/{jobId}` al montar (para
recuperar filename/threads/example al llegar por URL directa; los logs perdidos los cubre el
backlog que el WS reenvía al conectar — api-contract §8.1).
**Estados:** jobId inexistente (WS close 4404 o GET 404) → ErrorState `Este job no existe o fue
limpiado` + CTA `/simulador`. Job ya terminal al conectar (replay + `status` terminal + `eof` +
close 1000, §4.1) → redirect a `/resultados/{jobId}`. `lost` → banner rojo con
`Reintentar conexión`.

### 6.4 Resultados (`/resultados/:jobId`, historial en `/resultados`)

**`ResultsList` (`/resultados`)**: tabla de `GET /api/v1/jobs?limit=50` con las columnas de
RecentJobs (chips terminales de la tabla §6.3) + botón `Ver` → detalle. Vacío: mismo EmptyState
de Home.

**`ResultsScreen` — header:** eyebrow `Job completado`; H2 `Resultados · {filename}`;
chips por `status`: `completed` → chip-green [IconCheck] `Exit 0 · éxito`; `failed` → chip-red
`Exit {exit_code} · error` (o `OOM` si `oom_killed`); `cancelled` → chip-amber `Cancelado`;
`timeout` → chip-red `Timeout ({timeout_s}s)`. mono-small
`job #{job_id} · completado en {fmtTime(wall_time_ms)} · {threads} hilos`. Acciones: outline
[IconDownload] `Descargar output` → `GET /api/v1/jobs/{id}/output` (link/descarga directa; el
backend pone el Content-Disposition) · outline `Re-ejecutar` → `/simulador?ejemplo={example_id}`
(o con el código del job precargado si `source_kind≠example`) · primary `Siguiente lección`
[IconArrowRight] → `/cursos/{next_lesson_id}` (de `GET /lessons/{lesson_id}` si el job tiene
lección asociada; sin lección, el botón se oculta).

**Métricas (4 `MetricCard`)** — los agregados salen de `metrics_summary` (persistido), NUNCA de
una serie que el backend no guarda:

| Icono | Label | Value | Hint | Fuente |
|---|---|---|---|---|
| IconClock | `Tiempo total` | `{fmtTime(wall_time_ms)}` | `incluye compilación JIT` | `data.wall_time_ms` |
| IconZap | `Speedup observado` | de `parsed_timings`: kind `sweep` → `max(series[].speedup)×`; kind `pair` → `{speedup_vs_reference}×`; si `null`: `—` | `eficiencia {pct}%` o `este ejemplo no auto-mide` | `data.parsed_timings` |
| IconCpu | `CPU promedio` | `{metrics_summary.cpu_percent_avg}%` | `pico {cpu_percent_max}%` | `data.metrics_summary` |
| IconMemory | `Memoria pico` | `{fmtBytes(metrics_summary.mem_used_bytes_max)}` | `límite {fmtBytes(mem_limit_bytes)}` | `data.metrics_summary` |

**`.two-col`:**
- **Card `Distribución del trabajo`** — por `parsed_timings.kind`:
  - `sweep` (piSpmd, piSpmdCritical, transporteMonteCarlo): **`SpeedupChart`** (§8.2) con
    `series[]` real 1/2/4/8 (el backend ya entrega `speedup`/`efficiency` calculados).
  - `pair` (sumaVectores, matrices, stencilCalor): `ComparisonBars` (§8.3) — barras
    `OpenMP {parallel_time_s}s` vs `{reference_label} {reference_time_s}s`.
  - `parsed_timings=null` (8 de 14 ejemplos): si se llegó DIRECTAMENTE del live y
    `jobStore.metrics` sigue en memoria → `LiveMetricsChart` (§8.4) con esa serie; desde el
    historial o tras F5 (sin serie: el backend NO persiste muestras, decisión data-model §3)
    → la card degrada a un resumen estático de `metrics_summary` (CPU avg/max, memoria pico,
    pids) con nota `las gráficas en vivo solo están disponibles durante la ejecución`.
- **Card `Observaciones`** (head IconAlert): generadas en frontend por `lib/observations.ts`,
  motor de reglas sobre `parsed_timings` + metadata del ejemplo. Reglas iniciales (tipos
  obs-warn/ok/info del handoff):
  - sweep con speedup < 1.5× a 8 hilos → warn `**Casi no hay speedup.**` + texto didáctico del
    ejemplo (para spmd: `No es un bug: las casillas de partial comparten línea de caché —
    false sharing. Compara con spmdCritical.`) — plantillas por example_id en el contenido.
  - sweep con speedup ≥ 0.8·N → ok `**Escala casi lineal.** Este problema es compute-bound…`
  - `parsed_timings.correct === true` → ok `**Resultado validado.**` (p. ej. `correcto? True`).
  - status `failed` → warn con las últimas 3 líneas de `stderr`.
  - info Amdahl **solo cuando la referencia es una versión serial del MISMO código**: en un
    `sweep` (el speedup es t(1)/t(n) del mismo código) y en un `pair` con
    `parser_id: pair_parallel_serial` → `**Speedup {s}× con {n} hilos.** La ley de Amdahl
    predice…` (`lib/speedup.ts`, `lib/observations.ts`). Con `parser_id: pair_openmp_numpy` /
    `pair_openmp_blas` la referencia es OTRA implementación (NumPy/BLAS), no el escalado
    t(1)/t(n) del mismo código: **NO se invierte Amdahl** — se muestra una observación honesta
    de comparación directa (invertirla fabricaba un "% paralelizable" falso — **BL-30**).
    Fallback a "Comparación directa" cuando el speedup no es derivable (p. ej. 1 hilo).
- **Card `Output`** (mt 20): head IconTerminal `Output (stdout · {n} líneas)` + ghost
  [IconDownload] `descargar` (mismo endpoint `/output`). Terminal sin dots con `data.stdout`
  completo (scroll interno); si `output_truncated`: banner ámbar `Salida truncada a 256 KB`.

**Datos:** `GET /api/v1/jobs/{jobId}` — shape EXACTO de api-contract §7.4 (envelope; campos
`job_id, filename, source_kind, example_id, lesson_id, source_code, status, exit_code,
oom_killed, error_detail, threads, timeout_s, created_at, started_at, finished_at,
wall_time_ms, stdout, stderr, output_truncated, metrics_summary, parsed_timings`).
El **parser de stdout vive en el backend** (una sola fuente de verdad); el frontend solo
consume `parsed_timings`. **Estados:** 404 → ErrorState; job aún no terminal → redirect a
`/simulador/{jobId}`; `parsed_timings=null` → cards degradan como se indicó.

### 6.5 Catálogo (`/cursos`)

**Componentes:** `CatalogScreen` → header + `ContinueCard`, `CatalogStats`, `CatalogToolbar`,
`ModuleAccordion`×8.

**Textos:** eyebrow `ZINE · Aprendizaje`; H2 `Catálogo de contenidos`; párrafo `Las lecciones y
quizzes del curso de OpenMP con PyOMP, organizados en 8 módulos. Cada lección se ejecuta de
verdad en el simulador.` ContinueCard: eyebrow `Continuar donde lo dejaste` + título de
`progressStore.lastLessonId` + meta `[IconLayers] {módulo} · [IconPlay] ~{est_run_seconds}s` +
botón `Reanudar`. Sin progreso: título `¿Qué es el paralelismo?` y botón `Empezar`.

**Stats** (computadas, no hardcodeadas): `Lecciones completadas {done}/{14}`, `Ejemplos {14}`,
`Quizzes {14}`, `Módulos {8}`.

**Toolbar:** búsqueda `Buscar lección, quiz o tema...` (filtra por título de lección y módulo) +
fpills `Todo {28}` · [IconPlay] `Ejemplos {14}` · [IconHelp] `Quizzes {14}` (cada lección aporta
1 ejemplo + 1 quiz al conteo; el filtro muestra/oculta las filas de quiz).

**Módulos — datos de `GET /modules`** (los 8 de examples-content §2, títulos literales):
M1 `Fundamentos` (2 lecciones) · M2 `Patrón SPMD y false sharing` (2) · M3 `Entorno de datos y
sincronización` (1) · M4 `Worksharing sobre arrays` (2) · M5 `Data races y RNG paralelo` (2) ·
M6 `Tareas (divide y vencerás)` (2) · M7 `Simulaciones reales: ¿qué escala?` (2) · M8
`GPU (opcional)` (1, con chip-amber `requiere GPU NVIDIA + gcc` y filas disabled si
`gpu_examples_enabled === false` en `GET /api/v1/system`). Niveles: M1 `principiante`,
M2-M4 `intermedio`, M5-M8 `avanzado` (tags de color §1.6 handoff). **Progreso por módulo
derivado del campo `progress` fusionado que devuelve `GET /api/v1/modules`** (caché en
progressStore) — el backend es la fuente única. Acordeón de un módulo abierto (default: el del
`lastLessonId`, si no M1).

**Filas de lección:** por lección dos filas — ejemplo (`.cat-lesson` icon video→IconPlay,
meta `Ejemplo · ~{est_run_seconds}s`) y quiz (icon IconHelp, meta
`Quiz · {quiz_question_count} preguntas`). Estados done/current del handoff §7.5 con el fix
`--success` (done = `progress.completed`). Click → `/cursos/{leccionId}` (el quiz ancla a la
sección quiz). Filtro sin resultados: `Sin resultados para este filtro.`

**Datos:** `GET /api/v1/modules` (shape api-contract §4.1, con `progress` y `summary`) +
`useSystemInfo` (para M8). **Estados:** carga → skeleton de 8 cards; error → ErrorState con retry.

### 6.6 Learn (`/cursos/:leccionId`)

**Componentes:** `LearnScreen` → `LessonInfo` (columna principal), `LessonSidebar` +
`RecommendedCard` + `TracksCard` (lateral), `QuizRunner`.

Adaptación estructural: **no hay videos** en el contenido real; el "video player" del handoff se
reemplaza por la card más valiosa del proyecto: **`CodeShowcase`** — el código del ejemplo en un
panel estilo terminal (mismo marco visual 16:9 del video-player, fondo #14100C) con las
directivas OpenMP resaltadas (span con `term-orange` sobre los strings `openmp("...")` — regex
simple, no highlighter completo) y botón central heredado del play (72px, IconPlay) con label
`Ejecutar en el simulador` → `/simulador?ejemplo={id}`.

- **Header:** ghost [IconChevronLeft] `Volver al catálogo`; eyebrow `ZINE · Aprender`; H2
  `{lesson.title}`; chips `chip-orange {módulo}` · `chip Módulo {m} · Lección {n}` · mono-small
  `Progreso: {done}/{totalLecciones}` (del `summary` de `/modules`). Acciones
  `Anterior`/`Siguiente` usan `prev_lesson_id`/`next_lesson_id` de `GET /lessons/{id}`.
- **Al montar la lección**: `progressStore.markViewed(id)` → `PUT /api/v1/progress/lessons/{id}
  {"viewed": true}` (el backend es la fuente del progreso) y `lastLessonId = id` (local).
- **Card descripción colapsable** `De qué va esta lección`: cuerpo = `LessonInfo` renderizando
  `content_markdown` de **`GET /api/v1/lessons/{id}`** (el markdown NO viene en examples; para
  `for/` cuyo info original está vacío, el fixture trae la lección redactada desde
  código+README — examples-content §4.2). Tabs: `Descripción` (markdown) · `Código`
  (CodeShowcase expandido, `source_code` de `GET /examples/{id}`) · `Salida esperada` (bloque
  terminal con `expected_output_note` + formato literal de examples-content §6). Se elimina la
  tab `Transcripción`.
- **Takeaways** `Lo que vas a aprender`: 3-4 bullets — campo `takeaways: string[]` de
  `GET /api/v1/examples/{id}` (api-contract §3.2).
- Row final: primary [IconPlay] `Probar en el simulador` → `/simulador?ejemplo={id}` · outline
  [IconDownload] `Descargar {filename}` (blob del `source_code`).
- **Quiz** → `QuizRunner` inline (no navega) — **modelo servidor de api-contract §5**:
  1. Al pulsar `Empezar quiz`: `GET /api/v1/lessons/{id}/quiz` → preguntas SIN respuestas.
  2. El estudiante responde las N preguntas (radio a/b/c/d); `answers` se acumulan como
     `Record<questionId, 'a'|'b'|'c'|'d'>`. El botón final `Enviar respuestas` se habilita
     cuando TODAS están respondidas (el contrato exige el intento completo).
  3. `POST /api/v1/lessons/{id}/quiz/attempts` → la `201` trae `score/total/passed` y
     `results[]` con `correct_key` + `explanation` por pregunta: la UI pinta ENTONCES el
     feedback pregunta a pregunta (verde/rojo + explicación) y el resumen `{score}/{total}`
     (+ chip `Aprobado` si `passed`).
  4. `progressStore.applyAttemptResult(...)` actualiza la caché (best score, completed).
  No hay botón `Comprobar` por pregunta: la clave correcta jamás viaja antes del intento
  (invariante del contrato). El feedback inmediato unitario queda descartado en MVP.
- **Sidebar del módulo:** lecciones del módulo actual con estados done/current (del `progress`
  de `/modules`), meta [IconPlay] `~{est_run_seconds}s` / [IconHelp]
  `{quiz_question_count} preguntas`, now-dot pulsante.
- **Recomendados**: campo `recommended[]` de `GET /api/v1/lessons/{id}` (estáticos del
  catálogo): p. ej. para `spmd`: `Data races clásicos` (mandelbrot) tag `Avanzado` ·
  `El arreglo: critical` (spmdCritical) tag `Práctica`.
- **TracksCard `Tu progreso`:** una fila por módulo con % real derivado de `/modules`.

**Datos:** `GET /api/v1/lessons/{leccionId}` (markdown, prev/next, recommended, progress) +
`GET /api/v1/examples/{leccionId}` (código, flags, takeaways, salida esperada) +
`GET /api/v1/lessons/{leccionId}/quiz` + `POST .../quiz/attempts` + `PUT /progress/lessons/{id}`
+ `GET /modules` (sidebar/secuencia). **Estados:** 404 → ErrorState + `Volver al catálogo`;
lección GPU sin GPU → banner ámbar `Esta lección requiere GPU NVIDIA + gcc; puedes leerla pero
no ejecutarla` (botón simulador disabled).

### 6.7 Shell: RuntimeFooter (sidebar footer)

`usePlatform()`:
- **desktop** (`window.telar` definido): `useDockerStatus` → `window.telar.dockerStatus()` al
  montar y cada 10 s. Estados: ok → dot verde pulsante, `Docker runtime` / `{n} contenedores
  activos`; caído → dot rojo estático, `Docker runtime` / `servicios detenidos` + botón sm
  outline `Levantar` → `dockerUp()` con spinner y re-check; comprobando → dot ámbar `verificando…`.
- **web**: `GET /health` cada 30 s → `Backend Telar` / `conectado` (verde) o `sin conexión`
  (rojo). El texto del footer se oculta colapsado (solo dot), como el prototipo.

---

## 7. Resumen de requisitos de datos (espejo de api-contract.md §9)

| Endpoint | Método | Usado por |
|---|---|---|
| `/health` | GET | RuntimeFooter web (proxied por nginx, `location = /health`) |
| `/api/v1/system` | GET | slider hilos, footer, M8 GPU, opciones avanzadas (límites) |
| `/api/v1/modules` | GET | catálogo, home (sugeridas), learn (sidebar), picker simulador — trae `progress` fusionado |
| `/api/v1/examples/{id}` | GET | learn (código/takeaways), simulador (código), results (plantillas obs) |
| `/api/v1/lessons/{id}` | GET | learn (markdown, prev/next, recommended) |
| `/api/v1/lessons/{id}/quiz` | GET | QuizRunner (preguntas sin respuestas) |
| `/api/v1/lessons/{id}/quiz/attempts` | POST | QuizRunner (corrección servidor) |
| `/api/v1/progress` | GET | hidratación inicial de progressStore (opcional; `/modules` suele bastar) |
| `/api/v1/progress/lessons/{id}` | PUT | markViewed al abrir lección |
| `/api/v1/jobs` | POST | lanzar ejecución |
| `/api/v1/jobs/upload` | POST multipart | subir .py (+ Form threads/timeout_s/lesson_id) |
| `/api/v1/jobs?limit=n` | GET | home, historial resultados |
| `/api/v1/jobs/{id}` | GET | resultados, recuperación del live |
| `/api/v1/jobs/{id}/cancel` | POST | cancelar desde listados (el live usa el WS) |
| `/api/v1/jobs/{id}/output` | GET | descarga de output (text/plain) |
| `/ws/jobs/{id}` | WS | live (§4.2) |

Convención de errores: **envelope del contrato** — `ApiError` expone `error.code` +
`error.message` (+ `status` HTTP); las pantallas deciden por `code`
(p. ej. `RUNNER_IMAGE_MISSING` → CTA instrucciones). Éxito = campo `data` desenvuelto en
`client.ts`. (`GET /health` y `/output` son las dos excepciones sin envelope.)

---

## 8. Gráficas: decisión y especificación

**Decisión: SVG a mano, cero librerías.** Criterios: (1) recharts añade ~100 KB gz y su estética
(ejes, tooltips, fuentes) pelea contra el sistema visual del handoff, que ya define sus propias
gráficas SVG artesanales (WorkDistributionChart, MiniBar, LiveTopology); (2) las 4 gráficas
necesarias son geométricamente triviales (barras y una polilínea); (3) control total de tokens
(`--font-mono`, colores §1.6) y de `prefers-reduced-motion`. Todas viven en `components/viz/`,
aceptan `width`/datos por props, usan `viewBox` responsivo y texto `mono 10-11px` con los colores
exactos del handoff (`#3F7A2E` cómputo/serie CPU, `#F57324` comunicación/serie memoria,
`#E9DFC9` idle/grid, `#D4C4A0` ejes).

### 8.1 `Sparkline` (live, hint de la MetricCard CPU)
`<Sparkline data={number[]} max={threadsEffective * 100}/>` — polilínea de las últimas 60
muestras, 120×28, stroke `#3F7A2E` 1.5, fill área `rgba(63,122,46,.08)`. Sin ejes ni labels.
**Escala**: `cpu_percent` del contrato llega hasta N·100 (8 hilos ≈ 800% — el caso pedagógico
central); el máximo del eje es `threads_effective·100` (fallback `online_cpus·100` del propio
mensaje `metrics`), jamás 100 fijo.

### 8.2 `SpeedupChart` (resultados, ejemplos sweep)
Props: `{ series: {threads:number; time_s:number; speedup:number; efficiency:number}[] }`
(el shape literal de `parsed_timings.series` — el backend ya calcula speedup/eficiencia).
ViewBox 520×260. Eje X: hilos (1/2/4/8, escala categórica equiespaciada); eje Y: speedup
(0..8). Dos series: **ideal** (recta punteada `#D4C4A0` dash 3 4, label `ideal` mono 10) y
**observado** (polilínea `#F57324` 2px con puntos r4 fill `#F57324`, valor `{speedup.toFixed(1)}×`
mono 10 sobre cada punto). Leyenda-row del handoff (lg-dot). Debajo, fila mono-small:
`eficiencia a 8 hilos: {efficiency·100}%`. Transición de entrada: los puntos aparecen con
`transition opacity .4s var(--ease)` escalonada (sin animation si reduced-motion).

### 8.3 `ComparisonBars` (resultados, ejemplos kind "pair")
Props: `{ parallel_time_s:number; reference_time_s:number; reference_label:string }` (shape de
`parsed_timings` kind `pair`). Reutiliza el layout del WorkDistributionChart del handoff (§6.3:
filas grid `40px 1fr`, track 26px radius 4): una barra horizontal por medición, ancho ∝ tiempo,
color `#3F7A2E` para openmp y `#F57324` para la referencia (numpy/blas/serial), label del tiempo
dentro (mono 10 blanco) — `transition width .4s var(--ease)`.

### 8.4 `LiveMetricsChart` (SOLO con la serie en memoria del live)
Props: `{ samples: MetricSample[]; maxCpu: number }`. ViewBox 520×200, doble serie temporal:
CPU% (línea `#3F7A2E`, eje izq **0..maxCpu = threads_effective·100**) y memoria (línea
`#F57324`, eje der 0-512 MB), grid horizontal `#E9DFC9` dash. Labels min/max mono 10. Máx ~900
puntos → decimación a 260 puntos por `lttb`-simple (media por bucket) en `lib/format.ts`.
**Fuente de datos**: exclusivamente `jobStore.metrics` (memoria del live) — el backend no
persiste la serie (data-model §3); en Resultados solo aparece si se llega del live (§6.4).

### 8.5 Portados del handoff sin cambios estructurales
`MiniBar` (§5.8), `ThreadTopology`, `LiveTopology`, `HomeThreadsDiagram` (§5.4-5.5).
**`WorkDistributionChart` NO se porta** (ninguna pantalla lo usa con datos reales; su layout
sobrevive en `ComparisonBars`).

---

## 9. Slider de hilos: comportamiento por flags del contrato

Fuente del rango: `max_threads` de `GET /api/v1/system` (slider `min=1 max=max_threads`,
marcas en 1/2/4/8 si `cores ≥ 8`). Los modos derivan de los flags del ejemplo
(`threads_configurable`, `sweeps_threads`, `fixed_threads` — api-contract §3.1). El backend
SIEMPRE sincroniza `--cpus`, `OMP_NUM_THREADS` y `NUMBA_NUM_THREADS`. La UI **no miente**
cuando el script no obedece:

| Flags | Ejemplos | Comportamiento UI |
|---|---|---|
| `threads_configurable=true` | primerEjemplo, for, sumaVectores, matrices, mandelbrot, tareas, fibonacciTareas, stencilCalor, sumaVectoresGPU | Slider activo. Hint estándar. El POST envía `threads` (1..max_threads). |
| `threads_configurable=false` + `fixed_threads` (4) | entornoDatos (`num_threads(4)`), monteCarloPi (`omp_set_num_threads(4)`) | Slider **deshabilitado** posicionado en `fixed_threads` con hint = `fixed_threads_note`. El POST **OMITE `threads`** (el backend usa su valor fijo; contrato §7.1). |
| `threads_configurable=false` + `sweeps_threads=true` | piSpmd, piSpmdCritical, transporteMonteCarlo | Slider **deshabilitado** mostrando `1·2·4·8` con hint: `Este ejemplo barre 1, 2, 4 y 8 hilos en una sola corrida (omp_set_num_threads) y mide cada caso — obtendrás la curva de speedup completa.` El POST **OMITE `threads`** (el backend asigna `min(8, cores)` CPUs — así el sweep funciona igual en hosts de 4 cores sin 422). |

Si `cores < 8`, los ejemplos sweep muestran aviso ámbar: `Tu máquina tiene {cores} núcleos;
los casos de 8 hilos no mostrarán speedup real.` Código editado por el usuario → slider activo
+ nota `Si tu código llama omp_set_num_threads(), este valor no tendrá efecto.`

---

## 10. Plan de tests (Vitest + Testing Library)

Setup: `vitest` con `environment: 'jsdom'`, `setupFiles` con `@testing-library/jest-dom`,
mock de `matchMedia` y `WebSocket` (clase FakeWebSocket controlable). Objetivo: cubrir la lógica
con riesgo real, no el CSS.

Los fixtures de mensajes WS y respuestas REST se escriben COPIANDO los ejemplos JSON de
api-contract.md (mismos nombres snake_case, envelope, 8 fases) — un test que pase contra un
shape inventado no vale.

| # | Suite | Casos clave |
|---|---|---|
| 1 | `ws/jobSocket.test.ts` | parse de los 5 tipos de mensaje del contrato (`status.phase`+`detail`, `log.lines[]`+`seq`, `metrics.cpu_percent…`, `error.code`, `eof.truncated`); mensajes malformados ignorados; `cancel()` envía JSON correcto; close sin eof → phase `lost`; backoff con timers falsos; eof → no reintenta; replay terminal (status terminal + eof sin running previo) dispara el redirect |
| 2 | `stores/jobStore.test.ts` | cap de 1000 logs + flag truncated; batching (N appends → 1 notificación por flush); cap métricas; `reset()` limpia todo; `setPhase` con detail terminal puebla exitCode/errorDetail |
| 3 | `hooks/useJobSocket.test.tsx` | monta/desmonta cierra socket; cambio de jobId reconecta; StrictMode no duplica conexión; `elapsedSec` avanza con fake timers |
| 4 | `stores/progressStore.test.ts` | `hydrate()` puebla la caché desde `/modules` mockeado; `markViewed` llama PUT y refresca; `applyAttemptResult` actualiza best score/completed; `lastLessonId` persiste en localStorage; `moduleProgress` calcula done/total/pct |
| 5 | `stores/themeStore.test.ts` | default v1; set v2 escribe `data-variant` en `<html>` y localStorage `telar-variant`; hidratación desde valor persistido |
| 6 | `lib/speedup.test.ts` + `lib/observations.test.ts` | eficiencia de un sweep real (fixture transporte con `series[]` del contrato); regla false-sharing dispara con sweep plano de piSpmd; regla failed+stderr; Amdahl |
| 7 | `features/simulator/ThreadsField.test.tsx` | configurable: slider habilitado 1..max_threads; fixed: disabled en `fixed_threads` + hint; sweep: disabled + hint barrido; aviso cores<8; el payload OMITE threads en fixed/sweep |
| 8 | `features/simulator/LiveTerminalCard.test.tsx` | render de líneas stdout/stderr con clases correctas; placeholders por fase creating/compiling; auto-scroll se pausa al scrollear arriba; banner truncado |
| 9 | `features/learn/QuizRunner.test.tsx` | flujo servidor completo: GET quiz sin respuestas → responder todas → habilita Enviar → POST attempts mockeado → feedback por pregunta con `correct_key`/`explanation` de `results[]`, resumen `score/total`, `applyAttemptResult` llamado |
| 10 | `features/simulator/CodePanel.test.tsx` | rechaza .txt, rechaza >256 KB, acepta .py válido y llena editor; chip `modificado` al editar; payload example_id solo / example_id+code / code solo según estado |
| 11 | `features/results/ResultsScreen.test.tsx` | fixture `parsed_timings` kind sweep → SpeedupChart; kind pair → ComparisonBars; null + serie en memoria → LiveMetricsChart; null sin serie → resumen `metrics_summary`; estados 404/no-terminal-redirect |
| 12 | `router.test.tsx` (smoke) | cada ruta lazy renderiza su skeleton y luego la pantalla con API mockeada (fixtures del contrato) |

Cobertura objetivo: ≥ 80 % en `ws/`, `stores/`, `lib/`, `hooks/`; los componentes visuales puros
(viz, ui) se cubren por smoke tests de render con props fixture.

---

## 11. Decisiones registradas en este documento

1. Zustand ^5 (4 stores) en lugar de Context — justificación §3.
2. Router file `createHashRouter` con 7 rutas y lazy por pantalla — §2.
3. Unificación del theming en un solo `data-variant` en `<html>` (se reescriben los selectores `.v2`) — §5.1.
4. Gráficas SVG a mano (4 componentes nuevos + portados), sin recharts — §8.
5. Editor MVP = textarea estilizada; Monaco documentado como mejora futura — §0.
6. Se eliminan: botón Pausar, sliders de % cómputo + allocation-bar, warn-banner del live con datos fake, tab Transcripción, mode-switch v2, WorkDistributionChart (no se porta), videos (reemplazados por CodeShowcase) — §5.2, §6, §8.5.
7. `LiveMetricsRow` muestra SOLO métricas reales; "Sincronizaciones" queda como vocabulario didáctico, nunca como número inventado — §6.3.
8. Parser de stdout en backend; frontend consume `parsed_timings` (el parseo en vivo de SweepProgressCard es presentacional, con los mismos regex de architecture.md §7.2) — §6.3/§6.4.
9. **El backend es la fuente única del progreso y de la corrección de quizzes** (api-contract §5-§6); progressStore es caché + `lastLessonId` local. localStorage solo persiste `telar-variant`, `telar-sidebar-expanded` y `telar-last-lesson` — §3.1, §6.6.
10. `api/types.ts` y `ws/messages.ts` se transcriben LITERALMENTE de api-contract.md (envelope, snake_case, `/api/v1`, 8 fases, `log.lines[]`+`seq`, sin close 4409); tabla única fase→chip en §6.3 — encabezado y §4.2.
11. Las gráficas de CPU escalan a `threads_effective·100`, jamás a 100 fijo — §8.1/§8.4.
12. La serie temporal de métricas vive SOLO en memoria del live; Resultados degrada a `metrics_summary` (el backend no persiste muestras) — §6.4/§8.4.
