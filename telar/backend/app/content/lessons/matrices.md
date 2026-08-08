# Multiplicación de matrices: bucles anidados

Multiplicación de matrices C = A × B (600×600) con el triple bucle clásico, paralelizando el bucle externo. Es el ejemplo típico de «bucles anidados: ¿cuál paralelizo y qué variables privatizo?».

## Explicación línea a línea

- `with openmp("parallel for private(j, k, tmp) schedule(static)")` = se paraleliza **SOLO el bucle de i** (las filas). Cada hilo procesa un bloque de filas completo.
- `private(j, k, tmp)` = **CLAVE**: `j`, `k` y `tmp` los usa cada hilo para su propia fila. Si fueran compartidos, un hilo le pisaría el contador al otro → **resultado basura**. La variable `i` (la del `for` paralelo) es privada automática, no hay que declararla.
- `tmp += A[i, k] * B[k, j]` = acumular en un escalar privado y escribir `C[i, j]` una sola vez al final es más rápido que escribir en `C[i, j]` en cada vuelta (**menos tráfico de memoria**).

## Output real

Con matrices 600×600 y 8 núcleos:

```
correcto? True
tiempo openmp : 0.06692935799947008 s
tiempo np.dot : 0.038914427000236174 s (BLAS optimizado, la referencia a batir)
```

Nuestro triple bucle paralelo queda **CERCA** de `np.dot` pero no lo gana. Y está bien que así sea: `np.dot` llama a BLAS (décadas de optimización: bloques de caché, SIMD, etc.). La lección es doble:

1. Paralelizar un algoritmo simple te acerca mucho a una librería profesional.
2. Si existe una librería optimizada para tu problema, **ÚSALA**. OpenMP es para el código que NO tiene librería (tus simuladores, tus kernels custom).

## Notas para pyomp 0.5.x

- `collapse(2)` para fusionar los bucles `i` y `j` está en la documentación, pero el test de CPU del repo oficial está marcado «Unimplemented» — **no te fíes**: paraleliza solo el bucle externo.

## Fuentes

- [Ejercicio 5 (matmul.c) del tutorial de Tim Mattson](https://github.com/tgmattso/OpenMP_intro_tutorial)
- [Versión dgemm del propio PyOMP](https://github.com/Python-for-HPC/PyOMP/blob/main/examples/dgemm_ompGPU.py)
- omp_mm.c del tutorial de LLNL
