# Telar — Catálogo de casos de uso

## 1. Actores

| Actor | Descripción |
|---|---|
| **Estudiante** | Usuario final que aprende: navega el catálogo, lee lecciones, hace quizzes, ejecuta y observa jobs. Es el actor de la app "versión estudiante" (build/imagen sin código admin). |
| **Administrador / Autor de contenido** | Usa el mismo cliente pero con el despliegue admin habilitado (`EHPC_ADMIN_MODE=1` + build `VITE_ADMIN`); gestiona el contenido del curso. No hay login: el rol lo da el despliegue, no una credencial. |
| **Usuario de escritorio** | Estudiante o admin que usa la app empaquetada en Electron en vez del navegador; además controla el stack Docker desde la UI (arrancar/parar). |
| **Sistema (backend)** | Actor no humano: procesos automáticos del backend (orquestación de jobs, reaper de huérfanos, healthcheck) que se disparan por eventos del sistema, no por un click. |
| **Runner (contenedor efímero)** | Ejecuta el código no confiable; no es un actor con intención propia, pero participa como colaborador externo en los casos de uso de ejecución. |

## 2. Mapa de casos de uso

| # | Caso de uso | Actor principal | Categoría |
|---|---|---|---|
| CU-01 | Explorar el catálogo de módulos y lecciones | Estudiante | Aprendizaje |
| CU-02 | Leer una lección | Estudiante | Aprendizaje |
| CU-03 | Responder el quiz de una lección | Estudiante | Aprendizaje |
| CU-04 | Ejecutar un ejemplo del catálogo en el simulador | Estudiante | Simulación |
| CU-05 | Ejecutar código propio desde el editor | Estudiante | Simulación |
| CU-06 | Subir un archivo `.py` para ejecutar | Estudiante | Simulación |
| CU-07 | Observar una ejecución en vivo (logs y métricas) | Estudiante | Simulación |
| CU-08 | Cancelar un job en ejecución | Estudiante | Simulación |
| CU-09 | Ver resultados y gráficas de speedup de un job | Estudiante | Simulación |
| CU-10 | Descargar la salida completa de un job | Estudiante | Simulación |
| CU-11 | Consultar el historial de jobs recientes | Estudiante | Simulación |
| CU-12 | Ver el progreso general de aprendizaje | Estudiante | Aprendizaje |
| CU-13 | Crear un módulo de curso | Administrador | Autoría |
| CU-14 | Editar un módulo de curso | Administrador | Autoría |
| CU-15 | Reordenar módulos | Administrador | Autoría |
| CU-16 | Eliminar un módulo vacío | Administrador | Autoría |
| CU-17 | Crear una lección (con su ejemplo pareado) | Administrador | Autoría |
| CU-18 | Editar una lección | Administrador | Autoría |
| CU-19 | Reordenar lecciones | Administrador | Autoría |
| CU-20 | Eliminar una lección (cascada) | Administrador | Autoría |
| CU-21 | Editar los metadatos de un ejemplo | Administrador | Autoría |
| CU-22 | Subir/reemplazar el código fuente de un ejemplo | Administrador | Autoría |
| CU-23 | Crear o reemplazar el quiz de una lección | Administrador | Autoría |
| CU-24 | Eliminar el quiz de una lección | Administrador | Autoría |
| CU-25 | Probar un ejemplo editado en el simulador | Administrador | Autoría |
| CU-26 | Sembrar / resetear el contenido base (CLI) | Administrador / Operador | Autoría |
| CU-27 | Orquestar la ejecución sandboxed de un job | Sistema (backend) | Infraestructura |
| CU-28 | Recuperar contenedores/jobs huérfanos al arrancar | Sistema (backend) | Infraestructura |
| CU-29 | Reportar salud del sistema | Sistema (backend) | Infraestructura |
| CU-30 | Iniciar la app de escritorio | Usuario de escritorio | Desktop |
| CU-31 | Levantar el stack Docker desde la app de escritorio | Usuario de escritorio | Desktop |
| CU-32 | Detener el stack Docker desde la app de escritorio | Usuario de escritorio | Desktop |
| CU-33 | Consultar el estado de los servicios Docker | Usuario de escritorio | Desktop |
| CU-34 | Abrir un enlace externo desde la app de escritorio | Usuario de escritorio | Desktop |

---

## 3. Casos de uso — Estudiante / Aprendizaje

### CU-01 — Explorar el catálogo de módulos y lecciones

**Actor:** Estudiante. **Disparador:** abre la pantalla *Catálogo* (o *Home*).
**Precondiciones:** backend arriba; contenido sembrado (8 módulos / 14
lecciones en la base o fixtures).

**Flujo principal:**
1. El frontend pide `GET /api/v1/modules`.
2. El backend arma cada módulo con sus lecciones fusionando el contenido
   (fixtures o SQLite, según Fase 3/4) con el progreso persistido del
   estudiante (`lesson_progress`).
3. Cada lección viaja con `progress: {viewed, completed, best_quiz_score,
   quiz_total}`; si no hay registro, se sirven ceros/`null` por defecto.
4. La UI (`CatalogScreen.tsx`) pinta los módulos agrupados, con badges de
   nivel (`Intermedio`/...), progreso por lección y un resumen agregado
   (`summary.lessons_completed/lessons_enabled/...`).
