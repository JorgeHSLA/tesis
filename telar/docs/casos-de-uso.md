# Telar — Catálogo de casos de uso

> **Numeración.** Este catálogo usa los **41 CU** de
> [`audits/auditoria-cu-2026-09-18.md`](audits/auditoria-cu-2026-09-18.md), la
> misma que el [informe de evaluación de mejoras](audits/informe-evaluacion-mejoras-2026-09-22.md)
> y los commits de las sesiones S1–S8. Los faltantes se citan como `CU-NN.M`: son
> identificadores estables, no un orden. La numeración anterior (34 CU) se
> conserva solo en la tabla de equivalencias del §3.
>
> **Estado a 2026-09-26** (cierre de la sesión S8). 🟢 = el recorrido normal
> funciona; 🟡 = falta algo que afecta a un escenario normal; 🔴 = falta la
> capacidad central; ⚪ = fuera de alcance (decisión del 2026-11-18, §4.5).
> Lo que quedó fuera a propósito está en el §6 («Limitaciones conocidas»).

## 1. Actores

| Actor | Descripción |
|---|---|
| **Estudiante** | Usuario final que aprende: recorre el catálogo, hace lecciones, talleres y quizzes, ejecuta código en el simulador y consulta sus resultados. Usa la app «versión estudiante» (build e imagen sin el código de Autoría). |
| **Administrador / Autor** | Usa el mismo cliente con el despliegue de autoría (`TELAR_ADMIN_MODE=1` + build `VITE_ADMIN`). Gestiona el contenido y lo publica en el catálogo remoto. No hay login: el rol lo da el despliegue, no una credencial. Para publicar necesita además la cuenta de servicio de GCS (`TELAR_GCS_CREDENTIALS`). |
| **Usuario** | Estudiante o administrador indistintamente (instalar Telar, explorar el catálogo remoto). |
| **Usuario de escritorio** | Cualquiera de los anteriores en la app empaquetada en Electron, que además arranca y detiene los servicios Docker desde la UI. |
| **Sistema (backend)** | Actor no humano: orquestación de jobs, recuperación al arrancar, healthcheck. Se dispara por eventos, no por un clic. |
| **Runner (contenedor efímero)** | Ejecuta el código no confiable. No tiene intención propia; participa como colaborador en los CU de ejecución. |

## 2. Mapa de casos de uso

| CU | Caso de uso | Actor principal | Área | Estado |
|---|---|---|---|:-:|
| CU-01 | Explorar el catálogo de módulos y lecciones | Estudiante | Aprendizaje | 🟢 |
| CU-02 | Realizar una lección | Estudiante | Aprendizaje | 🟢 |
| CU-03 | Responder el quiz de una lección | Estudiante | Aprendizaje | 🟢 |
| CU-04 | Ejecutar un ejemplo de una lección en el simulador | Estudiante | Simulación | 🟢 |
| CU-05 | Ejecutar código propio desde el editor | Estudiante | Simulación | 🟢 |
| CU-06 | Subir un archivo `.py` para ejecutar | Estudiante | Simulación | 🟢 |
| CU-07 | Observar una ejecución en vivo | Estudiante | Simulación | 🟢 |
| CU-08 | Cancelar una ejecución | Estudiante | Simulación | 🟢 |
| CU-09 | Consultar resultados y métricas de una ejecución | Estudiante | Simulación | 🟢 |
| CU-10 | Descargar la salida de una ejecución | Estudiante | Simulación | 🟢 |
| CU-11 | Consultar ejecuciones recientes | Estudiante | Simulación | 🟢 |
| CU-12 | Consultar el progreso de un curso | Estudiante | Aprendizaje | 🟢 |
| CU-13 | Crear un módulo de curso | Administrador | Autoría | 🟢 |
| CU-14 | Editar un módulo de curso | Administrador | Autoría | 🟢 |
| CU-15 | Reordenar módulos de un curso | Administrador | Autoría | 🟢 |
| CU-16 | Eliminar un módulo de curso | Administrador | Autoría | 🟢 |
| CU-17 | Crear una lección | Administrador | Autoría | 🟢 |
| CU-18 | Editar una lección | Administrador | Autoría | 🟢 |
| CU-19 | Reordenar lecciones | Administrador | Autoría | 🟢 |
| CU-20 | Eliminar una lección | Administrador | Autoría | 🟢 |
| CU-21 | Editar un ejemplo | Administrador | Autoría | 🟢 |
| CU-22 | Probar un ejemplo en el simulador | Administrador | Autoría | 🟢 |
| CU-23 | Gestionar el contenido base (CLI) | Administrador / Operador | Autoría | 🟢 |
| CU-24 | Gestionar una ejecución aislada | Sistema | Infraestructura | 🟢 |
| CU-25 | Recuperar ejecuciones inconsistentes al iniciar | Sistema | Infraestructura | 🟢 |
| CU-26 | Reportar salud del sistema | Sistema | Infraestructura | 🟢 |
| CU-27 | Iniciar la aplicación de escritorio | Usuario de escritorio | Escritorio | 🟢 |
| CU-28 | Realizar un taller guiado | Estudiante | Aprendizaje | 🟢 |
| CU-29 | Seguir la progresión recomendada del curso | Estudiante | Aprendizaje | 🟢 |
| CU-30 | Comparar ejecuciones | Estudiante | Simulación | 🟢 |
| CU-31 | Exportar resultados y métricas de ejecuciones | Estudiante | Simulación | 🟢 |
| CU-32 | Guardar y reutilizar una configuración de ejecución | Estudiante | Simulación | 🟢 |
| CU-33 | Instalar Telar | Usuario | Escritorio | 🟢 |
| CU-34 | Explorar el catálogo remoto de módulos | Usuario | Catálogo | 🟢 |
| CU-35 | Descargar e incorporar un módulo a Telar | Estudiante | Catálogo | 🟢 |
| CU-36 | Descargar un módulo para edición | Administrador | Catálogo | 🟢 |
| CU-37 | Publicar un módulo | Administrador | Catálogo | 🟢 |
| CU-38 | Actualizar un módulo incorporado | Estudiante | Catálogo | 🟢 |
| CU-39 | Crear un curso | Administrador | Catálogo | ⚪ |
| CU-40 | Editar información de un curso | Administrador | Catálogo | ⚪ |
| CU-41 | Retirar un módulo del catálogo | Administrador | Catálogo | 🟢 |

**Recuento:** 39 🟢 · 0 🟡 · 0 🔴 · 2 ⚪ (CU-39 y CU-40, fuera de alcance, §4.5).
En el catálogo oficial de la tesis (Excel) CU-27 y CU-33 figuran como
*Parcial*: el código está completo, pero falta documentar con evidencia la
instalación en Linux que exige RNF-07. Allí el recuento es 37 implementados,
2 parciales y 2 fuera de alcance.

## 3. Equivalencia con la numeración anterior (34 CU)

| Antes | Ahora | Antes | Ahora |
|---|---|---|---|
| CU-01 | CU-01 | CU-18 | CU-18 |
| CU-02 «Leer una lección» | CU-02 «Realizar una lección» | CU-19 | CU-19 |
| CU-03 | CU-03 | CU-20 | CU-20 |
| CU-04 … CU-11 | CU-04 … CU-11 | CU-21 + CU-22 (metadatos y código del ejemplo) | CU-21 |
| CU-12 | CU-12 | CU-23 + CU-24 (crear/eliminar quiz) | CU-18 (el quiz es parte de editar la lección) |
| CU-13 … CU-15 | CU-13 … CU-15 | CU-25 | CU-22 |
| CU-16 «Eliminar un módulo vacío» | CU-16 (también con lecciones) | CU-26 | CU-23 |
| CU-17 «con su ejemplo pareado» | CU-17 (ejemplo opcional) | CU-27 · CU-28 · CU-29 | CU-24 · CU-25 · CU-26 |
| | | CU-30 … CU-34 (escritorio) | CU-27 |

Nuevos respecto al catálogo anterior: CU-28 a CU-41.

> **Aviso para quien lea el contrato.** `docs/architecture/api-contract.md` §11 se
> escribió en la Fase 5 con otra numeración del catálogo remoto: allí CU-35 es
> «explorar», CU-36 «incorporar», CU-37 «descargar para edición», CU-38 «publicar»
> y CU-39 «actualizar». Equivalen a CU-34, 35, 36, 37 y 38 de este documento. El
> contrato está congelado y no se renumera.

