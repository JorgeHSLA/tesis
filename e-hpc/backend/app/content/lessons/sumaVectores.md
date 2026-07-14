# Suma de vectores con schedule(static, chunk)

El «hola mundo» del worksharing sobre arrays: sumar dos vectores NumPy gigantes elemento a elemento, `c[i] = a[i] + b[i]`, con 10 millones de elementos. Además muestra la cláusula `schedule(static, chunk)`: cómo se reparten las iteraciones entre hilos.

## Explicación línea a línea

- `c = np.empty_like(a)` = numba trabaja perfecto con arrays de NumPy: son el sustituto natural de los arrays de C.
- `with openmp("parallel for schedule(static, 1000)")` = crea los hilos **Y** reparte el bucle en un solo paso. `schedule(static, 1000)` significa: reparte las iteraciones en **bloques FIJOS de 1000** (el hilo 0 toma 0–999, el hilo 1 toma 1000–1999… y vuelta a empezar, en round-robin).
- `for i in range(n)` = la variable del bucle (`i`) es **privada automáticamente**, no hace falta declararla.
- `np.allclose(c, a + b)` = **SIEMPRE valida el resultado paralelo contra la versión confiable** (aquí NumPy). Es la regla de oro del paralelismo.

## Output real

Con 10 millones de elementos y 8 núcleos:

```
correcto? True
tiempo openmp: 0.11262527100006992 s
tiempo numpy : 0.2925760699999955 s
```

Sí, **más rápido que NumPy**: porque `a + b` de NumPy usa un solo núcleo y además crea el array resultado; nuestro bucle usa los 8 núcleos y escribe en un array ya reservado.

## Notas para pyomp 0.5.x (MUY importantes)

Verificado contra los tests del repo oficial:

- `schedule(static)` y `schedule(static, N)` con N **CONSTANTE**: funcionan.
- `schedule(dynamic)` y `schedule(guided)`: **NO implementados** (el test del repo está marcado «Unimplemented»).
- `schedule(static, variable)`: **NO** — el chunk debe ser constante.
- Si no pones `schedule`, se usa el reparto por defecto (bloques contiguos), que casi siempre está bien.

## Fuentes

- [Ejercicio 2 (omp_workshare1.c) del tutorial de LLNL](https://hpc-tutorials.llnl.gov/openmp/exercise2/)
