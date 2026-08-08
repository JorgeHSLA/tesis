# Telar — Reporte de verificación visual E2E (aceptación independiente)

> **Rol:** verificador independiente. Nada se asume: cada criterio tiene un
> veredicto PASS/FAIL respaldado por una **aserción sobre el DOM que ve el
> usuario** (no sobre logs internos) y por **artefactos** (capturas, video, trace).
> Navegador real: Chromium vía Playwright contra el stack en `http://127.0.0.1:8080`.

- **Fechas:** Fase 3 (estudiante) 2026-07-13 · **Fase 4 (autoría/admin) 2026-07-14**.
- **Suite:** `~/.telar-verify/e2e/` (ext4, aislada del repo) — Page Object Model, `playwright.config.ts`.
- **Veredicto global:** ✅ **PASS** — **15/15 tests verdes** (8 estudiante A–D + 7 admin ADM1–7) + aislamiento del sandbox. La verificación encontró **1 bug real de UI** en la autoría de quizzes (el editor no permitía crear el PRIMER quiz de una lección; §10). **BUG-01 quedó RESUELTO** (fix aplicado y verificado el 2026-07-14): ADM4 se reescribió de "documenta el defecto" a **camino feliz** que crea el quiz enteramente por la UI. Además: 1 desviación de *literalidad* en Resultados (no es bug) y 1 flaky corregido de raíz.
- **Actualización 2026-07-14 (resolución de BUG-01):** se trató el `404 QUIZ_NOT_FOUND` como quiz vacío editable en `AdminQuizEditor` y se corrigió el `id` provisional de las preguntas nuevas (el contrato §10.6 exige `id` no vacío). Frontend: **206 tests Vitest verdes** (+4), `tsc --noEmit` limpio; E2E **15/15** con ADM4 como camino feliz. Sin cambios en contratos congelados ni en el backend. Detalle en §10.
- **Nota Fase 4:** requiere `TELAR_ADMIN_PASSWORD` (sin la var, admin deshabilitado). Se levantó el stack con esa variable y se **reconstruyeron** las imágenes backend+frontend para incluir el código de Fase 4.

---

## 1. Resumen ejecutivo

| Flujo | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| **A1–A3** | Preset `spmd` → secuencia de fases en vivo + logs por WebSocket → Resultados con SpeedupChart y barrido 1/2/4/8 | ✅ PASS | `simulador-live.png`, `resultados-speedup.png`, trace/video |
| **A4** | Editar una línea del código y relanzar → resultados/gráfica se regeneran | ✅ PASS | `A4-resultados-regenerados.png`, trace/video |
| **A5** | Lanzar otro job y cancelarlo en vivo → chip **"Cancelado"** | ✅ PASS | `A5-live-antes-de-cancelar.png`, `A5-cancelado.png`, trace/video |
| **B1** | Abrir lección desde el Catálogo → markdown + tabs Descripción/Código/Salida esperada | ✅ PASS | `learn-leccion.png`, trace/video |
| **B2** | "Visto/progreso" es del servidor → sobrevive a borrar `localStorage` y recargar | ✅ PASS | trace/video |
| **B3** | Completar quiz (responder + enviar) → score calculado por el **servidor** y módulo avanza | ✅ PASS | `learn-quiz-resultado.png`, trace/video |
| **B4** | "Probar en el simulador" precarga ese ejemplo | ✅ PASS | trace/video |
| **C** | Home: hero + diagrama fork-join; CTA "Ver lección" → `/#/cursos/primerEjemplo` | ✅ PASS | `home.png`, trace/video |
| **D** | Sanidad: sin errores de consola / `pageerror` / red no justificados | ✅ PASS | `artifacts/console/*.json` (estudiante `[]`; admin solo 401/404 esperados de `/api/v1/admin/*`) |
| **Sandbox** | Aislamiento del runner: network `none`, RootFS RO, `CapDrop=[ALL]`, user 10001 | ✅ PASS | `docker inspect` (§5) |
| **ADM1** | Login gate: guard redirige, contraseña incorrecta → error, correcta → dashboard | ✅ PASS | `admin-login.png`, trace/video |
| **ADM2** | Crear **módulo** desde el diálogo del dashboard | ✅ PASS | `admin-dashboard-modulo-creado.png` |
| **ADM3** | Crear **lección + ejemplo** (.py inline) desde el editor | ✅ PASS | `admin-lesson-editor.png` |
| **ADM4** | Crear el **primer quiz** de la lección **enteramente por la UI** | ✅ **PASS** (BUG-01 resuelto, §10) | `admin-quiz-nuevo-formulario.png`, `admin-quiz-creado.png` |
| **ADM5** | El **estudiante** ve el contenido nuevo: catálogo + markdown + quiz público **sin `correct_key`** + corre en el simulador con el código del admin | ✅ PASS | `admin-student-catalogo.png`, `admin-student-simulador.png` |
| **ADM6** | **Editar** un módulo (cambiar título) desde el diálogo | ✅ PASS | trace/video |
| **ADM7** | Seguridad: sin sesión `/admin/*` = 401 + guard redirige a login | ✅ PASS | trace/video |

