# de que trata?

difusion de calor en una placa 2D (stencil de 5 puntos, metodo de Jacobi): el borde superior esta a 100 grados y en cada paso de tiempo cada celda toma el promedio de sus 4 vecinas. Es tu primera SIMULACION FISICA ITERATIVA real con OpenMP — el tipo de codigo que es el corazon de tu tesis.

el concepto nuevo: **sincronizacion entre pasos de tiempo**. Nadie puede empezar el paso t+1 hasta que TODOS terminaron el paso t (las barreras).

fuente: ejemplo de heat stencil de las charlas oficiales de PyOMP (HPEC25) y pyomp_gpu_stencil.py

- https://fastcode.org/img/HPEC25_Tasking_and_PyOMP.pdf
- https://github.com/Python-for-HPC/pyomp_examples

## EXPLICACION

`u` y `u_new` = DOS mallas (doble buffer). Se lee de u y se escribe en u_new; si usaras una sola, leerias valores ya actualizados del mismo paso -> fisica incorrecta

`with openmp("parallel private(paso, i, j)")` = UNA sola region paralela para toda la simulacion. El bucle de tiempo (`for paso`) lo ejecutan TODOS los hilos replicado — lo que se reparte es el trabajo DENTRO de cada paso

`with openmp("for")` = worksharing huerfano de la region de arriba: reparte las filas i entre los hilos. Al final de cada `for` hay una BARRERA IMPLICITA: ahi es donde los hilos se esperan entre pasos

el segundo `with openmp("for")` = la copia u_new -> u tambien en paralelo, con su propia barrera implicita antes del siguiente paso

`difusion_calor_serial` = la misma fisica sin OpenMP, para validar (np.allclose) y comparar tiempos

## detalles

output real (malla 1500x1500, 200 pasos, 8 nucleos):

```
paralelo == serial? True
tiempo paralelo: 0.9119956780000109 s
tiempo serial  : 0.9888471129999914 s
temperatura cerca del borde caliente: 31.79152571229165
```

speedup de apenas ~1.1x con 8 nucleos... y ESA es la leccion mas valiosa del ejemplo: el stencil hace solo 4 sumas por celda pero lee 4 vecinas de la RAM -> esta limitado por el ANCHO DE BANDA DE MEMORIA, no por la CPU. Los 8 nucleos se pelean el mismo bus. Compara con `transporteParticulas/` (mucho calculo por byte leido) que si escala 8x.

esto tiene nombre: "memory-bound" vs "compute-bound", y decide si vale la pena paralelizar. Para tu tesis: un capitulo entero puede salir de esta comparacion.

NOTA pyomp 0.5.x: `nowait` para quitar la barrera del primer `for` (optimizacion clasica) NO es confiable (los docs lo marcan no soportado). Las barreras implicitas de `for` son las que mandan.
