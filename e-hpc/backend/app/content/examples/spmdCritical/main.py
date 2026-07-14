from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_thread_num, omp_get_num_threads
from numba.openmp import omp_set_num_threads, omp_get_wtime


@njit
def calc_pi_spmd_critical(num_steps, num_threads):
    omp_set_num_threads(num_threads)
    step = 1.0 / num_steps
    total = 0.0

    t0 = omp_get_wtime()
    with openmp("parallel private(tid, nths, x, i, local_sum) shared(total)"):
        tid = omp_get_thread_num()
        nths = omp_get_num_threads()
        local_sum = 0.0  # acumulador PRIVADO: cada hilo suma en su propia variable
        for i in range(tid, num_steps, nths):
            x = (i + 0.5) * step
            local_sum += 4.0 / (1.0 + x * x)
        # solo UNA operacion protegida por hilo, al final (no una por iteracion)
        with openmp("critical"):
            total += local_sum
    elapsed = omp_get_wtime() - t0

    return step * total, elapsed


calc_pi_spmd_critical(1000, 1)  # warmup JIT

for nths in (1, 2, 4, 8):
    pi, secs = calc_pi_spmd_critical(10_000_000, nths)
    print("hilos =", nths, "| pi =", pi, "| tiempo =", secs, "s")