---

## 2. Entorno verificado

Stack levantado con Docker Compose (no había `make`; se usó `docker compose` directo):

```
docker compose up -d      # frontend (nginx :8080) + backend (:8000)
```

Readiness comprobada por **polling** (no `sleep` fijo) antes de abrir el navegador:

- `GET /health` → `200 {"status":"ok","checks":{"db":true,"docker":true,"runner_image":true}}`
- `GET /api/v1/system` → `cores=8, max_threads=8, runner_image="telar-runner:0.5.1"`, límites `max_concurrent_jobs=2`, `max_timeout_s=120`.
- Versiones: backend `1.0.0`, python `3.12.13`, **pyomp `0.5.1`**, api `v1`.

Smoke E2E de datos (`bash scripts/smoke.sh`) previo: **8/8 PASS** (job `spmd` completado `exit_code=0`, `parsed_timings.kind=sweep`, quiz calificado por el servidor). *Nota:* `smoke.sh` termina con `docker compose down`; se volvió a levantar el stack antes de la verificación visual.

**Nota Electron:** el mismo build sirve web y escritorio (HashRouter + `base:'./'`). Esta verificación se hizo sobre la **web** (Chromium contra nginx), que es el artefacto ejecutable en este entorno headless; la app Electron comparte byte-a-byte el bundle del frontend.

---

## 3. Metodología (skills e2e-testing / verification-loop / ai-regression)

- **Page Object Model:** un page object por pantalla (`SimulatorPage`, `ResultsPage`, `CatalogPage`, `LearnPage`, `HomePage`); los `.spec.ts` sólo expresan el journey. Selectores tomados del código real (`frontend/src/features/*`), preferentemente `getByRole`/`getByText`/`getByLabel` sobre CSS frágil.
- **`playwright.config.ts`:** `baseURL=http://127.0.0.1:8080`, `retries=1`, `trace:'on-first-retry'`, `screenshot:'only-on-failure'`, `video:'retain-on-failure'`, `workers=1` (los jobs comparten backend y WS en vivo → serial y determinista).
- **Esperas robustas:** `expect.poll`, `getByRole`, `toBeEnabled`, aserciones auto-retry; **cero `sleep` fijos**. La readiness del stack y el fin de job se detectan por señales de UI/DOM (p. ej. el botón "Ver resultados" se habilita al llegar a estado terminal).
- **Grabador de fases (blind spot de estado asíncrono):** la fase `running`/"Ejecutando" dura ~0.5 s; un `getByText(...).toBeVisible()` perezoso la perdía intermitentemente. Se instaló un observador en el DOM (`MutationObserver` + muestreo cada 50 ms sobre los `[role="status"]`) que registra la **secuencia real de chips** que ve el usuario. Secuencia capturada, consistente en 3+ corridas:
  `Conectando… → Preparando → Compilando (JIT) → Ejecutando → Finalizado`.
