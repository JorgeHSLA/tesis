import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_thread_num, omp_get_num_threads
from numba.openmp import omp_set_num_threads, omp_get_wtime


@njit
def calc_pi_spmd(num_steps, num_threads):
    omp_set_num_threads(num_threads)
    step = 1.0 / num_steps
    partial = np.zeros(num_threads)  # una casilla de suma parcial por hilo

    t0 = omp_get_wtime()
    with openmp("parallel private(tid, nths, x, i) shared(partial)"):
        tid = omp_get_thread_num()
        nths = omp_get_num_threads()
        # reparto ciclico manual: el hilo tid toma i = tid, tid+nths, tid+2*nths...
        for i in range(tid, num_steps, nths):
            x = (i + 0.5) * step
            partial[tid] += 4.0 / (1.0 + x * x)
    elapsed = omp_get_wtime() - t0

    total = 0.0
    for t in range(num_threads):
        total += partial[t]
    return step * total, elapsed


calc_pi_spmd(1000, 1)  # warmup: fuerza la compilacion JIT antes de medir

for nths in (1, 2, 4, 8):
    pi, secs = calc_pi_spmd(10_000_000, nths)
    print("hilos =", nths, "| pi =", pi, "| tiempo =", secs, "s")
