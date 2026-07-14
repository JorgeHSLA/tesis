# de que trata?

este ejemplo NO calcula nada util a proposito: es un laboratorio para ver con tus propios ojos la diferencia entre `private`, `firstprivate` y `shared` (el "entorno de datos" de OpenMP), mas tres directivas de sincronizacion: `critical`, `barrier` y `single`.

es la parte mas importante de OpenMP: el 90% de los bugs paralelos son variables mal declaradas.

fuente: adaptado del ejemplo oficial TestDataEnv.py de PyOMP

- https://github.com/Python-for-HPC/PyOMP/blob/main/examples/TestDataEnv.py

## EXPLICACION

`private(x, tid)` = cada hilo tiene SU copia de x, SIN valor inicial garantizado. Lo que el hilo haga con ella no se ve fuera. Al salir de la region, la x original sigue valiendo 100

`firstprivate(zfp)` = igual que private PERO la copia de cada hilo arranca con el valor que tenia la variable antes de la region (10). Por eso cada hilo imprime 10 + su tid

`shared(zsh)` = hay UNA SOLA zsh para todos los hilos. Por eso hay que proteger el `zsh += 1` con `critical` (si no, data race)

`with openmp("barrier"):` = punto de encuentro: ningun hilo pasa hasta que TODOS hayan llegado. Aqui garantiza que los 4 ya sumaron a zsh antes de imprimirla

`with openmp("single"):` = el bloque lo ejecuta UN solo hilo (el primero que llegue). Util para imprimir o inicializar algo una sola vez dentro de una region paralela

## detalles

output real (num_threads(4)):

```
[single] ya llegaron todos, zsh = 4
hilo 3 -> x privada = 3000 | zfp firstprivate = 13
hilo 0 -> x privada = 0 | zfp firstprivate = 10
hilo 2 -> x privada = 2000 | zfp firstprivate = 12
hilo 1 -> x privada = 1000 | zfp firstprivate = 11
despues de la region: x = 100 | zfp = 10 | zsh = 4
```

fijate en la ultima linea: fuera de la region, x y zfp recuperan sus valores originales (100 y 10) porque los hilos trabajaron sobre COPIAS. Solo zsh (shared) conserva el efecto de los hilos (4 sumas = 4).

NOTA pyomp 0.5.x: `master` NO esta implementado (usa `single`); `default(none)` si funciona si quieres obligarte a declarar todo explicitamente.
