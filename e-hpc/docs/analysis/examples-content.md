# Fuente de verdad: contenido de cursos derivado del repo de ejemplos PyOMP

> Documento generado por análisis exhaustivo de `/mnt/d/universidad/tesis/simuladores/openmp/aprendizaje/`
> (README.md, requirements.txt y las 14 carpetas de ejemplos: cada `.py` y cada `info*.md` completos).
> Fecha de análisis: 2026-07-12.
>
> Entorno verificado del repo: Python 3.12.3 + pyomp 0.5.1 + numba 0.63.1 en WSL2, 8 núcleos.

---

## 1. Tabla maestra de los 14 ejemplos

| # | Carpeta | Archivo .py | info*.md | Directivas/funciones OpenMP usadas | Qué enseña | Dificultad | Tiempo aprox. ejecución* | ¿Requiere GPU? |
|---|---------|-------------|----------|-------------------------------------|------------|-----------|--------------------------|----------------|
| 1 | `primerEjemplo/` | `helloOpenMP.py` | `infoHelloOpenMP.md` | `parallel`; `omp_get_thread_num()` | Hola mundo paralelo; identidad del hilo; `@njit`; `OMP_NUM_THREADS` | Básica (1/5) | ~2–5 s (casi todo es compilación JIT; el trabajo es trivial) | No |
| 2 | `for/` | `forOpenMP.py` | `infoForOpenMP.md` **(VACÍO, 0 bytes)** | `parallel for reduction(+:red_sum) schedule(static)` | Worksharing con reducción (π por integración numérica, 1M pasos) | Básica (1/5) | ~3–6 s (SIN warmup: la única llamada incluye la compilación JIT) | No |
| 3 | `spmd/` | `piSpmd.py` | `infoPiSpmd.md` | `parallel private(...) shared(...)`; `omp_set_num_threads`, `omp_get_thread_num`, `omp_get_num_threads`, `omp_get_wtime` | Patrón SPMD: reparto cíclico manual; demuestra FALSE SHARING (no hay speedup) | Intermedia (3/5) | ~4–8 s (warmup + 4 corridas de 10M pasos, ~0.03–0.05 s c/u) | No |
| 4 | `spmdCritical/` | `piSpmdCritical.py` | `infoPiSpmdCritical.md` | `parallel private/shared`; `critical`; `omp_set_num_threads`, `omp_get_wtime` | Solución al false sharing: acumulador privado + `critical` una vez por hilo | Intermedia (3/5) | ~4–8 s (warmup + 4 corridas, ~0.007–0.013 s c/u) | No |
| 5 | `entornoDatos/` | `entornoDatos.py` | `infoEntornoDatos.md` | `parallel private(...) firstprivate(...) shared(...) num_threads(4)`; `critical`; `barrier`; `single` | Entorno de datos completo: private vs firstprivate vs shared + 3 primitivas de sincronización | Intermedia (2/5) | ~3–5 s (trabajo trivial; domina el JIT) | No |
| 6 | `sumaVectores/` | `sumaVectores.py` | `infoSumaVectores.md` | `parallel for schedule(static, 1000)` | Worksharing sobre arrays NumPy; cláusula `schedule(static, chunk)`; validación con `np.allclose`; comparación vs NumPy | Básica (2/5) | ~5–10 s (10M elementos; ~0.11 s el bucle OpenMP, ~0.29 s NumPy en la máquina de referencia) | No |
| 7 | `matrices/` | `multiplicacionMatrices.py` | `infoMultiplicacionMatrices.md` | `parallel for private(j, k, tmp) schedule(static)` | Bucles anidados: paralelizar el externo, privatizar j/k/tmp; comparación vs BLAS (`A @ B`) | Intermedia (3/5) | ~5–10 s (600×600; ~0.07 s OpenMP, ~0.04 s BLAS por corrida) | No |
| 8 | `mandelbrot/` | `areaMandelbrot.py` | `infoAreaMandelbrot.md` | `parallel for private(...)` SIN protección (bug a propósito) vs `... reduction(+:num_outside)` | DATA RACES: versión rota (resultado variable) vs versión correcta con reduction | Intermedia-alta (4/5) | ~10–30 s (6 corridas de malla 1000×1000, maxiter 1000: 3 con race + 3 con reduction) | No |
| 9 | `monteCarloPi/` | `piMonteCarlo.py` | `infoPiMonteCarlo.md` | `parallel private(...) shared(seeds)` + `for reduction(+:hits)` SEPARADOS; `omp_set_num_threads`, `omp_get_thread_num` | RNG en paralelo: LCG a mano con semilla por hilo (sustituto de `threadprivate`) | Intermedia-alta (4/5) | ~4–8 s (warmup + corridas de 100k/1M/10M dardos con 4 hilos) | No |
| 10 | `tareas/` | `piTask.py` | `infoPiTask.md` | `task shared(...) firstprivate(...)`; `taskwait`; `parallel` + `single` | Divide y vencerás con tareas (π recursivo); umbral MIN_BLK; combo parallel+single | Avanzada (4/5) | ~3–6 s (una corrida de 10M pasos, incluye JIT; sin warmup) | No |
| 11 | `fibonacciTareas/` | `fibonacciTareas.py` | `infoFibonacciTareas.md` | `task shared(x) firstprivate(n)`; `taskwait`; `parallel` + `single` | Árbol de tareas irregular; umbral de corte (UMBRAL=20); work stealing | Avanzada (4/5) | ~3–8 s (fib(10,20,30,35); domina el JIT) | No |
| 12 | `stencilCalor/` | `calorStencil.py` | `infoCalorStencil.md` | `parallel private(paso, i, j)` + dos `for` huérfanos; barreras implícitas | Simulación física iterativa (difusión calor 2D, Jacobi); doble buffer; MEMORY-BOUND (speedup ~1.1x) | Avanzada (4/5) | ~8–15 s (warmup paralelo+serial + 2 corridas medidas de ~0.9–1.0 s c/u; malla 1500×1500, 200 pasos) | No |
| 13 | `transporteParticulas/` | `transporteMonteCarlo.py` | `infoTransporteMonteCarlo.md` | `parallel private(...) shared(seeds)` + `for reduction(+:a,b,c)` (3 contadores); `omp_set_num_threads`, `omp_get_wtime` | Simulador Monte Carlo real (slab 1D); COMPUTE-BOUND, escala 8x; combina todo lo anterior | Avanzada (5/5) | ~5–10 s (warmup + 4 corridas de 5M partículas: 0.726/0.256/0.173/0.091 s con 1/2/4/8 hilos) | No |
| 14 | `sumaVectoresGPU/` | `sumaVectoresGPU.py` | `infoSumaVectoresGPU.md` | `target teams distribute parallel for map(to: a, b) map(tofrom: c)` | Offloading a GPU; mapeo de datos host↔device | Avanzada (4/5) | N/A en CPU (falla); segundos en GPU | **SÍ** — ver nota |

\* Tiempos de pared totales estimados para el proceso completo (incluye compilación JIT, que domina en los ejemplos cortos), sobre la máquina de referencia del repo (8 núcleos, WSL2). Los tiempos "internos" citados provienen del output real pegado en cada `info*.md`.

### Nota crítica sobre `sumaVectoresGPU/` (ejemplo 14)

- **NO corre en CPU-only.** Según `infoSumaVectoresGPU.md`, el ejemplo está marcado "⚠️ estado: NO PROBADO en esta maquina" y al ejecutarlo falló con `FileNotFoundError: 'x86_64-linux-gnu-gcc'` / `RuntimeError: Compilation failed for trampolines` — pyomp necesita un compilador C del sistema para generar el código de offload, incluso con GPU presente.
- Requisitos completos (docs oficiales pyomp 0.5.x citados en el info): GPU **NVIDIA** (AMD "work in progress", macOS sin soporte GPU) + **Linux** (incluye WSL2 con driver NVIDIA en Windows) + **gcc** instalado (`sudo apt-get install gcc`).
- Los 13 ejemplos CPU NO necesitan nada de eso.
- **Recomendación para el simulador: deshabilitar/marcar como opcional este ejemplo por defecto**, y habilitarlo solo tras detección de capacidades (GPU NVIDIA + gcc). No hay fallback a host: sin GPU/gcc el proceso aborta con excepción, no degrada a CPU.

