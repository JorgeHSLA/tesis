# de que trata?

este ejemplo calcula pi igual que el de la carpeta `for/`, pero SIN usar `parallel for`. Aqui repartimos el trabajo A MANO usando el numero de hilo: es el patron **SPMD** (Single Program Multiple Data), uno de los 3 patrones de diseño del paper original de PyOMP.

la idea: entender que hace `parallel for` por debajo. Antes de que existiera el worksharing, asi se programaba OpenMP.

fuente: ejemplo oficial pi_spmd.py de PyOMP y ejercicio 2 del tutorial de Tim Mattson

- https://github.com/Python-for-HPC/PyOMP/blob/main/examples/pi_spmd.py
- https://github.com/tgmattso/OpenMP_intro_tutorial

## EXPLICACION

`omp_set_num_threads(num_threads)` = fija cuantos hilos va a usar la siguiente region paralela (equivale a la variable OMP_NUM_THREADS pero desde codigo)

`partial = np.zeros(num_threads)` = un array con UNA casilla por hilo, cada hilo acumula su suma parcial en la suya

`with openmp("parallel private(tid, nths, x, i) shared(partial)")` = region paralela normal (NO hay `for` aqui). `private` dice que cada hilo tiene su propia copia de esas variables; `shared` que el array es el mismo para todos

`tid = omp_get_thread_num()` = cada hilo averigua quien es (0, 1, 2...)

`for i in range(tid, num_steps, nths)` = ESTE es el reparto manual: el hilo 0 toma las iteraciones 0, 8, 16...; el hilo 1 toma 1, 9, 17... (reparto ciclico). El bucle es un `for` de python normal, OpenMP no lo toca

`omp_get_wtime()` = cronometro de OpenMP, devuelve segundos (se usa dentro de la funcion @njit)

## detalles

output real en esta maquina (8 nucleos):

```
hilos = 1 | pi = 3.141592653589731 | tiempo = 0.03634190559387207 s
hilos = 2 | pi = 3.141592653589985 | tiempo = 0.03456521034240723 s
hilos = 4 | pi = 3.141592653589686 | tiempo = 0.04526805877685547 s
hilos = 8 | pi = 3.1415926535898064 | tiempo = 0.03133392333984375 s
```

OJO: pi sale bien pero casi NO hay speedup con mas hilos!! eso NO es un bug, es la leccion del ejemplo: las casillas de `partial` estan pegadas en memoria y caen en la misma linea de cache, asi que los hilos se la pelean todo el tiempo. Eso se llama **false sharing** y es el problema que arregla el siguiente ejemplo (`spmdCritical/`).
