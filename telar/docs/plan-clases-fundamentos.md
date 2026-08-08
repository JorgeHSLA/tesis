# Plan de clases en video — Track "Fundamentos de paralelismo y OpenMP"

> Track conceptual que precede a los módulos prácticos m1–m8 del catálogo.
> Formato: micro-videos de **3 a 5 minutos** (estilo microlearning), cada módulo
> cierra con un quiz. Objetivo global: que quien vea el track completo salga con
> claridad sobre qué es cada concepto (paralelismo, concurrencia, proceso, hilo,
> races, sincronización…) y entienda qué es OpenMP y por qué PyOMP, listo para
> entrar a los módulos prácticos con el simulador.

**Total: 23 videos ≈ 102 minutos + 4 quizzes.**

Regla de guion para todos los videos: 1 concepto por video, estructura
*gancho (15s) → analogía (1 min) → concepto formal (2 min) → conexión con Telar (30s)*.
Todo en español, con la misma terminología que usan las lecciones prácticas
(hilo, región paralela, reduction, critical…).

---

## Módulo F1 — El porqué del paralelismo (5 videos, ~21 min)

**Meta del módulo:** entender por qué existe la programación paralela y dominar
el vocabulario base: proceso, hilo, concurrencia, paralelismo.

### F1.1 · ¿Por qué tu programa no va más rápido? (4 min)
- **Objetivo:** motivar el paralelismo desde el hardware.
- **Guion:** (1) Gancho: "compraste una laptop con 8 núcleos y tu script usa el 12% de CPU — ¿por qué?"; (2) mini-historia: hasta ~2005 los procesadores subían de frecuencia y el mismo programa corría más rápido gratis ("free lunch"); el calor puso el límite; (3) la industria respondió con más núcleos en vez de núcleos más rápidos; (4) consecuencia: el software serial ya no acelera solo — hay que escribirlo para usar varios núcleos.
- **Visual:** gráfica frecuencia vs año (se aplana) superpuesta con número de núcleos vs año (sube). Task manager con 1 núcleo al 100% y 7 dormidos.
- **Conexión Telar:** "en este curso vas a ver TUS programas usar los 8 núcleos, con métricas reales de contenedor".

### F1.2 · ¿Qué es el paralelismo? (4 min)
- **Objetivo:** definir paralelismo como división de trabajo simultánea.
- **Guion:** (1) Analogía: pintar una casa — 1 pintor tarda 8 días; 8 pintores, ¿1 día?; (2) definición: dividir un problema en partes que se ejecutan AL MISMO TIEMPO en distintas unidades de cómputo; (3) requisito clave: que las partes sean (mayormente) independientes; (4) teaser: "no todo se puede repartir — hay partes que solo puede hacer un pintor, y los pintores a veces se estorban: de eso van los próximos videos".
- **Visual:** timeline serial (una barra larga) vs paralelo (4 barras cortas apiladas).
- **Conexión Telar:** captura de la pantalla de resultados con speedup real de `transporteParticulas` (8x).

### F1.3 · Programa, proceso y sistema operativo (4 min)
- **Objetivo:** qué es un proceso y qué le da el SO.
- **Guion:** (1) programa = receta escrita; proceso = la cocina funcionando (receta + ingredientes + cocinero); (2) cada proceso tiene SU memoria privada — dos procesos no se ven las variables; (3) el SO reparte los núcleos entre procesos (scheduling); (4) comunicar procesos es caro (hay que "mandar cartas") — teaser de por qué los hilos existen.
- **Visual:** cajas aisladas (procesos) con su propia memoria, el SO como director de orquesta asignando núcleos.
- **Conexión Telar:** "cuando lances un job, tu código corre como un proceso dentro de un contenedor Docker — lo verás en vivo".

### F1.4 · ¿Qué es un hilo? (5 min)
- **Objetivo:** el concepto central del curso — hilos y memoria compartida.
- **Guion:** (1) Analogía: proceso = casa; hilos = personas viviendo en ella: comparten cocina y nevera (memoria compartida) pero cada una tiene su habitación (stack propio); (2) definición: unidad de ejecución dentro de un proceso; todos los hilos ven las mismas variables; (3) ventaja: comunicarse es gratis (leen/escriben la misma memoria); peligro: pueden pisarse (teaser del módulo F3); (4) cuántos hilos conviene: tantos como núcleos lógicos (`nproc`), y la variable `OMP_NUM_THREADS` que verás en todo el curso.
- **Visual:** casa con 8 personas compartiendo nevera; mapeo hilo→núcleo.
- **Conexión Telar:** el slider de "hilos" del simulador controla exactamente esto.