5. La lección GPU (`sumaVectoresGPU`) se muestra con `enabled:false`
   (visible pero no accionable).

**Flujo alternativo:** el `Home` (`HomeScreen.tsx`) hace lo mismo pero
recorta a un resumen + últimos 3 jobs (`GET /jobs?limit=3`) + progreso
global (`GET /progress`), como landing page.

**Postcondición:** el estudiante ve el mapa completo del curso y su avance.

---

### CU-02 — Leer una lección

**Actor:** Estudiante. **Disparador:** clic en una lección del catálogo.
**Precondiciones:** la lección existe y (normalmente) está `enabled`.

**Flujo principal:**
1. El frontend pide `GET /api/v1/lessons/{lesson_id}`.
2. El backend devuelve el markdown completo (`content_markdown`, derivado de
   los `info*.md` de los ejemplos originales), navegación (`prev_lesson_id`,
   `next_lesson_id`), lecciones `recommended` y el `progress` actual.
3. `LearnScreen.tsx` renderiza el markdown (subset controlado: h1-h4,
   listas, código, negrita/cursiva, enlaces `http(s)`/`#`/relativos, tablas
   simples — sin HTML crudo) y muestra el bloque de quiz si `has_quiz`.
4. Al abrir la lección, el frontend marca `viewed=true` vía
   `PUT /api/v1/progress/lessons/{lesson_id}` (ver CU-12).
5. El estudiante puede saltar directo al ejemplo asociado en el simulador
   (`example_id == lesson_id`) o navegar a la lección anterior/siguiente.

**Flujo de error:** `lesson_id` inexistente → `404 LESSON_NOT_FOUND`; la UI
muestra un estado vacío/error.

**Postcondición:** lección marcada como vista; el estudiante tiene el
contenido y, si aplica, accede al quiz.

---

### CU-03 — Responder el quiz de una lección

**Actor:** Estudiante. **Disparador:** completa las respuestas y pulsa
"enviar" en el bloque de quiz de una lección.
**Precondiciones:** la lección tiene quiz (`has_quiz=true`).

**Flujo principal:**
1. La UI pidió antes `GET /api/v1/lessons/{lesson_id}/quiz`: preguntas de
   opción múltiple **sin** la clave correcta (el servidor nunca la expone
   antes del intento).
2. El estudiante selecciona una opción `a|b|c|d` por pregunta.
3. Al enviar, el frontend hace `POST
   /api/v1/lessons/{lesson_id}/quiz/attempts` con `{answers: {qid: key}}`.
4. El backend valida que **todas** las preguntas del quiz vengan respondidas
   con claves existentes (si no, `422 VALIDATION_ERROR`), califica cada
   respuesta contra `correct_key` (server-side, dato que el cliente nunca
   tuvo), calcula `score/total` y `passed = score/total >= 0.8`.
5. Persiste el intento (`quiz_attempts`); si el nuevo score es mejor que
   `lesson_progress.best_quiz_score`, lo actualiza; si `passed`, marca
   `lesson_progress.completed=true`.
6. Responde `201` con el detalle por pregunta (`selected`, `correct_key`,
   `correct`, `explanation`) para que la UI muestre feedback educativo.

**Postcondición:** intento guardado; posible mejora del mejor puntaje y/o
lección marcada como completada, lo que repercute en CU-01/CU-12.

---

### CU-12 — Ver el progreso general de aprendizaje

**Actor:** Estudiante. **Disparador:** abre *Home* o el panel de progreso.

**Flujo principal:**
1. `GET /api/v1/progress` devuelve el mapa `{lessons: {id: {viewed,
   completed, best_quiz_score, quiz_total, last_job_id, updated_at}}}` más
   un `summary` (`lessons_completed/enabled`, `modules_completed/total`).
2. Solo aparecen lecciones con algún registro; el resto se asume en cero.
3. La UI usa esto para las barras de progreso de Home/Catálogo y para
   resaltar "continuar donde quedaste" (`last_job_id`).
4. `viewed`/`completed` también pueden actualizarse manualmente vía
   `PUT /api/v1/progress/lessons/{lesson_id}` (por ejemplo al abrir una
   lección, CU-02); `best_quiz_score`/`last_job_id` **no** son editables por
   este endpoint — los gestiona el backend como efecto lateral de CU-03/CU-04.

**Postcondición:** el estudiante ve cuánto le falta del curso.

---

## 4. Casos de uso — Estudiante / Simulación

### CU-04 — Ejecutar un ejemplo del catálogo en el simulador

**Actor:** Estudiante. **Disparador:** en el Simulador, elige un preset del
catálogo de 14 ejemplos y pulsa "ejecutar".
**Precondiciones:** Docker disponible (`GET /system` con
`runner_image_present=true`); ejemplo `enabled=true` (los de GPU no lo
están).

**Flujo principal:**
1. `SimulatorIdle`/`ExamplePicker` carga `GET /api/v1/examples` (catálogo
   sin código) y, al elegir uno, `GET /api/v1/examples/{id}` (código fuente,
   `takeaways`, nota de output esperado) para el preview.
2. `GET /api/v1/system` informa `cores`, `max_threads = min(8, cores)` y
   límites, para pintar el slider de hilos.
