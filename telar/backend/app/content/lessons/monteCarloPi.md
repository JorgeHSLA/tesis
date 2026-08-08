# π por Monte Carlo: RNG por hilo

Calcular π por Monte Carlo: lanzar dardos aleatorios al cuadrado unitario y contar cuántos caen dentro del cuarto de círculo (π ≈ 4 · dentro / total). El tema **REAL** del ejemplo: **números aleatorios en paralelo**, que es la base de cualquier simulador Monte Carlo (y una trampa clásica).

## El problema

Un generador de números aleatorios tiene **ESTADO** (la semilla se actualiza en cada llamada). Si todos los hilos comparten el estado → **data race**. En C esto se resuelve con `threadprivate`, pero pyomp 0.5.x **NO lo soporta**. La adaptación — misma idea, otra herramienta:

## Explicación línea a línea

- `seeds = np.empty(num_threads, dtype=np.uint64)` = un array con una semilla **DISTINTA por hilo**.
- `s = seeds[tid]` = dentro de la región paralela, cada hilo carga su semilla en `s`, que es **PRIVADA** (está en la lista `private`). Desde aquí cada hilo tiene su generador independiente.
- `s = (A * s + C) & MASK` = generador congruencial lineal (**LCG**) implementado a mano: s_nuevo = (a·s + c) mod 2³². Numba no soporta `np.random` con semillas por hilo, así que lo hacemos nosotros (3 líneas).
- `with openmp("for reduction(+:hits)")` = fíjate que aquí `parallel` y `for` van **SEPARADOS**: primero la región paralela (para inicializar el RNG por hilo) y dentro el worksharing del bucle. Es el mismo patrón de la figura 1 del paper de PyOMP.

## Output real

Con 4 hilos:

```
dardos = 100000 | pi ~ 3.14408
dardos = 1000000 | pi ~ 3.139644
dardos = 10000000 | pi ~ 3.1420628
```

Monte Carlo **converge lento** (error ~ 1/√N): con 10 millones de dardos apenas 3 decimales de π. Por eso estos métodos **NECESITAN paralelismo**: más dardos = más precisión.

## Detalle fino sobre las semillas

Dar semillas distintas por hilo **no garantiza matemáticamente** que las secuencias no se solapen (para eso existe la técnica *leapfrog* del ejercicio original). Para aprender basta; para un paper de verdad usa generadores con streams independientes (**Philox, PCG**).

## Fuentes

- [Ejercicio 9 (pi_mc.c) del tutorial de Tim Mattson](https://github.com/tgmattso/OpenMP_intro_tutorial)
