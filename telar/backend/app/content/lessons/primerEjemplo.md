# Hola mundo paralelo

Este ejemplo es el «hello world» de PyOMP: el primer programa paralelo, igual que el primer *hello world* de Python o de cualquier otro lenguaje. Es además el primer ejemplo que aparece en el [video de presentación de PyOMP](https://www.youtube.com/watch?v=MLkZGEMpriY), la librería que nos permite usar OpenMP en Python.

## Explicación línea a línea

- `@njit` = «no ejecutes esta función como Python normal, **compílala a código máquina nativo** antes de correrla». Esto da eficiencia: lo que corre ya no lo corre el intérprete de Python, lo que lo hace perfecto para evaluar rendimiento real.
- `def hello():` = una función de Python de toda la vida.
- `with openmp("parallel"):` = el bloque `with` marca el **inicio y el fin de una región paralela**.
- `print("Hello from thread", omp_get_thread_num())` = lo que ejecuta cada hilo dentro de la región: imprime su propio número de hilo.

## ¿Cuántos hilos se crean?

Se crean **tantos hilos como procesadores lógicos vea el sistema** (lo que muestra el comando `nproc`), o los que fije la variable de entorno `OMP_NUM_THREADS`.

En la máquina de referencia, `nproc` devuelve 8, así que el programa produce 8 líneas:

```
Hello from thread 0
Hello from thread 3
Hello from thread 6
Hello from thread 2
Hello from thread 1
Hello from thread 4
Hello from thread 7
Hello from thread 5
```

Fíjate en el orden: **no es 0, 1, 2, …** Los hilos corren concurrentemente y no hay ninguna sincronización de orden, así que cada corrida puede imprimir en un orden distinto. Eso es normal y esperado.

## Fuentes

- [Video de presentación de PyOMP](https://www.youtube.com/watch?v=MLkZGEMpriY)
