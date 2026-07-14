# de que trata?

Fibonacci recursivo con tareas: EL ejemplo canonico de tasking, sacado del documento oficial "OpenMP Application Programming Interface Examples" (capitulo tasking). Cada llamada fib(n) crea dos tareas (fib(n-1) y fib(n-2)) y espera con taskwait — el arbol de llamadas se convierte en un arbol de tareas.

es la version "pura" del concepto que `tareas/piTask.py` aplica a un problema numerico.

fuente:

- https://github.com/OpenMP/Examples (tasking.pdf)
- https://www.openmp.org/specifications/ (OpenMP Examples)

## EXPLICACION

`fib_serial(n)` = version secuencial normal, para el caso base

`UMBRAL = 20` = si n es chico, NO crear tasks. fib(15) tarda nanosegundos; el overhead de crear/encolar/robar una task es mayor que hacer el calculo. Sin umbral este programa seria MAS LENTO que el secuencial (pruebalo: baja el umbral a 2 y mira)

`with openmp("task shared(x) firstprivate(n)")` = la tarea calcula fib(n-1) y deja el resultado en x. shared(x) para que se vea fuera; firstprivate(n) para capturar el valor de n de ESTA llamada

`with openmp("taskwait"):` = esperar a las DOS tareas hijas antes de devolver x + y. Ojo: taskwait espera solo a las hijas DIRECTAS, no a los nietos (para eso el arbol entero se sincroniza solo, cada nivel espera al suyo)

`fib_paralelo` = de nuevo el combo `parallel` + `single`: un hilo siembra, todos ejecutan

## detalles

output real:

```
fib( 10 ) = 55
fib( 20 ) = 6765
fib( 30 ) = 832040
fib( 35 ) = 9227465
```

valores correctos (puedes verificar: fib(35) = 9227465).

la gracia pedagogica de fibonacci: el arbol de tareas es IRREGULAR (la rama n-1 es mucho mas grande que la n-2). Un `parallel for` no puede repartir esto porque no hay bucle; las tasks se balancean solas porque los hilos roban trabajo de la bolsa cuando quedan libres (work stealing).
