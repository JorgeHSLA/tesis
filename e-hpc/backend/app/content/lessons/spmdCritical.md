# SPMD arreglado: acumulador privado + critical

Es la **SOLUCIÓN** al problema de false sharing del ejemplo `spmd/`. En vez de que cada hilo escriba en un array compartido (donde las casillas se pelean la línea de caché), cada hilo acumula en una variable local **PRIVADA** y al final suma su resultado al total protegiéndose con `critical`.

## Explicación línea a línea

- `local_sum = 0.0` = el acumulador **PRIVADO**. Como está en la lista `private(...)`, cada hilo tiene el suyo en su propio stack: **cero peleas de caché**.
- `with openmp("critical"):` = sección crítica: solo **UN hilo a la vez** puede estar dentro de este bloque. Los demás esperan en la puerta.
- `total += local_sum` = la única operación sobre la variable compartida. Se hace **UNA vez por hilo** (¡no una por iteración!), así que el costo del `critical` es despreciable.

## Output real

En la máquina de referencia (8 núcleos):

```
hilos = 1 | pi = 3.141592653589731 | tiempo = 0.012768983840942383 s
hilos = 2 | pi = 3.141592653589985 | tiempo = 0.007388114929199219 s
hilos = 4 | pi = 3.141592653589686 | tiempo = 0.0066070556640625 s
hilos = 8 | pi = 3.1415926535898064 | tiempo = 0.011782169342041016 s
```

Compáralo con `spmd/`: con 1 hilo ya es **~3x más rápido** (no hay tráfico de caché raro) y con 4 hilos **escala de verdad**.

## Notas para pyomp 0.5.x

- `critical` **SÍ** está soportado (sin nombre; `critical(nombre)` NO está implementado).
- `atomic` **NO existe** en pyomp 0.5.x — en C usarías `#pragma omp atomic` para esto mismo; aquí la única opción es `critical`.
- Poner el `critical` **DENTRO** del bucle sería correctísimo pero lentísimo (serializa todo). La gracia es: **acumula privado, protege solo el final**.

## Fuentes

- [Ejercicio 3 «Pi_spmd_final» del tutorial de Tim Mattson](https://github.com/tgmattso/OpenMP_intro_tutorial)
- [Slides del bootcamp de Berkeley](http://bebop.cs.berkeley.edu/bootcamp2014/omp-exercises.pdf)