### F1.5 · Concurrencia ≠ paralelismo (5 min)
- **Objetivo:** deshacer la confusión más común del tema.
- **Guion:** (1) Gancho: "un solo barista puede atender 10 clientes 'a la vez'… sin hacer dos cafés al mismo tiempo"; (2) concurrencia = ESTRUCTURA: varias tareas en progreso, alternándose (interleaving) — puede pasar en 1 núcleo; (3) paralelismo = EJECUCIÓN: varias tareas corriendo físicamente al mismo tiempo — exige varios núcleos; (4) puede haber concurrencia sin paralelismo, paralelismo sin concurrencia aparente, y ambas; (5) nota Python: el intérprete clásico tiene el GIL, que impide paralelismo real de hilos en Python puro — por eso PyOMP compila con Numba y escapa del GIL (teaser del módulo F4).
- **Visual:** 1 barista alternando entre pedidos vs 4 baristas simultáneos; diagrama de Rob Pike simplificado (colas y trabajadores).
- **Quiz F1 (5 preguntas):** identificar proceso vs hilo, concurrencia vs paralelismo en escenarios cotidianos, por qué existen los multicore, qué comparten los hilos.

---

## Módulo F2 — Pensar en paralelo (5 videos, ~22 min)

**Meta del módulo:** el "modelo mental" del programador paralelo: cómo se divide
el trabajo y cómo se mide si valió la pena.

### F2.1 · Dividir el trabajo: datos vs tareas (5 min)
- **Objetivo:** los dos tipos de descomposición.
- **Guion:** (1) Analogía: corregir 800 exámenes entre 8 profesores — 100 exámenes cada uno (paralelismo de DATOS: misma operación, distintos trozos) vs uno corrige, otro suma notas, otro las sube al sistema (paralelismo de TAREAS: operaciones distintas); (2) el paralelismo de datos es el pan de cada día en cómputo científico (arrays, matrices, píxeles, partículas); (3) mapa de los 3 patrones que verás en el curso: loop-level (repartir un for), SPMD (repartir a mano por identidad del hilo) y divide-y-vencerás (tareas).
- **Visual:** montón de exámenes partido en 8 pilas vs cadena de montaje.
- **Conexión Telar:** estos 3 patrones son exactamente los módulos prácticos m1, m2 y m6.

### F2.2 · Speedup y eficiencia: ¿valió la pena? (4 min)
- **Objetivo:** las dos métricas que el simulador muestra en cada job.
- **Guion:** (1) speedup S = T(1 hilo) / T(N hilos) — "¿cuántas veces más rápido?"; (2) ideal: S = N (lineal); real: casi siempre menos; (3) eficiencia E = S/N — "¿qué % de cada hilo estoy aprovechando?"; (4) ejemplo numérico con datos reales del repo: transporteParticulas logra ~8x con 8 hilos (eficiencia ~100%), stencilCalor apenas ~1.1x (teaser: ¿por qué? → F2.4 y m7).
- **Visual:** la propia pantalla de resultados de Telar anotada: dónde está el speedup, qué significa.
- **Conexión Telar:** "cada job que corras calculará esto automáticamente".

### F2.3 · La ley de Amdahl: el techo de cristal (5 min)
- **Objetivo:** entender el límite teórico del speedup.
- **Guion:** (1) Gancho: "si el 5% de tu programa es serial, ni con 1000 núcleos pasarás de 20x"; (2) intuición con la analogía de los pintores: aunque sean 100, solo uno puede mezclar la pintura al inicio; (3) fórmula S ≤ 1/(f_serial + f_paralelo/N) presentada gráficamente, sin álgebra pesada; (4) tabla rápida: 95% paralelo → máx 20x; 90% → 10x; 50% → 2x; (5) lección práctica: optimizar la parte serial a veces rinde más que añadir hilos.
- **Visual:** curvas de speedup vs N para distintas fracciones seriales (se aplanan).
- **Quiz-hook:** "calcula el techo de un programa 80% paralelo" cae en el quiz.

