# Fibonacci con tareas: árbol irregular

Fibonacci recursivo con tareas: **EL** ejemplo canónico de tasking, sacado del documento oficial «OpenMP Application Programming Interface Examples» (capítulo tasking). Cada llamada `fib(n)` crea dos tareas (`fib(n-1)` y `fib(n-2)`) y espera con `taskwait` — el árbol de llamadas se convierte en un árbol de tareas.

Es la versión «pura» del concepto que `tareas/piTask.py` aplica a un problema numérico.

## Explicación línea a línea

- `fib_serial(n)` = versión secuencial normal, para el caso base.
- `UMBRAL = 20` = si `n` es chico, **NO crear tasks**. `fib(15)` tarda nanosegundos; el overhead de crear/encolar/robar una task es mayor que hacer el cálculo. Sin umbral este programa sería **MÁS LENTO que el secuencial** (pruébalo: baja el umbral a 2 y mira).
- `with openmp("task shared(x) firstprivate(n)")` = la tarea calcula `fib(n-1)` y deja el resultado en `x`. `shared(x)` para que se vea fuera; `firstprivate(n)` para capturar el valor de `n` de ESTA llamada.
- `with openmp("taskwait"):` = esperar a las DOS tareas hijas antes de devolver `x + y`. **Ojo**: `taskwait` espera solo a las hijas **DIRECTAS**, no a los nietos (el árbol entero se sincroniza solo: cada nivel espera al suyo).
- `fib_paralelo` = de nuevo el combo `parallel` + `single`: un hilo siembra, todos ejecutan.

## Output real

```
fib( 10 ) = 55
fib( 20 ) = 6765
fib( 30 ) = 832040
fib( 35 ) = 9227465
```

Valores correctos (puedes verificar: fib(35) = 9227465).

## La gracia pedagógica

El árbol de tareas es **IRREGULAR**: la rama n−1 es mucho más grande que la n−2. Un `parallel for` no puede repartir esto porque **no hay bucle**; las tasks se balancean solas porque los hilos **roban trabajo** de la bolsa cuando quedan libres (*work stealing*).

## Fuentes

- [OpenMP Examples (tasking.pdf)](https://github.com/OpenMP/Examples)
- [Especificaciones de OpenMP](https://www.openmp.org/specifications/)
