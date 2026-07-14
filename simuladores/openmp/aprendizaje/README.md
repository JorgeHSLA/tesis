# Aprendizaje de OpenMP en Python (PyOMP)

Repositorio educativo de mi tesis sobre simuladores/aprendizaje de OpenMP.
Todos los ejemplos usan **PyOMP** (`numba.openmp`): directivas OpenMP reales
escritas en Python, compiladas a codigo maquina con Numba (`@njit`).

```python
from numba.openmp import njit
from numba.openmp import openmp_context as openmp

@njit
def f():
    with openmp("parallel for reduction(+:suma)"):
        for i in range(n):
            ...
```

La sintaxis dentro del string es LA MISMA de OpenMP en C/C++ — lo que se
aprende aqui se transfiere directo a C.

## Como se implemento este repo

1. **Entorno**: un venv con `pyomp==0.5.*` (que trae su numba y llvmlite
   compatibles). Ver [Instalacion](#instalacion).
2. **Estructura**: una carpeta por ejemplo, con el `.py` ejecutable y un
   `info*.md` que explica linea a linea y pega el output real de esta maquina.
3. **Verificacion**: cada ejemplo paralelo se valida contra una version
   confiable (formula exacta, `np.allclose` contra numpy o version serial) y
   se cronometra con `omp_get_wtime()` o `time.perf_counter()`.
4. **Compatibilidad**: los ejemplos usan SOLO directivas verificadas contra
   los tests del repo oficial de PyOMP (ver tabla de soporte abajo). Ejemplos
   clasicos que dependen de features no implementadas (`sections`, `atomic`,
   `schedule(dynamic)`, producer-consumer con `flush`) se descartaron o se
   adaptaron.
5. **Regla de patron JIT**: primera llamada = compilacion (lenta). Todos los
   ejemplos hacen una llamada de "warmup" antes de medir tiempos.

## Ruta de aprendizaje (en orden)

| # | Carpeta | Concepto que enseña | Directivas clave | Probado |
|---|---------|--------------------|------------------|---------|
| 1 | `primerEjemplo/` | hola mundo paralelo, identidad del hilo | `parallel`, `omp_get_thread_num` | ✅ |
| 2 | `for/` | worksharing con reduccion (pi) | `parallel for reduction(+:) schedule(static)` | ✅ |
| 3 | `spmd/` | patron SPMD: repartir trabajo a mano + false sharing | `parallel private/shared`, `omp_get_wtime` | ✅ |
| 4 | `spmdCritical/` | arreglar el false sharing; exclusion mutua | `critical` | ✅ |
| 5 | `entornoDatos/` | private vs firstprivate vs shared + sincronizacion | `private`, `firstprivate`, `shared`, `barrier`, `single`, `critical` | ✅ |
| 6 | `sumaVectores/` | worksharing sobre arrays NumPy, reparto de iteraciones | `parallel for schedule(static, N)` | ✅ |
| 7 | `matrices/` | bucles anidados: que paralelizar y que privatizar | `parallel for private(j,k,tmp)` | ✅ |
| 8 | `mandelbrot/` | DATA RACES: version rota vs version correcta | `reduction` vs race sin proteger | ✅ |
| 9 | `monteCarloPi/` | numeros aleatorios en paralelo (RNG por hilo) | `parallel` + `for reduction` separados | ✅ |
| 10 | `tareas/` | divide y venceras con tareas (pi recursivo) | `task`, `taskwait`, `single` | ✅ |
| 11 | `fibonacciTareas/` | arbol de tareas irregular, umbral de corte | `task firstprivate/shared`, `taskwait` | ✅ |
| 12 | `stencilCalor/` | simulacion iterativa (difusion de calor 2D); memory-bound | `parallel` + `for` huerfanos, barreras | ✅ |
| 13 | `transporteParticulas/` | simulador Monte Carlo real (transporte en slab); compute-bound | todo lo anterior combinado | ✅ escala 8x |
| 14 | `sumaVectoresGPU/` | offloading a GPU y mapeo de datos | `target teams distribute parallel for`, `map` | ⚠️ requiere gcc |

Los ejemplos 3-4, 12-13 forman parejas pedagogicas: SPMD lento→rapido
(false sharing) y memory-bound→compute-bound (que escala y que no).

Con 2 (`for/`), 3 (`spmd/`) y 10 (`tareas/`) el repo cubre los **3 patrones de
diseño del paper de PyOMP**: loop-level, SPMD y divide-y-venceras.

## Instalacion

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "pyomp==0.5.*"
```

pyomp 0.5.x soporta Python 3.10-3.14 en linux-64, linux-arm64 y osx-arm64.
Este repo se probo con Python 3.12.3 + pyomp 0.5.1 + numba 0.63.1 en WSL2 (8 nucleos).

Ejecutar cualquier ejemplo:

```bash
.venv/bin/python spmd/piSpmd.py
# controlar hilos desde fuera (si el ejemplo no los fija con omp_set_num_threads):
OMP_NUM_THREADS=4 .venv/bin/python primerEjemplo/helloOpenMP.py
```

El ejemplo GPU ademas necesita: GPU NVIDIA + Linux/WSL2 + `sudo apt-get install gcc`.

## Que soporta pyomp 0.5.x (verificado contra los tests oficiales)

Fuente: [docs oficiales](https://pyomp.readthedocs.io) y la
[suite de tests](https://github.com/Python-for-HPC/PyOMP/blob/main/src/numba/openmp/tests/test_openmp.py)
del repo (lo no implementado esta marcado con skip "Unimplemented").

**SI funciona:**
`parallel`, `for`, `parallel for`, `reduction(+,-,*)`, `schedule(static)` y
`schedule(static, N)` con N constante, `critical` (sin nombre), `barrier`,
`single`, `task`, `taskwait`, `private`, `shared`, `firstprivate`,
`lastprivate`, `default(none)`, `num_threads`, `if` (constante),
`teams`/`distribute`/`target`/`map` (GPU NVIDIA en Linux), y las funciones
`omp_get_thread_num`, `omp_get_num_threads`, `omp_set_num_threads`,
`omp_get_max_threads`, `omp_get_wtime`, `omp_in_parallel`, etc.

**NO funciona (no lo intentes, falla o aborta):**
`atomic`, `master`, `sections`, `taskloop`, `taskgroup`, `task depend`,
`ordered`, `flush`, `threadprivate`, `copyin`, `copyprivate`,
`schedule(dynamic)`, `schedule(guided)`, `critical(nombre)`, `simd`,
`collapse` en CPU (los docs dicen que si, pero el test esta skipped — no fiarse),
`nowait` (no confiable).

Sustitutos practicos: `atomic` → `critical` o `reduction`; `master` → `single`;
`sections` → tasks o ramas por `omp_get_thread_num()`; `threadprivate` → array
indexado por numero de hilo (ver `monteCarloPi/`).

## Fuentes de los ejemplos

- Repo oficial PyOMP: https://github.com/Python-for-HPC/PyOMP
- Ejercicios Python del libro *The OpenMP Common Core* (Tim Mattson): https://github.com/tgmattso/OmpCommonCore
- Tutorial intro de Mattson (C): https://github.com/tgmattso/OpenMP_intro_tutorial
- Tutorial LLNL: https://hpc-tutorials.llnl.gov/openmp/
- Ejercicios EPCC/ARCHER2: https://github.com/EPCCed/archer2-openmp-2022-08-30
- OpenMP Examples oficial: https://github.com/OpenMP/Examples
- Paper PyOMP (CiSE 2021): https://www.osti.gov/pages/servlets/purl/1843562
- Paper PyOMP CPU+GPU (SC24): https://www.osti.gov/servlets/purl/2479018
- Simulador real con PyOMP (transporte de neutrones): https://github.com/SoftwareDevEngResearch/mcdc_tnt
- Video de presentacion de PyOMP: https://www.youtube.com/watch?v=MLkZGEMpriY