### Nota sobre `for/infoForOpenMP.md`

El archivo existe pero está **vacío (0 bytes)**. Es el único info faltante. El contenido pedagógico del ejemplo 2 debe derivarse del código (`forOpenMP.py`), de la fila 2 de la tabla del README y de los comentarios. Detalle del código: usa `x = ((j-1) - 0.5) * step` (punto medio desplazado respecto al clásico `(i + 0.5) * step` de los demás ejemplos π; converge igualmente a π con 1M de pasos). Además es el único ejemplo con cómputo pesado **sin warmup JIT** — su única llamada incluye la compilación.

---

## 2. Ruta pedagógica del README → propuesta de módulos de curso

El README define una ruta lineal 1→14 (tabla "Ruta de aprendizaje (en orden)") con dos parejas pedagógicas explícitas: **3–4** (SPMD lento→rápido por false sharing) y **12–13** (memory-bound→compute-bound). También declara que con 2 (`for/`), 3 (`spmd/`) y 10 (`tareas/`) se cubren los **3 patrones de diseño del paper de PyOMP**: loop-level, SPMD y divide-y-vencerás.

Propuesta de módulos (respeta el orden lineal del README):

| Módulo | Nombre | Lecciones (en orden) | Concepto eje |
|--------|--------|----------------------|--------------|
| M1 | Fundamentos | L1: `primerEjemplo/` · L2: `for/` | Región paralela, identidad de hilo, `@njit`/JIT, primer worksharing con `reduction` |
| M2 | Patrón SPMD y false sharing | L3: `spmd/` · L4: `spmdCritical/` | Reparto manual con `omp_get_thread_num`; false sharing y su arreglo (privado + `critical`) — pareja pedagógica |
| M3 | Entorno de datos y sincronización | L5: `entornoDatos/` | `private` vs `firstprivate` vs `shared`; `critical`, `barrier`, `single` ("el 90% de los bugs paralelos son variables mal declaradas") |
| M4 | Worksharing sobre arrays | L6: `sumaVectores/` · L7: `matrices/` | `schedule(static, chunk)`; bucles anidados (qué paralelizar y qué privatizar); validar contra NumPy/BLAS |
| M5 | Data races y RNG paralelo | L8: `mandelbrot/` · L9: `monteCarloPi/` | Race visible (bug a propósito) vs `reduction`; estado de RNG por hilo (sustituto de `threadprivate`) |
| M6 | Tareas (divide y vencerás) | L10: `tareas/` · L11: `fibonacciTareas/` | `task`/`taskwait`; combo `parallel`+`single`; umbral de corte; árboles irregulares y work stealing |
| M7 | Simulaciones reales: ¿qué escala? | L12: `stencilCalor/` · L13: `transporteParticulas/` | Memory-bound (~1.1x) vs compute-bound (8x) — pareja pedagógica; el simulador Monte Carlo combina todo |
| M8 | GPU (opcional/condicional) | L14: `sumaVectoresGPU/` | `target teams distribute parallel for` + `map`; costo de mover datos por PCIe. **Solo si hay GPU NVIDIA + gcc** |

Reglas didácticas transversales del README (aplicables a todo el curso):

1. La sintaxis dentro del string `openmp("...")` es LA MISMA de OpenMP en C/C++ — lo aprendido se transfiere directo a C.
2. Todo ejemplo paralelo se valida contra una versión confiable (fórmula exacta, `np.allclose` contra NumPy, o versión serial).
3. Regla del patrón JIT: primera llamada = compilación (lenta); los ejemplos con medición hacen warmup antes de medir.
4. Solo se usan directivas verificadas contra los tests del repo oficial de PyOMP (ver §3).

---

## 3. Tabla EXACTA de soporte de pyomp 0.5.x (según el README)

Fuente declarada en el README: docs oficiales (pyomp.readthedocs.io) y la suite de tests del repo oficial (`src/numba/openmp/tests/test_openmp.py`; lo no implementado está marcado con skip "Unimplemented").

### SÍ funciona

| Categoría | Elementos |
|-----------|-----------|
| Regiones/worksharing | `parallel`, `for`, `parallel for` |
| Reducciones | `reduction(+, -, *)` |
| Schedule | `schedule(static)` y `schedule(static, N)` **con N constante** |
| Sincronización | `critical` (sin nombre), `barrier`, `single` |
| Tareas | `task`, `taskwait` |
| Cláusulas de datos | `private`, `shared`, `firstprivate`, `lastprivate`, `default(none)` |
| Otras cláusulas | `num_threads`, `if` (constante) |
| GPU | `teams` / `distribute` / `target` / `map` (GPU NVIDIA en Linux) |
| Funciones runtime | `omp_get_thread_num`, `omp_get_num_threads`, `omp_set_num_threads`, `omp_get_max_threads`, `omp_get_wtime`, `omp_in_parallel`, etc. |

### NO funciona (falla o aborta — no intentarlo)

| Elemento | Nota |
|----------|------|
| `atomic` | Sustituto: `critical` o `reduction` |
| `master` | Sustituto: `single` |
| `sections` | Sustituto: tasks, o ramas por `omp_get_thread_num()` |
| `taskloop`, `taskgroup`, `task depend` | (el info de tareas añade: tampoco `taskyield` ni cláusulas if/final/priority/untied en task) |
| `ordered` | — |
| `flush` | — |
| `threadprivate`, `copyin`, `copyprivate` | Sustituto de `threadprivate`: array indexado por número de hilo (ver `monteCarloPi/`) |
| `schedule(dynamic)`, `schedule(guided)` | Tests marcados "Unimplemented"; el chunk de static debe ser constante (no variable) |
| `critical(nombre)` | Solo `critical` sin nombre |
| `simd` | — |
| `collapse` en CPU | Los docs dicen que sí, pero el test está skipped — **no fiarse** |
| `nowait` | No confiable |

Plataformas: pyomp 0.5.x soporta Python 3.10–3.14 en linux-64, linux-arm64 y osx-arm64. GPU: solo NVIDIA + Linux (WSL2 incluido) + gcc.

---

## 4. Resumen por ejemplo + preguntas de quiz

Formato quiz: 4 opciones (a–d), la correcta marcada con **✔** y justificada. Todas derivadas del contenido real del `info*.md` y/o del código.

---

### 4.1 `primerEjemplo/helloOpenMP.py` (infoHelloOpenMP.md)

**Resumen del info:** Es el "hello world" de PyOMP (primer ejemplo del video de presentación de PyOMP). Explica: `@njit` = "no ejecutes esta función como Python normal, compílala a código máquina nativo" (eficiencia: lo que corre no lo corre Python, ideal para evaluar rendimiento); el bloque `with openmp("parallel")` marca inicio y fin de la región paralela; dentro, cada hilo imprime su `omp_get_thread_num()`. Se crean tantos hilos como procesadores lógicos vea el sistema (`nproc`, 8 en la máquina de referencia) o los que fije `OMP_NUM_THREADS`. El output real muestra los 8 hilos en orden NO determinista.

**Quiz:**

1. ¿Qué hace el decorador `@njit` en PyOMP?
   - a) Ejecuta la función en un intérprete Python más rápido
   - b) **✔ Compila la función a código máquina nativo antes de correrla** — según el info: "no ejecutes esta función como Python normal, compílala a código máquina nativo"; por eso sirve para medir rendimiento real
   - c) Crea automáticamente los hilos de OpenMP
   - d) Convierte la función a C y la guarda en disco
2. Sin `OMP_NUM_THREADS` definido, ¿cuántos hilos ejecutan la región `parallel`?
   - a) Siempre 4
   - b) Uno solo, hasta que se pida más
   - c) **✔ Tantos como procesadores lógicos vea el sistema (lo que muestra `nproc`)** — el info lo dice explícitamente y muestra `nproc` = 8 → 8 líneas de output
   - d) El doble de los núcleos físicos, siempre
3. En el output real del ejemplo, los mensajes "Hello from thread N" aparecen…
   - a) Siempre en orden 0,1,2,…,7
   - b) **✔ En orden impredecible (0,3,6,2,1,4,7,5 en la corrida del info)** — los hilos corren concurrentemente y no hay sincronización de orden
   - c) Solo el hilo 0 imprime
   - d) En orden inverso 7,6,5,…
