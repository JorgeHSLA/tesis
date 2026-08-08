# Telar — Plan de implementación de Fase 3 (paquetes de trabajo paralelizables)

> **Estado: CONGELADO.** Este plan es el input del orquestador de Fase 3.
> Los contratos congelados (`api-contract.md`, `data-model.md`,
> `architecture.md`, `frontend-spec.md`, `electron-spec.md`) son la ÚNICA
> interfaz entre paquetes: ningún agente negocia shapes con otro agente —
> si un contrato no alcanza, se detiene y se escala al arquitecto.
>
> Regla de propiedad: **cada archivo del repo pertenece a EXACTAMENTE un
> paquete**. Un agente jamás edita archivos de otro paquete; si necesita un
> cambio ahí, lo reporta.

## Reglas globales para todos los agentes

1. Leer PRIMERO los docs de `docs/architecture/` listados en su paquete.
2. Entorno WSL2: `npm ci`/builds/pytest se ejecutan en el clon ext4
   (`~/dev/e-hpc/`), nunca en `/mnt/d`. DB y jobs de dev en `~/.ehpc/`.
3. Convenciones de código: archivos < 400 líneas (800 máx), funciones
   < 50 líneas, datos inmutables, errores manejados explícitamente, cero
   secretos hardcodeados.
4. TDD donde el paquete incluya lógica: test primero, cobertura ≥ 80 % en
   los módulos con riesgo real.
5. Los criterios de aceptación son comandos: si el comando falla, el paquete
   no está terminado.

## Grafo de dependencias (olas de ejecución)

```
Ola 0:  WP0 scaffold  (SOLO, nada en paralelo)
Ola 1:  WP1 backend-core · WP2 backend-jobs-runner · WP3 backend-cursos-quizzes
        WP4 content-fixtures · WP5 frontend-shell-tokens · WP8 electron
Ola 2:  WP6 frontend-simulator-results · WP7 frontend-home-catalog-learn
        WP9 tests-backend (integración; sus fakes pueden empezar en ola 1)
Ola 3:  WP10 tests-frontend
Ola 4:  WP11 integration-readme (smoke E2E de todo el stack)
```

---

## WP0 — scaffold (primero y solo)

**Docs**: los 5 de architecture/ completos.

**Alcance**: esqueleto completo del monorepo para que todos los demás paquetes
encuentren su sitio y sus tipos. NO implementa lógica: solo estructura,
configuración, contratos transcritos y artefactos operativos.

- Estructura de carpetas de `architecture.md` §9 con archivos vacíos/stub
  (`__init__.py`, componentes placeholder que compilan).
- `compose.yaml` raíz literal de `architecture.md` §2.2 (puertos
  `127.0.0.1:`, runner tras `profiles: ["build"]`), `frontend/nginx.conf`
  (§2.3 con `location = /health`), `frontend/Dockerfile` multi-stage,
  `backend/Dockerfile` (root + socket, §10.1), `runner/Dockerfile`
  (`python:3.12-slim` + `pyomp==0.5.1` + smoke test + `compileall` +
  useradd runner 10001, según `docs/research/pyomp-runner.md`),
  `.dockerignore` de frontend y backend, `.gitignore`, `Makefile` (§10.3).
- `backend/requirements.txt` + `requirements-dev.txt` pineados (§10.4);
  `backend/app/config.py` (pydantic-settings con la tabla TELAR_* de §10.5).
- **Modelos pydantic** `backend/app/schemas.py` (o `schemas/`): DTOs de TODOS
  los request/response de `api-contract.md` (envelope genérico, jobs, system,
  modules, lessons, quiz, progress, mensajes WS) — transcripción, sin lógica.
- **Tipos TS**: `frontend/src/api/types.ts` y `frontend/src/ws/messages.ts`
  transcritos de api-contract.md (snake_case literal, 8 fases, envelope);
  `frontend/src/types/ehpc.d.ts` y `desktop/types/ehpc-api.d.ts` (contrato
  `window.ehpc` de electron-spec §5.1, copia idéntica + test de igualdad).
- `frontend/package.json` (deps de frontend-spec §0), `vite.config.ts`
  (`base:'./'`, alias `@`), `tsconfig.json` strict, `index.html`
  (`data-variant="v1"`), `src/config.ts` (resolución RUNTIME de
  architecture §2.3), `src/main.tsx` y `src/router.tsx` mínimos que montan
  un placeholder.
