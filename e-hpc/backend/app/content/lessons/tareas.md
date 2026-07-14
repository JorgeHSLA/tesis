# π con tareas (divide y vencerás)

El mismo π de siempre pero con el **TERCER patrón** de PyOMP: **divide y vencerás con tareas** (*tasks*). En vez de repartir un bucle, el problema se parte recursivamente en mitades; cada mitad es una «tarea» que va a una bolsa común, y los hilos libres las van tomando.

Las tasks son la forma de paralelizar cosas que **NO son un bucle regular**: recursión, árboles, listas, trabajo que aparece dinámicamente.

## Explicación línea a línea

- `MIN_BLK` = umbral del caso base. **Crear una task cuesta**; si el trozo es chico, mejor sumarlo secuencial. **SIEMPRE pon umbral en paralelismo recursivo.**
- `with openmp("task shared(sum1) firstprivate(nstart, mid, step)")` = crea una tarea: «alguien, cuando pueda, ejecute este bloque». `shared(sum1)` porque el resultado debe verse fuera de la tarea; `firstprivate` para que la tarea capture los valores de los límites **EN ESE MOMENTO** (como una foto).
- `with openmp("taskwait"):` = espera a que **MIS tareas hijas directas** terminen. Sin esto, harías `sum1 + sum2` antes de que estén calculadas → basura.
- `with openmp("parallel")` + `with openmp("single")` = **el combo mágico de las tasks**: `parallel` crea el equipo de hilos, `single` hace que **UN solo hilo siembre el árbol de tareas** (si no, cada hilo crearía SU árbol completo = trabajo repetido). Los demás hilos no están ociosos: están en la barrera del `single` **robando tareas** de la bolsa.

## Output real

```
pi = 3.141592653589794
```

Mismo resultado que `for/` y `spmd/` — **tres caminos distintos, misma respuesta**. Con esto el repo cubre los 3 patrones del paper de PyOMP: loop-level (`for/`), SPMD (`spmd/`) y divide-y-vencerás (`tareas/`).

## Notas para pyomp 0.5.x

Verificado en los tests oficiales:

- **SÍ** funcionan: `task`, `taskwait`, y las cláusulas `shared`/`private`/`firstprivate`/`default` en `task`.
- **NO** funcionan: `taskloop`, `taskgroup`, `task depend`, `taskyield`, ni las cláusulas `if`/`final`/`priority`/`untied`.

## Fuentes

- [Ejemplo oficial pi_task.py de PyOMP](https://github.com/Python-for-HPC/PyOMP/blob/main/examples/pi_task.py)
- [Paper de PyOMP (patrón 3)](https://www.osti.gov/pages/servlets/purl/1843562)
