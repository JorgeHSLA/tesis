# de que trata?

es la SOLUCION al problema de false sharing del ejemplo `spmd/`. En vez de que cada hilo escriba en un array compartido (donde las casillas se pelean la linea de cache), cada hilo acumula en una variable local PRIVADA y al final suma su resultado al total protegiendose con `critical`.

fuente: ejercicio 3 "Pi_spmd_final" del tutorial de Tim Mattson

- https://github.com/tgmattso/OpenMP_intro_tutorial
- slides: http://bebop.cs.berkeley.edu/bootcamp2014/omp-exercises.pdf

## EXPLICACION

`local_sum = 0.0` = el acumulador PRIVADO. Como esta en la lista `private(...)`, cada hilo tiene el suyo en su propio stack -> cero peleas de cache

`with openmp("critical"):` = seccion critica: solo UN hilo a la vez puede estar dentro de este bloque. Los demas esperan en la puerta

`total += local_sum` = la unica operacion sobre la variable compartida. Se hace UNA vez por hilo (no una por iteracion!!), asi que el costo del critical es despreciable

## detalles

output real en esta maquina (8 nucleos):

```
hilos = 1 | pi = 3.141592653589731 | tiempo = 0.012768983840942383 s
hilos = 2 | pi = 3.141592653589985 | tiempo = 0.007388114929199219 s
hilos = 4 | pi = 3.141592653589686 | tiempo = 0.0066070556640625 s
hilos = 8 | pi = 3.1415926535898064 | tiempo = 0.011782169342041016 s
```

comparalo con `spmd/`: con 1 hilo ya es ~3x mas rapido (no hay trafico de cache raro) y con 4 hilos escala de verdad.

IMPORTANTE para pyomp 0.5.x:
- `critical` SI esta soportado (sin nombre; `critical(nombre)` NO esta implementado)
- `atomic` NO existe en pyomp 0.5.x — en C usarias `#pragma omp atomic` para esto mismo, aqui la unica opcion es `critical`
- poner el `critical` DENTRO del bucle seria correctisimo pero lentisimo (serializa todo). La gracia es: acumula privado, protege solo el final