## 4. Decisiones de diseño transversales

### 4.1 El taller es un tipo de lección

Un taller (CU-28) **no es un componente** que se suma a una lección, como el
video o el quiz: es **otro tipo de lección** (`lessons.kind = 'taller'`), una
guía de pasos ordenados con una casilla «Lo hice» por paso, al estilo de los
tutoriales de Unity Learn. No lleva quiz ni video. Se completa al marcar todos
sus pasos, y entonces cuenta en el progreso del módulo como cualquier lección.
Por eso el antiguo faltante CU-02.1 («taller asociado a la lección») se
reclasificó a CU-28, y CU-02.2 («componentes obligatorios y opcionales») dejó de
hacer falta. Contrato: `api-contract.md` §12. Esquema: `data-model.md` §9.

### 4.2 Una sola regla de completitud por lección (diseño A)

Cada lección tiene una `completion_rule` ∈ {`quiz`, `viewed`, `run`}, y solo esa
regla la completa:

- `quiz`: aprobar su quiz (CU-03);
- `viewed`: pulsar «Marcar como leída» (CU-02);
- `run`: terminar en `completed` un job del **ejemplo de esa lección**
  (CU-04; `POST /jobs` rechaza un `lesson_id` que no corresponde al ejemplo).

En un taller la regla guardada es `viewed` y se ignora: lo completan sus pasos.
`completed` es **monótono** (nunca se revierte) y la decisión se toma al
escribir el progreso, contra la base, dentro del `write_lock`.

### 4.3 Una sola regla de disponibilidad

Una lección **cuenta para el progreso** si `enabled and not archived`
(`cuenta_para_progreso`, y su versión SQL `SQL_CUENTA_PARA_PROGRESO`). La misma
regla decide los totales de `/modules` y `/progress`, la navegación
Anterior/Siguiente, «Continuar/Empezar» y si una vía de completitud puede
completar la lección. Ninguna vía completa una lección deshabilitada o
archivada.

### 4.4 Borrador y publicado: opción D+

En la máquina del autor, lo que se edita en Autoría es lo mismo que muestra
«Aprender»: el contrato congelado (§10.1) exige que tras un `2xx` el siguiente
GET sirva el contenido nuevo. La separación que importa, **estudiante frente a
autor**, ya existe **entre máquinas**: la app del estudiante no incluye el
código de Autoría y solo recibe contenido por la siembra inicial o por bundles
inmutables y versionados del catálogo (CU-35, CU-38).

D+ hace visible y segura esa situación sin tablas espejo ni snapshots:

1. **Aviso de vista previa.** En el build de autoría, las rutas `/aprender`
   muestran: «Vista previa: estás viendo tu borrador. Los estudiantes ven la
   última versión publicada.».
2. **Detección de cambios por checksum.** `GET /admin/modules/{id}/publish/status`
   compara el `content_hash` del contenido local (el bundle **sin** `checksum`,
   `published_at`, `version` ni `notes`) con el de la versión vigente del índice,
   leída sin caché. Estados: `never_published`, `unchanged`, `changed`,
   `out_of_sync` y `unknown` (sin red: no impide publicar). El diálogo de
   Publicar deshabilita el botón si no hay cambios, y el dashboard marca «cambios
   sin publicar» por módulo.

Los 13 faltantes «separar edición de publicación» (13.2, 14.2, 15.2, 16.3, 17.5,
18.6, 19.4, 20.2, 21.4, 22.1, 36.1, 39.3, 40.3) quedan **reclasificados** y
cerrados por D+. Las alternativas pesadas (tablas espejo `draft_*`, snapshot
publicado, columna `status` por fila) se descartaron por sobreingeniería: ver el
informe, §3.1.

### 4.5 Un solo curso; el módulo es la unidad publicable (decidido 2026-11-18)

El modelo es **curso → módulos → lecciones**, y Telar ofrece **un único curso**
(el curso TELAR). La unidad que se publica, se distribuye y se actualiza es el
**módulo**: un bundle es un módulo y el índice del catálogo es una lista plana
de módulos (contrato §11.8.4). Por eso CU-34 a CU-38 y CU-41 se nombran sobre
módulos.

CU-39 (crear un curso) y CU-40 (editar la información de un curso) quedan
**fuera de alcance**: con un solo curso no aportan, y una entidad `curso` que
agrupe módulos exigiría tabla nueva, `modules.course_id`, `bundle_format`
nuevo y rompería la compatibilidad con la v1.0.5. Queda como trabajo futuro.
Se descartó la equivalencia anterior «curso = módulo» (CU-39 ≡ CU-13 + CU-37,
CU-40 ≡ CU-14) porque contradice el modelo: un curso contiene módulos.

---

## 5. Casos de uso

### CU-01 — Explorar el catálogo de módulos y lecciones

**Actor:** Estudiante. **Disparador:** abre *Aprender* (`#/aprender`) o *Inicio*.
**Precondiciones:** backend arriba; contenido sembrado o incorporado.

**Flujo principal:**
1. El frontend pide `GET /api/v1/modules`.
2. El backend arma cada módulo con sus lecciones (del snapshot en memoria de
   SQLite) y el progreso de `lesson_progress`. Las lecciones **archivadas** no
   viajan; los totales (`lessons_enabled`, `lessons_completed`) siguen la regla
   única de disponibilidad (§4.3).
3. Cada lección trae `kind` (`leccion`/`taller`), `enabled` y
   `progress: {viewed, completed, best_quiz_score, quiz_total}`.
4. `CatalogScreen` pinta los módulos con su nivel, el progreso por lección
   (habilitadas como denominador) y el chip «Taller» donde corresponde. Una
   lección deshabilitada se ve pero no se abre.
5. **Búsqueda y filtros:** solo se muestran los módulos con coincidencias, que se
   abren solos; si no hay ninguna en todo el catálogo aparece «No se encontraron
   resultados».
6. **Continuar/Empezar** lleva a la última lección visitada si sigue disponible;
   si no, a la primera disponible (CU-29). Nunca a un id fijo.

**Flujo alternativo:** *Inicio* muestra un resumen, los últimos 3 jobs
(`GET /jobs?limit=3`) y el progreso global (`GET /progress`).
**Flujo de error:** si falla la carga, `ErrorState` con «Reintentar».
**Postcondición:** el estudiante ve el mapa del curso y su avance.

---

### CU-02 — Realizar una lección

**Actor:** Estudiante. **Disparador:** abre una lección (`#/aprender/{id}`).
**Precondiciones:** la lección existe. Si es un taller, sigue CU-28.

**Flujo principal:**
1. `GET /api/v1/lessons/{lesson_id}` devuelve el Markdown (`content_markdown`),
   `video_url` opcional, `has_quiz`, `example_id` opcional, `completion_rule`,
   `kind`, la navegación (`prev_lesson_id`/`next_lesson_id`), las lecciones
   `recommended` y el `progress`.
2. `LearnScreen` renderiza el Markdown (subset controlado, sin HTML crudo), el
   video si lo hay (iframe de `youtube-nocookie.com`), «Ejecutar en el
   simulador» si hay ejemplo (CU-04) y el quiz si `has_quiz` (CU-03).
3. Al abrirla, el frontend marca `viewed=true` con
   `PUT /api/v1/progress/lessons/{id}`.
4. La lección dice **qué falta para completarla** según su regla: «aprueba el
   quiz», «márcala como leída» o «ejecuta su ejemplo sin errores»; o «Lección
   completada.».
5. Se completa **solo** por su regla (§4.2):
   - `viewed`: la tarjeta «Marcar como leída» envía
     `{viewed: true, completed: true}`;
   - `quiz`: al aprobar el quiz (CU-03);
   - `run`: cuando termina en `completed` un job de su ejemplo lanzado desde la
     lección (CU-04).

**Flujos alternativos:** una lección **archivada** abierta por URL muestra un
aviso y no cuenta para el progreso; la barra lateral no abre lecciones
deshabilitadas. En el build de autoría se ve además el aviso de vista previa
(§4.4).
**Flujo de error:** `404 LESSON_NOT_FOUND` → estado de error.
**Postcondición:** la lección queda vista y, si se cumplió su regla,
completada; esto repercute en CU-01, CU-12 y CU-29.

---

### CU-03 — Responder el quiz de una lección

**Actor:** Estudiante. **Disparador:** responde y pulsa «Enviar» en el quiz.
**Precondiciones:** `has_quiz=true`.

