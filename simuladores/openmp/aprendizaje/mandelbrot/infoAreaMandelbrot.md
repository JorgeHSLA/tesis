# de que trata?

estimar el area del conjunto de Mandelbrot contando puntos que escapan al iterar z = z^2 + c. Pero el verdadero tema es otro: este ejemplo trae UN BUG A PROPOSITO (un **data race**) y su solucion, para que veas un resultado corrupto con tus propios ojos.

es el ejercicio 6 del tutorial de Tim Mattson (original de Mark Bull, EPCC): "encuentra y arregla los races".

- https://github.com/tgmattso/OpenMP_intro_tutorial (mandel.c)
- https://github.com/EPCCed/archer2-openmp-2022-08-30

## EXPLICACION

hay DOS versiones de la misma funcion:

`area_mandelbrot_mal` = `num_outside` es compartida y todos los hilos hacen `num_outside += 1` sin proteccion. El += NO es atomico: es leer-sumar-escribir, y si dos hilos leen a la vez el mismo valor, una suma SE PIERDE. Eso es un data race

`area_mandelbrot_bien` = identica pero con `reduction(+:num_outside)`: cada hilo cuenta en una copia privada y OpenMP las combina al final. Cero races, cero espera

`private(j, cr, ci, zr, zi, zr2, zi2, it)` = TODAS las variables de trabajo del punto son privadas. Olvidar una sola en esta lista tambien seria un race (ese es el otro bug clasico del ejercicio original)

el `break` = esta dentro del bucle interno (it), no del paralelo. En OpenMP no se puede hacer break del bucle paralelizado, pero de los internos si

## detalles

output real (malla 1000x1000, maxiter 1000):

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

la version con race da un valor DISTINTO cada vez (y siempre mal: se pierden sumas de num_outside, el area sale inflada). La version con reduction da siempre 1.5103, cerca del valor real ~1.5065. 

asi se ve un data race en la vida real: el programa NO crashea, solo miente.

NOTA pyomp 0.5.x: en C este race tambien se arregla con `#pragma omp atomic`, pero atomic NO existe en pyomp. Las opciones reales son `reduction` (la buena) o `critical` (correcta pero lenta si esta dentro del bucle).
