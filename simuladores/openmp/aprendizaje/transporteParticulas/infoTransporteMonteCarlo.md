# de que trata?

un SIMULADOR de verdad: transporte de particulas por Monte Carlo a traves de una placa (slab) 1D. Cada particula recorre distancias aleatorias, choca, y en cada choque o es absorbida o sale dispersada en otra direccion; contamos cuantas atraviesan la placa, cuantas rebotan y cuantas mueren dentro.

este es EL ejemplo mas cercano a tu tesis: el codigo real MCDC-TNT (transporte de neutrones de Oregon State / proyecto CEMeNT) usa PyOMP en produccion con exactamente este patron. O sea: lo que aprendes aqui es lo que se usa en simuladores nucleares reales escritos en Python.

fuentes:

- https://github.com/SoftwareDevEngResearch/mcdc_tnt (kernel real: mcdc_tnt/numba_kernels/cpu/advance_omp.py)
- fisica: cualquier libro de metodos Monte Carlo en transporte de radiacion (el "slab problem" es el hola-mundo del area)

## EXPLICACION

la fisica (simplificada):

- `dist = -np.log(r) / sigma_t` = distancia hasta el proximo choque, muestreada de una exponencial (camino libre medio = 1/sigma_t)
- `x = x + mu * dist` = avanzar. mu es el coseno de la direccion: +1 hacia adentro, -1 hacia atras
- si x < 0 -> REFLEJADA (salio por donde entro); si x > espesor -> TRANSMITIDA (atraveso); si no, choco dentro:
- con probabilidad prob_abs -> ABSORBIDA; si no -> dispersion isotropica: nueva direccion mu aleatoria en [-1, 1]

el OpenMP (combina TODO lo aprendido en los ejemplos anteriores):

- `parallel private(tid, s, x, mu, r, dist, viva)` = region paralela con el estado de la particula privado por hilo (como `entornoDatos/`)
- `s = seeds[tid]` = generador aleatorio privado por hilo (el truco de `monteCarloPi/`)
- `for reduction(+:transmitidas, reflejadas, absorbidas)` = reduccion sobre TRES contadores a la vez (si, se puede poner una lista)
- el `while viva` dentro del for = cada particula vive un numero DISTINTO e impredecible de choques. Esto es carga irregular, y aun asi escala perfecto porque hay millones de particulas por hilo (la irregularidad se promedia)

## detalles

output real (5 millones de particulas, placa de 5 caminos libres, 30% absorcion):

```
hilos = 1 | tiempo = 0.726 s | transmitidas: 2.35 % | reflejadas: 20.84 % | absorbidas: 76.81 %
hilos = 2 | tiempo = 0.256 s | transmitidas: 2.35 % | reflejadas: 20.87 % | absorbidas: 76.79 %
hilos = 4 | tiempo = 0.173 s | transmitidas: 2.34 % | reflejadas: 20.85 % | absorbidas: 76.81 %
hilos = 8 | tiempo = 0.091 s | transmitidas: 2.35 % | reflejadas: 20.85 % | absorbidas: 76.8 %
```

dos cosas para notar:

1. **escala 8x con 8 hilos** (0.726 -> 0.091 s). Compara con `stencilCalor/` que apenas llegaba a 1.1x: Monte Carlo hace MUCHO calculo por cada byte de memoria que toca (compute-bound), el stencil al reves (memory-bound). Los simuladores Monte Carlo son el caso ideal para OpenMP
2. la fisica es estable entre corridas y numeros de hilos (varia en el 2do decimal porque cada hilo usa semillas distintas — es Monte Carlo, esa variacion estadistica es normal y esperada)
