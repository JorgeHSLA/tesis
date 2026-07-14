from numba.openmp import njit
from numba.openmp import openmp_context as openmp

# pi con TAREAS: divide y venceras. En vez de repartir un bucle, el problema
# se parte recursivamente en dos mitades; cada mitad es una "task" que
# cualquier hilo libre puede ejecutar. Adaptado del ejemplo oficial pi_task.py
# de PyOMP y del Ex. 8/11 del tutorial de Tim Mattson.

MIN_BLK = 1024 * 256  # umbral: por debajo de esto ya no se divide mas


@njit
def pi_comp(nstart, nfinish, step):
    if nfinish - nstart < MIN_BLK:
        # caso base: suma secuencial normal
        s = 0.0
        for i in range(nstart, nfinish):
            x = (i + 0.5) * step
            s += 4.0 / (1.0 + x * x)
        return s
    # caso recursivo: partir en dos y crear una tarea por mitad
    mid = (nstart + nfinish) // 2
    sum1 = 0.0
    sum2 = 0.0
    with openmp("task shared(sum1) firstprivate(nstart, mid, step)"):
        sum1 = pi_comp(nstart, mid, step)
    with openmp("task shared(sum2) firstprivate(mid, nfinish, step)"):
        sum2 = pi_comp(mid, nfinish, step)
    with openmp("taskwait"):
        pass  # esperar a que MIS dos tareas hijas terminen
    return sum1 + sum2


@njit
def calc_pi_tasks(num_steps):
    step = 1.0 / num_steps
    total = 0.0
    with openmp("parallel shared(total)"):
        with openmp("single"):
            # UN solo hilo siembra el arbol de tareas;
            # el resto del equipo las va robando y ejecutando
            total = pi_comp(0, num_steps, step)
    return step * total


print("pi =", calc_pi_tasks(10_000_000))