**Flujo principal:**
1. `GET /api/v1/lessons/{id}/quiz` trae las preguntas **sin** la clave correcta
   (el servidor nunca la expone antes del intento).
2. El estudiante elige una opción `a|b|c|d` por pregunta y envía
   `POST /api/v1/lessons/{id}/quiz/attempts` con `{answers: {qid: key}}`.
3. El backend exige todas las preguntas respondidas con claves existentes
   (`422 VALIDATION_ERROR`), califica en el servidor y calcula
   `passed = score/total >= pass_threshold`.
4. Guarda el intento (`quiz_attempts`) y, si mejora, `best_quiz_score`.
5. **Completa la lección solo si su regla es `quiz` y cuenta para el progreso**
   (§4.2, §4.3); la decisión se toma contra la base dentro del `write_lock`.
6. Responde `201` con el detalle por pregunta (`selected`, `correct_key`,
   `correct`, `explanation`) para el feedback.

**Flujo alternativo:** reintentar las veces que haga falta; `GET …/attempts`
devuelve el historial.
**Postcondición:** intento guardado; mejor puntaje y completitud actualizados
según la regla.

---

### CU-04 — Ejecutar un ejemplo de una lección en el simulador

**Actor:** Estudiante. **Disparador:** «Ejecutar en el simulador» desde una
lección, o elegir un ejemplo en el selector del simulador.
**Precondiciones:** Docker disponible; el ejemplo existe y está habilitado.

**Flujo principal:**
1. `SimulatorIdle` carga `GET /api/v1/examples/{id}` (código, `takeaways`,
   configuración de hilos) y `GET /api/v1/system` (`cores`, `max_threads`,
   límites).
2. Si `threads_configurable=false` (barrido interno o hilos fijos), el control de
   hilos se bloquea y se muestra `fixed_threads_note`. El control nunca supera
   `max_threads`.
3. El estudiante ajusta hilos y timeout (o edita el código) y ejecuta:
   `POST /api/v1/jobs {example_id, threads?, timeout_s?, lesson_id?, code?}`.
4. El backend valida (ejemplo existente y habilitado, rangos, y que
   `example_id` sea el ejemplo de `lesson_id`: si no, `422`), crea el job
   `queued`, lanza su tarea y responde `202` con `job_id`, `ws_url`,
   `threads_effective` y, si aplica, `threads_note`.
5. La UI pasa a la vista en vivo (CU-07) y, al terminar, a Resultados (CU-09).
6. Si el job se lanzó desde una lección `run` y termina en `completed`, la
   lección queda completada (§4.2).

**Flujo alternativo — Re-ejecutar:** desde Resultados, «Re-ejecutar» vuelve al
simulador con el ejemplo, la lección, el código, el nombre de archivo, los hilos
y el timeout del job. Se conserva el `parser_id` del ejemplo (curva de speedup
incluida). Si el ejemplo cambió o ya no existe, se avisa y, en el segundo caso,
se ejecuta como código propio.
**Flujos de error:** `409 EXAMPLE_DISABLED`, `429 TOO_MANY_JOBS`,
`503 DOCKER_UNAVAILABLE`/`RUNNER_IMAGE_MISSING`, con el motivo en la UI. Si
Docker no estaba al arrancar, `POST /jobs` reintenta crear el cliente antes de
responder `503`.
**Postcondición:** job registrado y en ejecución o en cola.

---

### CU-05 — Ejecutar código propio desde el editor

**Actor:** Estudiante. **Disparador:** escribe o pega código en el editor del
simulador («Código propio») y ejecuta.

**Flujo principal:**
1. El estudiante escribe desde cero o parte de un ejemplo y lo modifica.
2. `POST /api/v1/jobs` con `code` (y `example_id` si partió de uno: el job queda
   `source_kind="example"` si el código es idéntico o `"editor"` si cambió).
3. El backend valida tamaño (≤ 256 KB, `413 CODE_TOO_LARGE`), nombre
   (`^[A-Za-z0-9._-]{1,80}\.py$`), hilos y timeout.
4. Sigue como CU-04 desde el paso 4. Sin ejemplo, `parser_id="none"`: solo
   tiempo total, con aviso de que incluye la compilación JIT.

**Flujos alternativos:** el editor y la subida de archivos siguen funcionando
aunque falle `GET /modules`; el selector de ejemplos muestra su propio error con
«Reintentar», y recuperarlo no pisa lo escrito. Un ejemplo que llega tarde
(porque el estudiante ya eligió otro o «Código propio») se descarta.
**Postcondición:** el estudiante ve el resultado real de su variación.

---

### CU-06 — Subir un archivo `.py` para ejecutar

**Actor:** Estudiante. **Disparador:** arrastra o selecciona un `.py`.

**Flujo principal:**
1. `usePyFilePicker` lee y valida el archivo. El nombre se **normaliza** al
   patrón del backend (tildes, espacios, `.PY`) sin perder el código; el tamaño
   se mide en bytes UTF-8.
2. El contenido pasa al editor, donde puede modificarse.
3. Se ejecuta exactamente lo que se ve en pantalla (`POST /jobs` o
   `POST /jobs/upload` en multipart), con `source_kind="upload"`.

**Flujos alternativos:** si el estudiante elige otro archivo mientras el
primero se lee, solo aplica la última elección. Funciona aunque falle el
catálogo educativo.
**Flujos de error:** `413 CODE_TOO_LARGE`, `422 INVALID_ENCODING`, nombre
inválido: el error se muestra antes de reemplazar el editor.
**Postcondición:** igual que CU-05.

---

### CU-07 — Observar una ejecución en vivo

**Actor:** Estudiante. **Disparador:** automático tras crear un job, o al volver
a un job activo.

**Flujo principal:**
1. El frontend abre `WS /ws/jobs/{job_id}`. Si el job está activo, el servidor
   manda un `status`, el backlog del ring-buffer (~500 líneas) y luego el stream;
   si ya terminó, el `status` final, el replay de la salida y `eof`.
2. **Fases:** `queued → creating → compiling → running → terminal`. La UI rotula
   `compiling` como «Preparando · sin salida aún» (es «aún sin primer byte de
   stdout» según el contrato: el JIT de PyOMP no emite un evento de fin de
   compilación).
3. **Cronómetro:** corre desde `compiling` y toma el `started_at` real del
   servidor, así que al volver a un job activo no reinicia en 0:00.
4. **Salida:** mensajes `log` con `seq` monótono; el drainer vacía cada ~100 ms
   aunque sigan llegando datos, o al llegar a 4 KB. Si hay un salto de `seq`
   tras reconectar, el terminal avisa «Parte de la salida no se pudo recuperar».
5. **Métricas** (~1/s): CPU (puede pasar de 100 %), memoria y «Tareas del
   contenedor» (`pids`, que cuenta todas las tareas del cgroup, no los hilos
   OpenMP).
6. La tabla y la topología de hilos pintan N hilos (t0 = maestro) y se marcan
   como **ilustrativas**: no son una medición por hilo.
7. Al llegar a la fase terminal, la UI pide `GET /jobs/{id}` y navega a
   Resultados.

**Flujo alternativo:** varias conexiones al mismo job son válidas (fan-out).
**Flujo de error:** al superar 256 KB de salida, `error OUTPUT_TRUNCATED`, el
contenedor se mata y el job termina `failed` (`output_limit_exceeded`).
**Postcondición:** el estudiante ve en tiempo real cómo corre su código.

---

### CU-08 — Cancelar una ejecución

**Actor:** Estudiante. **Disparador:** «Detener» y confirmación.

**Flujo principal:**
1. Con el WebSocket abierto, el frontend manda `{"type":"cancel"}`; sin
   WebSocket, usa `POST /api/v1/jobs/{id}/cancel`. La UI muestra «Cancelando…».
2. Si el job está `queued`, no llega a crear el contenedor.
3. Si ya corre, se fija `kill_reason="cancel"` y se mata el contenedor. El kill
   se espera como mucho 15 s.
4. El job termina `cancelled` solo si el kill mató al proceso; si el contenedor
   **ya había salido solo**, la cancelación no se acepta y se conserva el
   resultado real.

**Flujos de error:**
- Si el kill falla (Docker caído), REST responde `503 DOCKER_UNAVAILABLE` y el
  WS envía `error CANCEL_FAILED`; la UI avisa «No fue posible solicitar la
  cancelación. La ejecución puede continuar activa.» y un segundo «Detener»
  reintenta.