- `desktop/package.json`, `tsconfig.json`, `scripts/build.mjs` (con `define`
  `__APP_VERSION__`), `electron-builder.yml`, `desktop/resources/compose/compose.yaml`
  (solo `image:`, electron-spec §6.1); `src/*.ts` como stubs que compilan.
- `backend/app/content/` queda como directorio con README de formato — su
  contenido lo posee WP4.

**Archivos (exclusivos)**: todo lo anterior; ver lista en el JSON de salida.

**Criterios de aceptación**:
- `docker compose config -q` (compose raíz válido) y
  `docker compose -f desktop/resources/compose/compose.yaml config -q`.
- `cd frontend && npm ci && npx tsc --noEmit && npm run build` (build de
  placeholder pasa).
- `cd desktop && npm ci && npm run build && npm run typecheck`.
- `cd backend && pip install -r requirements.txt -r requirements-dev.txt &&
  python -c "import app.config, app.schemas"`.
- `docker build runner/` construye y su smoke test interno pasa (puede
  tardar; ~777 MB).
- Test de igualdad `ehpc.d.ts` == `ehpc-api.d.ts` pasa.

**Presupuesto**: ~45 archivos, ~2.500 líneas (la mitad configs/DTOs).

---

## WP1 — backend-core (DB, lifespan, system/health, envelope)

**Docs**: data-model.md (completo), api-contract.md §1-§2, architecture.md §3.4, §10.

**Alcance**: `db.py` (open_db + PRAGMAs + `write_lock` asyncio.Lock +
schema.sql idempotente), los 3 repositorios de estado con las firmas EXACTAS
de data-model §5 (incluido el guard de terminales en `finish`/`set_phase`),
`app/main.py` (FastAPI + lifespan: DB, cliente docker vía puerto inyectable,
registro `app.state.jobs`, carga de contenido, hook del reaper — el reaper
mismo lo implementa WP2 y core lo invoca por interfaz), middleware CORS
(config §10.5), handlers de error → envelope (`VALIDATION_ERROR` 422
reformateado, `INTERNAL_ERROR` genérico), `GET /health` (liveness: 200 salvo
DB caída, checks informativos) y `GET /api/v1/system`.

**Archivos**: `backend/app/main.py`, `backend/app/db.py`,
`backend/app/schema.sql`, `backend/app/repositories/{__init__,records,jobs,quiz_attempts,progress}.py`,
`backend/app/routers/{__init__,system}.py`, `backend/app/errors.py`.

**Depende de**: WP0.

**Criterios**: `pytest backend/tests_local_wp1` propios del paquete (repos
contra `:memory:`, guard terminal, write_lock concurrente, /health degradado,
/system con docker fake) en verde; `uvicorn app.main:app` arranca con DB
nueva y responde `/health` 200.

**Presupuesto**: ~10 archivos, ~1.400 líneas.

---

## WP2 — backend-jobs-runner (docker_service, job_runner, WS, parsers)

**Docs**: architecture.md §3 COMPLETO (drainer §3.2, kill_reason §3.3, orden
§3.4, seguridad §4-§5, parsers §7), api-contract.md §7-§8,
docs/research/docker-py.md y fastapi-ws.md.

**Alcance**: `docker_service.py` (ÚNICO módulo que importa `docker`; expone
`DockerServicePort` como `typing.Protocol` para inyección; flags sandbox de
§4 como constantes; `log_config` 4m; entrega de código bind/volume-subpath;
reaper de contenedores + directorios), `job_runner.py` (semáforo, task por
job, **drainer** con presupuesto 256 KB/ring-buffer/fan-out a colas
por-conexión, `cancel_requested`, `kill_reason` con prioridad, orden de
terminación §3.4, puente threads→asyncio con `.result(timeout)`),
`output_parser.py` (los 6 parser_id de §7.2, speedup/eficiencia),
`routers/jobs.py` (POST con la semántica de fuentes §7.1, upload por chunks
con filename estricto, list/get/cancel/output) y `routers/ws.py` (validación
Origin, 4404, replay terminal, backlog, cancel, BAD_CLIENT_MESSAGE).

**Archivos**: `backend/app/services/{__init__,docker_service,job_runner,output_parser}.py`,
`backend/app/routers/{jobs,ws}.py`.

**Depende de**: WP0 (desarrolla contra las firmas congeladas de los
repositorios de data-model §5; la integración final requiere WP1 mergeado).

