import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_thread_num, omp_set_num_threads

# pi por Monte Carlo: lanzamos "dardos" al cuadrado [0,1)x[0,1) y contamos
# cuantos caen dentro del cuarto de circulo -> pi ~ 4 * dentro / total.
# La leccion: cada hilo necesita SU PROPIO generador de numeros aleatorios.
# En C se usa threadprivate; pyomp no lo soporta, asi que usamos un array de
# semillas indexado por omp_get_thread_num() -> misma idea, otra herramienta.

A = np.uint64(1664525)        # constantes del generador congruencial (LCG)
C = np.uint64(1013904223)
MASK = np.uint64(0xFFFFFFFF)  # nos quedamos con 32 bits
DIV = 4294967296.0            # 2^32 para llevar el entero a [0,1)


@njit
def pi_monte_carlo(num_trials, num_threads):
    omp_set_num_threads(num_threads)
    seeds = np.empty(num_threads, dtype=np.uint64)
    for t in range(num_threads):
        seeds[t] = np.uint64(1234567 + 890123 * t)  # semilla distinta por hilo

    hits = 0
    with openmp("parallel private(tid, s, x, y) shared(seeds)"):
        tid = omp_get_thread_num()
        s = seeds[tid]  # estado del generador: PRIVADO de este hilo
        with openmp("for reduction(+:hits)"):
            for i in range(num_trials):
                s = (A * s + C) & MASK
                x = s / DIV
                s = (A * s + C) & MASK
                y = s / DIV
                if x * x + y * y <= 1.0:
                    hits += 1
    return 4.0 * hits / num_trials


pi_monte_carlo(1000, 1)  # warmup JIT

for n in (100_000, 1_000_000, 10_000_000):
    print("dardos =", n, "| pi ~", pi_monte_carlo(n, 4))
