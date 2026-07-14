# Data races: el área de Mandelbrot

Estimar el área del conjunto de Mandelbrot contando puntos que escapan (|z| > 2) al iterar z = z² + c. Pero el verdadero tema es otro: este ejemplo trae **UN BUG A PROPÓSITO** (un **data race**) y su solución, para que veas un resultado corrupto con tus propios ojos.

Es el ejercicio 6 del tutorial de Tim Mattson (original de Mark Bull, EPCC): «encuentra y arregla los races».

## Explicación: dos versiones de la misma función

- `area_mandelbrot_mal` = `num_outside` es **compartida** y todos los hilos hacen `num_outside += 1` sin protección. El `+=` **NO es atómico**: es leer–sumar–escribir, y si dos hilos leen a la vez el mismo valor, **una suma SE PIERDE**. Eso es un data race.
- `area_mandelbrot_bien` = idéntica pero con `reduction(+:num_outside)`: cada hilo cuenta en una copia privada y OpenMP las combina al final. **Cero races, cero espera.**
- `private(j, cr, ci, zr, zi, zr2, zi2, it)` = **TODAS** las variables de trabajo del punto son privadas. Olvidar una sola en esta lista también sería un race (ese es el otro bug clásico del ejercicio original).
- El `break` está dentro del bucle interno (`it`), no del paralelo. En OpenMP **no se puede hacer `break` del bucle paralelizado**, pero de los internos sí.

## Output real

Con malla 1000×1000 y maxiter 1000:

```
area real aproximada ~ 1.506
con data race (3 corridas, mira como VARIA):
  area = 1.955143125
  area = 1.788823125
  area = 2.272933125
con reduction (3 corridas, siempre igual):
  area = 1.510363125
  area = 1.510363125
  area = 1.510363125
```

La versión con race da un valor **DISTINTO cada vez** (y siempre mal: se pierden sumas de `num_outside`, el área sale inflada). La versión con `reduction` da siempre 1.5103, cerca del valor real ~1.5065.

Así se ve un data race en la vida real: **el programa NO crashea, solo miente.**

## Notas para pyomp 0.5.x

- En C este race también se arregla con `#pragma omp atomic`, pero `atomic` **NO existe** en pyomp. Las opciones reales son `reduction` (la buena) o `critical` (correcta pero lenta si está dentro del bucle).

## Fuentes

- [Tutorial de Tim Mattson, mandel.c](https://github.com/tgmattso/OpenMP_intro_tutorial)
- [Curso ARCHER2 de EPCC](https://github.com/EPCCed/archer2-openmp-2022-08-30)
