# Entorno de datos: private, firstprivate y shared

Este ejemplo **NO calcula nada útil a propósito**: es un laboratorio para ver con tus propios ojos la diferencia entre `private`, `firstprivate` y `shared` (el «entorno de datos» de OpenMP), más tres directivas de sincronización: `critical`, `barrier` y `single`.

Es la parte más importante de OpenMP: **el 90% de los bugs paralelos son variables mal declaradas**.

## Explicación línea a línea

- `private(x, tid)` = cada hilo tiene **SU copia** de `x`, **SIN valor inicial garantizado**. Lo que el hilo haga con ella no se ve fuera. Al salir de la región, la `x` original sigue valiendo 100.
- `firstprivate(zfp)` = igual que `private` **PERO** la copia de cada hilo arranca con el valor que tenía la variable antes de la región (10). Por eso cada hilo imprime 10 + su `tid`.
- `shared(zsh)` = hay **UNA SOLA** `zsh` para todos los hilos. Por eso hay que proteger el `zsh += 1` con `critical` (si no, data race).
- `with openmp("barrier"):` = punto de encuentro: **ningún hilo pasa hasta que TODOS hayan llegado**. Aquí garantiza que los 4 ya sumaron a `zsh` antes de imprimirla.
- `with openmp("single"):` = el bloque lo ejecuta **UN solo hilo** (el primero que llegue). Útil para imprimir o inicializar algo una sola vez dentro de una región paralela.

## Output real

Con `num_threads(4)` en la directiva:

```
[single] ya llegaron todos, zsh = 4
hilo 3 -> x privada = 3000 | zfp firstprivate = 13
hilo 0 -> x privada = 0 | zfp firstprivate = 10
hilo 2 -> x privada = 2000 | zfp firstprivate = 12
hilo 1 -> x privada = 1000 | zfp firstprivate = 11
despues de la region: x = 100 | zfp = 10 | zsh = 4
```

Fíjate en la última línea: fuera de la región, `x` y `zfp` **recuperan sus valores originales** (100 y 10) porque los hilos trabajaron sobre **COPIAS**. Solo `zsh` (shared) conserva el efecto de los hilos (4 sumas = 4). Las líneas de los hilos salen en orden no determinista.

## Notas para pyomp 0.5.x

- `master` **NO** está implementado: usa `single`.
- `default(none)` **sí** funciona, si quieres obligarte a declarar todo explícitamente.

## Fuentes

- [Adaptado del ejemplo oficial TestDataEnv.py de PyOMP](https://github.com/Python-for-HPC/PyOMP/blob/main/examples/TestDataEnv.py)
