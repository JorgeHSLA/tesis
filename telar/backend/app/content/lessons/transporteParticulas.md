# Transporte de partículas Monte Carlo (slab 1D)

Un **SIMULADOR de verdad**: transporte de partículas por Monte Carlo a través de una placa (*slab*) 1D — el «hola mundo» del transporte de radiación. Cada partícula recorre distancias aleatorias, choca, y en cada choque o es absorbida o sale dispersada en otra dirección; contamos cuántas atraviesan la placa, cuántas rebotan y cuántas mueren dentro.

Este es EL ejemplo más cercano a un código de producción: el código real **MCDC-TNT** (transporte de neutrones de Oregon State / proyecto CEMeNT) usa PyOMP en producción con exactamente este patrón. O sea: lo que aprendes aquí es lo que se usa en simuladores nucleares reales escritos en Python.

## La física (simplificada)

- `dist = -np.log(r) / sigma_t` = distancia hasta el próximo choque, muestreada de una **exponencial** (camino libre medio = 1/σt).
- `x = x + mu * dist` = avanzar. `mu` es el coseno de la dirección: +1 hacia adentro, −1 hacia atrás.
- Si `x < 0` → **REFLEJADA** (salió por donde entró); si `x > espesor` → **TRANSMITIDA** (atravesó); si no, chocó dentro:
- con probabilidad `prob_abs` → **ABSORBIDA**; si no → dispersión isotrópica: nueva dirección `mu` aleatoria en [−1, 1].

## El OpenMP (combina TODO lo aprendido)

- `parallel private(tid, s, x, mu, r, dist, viva)` = región paralela con el estado de la partícula **privado por hilo** (como en `entornoDatos/`).
- `s = seeds[tid]` = generador aleatorio **privado por hilo** (el truco de `monteCarloPi/`).
- `for reduction(+:transmitidas, reflejadas, absorbidas)` = reducción sobre **TRES contadores a la vez** (sí, se puede poner una lista).
- El `while viva` dentro del `for` = cada partícula vive un número DISTINTO e impredecible de choques. Esto es **carga irregular**, y aun así escala perfecto porque hay millones de partículas por hilo (la irregularidad se promedia).

## Output real

Con 5 millones de partículas, placa de 5 caminos libres, 30% de absorción:

```
hilos = 1 | tiempo = 0.726 s | transmitidas: 2.35 % | reflejadas: 20.84 % | absorbidas: 76.81 %
hilos = 2 | tiempo = 0.256 s | transmitidas: 2.35 % | reflejadas: 20.87 % | absorbidas: 76.79 %
hilos = 4 | tiempo = 0.173 s | transmitidas: 2.34 % | reflejadas: 20.85 % | absorbidas: 76.81 %
hilos = 8 | tiempo = 0.091 s | transmitidas: 2.35 % | reflejadas: 20.85 % | absorbidas: 76.8 %
```

Dos cosas para notar:

1. **Escala 8x con 8 hilos** (0.726 → 0.091 s). Compara con `stencilCalor/`, que apenas llegaba a 1.1x: Monte Carlo hace MUCHO cálculo por cada byte de memoria que toca (**compute-bound**); el stencil, al revés (**memory-bound**). Los simuladores Monte Carlo son el caso ideal para OpenMP.
2. La física es **estable** entre corridas y números de hilos (varía en el 2.º decimal porque cada hilo usa semillas distintas — es Monte Carlo, esa variación estadística es normal y esperada).

## Fuentes

- [MCDC-TNT (kernel real: advance_omp.py)](https://github.com/SoftwareDevEngResearch/mcdc_tnt)
- Física: cualquier libro de métodos Monte Carlo en transporte de radiación (el *slab problem* es el hola-mundo del área).
