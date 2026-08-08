# Anatomía de tu primer programa PyOMP

Video F4.5 · ~5 minutos · Módulo F4 «OpenMP y PyOMP: tu caja de herramientas»

**Objetivo:** Recorrer línea por línea el «hola mundo» paralelo de PyOMP, juntando todo lo aprendido, y entender por qué su salida sale desordenada.

## Guion

### Gancho (0:00–0:20)

Llegó el momento de ver un programa paralelo completo, de principio a fin, sin trozos escondidos. Son apenas siete líneas, pero dentro está todo lo que aprendiste en el track: hilos, fork-join, compilación, memoria compartida. Vamos a diseccionarlo, y al final vas a poder correrlo tú mismo.

### El programa completo (0:20–1:20)

Aquí está, el «hola mundo» del paralelismo, la versión PyOMP:

```python
from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_thread_num

@njit
def hello():
    with openmp("parallel"):
        print("Hello from thread", omp_get_thread_num())

hello()
```

Eso es todo. Un programa que imprime un saludo desde cada hilo. Parece trivial, pero cada línea esconde un concepto que ya conoces. Vamos una por una.

### Línea por línea (1:20–3:10)

Las tres primeras líneas son **imports**: traen las piezas de PyOMP. El `njit` para compilar, el `openmp_context` —que renombramos a `openmp` por comodidad— para las directivas, y `omp_get_thread_num`, una función que le pregunta a cada hilo «¿quién eres tú?».

Luego el decorador **`@njit`**. Ya sabes qué hace: le dice a Numba «compila esta función a código máquina antes de correrla». Es lo que nos saca del intérprete y del GIL, lo que permite que los hilos de la siguiente línea sean hilos de verdad.

`def hello():` es una función de Python normal y corriente. Nada especial.

Y ahora el corazón: **`with openmp("parallel"):`**. Esta línea marca el inicio y el fin de una región paralela. Es el **fork** del que hablamos: al llegar aquí, del hilo maestro nacen tantos hilos como núcleos, y todos entran a ejecutar lo que hay dentro del bloque. Al cerrarse el `with`, ocurre el **join**: los hilos se cierran y vuelve el maestro.

Dentro del bloque, una sola línea: `print("Hello from thread", omp_get_thread_num())`. Esto lo ejecuta **cada hilo**. Cada uno pregunta su propio número con `omp_get_thread_num()` —el hilo 0 obtiene 0, el hilo 1 obtiene 1, y así— e imprime su saludo. Ocho hilos, ocho saludos.

### La salida desordenada (3:10–4:20)

¿Cuántos hilos se crean? Tantos como procesadores lógicos vea el sistema, o los que fijes con `OMP_NUM_THREADS`. En la máquina de referencia del curso, con ocho núcleos, salen ocho líneas. Pero mira **el orden** en el que salieron en una corrida real:

```
Hello from thread 0
Hello from thread 3
Hello from thread 6
Hello from thread 2
Hello from thread 1
Hello from thread 4
Hello from thread 7
Hello from thread 5
```

Cero, tres, seis, dos… ¡no es cero, uno, dos, tres! Y esto es lo más importante del ejemplo: ese desorden **no es un error, es la esencia del paralelismo**. Los ocho hilos corren a la vez, de forma concurrente, y no hay ninguna regla que diga quién imprime primero. El que gane la carrera hasta el `print`, imprime. En la siguiente corrida el orden será distinto. Recuerda el video de las race conditions: cuando no hay sincronización de orden, el orden es impredecible. Aquí no importa —son saludos— pero si esto fuera una suma a una variable compartida, ya sabes el lío en que estaríamos.

### Conexión con Telar (4:20–5:00)

Y aquí está lo bueno: este programa es una de las lecciones prácticas del simulador, la primera. Cuando termines el track, tu primer job va a ser exactamente este. Te lanzo un reto: ¿en qué orden saldrán los saludos en la máquina de Telar? No lo adivines: córrelo, míralo, y córrelo otra vez para ver si cambia. Ese es el momento en que el paralelismo deja de ser teoría. En el último video del track te enseño a leer todo lo que el simulador te va a mostrar.

## Apoyo visual

- 0:00–0:20 — Las 7 líneas del programa apareciendo en el editor, resaltadas como «tu primer programa paralelo».
- 0:20–1:20 — El código completo en pantalla, limpio, con numeración de líneas.
- 1:20–3:10 — Cada línea se resalta al explicarla; iconos que conectan: `@njit`→compilar, `with openmp`→fork/join, `omp_get_thread_num`→«¿quién eres?».
- 3:10–4:20 — La salida real de 8 líneas en orden 0,3,6,2,1,4,7,5; se marca «¡no está ordenado!» y «esto es correcto»; ocho hilos corriendo una carrera hacia el print.
- 4:20–5:00 — El ejemplo abriéndose en el simulador de Telar con el botón «Probar en el simulador».

## Para recordar

- El «hola mundo» PyOMP tiene 3 partes: imports, `@njit` (compilar), y `with openmp("parallel")` (la región paralela = fork/join).
- Dentro de la región, **cada hilo** ejecuta el bloque; `omp_get_thread_num()` le da su identidad.
- Se crean tantos hilos como núcleos (o los de `OMP_NUM_THREADS`).
- La salida sale **desordenada** y eso es correcto: los hilos corren a la vez sin orden garantizado.
