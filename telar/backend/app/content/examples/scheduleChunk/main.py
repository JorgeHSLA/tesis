import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_max_threads, omp_get_thread_num


@njit
def duenos_bloque(n):
    dueno = np.empty(n, dtype=np.int64)
    with openmp("parallel for schedule(static)"):
        for i in range(n):
            dueno[i] = omp_get_thread_num()
    return dueno


@njit
def duenos_ciclico(n):
    dueno = np.empty(n, dtype=np.int64)
    with openmp("parallel for schedule(static, 1)"):
        for i in range(n):
            dueno[i] = omp_get_thread_num()
    return dueno


@njit
def carga_bloque(n):
    # la iteracion i cuesta i unidades de trabajo: las ultimas son las mas caras
    carga = np.zeros(omp_get_max_threads(), dtype=np.int64)
    with openmp("parallel for schedule(static)"):
        for i in range(n):
            carga[omp_get_thread_num()] += i
    return carga


@njit
def carga_ciclico(n):
    carga = np.zeros(omp_get_max_threads(), dtype=np.int64)
    with openmp("parallel for schedule(static, 1)"):
        for i in range(n):
            carga[omp_get_thread_num()] += i
    return carga


print("Quien hace cada iteracion (12 iteraciones):")
print("  schedule(static):    ", duenos_bloque(12))
print("  schedule(static, 1): ", duenos_ciclico(12))
print("Trabajo por hilo si la iteracion i cuesta i (1000 iteraciones):")
print("  schedule(static):    ", carga_bloque(1000))
print("  schedule(static, 1): ", carga_ciclico(1000))
