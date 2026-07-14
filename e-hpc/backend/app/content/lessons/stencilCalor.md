# Difusión de calor 2D: memory-bound

Difusión de calor en una placa 2D (stencil de 5 puntos, método de Jacobi): el borde superior está a 100 grados y en cada paso de tiempo cada celda toma el promedio de sus 4 vecinas. Es tu primera **SIMULACIÓN FÍSICA ITERATIVA** real con OpenMP.

El concepto nuevo: **sincronización entre pasos de tiempo**. Nadie puede empezar el paso t+1 hasta que TODOS terminaron el paso t (las barreras).

## Explicación línea a línea

- `u` y `u_new` = **DOS mallas (doble buffer)**. Se lee de `u` y se escribe en `u_new`; si usaras una sola, leerías valores ya actualizados del mismo paso → **física incorrecta**.
- `with openmp("parallel private(paso, i, j)")` = **UNA sola región paralela para toda la simulación**. El bucle de tiempo (`for paso`) lo ejecutan TODOS los hilos replicado — lo que se reparte es el trabajo DENTRO de cada paso.
- `with openmp("for")` = worksharing **huérfano** de la región de arriba: reparte las filas `i` entre los hilos. Al final de cada `for` hay una **BARRERA IMPLÍCITA**: ahí es donde los hilos se esperan entre pasos.
- El segundo `with openmp("for")` = la copia `u_new → u` también en paralelo, con su propia barrera implícita antes del siguiente paso.
- `difusion_calor_serial` = la misma física sin OpenMP, para validar (`np.allclose`) y comparar tiempos.

## Output real

Con malla 1500×1500, 200 pasos y 8 núcleos:

```
paralelo == serial? True
tiempo paralelo: 0.9119956780000109 s
tiempo serial  : 0.9888471129999914 s
temperatura cerca del borde caliente: 31.79152571229165
```

Speedup de apenas **~1.1x con 8 núcleos**… y **ESA es la lección más valiosa del ejemplo**: el stencil hace solo 4 sumas por celda pero lee 4 vecinas de la RAM → está limitado por el **ANCHO DE BANDA DE MEMORIA**, no por la CPU. Los 8 núcleos se pelean el mismo bus. Compara con `transporteParticulas/` (mucho cálculo por byte leído), que sí escala 8x.

Esto tiene nombre: **memory-bound vs compute-bound**, y decide si vale la pena paralelizar.

## Notas para pyomp 0.5.x

- `nowait` para quitar la barrera del primer `for` (optimización clásica) **NO es confiable** (los docs lo marcan no soportado). Las barreras implícitas de `for` son las que mandan.

## Fuentes

- [Heat stencil de las charlas oficiales de PyOMP (HPEC25)](https://fastcode.org/img/HPEC25_Tasking_and_PyOMP.pdf)
- [pyomp_examples (pyomp_gpu_stencil.py)](https://github.com/Python-for-HPC/pyomp_examples)
