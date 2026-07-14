# de que trata?

calcular pi por Monte Carlo: lanzar dardos aleatorios al cuadrado unitario y contar cuantos caen dentro del cuarto de circulo (pi ~ 4 * dentro / total). El tema REAL del ejemplo: **numeros aleatorios en paralelo**, que es la base de cualquier simulador Monte Carlo (y una trampa clasica).

fuente: ejercicio 9 (pi_mc.c) del tutorial de Tim Mattson

- https://github.com/tgmattso/OpenMP_intro_tutorial

## EXPLICACION

el problema: un generador de numeros aleatorios tiene ESTADO (la semilla se actualiza en cada llamada). Si todos los hilos comparten el estado -> data race. En C esto se resuelve con `threadprivate`, pero pyomp 0.5.x NO lo soporta. La adaptacion:

`seeds = np.empty(num_threads, dtype=np.uint64)` = un array con una semilla DISTINTA por hilo

`s = seeds[tid]` = dentro de la region paralela, cada hilo carga su semilla en `s`, que es PRIVADA (esta en la lista private). Desde aqui cada hilo tiene su generador independiente

`s = (A * s + C) & MASK` = generador congruencial lineal (LCG) implementado a mano: s_nuevo = (a*s + c) mod 2^32. Numba no soporta np.random con semillas por hilo, asi que lo hacemos nosotros (3 lineas)

`with openmp("for reduction(+:hits)")` = fijate que aqui `parallel` y `for` van SEPARADOS: primero la region paralela (para inicializar el RNG por hilo), y dentro el worksharing del bucle. Es el mismo patron del paper de PyOMP (figura 1)

## detalles

output real (4 hilos):

```
dardos = 100000 | pi ~ 3.14408
dardos = 1000000 | pi ~ 3.139644
dardos = 10000000 | pi ~ 3.1420628
```

Monte Carlo converge lento (error ~ 1/sqrt(N)): con 10 millones de dardos apenas 3 decimales. Por eso estos metodos NECESITAN paralelismo: mas dardos = mas precision.

detalle fino: dar semillas distintas por hilo no garantiza matematicamente que las secuencias no se solapen (para eso existe la tecnica "leapfrog" del ejercicio original). Para aprender basta; para un paper de verdad usa generadores con streams independientes (Philox, PCG).