### F2.4 · Overhead: el costo oculto de los hilos (4 min)
- **Objetivo:** por qué más hilos no siempre es más rápido.
- **Guion:** (1) Gancho: "8 hilos y tu programa salió MÁS LENTO — bienvenido al overhead"; (2) costos invisibles: crear/despertar hilos, repartir el trabajo, sincronizarse al final, competir por memoria/caché; (3) regla mental: el trozo de trabajo por hilo debe ser MUCHO mayor que el costo de coordinarse; con problemas pequeños, serial gana; (4) caso memory-bound: si todos los hilos esperan a la RAM, añadir hilos no añade velocidad (teaser de stencilCalor en m7).
- **Visual:** balanza "trabajo útil vs coordinación"; timeline donde el overhead se come la ganancia.
- **Conexión Telar:** "en el simulador puedes repetir el mismo código con 1, 2, 4, 8 hilos y ver dónde deja de mejorar".

### F2.5 · Balanceo de carga: nadie parado (4 min)
- **Objetivo:** carga desigual = hilos ociosos = speedup perdido.
- **Guion:** (1) Analogía: 4 cajeras de supermercado, una fila se llena de carritos llenos — las otras 3 terminan y esperan; (2) el tiempo total lo marca el hilo MÁS LENTO; (3) estrategias: repartir en bloques iguales (static), en trozos pequeños intercalados (static con chunk), o trabajo bajo demanda (tareas); (4) ejemplo visual con Mandelbrot: unas zonas de la imagen cuestan mucho más que otras.
- **Visual:** barras de ocupación por hilo (3 llenas, 1 al 40%) — el mismo gráfico "Distribución del trabajo" que muestra Telar en resultados.
- **Quiz F2 (5 preguntas):** calcular un speedup, techo de Amdahl, identificar datos vs tareas, diagnosticar un caso de overhead y uno de desbalance.

---

## Módulo F3 — Memoria compartida y sus peligros (7 videos, ~31 min)

**Meta del módulo:** los bugs y costos propios del paralelismo con hilos, y las
herramientas conceptuales para evitarlos. Es el módulo más importante: prepara
directamente m2, m3 y m5.

### F3.1 · Memoria compartida: bendición y maldición (4 min)
- **Objetivo:** enmarcar el módulo — compartir memoria es lo que hace a los hilos potentes Y peligrosos.
- **Guion:** (1) recap de F1.4: todos los hilos ven las mismas variables; (2) bendición: no hay que "mandar mensajes", todos leen el mismo array; (3) maldición: dos hilos escribiendo lo mismo a la vez = caos; (4) mapa del módulo: races → exclusión mutua → reduction → barreras → false sharing → deadlock.
- **Visual:** pizarra compartida: 8 personas escribiendo a la vez sobre el mismo renglón.

### F3.2 · Variables privadas vs compartidas (5 min)
- **Objetivo:** la decisión nº1 de todo programa OpenMP: qué es de cada hilo y qué es de todos.
- **Guion:** (1) Analogía: en la cocina compartida, la nevera es shared, pero cada cocinero necesita SU tabla de cortar (private); (2) private: cada hilo su copia, sin valor inicial; firstprivate: copia que nace con el valor de afuera; shared: una sola para todos; (3) regla de oro: contadores de bucle y temporales → privados; datos de entrada/salida → compartidos; (4) "el 90% de los bugs paralelos son variables mal declaradas" (cita del módulo práctico m3).
- **Visual:** diagrama de memoria: una caja compartida y 8 cajitas por-hilo.
- **Conexión Telar:** la lección práctica `entornoDatos` demuestra esto ejecutándolo.

### F3.3 · Race conditions: el bug más traicionero (5 min)
- **Objetivo:** entender qué es una condición de carrera y por qué es no-determinista.
- **Guion:** (1) Gancho: "un programa que da un resultado DISTINTO cada vez que lo corres — y a veces el correcto"; (2) desglose de `contador += 1`: leer, sumar, escribir — tres pasos; dos hilos intercalados pierden actualizaciones; (3) analogía: dos personas editando la misma celda de una hoja de cálculo sin refrescar; (4) por qué es traicionero: funciona en las pruebas, falla en producción; no lo detecta el compilador; (5) demo real: el ejemplo `mandelbrot` del curso tiene una versión rota A PROPÓSITO que da áreas distintas en cada corrida.
- **Visual:** timeline de dos hilos intercalando lecturas/escrituras sobre la misma variable, mostrando la actualización perdida.
- **Conexión Telar:** "en m5 vas a correr el bug tú mismo y verlo fallar en vivo".