- **Progreso = servidor (ai-regression):** B2 verifica explícitamente que el progreso proviene del backend borrando **todo** `localStorage` y recargando; el catálogo sigue mostrando la lección completada (viene de `GET /api/v1/modules`, no de `localStorage`, que sólo guarda `lastLessonId`).
- **Score del quiz server-side:** las claves correctas se leyeron del fixture del backend (`content/quizzes/primerEjemplo.json`) **sin mutar el DB**; en la UI se seleccionan las respuestas correctas y se asserta el `4/4` + "Aprobado" + *"corregido por el servidor"* que devuelve el POST del intento.
- **Captura de consola validada:** el fixture engancha `console`, `pageerror` y `requestfailed`. Se **validó el mecanismo** inyectando ruido intencional (`console.error`, `console.warn`, `fetch` a ruta 404) y confirmando que se captura → por tanto los `[]` de los flujos reales son un resultado genuino, no un falso vacío.

---

## 4. Detalle por flujo (aserciones)

### A — Simulador (flujo estrella, WebSocket en vivo)
- **A1–A3:** navegación a `/#/simulador?ejemplo=spmd`; lanzamiento sin editar; el terminal `role="log"` recibe la salida real (`hilos = 1 | pi = 3.1415… | tiempo = … s`); secuencia de fases capturada del DOM contiene la subsecuencia ordenada `Preparando → Compilando (JIT) → Ejecutando → Finalizado`. En Resultados (`/#/resultados/:jobId`): **SpeedupChart es un `<svg>`** con `aria-label="Curva de speedup: máximo Nx"`, **exactamente 4 `<circle>`** (un punto por hilo del barrido 1/2/4/8), **2 `<polyline>`** (observado + ideal), etiquetas de eje **"1 hilo / 2 hilos / 4 hilos / 8 hilos"** y caption `eficiencia a N hilos: N%`.
- **A4:** se edita una línea (comentario insertado al inicio) → aparece el chip **"modificado"**; al relanzar se genera un job nuevo cuyo `parsed_timings.kind` sigue siendo `sweep` y la gráfica se regenera (4 `<circle>` de nuevo).
- **A5:** para una ventana de cancelación **determinista** se lanzó "otro job" con código de larga duración (`time.sleep` con `tick`s); tras alcanzar "Ejecutando" y ver `tick 0` en el terminal, se pulsó **Detener → Sí, detener**; el chip terminó en **"Cancelado"**.

### B — Cursos / Learn (progreso = servidor)
- **B1:** desde el Catálogo (`/#/cursos`, módulo *Fundamentos*) se abre la lección *"Hola mundo paralelo"* (`primerEjemplo`); tab **Descripción** activa por defecto con markdown renderizado; los tabs **Código** (`pre.code-full`) y **Salida esperada** cambian `aria-selected` y muestran su contenido.
- **B3:** se responde el quiz correctamente (4/4, umbral 0.8) y se envía; el resultado muestra **`4/4`**, chip **"Aprobado"** y la nota **"corregido por el servidor"**; el módulo pasa a reflejar la lección como completada.
- **B2:** con la lección ya completada, se borra **todo** `localStorage` y se recarga; el catálogo **sigue** mostrando la fila `.done` y el contador "Lecciones completadas" idéntico (viene del backend). Sanidad inversa: el estado derivado de `localStorage` (botón "Reanudar") **sí** se resetea a "Empezar".
- **B4:** el botón **"Probar en el simulador"** navega a `/#/simulador?ejemplo=primerEjemplo` con el editor precargado con el código del ejemplo.

### C — Home
- Hero `<h1>` "Aprende programación paralela…", **diagrama fork-join** = `<svg role="img">` (`aria-label="Modelo fork-join…"`) con contenido real (rombos maestro/worker t0–t3). El CTA **"Ver lección"** navega a `/#/cursos/primerEjemplo` y esa lección existe (título presente, sin `ErrorState`).