4. ¿Qué delimita la región paralela en PyOMP?
   - a) Llaves `{ }` como en C
   - b) La indentación de la función completa
   - c) **✔ El bloque `with openmp("parallel"):`** — el info: "El bloque with marca el inicio y el fin de una región paralela"
   - d) El decorador `@njit`

---

### 4.2 `for/forOpenMP.py` (infoForOpenMP.md — **VACÍO**)

**Resumen:** El info*.md está vacío (0 bytes); lo que sigue se deriva del código y del README (fila 2: "worksharing con reduccion (pi)"). Calcula π ≈ 3.14159 integrando 4/(1+x²) con 1,000,000 pasos usando `parallel for reduction(+:red_sum) schedule(static)`: OpenMP crea los hilos, reparte el bucle Y combina las sumas parciales, todo en una directiva. Es el patrón loop-level, el primero de los 3 patrones del paper de PyOMP. No hay warmup: la única llamada incluye la compilación JIT.

**Quiz:**

1. ¿Qué hace `reduction(+:red_sum)` en la directiva?
   - a) Bloquea `red_sum` con un mutex en cada suma
   - b) **✔ Da a cada hilo una copia privada de `red_sum` y las combina con + al final** — es la semántica de reduction; evita el data race sin serializar
   - c) Redondea `red_sum` al final del bucle
   - d) Divide `red_sum` entre el número de hilos
2. En `parallel for`, la variable del bucle (`j`) es…
   - a) Compartida: hay que protegerla con critical
   - b) **✔ Privada automáticamente para cada hilo** — regla de OpenMP para la variable de control del for paralelizado (confirmado también en infoSumaVectores e infoMultiplicacionMatrices)
   - c) firstprivate por defecto
   - d) Indefinida: hay que declararla siempre
3. ¿Qué `schedule` usa este ejemplo y por qué es la única familia disponible en pyomp 0.5.x?
   - a) `schedule(dynamic)`, porque balancea mejor
   - b) `schedule(guided)`, porque es el default de OpenMP
   - c) **✔ `schedule(static)`; dynamic y guided NO están implementados en pyomp 0.5.x** — el README y los comentarios de sumaVectores lo advierten (tests "Unimplemented")
   - d) Ninguno: pyomp no acepta la cláusula schedule
4. ¿Qué patrón de diseño del paper de PyOMP ilustra este ejemplo?
   - a) SPMD
   - b) Divide y vencerás
   - c) **✔ Loop-level parallelism** — el README indica que `for/`, `spmd/` y `tareas/` cubren los 3 patrones; este es el de nivel de bucle
   - d) Pipeline

---

### 4.3 `spmd/piSpmd.py` (infoPiSpmd.md)

**Resumen del info:** Calcula el mismo π que `for/` pero SIN `parallel for`: reparto manual del trabajo usando el número de hilo — patrón **SPMD** (Single Program Multiple Data), uno de los 3 patrones del paper de PyOMP. Explica: `omp_set_num_threads` (equivale a OMP_NUM_THREADS desde código); `partial = np.zeros(num_threads)` (una casilla de suma parcial por hilo); reparto cíclico `for i in range(tid, num_steps, nths)` (hilo 0 toma 0,8,16…; hilo 1 toma 1,9,17…); `omp_get_wtime()` como cronómetro. **Lección clave del output real: π sale bien pero casi NO hay speedup (0.036 s con 1 hilo → 0.031 s con 8). NO es un bug: las casillas de `partial` comparten línea de caché → false sharing**, que arregla el ejemplo siguiente.

**Quiz:**

1. ¿Cómo reparte el trabajo el hilo `tid` en el patrón SPMD de este ejemplo?
   - a) OpenMP reparte el bucle automáticamente
   - b) **✔ Manualmente con `range(tid, num_steps, nths)`: reparto cíclico (el hilo 0 toma 0, 8, 16…)** — el info lo llama "ESTE es el reparto manual"; el for es un for de Python normal que OpenMP no toca
   - c) Cada hilo procesa la mitad izquierda o derecha
   - d) Un hilo maestro asigna trozos bajo demanda
2. En el output real, ¿por qué casi no hay speedup al pasar de 1 a 8 hilos?
   - a) El JIT no compiló la función
   - b) Hay un data race que corrompe los tiempos
   - c) **✔ False sharing: las casillas contiguas de `partial` caen en la misma línea de caché y los hilos se la pelean** — el info: "eso NO es un bug, es la leccion del ejemplo"
   - d) `omp_set_num_threads` no funciona en pyomp
3. ¿Qué papel cumple `partial = np.zeros(num_threads)`?
   - a) Es un buffer temporal del JIT
   - b) **✔ Una casilla de suma parcial por hilo: cada hilo acumula en `partial[tid]`** — así se evita el race sobre un acumulador único (a costa del false sharing)
   - c) Guarda los tiempos de cada hilo
   - d) Es la lista de semillas aleatorias
4. ¿Qué función usa el ejemplo para cronometrar dentro de la función @njit?
   - a) `time.time()`
   - b) `time.perf_counter()`
   - c) **✔ `omp_get_wtime()`** — el info: "cronometro de OpenMP, devuelve segundos (se usa dentro de la funcion @njit)"
   - d) `datetime.now()`
5. ¿A qué equivale `omp_set_num_threads(n)` según el info?
   - a) A `schedule(static, n)`
   - b) **✔ A la variable de entorno OMP_NUM_THREADS pero fijada desde código** — fija cuántos hilos usará la siguiente región paralela
   - c) A crear n procesos con multiprocessing
   - d) A limitar el JIT a n funciones

---

### 4.4 `spmdCritical/piSpmdCritical.py` (infoPiSpmdCritical.md)

**Resumen del info:** Es la SOLUCIÓN al false sharing de `spmd/`: cada hilo acumula en `local_sum` (variable local PRIVADA, en su propio stack → cero peleas de caché) y al final suma UNA sola vez al total compartido dentro de `with openmp("critical")` (solo un hilo a la vez dentro del bloque). Output real: con 1 hilo ya es ~3x más rápido que spmd (0.0128 vs 0.0363 s) y con 4 hilos escala de verdad (0.0066 s). Notas pyomp 0.5.x: `critical` sin nombre SÍ; `critical(nombre)` NO; `atomic` NO existe (en C sería `#pragma omp atomic`) — la única opción es `critical`. Poner el critical DENTRO del bucle sería correcto pero lentísimo (serializa): la gracia es acumular privado y proteger solo el final.

**Quiz:**

1. ¿Cómo elimina este ejemplo el false sharing de `spmd/`?
   - a) Usando `schedule(dynamic)` para repartir mejor
   - b) **✔ Cada hilo acumula en una variable local privada (`local_sum`) en su propio stack, en vez de escribir en un array compartido** — cero tráfico de caché entre hilos
   - c) Aumentando el número de pasos
   - d) Alineando el array a 64 bytes
2. ¿Qué garantiza `with openmp("critical")`?
   - a) Que el bloque se ejecute primero en el hilo 0
   - b) Que el bloque se ejecute exactamente una vez en total
   - c) **✔ Que solo UN hilo a la vez esté dentro del bloque; los demás esperan** — exclusión mutua, según el info "los demás esperan en la puerta"
   - d) Que el bloque corra en la GPU
3. ¿Por qué el costo del `critical` aquí es despreciable?
   - a) Porque pyomp lo compila a una instrucción atómica
   - b) **✔ Porque se ejecuta UNA vez por hilo (al final), no una vez por iteración** — el info: "Se hace UNA vez por hilo (no una por iteracion!!)"
   - c) Porque solo hay 2 hilos
   - d) Porque el bucle es corto
4. En pyomp 0.5.x, ¿cuál es la alternativa REAL a `#pragma omp atomic` de C?
   - a) `atomic` funciona igual en pyomp
   - b) `flush` seguido de `barrier`
   - c) **✔ `critical` (o `reduction` cuando aplica): `atomic` NO existe en pyomp 0.5.x** — nota explícita del info
   - d) `ordered`
5. ¿Qué pasaría si el `critical` estuviera dentro del bucle de integración?
   - a) El resultado sería incorrecto
   - b) **✔ El resultado seguiría correcto pero el programa sería lentísimo (serializa todo)** — el info: "correctisimo pero lentisimo"
   - c) pyomp lanzaría un error de compilación
   - d) Se produciría un deadlock