- Sin conexión, «Detener» se deshabilita y la confirmación pendiente se descarta;
  al reconectar vuelve a estar disponible.
- Cancelar un job terminal: `409 JOB_NOT_CANCELLABLE` por REST; por WS se ignora.

**Postcondición:** el job queda en un estado terminal coherente con lo que pasó.

---

### CU-09 — Consultar resultados y métricas de una ejecución

**Actor:** Estudiante. **Disparador:** el job termina, o se abre uno del
historial.

**Flujo principal:**
1. `GET /api/v1/jobs/{id}`: estado, `exit_code`, `oom_killed`, `error_detail`,
   tiempos, `stdout`/`stderr`, `output_truncated`, `metrics_summary` y
   `parsed_timings`.
2. El encabezado dice el estado real («Job completado» solo para `completed`;
   fallido, timeout y cancelado tienen su rótulo) y la configuración: hilos,
   timeout, origen y ejemplo/lección.
3. `parsed_timings` según el `parser_id`: `sweep` (serie de hilos → speedup y
   eficiencia), `pair` (paralelo frente a referencia) o `null` (solo tiempo
   total, que incluye el JIT).
4. Para `failed`, `cancelled` y `timeout`, la tarjeta «Causa y stderr» muestra la
   causa (`sandbox_error`, `orphaned_on_restart`, `wall_timeout`…) y el stderr
   completo.
5. Una métrica no medida se muestra «—»: el backend descarta las muestras
   incompletas en vez de inventar ceros.
6. Acciones: descargar la salida (CU-10), exportar (CU-31), re-ejecutar (CU-04).

**Postcondición:** el estudiante interpreta el resultado pedagógico de su
ejecución.

---

### CU-10 — Descargar la salida de una ejecución

**Actor:** Estudiante. **Disparador:** botón de descarga en Resultados.

**Flujo principal:**
1. `lib/download` hace `fetch` a `GET /api/v1/jobs/{id}/output?stream=combined|stdout|stderr`,
   convierte la respuesta en un `Blob` y la guarda como
   `<nombre>-<job_id[:8]>.txt`. Así funciona también en Electron, donde la página
   es `file://` y la API `http://localhost:8000` (un `<a download>` entre orígenes
   se ignora).
2. Si la salida fue truncada, el archivo lo indica en su última línea.
3. Los botones se deshabilitan mientras hay una descarga en curso.

**Flujo de error:** si la descarga falla, «No fue posible descargar la salida.
Inténtalo nuevamente.» con «Reintentar», sin ocultar los resultados. El backend
responde `409 JOB_NOT_FINISHED`, `404 JOB_NOT_FOUND` o `422`.
**Postcondición:** el estudiante tiene la salida como archivo local.

---

### CU-11 — Consultar ejecuciones recientes

**Actor:** Estudiante. **Disparador:** abre *Resultados* (`#/resultados`).

**Flujo principal:**
1. `GET /api/v1/jobs?limit=50&offset=&status=` devuelve el listado resumido y
   `meta.total`. La lista pagina de 50 en 50.
2. Cada fila abre el detalle (CU-09) o retoma el seguimiento en vivo si el job
   sigue activo (CU-07).
3. Se pueden seleccionar varios jobs terminales para compararlos (CU-30).

**Postcondición:** el historial persiste en SQLite entre reinicios.

---

### CU-12 — Consultar el progreso de un curso

**Actor:** Estudiante. **Disparador:** abre *Inicio*, *Aprender* o una lección.

**Flujo principal:**
1. `GET /api/v1/progress` devuelve el mapa por lección y un `summary`;
   `GET /modules` da el progreso por módulo. **Ambos cuentan con la misma
   regla** (§4.3), así que el total general y los de los módulos coinciden.
2. Una lección se completa por su regla (§4.2): `quiz`, `viewed` o `run`, y un
   taller por sus pasos (CU-28).
3. Cada lección dice qué requisito le falta (CU-02, paso 4).
4. `PUT /api/v1/progress/lessons/{id}` acepta `viewed` y, solo en lecciones
   `viewed` que cuentan, `completed`. `best_quiz_score` y `last_job_id` los
   gestiona el backend como efecto de CU-03 y CU-04.

**Postcondición:** el estudiante ve cuánto le falta del curso.

---

### CU-13 — Crear un módulo de curso

> Precondición común a CU-13–CU-23 y CU-36, CU-37 y CU-41: despliegue de
> autoría (`TELAR_ADMIN_MODE=1` + build `VITE_ADMIN`). En la imagen estudiante
> las rutas `/admin/*` ni existen (`404`); con el modo apagado responden `401`.
> Se entra por «Autoría» (`#/admin`). En todos los formularios de Autoría rige
> el mismo **aviso de cambios sin guardar** (`useUnsavedChangesGuard`: toda
> navegación, recarga o cierre de ventana y cierre de modales; en Electron, un
> diálogo nativo) y los **errores de validación se muestran junto a su campo**
> (también los 422 de pydantic).

**Actor:** Administrador. **Disparador:** «Nuevo módulo».

**Flujo principal:**
1. `ModuleFormDialog` pide `id`, `order`, `title`, `description` y `level`.
2. El cliente valida con las mismas reglas del schema.
3. `POST /api/v1/admin/modules`: `id` único (`409 DUPLICATE_ID`), `order` único
   y > 0 (`409 ORDER_CONFLICT`, marcado en el campo Orden), o `422`.
4. `_persist` escribe, recarga el snapshot de contenido y lo intercambia solo si
   el commit fue bien.

**Flujo alternativo:** Escape, clic fuera o Cancelar con cambios preguntan antes
de descartar; con el guardado en vuelo el diálogo no se cierra.
**Postcondición:** módulo nuevo en Autoría y, en esta máquina, en la vista
previa de *Aprender* (§4.4). Los estudiantes lo reciben al publicarlo (CU-37).

---

### CU-14 — Editar un módulo de curso

**Actor:** Administrador. **Disparador:** «Editar» sobre un módulo.

`PUT /api/v1/admin/modules/{id}` con `{order, title, description, level}`.
Mismas validaciones y avisos que CU-13, salvo la unicidad del `id`. Errores:
`404 MODULE_NOT_FOUND`, `409 ORDER_CONFLICT`, `422`. Si falla el guardado, el
backend hace rollback y el formulario conserva lo escrito para reintentar. Si el
módulo vino del catálogo, la edición enciende `locally_modified` (CU-38).

---

### CU-15 — Reordenar módulos de un curso

**Actor:** Administrador. **Disparador:** arrastrar o «Subir»/«Bajar».

**Flujo principal:**
1. Cada movimiento envía **un** `PUT /api/v1/admin/modules/reorder` con
   `{items: [{id, order}, …]}`.
2. El backend valida ids existentes, sin repetidos, y que el conjunto final de
   `order` sea único y > 0; aplica todo en una transacción con un «parking»
   temporal para no violar el `UNIQUE` a mitad de camino.
3. Mientras el PUT está en vuelo, «Subir», «Bajar» y el asa se deshabilitan; el
   orden final se toma de la respuesta del PUT.

**Postcondición:** nuevo orden persistido de forma atómica.

---

### CU-16 — Eliminar un módulo de curso

**Actor:** Administrador. **Disparador:** «Borrar módulo».

**Flujo principal:**
1. El diálogo avisa cuántas lecciones se borran con el módulo.
2. Si el módulo tiene lecciones, se llama
   `DELETE /api/v1/admin/modules/{id}?cascade=true`: borra el módulo y todas sus
   lecciones (ejemplo, quiz, progreso, intentos, casillas de taller y
   `recommended` colgantes) en una sola transacción. Sin lecciones, basta el
   `DELETE` sin parámetro.
3. Responde `{deleted: true, id}`.

**Flujos de error:** sin `cascade`, un módulo con lecciones vivas sigue dando
`409 MODULE_NOT_EMPTY` (así un listado viejo no borra de más). Un valor de
`cascade` inválido es `422` y no borra nada. El diálogo no se cierra con el
borrado en vuelo.
**Postcondición:** el módulo y su contenido desaparecen de esta instalación. Si
estaba publicado, sigue en el catálogo hasta retirarlo (CU-41).

---

### CU-17 — Crear una lección

**Actor:** Administrador. **Disparador:** «Nueva lección» (`#/admin/lecciones/nueva`).