### D — Sanidad de consola
- Flujos de estudiante (A/B/C): **0 mensajes** de consola / `pageerror` / `requestfailed` (`artifacts/console/*.json` `[]`). Mecanismo de captura **validado con ruido intencional** (`console.error`, `console.warn`, 404 → sí se capturan).
- Flujos admin: los **únicos** mensajes son los HTTP esperados de `/api/v1/admin/*` — un **401** del login gate (ADM1, contraseña incorrecta / guard sin sesión) y un **404** `QUIZ_NOT_FOUND` en la **carga inicial** del editor de quiz cuando la lección aún no tiene quiz (ADM4, §10 — estado normal al crear el primero, ya no un defecto). Ambos son el navegador registrando un status HTTP de endpoints admin, no excepciones de la app; se identifican por su URL y no ocultan errores de otros orígenes. Sin `pageerror` ni excepciones de React en ningún flujo.

---

## 5. Evidencia del sandbox (aislamiento del runner)

Con un job en ejecución, `docker inspect` del contenedor etiquetado `telar.job`
(`telar-run-<job_id>`, imagen `telar-runner:0.5.1`):

| Propiedad | Esperado | Observado | ✓ |
|---|---|---|---|
| `NetworkMode` | `none` | `none` (sin IP asignada) | ✅ |
| `ReadonlyRootfs` | `true` | `true` | ✅ |
| `CapDrop` | `[ALL]` | `[ALL]` (`CapAdd` vacío) | ✅ |
| `User` | `10001` (non-root) | `10001` | ✅ |
| `Privileged` | — | `false` | ✅ (extra) |
| `SecurityOpt` | — | `no-new-privileges:true` | ✅ (extra) |
| `PidsLimit` | — | `128` | ✅ (extra) |
| `Memory` | — | `536870912` (512 MB) | ✅ (extra) |
| `NanoCpus` | — | `4000000000` (4 CPU) | ✅ (extra) |

El aislamiento **cumple y supera** lo esperado: sin red (IP vacía en la red `none`),
rootfs de sólo lectura, todas las capabilities descartadas, ejecución como usuario
no-root, sin escalada de privilegios y con límites de PIDs/memoria/CPU.

---

## 5b. Fase 4 — Autoría de cursos (admin)

> **Nota (2026-07-26):** posterior a este informe el "shell propio" se retiró
> (opción B): el modo autoría vive ahora en la MISMA shell del estudiante, con
> acceso desde el menú del `TopBar`. Ver `architecture/fase4-autoria-design.md` §9.

Área nueva `/#/admin` (HashRouter, shell propio + login gate; el estudiante nunca la
ve). Habilitada con `TELAR_ADMIN_PASSWORD`; imágenes backend+frontend **reconstruidas**
para incluir el código de Fase 4. Journey verificado de punta a punta:

- **ADM1 — Login gate (✅):** visitar `/#/admin` sin sesión **redirige** a `/#/admin/login`; contraseña incorrecta → **401** → mensaje "Contraseña incorrecta"; contraseña correcta → dashboard "Módulos del curso".
- **ADM2 — Crear módulo (✅):** diálogo "Nuevo módulo" (id/orden/título/nivel/descripción) → "Crear módulo" → el módulo aparece en el dashboard.
- **ADM3 — Crear lección + ejemplo (✅):** editor `/#/admin/lecciones/nueva` → meta de lección + ejemplo pareado (`lesson_id==example_id`) + código `.py` inline → "Crear lección" → navega al dashboard (prueba de éxito; en error se quedaría con banner).
- **ADM4 — Crear el primer quiz por la UI (✅, BUG-01 resuelto, §10):** con una lección sin quiz, el editor abre un **formulario vacío editable** (el `404 QUIZ_NOT_FOUND` ya no es ErrorState). Se fija el umbral, se añade la primera pregunta (enunciado + opciones A/B + correcta + explicación) y "Guardar quiz" → la SaveBar pasa a **"Todo guardado"**. El quiz creado por la UI persiste (`question_count: 1`, `id` de pregunta válido no vacío) y ADM5 lo comprueba aguas abajo.
- **ADM5 — El estudiante ve lo nuevo (✅):** (a) el **quiz público** (`GET /api/v1/lessons/e2eLeccion/quiz`) **NO** incluye `correct_key` ni `explanation` (invariante de servidor comprobado); (b) el módulo/lección nuevos aparecen en el **catálogo**; (c) la lección **renderiza el markdown** del admin; (d) el ejemplo del admin **corre en el simulador** y su terminal en vivo muestra la salida real `hola desde el ejemplo creado por el admin (E2E)` (ver `admin-student-simulador.png`).
- **ADM6 — Editar módulo (✅):** "Editar" → cambiar título → "Guardar cambios" → el dashboard refleja el título editado.
- **ADM7 — Seguridad (✅):** `GET /api/v1/admin/modules` **sin token → 401 UNAUTHORIZED**; y el guard redirige a login sin sesión. El mensaje 401 es genérico ("Sesión inválida o expirada.") — no distingue contraseña incorrecta de modo deshabilitado (no filtra estado).

---

## 6. Hallazgos y observaciones honestas

### 🐛 BUG-01 (Fase 4) — el editor de quiz no permitía crear el primer quiz de una lección · ✅ RESUELTO (2026-07-14)

> **RESUELTO.** El fix se aplicó y verificó el 2026-07-14 (ver "Resolución" al final de esta sección). El análisis de causa raíz de abajo se conserva como registro de lo hallado. ADM4 es ahora un **camino feliz** (creación por UI) y la suite queda **15/15** verde.

- **Severidad (al hallarlo):** media-alta (bloqueaba un flujo central de autoría: todo quiz nuevo).
- **Síntoma:** tras crear una lección, al abrir su quiz (botón "Quiz" de la fila → `/#/admin/quiz/<id>`) la pantalla muestra **"Algo salió mal · No se pudo cargar el quiz."** con un botón "Reintentar" (que vuelve a fallar). Nunca aparecen "Umbral para aprobar" ni "Añadir pregunta". Evidencia: `admin-quiz-DEFECTO-nuevo.png`.
- **Causa raíz (con evidencia):** `AdminQuizEditor` carga el quiz con `getAdminQuiz(lessonId)` → `GET /api/v1/admin/lessons/{id}/quiz`. Para una lección **sin preguntas** el backend responde **`404 QUIZ_NOT_FOUND`** (verificado por `curl`: `HTTP 404 {"code":"QUIZ_NOT_FOUND"}`). El hook `useAdminResource` propaga ese 404 como `error`, y el render `if (error != null && data == null) return <ErrorState .../>` (`AdminQuizEditor.tsx:146-156`) muestra el estado de error **en lugar de** un formulario de quiz vacío editable. Como no hay otro punto de entrada para crear un quiz, **el primer quiz de una lección es inautorable desde la UI**.
- **Alcance acotado (verificado):** el editor **sí** funciona para quizzes **existentes** — tras crear el quiz vía API, pulsar "Reintentar" carga el formulario con la pregunta. El fallo es específico del estado "lección sin quiz".
- **Por qué no lo detectó el E2E de backend:** ese test usa el `PUT` (upsert) directo, que sí crea el quiz; nunca ejercita la carga del editor con 404. Justo el hueco que cubre la verificación visual independiente.
#### Resolución aplicada (2026-07-14)