---

### 4.5 `entornoDatos/entornoDatos.py` (infoEntornoDatos.md)

**Resumen del info:** Laboratorio a propósito sin cálculo útil para VER la diferencia entre `private`, `firstprivate` y `shared` + tres directivas de sincronización (`critical`, `barrier`, `single`). "Es la parte más importante de OpenMP: el 90% de los bugs paralelos son variables mal declaradas." Claves: `private(x, tid)` = copia por hilo SIN valor inicial garantizado, la x original sigue valiendo 100 al salir; `firstprivate(zfp)` = copia por hilo inicializada con el valor previo (10) → cada hilo imprime 10+tid; `shared(zsh)` = una sola variable para todos → el `zsh += 1` se protege con `critical`; `barrier` = nadie pasa hasta que TODOS llegan (garantiza zsh=4 antes de imprimir); `single` = lo ejecuta UN solo hilo (el primero que llegue). Al final: x=100, zfp=10, zsh=4 (solo la shared conserva el efecto). Nota pyomp: `master` NO implementado (usar `single`); `default(none)` sí funciona. Fuente: adaptado de TestDataEnv.py oficial de PyOMP.

**Quiz:**

1. Después de la región paralela, ¿cuánto valen x (private, era 100) y zfp (firstprivate, era 10)?
   - a) x = 3000 y zfp = 13 (los del último hilo)
   - b) **✔ x = 100 y zfp = 10: recuperan sus valores originales porque los hilos trabajaron sobre COPIAS** — última línea del output real: "despues de la region: x = 100 | zfp = 10 | zsh = 4"
   - c) Ambas quedan en 0
   - d) Quedan indefinidas y el programa falla
2. ¿Cuál es la diferencia entre `private` y `firstprivate`?
   - a) private es para enteros y firstprivate para flotantes
   - b) **✔ Ambas crean copia por hilo, pero firstprivate la inicializa con el valor que la variable tenía antes de la región; private NO garantiza valor inicial** — por eso cada hilo imprime zfp = 10 + tid
   - c) firstprivate solo aplica al hilo 0
   - d) private copia el valor de vuelta al salir
3. ¿Por qué `zsh += 1` está dentro de un `critical`?
   - a) Para que se ejecute una sola vez en total
   - b) **✔ Porque zsh es shared (una sola variable para todos) y sumar sin protección sería un data race** — el info lo dice: "hay que proteger la suma"
   - c) Porque += no existe en numba
   - d) Para acelerar la suma
4. ¿Qué garantiza el `barrier` en este ejemplo?
   - a) Que solo un hilo imprima
   - b) Que los hilos se ejecuten en orden 0,1,2,3
   - c) **✔ Que los 4 hilos ya sumaron a zsh antes de que el `single` la imprima (zsh = 4)** — "punto de encuentro: ningun hilo pasa hasta que TODOS hayan llegado"
   - d) Que zfp se sincronice entre hilos
5. En pyomp 0.5.x, ¿qué usar en lugar de `master`?
   - a) `critical`
   - b) `barrier`
   - c) **✔ `single`** — nota del info: "master NO esta implementado (usa single)"; single lo ejecuta un solo hilo (cualquiera, el primero que llegue)
   - d) `if(omp_get_thread_num()==0)` es la única forma

---

### 4.6 `sumaVectores/sumaVectores.py` (infoSumaVectores.md)

**Resumen del info:** El "hola mundo" del worksharing sobre arrays: c[i] = a[i] + b[i] con 10M elementos. Muestra `schedule(static, 1000)`: reparte iteraciones en bloques FIJOS de 1000 (hilo 0 toma 0–999, hilo 1 toma 1000–1999… y vuelta a empezar). La variable del bucle es privada automáticamente. Regla de oro: SIEMPRE validar el resultado paralelo contra la versión confiable (`np.allclose(c, a+b)`). Output real: OpenMP 0.113 s vs NumPy 0.293 s — más rápido que NumPy porque `a + b` usa un solo núcleo y además crea el array resultado. Notas pyomp 0.5.x MUY IMPORTANTES: `schedule(static)` y `schedule(static, N)` con N CONSTANTE funcionan; `schedule(dynamic)`/`schedule(guided)` NO implementados; `schedule(static, variable)` NO (chunk debe ser constante); sin schedule se usa el reparto por defecto (bloques contiguos), casi siempre bien. Fuente: ejercicio 2 (omp_workshare1.c) del tutorial LLNL.

**Quiz:**

1. ¿Qué significa `schedule(static, 1000)`?
   - a) Ejecutar como máximo 1000 iteraciones en paralelo
   - b) **✔ Repartir las iteraciones en bloques fijos de 1000 entre los hilos, en round-robin** — info: "hilo 0 toma 0-999, hilo 1 toma 1000-1999... y vuelta a empezar"
   - c) Crear 1000 hilos
   - d) Repartir dinámicamente trozos de tamaño ≤1000
2. ¿Por qué la versión OpenMP le gana a `a + b` de NumPy (0.11 s vs 0.29 s)?
   - a) Porque numba genera SIMD y NumPy no
   - b) **✔ Porque `a + b` de NumPy usa un solo núcleo y además crea el array resultado; el bucle OpenMP usa los 8 núcleos** — explicación literal del info
   - c) Porque NumPy valida los datos antes de sumar
   - d) Es falso: NumPy siempre gana
3. ¿Cuál de estas variantes de schedule SÍ funciona en pyomp 0.5.x?
   - a) `schedule(dynamic)`
   - b) `schedule(guided, 100)`
   - c) **✔ `schedule(static, 1000)` con chunk constante** — dynamic/guided están "Unimplemented" y el chunk de static no puede ser variable
   - d) `schedule(static, n)` donde n es un parámetro de la función
4. ¿Cuál es la "regla de oro del paralelismo" que aplica este ejemplo?
   - a) Medir siempre con omp_get_wtime
   - b) Usar siempre 8 hilos
   - c) **✔ Validar SIEMPRE el resultado paralelo contra una versión confiable (aquí `np.allclose(c, a+b)`)** — así lo llama el info
   - d) Nunca escribir en arrays compartidos

---

### 4.7 `matrices/multiplicacionMatrices.py` (infoMultiplicacionMatrices.md)

**Resumen del info:** C = A×B (600×600) con el triple bucle clásico, paralelizando SOLO el bucle externo (i, las filas): cada hilo procesa un bloque de filas completo. CLAVE: `private(j, k, tmp)` — si fueran compartidos, un hilo pisaría el contador del otro → resultado basura; i es privada automática. Acumular en `tmp` privado y escribir C[i,j] al final reduce tráfico de memoria. Output real: OpenMP 0.067 s vs `A @ B` (BLAS) 0.039 s. Lección doble: (1) paralelizar un algoritmo simple te acerca mucho a una librería profesional; (2) si existe una librería optimizada, ÚSALA — OpenMP es para el código sin librería (simuladores, kernels custom). Nota pyomp 0.5.x: `collapse(2)` está en la documentación pero el test CPU está "Unimplemented" — no fiarse, paralelizar solo el externo. Fuentes: matmul.c de Mattson, omp_mm.c de LLNL, dgemm de PyOMP.

**Quiz:**

1. ¿Por qué j, k y tmp deben ir en `private(...)`?
   - a) Para que numba pueda inferir sus tipos
   - b) **✔ Porque cada hilo los usa para su propia fila; si fueran compartidos un hilo pisaría el contador del otro → resultado basura** — advertencia central del info
   - c) Porque las variables de bucle no pueden ser shared en numba
   - d) Solo por estilo: funcionaría igual sin ello
2. ¿Qué bucle se paraleliza y por qué?
   - a) El de k, porque es el más interno
   - b) Los tres a la vez con collapse(3)
   - c) **✔ El externo (i, las filas): cada hilo procesa un bloque de filas completo** — y collapse en CPU NO es confiable en pyomp 0.5.x
   - d) El de j, para equilibrar la carga
3. Nuestro triple bucle paralelo pierde contra `np.dot` (BLAS). ¿Cuál es la lección según el info?
   - a) OpenMP en Python nunca vale la pena
   - b) Hay que reescribirlo en C
   - c) **✔ Si existe una librería optimizada para tu problema, úsala; OpenMP es para el código que NO tiene librería (tus simuladores, tus kernels custom)** — lección 2 literal del info
   - d) BLAS usa GPU por debajo
