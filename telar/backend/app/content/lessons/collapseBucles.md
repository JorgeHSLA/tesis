# collapse: dos bucles como uno

**Objetivo:** entender por qué paralelizar solo el bucle de afuera puede dejar hilos sin trabajo, y cómo `collapse` lo arregla.

## El problema de los bucles anidados

En la multiplicación de matrices viste que `parallel for` reparte **solo el bucle de afuera**. Cada hilo recibe filas completas, y el bucle de adentro lo recorre él solo.

Eso funciona bien cuando hay muchas filas. Pero si hay **menos filas que hilos**, algunos hilos se quedan sin nada que hacer. Con 3 filas y 4 hilos, uno sobra siempre, sin importar cuántas columnas tenga la matriz.

## La solución: collapse

`collapse(2)` le dice a OpenMP que trate los **dos bucles como uno solo**. Con 3 filas y 1000 columnas, en lugar de repartir 3 filas reparte 3000 iteraciones.

## Explicación línea a línea

```python
@njit
def con_collapse(filas, cols):
    trabajo = np.zeros(omp_get_max_threads(), dtype=np.int64)
    with openmp("parallel for collapse(2)"):
        for i in range(filas):
            for j in range(cols):
                trabajo[omp_get_thread_num()] += 1
    return trabajo
```

- `trabajo` = un contador por hilo. Cada hilo suma 1 en **su** posición, así que no se pisan entre ellos.
- `collapse(2)` = junta los 2 bucles en un espacio de `filas × cols` iteraciones y lo reparte entero.
- En la versión sin `collapse` se usa `private(j)`: la variable del bucle de adentro debe ser privada. Con `collapse(2)` las dos variables ya lo son.

## Output real

Con 4 hilos:

```
Matriz de 3 filas x 1000 columnas, 4 hilos
Iteraciones por hilo sin collapse: [1000 1000 1000    0]
Iteraciones por hilo con collapse: [750 750 750 750]
```

- **Sin `collapse`**: 3 hilos hacen una fila cada uno y el **hilo 3 no hace nada**. Una cuarta parte del equipo está ociosa.
- **Con `collapse`**: las 3000 iteraciones se reparten **750 para cada hilo**.

## Cuándo usarlo

- Cuando el bucle de afuera tiene **pocas iteraciones** comparado con el número de hilos.
- Los bucles deben estar **perfectamente anidados**: nada de código entre el `for` de afuera y el de adentro.
- Si el bucle de afuera ya tiene muchas más iteraciones que hilos, `collapse` casi no cambia nada.

## Pruébalo

Cambia `FILAS` a 8: ¿sigue habiendo un hilo sin trabajo sin `collapse`?

## Para recordar

- `parallel for` reparte solo el bucle de afuera.
- Con menos iteraciones afuera que hilos, algunos hilos quedan **ociosos**.
- `collapse(2)` junta dos bucles anidados en uno y reparte todo el trabajo.
- Las variables de los bucles colapsados son privadas automáticamente.