3. Si el ejemplo tiene `threads_configurable=false` (barridos internos como
   `spmd`, o hilos fijos como `monteCarloPi`), el slider se bloquea y se
   muestra `fixed_threads_note`.
4. El estudiante confirma (opcionalmente ajusta hilos/timeout) y el
   frontend envía `POST /api/v1/jobs {example_id, threads?, timeout_s?,
   lesson_id?}`.
5. El backend valida (pydantic + reglas de negocio: ejemplo existe y está
   habilitado, threads en rango, timeout en rango), inserta el job en
   SQLite con `status=queued`, lanza la tarea asíncrona (`_run`) registrada
   en `app.state.jobs` y responde `202` con `job_id`, `ws_url`,
   `threads_effective` y, si aplica, `threads_note` (p.ej. "este ejemplo
   barre 1/2/4/8; se asignan 8 CPUs").
6. La UI navega a la vista *Simulador (live)* y abre el WebSocket del job
   (continúa en CU-07).
7. Al terminar, la UI navega a *Resultados* (CU-09).

**Flujos de error:** `409 EXAMPLE_DISABLED` (ejemplo GPU); `429
TOO_MANY_JOBS` (cola interna llena, >10 en `queued`); `503
DOCKER_UNAVAILABLE`/`RUNNER_IMAGE_MISSING` (infraestructura no lista) — la
UI muestra el motivo y sugiere reintentar o construir la imagen runner.

**Postcondición:** un job queda registrado y en ejecución/encolado; el
estudiante puede seguirlo en vivo.

---

### CU-05 — Ejecutar código propio desde el editor

**Actor:** Estudiante. **Disparador:** escribe/edita código PyOMP en el
`CodePanel` del simulador (partiendo de un preset o desde cero) y ejecuta.

**Flujo principal:**
1. El estudiante edita el código en el editor embebido (puede partir de un
   ejemplo cargado por CU-04 y modificarlo).
2. Al ejecutar, el frontend envía `POST /api/v1/jobs` con `code` (y,
   opcionalmente, `example_id` si partió de un preset — en ese caso
   `source_kind` queda en `"example"` si el código es byte-idéntico al
   fixture, o `"editor"` si lo modificó).
3. El backend valida tamaño (`1..EHPC_MAX_CODE_BYTES`, por defecto 256 KB;
   si no, `413 CODE_TOO_LARGE`), nombre de archivo (patrón estricto
   `^[A-Za-z0-9._-]{1,80}\.py$`), hilos y timeout (defaults: hilos=4,
   timeout=60s si no viene `example_id`).
4. Resto del flujo idéntico a CU-04 desde el paso 5 (creación de job,
   ejecución sandboxed, resultados). Como no hay `example_id` de referencia,
   `parser_id="none"`: no hay gráfica de speedup automática, solo wall-time
   con aviso de que incluye compilación JIT.

**Postcondición:** el estudiante puede experimentar con variaciones propias
del código y ver el resultado real de su ejecución.

---

### CU-06 — Subir un archivo `.py` para ejecutar

**Actor:** Estudiante. **Disparador:** arrastra/selecciona un archivo `.py`
en vez de escribir en el editor.

**Flujo principal:**
1. El frontend envía `multipart/form-data` a `POST /api/v1/jobs/upload` con
   el `file` y, opcionalmente, `threads`/`timeout_s`/`lesson_id`.
2. El backend valida el nombre del archivo con el mismo patrón estricto que
   CU-05, lee por chunks de 64 KB cortando a 256 KB (`413 CODE_TOO_LARGE` si
   excede), decodifica UTF-8 (`422 INVALID_ENCODING` si falla).
3. Resto idéntico a CU-04/05: se crea el job con `source_kind="upload"`.

**Postcondición:** igual que CU-05, partiendo de un archivo en vez de texto
pegado.

---

### CU-07 — Observar una ejecución en vivo (logs y métricas)

**Actor:** Estudiante. **Disparador:** automático tras crear un job
(CU-04/05/06); también al reabrir/reconectar la pestaña del simulador con un
job activo.

**Flujo principal:**
1. El frontend abre `WS {WS_BASE}/ws/jobs/{job_id}`.
2. Si el job está activo, el servidor envía primero un snapshot de `status`
   más el backlog en memoria (ring-buffer, ~500 líneas) y luego el stream en
   vivo; si ya es terminal, envía el `status` final + replay del output
   (desde el ring-buffer si está dentro de los 10 s de retención, o desde la
   DB, renumerando `seq`) + `eof`, y cierra con código `1000`.
3. Mensajes `status`: transiciones de fase `queued → creating → compiling →
   running → completed|failed|timeout|cancelled`. `compiling` cubre el
   "silencio" del JIT de PyOMP (proceso vivo, aún sin stdout); `running`
   arranca en el primer byte de stdout.
4. Mensajes `log`: líneas de stdout/stderr agrupadas (flush cada ~100 ms o
   4 KB), con `seq` monótono para detectar huecos tras una reconexión.
5. Mensajes `metrics` (~1/s, "lossy"): `cpu_percent` (puede superar 100,
   N hilos ≈ N·100%), memoria usada/límite, `pids`, `throttled_periods` —
   alimentan gráficas en vivo de CPU/memoria.
6. `LiveTerminalCard` renderiza logs como terminal; `SweepProgressCard`
   muestra el avance de ejemplos con barrido interno de hilos (1/2/4/8).
7. Al llegar la fase terminal, el cliente pide `GET /api/v1/jobs/{id}` para
   los datos que no viajan por WS (`parsed_timings`, `metrics_summary`) y
   navega a *Resultados*.

**Flujo alternativo:** dos conexiones simultáneas al mismo job (dos
pestañas, doble-mount de React StrictMode) son válidas: el drainer del job
hace fan-out, cada suscriptor recibe el stream completo de forma
independiente.

**Flujo de error:** truncado de salida — al superar 256 KB acumulados el
servidor emite `error OUTPUT_TRUNCATED`, mata el contenedor y el job termina
`failed` (`error_detail="output_limit_exceeded"`).

**Postcondición:** el estudiante ve en tiempo real cómo corre su código.

---

### CU-08 — Cancelar un job en ejecución

**Actor:** Estudiante. **Disparador:** pulsa "cancelar" durante la
ejecución.

**Flujo principal (vía WS, mientras la vista live está abierta):**
1. El frontend envía `{"type":"cancel"}` por el WebSocket del job.
2. Si el job sigue `queued`: el backend marca `cancel_requested`; la tarea
   del job lo comprueba justo tras tomar el turno del semáforo de
   concurrencia y ANTES de crear el contenedor → nunca llega a ejecutarse.
3. Si el job ya tiene contenedor: se fija `kill_reason="cancel"` y se llama
   `container.kill()`, que cierra ejecución y streams a la vez.
4. El job termina con `status="cancelled"`, `error_detail=null`; se emite
   `status` terminal + `eof` y se cierra el WS (código 1000).

**Flujo alternativo (sin WS abierto o desde un listado):**
`POST /api/v1/jobs/{job_id}/cancel` (sin body) hace lo mismo por REST y
responde `202 {status:"cancelling"}`.

**Flujo de error:** cancelar un job ya terminal → `409
JOB_NOT_CANCELLABLE` (o, por WS, se ignora en silencio — idempotente).

**Postcondición:** el job queda en estado terminal `cancelled`; no consume
más recursos.

---

### CU-09 — Ver resultados y gráficas de speedup de un job

**Actor:** Estudiante. **Disparador:** el job llega a un estado terminal (o
el estudiante abre uno antiguo desde el historial).

**Flujo principal:**
1. `GET /api/v1/jobs/{job_id}` devuelve el detalle completo: `status`,
   `exit_code`, `oom_killed`, `error_detail`, tiempos, `stdout`/`stderr`
   completos, `output_truncated`, `metrics_summary` (máximos/promedios de
   CPU/memoria/pids) y `parsed_timings`.
2. `parsed_timings` depende del `parser_id` del ejemplo (calculado en el
   backend al terminar el job, sobre el stdout completo):
   - `kind="sweep"` (ejemplos que barren 1/2/4/8 hilos internamente, p.ej.
     `spmd`, `transporteParticulas`): serie `{threads, time_s, speedup,
     efficiency}` → gráfica de speedup/eficiencia directa.
   - `kind="pair"` (ejemplos que se automiden contra una referencia, p.ej.
     `sumaVectores` vs NumPy, `matrices` vs BLAS, `stencilCalor` paralelo vs
     serial): `parallel_time_s`, `reference_time_s`,
     `speedup_vs_reference`, `correct` (del assert de corrección del
     propio script).
   - `null` para el resto: solo se muestra wall-time con aviso de que
     incluye compilación JIT (nunca se usa como métrica de rendimiento).
3. `ResultsScreen`/`ResultsCards` pintan tarjetas con exit code, tiempo
   total, uso de CPU/memoria y, si hay `parsed_timings`, la gráfica de
   speedup/eficiencia.
4. Si `output_truncated=true`, se muestra el aviso correspondiente
   (`parsed_timings` es `null` en ese caso: no se parsea salida incompleta).

**Postcondición:** el estudiante interpreta el resultado pedagógico de su
ejecución (p.ej. "por qué `spmd` no escala pese a 8 hilos").

---

### CU-10 — Descargar la salida completa de un job

**Actor:** Estudiante. **Disparador:** botón "descargar output" en
Resultados.

**Flujo principal:**
1. `GET /api/v1/jobs/{job_id}/output?stream=combined|stdout|stderr`.
2. Si el job es terminal, el backend responde `text/plain` (sin envelope)
   con `Content-Disposition: attachment; filename="<nombre>-<jobid8>.txt"`;
   si la salida fue truncada, añade una línea final indicándolo.

**Flujo de error:** `409 JOB_NOT_FINISHED` si el job aún no terminó;
`404 JOB_NOT_FOUND`; `422 VALIDATION_ERROR` si `stream` no es uno de los
tres valores válidos.

**Postcondición:** el estudiante tiene el log completo como archivo local.

---

### CU-11 — Consultar el historial de jobs recientes

**Actor:** Estudiante. **Disparador:** abre la lista de jobs (Home o una
sección de historial).

**Flujo principal:**
1. `GET /api/v1/jobs?limit=&offset=&status=` devuelve un listado resumido
   (sin código ni stdout) con `job_id`, `filename`, `source_kind`, estado,
   `threads`, `wall_time_ms`, timestamps — paginado (`meta.total`).
2. El estudiante puede filtrar por estado y hacer clic para reabrir el
   detalle (CU-09) de un job pasado.

**Postcondición:** el estudiante retoma o audita ejecuciones anteriores.

---

## 5. Casos de uso — Administrador / Autoría de contenido (Fase 4)

> Precondición común a todo este bloque: el despliegue está en **modo
> admin** (`EHPC_ADMIN_MODE=1` en el backend + build `VITE_ADMIN=1` en el
> frontend). No hay login: si el despliegue es "estudiante", cualquier
> `/api/v1/admin/*` responde `401 UNAUTHORIZED` (o `404` si además el
> artefacto es la imagen backend "estudiante", que ni siquiera compila el
> código admin — ver `EHPC_ADMIN_BUILD`). El admin entra por el ítem
> "Autoría" del Sidebar (`AdminDashboard.tsx`, ruta `#/admin`).

### CU-13 — Crear un módulo de curso

**Flujo principal:**
1. Desde el dashboard admin, el administrador abre "nuevo módulo"
   (`ModuleFormDialog`) y completa `id`, `order`, `title`, `description`,
   `level`.
2. `POST /api/v1/admin/modules` valida `id` único (`409 DUPLICATE_ID`) y
   `order` único y `>0` (`409 ORDER_CONFLICT`), o falla de esquema (`422
   CONTENT_VALIDATION_ERROR`).
3. Al persistir, el backend recarga atómicamente el snapshot de contenido en
   memoria bajo `write_lock`: el siguiente `GET` público ya sirve el módulo
   nuevo, sin estados a medias.

**Postcondición:** módulo nuevo visible de inmediato en el catálogo público.

---

### CU-14 — Editar un módulo de curso

`PUT /api/v1/admin/modules/{id}` con `{order, title, description, level}`
(`lessons` es derivado, no se envía). Mismas validaciones que CU-13 salvo
unicidad de `id`. Errores: `404 MODULE_NOT_FOUND`, `409 ORDER_CONFLICT`,
`422`.

---

### CU-15 — Reordenar módulos (o lecciones)

**Motivación:** `order` es único e inmediato; intercambiar dos módulos con
dos `PUT` secuenciales siempre falla en el primero (`409 ORDER_CONFLICT`).

**Flujo principal:**
1. El administrador reordena por drag-and-drop en el dashboard.
2. El frontend envía **un solo** `PUT /api/v1/admin/modules/reorder` (o
   `.../lessons/reorder`) con `{items: [{id, order}, ...]}`.
3. El backend valida que cada `id` exista (`404`), que no haya `id`
   repetido, y que el conjunto **final** de `order` (tocados + intactos)
   sea único y `>0` (`409 ORDER_CONFLICT`).
4. Aplica la reasignación en una sola transacción con un "parking" temporal
   de valores para no violar el `UNIQUE` a mitad de camino.
5. Devuelve el listado admin completo ya reordenado.

**Postcondición:** nuevo orden persistido de forma atómica; sin estados
intermedios inválidos.

---

### CU-16 — Eliminar un módulo vacío

`DELETE /api/v1/admin/modules/{id}`. Si el módulo aún tiene lecciones →
`409 MODULE_NOT_EMPTY` (hay que mover/borrar las lecciones primero, CU-20).
Si no, se borra y responde `{deleted:true, id}`.

---

### CU-17 — Crear una lección (con su ejemplo pareado)

**Contexto:** invariante de dominio `lesson_id == example_id` — una lección
siempre nace con exactamente un ejemplo asociado; no existen ejemplos
sueltos.

**Flujo principal:**
1. El administrador abre el editor de lección (`AdminLessonEditor.tsx`) y
   completa metadatos de lección (`module_id`, `order`, `title`,
   `estimated_minutes`, `content_markdown` vía `MarkdownEditor`,
   `recommended`) y del ejemplo pareado (`AdminExampleEditor` /
   `ExampleMetaFields`: título, filename, dificultad, directivas, si los
   hilos son configurables, `parser_id`, timeout, GPU, `source_code`,
   `takeaways`).
2. `POST /api/v1/admin/lessons` con `AdminLessonCreate` (base + `id` +
   `example` + `source_code`) crea **ambas filas en una sola transacción**.
3. Validaciones (todas `422 CONTENT_VALIDATION_ERROR` salvo donde se
   indica): `module_id` existe (`404 MODULE_NOT_FOUND`); `id` no usado —
   namespace compartido lección/ejemplo (`409 DUPLICATE_ID`); `order` de
   lección único (`409 ORDER_CONFLICT`); `parser_id` es uno de los 6
   válidos; `filename` cumple el patrón `.py`; `source_code` entre 1 byte y
   el máximo (`413 CODE_TOO_LARGE`); `content_markdown` dentro del subset
   permitido (sin HTML crudo, fences cerrados); coherencia hilos
   (`threads_configurable=true ⇒ fixed_threads=null`, etc.); GPU
   (`requires_gpu=true ⇒ enabled=false`); `recommended[].lesson_id`
   referencian lecciones existentes y no a sí misma.
4. Tras el `201`, la lección y su ejemplo quedan disponibles de inmediato en
   los `GET` públicos (CU-01/CU-02/CU-04).

---

### CU-18 — Editar una lección

`PUT /api/v1/admin/lessons/{id}` con `AdminLessonUpdate` (mismos campos base
que la creación, sin `id`/`example`). Mismas reglas de validación de
contenido que CU-17 (markdown, referencias, orden). Errores: `404`, `409
ORDER_CONFLICT`, `422`.

---

### CU-19 — Reordenar lecciones

Igual mecánica que CU-15 pero sobre lecciones:
`PUT /api/v1/admin/lessons/reorder` con el mismo `AdminReorderRequest`;
devuelve el listado de módulos ya con las lecciones reordenadas
intra-módulo.

---

### CU-20 — Eliminar una lección (con purga en cascada)

**Flujo principal:**
1. `DELETE /api/v1/admin/lessons/{id}`.
2. En una sola transacción: borra la lección, su ejemplo pareado y su quiz
   (CASCADE); limpia referencias colgantes en `recommended` de otras
   lecciones.
3. **Purga adicional (extensión deliberada, no solo limpieza referencial):**
   borra también las filas de `lesson_progress` y `quiz_attempts` de ese
   `lesson_id`. Motivo: esas tablas no tienen FK a `lessons`; si el `id` se
   reutilizara luego, heredaría `completed`/`best_quiz_score` de contenido
   que el estudiante nunca vio. Las filas de `jobs` (con `lesson_id`
   textual) **sí** se conservan como telemetría histórica.

**Postcondición:** lección, ejemplo, quiz y todo el progreso/historial de
quiz asociado desaparecen; los jobs ya ejecutados permanecen en el
historial.

---

### CU-21 — Editar los metadatos de un ejemplo

`GET /api/v1/admin/examples/{id}` (detalle con código) /
`PUT /api/v1/admin/examples/{id}` con `AdminExampleUpdate` (título,
filename, dificultad, `teaches`, `directives`, flags de hilos,
`parser_id`, timeout, `enabled`, `requires_gpu`, `takeaways`, etc.). Mismas
reglas de coherencia hilos/GPU que CU-17. No incluye el código fuente (eso
es CU-22).

---

### CU-22 — Subir/reemplazar el código fuente de un ejemplo

**Flujo principal:**
1. El administrador arrastra un `.py` en `CodeDropzone` o pega JSON.
2. `POST /api/v1/admin/examples/{id}/code` acepta `multipart` (`file`) **o**
   JSON (`AdminExampleCodeRequest`).
3. Reutiliza el **mismo validador estricto** que la subida del estudiante
   (CU-06): filename `^[A-Za-z0-9._-]{1,80}\.py$`, ≤256 KB leídos por
   chunks, decodificación UTF-8.
4. Guarda `source_code` + `filename` en la fila del ejemplo. Responde
   `{example_id, filename, bytes}`.

**Nota de seguridad:** el `.py` subido por el admin es tan no confiable como
el del estudiante y corre en el **mismo** runner sandbox, sin relajar nada.

---

### CU-23 — Crear o reemplazar el quiz de una lección

**Flujo principal:**
1. `PUT /api/v1/admin/lessons/{id}/quiz` con `AdminQuizUpsert`
   (`pass_threshold` + lista de `AdminQuizQuestion {id?, order, text,
   options[2-4], correct_key, explanation}`) — **reemplaza el set
   completo**, no hace merge incremental.
2. Si el `id` de una pregunta se omite, el servidor lo autogenera como
   `{lesson_id}-q{order}`; si se provee, debe cumplir el patrón de id.
3. Validaciones: `correct_key` debe estar entre las `options`; sin ids ni
   claves de opción duplicados.
4. **Reconciliación de progreso (extensión deliberada):** si cambia el
   número de preguntas o el `pass_threshold` respecto al quiz anterior, el
   backend resetea `lesson_progress.best_quiz_score=NULL` y
   `completed=false` de esa lección en la misma transacción (una edición
   puramente cosmética de textos, con igual conteo y umbral, no toca el
   progreso). Razón: un puntaje sobre un total distinto, o "aprobado" bajo
   otro umbral, es una nota que ya no significa nada.
5. Este es el **único** endpoint que devuelve `correct_key`/`explanation`;
   el `GET` público (CU-03) las sigue ocultando siempre.

---

### CU-24 — Eliminar el quiz de una lección

`DELETE /api/v1/admin/lessons/{id}/quiz`. Igual que en CU-23, resetea
siempre `best_quiz_score`/`completed` de esa lección (ya no hay quiz que
justifique un aprobado).

---

### CU-25 — Probar un ejemplo editado en el simulador

**Flujo principal:**
1. Desde el editor de ejemplo, el administrador pulsa "probar en
   simulador".
2. La UI navega a `/simulador?ejemplo={id}` y reutiliza el pipeline de jobs
   normal (CU-04) tal cual — no existe un endpoint de "test-run" separado.
3. El admin ve resultados/gráficas igual que un estudiante, para verificar
   que el ejemplo que acaba de editar produce el output esperado por su
   `parser_id` antes de publicarlo.

---

### CU-26 — Sembrar / resetear el contenido base (CLI)

**Actor:** administrador/operador con acceso a shell del backend (no es un
flujo de UI).

**Flujo principal:**
1. Al primer arranque del backend, si las tablas de contenido están vacías,
   se siembran automáticamente los 14 ejemplos + 60 preguntas desde los
   fixtures versionados de `backend/app/content/`.
2. Operaciones manuales disponibles como comandos:
   - `python -m app.tools.seed_content` — UPSERT idempotente (no pierde
     ediciones existentes del admin).
   - `python -m app.tools.seed_content --prune` — además borra contenido
     que no esté en el baseline de fixtures.
   - `python -m app.tools.seed_content --check` — verifica que los
     fixtures ≡ contenido en DB; sale con código ≠0 si difieren (uso en
     CI/verificación).

**Postcondición:** la base de contenido queda alineada con la versión
congelada en el repositorio (o se detecta la divergencia).

---

## 6. Casos de uso — Sistema (backend, automáticos)

### CU-27 — Orquestar la ejecución sandboxed de un job

**Actor:** Sistema (backend). **Disparador:** cualquiera de CU-04/05/06/25
crea un job. Es el mecanismo interno común a todos ellos.

**Flujo principal:**
1. `job_runner` adquiere un cupo del semáforo `EHPC_MAX_CONCURRENT_JOBS`
   (por defecto 2); jobs adicionales quedan `queued` (cola interna máx. 10,
   si se excede → `429 TOO_MANY_JOBS` al crear).
2. Comprueba `cancel_requested` (ver CU-08) antes de crear el contenedor.
3. Entrega el código al runner según `EHPC_CODE_DELIVERY`: `bind` (backend
   nativo en dev, escribe en `~/.ehpc/jobs/<job_id>/main.py`) o `volume`
   (compose/prod, escribe en el volumen nombrado `ehpc_submissions`,
   montado por el runner con `subpath=<job_id>`).
4. `docker_service.run_job` crea y arranca el contenedor `ehpc-runner` con
   **17 mecanismos de aislamiento en capas** (ver tabla completa en
   `architecture.md` §4): `network_mode="none"`, usuario no-root `10001`,
   `cap_drop=ALL`, `no-new-privileges`, rootfs `read_only` + `tmpfs /tmp`
   `noexec`, `mem_limit=512m` sin swap, `pids_limit=128`,
   `nano_cpus`/`cpuset_cpus` igual al número de hilos elegido, `ulimits`
   (nofile/fsize), `init=True` (tini), código montado `:ro`, timeout duro,
   truncado de output a 256 KB, labels para el reaper (CU-28), imagen fija
   sin input del usuario en `HostConfig`.
5. Dos hilos daemon (puente sync→async, porque docker-py es síncrono)
   drenan logs (con backpressure contra el drainer, nunca contra un
   cliente) y stats (~1/s, "lossy") hacia colas `asyncio`.
6. El **drainer del job** (tarea propia, viva desde `create/start` hasta
   `finish()`, exista o no un cliente WS conectado) consume esas colas:
   aplica el presupuesto de 256 KB, acumula stdout/stderr completos (única
   fuente de lo que se persiste — nunca se relee `container.logs()`),
   alimenta el ring-buffer de backlog y hace fan-out a cada conexión WS
   suscrita.
7. Termina por una de cuatro vías: éxito (`exit_code==0`), fallo
   (`exit_code!=0`, OOM, error del sandbox, o `output_limit`), timeout duro
   (`wait(timeout)` agotado → `kill()`), o cancelación del usuario.
8. `finish()` deriva `status`/`error_detail` **exclusivamente** de
   `kill_reason + exit_code + OOMKilled` (prioridad si coinciden:
   `cancel > output_limit > timeout`), con un *guard* que impide
   sobrescribir un estado ya terminal.
9. Aplica el parser correspondiente (`parser_id`) sobre el stdout completo
   para producir `parsed_timings` (speedup/eficiencia) — solo si la salida
   no fue truncada.
10. En el `finally`: `remove(force=True, v=True)` del contenedor y borrado
    del directorio de código del job.

**Postcondición:** el job queda en un estado terminal consistente en DB, con
sus métricas y tiempos parseados listos para CU-09.

---

### CU-28 — Recuperar contenedores/jobs huérfanos al arrancar

**Actor:** Sistema (backend). **Disparador:** arranque del proceso backend
(lifespan de FastAPI) — típicamente tras un crash o reinicio.

**Flujo principal:**
1. Lista contenedores con el label `ehpc.runner=true`
   (`containers.list(all=True, filters=...)`) y los elimina por la fuerza.
2. Marca como `failed` (`error_detail="orphaned_on_restart"`) todo job en
   DB que haya quedado en un estado no terminal (`queued/creating/
   compiling/running`) sin contenedor vivo asociado.
3. Borra todos los directorios de código huérfanos (`/submissions/*` en
   compose, `~/.ehpc/jobs/*` en dev): son efímeros por definición y, tras un
   crash, el `finally` del job (CU-27, paso 10) nunca llegó a correr.

**Postcondición:** no quedan contenedores fantasma consumiendo recursos ni
jobs "colgados" en estado activo tras un reinicio.

---

### CU-29 — Reportar salud del sistema

**Actor:** Sistema (backend), consumido por el healthcheck de Docker
Compose y por el `RuntimeFooter` de la UI web.

**Flujo principal:**
1. `GET /health` (sin el envelope estándar, formato plano deliberado):
   `{"status":"ok","checks":{"db":true,"docker":true,"runner_image":true}}`.
2. Semántica **liveness, no readiness**: responde `200` si la app arrancó y
   la DB responde, aunque `docker` o `runner_image` sean `false` (son
   informativos). Solo `503` si la DB no responde o el lifespan no
   completó. Esto evita el deadlock de primer arranque: nginx puede
   arrancar y mostrar la UI aunque la imagen runner todavía no exista.
3. `GET /api/v1/system` complementa con info accionable para la UI:
   `cores`, `max_threads`, `runner_image_present`, `gpu_examples_enabled`,
   versiones, y los límites (`max_code_bytes`, `max_timeout_s`,
   `max_concurrent_jobs`, `max_output_bytes`) — con esto la UI guía al
   usuario si falta construir la imagen del runner.

**Postcondición:** operador/orquestador y UI saben si el sistema está apto
para aceptar jobs.

---

## 7. Casos de uso — Usuario de escritorio (Electron)

### CU-30 — Iniciar la app de escritorio

**Flujo principal:**
1. El usuario abre el AppImage/`.deb` (Linux) o el instalador NSIS/portable
   (Windows).
2. `main.ts` crea una única `BrowserWindow` (single-instance lock),
   `webPreferences` endurecidas (`contextIsolation:true`,
   `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`), CSP propia
   vía `onHeadersReceived`, y carga el **mismo build** de React que la web
   (`loadFile` sobre el recurso empaquetado, protocolo `file://`), sin menú
   nativo en producción.
3. `preload.ts` expone `window.ehpc = {appVersion, platform, dockerStatus,
   dockerUp, dockerStop, openExternal}` vía `contextBridge` — nunca
   `ipcRenderer` crudo.
4. El frontend detecta plataforma (`window.ehpc !== undefined` ⇒ desktop) y
   apunta la API/WS a `http://localhost:8000` / `ws://localhost:8000` en
   vez de rutas relativas.

**Postcondición:** la app queda lista; si el backend/Docker aún no están
arriba, la UI lo refleja y ofrece levantar el stack (CU-31).

---

### CU-31 — Levantar el stack Docker desde la app de escritorio

**Flujo principal:**
1. El usuario pulsa "iniciar" en el panel de estado Docker de la UI.
2. El renderer invoca `window.ehpc.dockerUp()` → IPC `docker:run` con la
   acción cerrada `'compose:up'`.
3. `ipc-docker.ts` valida que el remitente sea el frame principal confiable
   (`file://` en prod o el origin del dev-server) antes de ejecutar nada.
4. Ejecuta, en secuencia y en el mismo `cwd` (directorio del compose
   empaquetado o `EHPC_COMPOSE_DIR`): `docker compose --profile build build
   runner` y luego `docker compose up -d` — vía `execFile` **sin shell**,
   con timeout y `maxBuffer` acotados (el build del runner, ~777 MB, puede
   tardar minutos).
5. Si algo falla (Docker no instalado, sin red al registry, etc.), el error
   de stderr se sanea y se acota antes de devolverlo al renderer; la UI
   muestra el error con un enlace a la guía, sin colgarse.

**Postcondición:** el stack (frontend/backend/runner) queda arriba y la app
puede empezar a operar normalmente.

---

### CU-32 — Detener el stack Docker desde la app de escritorio

Igual mecánica que CU-31: `window.ehpc.dockerStop()` → IPC `docker:run`
acción `'compose:stop'` → `docker compose stop` en el mismo `cwd`.

---

### CU-33 — Consultar el estado de los servicios Docker

**Flujo principal:**
1. El renderer llama `window.ehpc.dockerStatus()` → IPC `docker:run` acción
   `'compose:ps'` → `docker compose ps --format json`.
2. `parseComposePs` interpreta la salida NDJSON (un objeto JSON por línea)
   de Compose v2+, descarta líneas no parseables, y devuelve una estructura
   tipada `ComposeService[]` (`name`, `service`, `state`, `health`) — el
   renderer **nunca** recibe stdout crudo.
3. La UI pinta el estado de cada servicio (arriba/abajo/healthy) en el
   panel de estado.

---

### CU-34 — Abrir un enlace externo desde la app de escritorio

**Flujo principal:**
1. El usuario hace clic en un enlace externo (p.ej. documentación) dentro de
   la app.
2. El renderer invoca `window.ehpc.openExternal(url)` → IPC
   `shell:open-external`.
3. El main process valida remitente confiable, parsea la URL (lanza si no
   es válida) y **exige protocolo `https:`** — cualquier otro esquema se
   rechaza.
4. Si es válida, `shell.openExternal` la abre en el navegador por defecto
   del sistema (fuera de la ventana de Electron).

**Postcondición:** navegación externa aislada de la ventana de la app, sin
posibilidad de abrir esquemas peligrosos (`file:`, `javascript:`, etc.).

---