4. ¿Por qué se acumula en `tmp` y se escribe `C[i, j]` una sola vez al final?
   - a) Porque numba no permite escribir dos veces la misma celda
   - b) **✔ Menos tráfico de memoria: acumular en un escalar privado es más rápido que escribir C[i,j] en cada vuelta de k** — explicación del info
   - c) Para evitar un data race sobre C
   - d) Para que el JIT pueda vectorizar j

---

### 4.8 `mandelbrot/areaMandelbrot.py` (infoAreaMandelbrot.md)

**Resumen del info:** Estima el área del conjunto de Mandelbrot contando puntos que escapan (|z|>2) al iterar z = z²+c, PERO el tema real es un **BUG A PROPÓSITO**: `area_mandelbrot_mal` tiene `num_outside` compartida y todos los hilos hacen `+= 1` sin protección. El `+=` NO es atómico (leer-sumar-escribir): si dos hilos leen a la vez, una suma SE PIERDE → data race. `area_mandelbrot_bien` es idéntica pero con `reduction(+:num_outside)`. También: TODAS las variables de trabajo del punto van en private (olvidar una sola sería otro race — el otro bug clásico del ejercicio original de Mattson/Mark Bull); el `break` está en el bucle interno (en OpenMP no se puede hacer break del bucle paralelizado, de los internos sí). Output real: con race el área VARÍA cada corrida (1.955 / 1.789 / 2.273, siempre mal e inflada porque se pierden sumas de num_outside); con reduction siempre 1.510363125 (área real ~1.5065). "Así se ve un data race en la vida real: el programa NO crashea, solo miente." Nota pyomp: en C se arreglaría también con atomic, pero NO existe → `reduction` (la buena) o `critical` (correcta pero lenta dentro del bucle).

**Quiz:**

1. ¿Por qué `num_outside += 1` sin protección es un data race?
   - a) Porque `+=` no existe dentro de regiones paralelas
   - b) **✔ Porque += es leer-sumar-escribir: si dos hilos leen a la vez el mismo valor, una suma se pierde** — explicación literal del info
   - c) Porque num_outside es un entero de 32 bits
   - d) Porque el break interrumpe la suma
2. Según el output real, ¿cómo se manifiesta el data race?
   - a) El programa crashea con segfault
   - b) pyomp lanza una excepción de race detectado
   - c) **✔ El área da un valor DISTINTO en cada corrida (1.955, 1.789, 2.273…) y siempre inflado — "el programa NO crashea, solo miente"** — se pierden incrementos de num_outside
   - d) El programa se cuelga en un deadlock
3. ¿Cuál es la corrección recomendada del race en pyomp 0.5.x?
   - a) `#pragma omp atomic`, igual que en C
   - b) **✔ `reduction(+:num_outside)`: copia privada por hilo combinada al final (cero races, cero espera)** — atomic NO existe en pyomp; critical dentro del bucle sería correcto pero lento
   - c) Poner num_outside en firstprivate
   - d) Usar `ordered` en el bucle
4. ¿Qué regla sobre `break` ilustra el ejemplo?
   - a) break está prohibido en cualquier código OpenMP
   - b) **✔ No se puede hacer break del bucle paralelizado, pero sí de los bucles internos (aquí el de iteraciones `it`)** — nota del info
   - c) break solo funciona con schedule(static)
   - d) break provoca data races
5. ¿Cuál era "el otro bug clásico" del ejercicio original?
   - a) Usar float en vez de double
   - b) **✔ Olvidar UNA sola variable de trabajo en la lista private (también sería un race)** — el info: todas las variables del punto (cr, ci, zr, zi, zr2, zi2, it, j) son privadas
   - c) Iterar maxiter+1 veces
   - d) No usar warmup del JIT

---

### 4.9 `monteCarloPi/piMonteCarlo.py` (infoPiMonteCarlo.md)

**Resumen del info:** π por Monte Carlo (dardos al cuadrado unitario; π ≈ 4·dentro/total), pero el tema REAL: **números aleatorios en paralelo**, base de cualquier simulador Monte Carlo y trampa clásica. Un RNG tiene ESTADO (la semilla se actualiza en cada llamada); si todos los hilos comparten el estado → data race. En C se resuelve con `threadprivate`, que pyomp 0.5.x NO soporta. Adaptación: array `seeds` con una semilla DISTINTA por hilo; dentro de la región cada hilo carga `s = seeds[tid]` en una variable PRIVADA → generador independiente por hilo. El LCG se implementa a mano (s = (A·s+C) mod 2³²) porque numba no soporta np.random con semillas por hilo. Patrón notable: `parallel` y `for` van SEPARADOS (primero la región para inicializar el RNG por hilo, dentro el worksharing con `for reduction(+:hits)`) — mismo patrón de la figura 1 del paper de PyOMP. Output real (4 hilos): 3.14408 / 3.139644 / 3.1420628 para 100k/1M/10M dardos — converge lento (error ~ 1/√N), por eso Monte Carlo NECESITA paralelismo. Detalle fino: semillas distintas no garantizan matemáticamente secuencias sin solape (técnica correcta: leapfrog; para producción, Philox/PCG).

**Quiz:**

1. ¿Por qué cada hilo necesita su propio generador de números aleatorios?
   - a) Para que los números sean más aleatorios
   - b) **✔ Porque el RNG tiene estado (la semilla se actualiza en cada llamada); compartirlo entre hilos es un data race** — el problema central que plantea el info
   - c) Porque numba prohíbe compartir arrays
   - d) Para poder usar np.random.seed en paralelo
2. En C esto se resuelve con `threadprivate`. ¿Cuál es la adaptación en pyomp 0.5.x?
   - a) Usar `critical` alrededor de cada número generado
   - b) **✔ Un array de semillas indexado por `omp_get_thread_num()`; cada hilo carga la suya en una variable privada** — "misma idea, otra herramienta" (threadprivate no está soportado)
   - c) Usar `firstprivate(np.random)`
   - d) Generar todos los números antes de la región paralela
3. ¿Por qué `parallel` y `for` van en directivas SEPARADAS en este ejemplo?
   - a) Porque `parallel for` no existe en pyomp
   - b) **✔ Para que cada hilo inicialice su RNG (s = seeds[tid]) dentro de la región antes del worksharing del bucle** — mismo patrón de la figura 1 del paper de PyOMP
   - c) Para poder usar dos schedules distintos
   - d) Por claridad: es equivalente escribir parallel for
4. ¿A qué ritmo converge Monte Carlo según el info?
   - a) Error ~ 1/N
   - b) Error ~ log(N)/N
   - c) **✔ Error ~ 1/√N: con 10 millones de dardos apenas 3 decimales de π** — por eso estos métodos necesitan paralelismo (más dardos = más precisión)
   - d) Converge en un número fijo de iteraciones
5. ¿Qué advertencia hace el info sobre las semillas por hilo?
   - a) Deben ser números primos
   - b) **✔ Semillas distintas no garantizan matemáticamente que las secuencias no se solapen; para eso existe leapfrog, y en producción generadores con streams (Philox, PCG)** — "para aprender basta; para un paper de verdad" usar streams independientes
   - c) Deben regenerarse en cada iteración
   - d) La semilla 0 rompe el LCG

---

### 4.10 `tareas/piTask.py` (infoPiTask.md)

**Resumen del info:** El mismo π pero con el TERCER patrón de PyOMP: **divide y vencerás con tareas**. El problema se parte recursivamente en mitades; cada mitad es una "task" que va a una bolsa común y los hilos libres las toman. Las tasks paralelizan lo que NO es un bucle regular: recursión, árboles, listas, trabajo dinámico. Claves: `MIN_BLK` = umbral del caso base (crear una task cuesta; SIEMPRE poner umbral en paralelismo recursivo); `task shared(sum1) firstprivate(nstart, mid, step)` — shared para que el resultado se vea fuera, firstprivate para capturar los valores "como una foto"; `taskwait` espera a las tareas hijas DIRECTAS (sin él, sum1+sum2 se calcularía antes de tiempo → basura); combo mágico `parallel`+`single`: parallel crea el equipo, single hace que UN hilo siembre el árbol (si no, cada hilo crearía SU árbol = trabajo repetido); los demás hilos están en la barrera del single robando tareas. Output real: pi = 3.141592653589794, mismo resultado que `for/` y `spmd/` — tres caminos, misma respuesta; con esto se cubren los 3 patrones del paper. Nota pyomp 0.5.x: task, taskwait y shared/private/firstprivate/default en task SÍ; taskloop, taskgroup, task depend, taskyield y cláusulas if/final/priority/untied NO.

