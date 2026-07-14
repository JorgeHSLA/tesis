# π con patrón SPMD (false sharing)

Este ejemplo calcula π igual que el de la carpeta `for/`, pero **SIN** usar `parallel for`. Aquí repartimos el trabajo **a mano** usando el número de hilo: es el patrón **SPMD** (*Single Program Multiple Data*), uno de los 3 patrones de diseño del paper original de PyOMP.

La idea: entender qué hace `parallel for` por debajo. Antes de que existiera el worksharing, así se programaba OpenMP.

## Explicación línea a línea

- `omp_set_num_threads(num_threads)` = fija cuántos hilos va a usar la siguiente región paralela (equivale a la variable de entorno `OMP_NUM_THREADS` pero desde código).
- `partial = np.zeros(num_threads)` = un array con **UNA casilla por hilo**: cada hilo acumula su suma parcial en la suya.
- `with openmp("parallel private(tid, nths, x, i) shared(partial)")` = región paralela normal (NO hay `for` aquí). `private` dice que cada hilo tiene su propia copia de esas variables; `shared` que el array es el mismo para todos.
- `tid = omp_get_thread_num()` = cada hilo averigua quién es (0, 1, 2, …).
- `for i in range(tid, num_steps, nths)` = **ESTE es el reparto manual**: el hilo 0 toma las iteraciones 0, 8, 16…; el hilo 1 toma 1, 9, 17… (reparto cíclico). El bucle es un `for` de Python normal que OpenMP no toca.
- `omp_get_wtime()` = cronómetro de OpenMP, devuelve segundos (se usa dentro de la función `@njit`).

## Output real

En la máquina de referencia (8 núcleos):

```
hilos = 1 | pi = 3.141592653589731 | tiempo = 0.03634190559387207 s
hilos = 2 | pi = 3.141592653589985 | tiempo = 0.03456521034240723 s
hilos = 4 | pi = 3.141592653589686 | tiempo = 0.04526805877685547 s
hilos = 8 | pi = 3.1415926535898064 | tiempo = 0.03133392333984375 s
```

**OJO**: π sale bien pero casi **NO hay speedup** con más hilos. Eso NO es un bug, **es la lección del ejemplo**: las casillas de `partial` están pegadas en memoria y caen en la misma línea de caché, así que los hilos se la pelean todo el tiempo. Eso se llama **false sharing**, y es el problema que arregla el siguiente ejemplo (`spmdCritical/`).

## Fuentes

- [Ejemplo oficial pi_spmd.py de PyOMP](https://github.com/Python-for-HPC/PyOMP/blob/main/examples/pi_spmd.py)
- [Ejercicio 2 del tutorial de Tim Mattson](https://github.com/tgmattso/OpenMP_intro_tutorial)
