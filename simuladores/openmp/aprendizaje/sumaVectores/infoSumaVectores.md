# de que trata?

el "hola mundo" del worksharing sobre arrays: sumar dos vectores NumPy gigantes elemento a elemento, c[i] = a[i] + b[i]. Ademas muestra la clausula `schedule(static, chunk)`: como se reparten las iteraciones entre hilos.

fuente: ejercicio 2 (omp_workshare1.c) del tutorial de LLNL

- https://hpc-tutorials.llnl.gov/openmp/exercise2/

## EXPLICACION

`c = np.empty_like(a)` = numba trabaja perfecto con arrays de NumPy, son el sustituto natural de los arrays de C

`with openmp("parallel for schedule(static, 1000)")` = crea los hilos Y reparte el bucle en un solo paso. `schedule(static, 1000)` significa: reparte las iteraciones en bloques FIJOS de 1000 (hilo 0 toma 0-999, hilo 1 toma 1000-1999... y vuelta a empezar)

`for i in range(n)` = la variable del bucle (i) es privada automaticamente, no hace falta declararla

`np.allclose(c, a + b)` = SIEMPRE valida el resultado paralelo contra la version confiable (aqui numpy). Regla de oro del paralelismo

## detalles

output real (10 millones de elementos, 8 nucleos):

```
correcto? True
tiempo openmp: 0.11262527100006992 s
tiempo numpy : 0.2925760699999955 s
```

si, mas rapido que numpy!! porque `a + b` de numpy usa un solo nucleo y ademas crea el array resultado; nuestro bucle usa los 8.

MUY IMPORTANTE para pyomp 0.5.x (verificado contra los tests del repo oficial):
- `schedule(static)` y `schedule(static, N)` con N CONSTANTE: funcionan
- `schedule(dynamic)` y `schedule(guided)`: NO implementados (el test del repo esta marcado "Unimplemented")
- `schedule(static, variable)`: NO, el chunk debe ser constante
- si no pones schedule, se usa el reparto por defecto (bloques contiguos), que casi siempre esta bien