**Quiz:**

1. ¿Para qué sirve el umbral `MIN_BLK` en el paralelismo recursivo?
   - a) Para limitar la memoria de la pila
   - b) **✔ Crear una task cuesta; si el trozo es pequeño conviene sumarlo secuencialmente — "SIEMPRE pon umbral en paralelismo recursivo"** — regla literal del info
   - c) Para garantizar precisión numérica
   - d) Para que taskwait no espere de más
2. En `task shared(sum1) firstprivate(nstart, mid, step)`, ¿por qué sum1 es shared y los límites firstprivate?
   - a) Es arbitrario: podrían intercambiarse
   - b) **✔ shared(sum1) porque el resultado debe verse fuera de la tarea; firstprivate para que la tarea capture los valores de los límites EN ESE MOMENTO (como una foto)** — explicación literal del info
   - c) shared es más rápido para floats
   - d) firstprivate evita que la task se ejecute dos veces
3. ¿Qué pasaría sin el `taskwait`?
   - a) Las tareas hijas nunca se ejecutarían
   - b) **✔ Se haría `sum1 + sum2` antes de que las tareas hijas terminen de calcularlos → resultado basura** — el info lo dice explícitamente
   - c) Deadlock inmediato
   - d) pyomp lanza error de compilación
4. ¿Por qué el árbol de tareas se siembra dentro de `single`?
   - a) Porque task solo puede llamarse desde un hilo maestro
   - b) **✔ Para que UN solo hilo cree el árbol; si no, cada hilo crearía SU árbol completo = trabajo repetido. Los demás hilos no están ociosos: roban tareas desde la barrera del single** — el "combo mágico" del info
   - c) Para medir el tiempo con precisión
   - d) Porque single tiene menos overhead que master
5. ¿Cuál de estas features de tasking SÍ está soportada en pyomp 0.5.x?
   - a) `taskloop`
   - b) `task depend(in: x)`
   - c) **✔ `task` con shared/private/firstprivate/default y `taskwait`** — verificado en tests oficiales según el info; taskloop/taskgroup/depend/taskyield NO
   - d) `taskgroup`

---

### 4.11 `fibonacciTareas/fibonacciTareas.py` (infoFibonacciTareas.md)

**Resumen del info:** Fibonacci recursivo con tareas: EL ejemplo canónico de tasking del documento oficial "OpenMP Examples" (capítulo tasking). Cada fib(n) crea dos tareas (fib(n-1), fib(n-2)) y espera con taskwait — el árbol de llamadas se convierte en árbol de tareas. Es la versión "pura" del concepto que piTask aplica a un problema numérico. Claves: `UMBRAL = 20` — fib(15) tarda nanosegundos, el overhead de crear/encolar/robar una task es mayor que el cálculo; sin umbral el programa sería MÁS LENTO que el secuencial ("bájalo a 2 y mira"); `taskwait` espera solo a las hijas DIRECTAS, no a los nietos (cada nivel del árbol espera al suyo); de nuevo el combo parallel+single. Output real: fib(10)=55, fib(20)=6765, fib(30)=832040, fib(35)=9227465 (correctos). Gracia pedagógica: el árbol es IRREGULAR (la rama n-1 es mucho más grande que la n-2); un `parallel for` no puede repartirlo porque no hay bucle; las tasks se balancean solas porque los hilos ROBAN trabajo de la bolsa cuando quedan libres (work stealing).

**Quiz:**

1. ¿Qué pasaría si se baja el UMBRAL de 20 a 2?
   - a) El resultado de fib sería incorrecto
   - b) **✔ El programa sería MÁS LENTO que el secuencial: el overhead de crear/encolar/robar tasks diminutas supera el cálculo** — el info invita a probarlo
   - c) Se agotaría la memoria
   - d) No cambiaría nada
2. ¿A quién espera exactamente `taskwait`?
   - a) A todas las tareas del programa
   - b) **✔ Solo a las tareas hijas DIRECTAS, no a los nietos — cada nivel del árbol espera al suyo** — matiz explícito del info ("Ojo")
   - c) A todos los hilos del equipo (como barrier)
   - d) Al hilo 0
3. ¿Por qué un `parallel for` no sirve para este problema?
   - a) Porque fib usa enteros
   - b) **✔ Porque el árbol de llamadas es irregular y NO hay bucle que repartir; las tasks se balancean solas por work stealing** — la "gracia pedagógica" del info
   - c) Porque numba no compila for con recursión
   - d) Porque el for no admite reduction de enteros
4. ¿De dónde proviene este ejemplo según el info?
   - a) Del tutorial de LLNL
   - b) Del paper de PyOMP
   - c) **✔ Del documento oficial "OpenMP Application Programming Interface Examples", capítulo tasking** — es EL ejemplo canónico de tasking
   - d) Del libro de Tim Mattson, ejercicio 3

---

### 4.12 `stencilCalor/calorStencil.py` (infoCalorStencil.md)

**Resumen del info:** Difusión de calor 2D (stencil de 5 puntos, método de Jacobi): borde superior a 100°, cada celda toma el promedio de sus 4 vecinas en cada paso. Primera SIMULACIÓN FÍSICA ITERATIVA real. Concepto nuevo: **sincronización entre pasos de tiempo** — nadie empieza el paso t+1 hasta que TODOS terminan el t (barreras). Claves: `u` y `u_new` = doble buffer (leer de u, escribir en u_new; con una sola malla se leerían valores ya actualizados → física incorrecta); UNA sola región `parallel` para toda la simulación, el bucle de tiempo lo ejecutan TODOS los hilos replicado y lo que se reparte es el trabajo de cada paso con `for` huérfanos (worksharing dentro de la región); cada `for` tiene BARRERA IMPLÍCITA al final — ahí se esperan los hilos entre pasos; la copia u_new→u también en paralelo con su propia barrera; versión serial para validar (np.allclose) y comparar. Output real (1500×1500, 200 pasos, 8 núcleos): paralelo 0.912 s vs serial 0.989 s → **speedup ~1.1x, y ESA es la lección**: el stencil hace 4 sumas por celda pero lee 4 vecinas de RAM → limitado por ANCHO DE BANDA DE MEMORIA (memory-bound), los 8 núcleos se pelean el bus. Comparar con transporteParticulas (compute-bound, 8x). "Memory-bound vs compute-bound decide si vale la pena paralelizar." Nota pyomp: `nowait` para quitar la barrera del primer for NO es confiable — mandan las barreras implícitas.

**Quiz:**

1. ¿Por qué se usan DOS mallas (u y u_new)?
   - a) Para ahorrar memoria caché
   - b) **✔ Doble buffer: se lee de u y se escribe en u_new; con una sola malla se leerían valores ya actualizados del mismo paso → física incorrecta** — explicación literal del info
   - c) Porque numba no permite escribir el array que se lee
   - d) Para poder usar reduction sobre la malla
2. ¿Qué sincroniza a los hilos entre pasos de tiempo?
   - a) Un `barrier` explícito después de cada paso
   - b) `taskwait` al final del bucle
   - c) **✔ La BARRERA IMPLÍCITA al final de cada `with openmp("for")`: nadie sigue hasta que u_new está completa** — clave del ejemplo; nowait (que la quitaría) no es confiable en pyomp 0.5.x
   - d) Un critical alrededor del bucle de tiempo
3. ¿Cómo se organiza la región paralela respecto al bucle de tiempo?
   - a) Se abre una región parallel nueva en cada paso
   - b) **✔ UNA sola región parallel para toda la simulación: el bucle de tiempo lo ejecutan TODOS los hilos replicado, y los `for` huérfanos reparten el trabajo de cada paso** — patrón del info
   - c) El bucle de tiempo se paraleliza con parallel for
   - d) Solo el hilo 0 ejecuta el bucle de tiempo (single)