- **Fix (frontend, diff mínimo, sin tocar contratos congelados ni el backend):**
  1. En `AdminQuizEditor.tsx` se trata **solo** `ApiError.code === 'QUIZ_NOT_FOUND'` como quiz vacío editable (`effectiveData = data ?? emptyQuiz(lessonId)`, con `pass_threshold: 0.6`, `questions: []`). Cualquier **otro** error (`LESSON_NOT_FOUND`, 401, 500, red…) sigue mostrando el `ErrorState`.
  2. Segundo bloqueo latente descubierto al implementar: una pregunta nueva nacía con `id: ''`, pero el contrato §10.6 exige `id` no vacío (`^[A-Za-z0-9._-]{1,80}$`) → el `PUT` habría dado `422`. `toQuestions` ahora usa la clave estable `_cid` como `id` provisional cuando la pregunta aún no tiene id, de modo que **crear y guardar** funciona por UI.
- **Verificación del fix:** `tsc --noEmit` limpio; **Vitest 206/206** verde (4 tests nuevos: forma vacía en `QUIZ_NOT_FOUND`, `ErrorState` en `LESSON_NOT_FOUND` y en `500`, y crear+guardar con id válido); **E2E 15/15** con ADM4 como camino feliz. Comprobado a runtime que el quiz creado por la UI persiste (`question_count: 1`, `id` = `q-1-…`) y que el **quiz público sigue sin `correct_key`/`explanation`** (ADM5 verde).
- **Impacto del criterio:** "un admin crea quizzes desde `#/admin`" pasa de **FAIL** a **PASS**.

---

1. **Desviación de la literalidad del encargo (NO es un bug) — "la tabla del barrido de hilos 1/2/4/8 con tiempos".**
   El encargo (A3) esperaba una **tabla** de hilos↔tiempos en Resultados. En el producto real **no existe tal tabla**: el barrido `1/2/4/8` se visualiza **exclusivamente** como el **SpeedupChart (SVG)**, donde `1/2/4/8` aparecen como etiquetas del eje X y cada punto muestra el *speedup* (no el tiempo). El campo `time_s` de cada punto del sweep **no se muestra en ninguna parte de la UI** (verificado en `features/results/ResultsCards.tsx` y `components/viz/SpeedupChart.tsx`). El `ThreadsTable` "Detalle por hilo" que sí existe pertenece a la pantalla **live** y es una ilustración por hilo, no el barrido.
   **Veredicto:** el *intent* (mostrar los resultados del barrido 1/2/4/8 con la curva de speedup renderizada) **se cumple** y se asertó sobre el SVG; la "tabla con tiempos" literal **no existe por diseño**. Se reporta como observación de diseño para la memoria, no como fallo. *Recomendación opcional (no bloqueante):* si la tesis requiere exponer los tiempos por hilo, añadir una tabla/detalle textual bajo el chart.

2. **Flaky detectado y corregido de raíz.** En la primera corrida de la suite completa, A1–A3 falló una vez (rescatada por `retries=1`) porque `expect(getByText('Ejecutando')).toBeVisible()` compite con una fase `running` de ~0.5 s. **Causa raíz:** aserción viva perezosa sobre un chip transitorio. **Corrección:** se eliminó esa aserción y la fase "Ejecutando" se verifica ahora mediante el grabador de DOM de 50 ms (que también lee el DOM real). Estabilidad confirmada: **3/3** corridas consecutivas sin flaky.

3. **Consola limpia.** La app no emite ningún `console.*`, `pageerror` ni request fallida en los flujos verificados (build de producción servido por nginx, fuentes self-hosted, sin analytics). Confirmado con mecanismo de captura validado.

4. **Artefacto de dominio (no es fallo).** En algunas corridas el *speedup* a 2 hilos aparece anómalamente alto por el calentamiento del JIT en la línea base de 1 hilo (el ejemplo `spmd` es didáctico y muy corto). No afecta la verificación: las aserciones son sobre la **estructura** del chart (nº de puntos, ejes, líneas), no sobre valores concretos.

---

## 7. Artefactos (entregables)

Raíz: `~/.telar-verify/e2e/artifacts/`