### F3.4 · Exclusión mutua: critical (4 min)
- **Objetivo:** la primera herramienta contra las races.
- **Guion:** (1) Analogía: el baño de la casa compartida — entra uno, pone el pestillo, los demás esperan; (2) sección crítica = región que solo un hilo ejecuta a la vez (`critical` en OpenMP); (3) el precio: los demás hilos ESPERAN — si abusas, tu programa paralelo se vuelve serial con overhead (re-serialización); (4) regla: critical para operaciones raras y cortas, nunca dentro del bucle caliente.
- **Visual:** puerta con pestillo y cola de hilos; timeline mostrando la serialización.
- **Conexión Telar:** `spmdCritical` (m2) usa exactamente este patrón bien puesto.

### F3.5 · Reduction: la forma elegante de acumular (4 min)
- **Objetivo:** el patrón correcto para el caso más común (sumar/acumular en paralelo).
- **Guion:** (1) recap del problema: N hilos sumando a un total compartido = race o critical lento; (2) la idea reduction: cada hilo acumula en SU copia privada y al final se combinan una sola vez; (3) analogía: cada mesero cuenta sus propinas y al cierre se suman los totales — nadie comparte el frasco durante el turno; (4) en OpenMP es una cláusula: `reduction(+:suma)` — el compilador hace todo el trabajo sucio.
- **Visual:** árbol de combinación: 8 sumas privadas → 1 total.
- **Conexión Telar:** es la estrella del módulo práctico m1 (`for/`, cálculo de π).

### F3.6 · Barreras, single y el ritmo del equipo (4 min)
- **Objetivo:** sincronización colectiva: cuándo esperar a todos.
- **Guion:** (1) Analogía: excursión en grupo — nadie cruza el río hasta que lleguen todos (barrier); solo uno compra los tickets mientras el resto espera (single); (2) barrier: punto de encuentro obligatorio; cuándo hace falta (antes de leer lo que otros escribieron); (3) single: trabajo que debe hacer exactamente un hilo (I/O, inicializar); (4) costo: toda espera es speedup perdido — usar solo cuando la correctitud lo exige.
- **Visual:** 8 corredores llegando a una línea y esperando; timeline con la barrera marcada.
- **Conexión Telar:** `entornoDatos` (m3) y `stencilCalor` (m7) los usan de verdad.

### F3.7 · False sharing y deadlock: los enemigos invisibles (5 min)
- **Objetivo:** dos problemas avanzados que el estudiante debe saber reconocer (no aún dominar).
- **Guion:** (1) False sharing: la memoria viaja en "líneas de caché" (~64 bytes); si dos hilos escriben variables DISTINTAS pero vecinas en memoria, el hardware las trata como compartidas y se las arrebatan — paralelo correcto pero LENTO; analogía: dos personas escribiendo en renglones distintos de la MISMA hoja: se pasan la hoja todo el rato; (2) demo real del curso: `spmd` (con false sharing) vs `spmdCritical` (arreglado) — misma lógica, tiempos muy distintos; (3) Deadlock: abrazo mortal — el hilo A espera algo que tiene B, y B espera algo que tiene A; nadie avanza; analogía: dos coches en un puente de un carril; (4) en este curso el riesgo de deadlock es bajo (OpenMP estructurado protege mucho), pero el concepto es esencial en concurrencia general y en MPI.
- **Visual:** línea de caché rebotando entre 2 núcleos; ciclo de espera A→B→A.
- **Quiz F3 (6 preguntas):** identificar una race en pseudocódigo, elegir entre critical/reduction/private para 3 escenarios, reconocer false sharing por síntomas ("paralelo correcto pero lento"), definición de deadlock.

---

## Módulo F4 — OpenMP y PyOMP: tu caja de herramientas (6 videos, ~28 min)