4. Speedup de ~1.1x con 8 núcleos. ¿Por qué?
   - a) El JIT no optimizó el bucle interno
   - b) Falta schedule(dynamic) para balancear
   - c) **✔ El stencil es memory-bound: solo 4 sumas y 1 multiplicación por celda pero lee 4 vecinas de RAM; los 8 núcleos compiten por el mismo bus de memoria** — "la leccion mas valiosa del ejemplo: no todo escala"
   - d) Las barreras consumen el 90% del tiempo
5. ¿Con qué se valida la versión paralela?
   - a) Con la fórmula analítica de difusión
   - b) **✔ Con `np.allclose` contra la versión serial idéntica (difusion_calor_serial)** — misma física sin OpenMP, imprime "paralelo == serial? True"
   - c) Con la temperatura promedio de la placa
   - d) Comparando contra scipy

---

### 4.13 `transporteParticulas/transporteMonteCarlo.py` (infoTransporteMonteCarlo.md)

**Resumen del info:** Un SIMULADOR de verdad: transporte de partículas Monte Carlo a través de una placa (slab) 1D — el "hola mundo" del transporte de radiación. Es EL ejemplo más cercano a la tesis: el código real MCDC-TNT (transporte de neutrones, Oregon State / proyecto CEMeNT) usa PyOMP en producción con exactamente este patrón. Física simplificada: distancia al próximo choque `dist = -ln(r)/sigma_t` (exponencial, camino libre medio 1/σt); avance x += mu·dist (mu = coseno de dirección); x<0 → REFLEJADA, x>espesor → TRANSMITIDA, si no chocó dentro: con prob_abs → ABSORBIDA, si no → dispersión isotrópica (mu aleatorio en [-1,1]). El OpenMP combina TODO lo anterior: `parallel private(...)` con estado de partícula privado (como entornoDatos), RNG privado por hilo con seeds[tid] (el truco de monteCarloPi), `for reduction(+:transmitidas, reflejadas, absorbidas)` — reducción sobre TRES contadores a la vez (se puede poner lista); el `while viva` dentro del for = carga irregular (cada partícula vive un número impredecible de choques) que aun así escala porque hay millones de partículas por hilo (la irregularidad se promedia). Output real (5M partículas, espesor 5, 30% absorción): 0.726/0.256/0.173/0.091 s con 1/2/4/8 hilos → **escala 8x**; física estable (~2.35% transmitidas, ~20.85% reflejadas, ~76.8% absorbidas; variación en el 2º decimal por semillas distintas = variación estadística normal de Monte Carlo).

**Quiz:**

1. ¿Por qué este ejemplo escala 8x mientras el stencil apenas 1.1x?
   - a) Porque usa más hilos
   - b) **✔ Monte Carlo es compute-bound: mucho cálculo por cada byte de memoria tocado; el stencil es memory-bound** — comparación explícita del info: "los simuladores Monte Carlo son el caso ideal para OpenMP"
   - c) Porque el stencil usa doble buffer
   - d) Porque reduction es más rápida que barrier
2. ¿Cómo se muestrea la distancia hasta el próximo choque?
   - a) Uniforme en [0, espesor]
   - b) **✔ `dist = -ln(r)/sigma_t`: distribución exponencial con camino libre medio 1/σt** — física literal del info
   - c) Gaussiana centrada en 1/σt
   - d) Constante = espesor/número de choques
3. ¿Qué demuestra la cláusula `reduction(+:transmitidas, reflejadas, absorbidas)`?
   - a) Que reduction solo acepta un máximo de 3 variables
   - b) **✔ Que se puede hacer reducción sobre VARIOS contadores a la vez (lista de variables)** — el info lo destaca: "si, se puede poner una lista"
   - c) Que las variables deben ser floats
   - d) Que reduction reemplaza a critical siempre
4. Cada partícula vive un número distinto de choques (`while viva`). ¿Por qué escala igual de bien?
   - a) Porque schedule(dynamic) rebalancea
   - b) **✔ Porque hay millones de partículas por hilo: la irregularidad se promedia** — el info: "carga irregular, y aun asi escala perfecto"
   - c) Porque el while se paraleliza internamente
   - d) Porque taskwait redistribuye las partículas
5. ¿Por qué los porcentajes varían en el 2º decimal entre corridas con distinto número de hilos?
   - a) Es un data race residual sobre los contadores
   - b) **✔ Cada hilo usa semillas distintas: es variación estadística normal y esperada de Monte Carlo** — el info lo aclara: la física es estable entre corridas
   - c) Redondeo de floats de 32 bits
   - d) El JIT reordena las operaciones

---

### 4.14 `sumaVectoresGPU/sumaVectoresGPU.py` (infoSumaVectoresGPU.md)

**Resumen del info:** Suma de vectores EN LA GPU con `target`: el mismo código Python pero el bucle corre en los miles de núcleos de la tarjeta. Ejemplo canónico de "offloading" (README oficial de PyOMP + docs). Semántica: `target` = ejecuta el bloque en el dispositivo; `teams distribute` = en GPU no hay UN equipo de hilos como en CPU, hay muchos equipos (bloques CUDA) — teams los crea, distribute reparte el bucle entre equipos; `parallel for` = paraleliza entre los hilos de cada equipo; `map(to: a, b)` = copia host→GPU al entrar (solo lectura); `map(tofrom: c)` = copia al entrar Y devuelve al salir (ahí viene el resultado). "El mapeo de datos es EL concepto central de GPU: la GPU tiene SU propia memoria, y mover datos por el PCIe suele costar más que el cálculo mismo." **Estado: NO PROBADO en la máquina del repo** — falló con `FileNotFoundError: 'x86_64-linux-gnu-gcc'` / `RuntimeError: Compilation failed for trampolines` (WSL2 + GTX 1660 con driver CUDA 13.1 OK, pero sin gcc). Requisitos: GPU NVIDIA (AMD "work in progress", macOS sin GPU) + Linux (WSL2 vale con driver NVIDIA en Windows) + gcc; los ejemplos CPU no necesitan nada de esto.

**Quiz:**

1. ¿Qué hace la cláusula `map(tofrom: c)`?
   - a) Copia c a la GPU solo al entrar
   - b) Copia c al host solo al salir
   - c) **✔ Copia c del host a la GPU al entrar Y de vuelta al host al salir — ahí viene el resultado** — explicación literal del info
   - d) Crea un alias de c en memoria unificada
2. ¿Por qué en GPU se necesita `teams distribute` además de `parallel for`?
   - a) Es redundante: teams es un alias de parallel
   - b) **✔ En GPU no hay UN equipo de hilos como en CPU sino muchos equipos (bloques CUDA); teams los crea y distribute reparte el bucle entre equipos; parallel for paraleliza dentro de cada equipo** — jerarquía de dos niveles explicada en el info
   - c) Para poder usar map
   - d) Para activar la memoria compartida de la GPU
3. Según el info, ¿cuál es EL concepto central de la programación GPU?
   - a) Lanzar tantos hilos como sea posible
   - b) **✔ El mapeo de datos: la GPU tiene su propia memoria y mover datos por el PCIe suele costar más que el cálculo mismo** — cita casi literal
   - c) Usar floats de 16 bits
   - d) Evitar los condicionales en los kernels
4. ¿Qué requisitos tiene este ejemplo en pyomp 0.5.x?
   - a) Solo tener CUDA Toolkit instalado
   - b) Cualquier GPU (NVIDIA o AMD) en cualquier SO
   - c) **✔ GPU NVIDIA + Linux (incluye WSL2 con driver NVIDIA en Windows) + gcc instalado en el sistema** — AMD es "work in progress" y macOS no tiene soporte GPU
   - d) Ninguno: sin GPU cae automáticamente a CPU
5. ¿Qué pasó al ejecutarlo en la máquina del repo (GPU GTX 1660 presente, driver OK)?
   - a) Corrió pero 10x más lento que la CPU
   - b) **✔ Falló con `FileNotFoundError: 'x86_64-linux-gnu-gcc'` porque pyomp necesita un compilador C del sistema para generar el código de offload** — el ejemplo quedó marcado "NO PROBADO"
   - c) Corrió correctamente e imprimió "correcto? True"
   - d) Se colgó en el map de datos

---

## 5. requirements.txt e instrucciones de instalación/ejecución

### Versiones