**Criterios**: suite propia con `FakeRunner` (guiones de logs/stats/exit):
happy/timeout/OOM/truncado/cancel-queued/cancel-running/fan-out×2/desconexión
sin consumidor NO bloquea el productor — en verde; los 6 parsers contra los
stdout literales de `examples-content.md` §6; con WP1 mergeado: job real
end-to-end contra la imagen runner (`pytest -m docker` opcional).

**Presupuesto**: ~7 archivos, ~1.900 líneas.

---

## WP3 — backend-cursos-quizzes (contenido, lecciones, quiz, progreso)

**Docs**: api-contract.md §3-§6, data-model.md §1, §4-§5.

**Alcance**: `ContentRepository` (carga + validación fail-fast de fixtures,
invariantes de data-model §4.4), `QuizService.submit_attempt` (corrección
server-side, score, upsert de progreso DENTRO del write_lock),
routers `examples.py` (sin quiz en el detalle; con `takeaways`,
`fixed_threads`, `est_run_seconds`), `lessons.py` (markdown, prev/next,
`recommended`, progress fusionado), `quizzes.py` (GET sin respuestas, POST
attempts, GET historial opcional), `progress.py` (GET mapa, PUT lección),
`modules` con progreso fusionado y summary.

**Archivos**: `backend/app/repositories/content.py`,
`backend/app/services/quiz_service.py`,
`backend/app/routers/{examples,lessons,quizzes,progress,modules}.py`.

**Depende de**: WP0 (tests con mini-fixtures propios bajo su directorio de
tests; los fixtures reales llegan con WP4).

**Criterios**: suite propia en verde: validación de fixtures rotos falla
rápido; quiz jamás filtra `correct_key` en GET; POST attempts calcula
score/passed y actualiza progreso atómicamente; PUT progress; modules fusiona
progreso. Con WP4 mergeado: `ContentRepository` valida los fixtures reales
(60 preguntas habilitadas, 14+14+14).

**Presupuesto**: ~8 archivos, ~1.200 líneas.

---

## WP4 — content-fixtures (los 14 ejemplos, lecciones y quizzes)

**Docs**: data-model.md §4, examples-content.md COMPLETO (fuente literal),
api-contract.md §3-§5.

**Alcance**: poblar `backend/app/content/` entero:
- `examples/<id>/main.py` — copia LITERAL de los scripts de
  `/mnt/d/universidad/tesis/simuladores/openmp/aprendizaje/` (14 carpetas,
  mapeo de nombres en data-model §4.2; no tocar el código).
- `lessons/<id>.md` — los `info*.md` portados con formato unificado al subset
  markdown de frontend-spec §1 (h1-h4, listas, código, negrita, enlaces,
  tablas simples); **`for.md` se REDACTA nuevo** desde código + fila 2 del
  README fuente.
- `quizzes/<id>.json` — las 65 preguntas literales de examples-content §4
  con `correct_key`/`explanation`.
- `catalog.json` — módulos/lecciones/ejemplos con TODOS los campos de
  data-model §4.2 incluidos los nuevos: `est_run_seconds`, `fixed_threads`,
  `takeaways` (3-4 bullets por lección, redactados del info) y
  `recommended` (2-3 por lección).

**Archivos**: `backend/app/content/**` (≈ 1 + 14 + 14 + 14 archivos).

**Depende de**: WP0.

**Criterios**: `python -m app.tools.validate_content` (validador de WP3 o
script equivalente del paquete) en verde: JSON parsea, invariantes §4.4,
subset markdown respetado, 60 preguntas habilitadas; diff binario de cada
`main.py` contra el repo fuente = idéntico.

**Presupuesto**: ~43 archivos, ~3.000 líneas (mayormente contenido).

---

## WP5 — frontend-shell-tokens (design system, shell, infraestructura)

**Docs**: frontend-spec.md §0-§5, §6.0, §6.7, handoff-design.md (tokens,
iconos, shell, bugs §14).

**Alcance**:
- `styles/tokens.css` (port LITERAL de handoff §1.2-§1.5: paleta v1, radios/
  sombras/`--ease`, `[data-theme="dark"]`, tokens v2; nuevo `--success`),
  `base.css`, `components.css` con los 4 fixes de bugs CSS (§5.2: grid del
  hero, selectores `.v2 .x` → `[data-variant="v2"] .x`, rail 52px, `--ink`→
  `--text`).
