# de que trata?

multiplicacion de matrices C = A x B con el triple bucle clasico, paralelizando el bucle externo. Es el ejemplo tipico de "bucles anidados: cual paralelizo y que variables privatizo".

fuente: ejercicio 5 (matmul.c) del tutorial de Tim Mattson y omp_mm.c de LLNL; PyOMP trae su propia version (dgemm)

- https://github.com/tgmattso/OpenMP_intro_tutorial
- https://github.com/Python-for-HPC/PyOMP/blob/main/examples/dgemm_ompGPU.py

## EXPLICACION

`with openmp("parallel for private(j, k, tmp) schedule(static)")` = se paraleliza SOLO el bucle de i (las filas). Cada hilo procesa un bloque de filas completo

`private(j, k, tmp)` = CLAVE: j, k y tmp los usa cada hilo para su propia fila. Si fueran compartidos, un hilo le pisaria el contador al otro -> resultado basura. La variable i (la del for paralelo) es privada automatica, no hay que declararla

`tmp += A[i, k] * B[k, j]` = acumular en un escalar privado y escribir C[i, j] al final es mas rapido que escribir en C[i, j] en cada vuelta (menos trafico de memoria)

## detalles

output real (matrices 600x600, 8 nucleos):

```
correcto? True
tiempo openmp : 0.06692935799947008 s
tiempo np.dot : 0.038914427000236174 s (BLAS optimizado, la referencia a batir)
```

nuestro triple bucle paralelo queda CERCA de np.dot pero no lo gana. Y esta bien que asi sea: np.dot llama a BLAS (decadas de optimizacion: bloques de cache, SIMD, etc). La leccion es doble:

1. paralelizar un algoritmo simple te acerca mucho a una libreria profesional
2. si existe una libreria optimizada para tu problema, USALA. OpenMP es para el codigo que NO tiene libreria (tus simuladores, tus kernels custom)

NOTA pyomp 0.5.x: `collapse(2)` para fusionar los bucles i y j esta en la documentacion pero el test de CPU del repo oficial esta marcado "Unimplemented" — no te fies, paraleliza solo el externo.
