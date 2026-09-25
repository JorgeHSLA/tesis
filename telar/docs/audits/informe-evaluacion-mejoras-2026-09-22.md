# Informe de evaluación de mejoras — Telar (2026-09-22)

> **Qué es este documento.** Es una evaluación crítica del análisis «¿Qué falta?» de los 41 casos de uso (CU). Ese análisis salió de una sesión con ChatGPT y de la asesoría con Alejandro. Cada afirmación se comprobó contra el código real, con 5 agentes de solo lectura (uno por área) y 2 agentes de arquitectura que compararon diseños. **No se modificó código.**
>
> **Está pensado para aprender.** Cada término técnico enlaza al [glosario](#6-glosario) la primera vez que aparece. Los conceptos difíciles vienen con una analogía y un ejemplo concreto de Telar.
>
> **Criterio del director (Alejandro).** 🟢 = el recorrido normal funciona. 🟡 = falta algo que afecta a un escenario normal o frecuente. 🔴 = falta la capacidad central. «Sugerencia» = robustez o caso borde que no impide dar el CU por completo. En el análisis, los faltantes que impiden cerrar un CU se marcan como 🚨 OBLIGATORIO y el resto como 💡 SUGERENCIA.

---

## Nota previa: qué versión del análisis se evaluó

Antes de verificar nada, hubo que aclarar **qué documento** se estaba evaluando. Hay tres fuentes distintas:

| Fuente | Qué contiene | Problema |
|---|---|---|
| `docs/audits/que-falta-2026-09-22.md` (en disco) | Los 41 CU con 🟢/🟡/🔴, **sin** la separación 🚨 obligatorio / 💡 sugerencia | Es la auditoría del 18-09 con otras comillas tipográficas, y **CU-27 aparece dos veces** (líneas 1828 y 1943). **No** incluye la reclasificación de Alejandro. |
| Versión reclasificada (pegada en la sesión anterior; recuperada del historial) | El mismo contenido, pero con 🚨/💡 y el criterio del director aplicado | **Es la que se evaluó.** No existe en el repo: conviene guardarla en `docs/audits/`. |
| `docs/casos-de-uso.md` | El catálogo «oficial» de CU | Sigue con **34 CU y la numeración vieja** (allí CU-23 es «quiz» y CU-27 es «sandbox»). El resto de documentos usa 41. |

Los ejemplos de contradicción que citaste (CU-03 🟢 frente a CU-12 🚨; la numeración de CU-23 y CU-26) **solo existen en la versión reclasificada**. En el archivo en disco CU-03 es 🟡 y no hay 🚨.

---

## 1. Resumen ejecutivo

**Veredicto general: el análisis es fiable en los hechos y mejorable en la clasificación.** De los **133 faltantes** revisados:

- **120 son CONFIRMADOS.**
- **13 son PARCIALMENTE CIERTOS.**
- **0 son FALSOS** y **0 quedan sin verificar.**

Los errores de ChatGPT no fueron inventar bugs. Fueron **exagerar el impacto** de algunos, **no ver que ciertos comportamientos los exige el propio contrato congelado**, y **pasar por alto 25 problemas** que sí están en el código (sección 2.3).

Tres ideas que cambian las prioridades:

1. **La mitad de los 🟡 de Autoría son en realidad huecos de interfaz.** El backend ya tiene los endpoints de «agregar ejemplo», «eliminar quiz» y «reordenar por lotes», además de los campos `completion_rule` y `video_url`. Lo que falta son botones y un [DTO](#g-dto) del frontend desactualizado. Arreglarlo es barato.
2. **Tres 🔴 (CU-30, 31 y 32) se cierran solo con frontend**, porque `GET /jobs/{id}` ya devuelve todo lo necesario. Son ≈5,5 días para convertir tres rojos en verdes.
3. **La separación [borrador/publicado](#g-draft) es el faltante más citado (13 veces), pero el más caro y el menos urgente.** El [contrato congelado](#g-contrato) §10.1 dice textualmente que «el estudiante ve el curso actualizado de inmediato»: el comportamiento actual es **deliberado**. Además, la app del estudiante no incluye el router de Autoría, así que entre máquinas la separación ya existe.

**Criterio de diseño (revisado con Jorge): siempre la opción simple.** En cada grupo se recomienda una sola solución, la más sencilla que cierre el problema. Las alternativas pesadas (tablas espejo, snapshots publicados, modelos de requisitos múltiples, entidad curso) aparecen solo para aprender por qué se descartan: **no son un «si hay tiempo»**.

**Estimación total:** ≈**24 días** para HACER YA (incluye la opción D con detección de cambios por checksum), ≈**6–7 días** para la *feature* del taller (CU-28) y ≈**20 días** para HACER SI HAY TIEMPO. Todo son arreglos simples.

### 1.1 Los 41 CU: estado del director y estado propuesto

| CU | Caso de uso | Director | Propuesto | Qué lo cierra / nota |
|---|---|:-:|:-:|---|
| CU-01 | Explorar el catálogo de módulos y lecciones | 🟡 | 🟡 | 01.1 (S). Se cierra en la Fase 1. |
| CU-02 | Realizar una lección | 🟡 | 🟢 | Reclasificar: el taller es otro tipo de lección (CU-28), no un componente de esta. |
| CU-03 | Responder el quiz | 🟢 | 🟢 | Coherente; 03.1 se arregla gratis con el diseño A. |
| CU-04 | Ejecutar un ejemplo en el simulador | 🟡 | 🟡 | 04.1 (S). Pierde también el parser. |
| CU-05 | Código propio desde el editor | 🟢 | 🟢 | Coherente. |
| CU-06 | Subir un archivo .py | 🟢 | 🟢 | Coherente. |
| CU-07 | Observar una ejecución en vivo | 🟡 | 🟡 | 07.1 coincide con el contrato: basta cambiar el rótulo y el cronómetro. |
| CU-08 | Cancelar una ejecución | 🟢 | 🟢 | Coherente. |
| CU-09 | Resultados y métricas | 🟢 | 🟢 | Coherente; 09.4 cuesta minutos y conviene hacerlo. |
| CU-10 | Descargar la salida | 🟢 | 🟢⚠ | Verificar en Electron: la descarga cruza orígenes y podría no funcionar. |
| CU-11 | Ejecuciones recientes | 🟢 | 🟢 | Sin paginación después de 50 (sugerencia nueva). |
| CU-12 | Progreso de un curso | 🟡 | 🟡 | 12.1 (S). Hoy afecta a 0 lecciones, pero 17.2 lo vuelve frecuente. |
| CU-13 | Crear un módulo | 🟢 | 🟢 | Coherente. |
| CU-14 | Editar un módulo | 🟢 | 🟢 | Coherente. |
| CU-15 | Reordenar módulos | 🟢 | 🟢 | Coherente. |
| CU-16 | Eliminar un módulo | 🟡 | 🟡 | 16.1 (M): necesita un parámetro aditivo `?cascade=true`. |
| CU-17 | Crear una lección | 🟡 | 🟡 | 17.1 y 17.2 (S). La causa es un DTO desfasado. |
| CU-18 | Editar una lección | 🟡 | 🟡 | 18.1 es peor de lo descrito: también reactiva lecciones deshabilitadas. |
| CU-19 | Reordenar lecciones | 🟡 | 🟡 | 19.1 (M): el endpoint por lotes ya existe; 19.2 sale con 18.1. |
| CU-20 | Eliminar una lección | 🟢 | 🟢 | Coherente. |
| CU-21 | Editar un ejemplo | 🟢 | 🟢 | Coherente. |
| CU-22 | Probar un ejemplo | 🟢 | 🟢 | 22.2 pasa a obligatorio en cuanto exista la regla `run`. |
| CU-23 | Gestionar el contenido base (CLI) | 🟡 | 🟡 | 23.2 y 23.3 (M). La numeración 2,3 / 1 conserva los ids. |
| CU-24 | Ejecución aislada | 🟢 | 🟢 | Coherente; 24.1 cuesta un try/except. |
| CU-25 | Recuperar ejecuciones al iniciar | 🟢 | 🟢 | Coherente. |
| CU-26 | Reportar salud del sistema | 🟡 | 🟢 | Reclasificar 26.3: en el paquete el backend se reinicia junto con Docker. |
| CU-27 | Iniciar la app de escritorio | 🟢 | 🟢 | Coherente. Duplicado en el archivo en disco. |
| CU-28 | Realizar un taller guiado | 🔴 | 🔴 | Feature: lección de tipo `taller` con pasos y casillas (≈6–7 días). |
| CU-29 | Progresión recomendada | 🟢 | 🟢 | Coherente. |
| CU-30 | Comparar ejecuciones | 🔴 | 🔴 | Se cierra solo con frontend (≈3 días). |
| CU-31 | Exportar resultados y métricas | 🔴 | 🔴 | Se cierra solo con frontend (≈1 día). |
| CU-32 | Guardar y reutilizar configuración | 🟡 | 🟡 | 32.1 con localStorage y 32.2 (≈2 días). |
| CU-33 | Instalar Telar | 🟢 | 🟢⚠ | La página ofrece la v1.0.3; la app va en la v1.0.5. |
| CU-34 | Explorar el catálogo de cursos | 🟡 | 🟡 | 34.1 (M): el endpoint y el cliente ya existen. |
| CU-35 | Incorporar un curso | 🟢 | 🟢 | Coherente. |
| CU-36 | Descargar un curso para edición | 🟢 | 🟢 | Coherente. |
| CU-37 | Publicar un curso | 🟡 | 🟡 | 37.1 (S–M) + comparar checksum antes de publicar (37.3, 37.4). |
| CU-38 | Actualizar un curso incorporado | 🟡 | 🟡 | 38.1 (S): filtrar las archivadas en el servidor. |
| CU-39 | Crear un curso | 🔴 | 🔴? | Decisión: ¿«curso» = módulo publicable? |
| CU-40 | Editar información de un curso | 🔴 | 🔴? | Depende de la decisión de CU-39. |
| CU-41 | Eliminar un curso | 🔴 | 🔴 | 41.1 (M) + 41.2 (S) si curso = módulo. |

**Recuento.** Director: 20 🟢 / 15 🟡 / 6 🔴. Propuesto hoy, sin tocar código: **22 🟢 / 13 🟡 / 6 🔴**, con 2 🟢 pendientes de verificar (⚠). Al terminar el plan HACER YA más el taller quedarían **36 🟢 / 2 🟡 (CU-16, CU-23) / 3 pendientes de la decisión «curso = módulo» (CU-39, 40, 41)**. Si el director la acepta, CU-39 y CU-40 pasan a 🟢 y CU-41 se cierra con 41.1 (SI HAY TIEMPO).

### 1.2 Top 10 de trabajo priorizado

| # | Trabajo | Ítems | Días | Por qué ahora (riesgo de NO hacerlo) |
|:-:|---|---|:-:|---|
| 1 | **Verificar la descarga en Electron y la versión que ofrece la web** | 10.1, 33.1, 09.4 | 0,5 | Si la descarga no funciona en escritorio, CU-10 pasa a 🔴 delante del jurado; la web entrega una versión anterior al catálogo remoto. |
| 2 | **Arreglar el PUT que pisa video, regla y `enabled`** | 18.1, 19.2 | 0,5 | Pérdida silenciosa de datos al editar o mover una lección. |
| 3 | **Completitud por regla: diseño A** | 12.1, 12.2, 02.3–02.5, 03.1, 22.2 | 2,5 | El contrato congelado ya promete `run` y `viewed`; hoy el código no cumple su propio contrato. |
| 4 | **Completar la UI de Autoría de lecciones** | 17.1, 17.2, 18.2, 18.3, 19.1 | 4,5 | El backend ya lo soporta: son botones y formularios que faltan. Cierra CU-17, 18 y 19. |
| 5 | **Re-ejecutar conservando origen y configuración** | 04.1, 32.2, 32.3 | 1 | Al re-ejecutar se pierden el speedup y la gráfica, que son el corazón pedagógico. |
| 6 | **Exportar una ejecución a JSON** | 31.1–31.3 | 1 | Convierte un 🔴 en 🟢 con un día de frontend. |
| 7 | **Comparar ejecuciones** | 30.1–30.4 | 3 | Otro 🔴 que se cierra solo con frontend; es la vista natural para hablar de speedup. |
| 8 | **Configuraciones guardadas** | 32.1 | 1,5 | Cierra CU-32 junto con el punto 5. |
| 9 | **Una sola regla de disponibilidad + búsqueda** | 01.1, 01.3, 12.4, 29.1, 29.2, 38.1 | 2 | Porcentajes contradictorios (100 % vs. 13/14) a la vista del jurado. |
| 10 | **Publicación con garantías + «borrador» visible (opción D)** | 37.1, 37.3, 37.4, 34.1, 41.2 + D | 5,5 | Hoy se puede publicar un bundle que nadie puede incorporar, y en local nada indica que Aprender muestra un borrador. |

**Total del top 10: ≈22 días.** Completan el bloque HACER YA ≈1,75 días más: 07.1/07.4, el rótulo de hilos, el `try` del parser (24.1) y alinear `casos-de-uso.md`.

**Feature aparte: el taller (CU-28), ≈6–7 días.** Es un nuevo *tipo de lección* con pasos y casillas «Lo hice» (sección 3.2).

---

## 2. Hallazgos de la verificación

### 2.1 Qué estaba bien en el análisis

- **Los hechos se sostienen.** En los 41 CU no se encontró ningún faltante inventado. Las citas de comportamiento (el quiz que completa la lección, `primerEjemplo`, `MODULE_NOT_EMPTY`, la caché del índice, el orden bundle→índice…) coinciden con el código.
- **Los 🔴 son reales.** No existe nada de taller, comparación, exportación estructurada ni entidad curso (`grep` vacío de `workshop`, `course_id`, `compare`, `preset`).
- **Aciertos finos:**
  - CU-35 está bien 🟢: la instalación ancla versión y [checksum](#g-checksum), valida el [bundle](#g-bundle) y escribe en una sola [transacción](#g-transaccion).
  - CU-37 valora bien el orden «subir bundle → actualizar [índice](#g-indice)».

### 2.2 Qué estaba mal o incompleto

| # | Afirmación del análisis | Qué dice el código | Consecuencia |
|---|---|---|---|
| 1 | CU-07.1: «Telar cambia a Ejecutando cuando recibe la primera salida» (obligatorio, como si fuera un bug) | Es **exactamente la definición del contrato congelado** (`api-contract.md:788-789`: *compiling = aún sin primer byte de stdout*). Además, el [JIT](#g-jit) de PyOMP es perezoso: no existe un evento real de «fin de compilación». | Basta un arreglo S: cambiar el rótulo «Compilando (JIT)» por «Preparando · sin salida aún» y hacer que el cronómetro corra desde `started_at`. Detectar la fase real exigiría cambiar el contrato. |
| 2 | CU-02.4: una lección `viewed` debería completarse al abrirla | El contrato (`api-contract.md:509`) dice que el estudiante **la marca a mano**. El backend ya lo acepta (`routers/progress.py:119-124`). Solo falta el botón. | Pasa de L a S. |
| 3 | CU-08.3: «puede marcarla cancelada aunque no se detuvo» | No se marca cancelada de inmediato: `_run` sigue esperando al contenedor. El daño real es otro: acaba como «cancelada» **aunque terminara sola o por timeout**, y un segundo «Detener» no reintenta el kill. | Mismo arreglo, diagnóstico más preciso. |
| 4 | CU-24.2: «la ejecución podría continuar sin supervisión» | Timeout, cancelación y `wait` viven en `_run`, no en el drainer. Si el drainer muere se pierden logs, métricas y el **tope de salida**, pero no el control del contenedor. | Pasa a NO HACER: riesgo bajo, coste M. |
| 5 | CU-09.3: «algunos valores ausentes se convierten en 0» en la UI | El frontend de resultados ya muestra «—». El **0 lo fabrica el backend**, en `compute_metrics` (`job_runner.py:90-108`, `.get(...,0)`). | El arreglo va en otra capa. |
| 6 | CU-11: «Nada» | No hay paginación: los jobs más antiguos que el número 50 son inaccesibles, aunque la UI dice «N en total» (`ResultsList.tsx:23,69`). | Sugerencia nueva. |
| 7 | CU-31.3: «existen controles de error para la descarga de CU-10» | **Falso**, y el propio análisis lo contradice en CU-10.1: la descarga es un `<a href download>` sin manejo de error. | Contradicción interna del análisis. |
| 8 | CU-26.3: Docker queda «no disponible hasta reiniciar Telar» (obligatorio) | Cierto en desarrollo (uvicorn en el host). En el **paquete de escritorio** el backend corre en un contenedor con `restart: unless-stopped` que monta `docker.sock` (`compose.yaml:46,54`): si Docker cae, el backend cae con él y al volver crea un cliente nuevo. | Reclasificar como sugerencia: **CU-26 pasa a 🟢**. |
| 9 | CU-37.4: «cambios posteriores deben seguir identificándose como no publicados» | Ese mecanismo **no existe**: nada compara el checksum publicado con el contenido actual. No es un bug que arreglar, es una funcionalidad nueva. | NO HACER. |
| 10 | CU-41.2: «la instalación tampoco garantiza una comprobación fresca por la caché» | La instalación relee el índice por red, sin la caché de 900 s (`module_installer.py:891-893`). Solo `/remote` y el detalle usan la caché. | Solo cuenta la parte de «actualizar». |
| 11 | CU-36.2: «debe obtener exactamente la versión seleccionada si todavía existe» | El índice solo publica **una** versión por módulo. Basta con **enviar `version`** para que falle con 404 en vez de sustituirla en silencio. | S, sin tocar el contrato. |
| 12 | CU-15.1: «una respuesta antigua sobrescribe un movimiento posterior» | El GET ya descarta respuestas viejas (`useAdminResource.ts:37-51`) y `write_lock` serializa en el backend. El riesgo real es el **revert a una copia vieja** cuando falla una petición intermedia. | Menos grave de lo descrito. |
| 13 | CU-18.1: «puede borrar el video y cambiar la regla a quiz» | **Peor todavía:** también **reactiva lecciones deshabilitadas** (`enabled=True` por defecto en `schemas/admin.py:178`). | Refuerza que sea HACER YA. |
| 14 | Varios ítems de Autoría presentan como «falta la funcionalidad» lo que en realidad es «falta el botón» | `POST /admin/lessons/{id}/example`, `DELETE …/quiz`, `PUT /admin/lessons/reorder` y `GET /catalog/remote/{id}` existen y tienen tests. | Pasan de M/L a S/M. |

### 2.3 Lo que el análisis NO vio (encontrado en el código)

**Bugs que un jurado podría ver:**

1. ✅ b638029, 5f79a02 — **El contrato promete algo que el código no hace.** `api-contract.md:510` y el docstring de `routers/progress.py:105` dicen que una lección `run` se completa al terminar el job. `job_runner.py:679-687` solo escribe `last_job_id`, y ningún test lo cubre.
2. **Re-ejecutar un ejemplo editado pierde el parser** (`jobs.py:117-125`): desaparecen la curva de speedup, las barras comparativas y las observaciones. Es la parte más pedagógica del simulador.
3. **El cronómetro no corre durante `compiling`.** Un programa que no imprime nada muestra 0:00 toda la ejecución y al final salta de golpe (`jobStore.ts:325`, `useJobSocket.ts:422-427`).
4. ✅ 6b29f57, 5099e7d — **La salida puede llegar con segundos de retraso aunque cada línea termine en `\n`.** `flush_all()` solo corre tras 100 ms **sin** datos (`job_runner.py:467-474`). Con un goteo constante solo se vacía al llegar a 4 KB, lo que incumple §8.4 del contrato. Es S y no toca el contrato.
5. **La descarga puede no funcionar en Electron** (no se ejecutó, es un riesgo razonado): `API_BASE` es `http://localhost:8000` y la página se sirve desde `file://`. Chromium ignora `download` entre orígenes distintos y `security.ts:50-61` bloquea la navegación http. **Hay que probarlo a mano.**
6. **La página pública ofrece la v1.0.3** (`site/release.json:2`) mientras la app va por la v1.0.5 (`desktop/package.json:5`). La v1.0.5 es la que activa el catálogo remoto (commit `6b05c1b`), así que quien descargue desde la web podría no tener CU-34/35.
7. **Resultados dice «Job completado» también para fallidos, cancelados y timeouts** (`ResultsScreen.tsx:146,152`).
8. ✅ b638029, f92d9fa — **Tres criterios distintos de progreso.** `/modules` cuenta solo las habilitadas en el numerador y todas en el denominador; `/catalog/status` cuenta todas; `/progress` cuenta solo las habilitadas.
9. ✅ 6a400bd, f92d9fa — **Una lección archivada es accesible por URL sin ningún aviso** (`LessonDetail.archived` existe, pero ningún `.tsx` lo lee).
10. ✅ b638029, f92d9fa — **Aprobar el quiz de una lección deshabilitada la completa**, y el frontend suma +1 aunque el backend no lo cuente.

**Deuda técnica:**

11. ✅ 1dc3950 — **El DTO admin del frontend no sigue el contrato** (`api/admin-types.ts:113-139`): le faltan `video_url`, `enabled` y `completion_rule`. Es la **causa raíz** de 17.1, 17.2 y 18.1.
12. **Los 422 de pydantic no se entienden en el front**: `coerceEntries` busca `{field, reason}` y pydantic envía `{type, loc, msg}`. Es la causa raíz del grupo «errores por campo».
13. ✅ 7f079e2, f0d9980 — **`/health` y `/system` bloquean el [event loop](#g-event-loop)** con llamadas síncronas a Docker de hasta 120 s. `useSystemInfo` reintenta `/system` 60 veces.
14. ✅ 785aaa0 — **`locally_modified` nunca se activa** (`set_locally_modified_no_commit` no tiene llamadores). Una actualización pisa sin avisar las ediciones del admin.
15. ✅ 785aaa0 — **Probable (no ejecutado): el autor se verá a sí mismo con «actualización disponible»** tras publicar, porque `installed_modules.installed_version` no se actualiza.
16. **Un comentario falso en la UI:** `PublishModuleDialog.tsx:13-14` asegura que se anclan versión y checksum. No es así.
17. **El checksum del ensayo nunca coincide con el publicado**, porque `published_at` entra en el hash y se recalcula en cada llamada.
18. ✅ 0b7b607 — **`--check` de la CLI sin `--db` nunca mira la base instalada**: siempre dice «contenido OK».
19. ✅ 0b7b607 — **`--prune` deja progreso [huérfano](#g-huerfano)**: un id reutilizado lo «resucita».
20. ✅ 0b7b607 — **La CLI no avisa al servidor en marcha.** Tras un seed/reset, el estudiante ve el contenido viejo hasta reiniciar.
21. **`mark_orphans_failed` no fija `finished_at`.**
22. ✅ b638029 — **`POST /jobs` no comprueba que `lesson_id` corresponda al ejemplo.** Si se implementa `run` sin arreglar esto, cualquier ejecución completaría cualquier lección.
23. ✅ a7a0b42 — **Modo web:** el pie de estado se pone verde con cualquier `/health` 200, aunque Docker esté caído.
24. **`ThreadsTable` pinta N+1 filas** («master» más t0..tN-1). En OpenMP el master **es** el hilo 0: es un error conceptual en un curso de OpenMP.
25. **Versiones internas descuadradas:** el compose empaquetado fija `telar-backend:1.0.2` y `BACKEND_VERSION = "1.0.1"`, mientras la app va por la 1.0.5.

**Aviso sobre los archivos «modificados» de `git status`:** los 29 son **solo cambios de fin de línea (CRLF)**. `git diff --ignore-cr-at-eol` sale vacío y no hay arreglos en curso. Un `.gitattributes` con `* text=auto eol=lf` más un `git add --renormalize .` lo dejaría limpio (también aparece `.gitattributes` como modificado).

### 2.4 Coherencia de las etiquetas con el criterio del director

| Contradicción | Por qué lo es | Propuesta |
|---|---|---|
| **CU-02.1 (taller) es 🚨 en CU-02, pero el taller es todo CU-28 🔴** | Un faltante no puede contar dos veces. Además, el taller **no es un componente de la lección sino otro tipo de lección** (pasos + casillas, sin quiz ni video). Mientras siga en CU-02, este nunca será 🟢 aunque su recorrido normal funcione. | Sacarlo de CU-02 y dejarlo solo en CU-28. **CU-02 pasa a 🟢**, y 02.2 («componentes obligatorios y opcionales») deja de hacer falta: NO HACER. |
| **CU-02.3–02.5 son 💡, pero CU-12.1 (el mismo defecto: `viewed`/`run` nunca completan) es 🚨** | El mismo bug tiene dos etiquetas distintas. | Unificar. Hoy es 💡 de hecho, porque **las 14 lecciones reales son `quiz`** y afecta a 0 lecciones. **Pero** CU-17.2 (🚨) pide dejar al admin elegir `viewed`/`run`, y en ese momento pasa a ser frecuente. Regla: *17.2 y 12.1 van juntos; no se entrega uno sin el otro*. |
| **CU-03 🟢 frente a CU-12 🟡** | No es contradictorio: CU-03.1 (el quiz completa todo) es 💡 porque con reglas `quiz` el resultado es correcto; CU-12 es 🟡 por 12.1. Parece contradictorio porque hablan del mismo mecanismo. | Mantener, y anotar en ambos «misma causa raíz: grupo Requisitos». |
| **CU-26.3 🚨** | En el despliegue real (el paquete de escritorio) el backend se reinicia junto con Docker. Solo pasa en desarrollo. | 💡. **CU-26 pasa a 🟢.** |
| **CU-07.1 🚨** | Cumple el contrato congelado. El escenario frecuente que sí afecta al estudiante es el cronómetro a 0:00, que no estaba en el análisis. | Mantener 🚨, pero redefinido como «rótulo + cronómetro»; deja de ser «detectar la fase real». |
| **CU-16.1 🚨** | Existe una ruta alternativa (borrar las lecciones una a una) y el 409 `MODULE_NOT_EMPTY` está en el contrato. Por el criterio del director podría ser 💡. | Mantener 🚨 solo si el director considera que borrar un módulo con contenido es frecuente. Si se hace, usar `?cascade=true` (aditivo). |
| **CU-22.2 💡** | Hoy es inocuo (solo escribe `last_job_id`). En cuanto se implemente `run` (diseño A), **una prueba del admin completaría la lección**. | Subirlo a 🚨 y hacerlo junto con el diseño A. |
| **Numeración de CU-23 (🚨 = 2, 3; 💡 = 1) y CU-26 (🚨 = 3; 💡 = 1, 2, 4)** | Parece rota, pero **conserva los identificadores** del 18-09 (`prompts-cierre` los cita como CU-18.1, CU-22.2…). | **No renumerar.** Añadir una nota: «los números son identificadores estables, no un orden». |
| **CU-27 duplicado** (solo en el archivo en disco) | Error de copia. | Borrar el segundo bloque (líneas 1943-2056). |
| **CU-35 🟢 con una nota de progreso heredado** | Coherente: es un problema de identidad del progreso, no de incorporación. | Mantener. |
| **CU-10 🟢 y CU-33 🟢** | Coherentes en el papel, pero con riesgos sin verificar (Electron y versión de la web). | 🟢⚠ hasta verificar. |

---

## 3. Grupos por causa raíz

> **Por qué agrupar.** Los 133 faltantes no son 133 problemas. Son unas 15 causas que se repiten. Arreglar una causa cierra varios ítems a la vez, y así se evita arreglar lo mismo tres veces de tres formas distintas.

### 3.1 Borrador vs. publicado (13 ítems: 13.2, 14.2, 15.2, 16.3, 17.5, 18.6, 19.4, 20.2, 21.4, 22.1, 36.1, 39.3, 40.3)

**El problema.** Cuando el admin guarda un cambio en Autoría, el estudiante de **esa misma instalación** lo ve al instante en `/aprender`. No existe una «versión de trabajo».

> **Analogía.** Un periódico en el que cada tecla que pulsa el redactor aparece al momento en la edición impresa. Lo normal es tener una **galerada** (borrador) y una **edición publicada**. «Publicar» es el momento en que la galerada pasa a imprenta.

**Por qué pasa.** Todo lo que ve el estudiante sale de un único [snapshot](#g-snapshot) en memoria, `app.state.content`. Cada escritura de Autoría pasa por `_persist`, que escribe en SQLite, **reconstruye el snapshot y lo intercambia**:

```python
# backend/app/services/content_writer.py:285-304 (recortado)
async with app.state.content_read_lock:
    try:
        await write()  # INSERT/UPDATE/DELETE (sin commit)
        new_content = await ContentRepository.load(db)  # valida el grafo
        await db.commit()
    except ...:
        await db.rollback(); raise ...
app.state.content = new_content  # swap atómico SOLO tras commit OK
```

**Esto no es un descuido.** El contrato congelado lo exige: `api-contract.md:1153-1156` dice «Tras un `2xx`, el siguiente GET público ya sirve el contenido nuevo; el estudiante ve el curso actualizado de inmediato». Lo repite `data-model.md:892-897` (§7.4).

**Dato decisivo:** la app del estudiante **no incluye el router admin** (`backend/Dockerfile:22-42`, `TELAR_ADMIN_BUILD=0`). El estudiante solo recibe contenido por la siembra inicial o por un bundle de GCS, que es inmutable y versionado. **Entre máquinas, borrador y publicado ya están separados.** El problema solo existe en la máquina del autor.

**Aclaración importante: hay tres copias, no dos.**

```
Máquina del autor                                       Nube (GCS)
┌────────────────────────────────────┐
│  SQLite local                      │   botón         ┌──────────────┐
│   ├─ lo que editas en Autoría  ◄───┼── es lo mismo   │ bundle v3    │
│   └─ lo que muestra «Aprender» ◄───┘                 │ + índice     │
│                                    │ ── Publicar ──► │              │
└────────────────────────────────────┘                 └──────┬───────┘
                                                              │ Incorporar / Actualizar
                                          Máquina del estudiante ◄┘
```

Entre la máquina del autor y la nube **ya existe** la separación: guardar no toca la nube y «Publicar» (CU-37) sube el bundle. Lo único que se mezcla es Autoría y «Aprender» **dentro de la máquina del autor**.

**Alternativas pesadas, descartadas por sobreingeniería** (se conservan aquí para entender el porqué):

| Diseño | Idea | Esfuerzo | Riesgo | Contrato | Migración |
|---|---|---|---|---|---|
| **A. Tablas espejo `draft_*`** | Duplicar `modules`, `lessons`, `examples` y `quiz_questions`; publicar = copiar | 8–10 días | Alto: cada migración futura se hace dos veces | Cambia la semántica de §10.1 | 4 tablas nuevas |
| **B. Snapshot publicado** | Las tablas actuales pasan a ser el borrador; al publicar se serializa el `ContentRepository` en una tabla `published_snapshots` y el estudiante lee de ahí | **MVP ≈3–3,5 días** (completo 5–6) | Medio: se adaptan ~12 tests con un helper `_publicar()` | Aditivo más un cambio de semántica de §10.1 (con un [ADR](#g-adr) condicionado a `admin_mode`) | 1 tabla nueva, sin tocar las existentes |
| **C. Columna `status` por fila** | PK `(id, status)` y filtrar todas las lecturas | 10–12 días | **El más alto**: si falta un `WHERE`, el borrador se filtra al estudiante sin que nada falle | Igual que A | Reconstruir 4 tablas y sus FK |
A, B y C resuelven algo que el jurado casi nunca vería (que el autor, en su propia máquina, vea en «Aprender» la versión publicada y no el borrador) a cambio de 3,5 a 12 días, migraciones y un cambio de semántica en el contrato. **No compensa.**

**Recomendación: D+ (propuesta de Jorge), ≈2 días, HACER YA.**

1. **Etiqueta de borrador (0,5 días).** En modo autor, «Aprender» muestra un aviso «Vista previa: estás viendo tu borrador; los estudiantes ven la última versión publicada».
2. **Detección de cambios por checksum (≈1,5 días).** Al abrir el diálogo de Publicar, se construye el bundle con el contenido local y se compara su huella con la que ya guarda el índice de la nube. **Hay que descargar el bundle vigente (la «copia temporal» de la propuesta original): el índice no puede guardar la huella nueva porque la v1.0.5 rechaza campos desconocidos (`extra="forbid"`). Se descarga una vez por versión y queda en caché, y se comprueba que su id y su versión sean los que anuncia el índice.**
   - **Iguales:** «No hay cambios que publicar» y el botón queda deshabilitado.
   - **Distintos:** «Tienes cambios sin publicar» y se publica la versión N+1.
3. **Condición técnica:** hoy el checksum incluye `published_at`, que cambia en cada llamada, así que siempre saldría «distinto». Hay que calcular la huella **sin** esa fecha.
4. **Qué más cierra de paso:**
   - 37.4: Autoría puede mostrar «cambios sin publicar».
   - 37.3: si el bundle ya estaba subido y la huella coincide, solo se completa el índice, en lugar de fallar con `VERSION_CONFLICT`. Publicar se vuelve [idempotente](#g-idempotencia).

**Qué pasa con los 13 ítems «separar edición de publicación»:** se **reclasifican**. La separación que importa, estudiante frente a autor, ya existe entre máquinas. D+ hace visible y seguro el resto. Se documenta en la memoria como decisión de diseño.

**Riesgo de implementarlo:** bajo, no toca el contrato ni requiere migración. **Riesgo de no hacerlo:** el autor puede confundirse y creer que sus cambios ya están publicados.

### 3.2 Modelo de requisitos de completitud (02.2–02.5, 03.1, 12.1–12.3, 17.2, 22.2 y todo CU-28)

**El problema.** Cada lección tiene una sola `completion_rule` ∈ {`quiz`, `viewed`, `run`}, y hoy:

- aprobar el quiz completa la lección **sin mirar la regla**;
- una lección `viewed` **nunca** se completa;
- una lección `run` **nunca** se completa.

> **Analogía.** Un profesor que da la asignatura por aprobada en cuanto apruebas el parcial, aunque el programa diga que también hay que entregar el proyecto. Y a quien tiene que entregar solo el proyecto, nunca lo aprueba, porque ni siquiera mira los proyectos.

**Por qué pasa:**

```python
# backend/app/services/quiz_service.py:164-171 — no mira completion_rule
await self._progress.upsert_no_commit(
    lesson_id,
    completed=True if passed else None,  # None = no tocar
    best_quiz_score=score,
    completed_via="quiz" if passed else None,
)
```

```python
# backend/app/services/job_runner.py:679-687 — un job exitoso NUNCA completa
if status == "completed" and handle.lesson_id and self._progress is not None:
    await self._progress.upsert(handle.lesson_id, last_job_id=handle.job_id)
```

Y en `viewed`, el backend **sí** acepta `completed:true` (`progress.py:119-124`), pero el frontend solo envía `{viewed: true}` (`progressStore.ts:73`) y no hay botón «Marcar como leída».

**Dato que baja la urgencia:** las **14 lecciones reales usan `quiz`**. Ninguna usa `viewed` ni `run`, así que hoy el bug afecta a 0 lecciones. Aparece en cuanto CU-17.2 deje elegir la regla.

**Opciones (agente architect).** Solo A se recomienda; B y C se descartan por sobreingeniería una vez que el taller se entiende como un tipo de lección (ver más abajo):

| Diseño | Idea | Esfuerzo | Riesgo | Contrato | Migración | ¿Taller? |
|---|---|---|---|---|---|---|
| **A. Regla única, lógica corregida** | Quiz completa solo si `rule=='quiz'`; botón para `viewed`; `run` completa con un job `completed` **del ejemplo de esa lección** | **2–2,5 días** | Bajo; `completed` sigue siendo [monótono](#g-monotonia) | **Ninguno** (el contrato ya lo promete); una nota aclaratoria en §5.2 | Ninguna | No |
| **B. Tablas `lesson_requirements` + `progress_requirements`** | Normalización completa | 9–12 días | Alto: dos fuentes de verdad, y `bundle extra="forbid"` hace que la v1.0.5 rechace bundles nuevos | Aditivo, más `bundle_format: 2` | 2 tablas + [backfill](#g-backfill) | Sí |
| **C. Híbrido** | `completion_rule` = regla principal; `requirements_json` opcional; columnas `viewed_at`, `quiz_passed_at`, `run_ok_at`, `workshop_done_at`; función pura `derive_completed()` | ≈7 días | Medio | Aditivo; `requirements` se omite si es null, así los bundles siguen en formato 1 | Solo `ADD COLUMN` + backfill | Sí, de forma natural |

**Recomendación: solo A (HACER YA).** B y C sobran: cada tipo de lección tiene una sola forma de completarse, y el taller no se suma como un requisito más.

Detalles de A que no se pueden olvidar:

1. `POST /jobs` debe verificar que `example_id == lesson.example_id`. Si no, cualquier código enviado con ese `lesson_id` completaría la lección.
2. Las pruebas del admin (CU-22.2) **no** deben enviar `lesson_id`.
3. `module_merge.py:385` debe condicionar la recalificación a `rule=='quiz'`.
4. Hace falta crear una lección `viewed` y otra `run` de demostración (por ejemplo `queEsUnHilo`) para que el jurado vea la corrección.

#### El taller (CU-28) como tipo de lección: *feature*, ≈6–7 días

> **Idea de Jorge.** El taller no es un componente que se suma a la lección (como el video o el quiz). **Es otro tipo de lección**, como los tutoriales de Unity Learn: vas avanzando por una guía y pulsas «Lo hice» en cada paso. Cuando marcas todos los pasos, has completado el taller. No hay quiz ni video.

**Cómo encaja con lo que ya existe:**

| Pieza | Diseño simple |
|---|---|
| Identificarlo | Columna `lessons.kind` ∈ {`leccion`, `taller`} con `ALTER TABLE … ADD COLUMN` (valor por defecto `leccion`). No hace falta reconstruir la tabla ni tocar el `CHECK` de `completion_rule`. |
| Pasos | Tabla `workshop_steps(lesson_id, idx, title, body_markdown, example_id NULL)`. `example_id` es opcional: si existe, el paso muestra «Abrir en el simulador» (taller **con** código); si no, es solo lectura y acción (taller **sin** código). |
| Casillas | Tabla `workshop_step_progress(lesson_id, idx, done_at)`. Marcar o desmarcar es un `PUT` idempotente. |
| Retomar | Las casillas quedan guardadas: al volver, el taller se abre en el primer paso sin marcar. |
| Completar | Función pura `taller_completo = todos los pasos marcados`. Al marcar el último, se escribe `lesson_progress.completed=1` (`completed_via='manual'`). Así **el taller cuenta en el progreso del módulo como cualquier lección**, sin tocar los agregados. |
| Errores | Si falla el guardado de una casilla, la UI la desmarca y avisa. Nunca se da por completado lo que no se guardó. |
| Contrato | Aditivo: `LessonDetail.kind` (opcional) y `steps[]`, el endpoint `PUT /progress/lessons/{id}/steps/{idx}` y los endpoints admin para editar pasos. |
| Autoría | Un editor de lista de pasos (añadir, editar, reordenar y borrar) dentro del editor de lección cuando `kind='taller'`. |
| Catálogo | Un bundle con talleres lleva `kind` y `steps`. La v1.0.5 los rechaza (`extra="forbid"`), así que se publica como `bundle_format: 2` y las apps viejas dan un error claro. Los bundles sin talleres siguen en formato 1. |

**Esfuerzo:** backend 2 días (migración 6, repositorio, endpoints, completitud), estudiante 2 días (vista de pasos con barra de avance), Autoría 1,5 días y tests 1,5 días, ≈**6–7 días**, frente a los 14–16 del diseño anterior (taller como requisito + diseño C).

**Cubre los seis faltantes de CU-28:**

- 28.1: es identificable como tipo de lección.
- 28.2: admite talleres con y sin código.
- 28.3: se puede retomar.
- 28.4: tiene su propia condición, que todas las casillas estén marcadas.
- 28.5: queda integrado en el progreso.
- 28.6: gestiona los errores.

**Riesgo de NO hacer A:** el contrato congelado promete un comportamiento que el código no cumple. Si alguien del jurado lee el contrato y prueba una lección `run`, lo ve.

### 3.3 Respuestas tardías que pisan el estado más reciente (05.2, 06.1, 15.1, 22.3)

**El problema.** El estudiante elige el ejemplo A, se arrepiente y elige B (o «Código propio»). Si la petición de A llega **después**, reemplaza el editor con A.

> **Analogía.** Pides un café, cambias de opinión y pides un té. El camarero te trae el té, y cinco minutos después aparece el café y te lo deja encima del té. Es una [race condition](#g-race) de tipo [stale response](#g-stale).

**Por qué pasa:**

```tsx
// frontend/src/features/simulator/SimulatorIdle.tsx:67-78
const selectExample = useCallback((exampleId: string) => {
  if (exampleId === '') {
    setExample(null)          // "Código propio": no cancela nada pendiente
    return
  }
  getExample(exampleId)       // sin AbortController / id de petición
    .then((detail) => {
      setExample(detail)
      setCode(detail.source_code)   // pisa lo escrito o subido después
```

**Soluciones:**

1. Un **contador de petición** (`const req = ++reqRef.current; … if (req !== reqRef.current) return`).
2. Un [AbortController](#g-abort) que cancele la petición anterior.
3. En el reorden (15.1), **deshabilitar los botones mientras hay un guardado en vuelo**, o usar la respuesta del PUT (que ya devuelve la lista) en vez de un GET extra.

El patrón ya existe en el repo: `useAdminResource.ts:37-51` y `SimulatorLive.tsx:92-105`. Solo hay que aplicarlo.

**Recomendación:** HACER SI HAY TIEMPO (≈1 día en total, riesgo muy bajo). **Riesgo de no hacerlo:** bajo; hace falta hacer clic muy rápido para provocarlo.

### 3.4 Aviso de cambios sin guardar (13.1, 14.1, 17.3, 18.4, 21.2, 39.4, 40.2)

**El problema.** El modal de módulo se cierra con Escape, con un clic fuera o con Cancelar, y pierde lo escrito. El editor de ejemplos calcula `dirty` pero no lo usa. El editor de lecciones solo protege los cambios de ruta (`pathname`), no la recarga ni el cierre de la ventana.

> **Analogía.** Un Word que no pregunta «¿Guardar cambios?» al cerrar.

**Solución:** un único hook `useUnsavedChangesGuard(dirty)` que combine tres piezas:

1. [`useBlocker`](#g-useblocker) de React Router para **toda** navegación (no solo la que cambia el `pathname`).
2. [`beforeunload`](#g-useblocker) para recargar o cerrar la pestaña.
3. Una confirmación propia en los modales.

En Electron, `beforeunload` no muestra un diálogo por sí solo: hay que escuchar `will-prevent-unload` en el proceso main.

**Recomendación:** HACER SI HAY TIEMPO (≈1,5 días). **Riesgo de no hacerlo:** medio en la demo, porque es el tipo de detalle que un evaluador prueba.

### 3.5 Errores de validación por campo (06.3, 13.3, 14.3, 17.4, 18.5, 19.3, 21.3)

**El problema.** Si se deja vacío el título, el nivel o `minutes=0`, sale «El cuerpo o los parámetros de la petición no son válidos», sin decir qué campo falla.

**Por qué pasa.** Hay dos formatos de error:

- Las reglas de negocio devuelven `details=[{field, reason}]`, y el front **sí** las mapea (`field-errors.ts:23-36`).
- Pydantic devuelve un [422](#g-422) con `details=[{type, loc, msg}]`, y `coerceEntries` no lo reconoce.

Además, `ModuleFormDialog` ni siquiera lee `details`. Y las validaciones del front no coinciden con las del back:

- minutos ≥0 en el front frente a ≥1 en el back;
- `parseInt('2.5')` da 2;
- el front acepta `.PY` y espacios, y el back exige `^[A-Za-z0-9._-]{1,80}\.py$`.

**Solución (solo frontend, sin tocar el contrato):**

1. En `coerceEntries`, mapear `loc[-1]` → campo y `msg` → texto en español.
2. Validar en el cliente con las mismas reglas del schema.
3. En CU-06, validar o sanear el nombre **antes** de reemplazar el editor.

**Recomendación:** HACER SI HAY TIEMPO (≈1 día). **Riesgo de no hacerlo:** medio: un mensaje genérico es fácil de ver en una demo.

### 3.6 Limpieza y reconciliación de recursos Docker/SQLite (08.1, 08.3, 08.4, 24.1–24.6, 25.1–25.3, 26.4, 37.3, 37.4, 41.3)

**El problema.** Son fallos en los caminos de error:

- una limpieza que falla y se ignora (`rmtree(ignore_errors=True)`, contando «borrado» igualmente);
- el cupo del [semáforo](#g-semaforo) que se libera antes de borrar el contenedor;
- un guardado en SQLite que falla y convierte un éxito en un fallo;
- un timeout confundido con «Docker caído»;
- una publicación a medias (bundle subido pero índice sin actualizar) que no se puede reintentar.

> **Analogía.** Un hotel que da por libre la habitación antes de que la limpien, y si la aspiradora falla, apunta «limpia» de todos modos.

**El patrón correcto es la [reconciliación](#g-reconciliacion):**

1. Registrar lo que *debería* existir.
2. Comparar periódicamente con lo que *existe*.
3. Corregir la diferencia.

El reaper de arranque ya es una reconciliación, pero solo corre una vez y solo si Docker está disponible.

**Por qué pasa (ejemplo con el parser):**

```python
# backend/app/services/job_runner.py:660-667 + 704-713
parsed = parse_output(handle.parser_id, handle.stdout_text(), ...)  # sin try
# float("1.2.3") -> ValueError -> cae al except general:
status = "cancelled" if handle.kill_reason == KILL_CANCEL else "failed"
error_detail = None if status == "cancelled" else "sandbox_error"
```

**Recomendación: elegir con bisturí.**

- **HACER YA:** 24.1 (un `try` alrededor del parser; 15 minutos; un programa correcto no debe salir «fallido»).
- **SI HAY TIEMPO:**
  - 08.1: no aceptar la cancelación si el contenedor ya salió; mirar el `exit_code`.
  - 08.3.
  - 24.3.
  - 24.6: comparar el tiempo transcurrido con `timeout_s`.
  - 25.1 y 25.2: sacar el barrido de directorios fuera de Docker y comprobar `exists()` después de `rmtree`.
- **Ya cubiertos por D+ (sección 3.1):** 37.3 y 37.4, con la comparación de checksums.
- **NO HACER:** 08.4, 24.2, 24.4, 24.5, 25.3, 26.4 y 41.3. Cada uno cuesta M y ocurre en caminos muy raros, y se defienden mejor en la memoria como «trabajo futuro: reconciliación continua».

**Riesgo de no hacerlo:** bajo en una demo. Todos requieren fallos de infraestructura provocados.

### 3.7 El PUT que reemplaza la lección entera (18.1, 19.2)

**El problema.** Editar solo el título de una lección borra su video, devuelve la regla a `quiz` y **reactiva** una lección deshabilitada.

> **Analogía.** Para corregir una falta de ortografía en tu ficha, la secretaría imprime una ficha nueva con solo los campos que tenía a mano y rellena el resto con valores por defecto.

**Por qué pasa.** `PUT` significa «reemplazar el recurso completo» ([PUT vs. PATCH](#g-put)). El frontend envía 6 campos y el schema rellena los que faltan con sus valores por defecto:

```ts
// frontend/src/features/admin/lesson/AdminLessonEditor.tsx:179-186
const base = { module_id, order, title, estimated_minutes,
               content_markdown, recommended }   // sin video_url / enabled / completion_rule
```

```python
# backend/app/schemas/admin.py:175-180
video_url: str | None = Field(default=None, ...)
enabled: bool = True
completion_rule: Literal["quiz", "viewed", "run"] = "quiz"
```

**Solución:**

1. Actualizar `admin-types.ts` al contrato.
2. Que `fromDetail` conserve esos campos.
3. Enviarlos siempre.

No hace falta tocar el contrato, que ya los admite. **HACER YA, 0,5 días.** **Riesgo de no hacerlo:** alto, porque es pérdida silenciosa de datos.

### 3.8 Una sola regla de disponibilidad de lecciones (01.1, 01.3, 12.4, 29.1, 29.2, 38.1)

**El problema.** «Archivada» y «deshabilitada» se tratan distinto en cada pantalla. El resultado: un módulo puede marcar 100 % mientras el total dice 13/14, una lección archivada aparece como vigente y «Continuar» lleva a un id fijo que puede no existir.

**Solución:**

1. Una función `cuenta_para_progreso(l) = l.enabled and not l.archived`.
2. **Filtrar las archivadas en el servidor**, dentro de `/modules` (así no hace falta añadir un campo al contrato).
3. Usar `lessons_enabled`, que ya existe en el DTO y no se usa.
4. «Continuar» = la última visitada si sigue disponible; si no, la primera disponible.

**HACER YA, 2 días.**

### 3.9 Identidad del progreso (35 nota, 38.2)

`lesson_progress.lesson_id` es la PK, sin módulo ni publicación. Si una publicación B reutiliza el `lesson_id` de otra A ya borrada, hereda su progreso. Arreglarlo exige una [migración de esquema](#g-migracion) de `lesson_progress` y `quiz_attempts`, y choca con la promesa del contrato (§11.0.7) de que los `lesson_id` son estables. **NO HACER.** Es un caso rarísimo en una instalación monousuario. Documentarlo.

### 3.10 Entidad curso (39.1, 39.2, 40.1, 41.1)

Hoy la **unidad publicable es el módulo**: un bundle = un módulo, y el índice es una lista plana de módulos. Crear la entidad curso exige una tabla `courses`, `modules.course_id`, endpoints nuevos, **`bundle_format: 2`** y una migración que cree un curso por cada módulo antiguo. Son ≈8–10 días, además de romper la compatibilidad con la v1.0.5, que rechaza campos nuevos (`extra="forbid"`).

**Recomendación: RECLASIFICAR, si el director lo acepta.** Se definiría «curso» = el módulo publicable. Así:

- CU-39 ≡ CU-13 🟢;
- CU-40 ≡ CU-14 🟢;
- CU-41 = retirar un módulo del catálogo: 41.1 (M, 2,5 días) + 41.2 (S).

Si el director exige la entidad, pasa a ser el trabajo más grande del plan.

---

## 4. Evaluación por ítem

Leyenda:

- **Etiqueta:** 🚨 obligatorio / 💡 sugerencia / 📝 nota.
- **Verificación:** ✅ confirmado / ◐ parcialmente cierto.
- **Esfuerzo:** S ≤1 día / S-M ≈1 / M 2–3 / L ≥4.
- **Riesgo:** riesgo de *implementarlo* (regresiones, contratos, migraciones).

| Ítem | Faltante | Etiq. | Verif. | Veredicto | Esf. | Riesgo | Grupo |
|---|---|:-:|:-:|---|:-:|:-:|---|
| CU-01.1 | Búsqueda y filtros: módulos sin coincidencias y resultados ocultos en módulos cerrados | 🚨 | ✅ | HACER YA ✅ f92d9fa | S | Bajo | Disponibilidad de lecciones |
| CU-01.2 | Mensaje global «sin resultados» | 💡 | ✅ | SI HAY TIEMPO ✅ f92d9fa | S | Bajo | Suelto |
| CU-01.3 | «Continuar/Empezar» con id fijo `primerEjemplo` | 💡 | ✅ | HACER YA ✅ f92d9fa | S | Bajo | Disponibilidad de lecciones |
| CU-02.1 | Taller asociado a la lección | 🚨 | ✅ | RECLASIFICAR | L | Alto | Requisitos de completitud |
| CU-02.2 | Componentes obligatorios y opcionales | 💡 | ✅ | NO HACER | L | Medio | Requisitos de completitud |
| CU-02.3 | El quiz completa la lección aunque haya otros requisitos | 💡 | ✅ | HACER YA ✅ b638029, 5f79a02 | S | Bajo | Requisitos de completitud |
| CU-02.4 | Completar por visualización (falta el botón; el backend ya lo soporta) | 💡 | ◐ | HACER YA ✅ f92d9fa | S | Bajo | Requisitos de completitud |
| CU-02.5 | Completar por ejecución (`run` no implementado) | 💡 | ✅ | HACER YA ✅ b638029, 5f79a02 | S | Bajo | Requisitos de completitud |
| CU-03.1 | Aprobar el quiz marca toda la lección | 💡 | ✅ | HACER YA ✅ b638029, 5f79a02 | S | Bajo | Requisitos de completitud |
| CU-04.1 | Re-ejecutar pierde ejemplo, lección y parser | 🚨 | ✅ | HACER YA ✅ 1d17085 | S | Bajo | Simulador: re-ejecución y editor |
| CU-05.1 | El editor se bloquea si falla `/modules` | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Simulador: re-ejecución y editor |
| CU-05.2 | Un ejemplo que llega tarde pisa «Código propio» | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Respuestas tardías |
| CU-06.1 | Una carga anterior pisa el archivo actual | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Respuestas tardías |
| CU-06.2 | Subir archivo bloqueado si falla el catálogo | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Simulador: re-ejecución y editor |
| CU-06.3 | Nombre de archivo validado distinto en front y back | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Errores por campo |
| CU-07.1 | «Compilando» vs. «Ejecutando» (coincide con el contrato) | 🚨 | ◐ | HACER YA ✅ 6d65d04, 82c10fa | S | Bajo | En vivo y resultados |
| CU-07.2 | Salida sin `\n` retenida | 💡 | ✅ | NO HACER | M | Medio | En vivo y resultados |
| CU-07.3 | Huecos de salida tras reconectar, sin aviso | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | En vivo y resultados |
| CU-07.4 | El cronómetro se reinicia al volver | 💡 | ✅ | HACER YA ✅ 6d65d04, 82c10fa | S | Bajo | En vivo y resultados |
| CU-07.5 | Estado por hilo presentado como medido | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | En vivo y resultados |
| CU-08.1 | Cancelar pisa un fin natural | 💡 | ✅ | SI HAY TIEMPO | S | Medio | Limpieza y reconciliación |
| CU-08.2 | Cancelar con el WebSocket caído no avisa | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | En vivo y resultados |
| CU-08.3 | No se comprueba que el contenedor se detuvo | 💡 | ◐ | SI HAY TIEMPO | S-M | Medio | Limpieza y reconciliación |
| CU-08.4 | Se emite el estado antes de persistirlo | 💡 | ✅ | NO HACER | M | Medio | Limpieza y reconciliación |
| CU-08.5 | Botón Detener visible sin conexión | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | En vivo y resultados |
| CU-09.1 | Mostrar la configuración completa del job | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | En vivo y resultados |
| CU-09.2 | stderr y causa del error completos | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | En vivo y resultados |
| CU-09.3 | Métrica ausente mostrada como 0 (el 0 nace en el backend) | 💡 | ◐ | SI HAY TIEMPO | S | Bajo | En vivo y resultados |
| CU-09.4 | Rótulo «Hilos (PIDs)» engañoso | 💡 | ✅ | HACER YA ✅ d370739 | S | Bajo | En vivo y resultados |
| CU-10.1 | Error de descarga no manejado (y posible fallo en Electron) | 💡 | ✅ | HACER YA ✅ 71eee1a, 82c10fa | S | Bajo | En vivo y resultados |
| CU-12.1 | Lecciones `viewed`/`run` nunca se completan | 🚨 | ✅ | HACER YA ✅ b638029, f92d9fa, 5f79a02, 66ab557 (viewed respeta la disponibilidad) | S | Bajo | Requisitos de completitud |
| CU-12.2 | El quiz ignora `completion_rule` | 💡 | ✅ | HACER YA ✅ b638029, f92d9fa, 5f79a02, 53de886 | S | Bajo | Requisitos de completitud |
| CU-12.3 | Mostrar qué requisito falta | 💡 | ✅ | SI HAY TIEMPO | S-M | Bajo | Requisitos de completitud |
| CU-12.4 | Progreso general vs. por módulo incoherente | 💡 | ✅ | HACER YA ✅ b638029, f92d9fa | S | Bajo | Disponibilidad de lecciones |
| CU-13.1 | Aviso de cambios sin guardar (modal de módulo) | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Cambios sin guardar |
| CU-13.2 | Separar creación de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-13.3 | Error de validación comprensible | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Errores por campo |
| CU-14.1 | Aviso de cambios sin guardar | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Cambios sin guardar |
| CU-14.2 | Separar edición de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-14.3 | Error de validación comprensible | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Errores por campo |
| CU-15.1 | Reorden concurrente sin serializar | 💡 | ◐ | SI HAY TIEMPO | S | Bajo | Respuestas tardías |
| CU-15.2 | Separar el orden en edición del publicado | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-16.1 | Eliminar módulo con sus lecciones | 🚨 | ✅ | SI HAY TIEMPO | M | Medio | Huecos de UI en Autoría |
| CU-16.2 | Advertir del contenido asociado | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Huecos de UI en Autoría |
| CU-16.3 | Separar eliminación de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-17.1 | Crear lección sin ejemplo | 🚨 | ✅ | HACER YA ✅ d16a36e | S | Bajo | Huecos de UI en Autoría |
| CU-17.2 | Configurar regla de completitud y video | 🚨 | ✅ | HACER YA ✅ d16a36e | S-M | Bajo | Huecos de UI en Autoría |
| CU-17.3 | Aviso completo de cambios sin guardar | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Cambios sin guardar |
| CU-17.4 | Error de validación comprensible | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Errores por campo |
| CU-17.5 | Separar creación de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-18.1 | Guardar pisa video, regla y `enabled` | 🚨 | ✅ | HACER YA ✅ 1dc3950 | S | Bajo | PUT que reemplaza la lección |
| CU-18.2 | Agregar ejemplo a lección sin ejemplo | 🚨 | ✅ | HACER YA ✅ d16a36e | M | Bajo | Huecos de UI en Autoría |
| CU-18.3 | Eliminar el quiz (backend listo, sin botón) | 🚨 | ✅ | HACER YA ✅ d9dc146 | S | Bajo | Huecos de UI en Autoría |
| CU-18.4 | Aviso completo de cambios sin guardar | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Cambios sin guardar |
| CU-18.5 | Error de validación comprensible | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Errores por campo |
| CU-18.6 | Separar edición de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-19.1 | Recolocar las demás lecciones al mover una | 🚨 | ✅ | HACER YA ✅ d16a36e | M | Bajo | Huecos de UI en Autoría |
| CU-19.2 | Mover no debe tocar otros datos | 🚨 | ✅ | HACER YA ✅ 1dc3950 | S | Bajo | PUT que reemplaza la lección |
| CU-19.3 | Posición decimal aceptada (2.5 → 2) | 💡 | ✅ | SI HAY TIEMPO ✅ d16a36e | S | Bajo | Errores por campo |
| CU-19.4 | Separar reorden de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-20.1 | Advertencia fija «ejemplo y quiz» | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Huecos de UI en Autoría |
| CU-20.2 | Separar eliminación de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-21.1 | Guardado del ejemplo en dos pasos no atómico | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Huecos de UI en Autoría |
| CU-21.2 | Aviso de cambios sin guardar | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Cambios sin guardar |
| CU-21.3 | Error de validación comprensible | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Errores por campo |
| CU-21.4 | Separar edición de publicación | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-22.1 | Probar un borrador sin publicarlo | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-22.2 | La prueba del admin toca `last_job_id` | 💡 | ✅ | HACER YA ✅ b638029, f92d9fa | S | Bajo | Requisitos de completitud |
| CU-22.3 | Carrera en el selector de ejemplos | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Respuestas tardías |
| CU-23.1 | `--check` escribe en la base | 💡 | ✅ | SI HAY TIEMPO ✅ 0b7b607, f0d9980 | S | Bajo | CLI del contenido base |
| CU-23.2 | Conflictos de `order` al actualizar/restablecer | 🚨 | ✅ | SI HAY TIEMPO ✅ 0b7b607 | M | Medio | CLI del contenido base |
| CU-23.3 | El reset no deja el estado base | 🚨 | ✅ | SI HAY TIEMPO ✅ 0b7b607 | S-M | Medio | CLI del contenido base |
| CU-24.1 | Un error del parser convierte un éxito en fallo | 💡 | ✅ | HACER YA ✅ 6b29f57 | S | Bajo | Limpieza y reconciliación |
| CU-24.2 | El drainer puede morir sin detectarse | 💡 | ◐ | NO HACER | M | Medio | Limpieza y reconciliación |
| CU-24.3 | Limpieza parcial al fallar la preparación | 💡 | ◐ | SI HAY TIEMPO | S | Bajo | Limpieza y reconciliación |
| CU-24.4 | Cupo liberado antes de limpiar | 💡 | ✅ | NO HACER | M | Medio | Limpieza y reconciliación |
| CU-24.5 | Fallo al guardar en SQLite pierde el resultado real | 💡 | ✅ | NO HACER | M | Medio | Limpieza y reconciliación |
| CU-24.6 | Docker caído registrado como timeout | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Limpieza y reconciliación |
| CU-25.1 | Limpiar directorios sin Docker | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Limpieza y reconciliación |
| CU-25.2 | `rmtree(ignore_errors=True)` cuenta lo no borrado | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Limpieza y reconciliación |
| CU-25.3 | Contenedores no eliminados sin seguimiento | 💡 | ✅ | NO HACER | M | Medio | Limpieza y reconciliación |
| CU-26.1 | Imagen ausente vs. no comprobada | 💡 | ✅ | SI HAY TIEMPO ✅ 7f079e2 | S | Bajo | Escritorio y salud |
| CU-26.2 | Los checks de Docker bloquean el event loop | 💡 | ✅ | SI HAY TIEMPO ✅ 7f079e2, f0d9980 | S | Bajo | Escritorio y salud |
| CU-26.3 | Reconectar Docker si no estaba al arrancar | 🚨 | ◐ | RECLASIFICAR ✅ 7f079e2, f0d9980, 5935292 (también desde POST /jobs) | S | Bajo | Escritorio y salud |
| CU-26.4 | Recursos pendientes visibles en /health | 💡 | ✅ | NO HACER | S-M | Medio | Limpieza y reconciliación |
| CU-27.1 | «Listo» = algún servicio corriendo | 💡 | ◐ | SI HAY TIEMPO ✅ a7a0b42, 2a219a9 | S | Bajo | Escritorio y salud |
| CU-27.2 | Reanudar el autoarranque cuando aparece Docker | 💡 | ✅ | SI HAY TIEMPO ✅ a7a0b42 | S | Bajo | Escritorio y salud |
| CU-27.3 | Verificar la imagen del runner | 💡 | ✅ | SI HAY TIEMPO ✅ a7a0b42 | S-M | Bajo | Escritorio y salud |
| CU-27.4 | Mostrar la causa real del fallo de inicio | 💡 | ✅ | SI HAY TIEMPO ✅ a7a0b42 | S | Bajo | Escritorio y salud |
| CU-27.5 | Fallo de carga de la interfaz (did-fail-load) | 💡 | ✅ | SI HAY TIEMPO ✅ d7631e6, 2a219a9 | S | Bajo | Escritorio y salud |
| CU-28.1 | Taller como actividad identificable | 🚨 | ✅ | HACER YA | M | Medio | Requisitos de completitud |
| CU-28.2 | Talleres con y sin código | 🚨 | ✅ | HACER YA | S | Bajo | Requisitos de completitud |
| CU-28.3 | Guardar estado y retomar | 🚨 | ✅ | HACER YA | S | Bajo | Requisitos de completitud |
| CU-28.4 | Condición de realización propia | 🚨 | ✅ | HACER YA | S | Bajo | Requisitos de completitud |
| CU-28.5 | Integrar con el progreso de la lección | 🚨 | ✅ | HACER YA | S | Bajo | Requisitos de completitud |
| CU-28.6 | Errores dentro del taller | 🚨 | ✅ | HACER YA | S | Bajo | Requisitos de completitud |
| CU-29.1 | Archivadas vs. deshabilitadas tratadas distinto | 💡 | ✅ | HACER YA ✅ b638029, 6a400bd, f92d9fa | S-M | Bajo | Disponibilidad de lecciones |
| CU-29.2 | «Continuar/Empezar» con id fijo | 💡 | ✅ | HACER YA ✅ f92d9fa | S | Bajo | Disponibilidad de lecciones |
| CU-30.1 | Seleccionar varias ejecuciones | 🚨 | ✅ | HACER YA ✅ 3975c62 | M | Bajo | Análisis de ejecuciones |
| CU-30.2 | Reglas de comparabilidad | 🚨 | ✅ | HACER YA ✅ 3975c62 | S | Bajo | Análisis de ejecuciones |
| CU-30.3 | Vista conjunta de configuración, resultados y métricas | 🚨 | ✅ | HACER YA ✅ 3975c62 | M | Bajo | Análisis de ejecuciones |
| CU-30.4 | Navegación y errores de la comparación | 🚨 | ✅ | HACER YA ✅ 3975c62 | S | Bajo | Análisis de ejecuciones |
| CU-31.1 | Exportación estructurada (JSON) | 🚨 | ✅ | HACER YA ✅ c0419d2 | S | Bajo | Análisis de ejecuciones |
| CU-31.2 | Datos ausentes como ausentes | 🚨 | ✅ | HACER YA ✅ c0419d2 | S | Bajo | Análisis de ejecuciones |
| CU-31.3 | Errores y reintento (el análisis se contradice con CU-10) | 🚨 | ◐ | HACER YA ✅ c0419d2 | S | Bajo | Análisis de ejecuciones |
| CU-32.1 | Guardar configuraciones sin ejecutar | 🚨 | ✅ | HACER YA ✅ 9c07e16, 32f83ad | M | Bajo | Análisis de ejecuciones |
| CU-32.2 | Re-ejecutar recupera hilos y timeout | 🚨 | ✅ | HACER YA ✅ 1d17085 | S | Bajo | Simulador: re-ejecución y editor |
| CU-32.3 | Recorte silencioso de hilos | 💡 | ✅ | HACER YA ✅ 1d17085, 32f83ad | S | Bajo | Simulador: re-ejecución y editor |
| CU-33.1 | QA versionada de instalación (y la web ofrece v1.0.3) | 💡 | ✅ | HACER YA ◐ 2ff51c1 (web a v1.0.5; falta la QA de instalación) | S | Bajo | Escritorio y salud |
| CU-34.1 | Detalle de publicación (endpoint listo, sin pantalla) | 🚨 | ✅ | HACER YA ✅ 1cddb1a | M | Bajo | Catálogo y publicación |
| CU-34.2 | El detalle usa una caché de 15 min | 💡 | ✅ | SI HAY TIEMPO ✅ 8df6234 | S | Bajo | Catálogo y publicación |
| CU-34.3 | `local_only` oculta publicaciones (filtro del front) | 💡 | ✅ | SI HAY TIEMPO ✅ cbbb670 | S | Bajo | Catálogo y publicación |
| CU-35.1 | Progreso heredado por `lesson_id` (nota) | 📝 | ✅ | NO HACER | L | Alto | Identidad del progreso |
| CU-36.1 | Separar versión de trabajo de Aprender | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-36.2 | El import no fija la versión | 💡 | ◐ | SI HAY TIEMPO ✅ cbbb670 | S | Bajo | Catálogo y publicación |
| CU-36.3 | Copias bifurcadas sin origen | 💡 | ✅ | NO HACER | M | Medio | Catálogo y publicación |
| CU-37.1 | Validar la publicación como el importador | 🚨 | ✅ | HACER YA ✅ 8df6234 99585b7 | S-M | Bajo | Catálogo y publicación |
| CU-37.2 | Confirmar lo que se ensayó (checksum) | 💡 | ✅ | NO HACER | M | Medio | Catálogo y publicación |
| CU-37.3 | Reintentar tras fallo del índice | 💡 | ✅ | HACER YA ✅ 8df6234 4f969ae | S | Bajo | Catálogo y publicación |
| CU-37.4 | Reconciliar publicación remota y estado local | 💡 | ◐ | HACER YA ✅ 8df6234 99585b7 | S | Bajo | Limpieza y reconciliación |
| CU-38.1 | Lecciones archivadas en Aprender y en los totales | 🚨 | ✅ | HACER YA ✅ b638029, f92d9fa | S | Bajo | Disponibilidad de lecciones |
| CU-38.2 | Lección nueva hereda progreso ajeno | 💡 | ✅ | NO HACER | L | Alto | Identidad del progreso |
| CU-38.3 | El preview dice «conservado» y se recalifica | 💡 | ✅ | SI HAY TIEMPO ✅ 440204b, cbbb670 | S | Bajo | Catálogo y publicación |
| CU-39.1 | Entidad curso | 🚨 | ✅ | RECLASIFICAR | L | Alto | Entidad curso |
| CU-39.2 | Asociar módulos a un curso | 🚨 | ✅ | RECLASIFICAR | L | Alto | Entidad curso |
| CU-39.3 | Curso en edición separado | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-39.4 | Aviso de cambios sin guardar | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Cambios sin guardar |
| CU-40.1 | Información general editable del curso | 🚨 | ✅ | RECLASIFICAR | M | Medio | Entidad curso |
| CU-40.2 | Aviso de cambios sin guardar | 💡 | ✅ | SI HAY TIEMPO | S | Bajo | Cambios sin guardar |
| CU-40.3 | Información editada separada de la publicada | 💡 | ✅ | RECLASIFICAR ✅ 8df6234 60d6351 | S | Bajo | Borrador vs. publicado |
| CU-41.1 | Retirar una publicación del catálogo | 🚨 | ✅ | SI HAY TIEMPO ✅ 785aaa0, bfa870c | M | Medio | Catálogo y publicación |
| CU-41.2 | Actualizar no revalida el índice | 🚨 | ◐ | HACER YA ✅ 8df6234 | S | Bajo | Catálogo y publicación |
| CU-41.3 | Coordinar fallos entre borrado local y retirada remota | 💡 | ✅ | NO HACER | M | Medio | Limpieza y reconciliación |

**Recuento de veredictos:** **48** HACER YA · **54** SI HAY TIEMPO · **13** NO HACER · **18** RECLASIFICAR.

---

## 5. Hoja de ruta sugerida

```
F0 Verificar (0,5 d) ──► F1 Datos correctos (3,5 d) ──► F2 Autoría (4,5 d)
                              │                              │
                              └──► F3 Simulador y análisis (8,5 d, en paralelo con F2)
                                                             │
                                          F4 Catálogo (3,5 d) ◄┘
                                                             │
                                  F5 Feature: taller como tipo de lección (≈6–7 d)
                                  F6 Si hay tiempo (≈20 d, a la carta; solo arreglos simples)
```

| Fase | Contenido | Días | Depende de | Cierra |
|---|---|---|---|---|
| **F0 · Verificar** | Probar la descarga en Electron (CU-10); publicar `release.json` 1.0.5 o comprobar la release (CU-33); rótulo «Tareas del contenedor» (09.4); `try` del parser (24.1); guardar la versión reclasificada en `docs/audits/` y borrar el CU-27 duplicado | 0,5 | — | Riesgos ⚠ |
| **F1 · Datos correctos** | PUT de lección (18.1, 19.2) → diseño A de requisitos (12.1, 12.2, 02.3–02.5, 03.1, 22.2, más la validación `lesson_id`↔`example_id`) → regla única de disponibilidad (01.1, 01.3, 12.4, 29.1, 29.2, 38.1) | 3,5 | F0 | CU-01, CU-12, CU-18 (parcial) |
| **F2 · Autoría** | DTO admin al día → lección sin ejemplo (17.1), selector de regla y video (17.2, **exige F1**), agregar ejemplo (18.2), eliminar quiz (18.3), reorden automático con `PUT /admin/lessons/reorder` (19.1, **exige 18.1**) | 4,5 | F1 | CU-17, CU-18, CU-19 |
| **F3 · Simulador y análisis** | Re-ejecutar (04.1, 32.2, 32.3) → configuraciones guardadas (32.1) → exportar JSON (31) → comparar (30, reutiliza el formateo de 31). Rótulo y cronómetro en vivo (07.1, 07.4) + flush del drainer + error de descarga (10.1) | 8,5 | F0 | CU-04, CU-07, CU-30, CU-31, CU-32 |
| **F4 · Catálogo y D+** | Validar al publicar con `parse_bundle` + `_verificar_contenido`, también en el ensayo (37.1); pantalla de detalle (34.1); revalidar el índice al actualizar (41.2); **D+**: etiqueta «Vista previa (borrador)» en Aprender y detección de cambios por checksum sin `published_at` (37.3, 37.4) | 5,5 | F0 | CU-34, CU-37; reclasifica los 13 ítems de borrador/publicado |
| **Cierre** | Alinear `casos-de-uso.md` a los 41 CU; actualizar los estados en la auditoría | 0,5 | Todo | Documentación |
| **Subtotal HACER YA** | | **≈24** | | 🟢 pasa de 20 a 35 |
| **F5 · Feature taller** | Migración 6 (`lessons.kind`, `workshop_steps`, `workshop_step_progress`) → endpoints aditivos → vista de pasos con casillas → editor de pasos en Autoría → `bundle_format: 2` solo para bundles con talleres | 6–7 | F1 (diseño A), F2 (editor de lecciones) | CU-28 → 🟢 |
| **F6 · Si hay tiempo** | Solo arreglos simples. Transversales de UX: respuestas tardías (1), guardas (1,5), errores por campo (1). Simulador sin catálogo (0,5). En vivo y resultados (2). Robustez selectiva (2). Escritorio y salud (2,5). CLI (2). Autoría: borrar en cascada 16.1–16.2, 20.1, 21.1 (2,75). Requisito visible 12.3 (1). Catálogo: 34.2, 34.3, 36.2, 38.3 (1,5) y retirar del catálogo 41.1 (2,5) | ≈20 | F1–F4 | CU-16, CU-23, CU-41 y sugerencias |
| **Descartado** | Tablas espejo, snapshot publicado o columna `status` (borrador/publicado); requisitos múltiples (diseños B/C); entidad curso; identidad del progreso; reconciliación continua | — | — | Sobreingeniería para el alcance de la tesis; se documenta como trabajo futuro |

**Consejo de método (TDD, como en `prompts-cierre`):** cada fase empieza con los tests en rojo, luego el código, `/code-review` y la verificación completa (`pytest --cov`, `tsc`, `vitest`). Una rama por fase, con commits en español y sin push.

---

## 6. Glosario

<a id="g-race"></a>**Race condition (condición de carrera).** Un error que depende del *orden* en que terminan operaciones simultáneas. *Analogía:* dos personas escriben en la misma pizarra a la vez y gana la que escribe última. *En Telar:* cancelar un job justo cuando el programa termina solo; gana «cancelado» aunque el programa acabó bien (CU-08.1).

<a id="g-stale"></a>**Stale response (respuesta obsoleta).** Una respuesta que llega después de que el usuario ya pidió otra cosa, y aun así se aplica. *Ejemplo:* el ejemplo A llega después del B y pisa el editor (CU-05.2).

<a id="g-abort"></a>**AbortController.** Un objeto del navegador que permite **cancelar** un `fetch` en curso: `const c = new AbortController(); fetch(url, {signal: c.signal}); c.abort()`. *Analogía:* colgar una llamada en espera en lugar de dejarla sonar.

<a id="g-optimista"></a>**Optimistic UI (interfaz optimista).** Mostrar el resultado *antes* de que el servidor confirme, y deshacerlo si falla. *En Telar:* el reorden de módulos se ve al instante; si el PUT falla, vuelve a una copia vieja, que puede estar desactualizada (CU-15.1).

<a id="g-transaccion"></a>**Transacción / rollback.** Un grupo de escrituras que se confirman juntas (`commit`) o se deshacen juntas (`rollback`). *Analogía:* una transferencia bancaria: o sale el dinero de una cuenta **y** entra en la otra, o no pasa nada. *En Telar:* instalar un módulo escribe módulos, lecciones, ejemplos y preguntas en una sola transacción (CU-35).

<a id="g-atomicidad"></a>**Atomicidad.** La propiedad de que una operación ocurra entera o no ocurra (la «A» de ACID). *Contraejemplo en Telar:* «Guardar ejemplo» hace dos peticiones (metadatos y código); si la segunda falla, la primera ya quedó guardada (CU-21.1).

<a id="g-idempotencia"></a>**Idempotencia.** Repetir una operación da el mismo resultado que hacerla una vez. *Analogía:* pulsar el botón del ascensor diez veces no llama a diez ascensores. *En Telar:* reintentar «Publicar» debería reconocer que el bundle ya subió y seguir con el índice; hoy da `VERSION_CONFLICT` (CU-37.3).

<a id="g-snapshot"></a>**Snapshot (instantánea).** Una copia inmutable del estado en un momento dado. *En Telar:* `app.state.content` es un snapshot de todo el contenido del curso; los estudiantes leen de él y Autoría lo reemplaza entero al guardar.

<a id="g-draft"></a>**Draft / published (borrador / publicado).** Dos versiones del mismo contenido: la que se edita y la que se muestra. *Analogía:* la galerada y la edición impresa de un periódico. *En Telar:* no existen por separado en la misma instalación (sección 3.1).

<a id="g-checksum"></a>**Checksum.** Una huella corta (aquí SHA-256) calculada a partir del contenido de un archivo; si cambia un solo byte, la huella cambia. *En Telar:* incorporar un curso compara el sha256 del bundle con el del índice, y si no coinciden, lo rechaza.

<a id="g-bundle"></a>**Bundle.** El paquete JSON que contiene un módulo completo (lecciones, ejemplos, quiz) listo para distribuirse. *En Telar:* `<módulo>/v<n>.json` en el bucket `clasestelar`; es inmutable una vez subido.

<a id="g-indice"></a>**Índice del catálogo.** El archivo que lista qué publicaciones existen y su versión vigente. *Analogía:* la carta de un restaurante; el plato puede existir en la cocina (bundle), pero si no está en la carta, no se ofrece. *En Telar:* por eso se sube primero el bundle y después se actualiza el índice.

<a id="g-ttl"></a>**Cache TTL (tiempo de vida de la caché).** Cuánto tiempo se da por buena una copia guardada antes de volver a pedirla. *En Telar:* el índice se reutiliza durante 900 s (15 min), así que una publicación retirada puede verse hasta 15 min después (CU-34.2).

<a id="g-healthcheck"></a>**Healthcheck.** Una consulta periódica que responde «¿estás vivo y funcional?». *En Telar:* Compose llama a `/health` cada 10 s con 5 s de timeout; `/health` comprueba la BD, Docker y la imagen del runner.

<a id="g-contenedor"></a>**Contenedor / imagen.** Una *imagen* es la plantilla congelada (un sistema de archivos con Python y PyOMP). Un *contenedor* es una instancia en ejecución de esa imagen, aislada del resto. *Analogía:* la imagen es el molde; el contenedor, el bizcocho. *En Telar:* cada job crea un contenedor efímero desde la imagen `runner`.

<a id="g-cgroup"></a>**cgroup / PIDs.** Un *cgroup* es el mecanismo del kernel Linux que limita y mide los recursos de un grupo de procesos (CPU, memoria, número de tareas). *PIDs* = identificadores de proceso o tarea. *En Telar:* «Hilos (PIDs)» muestra `pids_stats.current` de Docker, que cuenta **todas** las tareas del cgroup (tini, Python y los pools de Numba y OpenMP), no los hilos OpenMP del programa (CU-09.4).

<a id="g-semaforo"></a>**Semáforo (de concurrencia).** Un contador que limita cuántas operaciones pueden ejecutarse a la vez. *En Telar:* limita los jobs simultáneos; hoy se libera antes de borrar el contenedor (CU-24.4).

<a id="g-websocket"></a>**WebSocket.** Una conexión bidireccional que queda abierta entre el navegador y el servidor, sin tener que hacer una petición por mensaje. *En Telar:* transmite en vivo los logs y las métricas del job, y también la orden de cancelar.

<a id="g-buffer"></a>**Backpressure / buffer.** Un *buffer* es una memoria intermedia donde se acumulan datos antes de enviarlos. La *backpressure* es qué hacer cuando el consumidor va más lento que el productor: esperar, descartar o bloquear. *En Telar:* cada conexión WS tiene una cola que **descarta** mensajes si se llena, y el drainer agrupa el stdout por líneas; de ahí vienen los huecos y los retrasos (CU-07.2 y 07.3).

<a id="g-ring"></a>**Ring buffer + seq.** Un buffer circular de tamaño fijo (aquí 500 líneas) que sobrescribe lo más viejo, con un número de secuencia (`seq`) en cada mensaje. *En Telar:* al reconectar se reenvía lo que queda en el anillo; un salto en `seq` indica un hueco, pero hoy el cliente no lo avisa (CU-07.3).

<a id="g-event-loop"></a>**Event loop (bucle de eventos).** El único hilo que atiende todas las peticiones en un servidor `async` de Python. Si una llamada síncrona tarda, **bloquea a todos**. *En Telar:* `/health` llama a Docker sin `asyncio.to_thread`; si Docker se cuelga, se congelan hasta 120 s todas las peticiones, incluidos los WebSocket.

<a id="g-migracion"></a>**Migración de esquema.** Un script numerado que transforma la estructura de la base (tablas y columnas) sin perder datos. *En Telar:* bloques `-- migration N` en `schema.sql`; la siguiente sería la 6. Cada una necesita su test (`test_migration5.py` es el patrón).

<a id="g-backfill"></a>**Backfill.** Rellenar una columna nueva con valores derivados de los datos existentes durante una migración. *Ejemplo:* `viewed_at ← updated_at donde viewed=1` (lo que haría el diseño C, descartado).

<a id="g-reconciliacion"></a>**Reconciliación.** Comparar el estado *deseado* con el *real* y corregir la diferencia. *Analogía:* cuadrar la caja al cerrar la tienda. *En Telar:* el reaper de arranque marca como fallidos los jobs que quedaron «running» y borra los contenedores huérfanos.

<a id="g-huerfano"></a>**Huérfano (recurso) / reaper.** Un recurso que quedó vivo sin nadie que lo gestione (un contenedor, un directorio, una fila de progreso). El *reaper* es el proceso que los recoge.

<a id="g-monotonia"></a>**Monotonía (de `completed`).** Un valor que solo puede avanzar y nunca retroceder. *En Telar:* una lección completada no se «descompleta» aunque cambien sus requisitos; esto evita que un estudiante pierda progreso por una actualización.

<a id="g-contrato"></a>**Contrato congelado.** La especificación (`docs/architecture/api-contract.md`) de qué endpoints existen y qué devuelven, fijada para que front y back no diverjan. Por decisión D1 solo se enmienda de forma **aditiva** (campos opcionales o endpoints nuevos), nunca cambiando lo que ya existe.

<a id="g-dto"></a>**DTO (Data Transfer Object).** La forma de los datos que viajan por la API. *En Telar:* `frontend/src/api/admin-types.ts` es un DTO del front **desfasado** del contrato; ahí nace el bug del PUT.

<a id="g-put"></a>**PUT vs. PATCH.** `PUT` reemplaza el recurso **completo** (lo que no envías queda con su valor por defecto). `PATCH` modifica solo los campos enviados. *En Telar:* `PUT /admin/lessons/{id}` es un reemplazo total y el editor envía solo 6 campos (CU-18.1).

<a id="g-422"></a>**422 / validación pydantic.** Código HTTP «entidad no procesable». FastAPI lo devuelve cuando el cuerpo no cumple el schema, con detalles `{type, loc, msg}`, donde `loc` indica el campo.

<a id="g-cas"></a>**CAS (compare-and-swap) / `if_generation_match`.** Escribir solo si el objeto sigue en la versión que leíste; si alguien lo cambió, la escritura falla. *En Telar:* el índice de GCS se actualiza con CAS, y el bundle se sube con `if_generation_match=0` («solo si no existe»).

<a id="g-jit"></a>**JIT (compilación just-in-time).** Compilar el código justo antes o durante la ejecución. *En Telar:* PyOMP (vía Numba) compila las funciones la primera vez que se llaman, y por eso existe la fase «compiling».

<a id="g-useblocker"></a>**useBlocker / beforeunload.** `useBlocker` (React Router) intercepta una navegación interna para pedir confirmación; `beforeunload` es el evento del navegador al recargar o cerrar la pestaña.

<a id="g-localstorage"></a>**localStorage.** Almacenamiento clave-valor persistente en el navegador del usuario. *En Telar:* ya guarda `lastLessonId` y el tema; serviría para las configuraciones guardadas (CU-32.1) sin tocar el backend.

<a id="g-adr"></a>**ADR (Architecture Decision Record).** Un documento corto que registra una decisión de arquitectura: contexto, opciones, decisión y consecuencias. Es obligatorio para justificar cualquier cambio en un contrato congelado.

<a id="g-cascade"></a>**FK / ON DELETE CASCADE / UNIQUE.** Una *FK* (clave foránea) obliga a que una fila apunte a otra que existe. *CASCADE* borra las hijas al borrar la madre. *UNIQUE* impide valores repetidos. *En Telar:* `modules."order"` es UNIQUE global, así que al permutar A↔B el primer UPDATE choca (CU-23.2).

<a id="g-parser"></a>**Parser.** El código que interpreta un texto (aquí el stdout del programa) para extraer datos estructurados (tiempos, speedup). *En Telar:* `output_parser.py` tiene 6 parsers, uno por cada ejemplo que se mide a sí mismo.

---

## 7. Preguntas abiertas para el director

1. **Taller (CU-28) como tipo de lección.** ¿Está de acuerdo en que un taller sea una lección con pasos guiados y casillas «Lo hice» (estilo Unity Learn), sin quiz ni video, que se completa al marcar todos los pasos? ¿Algún paso debe *exigir* una ejecución exitosa en el simulador, o basta con que el estudiante lo marque?
2. **Taller dentro de CU-02.** Si el taller es otro tipo de lección, CU-02.1 sobra: ¿se acepta quitarlo de CU-02 (que pasa a 🟢) y dejarlo solo en CU-28?
3. **«Curso» (CU-39/40/41).** ¿Puede definirse «curso» = el módulo publicable (lo que ya existe), o se exige una entidad que agrupe varios módulos? La entidad cuesta ≈8–10 días y rompe la compatibilidad de los bundles con la v1.0.5.
4. **Borrador/publicado.** ¿Es aceptable argumentar que la separación ya existe **entre máquinas** (la app del estudiante no incluye Autoría) y documentar que en la máquina del autor «Aprender» es una vista previa? La propuesta concreta es D+: una etiqueta de borrador y un Publicar que compara checksums y solo sube si hay cambios.
5. **Contratos congelados.** ¿Se confirma la política D1 (solo enmiendas aditivas, con un ADR)? Varias mejoras la necesitan (`?cascade=true`, el estado de la imagen en `/health`, el checksum del ensayo).
6. **Demostrar `viewed` y `run`.** Las 14 lecciones reales son `quiz`. ¿Conviene añadir una lección `viewed` y otra `run` al contenido base para demostrar la corrección, o basta con los tests?
7. **CU-16.1 (borrar un módulo con contenido).** ¿Es un escenario frecuente, o basta con la ruta actual (borrar las lecciones primero) y lo bajamos a sugerencia?
8. **QA de instalación (CU-33).** ¿Qué evidencia pide el jurado? ¿Un vídeo o capturas del recorrido descargar → instalar → abrir en Windows y Linux, o una checklist firmada?
9. **Robustez de infraestructura** (grupo 3.6). ¿Se acepta presentarla en la memoria como «limitaciones conocidas y trabajo futuro» en lugar de implementarla?
10. **Numeración.** ¿Se reescribe `docs/casos-de-uso.md` a los 41 CU (≈0,5 días) antes de la entrega, para que la memoria y el código usen los mismos números?
