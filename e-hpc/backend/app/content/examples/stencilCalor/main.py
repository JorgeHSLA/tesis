import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp

# Difusion de calor 2D (stencil de 5 puntos, metodo de Jacobi):
# una placa fria con un borde caliente; en cada paso, cada celda toma el
# promedio de sus 4 vecinas. Aplicacion iterativa REAL con sincronizacion
# entre pasos: nadie puede empezar el paso t+1 hasta que todos acaben el t.


@njit
def difusion_calor(n, pasos):
    u = np.zeros((n, n))
    u_new = np.zeros((n, n))
    u[0, :] = 100.0      # borde superior caliente
    u_new[0, :] = 100.0

    with openmp("parallel private(paso, i, j)"):
        # el bucle de tiempo lo ejecutan TODOS los hilos (replicado);
        # lo que se reparte es el trabajo de cada paso (los "for")
        for paso in range(pasos):
            with openmp("for"):
                for i in range(1, n - 1):
                    for j in range(1, n - 1):
                        u_new[i, j] = 0.25 * (u[i - 1, j] + u[i + 1, j]
                                              + u[i, j - 1] + u[i, j + 1])
            # el "for" de arriba tiene barrera implicita al final:
            # nadie sigue hasta que u_new este completa
            with openmp("for"):
                for i in range(1, n - 1):
                    for j in range(1, n - 1):
                        u[i, j] = u_new[i, j]
            # otra barrera implicita antes del siguiente paso de tiempo
    return u


@njit
def difusion_calor_serial(n, pasos):
    u = np.zeros((n, n))
    u_new = np.zeros((n, n))
    u[0, :] = 100.0
    u_new[0, :] = 100.0
    for paso in range(pasos):
        for i in range(1, n - 1):
            for j in range(1, n - 1):
                u_new[i, j] = 0.25 * (u[i - 1, j] + u[i + 1, j]
                                      + u[i, j - 1] + u[i, j + 1])
        for i in range(1, n - 1):
            for j in range(1, n - 1):
                u[i, j] = u_new[i, j]
    return u


import time

# ojo: el stencil esta limitado por ANCHO DE BANDA DE MEMORIA, no por CPU:
# cada celda hace solo 4 sumas y 1 multiplicacion pero lee 4 vecinas de RAM.
# Por eso el speedup con hilos es modesto (los 8 nucleos compiten por el
# mismo bus de memoria). Leccion importante de HPC: no todo escala.
N = 1500
PASOS = 200

u_par = difusion_calor(N, PASOS)          # warmup JIT
u_ser = difusion_calor_serial(N, PASOS)   # warmup JIT
print("paralelo == serial?", np.allclose(u_par, u_ser))

t0 = time.perf_counter()
difusion_calor(N, PASOS)
print("tiempo paralelo:", time.perf_counter() - t0, "s")

t0 = time.perf_counter()
difusion_calor_serial(N, PASOS)
print("tiempo serial  :", time.perf_counter() - t0, "s")

print("temperatura cerca del borde caliente:", u_par[10, N // 2])
