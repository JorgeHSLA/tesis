# Tu primer parallel for

Este ejemplo calcula π ≈ 3.14159 integrando numéricamente la función 4/(1+x²) entre 0 y 1 con **1.000.000 de pasos**, y lo hace con la directiva más importante de OpenMP: `parallel for` con `reduction`. Según el README del repo, aquí se aprende «worksharing con reducción (π)»: es el patrón **loop-level parallelism**, el primero de los 3 patrones de diseño del paper de PyOMP (los otros dos son SPMD, en `spmd/`, y divide y vencerás, en `tareas/`).

## Explicación línea a línea

- `@njit` = compila `calc_pi` a código máquina nativo (como en `primerEjemplo/`).
- `step = 1.0 / num_steps` = el ancho de cada rectángulo de la integración numérica.
- `red_sum = 0.0` = el acumulador de la suma. Aquí está la gracia del ejemplo: **todos los hilos van a sumar sobre él** sin pisarse, gracias a `reduction`.
- `with openmp("parallel for reduction(+:red_sum) schedule(static)"):` = **una sola directiva hace tres cosas**:
  - `parallel` crea el equipo de hilos,
  - `for` reparte las iteraciones del bucle entre ellos (worksharing),
  - `reduction(+:red_sum)` da a **cada hilo una copia privada** de `red_sum` y las combina con `+` al final. Sin ella, el `red_sum +=` de todos los hilos a la vez sería un data race.
- `for j in range(num_steps):` = la variable del bucle (`j`) es **privada automáticamente** para cada hilo: es la regla de OpenMP para la variable de control del `for` paralelizado.
- `x = ((j-1) - 0.5) * step` = el punto donde se evalúa la función (punto medio desplazado; converge igualmente a π con 1M de pasos).
- `red_sum += 4.0 / (1.0 + x * x)` = cada hilo acumula en **su** copia privada; OpenMP suma las copias al cerrar la región.
- `pi = step * red_sum` = suma de Riemann: ancho × suma de alturas.

## Sobre `schedule(static)`

`schedule(static)` reparte las iteraciones en bloques contiguos fijos entre los hilos. Es la **única familia de schedule disponible en pyomp 0.5.x**: `schedule(dynamic)` y `schedule(guided)` NO están implementados (los tests del repo oficial los marcan «Unimplemented»), y el chunk de `static` debe ser constante. Esto se ve en detalle en `sumaVectores/`.

## Output real

```
pi = 3.1415926535897523
```

Una sola línea. Detalle importante: este es el único ejemplo con cómputo pesado **sin warmup del JIT** — la única llamada a `calc_pi` incluye la compilación, así que el tiempo de pared del proceso (unos segundos) está dominado por el JIT, no por el cálculo.

## Fuentes

- Fila 2 de la ruta de aprendizaje del README del repo: «worksharing con reduccion (pi)», directivas `parallel for reduction(+:) schedule(static)`.
- Con `for/`, `spmd/` y `tareas/` el repo cubre los 3 patrones de diseño del paper de PyOMP.
