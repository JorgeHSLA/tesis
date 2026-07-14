import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp


@njit
def suma_vectores(a, b):
    c = np.empty_like(a)
    n = a.size
    # schedule(static, 1000): reparte las iteraciones en bloques FIJOS de 1000
    # ojo: en pyomp 0.5.x solo funciona static (dynamic/guided no estan implementados)
    with openmp("parallel for schedule(static, 1000)"):
        for i in range(n):
            c[i] = a[i] + b[i]
    return c


N = 10_000_000
a = np.random.rand(N)
b = np.random.rand(N)

c = suma_vectores(a, b)  # warmup JIT

import time
t0 = time.perf_counter()
c = suma_vectores(a, b)
t1 = time.perf_counter()

print("correcto?", np.allclose(c, a + b))
print("tiempo openmp:", t1 - t0, "s")

t0 = time.perf_counter()
c_np = a + b
t1 = time.perf_counter()
print("tiempo numpy :", t1 - t0, "s")