**Flujo principal:**
1. `AdminLessonEditor` pide módulo, posición (entero ≥ 1), título, minutos
   (≥ 1), contenido Markdown y recomendadas, además de:
   - **Tipo de lección:** «Lección» o «Taller guiado» (CU-28). En un taller se
     ocultan la regla y el video.
   - **Regla de completitud** (`quiz`/`viewed`/`run`), **video** opcional y
     **«Lección habilitada»**.
   - **«Esta lección tiene ejemplo ejecutable»**, desmarcada por defecto. Si se
     marca, se completan los metadatos del ejemplo y su código.
2. Reglas del editor: `run` sin ejemplo bloquea el guardado; `quiz` sin quiz solo
   avisa.
3. `POST /api/v1/admin/lessons` crea la lección y, si lo hay, su ejemplo en una
   sola transacción (`example`/`source_code` = `null` sin ejemplo). Validaciones:
   módulo existente, id libre (namespace compartido con los ejemplos), orden,
   Markdown en el subset, `parser_id` válido, nombre `.py`, tamaño del código,
   coherencia de hilos y GPU, recomendadas existentes.
4. Crear en una posición ocupada crea la lección al final y después la inserta
   con el reorden por lotes (CU-19).

**Postcondición:** lección disponible en Autoría y en la vista previa.

---

### CU-18 — Editar una lección

**Actor:** Administrador. **Disparador:** abre una lección en Autoría.

**Flujo principal:**
1. `GET /api/v1/admin/lessons/{id}` carga todo, incluidos `video_url`,
   `enabled`, `completion_rule`, `kind`, `archived` (se muestra «Archivada») y los
   pasos si es un taller.
2. `PUT /api/v1/admin/lessons/{id}` **reemplaza la lección entera**: el editor
   envía siempre todos los campos que conserva del detalle, así cambiar el
   título o moverla no borra el video, ni cambia la regla, ni reactiva una
   lección deshabilitada.
3. **Agregar ejemplo** a una lección que no lo tiene:
   `POST /api/v1/admin/lessons/{id}/example` con `{example, source_code}`.
4. **Quiz:** `PUT /api/v1/admin/lessons/{id}/quiz` reemplaza el conjunto completo
   de preguntas (`pass_threshold` + preguntas con opciones, clave y
   explicación). Si cambia el número de preguntas o el umbral, se reinician
   `best_quiz_score` y `completed` de esa lección. Es el único endpoint que
   devuelve `correct_key`.
5. **Eliminar quiz:** «Eliminar quiz» con confirmación (avisa que se reinicia el
   progreso de ese quiz) → `DELETE /api/v1/admin/lessons/{id}/quiz`.
6. **Taller:** con la lección guardada como taller aparece el editor de pasos
   (CU-28, autoría). Convertir en taller una lección con quiz se bloquea: hay que
   borrar el quiz antes.

**Errores:** `404`, `409 ORDER_CONFLICT`, `422` junto a su campo.
**Postcondición:** cambios guardados sin tocar lo que el administrador no editó.

---

### CU-19 — Reordenar lecciones

**Actor:** Administrador. **Disparador:** cambiar el módulo o la posición de una
lección en su editor.

**Flujo principal:**
1. `lib/lessonMove` calcula el orden completo del módulo de origen y del de
   destino, desplazando a las demás lecciones.
2. `PUT /api/v1/admin/lessons/reorder` aplica ese lote en una transacción (mismo
   mecanismo que CU-15).
3. La posición solo acepta enteros ≥ 1 («2.5» ya no se convierte en 2).

**Flujo de error:** si el reorden sale bien y falla el PUT del resto de la
lección, se avisa de que la lección ya se movió.
**Postcondición:** las demás lecciones quedan recolocadas y los datos de la
lección movida intactos.

---

### CU-20 — Eliminar una lección

**Actor:** Administrador. **Disparador:** «Borrar lección».

**Flujo principal:**
1. La advertencia nombra solo lo que la lección tiene de verdad (ejemplo, quiz)
   y avisa de que se pierde el progreso.
2. `DELETE /api/v1/admin/lessons/{id}` borra, en una transacción, la lección, su
   ejemplo y su quiz, y limpia los `recommended` que la citaban.
3. **Purga deliberada** de `lesson_progress`, `quiz_attempts` y
   `workshop_step_progress` de ese id: si se reutilizara, no heredaría progreso
   ajeno. Los jobs se conservan como historial.

**Postcondición:** la lección desaparece; los jobs ya ejecutados siguen en el
historial.

---

### CU-21 — Editar un ejemplo

**Actor:** Administrador. **Disparador:** abre un ejemplo (`#/admin/ejemplos/{id}`).

**Flujo principal:**
1. `GET /api/v1/admin/examples/{id}` trae metadatos y código.
2. El administrador edita título, archivo, dificultad, qué enseña, directivas,
   hilos, `parser_id`, timeout, `enabled`, GPU y `takeaways`, y reemplaza el
   código escribiéndolo o soltando un `.py` (misma validación estricta que
   CU-06).
3. Antes de enviar nada, el cliente valida metadatos **y** código.
4. `PUT /api/v1/admin/examples/{id}` guarda los metadatos y
   `POST /api/v1/admin/examples/{id}/code` el código.

**Flujo de error:** si el código falla tras guardar los metadatos, solo queda
pendiente el código, y el editor lo dice.
**Nota de seguridad:** el `.py` del administrador es tan no confiable como el del
estudiante y corre en el mismo sandbox.
**Postcondición:** ejemplo actualizado.

---

### CU-22 — Probar un ejemplo en el simulador

**Actor:** Administrador. **Disparador:** «Probar en el simulador» desde el
editor del ejemplo.

**Flujo principal:**
1. La UI navega a `#/simulador?ejemplo={id}&prueba=admin` y reutiliza el
   pipeline de jobs normal (CU-04, CU-07, CU-09). No hay endpoint de prueba
   aparte.
2. En modo prueba el simulador **no envía `lesson_id`**: probar no escribe
   `last_job_id` ni completa lecciones `run`.
3. Si el administrador cambia rápido de ejemplo en el selector, solo aplica el
   último.

**Postcondición:** el administrador verifica que el ejemplo produce la salida
que espera su parser. El resultado local es su borrador (§4.4).

---

### CU-23 — Gestionar el contenido base (CLI)

**Actor:** Administrador u operador con shell del backend.

**Flujo principal:**
1. En el primer arranque con las tablas de contenido vacías, el backend siembra
   los fixtures versionados de `backend/app/content/`.
2. `python -m app.tools.seed_content`:
   - sin opciones: UPSERT idempotente que no pierde contenido extra. Los órdenes
     de módulos, lecciones y preguntas se fijan en dos fases, y las filas extra
     que ocupaban un hueco base se corren y se conservan;
   - `--prune` (**restablecer**): poda lo que no es base **antes** de los
     upserts, desarchiva las lecciones base, devuelve `version`, `origin`,
     `checksum` y `published_at` del módulo, y purga el progreso de lo borrado;
   - `--check --db <ruta>`: abre la base en **solo lectura** (`mode=ro`, sin
     migrar) y sale con código ≠ 0 si difiere de los fixtures. Sin `--db` avisa
     de que no mira ninguna base instalada; una ruta inexistente es error.
3. Tras sembrar, avisa de que hay que reiniciar el backend en marcha.

**Postcondición:** la base de contenido queda alineada con la versión del
repositorio, o se detecta la divergencia sin tocarla.

---

### CU-24 — Gestionar una ejecución aislada

**Actor:** Sistema (backend). **Disparador:** cualquier creación de job (CU-04,
05, 06, 22). Es el mecanismo común a todos ellos.

**Flujo principal:**
1. `job_runner` toma un cupo del semáforo `TELAR_MAX_CONCURRENT_JOBS` (2 por
   defecto); el resto espera `queued` (cola máx. 10, luego `429`).
2. Comprueba `cancel_requested` antes de crear el contenedor.
3. Prepara el código (`bind` en desarrollo, volumen `telar_submissions` en
   compose). Si la escritura falla, borra el directorio a medio crear.
4. `docker_service.run_job` crea el contenedor `telar-runner` con los mecanismos
   de aislamiento en capas (`architecture.md` §4): sin red, usuario no root,
   `cap_drop=ALL`, `no-new-privileges`, rootfs de solo lectura, `tmpfs /tmp`
   `noexec`, 512 MB sin swap, `pids_limit=128`, CPUs = hilos
   (`OMP_NUM_THREADS = NUMBA_NUM_THREADS = --cpus`), `ulimits`, `init` (tini),
   código `:ro`, timeout duro, tope de salida de 256 KB y labels para el reaper.
   Ningún parámetro del usuario llega a `HostConfig`.