- `requirements.txt` (raíz): `pyomp==0.5.*` (una sola línea)
- `primerEjemplo/requirements.txt`: `pyomp==0.5.*` (duplicado, mismo contenido)
- **Versiones exactas instaladas en el `.venv` del repo** (verificadas en site-packages): `pyomp 0.5.1`, `numba 0.63.1`, `llvmlite 0.46.0`, `numpy 2.3.5`, `lark 1.3.1`, `cffi 2.0.0`, `pycparser 3.0` (+ pip 24.0, setuptools 82.0.1), sobre Python 3.12.
- El README declara: probado con **Python 3.12.3 + pyomp 0.5.1 + numba 0.63.1 en WSL2 (8 núcleos)**. pyomp trae su numba y llvmlite compatibles (no instalar numba aparte).
- Plataformas soportadas por pyomp 0.5.x: Python 3.10–3.14 en linux-64, linux-arm64 y osx-arm64.

### Instalación (del README)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "pyomp==0.5.*"
```

### Ejecución (del README)

```bash
.venv/bin/python spmd/piSpmd.py
# controlar hilos desde fuera (si el ejemplo no los fija con omp_set_num_threads):
OMP_NUM_THREADS=4 .venv/bin/python primerEjemplo/helloOpenMP.py
```

- `OMP_NUM_THREADS` solo tiene efecto en ejemplos que NO fijan hilos por código. Fijan hilos por código (ignoran la variable para sus mediciones): `spmd/`, `spmdCritical/`, `monteCarloPi/`, `transporteParticulas/` (via `omp_set_num_threads(...)`) y `entornoDatos/` (via cláusula `num_threads(4)`). Respetan `OMP_NUM_THREADS`/nproc: `primerEjemplo/`, `for/`, `sumaVectores/`, `matrices/`, `mandelbrot/`, `tareas/`, `fibonacciTareas/`, `stencilCalor/`, `sumaVectoresGPU/`.
- El ejemplo GPU además necesita: GPU NVIDIA + Linux/WSL2 + `sudo apt-get install gcc`.
- Regla JIT del README: primera llamada = compilación (lenta); los ejemplos que miden tiempo hacen warmup antes de medir.

---

## 6. Salida stdout de cada .py (formato real, para el parser del simulador)

Leyenda: "¿Mide su tiempo?" = el script imprime su propia medición (warmup incluido), por lo que el simulador puede parsear tiempos SIN cronometrar externamente. En todos los casos, el tiempo de pared externo del proceso incluye además la compilación JIT (segundos).

| # | Script | ¿Mide su tiempo? | Formato de salida (líneas exactas) |
|---|--------|------------------|-------------------------------------|
| 1 | `helloOpenMP.py` | NO | N líneas (N = nº hilos): `Hello from thread <int>` — **orden no determinista**; impresas desde código njit |
| 2 | `forOpenMP.py` | NO (y sin warmup) | 1 línea: `pi = <float>` (p.ej. `pi = 3.1415926535897523`) |
| 3 | `piSpmd.py` | SÍ (`omp_get_wtime` interno, con warmup) | 4 líneas: `hilos = <n> \| pi = <float> \| tiempo = <float> s` para n = 1, 2, 4, 8 |
| 4 | `piSpmdCritical.py` | SÍ (`omp_get_wtime`, con warmup) | 4 líneas, mismo formato que piSpmd: `hilos = <n> \| pi = <float> \| tiempo = <float> s` |
| 5 | `entornoDatos.py` | NO | 1 línea `[single] ya llegaron todos, zsh = 4` + 4 líneas `hilo <t> -> x privada = <int> \| zfp firstprivate = <int>` (**orden no determinista**, impresas desde njit) + 1 línea final `despues de la region: x = 100 \| zfp = 10 \| zsh = 4` |
| 6 | `sumaVectores.py` | SÍ (`time.perf_counter`, con warmup) | 3 líneas: `correcto? True` · `tiempo openmp: <float> s` · `tiempo numpy : <float> s` (ojo al espacio antes de los dos puntos en "numpy :") |
| 7 | `multiplicacionMatrices.py` | SÍ (`time.perf_counter`, con warmup) | 3 líneas: `correcto? True` · `tiempo openmp : <float> s` · `tiempo np.dot : <float> s (BLAS optimizado, la referencia a batir)` |
| 8 | `areaMandelbrot.py` | NO | 8 líneas: `area real aproximada ~ 1.506` · `con data race (3 corridas, mira como VARIA):` · 3× `  area = <float>` (**valores NO reproducibles**, varían por el race) · `con reduction (3 corridas, siempre igual):` · 3× `  area = <float>` (idénticas: 1.510363125) — las líneas `area =` llevan 2 espacios iniciales |
| 9 | `piMonteCarlo.py` | NO | 3 líneas: `dardos = <n> \| pi ~ <float>` para n = 100000, 1000000, 10000000 |
| 10 | `piTask.py` | NO (sin warmup) | 1 línea: `pi = <float>` (real: `pi = 3.141592653589794`) |
| 11 | `fibonacciTareas.py` | NO | 4 líneas: `fib( <n> ) = <int>` para n = 10, 20, 30, 35 (nótense los espacios dentro del paréntesis: `fib( 10 ) = 55`) |
| 12 | `calorStencil.py` | SÍ (`time.perf_counter`, con warmup de ambas versiones) | 4 líneas: `paralelo == serial? True` · `tiempo paralelo: <float> s` · `tiempo serial  : <float> s` (dos espacios antes de ":") · `temperatura cerca del borde caliente: <float>` |
| 13 | `transporteMonteCarlo.py` | SÍ (`omp_get_wtime`, con warmup; tiempo redondeado a 3 decimales con `round`) | 4 líneas: `hilos = <n> \| tiempo = <float> s \| transmitidas: <float> % \| reflejadas: <float> % \| absorbidas: <float> %` para n = 1, 2, 4, 8 (porcentajes con `round(x, 2)`) |
| 14 | `sumaVectoresGPU.py` | NO | Si funciona: 1 línea `correcto? True`. **Sin GPU+gcc: traceback con excepción** (`FileNotFoundError: 'x86_64-linux-gnu-gcc'` / `RuntimeError: Compilation failed for trampolines`) y exit code ≠ 0 |

### Implicaciones para el parser de tiempos del simulador

1. **Solo 6 scripts auto-miden**: `piSpmd.py`, `piSpmdCritical.py`, `sumaVectores.py`, `multiplicacionMatrices.py`, `calorStencil.py`, `transporteMonteCarlo.py`. Sus tiempos internos EXCLUYEN el JIT (hay warmup previo) y son los adecuados para gráficas de speedup. Patrones de parseo sugeridos: `tiempo = ([\d.]+) s` (piSpmd/piSpmdCritical/transporte, con prefijo `hilos = (\d+)`), `tiempo openmp\s*: ([\d.]+) s` / `tiempo numpy\s*: ([\d.]+) s` / `tiempo np\.dot\s*: ([\d.]+) s`, `tiempo paralelo: ([\d.]+) s` / `tiempo serial\s*: ([\d.]+) s`.
2. Los demás requieren cronometraje externo, pero el tiempo de pared incluye la compilación JIT (varios segundos), que domina sobre el cómputo en los ejemplos pequeños — no usar tiempo externo para speedup sin descontar el JIT.
3. Los scripts que imprimen desde dentro de `@njit` (`helloOpenMP.py`, `entornoDatos.py`) tienen **orden de líneas no determinista** (intercalado por hilos): el parser no debe asumir orden, solo conjunto de líneas.
4. `areaMandelbrot.py` produce a propósito valores no reproducibles en las 3 primeras corridas (esa ES la lección) — no tratarlo como error.
5. `piSpmd`/`piSpmdCritical`/`transporteMonteCarlo` ya barren 1/2/4/8 hilos internamente en una sola ejecución: el simulador obtiene la curva de escalado completa de un solo proceso, sin re-ejecutar con distintos `OMP_NUM_THREADS`.
6. Los valores π/fib/porcentajes sirven como verificación de corrección: `pi ≈ 3.14159…` (exactamente `3.141592653589794` en piTask), `fib(35) = 9227465`, `correcto? True`, `paralelo == serial? True` son asserts naturales de éxito.
7. `sumaVectoresGPU.py` debe ejecutarse con captura de stderr y tolerancia a exit code ≠ 0; en ausencia de GPU NVIDIA + gcc el fallo es esperado (deshabilitar por defecto en el simulador).
