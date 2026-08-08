import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp

# Offloading a GPU con OpenMP target:
#   - target            = ejecuta este bloque en el dispositivo (GPU)
#   - teams distribute  = crea equipos de hilos y reparte el bucle entre ellos
#   - parallel for      = dentro de cada equipo, paraleliza entre sus hilos
#   - map(to:...)       = copia host -> GPU al entrar
#   - map(tofrom:...)   = copia host -> GPU al entrar y GPU -> host al salir
#
# REQUISITOS: GPU NVIDIA + Linux (pyomp 0.5.x solo soporta eso; AMD y macOS no).


@njit
def suma_vectores_gpu(a, b, c, n):
    with openmp("target teams distribute parallel for map(to: a, b) map(tofrom: c)"):
        for i in range(n):
            c[i] = a[i] + b[i]


N = 1_000_000
a = np.random.rand(N)
b = np.random.rand(N)
c = np.zeros(N)

suma_vectores_gpu(a, b, c, N)
print("correcto?", np.allclose(c, a + b))