5. Dos hilos puente (docker-py es síncrono) drenan logs y stats hacia colas
   asyncio; el **drainer del job** aplica el tope de salida, acumula stdout y
   stderr completos, alimenta el ring-buffer y hace fan-out a cada WS; vacía cada
   ~100 ms aunque sigan llegando datos.
6. Termina por éxito, fallo (exit ≠ 0, OOM, error del sandbox, tope de salida),
   timeout o cancelación. **Es timeout solo si pasó `timeout_s`**; un corte
   anterior (Docker caído) es error del sandbox.
7. `finish()` deriva `status`/`error_detail` de `kill_reason + exit_code +
   OOMKilled` (prioridad `cancel > output_limit > timeout`) con un guard que no
   pisa un estado terminal.
8. El parser (`parser_id`) produce `parsed_timings` si la salida no se truncó.
   **Si el parser lanza, se registra un aviso y se conservan el estado y el
   `exit_code` reales** (un programa correcto no sale «fallido»).
9. `compute_metrics` resume CPU, memoria y tareas, descartando muestras
   incompletas.
10. Si el job lleva `lesson_id` y terminó `completed`, un solo upsert escribe
    `last_job_id` y, en una lección `run` que cuenta, la completitud (evaluada al
    terminar, contra el snapshot vigente).
11. En el `finally`: `remove(force=True, v=True)` y borrado del directorio del
    job.

**Postcondición:** job en un estado terminal coherente, con sus métricas y
tiempos listos para CU-09.

---

### CU-25 — Recuperar ejecuciones inconsistentes al iniciar

**Actor:** Sistema (backend). **Disparador:** arranque del backend (lifespan),
típicamente tras un cierre inesperado.

**Flujo principal:**
1. Elimina los contenedores con el label `telar.runner=true`.
2. Marca `failed` (`error_detail="orphaned_on_restart"`, con `finished_at`) los
   jobs que quedaron en un estado activo.
3. Borra los directorios de código huérfanos (`services/code_dirs.py`). Este
   barrido **no depende de Docker**: corre aunque el cliente no se haya creado, y
   solo cuenta como borrado lo que de verdad ya no existe.

**Postcondición:** sin contenedores fantasma ni jobs «colgados» tras un
reinicio; el historial previo se conserva.

---

### CU-26 — Reportar salud del sistema

**Actor:** Sistema (backend), consumido por el healthcheck de Compose y por el
pie de estado de la UI.

**Flujo principal:**
1. `GET /health` (sin envelope):
   `{"status":"ok","checks":{"db":true,"docker":true,"runner_image":true}}`.
   Semántica de **liveness**: `200` si la app arrancó y la base responde, aunque
   Docker o la imagen fallen; `503` solo si la base no responde.
2. Cada llamada a Docker va a un hilo con **timeout de 3 s**: el event loop no se
   bloquea aunque el daemon se cuelgue.
3. `runner_image` distingue **ausente** (`false`) de **no comprobada** (`null`).
4. Si el cliente Docker no se creó al arrancar, `/health`, `/system` y
   `POST /jobs` lo reintentan con una única tarea compartida y, al lograrlo, lo
   entregan al `JobRunner`.
5. `GET /api/v1/system` añade `cores`, `max_threads`, `runner_image_present`,
   versiones, límites y el bloque `catalog`.

**Flujo alternativo:** en el paquete de escritorio, el backend corre en un
contenedor con `restart: unless-stopped`: si Docker cae, vuelve con él.
**Postcondición:** orquestador y UI saben si el sistema puede aceptar jobs.

---

### CU-27 — Iniciar la aplicación de escritorio

**Actor:** Usuario de escritorio. **Disparador:** abre la app (AppImage/`.deb` o
instalador NSIS).

**Flujo principal:**
1. `main.ts` crea una única `BrowserWindow` (single-instance) con
   `contextIsolation`, `sandbox`, sin `nodeIntegration`, y carga el mismo build
   del frontend por `file://`. La CSP se inyecta **solo** en los documentos de
   la app, no en el iframe de YouTube de las lecciones; a las peticiones a
   YouTube se les añade el `Referer` que `file://` no manda.
2. `preload.ts` expone `window.telar` (`appVersion`, `platform`,
   `dockerStatus`, `dockerUp`, `dockerStop`, `openExternal`) vía
   `contextBridge`; `desktop/types/telar-api.d.ts` ≡ `frontend/src/types/telar.d.ts`.
3. `useDockerStatus` consulta `docker compose ps` (IPC con acciones cerradas,
   `execFile` sin shell, remitente validado) cada 10 s:
   - **«Listo»** = servicio `backend` `running` y `healthy`. `starting` se
     muestra como «verificando…»; `unhealthy` cuenta como caído aunque haya otros
     contenedores.
   - Backend parado → **autoarranque** (`dockerUp`: build del runner si falta +
     `up -d`), una vez por sesión. Si Docker no estaba, el autoarranque **queda
     pendiente** y se hace cuando aparece el daemon.
   - Con el backend listo, si `/system` dice que falta la imagen del runner, el
     pie avisa y ofrece «Reintentar preparación».
4. El punto de estado del rail abre un panel con **Levantar** / **Detener** y la
   causa real si algo falla (error saneado de `dockerStatus`). «Detener» también
   sirve con el backend corriendo pero no sano.
5. Al cerrar la app, `before-quit` detiene los servicios (`compose stop`).
6. Los enlaces externos pasan por `openExternal`, que solo acepta `https:`.

**Flujos de error:** si la interfaz no carga (`did-fail-load` del frame
principal o `render-process-gone`), se muestra una página de error local sin
scripts con la causa y «Reintentar». Sin Docker: punto rojo, tooltip y enlace a
la guía de instalación.
**Postcondición:** la app queda operativa sin abrir una terminal.

---

### CU-28 — Realizar un taller guiado

**Actor:** Estudiante (y Administrador, para crearlo). **Disparador:** abre una
lección con `kind='taller'`.
**Precondiciones:** el taller tiene al menos un paso.

**Flujo principal (estudiante):**
1. `GET /api/v1/lessons/{id}` trae `kind: "taller"` y
   `steps: [{idx, title, body_markdown, example_id, done}]`.
2. `WorkshopSteps` muestra el chip «Taller», la lista de pasos, una barra de
   avance y el paso actual con sus instrucciones (subset de Markdown). Sin video
   ni «Marcar como leída».
3. Si el paso tiene `example_id`, ofrece «Abrir en el simulador» (taller **con**
   código); si no, es de lectura y acción (taller **sin** código).
4. El estudiante marca «Lo hice»:
   `PUT /api/v1/progress/lessons/{id}/steps/{idx}` con `{done: true}`
   (idempotente). La casilla es optimista y queda deshabilitada mientras se
   guarda; la UI avanza al siguiente paso pendiente.
5. Al marcar el último paso, el servidor escribe `completed=1`
   (`completed_via='manual'`) y la UI muestra «Taller completado»; el taller
   cuenta en el progreso del módulo como cualquier lección.
6. **Retomar:** al volver, el taller se abre en el primer paso sin marcar.

**Reglas:** desmarcar quita la casilla pero **no descompleta** (monotonía). Un
taller deshabilitado o archivado guarda la casilla pero no se completa. La
casilla se decide con la lista de pasos **vigente** (releída dentro del lock):
si el autor cambió los pasos entretanto, un `idx` retirado da
`404 STEP_NOT_FOUND`. El `PUT` genérico de progreso no completa un taller.
**Flujo de error:** si falla el guardado, la casilla se desmarca y aparece un
aviso: nunca se da por completado lo que no se guardó.

**Flujo de autoría (administrador):**
1. En el editor de lección elige «Taller guiado» y guarda (la regla se guarda
   `viewed`, sin video ni quiz).
2. `WorkshopStepsEditor` añade, edita, reordena (Subir/Bajar) y borra pasos con
   ejemplo opcional: `POST/PUT/DELETE /api/v1/admin/lessons/{id}/steps[/{idx}]`
   y `PUT …/steps/reorder`. Hasta 50 pasos; reordenar y borrar mueven las
   casillas con su paso. Con un borrador de paso abierto, Subir/Bajar/Borrar se
   deshabilitan y el borrador entra en el aviso de cambios sin guardar.
