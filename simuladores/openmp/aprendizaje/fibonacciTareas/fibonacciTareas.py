from numba.openmp import njit
from numba.openmp import openmp_context as openmp

# Fibonacci con tareas: EL ejemplo canonico de tasking del documento oficial
# "OpenMP Examples" (capitulo tasking). Cada llamada recursiva genera dos
# tareas; taskwait espera a las hijas antes de sumar.

UMBRAL = 20  # por debajo de esto, recursion secuencial (tasks diminutas = puro overhead)


@njit
def fib_serial(n):
    if n < 2:
        return n
    return fib_serial(n - 1) + fib_serial(n - 2)


@njit
def fib(n):
    if n < 2:
        return n
    if n < UMBRAL:
        return fib_serial(n)
    x = 0
    y = 0
    with openmp("task shared(x) firstprivate(n)"):
        x = fib(n - 1)
    with openmp("task shared(y) firstprivate(n)"):
        y = fib(n - 2)
    with openmp("taskwait"):
        pass
    return x + y


@njit
def fib_paralelo(n):
    resultado = 0
    with openmp("parallel shared(resultado)"):
        with openmp("single"):
            resultado = fib(n)
    return resultado


for n in (10, 20, 30, 35):
    print("fib(", n, ") =", fib_paralelo(n))
