import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_max_threads, omp_get_thread_num


@njit
def sin_collapse(filas, cols):
    trabajo = np.zeros(omp_get_max_threads(), dtype=np.int64)
    with openmp("parallel for private(j)"):
        for i in range(filas):
            for j in range(cols):
                trabajo[omp_get_thread_num()] += 1
    return trabajo


@njit
def con_collapse(filas, cols):
    trabajo = np.zeros(omp_get_max_threads(), dtype=np.int64)
    with openmp("parallel for collapse(2)"):
        for i in range(filas):
            for j in range(cols):
                trabajo[omp_get_thread_num()] += 1
    return trabajo


FILAS, COLS = 3, 1000
print(f"Matriz de {FILAS} filas x {COLS} columnas, {omp_get_max_threads()} hilos")
print("Iteraciones por hilo sin collapse:", sin_collapse(FILAS, COLS))
print("Iteraciones por hilo con collapse:", con_collapse(FILAS, COLS))
