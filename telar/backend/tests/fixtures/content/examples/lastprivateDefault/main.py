import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp


@njit
def con_lastprivate(n):
    x = -1
    with openmp("parallel for lastprivate(x)"):
        for i in range(n):
            x = i * i
    return x


@njit
def con_private(n):
    x = -1
    with openmp("parallel for private(x)"):
        for i in range(n):
            x = i * i
    return x


@njit
def escalar(a, factor):
    n = a.shape[0]
    with openmp("parallel for default(shared)"):
        for i in range(n):
            a[i] = a[i] * factor


print("lastprivate(x): x =", con_lastprivate(10))
print("private(x):     x =", con_private(10))

a = np.arange(1.0, 6.0)
escalar(a, 10.0)
print("default(shared): a =", a)