3. Al publicar, un módulo con talleres sale con `bundle_format: 2` (CU-37); sin
   talleres sigue en formato 1, byte a byte igual.

**Postcondición:** el progreso del taller queda guardado paso a paso y, completo,
suma al módulo.

---

### CU-29 — Seguir la progresión recomendada del curso

**Actor:** Estudiante. **Disparador:** navega entre lecciones o pulsa
«Continuar/Empezar».

**Flujo principal:**
1. El curso sigue el orden de módulos y lecciones. «Anterior»/«Siguiente»
   (`prev_lesson_id`/`next_lesson_id`) cruzan módulos y **saltan las lecciones
   deshabilitadas y archivadas** (§4.3).
2. El estudiante puede abrir directamente contenido posterior: no hay
   prerrequisitos.
3. `lastLessonId` se recuerda en localStorage (en `try/catch`).
4. «Continuar/Empezar» (`lessonTarget`) va a la última lección visitada si sigue
   disponible; si no, a la primera disponible.
5. Las lecciones `recommended` enlazan contenido relacionado.

**Postcondición:** el estudiante siempre aterriza en una lección válida del curso
incorporado actual.

---

### CU-30 — Comparar ejecuciones

**Actor:** Estudiante. **Disparador:** en *Resultados*, selecciona varios jobs y
pulsa «Comparar (n)».

**Flujo principal:**
1. La lista permite seleccionar jobs **terminales**; «Comparar» se activa con 2 o
   más y navega a `#/resultados/comparar?ids=…`.
2. La vista hace un `GET /api/v1/jobs/{id}` por job (sin endpoint nuevo).
3. **Comparabilidad:** los jobs son comparables si comparten `example_id` o, sin
   ejemplo, el mismo código. Si no lo son, se explica por qué y se pueden quitar
   jobs.
4. Tabla con estado, hilos, timeout, tiempo total, CPU, memoria y speedup («—» si
   falta), enlace al detalle de cada uno y una gráfica SVG hecha a mano de tiempo
   frente a hilos.

**Flujo de error:** un job que no carga muestra `ErrorState` con «Reintentar» y
«Quitar de la comparación».
**Postcondición:** el estudiante ve el efecto de los hilos sobre el mismo
programa.

---

### CU-31 — Exportar resultados y métricas de ejecuciones

**Actor:** Estudiante. **Disparador:** «Exportar JSON» en Resultados.

**Flujo principal:**
1. Se construye `{format: "telar-job-export/1", exported_at, job}`, donde `job`
   es el `JobDetailDto` completo (configuración, estado, tiempos, salida,
   métricas y `parsed_timings`).
2. **Lo ausente va como `null`**, nunca como 0 ni omitido; la lista de campos
   está tipada contra el contrato.
3. Se descarga con `saveBlob` (el mismo mecanismo que CU-10).

**Flujo de error:** `ErrorState` con reintento si la descarga falla.
**Postcondición:** el estudiante tiene sus resultados en un formato
reutilizable fuera de Telar.

---

### CU-32 — Guardar y reutilizar una configuración de ejecución

**Actor:** Estudiante. **Disparador:** «Mis configuraciones» en el simulador, o
«Re-ejecutar» en Resultados.

**Flujo principal:**
1. **Guardar sin ejecutar:** la tarjeta «Mis configuraciones» guarda nombre,
   código, nombre de archivo, hilos, timeout y ejemplo opcional en localStorage
   (todo acceso en `try/catch`, con error visible). Con un ejemplo de hilos
   fijos o de barrido se guarda el valor que se ve.
2. **Cargar** aplica la configuración igual que Re-ejecutar; editar después no
   toca lo guardado. Se pueden renombrar y borrar.
3. **Re-ejecutar** recupera ejemplo, lección, código, hilos y timeout del job
   (CU-04).
4. Un valor de hilos mayor que `max_threads` se ajusta **con aviso** antes de
   lanzar, y se envía lo que se ve.

**Postcondición:** el estudiante repite experimentos sin reconstruir la
configuración.

---

### CU-33 — Instalar Telar

**Actor:** Usuario. **Disparador:** entra a la página pública de descargas.

**Flujo principal:**
1. La página (`site/`, GitHub Pages) lee `release.json`, que apunta a la
   **v1.0.5** con los SHA-256 de cada artefacto, y ofrece el instalador de su
   sistema.
2. La descarga va a GitHub Releases: instalador NSIS (Windows) o AppImage/`.deb`
   (Linux).
3. El paquete incluye la app de escritorio, el frontend y el compose con las
   imágenes necesarias; el primer arranque las prepara (CU-27).
4. Instalar Telar **no** incorpora ningún curso: eso es CU-35.

**Flujo alternativo:** al desinstalar, se paran y borran los contenedores y las
imágenes Docker de Telar.
**Limitación:** falta una QA de instalación versionada (evidencia del recorrido
en Windows y Linux por versión): CU-33.1 queda parcial (§6).
**Postcondición:** Telar instalado y listo para iniciarse.

---

### CU-34 — Explorar el catálogo remoto de módulos

**Actor:** Usuario. **Disparador:** abre *Módulos* (`#/modulos`).
**Precondiciones:** catálogo configurado (bucket `clasestelar`, lectura anónima).

**Flujo principal:**
1. `GET /api/v1/catalog/status` (solo SQLite, nunca la red) pinta lo instalado.
2. `GET /api/v1/catalog/remote` trae el índice (caché de 900 s;
   `?refresh=true` o «Comprobar» con `POST /catalog/refresh` fuerzan la red).
3. Cada publicación muestra título, descripción, nivel, versión, número de
   lecciones y autor, y su estado: disponible, incorporado, actualización
   disponible, «Ya no publicado» o **«Conflicto con un módulo local»** (mismo id
   que un módulo propio: se ve, con «Ver detalle», pero no se puede incorporar).
4. «Ver detalle» abre `#/modulos/{id}`: `GET /api/v1/catalog/remote/{id}`
   descarga y valida el bundle **sin escribir nada**, con el índice leído
   **fresco**, y lista sus lecciones.

**Flujos de error:** sin red, el listado sale de la caché (`stale`) y lo
instalado sigue disponible. Un detalle que ya no existe (`404
REMOTE_MODULE_NOT_FOUND`) dice «Esta publicación ya no está disponible» con un
enlace para volver; otros fallos, `ErrorState` con «Reintentar».
**Postcondición:** el usuario sabe qué puede incorporar o actualizar.

---

### CU-35 — Descargar e incorporar un módulo a Telar

**Actor:** Estudiante. **Disparador:** «Incorporar» sobre una publicación.

**Flujo principal:**
1. `POST /api/v1/catalog/install {module_id, version, expected_checksum}` ancla
   lo que el usuario vio (`409 CHECKSUM_MISMATCH` si el bucket cambió entretanto).
2. El backend descarga el bundle (tope de tamaño antes de bajar), verifica el
   checksum, lo valida como entrada no confiable (DTOs `extra="forbid"`, reglas
   de §10.6) y acepta `bundle_format` 1 y 2.
3. Escribe módulo, lecciones, ejemplos, quiz y pasos de taller, y la fila de
   `installed_modules`, en **una sola transacción**; recarga el contenido sin
   reiniciar.

**Flujos de error:** módulo ya incorporado, colisión con contenido local, bundle
inválido o de un formato más nuevo (pide actualizar Telar), sin red: se informa
y nada queda a medias.
**Postcondición:** el curso se usa sin conexión y persiste entre reinicios.

---

### CU-36 — Descargar un módulo para edición

**Actor:** Administrador. **Disparador:** «Importar» en Autoría.

**Flujo principal:**
1. `POST /api/v1/admin/catalog/import {module_id, version, as_module_id, id_prefix}`.
   El diálogo envía **la versión que el administrador vio**; si ya no es la
   publicada, el `404` se explica («la vN que elegiste ya no está publicada…»)
   en vez de importar otra en silencio.
2. Modo **vinculado** (por defecto): como incorporar, pero editable y con su fila
   de `installed_modules`, para publicar después la versión siguiente. Modo
   **bifurcado**: copia con otro id y todos los ids prefijados (también el
   `example_id` de los pasos de taller), sin vínculo con el original.
3. Validación y transacción como CU-35.

**Postcondición:** el contenido queda en Autoría para editarlo. En esta máquina
*Aprender* lo muestra como vista previa del borrador (§4.4).