- 29 iconos portados literal (`components/icons/`), `components/ui/*`
  (Button, Card, Chip, Field, RangeField, Terminal, MetricCard, MiniBar,
  NodeDiamond, StatusChip, EmptyState, ErrorState, Skeleton),
  `components/shell/*` (AppShell, Sidebar, TopBar, RuntimeFooter con
  usePlatform/useDockerStatus), `router.tsx` definitivo (7 rutas lazy,
  títulos/crumbs §2), `main.tsx` con imports @fontsource.
- Stores `themeStore`/`sidebarStore`, hooks `usePlatform`, `useReducedMotion`,
  `useSystemInfo`, `useDockerStatus`; `api/client.ts` (envelope→ApiError),
  `api/system.ts`; `lib/markdown.ts` (subset exacto §1) y `lib/format.ts`.
- **Instrucciones de estilo para el agente**: portar tokens/medidas
  PIXEL-PERFECT del handoff (no "inspirarse"); fuentes self-hosted
  @fontsource (Fraunces variable, Instrument Sans 400/500/600, JetBrains
  Mono 400-700) sin ninguna request de red; conservar animaciones: pulse de
  dots, colapso sidebar .22s + tooltips, hovers (qcard, play 1.06, chevrons
  90°); TODA animación decorativa respeta `prefers-reduced-motion: reduce`
  (regla CSS global + `useReducedMotion` para SMIL/smooth-scroll);
  accesibilidad: focus visible en todos los interactivos, roles/aria-label en
  sidebar/topbar/footer, contraste AA con los tokens dados, navegable por
  teclado; los componentes EmptyState/ErrorState/Skeleton son la ÚNICA forma
  de estados vacío/error/carga (sin spinners globales).

**Archivos**: `frontend/src/styles/{tokens,base,components}.css`,
`frontend/src/components/**`, `frontend/src/router.tsx`,
`frontend/src/main.tsx`, `frontend/src/stores/{themeStore,sidebarStore}.ts`,
`frontend/src/hooks/{usePlatform,useReducedMotion,useSystemInfo,useDockerStatus}.ts`,
`frontend/src/api/{client,system}.ts`, `frontend/src/lib/{markdown,format}.ts`.

**Depende de**: WP0.

**Criterios**: `npx tsc --noEmit` y `npm run build` en verde; smoke render
del AppShell con las 7 rutas (placeholders de features); toggle v1/v2 cambia
`data-variant` y el rail a 52px; `npm run dev` levanta y el shell se ve
como el prototipo (verificación visual contra handoff).

**Presupuesto**: ~35 archivos, ~3.200 líneas.

---

## WP6 — frontend-simulator-results (el flujo estrella)

**Docs**: frontend-spec.md §3.1 (jobStore), §4 COMPLETO, §6.2-§6.4, §8, §9;
api-contract.md §7-§8.

**Alcance**: `ws/jobSocket.ts` (protocolo literal §4.2: `status.phase` 8
fases + `detail`, `log.lines[]`+`seq`, `metrics` snake_case, `eof.truncated`;
sin 4409; backoff; replay→redirect), `stores/jobStore.ts` (UiPhase, caps,
batching rAF), `hooks/{useJobSocket,useSimulation}.ts`, pantallas Simulador
idle (ConfigPanel, CodePanel con dropzone+validación client-side,
ThreadsField según flags §9 — OMITE `threads` en fixed/sweep, opciones de
timeout dinámicas de `limits.max_timeout_s`, `?ejemplo=` param, payload
example_id/code según edición) y live (LiveHeader con la tabla fase→chip,
LiveMetricsRow con Sparkline escala `threads_effective·100`, LiveNodesCard
decorativa + LiveTerminalCard con placeholders por fase creating/compiling,
ThreadsTable/SweepProgressCard con los regex de architecture §7.2),
Resultados (ResultsList, ResultsScreen: métricas de `metrics_summary`,
SpeedupChart/ComparisonBars/degradación §6.4, Observaciones, Output con
descarga vía `/output`), viz `{ThreadTopology,LiveTopology,SpeedupChart,
ComparisonBars,LiveMetricsChart,Sparkline}`, `api/jobs.ts`,
`lib/{speedup,observations}.ts`.