**Meta del módulo:** qué es OpenMP, cómo se piensa (fork-join + directivas) y
por qué en este curso se escribe en Python con PyOMP. Al terminar, el estudiante
entra a m1 sabiendo exactamente qué está mirando.

### F4.1 · ¿Qué es OpenMP? (5 min)
- **Objetivo:** presentar OpenMP como EL estándar de paralelismo en memoria compartida.
- **Guion:** (1) Gancho: "el mismo estándar que usan los laboratorios nacionales y los supercomputadores… cabe en una línea de tu código"; (2) qué es: un estándar (desde 1997) de DIRECTIVAS que le dicen al compilador 'paraleliza esto' — no una librería de funciones que llamas, sino anotaciones sobre tu código; (3) vive en C, C++ y Fortran (`#pragma omp parallel for`) y domina el HPC de memoria compartida; (4) filosofía: paralelizar incrementalmente — tu programa serial sigue funcionando, le añades directivas donde importa; (5) qué NO es: no es para múltiples máquinas (eso es MPI — mención honesta de 1 frase).
- **Visual:** la misma suma de un array en serial → añadir UNA línea → paralela; logos/historia en 10 segundos.

### F4.2 · El modelo fork-join (4 min)
- **Objetivo:** el modelo mental de ejecución de TODO programa OpenMP.
- **Guion:** (1) tu programa empieza con 1 hilo (master); (2) al llegar a una región paralela hace FORK: nacen N hilos que ejecutan el bloque; (3) al terminar hace JOIN: espera a todos y sigue 1 solo; (4) analogía: un jefe de obra que convoca a la cuadrilla para una tarea y la despide al terminar — varias veces al día; (5) leer un programa OpenMP = ubicar dónde forkea y dónde joinea.
- **Visual:** el diagrama fork-join clásico animado (1 línea que se abre en 8 y se vuelve a cerrar), sincronizado con el código.
- **Conexión Telar:** la visualización de hilos "en vivo" del simulador es literalmente este diagrama con datos reales.

### F4.3 · Tour por las directivas esenciales (5 min)
- **Objetivo:** mapa de las 7 directivas/cláusulas que cubren el 95% del curso.
- **Guion:** rapid-fire con mini-ejemplo de una línea cada una: (1) `parallel` — abre la región; (2) `for` — reparte las vueltas del bucle; (3) `reduction(+:x)` — acumula sin races (recap F3.5); (4) `private/shared/firstprivate` — quién ve qué (recap F3.2); (5) `critical` — de a uno (recap F3.4); (6) `barrier`/`single` — el ritmo del equipo (recap F3.6); (7) `task` — trabajo dinámico, teaser de m6. Cierre: "no las memorices: cada una tiene su lección práctica con código ejecutable".
- **Visual:** tabla-mapa que se va iluminando; sirve luego como "chuleta" descargable del curso.

### F4.4 · PyOMP: OpenMP en Python (5 min)
- **Objetivo:** justificar el stack del curso y explicar la magia de Numba.
- **Guion:** (1) el problema: Python es el lenguaje de la ciencia, pero es lento y su GIL impide hilos reales (recap F1.5); (2) la solución PyOMP: escribes Python, lo decoras con `@njit`, y Numba lo COMPILA a código máquina — ahí ya no hay intérprete ni GIL; (3) las directivas van en un `with openmp("...")`: la sintaxis DENTRO del string es la misma de C — lo que aprendas aquí se transfiere directo a C/C++; (4) la regla del JIT: la primera llamada compila (lenta), por eso todos los ejemplos hacen warmup antes de medir; (5) honestidad técnica: PyOMP 0.5 no implementa todo el estándar (atomic, sections, schedule dynamic…) — el curso usa solo lo verificado, y hay sustitutos para lo demás.
- **Visual:** pipeline Python → Numba → código máquina; comparación lado a lado del mismo código en C y PyOMP.