---

### CU-37 — Publicar un módulo

**Actor:** Administrador. **Disparador:** «Publicar» sobre un módulo.
**Precondiciones:** credencial de escritura (`TELAR_GCS_CREDENTIALS`, permisos
`0600`).

**Flujo principal:**
1. Al abrir, el diálogo consulta `GET /api/v1/admin/modules/{id}/publish/status`
   (D+, §4.4): «No hay cambios respecto a vN» deshabilita Publicar; «Tienes
   cambios sin publicar» lo permite; «No se pudo comprobar» (sin red) también.
2. **Ensayo** (`dry_run: true`): construye y valida el bundle sin escribir en el
   bucket y muestra los avisos (por ejemplo, lecciones que desaparecen respecto a
   la versión publicada).
3. `POST /api/v1/admin/modules/{id}/publish {version?, notes?}`: el servidor
   reconstruye el bundle, lo pasa por **las mismas reglas del importador**
   (`parse_bundle` + `validar_bundle`), renumera el orden de las lecciones a 1..n
   y elige `bundle_format` 1 o 2 según haya talleres.
4. **Orden seguro:** primero sube el bundle `modulos/<id>/v<n>.json` (inmutable,
   `if_generation_match=0`) y solo después actualiza el índice con CAS por
   `generation`.
5. Actualiza el estado local (`modules.version`, `installed_modules`) para que el
   autor no se vea con «actualización disponible» de su propio módulo.

**Flujos alternativos:**
- **Reintento idempotente:** si vN ya está subida con el mismo contenido
  (verificado con `parse_bundle`, checksum recalculado e id/versión de su ruta),
  reintentar completa el índice en vez de dar `VERSION_CONFLICT`.
- Si falla la escritura local tras publicar: `201` con
  `local_state_updated=false`; la UI dice «Publicado en la nube; no se pudo
  actualizar el estado local. Reintenta.» y reintentar reconcilia sin crear otra
  versión.

**Flujos de error:** errores de validación listados por lección y campo;
`403 CATALOG_CREDENTIALS_INVALID`; `409 VERSION_CONFLICT`; sin red, `503`. El
diálogo no se cierra con la publicación en vuelo (publicar es irreversible).
**Postcondición:** nueva versión inmutable anunciada en el índice.

---

### CU-38 — Actualizar un módulo incorporado

**Actor:** Estudiante. **Disparador:** «Actualizar» en un módulo con versión
nueva.

**Flujo principal:**
1. `POST /catalog/refresh` detecta `available_version` > `installed_version`.
2. `GET /api/v1/catalog/modules/{id}/update/preview` descarga y valida la
   versión nueva **sin escribir** y muestra el diff anclado en `lesson_id`:
   lecciones nuevas, cambiadas y retiradas, y el efecto real sobre el progreso
   («Se conserva», «Se recalificará»).
3. `POST /api/v1/catalog/modules/{id}/update {to_version, expected_checksum,
   on_removed_lessons: "archive"}` **revalida contra el índice sin caché** antes
   de bajar y aplica un UPSERT sobre los mismos ids en una transacción.
4. Las lecciones retiradas se **archivan** con su progreso: no aparecen en
   *Aprender* ni cuentan en los totales (§4.3).

**Flujos alternativos:** si el administrador editó un módulo vinculado
(`locally_modified`), el informe de actualización lleva el aviso
`MODULE_LOCALLY_MODIFIED` («la versión del catálogo reemplaza esos cambios»);
no bloquea. «Quitar» (`DELETE /api/v1/catalog/modules/{id}`) borra el contenido
pero **nunca** el progreso.
**Flujos de error:** `409 VERSION_CONFLICT` (no hay downgrade),
`409 CHECKSUM_MISMATCH`, bundle inválido: la versión anterior sigue disponible.
**Postcondición:** el curso queda en la versión nueva, guardado localmente.

---

### CU-39 — Crear un curso

**Estado:** ⚪ fuera de alcance (§4.5). Telar ofrece un único curso; crear
módulos dentro de él es CU-13.

Implementarlo exigiría una entidad curso persistida con su formulario y
listado (39.1) y la asociación de módulos a cursos (39.2).

---

### CU-40 — Editar información de un curso

**Estado:** ⚪ fuera de alcance (§4.5). Editar la información de un módulo
es CU-14.

Implementarlo exigiría la información general propia del curso (40.1).

---

### CU-41 — Retirar un módulo del catálogo

**Actor:** Administrador. **Disparador:** «Retirar del catálogo» sobre un
módulo publicado.
**Precondiciones:** el índice anuncia el módulo (estado `unchanged`, `changed` u
`out_of_sync`; la acción no aparece con `unknown`); credencial de escritura.

**Flujo principal:**
1. La confirmación explica qué pasa y qué no: no se borra nada, quien lo
   incorporó lo conserva como «Ya no publicado» y republicar saldrá con la
   versión siguiente.
2. `DELETE /api/v1/admin/modules/{id}/publish` quita la entrada del índice con el
   mismo CAS que publicar. **No borra bundles ni escribe nada local.**
3. La UI relee el estado: queda `never_published` y el botón desaparece.
4. Tras retirar, nadie puede incorporar ni actualizar ese módulo: instalar y
   actualizar revalidan contra el índice fresco (41.2).
5. Para borrarlo además de esta instalación, el administrador usa CU-16.

**Flujos de error:** si el bucket falla, aviso de error y nada cambia; el
diálogo no se cierra con la retirada en vuelo. `404 REMOTE_MODULE_NOT_FOUND` si
el índice ya no lo anuncia; `409 VERSION_CONFLICT` si el CAS falla dos veces.
**Postcondición:** la publicación deja de ofrecerse; las copias ya incorporadas
y el progreso de los estudiantes se conservan.

---

## 6. Limitaciones conocidas

Decisiones deliberadas (**NO HACER** en el informe, §4) y cierres parciales. Se
presentan en la memoria como limitaciones y trabajo futuro; ninguna impide el
recorrido normal de su CU.

| Ítem | Limitación | Por qué no se hizo |
|---|---|---|
| CU-02.2 | No hay componentes obligatorios/opcionales dentro de una lección | Innecesario: cada tipo de lección tiene una sola forma de completarse (§4.1, §4.2) |
| CU-07.2 | Una salida sin `\n` final puede retenerse hasta el siguiente vaciado | Coste M y riesgo medio en el drainer; con `\n` la salida llega en ~100 ms |
| CU-08.4 | El estado terminal se emite por WS antes de persistirse | Ventana mínima; se defiende como trabajo futuro de reconciliación |
| CU-24.2 | Si el drainer muere, se pierden logs, métricas y el tope de salida (no el control del contenedor) | Camino muy raro; timeout, cancelación y `wait` viven en `_run` |
| CU-24.4 | El cupo del semáforo se libera antes de borrar el contenedor | Solo afecta con fallos de Docker provocados |
| CU-24.5 | Un fallo al guardar en SQLite pierde el resultado real del job | Requiere reconciliación continua (trabajo futuro) |
| CU-25.3 | Los contenedores que no pudieron eliminarse no se siguen | Ídem |
| CU-26.4 | `/health` no informa de recursos pendientes de una recuperación | Ídem |
| CU-33.1 | ◐ Parcial: la web ya ofrece la v1.0.5 con sus checksums; falta la QA de instalación versionada | Depende de qué evidencia pida el jurado (vídeo, capturas o checklist) |
| CU-35.1 · CU-38.2 | El progreso se ancla en `lesson_id`: una lección nueva que reutiliza un id ya borrado hereda su progreso | Exige migrar `lesson_progress`/`quiz_attempts` y choca con la promesa de ids estables del contrato (§11.0.7); rarísimo en una instalación monousuario |
| CU-36.3 | No se detecta que una publicación ya tiene una copia bifurcada | Coste M; la copia bifurcada es contenido nuevo por diseño |
| CU-37.2 | El checksum del ensayo no se ancla al de la publicación (incluye `published_at`) | D+ compara con `content_hash`, que sí es estable; anclar el checksum no aporta más |
| CU-41.3 | Borrar en local (CU-16) y retirar del catálogo (CU-41) son dos operaciones separadas, sin coordinación de fallos | Cada una es atómica por sí sola; coordinarlas exige reconciliación |

**Fuera de alcance:** CU-39.1, CU-39.2 y CU-40.1 (entidad curso, §4.5).