**Instrucciones de estilo**: terminal oscuro #14100C en ambas variantes (no
tokenizar); LiveTopology reinterpretada §5.4 (master + t0..tN, sub-etiqueta
`representación didáctica del fork-join`, SIN warn-banner fake, sin % CPU
por hilo inventado); animaciones de paquetes SMIL y tick 700 ms SOLO
decorativas y suprimidas con reduced-motion; auto-scroll del terminal con
pausa por scroll manual y botón «↓ seguir salida»; transiciones width de
barras `.4s var(--ease)`; gráficas SVG a mano con mono 10-11px y colores
exactos §1.6 (#3F7A2E, #F57324, #E9DFC9, #D4C4A0); estados: skeleton de
silueta en carga, ErrorState con retry + CTA Docker en desktop, EmptyState
del historial con link al simulador; a11y: `aria-live="polite"` en el chip
de estado, terminal con `role="log"`, slider con `aria-valuetext`.

**Archivos**: `frontend/src/features/{simulator,results}/**`,
`frontend/src/ws/jobSocket.ts`, `frontend/src/stores/jobStore.ts`,
`frontend/src/hooks/{useJobSocket,useSimulation}.ts`,
`frontend/src/components/viz/{ThreadTopology,LiveTopology,SpeedupChart,ComparisonBars,LiveMetricsChart,Sparkline}.tsx`,
`frontend/src/api/jobs.ts`, `frontend/src/lib/{speedup,observations}.ts`,
`frontend/src/styles/screens/{simulator,results}.css`.

**Depende de**: WP0, WP5.

**Criterios**: `npx tsc --noEmit` + `npm run build`; contra el backend real
(WP1+WP2 en dev): lanzar `spmd` sin editar produce live con fases
compiling→running y resultados con SpeedupChart; editar una línea y relanzar
conserva la gráfica; cancelar en vivo termina en chip `Cancelado`.

**Presupuesto**: ~30 archivos, ~3.500 líneas.

---

## WP7 — frontend-home-catalog-learn (contenido y progreso)

**Docs**: frontend-spec.md §3.1 (progressStore), §6.1, §6.5, §6.6;
api-contract.md §3-§6.

**Alcance**: `stores/progressStore.ts` (caché de `/modules` + `markViewed`
PUT + `applyAttemptResult`; solo `lastLessonId` en localStorage),
`api/content.ts`, Home (hero + HomeThreadsDiagram SMIL, TutorialTabs,
callout → `/cursos/primerEjemplo`, QuickCards, RecentJobs con chips de la
tabla §6.3, SuggestedLessons del progress fusionado), Catálogo
(ContinueCard con `est_run_seconds`, stats del `summary`, toolbar con
búsqueda/fpills, 8 ModuleAccordion con progreso del servidor, M8 según
`gpu_examples_enabled`), Learn (CodeShowcase con resaltado regex de
directivas, tabs Descripción/Código/Salida esperada con `content_markdown`
de `/lessons/{id}`, takeaways, QuizRunner **modelo servidor** §6.6: GET quiz
→ responder todas → POST attempts → feedback con `results[]`, Recomendados
de `recommended[]`, TracksCard, prev/next de la lección, `markViewed` al
montar).

**Instrucciones de estilo**: port pixel-perfect de las cards/acordeones del
handoff §4/§7/§8 con los textos exactos de frontend-spec §6.0/§6.1/§6.5/§6.6;
SMIL del hero portado tal cual (sin el setInterval redundante) y suprimido
con reduced-motion; estados done/current con `--success`; now-dot pulsante;
markdown renderizado con el subset de `lib/markdown.ts` (código monoespaciado,
tablas legibles); estados: skeleton de 8 cards en catálogo, ErrorState con
retry, `Sin resultados para este filtro.`, banner GPU ámbar; a11y: acordeón
con `aria-expanded`, quiz con fieldset/legend por pregunta y radios
etiquetados, feedback con `aria-live`.

**Archivos**: `frontend/src/features/{home,catalog,learn}/**`,
`frontend/src/stores/progressStore.ts`, `frontend/src/api/content.ts`,
`frontend/src/components/viz/HomeThreadsDiagram.tsx`,
`frontend/src/styles/screens/{home,catalog,learn}.css`.

**Depende de**: WP0, WP5.

**Criterios**: `npx tsc --noEmit` + `npm run build`; contra backend real:
abrir una lección marca `viewed` (visible en el catálogo tras F5 — el
progreso sobrevive a borrar localStorage); completar un quiz aprueba con
score del servidor y el módulo refleja el avance; el callout del Home navega
a una lección existente.

**Presupuesto**: ~28 archivos, ~3.000 líneas.

---

## WP8 — electron (shell de escritorio)

**Docs**: electron-spec.md COMPLETO, architecture.md §2.3/§8.

**Alcance**: `main.ts` (ventana, single-instance, loadFile/DEV_URL, menú
null), `preload.ts` (contextBridge, `__APP_VERSION__`), `ipc-docker.ts`
(whitelist con acciones-secuencia incluida la construcción del runner,
execFile sin shell, timeout 600 s, `assertTrustedSender`, parseComposePs
NDJSON), `security.ts` (CSP onHeadersReceived, permission handler deny,
will-navigate whitelist, windowOpenHandler deny + openExternal https),
`constants.ts`; contenido real del compose empaquetado (electron-spec §6.1)
y del `electron-builder.yml` ya esbozados por WP0 si necesitan ajuste — son
suyos a partir de ahora.

**Depende de**: WP0 (usa `frontend/dist` de cualquier build para probar).

**Archivos**: `desktop/src/*.ts`, `desktop/resources/**` (incl. compose
empaquetado e iconos), `desktop/electron-builder.yml`.

**Criterios**: `npm run typecheck` + `npm run build`; `npm run dist:linux`
produce AppImage+deb; con el stack compose corriendo: la app carga el build,
`window.ehpc` definido, footer muestra estado Docker, `Levantar` ejecuta la
secuencia build-runner+up y el poll aguanta hasta 10 min; navegación externa
bloqueada (test manual del checklist §7.3).

**Presupuesto**: ~8 archivos, ~900 líneas.

---

## WP9 — tests-backend (suite integral pytest)

**Docs**: architecture.md §11 (plan espejo), api-contract.md completo.

**Alcance**: `backend/tests/**` exclusivo: `conftest.py` (DB memoria +
schema, app con dependency overrides), `fakes/fake_docker.py` (implementación
scriptable de `DockerServicePort`), `fixtures/stdout/*` (salidas literales de
examples-content §6), y las 7 suites de architecture §11 (repositorios,
job_runner con drainer/kill_reason/carreras, WS con TestClient, parsers,
routers contra el contrato — incluida la semántica de fuentes de POST /jobs,
filename estricto del upload y el envelope de errores —, contenido real).

**Depende de**: WP0, WP1, WP2, WP3, WP4 (los fakes y fixtures pueden
escribirse desde la ola 1 contra los contratos; la ejecución final requiere
todo el backend mergeado).

**Criterios**: `cd backend && pytest --cov=app --cov-fail-under=80` en verde
sin daemon Docker (todo con fakes); marca `-m docker` opcional para el smoke
real con la imagen runner.

**Presupuesto**: ~14 archivos, ~2.200 líneas.

---

## WP10 — tests-frontend (suite Vitest)

**Docs**: frontend-spec.md §10 (tabla de 12 suites), api-contract.md §7-§8.

**Alcance**: `frontend/tests/**` + `frontend/vitest.config.ts` +
`frontend/tests/setup.ts` (jest-dom, mock matchMedia, FakeWebSocket
controlable) + `frontend/tests/fixtures/` (mensajes WS y respuestas REST
COPIADOS de los ejemplos JSON del api-contract). Implementa las 12 suites de
la tabla §10 (actualizada: protocolo de 8 fases, quiz servidor, degradación
de métricas, payloads de threads).

**Depende de**: WP0, WP5, WP6, WP7.

**Criterios**: `cd frontend && npx vitest run --coverage` en verde con
cobertura ≥ 80 % en `src/ws`, `src/stores`, `src/lib`, `src/hooks`.

**Presupuesto**: ~16 archivos, ~2.000 líneas.

---

## WP11 — integration-readme (cierre)

**Docs**: todos.

**Alcance**: `README.md` raíz (prerequisitos, regla ext4, tabla TELAR_*,
targets de make, riesgo del socket, guía del instalador desktop y sus dos
modos de imágenes, troubleshooting SmartScreen/AppImage), script
`scripts/smoke.sh` (levanta compose, espera /health, lanza un job de `spmd`
por curl, verifica `parsed_timings.kind=="sweep"` en el GET final, corre un
quiz por curl) y verificación cruzada final: `make test` completo + smoke.

**Depende de**: todos los anteriores.

**Archivos**: `README.md`, `scripts/smoke.sh`, `docs/CHANGELOG-fase3.md`.

**Criterios**: `bash scripts/smoke.sh` en verde en WSL2 limpio;
`make build-images && make up` deja la UI servida en `127.0.0.1:8080` y un
job del catálogo ejecuta de punta a punta.

**Presupuesto**: ~3 archivos, ~600 líneas.