- **Capturas por hito** (`artifacts/shots/*.png`, **16 PNG**): estudiante — `home`, `simulador-live`, `resultados-speedup`, `learn-leccion`, `learn-quiz-resultado`, `A-simulador-idle-spmd`, `A4-resultados-regenerados`, `A5-live-antes-de-cancelar`, `A5-cancelado`; admin — `admin-login`, `admin-dashboard-modulo-creado`, `admin-lesson-editor`, **`admin-quiz-nuevo-formulario`** y **`admin-quiz-creado`** (BUG-01 resuelto: crear el primer quiz por UI), `admin-student-catalogo`, `admin-student-simulador`. *(La corrida previa al fix dejó `admin-quiz-DEFECTO-nuevo.png` como registro histórico del defecto.)*
- **Trace + video por test** (`artifacts/evidence/**`): **15 `trace.zip` + 15 `video.webm`** (corrida verde bajo `playwright.evidence.config.ts` con `trace/video/screenshot: 'on'`).
- **Reporte HTML:** `artifacts/evidence-html-report/index.html` (abrir con `npx playwright show-report artifacts/evidence-html-report`).
- **Logs de consola por test:** `artifacts/console/*.json` (estudiante `[]`; admin solo 401/404 esperados de `/api/v1/admin/*`).
- **Trace de la corrida principal:** `artifacts/test-output/**/trace.zip` (sólo si hubo reintento).

Ver un trace: `npx playwright show-trace ~/.telar-verify/e2e/artifacts/evidence/<carpeta-del-test>/trace.zip`

---

## 8. Cómo reproducir

```bash
# 1) Stack — Fase 4 requiere TELAR_ADMIN_PASSWORD (sin ella, admin deshabilitado).
#    Reconstruir si las imágenes son previas a Fase 4.
cd /mnt/d/universidad/tesis/e-hpc
docker compose build backend frontend
# Habilitar admin: añadir TELAR_ADMIN_PASSWORD al servicio backend (env / override):
#   docker compose -f compose.yaml -f <override-con-TELAR_ADMIN_PASSWORD> up -d
docker compose up -d
curl -s http://127.0.0.1:8080/health         # esperar 200

# 2) Suite (Node 22 vía nvm; ext4). La suite admin usa la contraseña 'e2e-admin-2026'
#    (constante PWD en tests/d-admin.spec.ts) — ajústala a la del backend.
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd ~/.telar-verify/e2e
npx playwright test                                   # config CI-correcta (15 tests)
npx playwright test --config=playwright.evidence.config.ts   # + trace/video para la memoria
```

---

## 9. Conclusión honesta

**Fase 3 (estudiante).** Los cuatro flujos (A Simulador, B Cursos/Learn, C Home, D Sanidad)
funcionan **de punta a punta en un navegador real**, con el WebSocket en vivo transmitiendo
logs y la secuencia de fases correcta, el progreso y la calificación de quizzes gobernados
por el **servidor** (verificado borrando `localStorage`), y los jobs en contenedores Docker
**fuertemente aislados** (sin red, rootfs RO, sin capabilities, non-root). La única
discrepancia es de **literalidad, no de función** (el barrido 1/2/4/8 se muestra como gráfica
de speedup, no como tabla de tiempos). → **PASS**.

**Fase 4 (autoría/admin).** El login gate, la creación de **módulos** y **lecciones+ejemplos**,
la **edición**, la propagación al **estudiante** (catálogo + markdown + quiz público sin
`correct_key` + el `.py` del admin corriendo en el simulador) y la **seguridad** (401 sin
sesión, guard) funcionan. El único defecto hallado —el editor de quiz **no permitía crear el
primer quiz** de una lección (BUG-01, §10)— quedó **RESUELTO y verificado** (2026-07-14): ADM4
es ahora un **camino feliz** que crea el quiz enteramente por la UI, con Vitest 206/206 y
`tsc` limpio. → **PASS del área**, sin defectos abiertos.

**En conjunto:** 15/15 tests verdes, evidencia visual completa (capturas, 15 trace + 15
video), y el único defecto de autoría de quizzes hallado, **root-causado, corregido y
re-verificado**. La plataforma está lista para la memoria.