### F4.5 · Anatomía de tu primer programa PyOMP (5 min)
- **Objetivo:** walkthrough línea a línea del hola-mundo paralelo (puente directo a m1).
- **Guion:** (1) el código completo en pantalla (7 líneas: imports, `@njit`, `with openmp("parallel")`, print del thread num); (2) línea a línea con lo aprendido: fork-join (F4.2), hilos (F1.4), `omp_get_thread_num()`; (3) ejecutarlo: el output sale DESORDENADO — y eso es correcto: los hilos no tienen orden garantizado (recap de no-determinismo, F3.3); (4) reto: "¿en qué orden saldrá en TU máquina? Córrelo en el simulador y compruébalo".
- **Visual:** código + output real de la máquina de referencia (8 hilos, orden aleatorio).
- **Conexión Telar:** botón "Probar en el simulador" precargando `primerEjemplo`.

### F4.6 · Cómo leer el simulador de Telar (4 min)
- **Objetivo:** alfabetización en la herramienta antes de los módulos prácticos.
- **Guion:** (1) el ciclo: eliges/subes código → configuras hilos → lanzar; (2) qué corre por detrás: tu código en un contenedor Docker aislado con PyOMP preinstalado — qué significa eso (sin red, con límites de CPU/memoria/tiempo); (3) pantalla en vivo: logs en streaming, CPU y memoria del contenedor, actividad por hilo; (4) pantalla de resultados: tiempo total, speedup (recap F2.2), distribución de trabajo (recap F2.5), stdout descargable; (5) cierre del track: "ya tienes todo el vocabulario — ahora a romper y arreglar programas de verdad: nos vemos en el módulo 1".
- **Visual:** screencast guiado de un job completo con `for/` (cálculo de π).
- **Quiz F4 (6 preguntas):** qué es OpenMP (directivas vs librería), fork-join, para qué sirve @njit/warmup, qué directiva usar en 2 escenarios, qué significa el aislamiento del runner.

---

## Integración con el catálogo existente

- **Ubicación:** nuevo track "Fundamentos" con módulos `f1`–`f4` ANTES de los
  prácticos `m1`–`m8` en `backend/app/content/catalog.json`. Los ids propuestos:
  `f1-porque`, `f2-pensar`, `f3-memoria`, `f4-openmp`, con lecciones tipo `video`
  (`f1.1`…`f4.6`) y un quiz por módulo siguiendo el formato de
  `backend/app/content/quizzes/*.json` (`pass_threshold: 0.8`).
- **Modelo de datos:** las lecciones actuales solo tienen `content_file` (markdown).
  Añadir al esquema de lección: `type: "video" | "practice"`, `video_url`
  (placeholder hasta grabar) y `duration_minutes`. El reproductor ya existe en el
  diseño (pantalla learn).
- **Guion → grabación:** cada video de este plan tiene beats suficientes para un
  guion de ~600-750 palabras (ritmo 150 palabras/min). Sugerencia de producción
  para la tesis: slides animadas + voz, o screencast para F4.5/F4.6.
- **Referencias cruzadas:** los campos `recommended` de las lecciones prácticas
  deberían apuntar de vuelta a estos videos (p. ej. `mandelbrot` → F3.3;
  `spmd`/`spmdCritical` → F3.7; `for` → F3.5 y F4.5; `entornoDatos` → F3.2/F3.6;
  `tareas` → F2.1; `stencilCalor`/`transporteParticulas` → F2.2/F2.4).
- **Fuentes para los guiones:** *The OpenMP Common Core* (Mattson) caps. 1-3,
  tutorial LLNL (secciones de conceptos), paper PyOMP CiSE 2021 (para F4.4), y
  los `info*.md` del repo de ejemplos para todos los datos numéricos reales
  (speedups, outputs) — usar SIEMPRE los números medidos en la máquina de
  referencia, no teóricos.

## Resumen ejecutivo

| Módulo | Videos | Duración | Conceptos que deja claros |
|---|---|---|---|
| F1 · El porqué del paralelismo | 5 | ~21 min | multicore, proceso, hilo, concurrencia vs paralelismo, GIL |
| F2 · Pensar en paralelo | 5 | ~22 min | datos vs tareas, speedup, eficiencia, Amdahl, overhead, balanceo |
| F3 · Memoria compartida y sus peligros | 7 | ~31 min | shared/private, races, critical, reduction, barrier/single, false sharing, deadlock |
| F4 · OpenMP y PyOMP | 6 | ~28 min | qué es OpenMP, fork-join, directivas esenciales, PyOMP/Numba/JIT, leer el simulador |
| **Total** | **23** | **~102 min** | + 4 quizzes (22 preguntas) |
