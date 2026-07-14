import time
import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp


@njit
def matmul_omp(A, B):
    n = A.shape[0]
    m = B.shape[1]
    kdim = A.shape[1]
    C = np.zeros((n, m))
    # se paraleliza el bucle EXTERNO (i); j, k y tmp deben ser privados
    # porque cada hilo los usa para su propia fila
    with openmp("parallel for private(j, k, tmp) schedule(static)"):
        for i in range(n):
            for j in range(m):
                tmp = 0.0
                for k in range(kdim):
                    tmp += A[i, k] * B[k, j]
                C[i, j] = tmp
    return C


N = 600
A = np.random.rand(N, N)
B = np.random.rand(N, N)

C = matmul_omp(A, B)  # warmup JIT
print("correcto?", np.allclose(C, A @ B))

t0 = time.perf_counter()
C = matmul_omp(A, B)
t1 = time.perf_counter()
print("tiempo openmp :", t1 - t0, "s")

t0 = time.perf_counter()
C_np = A @ B
t1 = time.perf_counter()
print("tiempo np.dot :", t1 - t0, "s (BLAS optimizado, la referencia a batir)")
