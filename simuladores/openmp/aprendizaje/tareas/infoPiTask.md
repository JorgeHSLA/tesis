# de que trata?

el mismo pi de siempre pero con el TERCER patron de PyOMP: **divide y venceras con tareas** (tasks). En vez de repartir un bucle, el problema se parte recursivamente en mitades; cada mitad es una "tarea" que va a una bolsa comun, y los hilos libres las van tomando.

las tasks son la forma de paralelizar cosas que NO son un bucle regular: recursion, arboles, listas, trabajo que aparece dinamicamente.

fuente: ejemplo oficial pi_task.py de PyOMP y ejercicio 8/11 de Mattson

- https://github.com/Python-for-HPC/PyOMP/blob/main/examples/pi_task.py
- paper PyOMP (patron 3): https://www.osti.gov/pages/servlets/purl/1843562

## EXPLICACION

`MIN_BLK` = umbral del caso base. Crear una task cuesta; si el trozo es chico, mejor sumarlo secuencial. SIEMPRE pon umbral en paralelismo recursivo

`with openmp("task shared(sum1) firstprivate(nstart, mid, step)")` = crea una tarea: "alguien, cuando pueda, ejecute este bloque". `shared(sum1)` porque el resultado debe verse fuera de la tarea; `firstprivate` para que la tarea capture los valores de los limites EN ESTE MOMENTO (como una foto)

`with openmp("taskwait"):` = espera a que MIS tareas hijas directas terminen. Sin esto, harias `sum1 + sum2` antes de que esten calculadas -> basura

`with openmp("parallel")` + `with openmp("single")` = el combo magico de las tasks: `parallel` crea el equipo de hilos, `single` hace que UN solo hilo siembre el arbol de tareas (si no, cada hilo crearia SU arbol completo = trabajo repetido). Los demas hilos no estan ociosos: estan en la barrera del single robando tareas de la bolsa

## detalles

output real:

```
pi = 3.141592653589794
```

mismo resultado que `for/` y `spmd/` — tres caminos distintos, misma respuesta. Con esto el repo cubre los 3 patrones del paper de PyOMP: loop-level (`for/`), SPMD (`spmd/`) y divide-y-venceras (`tareas/`).

NOTA pyomp 0.5.x (verificado en los tests oficiales): `task`, `taskwait`, y las clausulas shared/private/firstprivate/default en task SI funcionan. NO funcionan: `taskloop`, `taskgroup`, `task depend`, `taskyield`, ni las clausulas if/final/priority/untied.
