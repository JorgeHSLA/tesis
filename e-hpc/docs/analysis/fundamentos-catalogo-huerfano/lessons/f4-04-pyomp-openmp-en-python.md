# PyOMP: OpenMP en Python

Video F4.4 · ~5 minutos · Módulo F4 «OpenMP y PyOMP: tu caja de herramientas»

**Objetivo:** Entender cómo PyOMP permite escribir OpenMP en Python compilando con Numba, por qué esquiva el GIL, y qué parte del estándar soporta la versión 0.5.

## Guion

### Gancho (0:00–0:20)

En el módulo uno te dije que Python tiene un cerrojo, el GIL, que impide el paralelismo real de hilos. Y en todo este módulo te he enseñado OpenMP, que es de C, C++ y Fortran. Entonces, ¿cómo diablos vamos a hacer paralelismo de verdad, en Python, en este curso? La respuesta se llama PyOMP, y es más elegante de lo que imaginas.

### El problema (0:20–1:20)

Recapitulemos el dilema. Python es el idioma de la ciencia: fácil de escribir, con NumPy, con un ecosistema enorme. Pero tiene dos problemas para el cálculo pesado. Uno: es lento, porque cada instrucción la interpreta un intérprete en tiempo de ejecución, sin compilar. Dos: el GIL, ese candado global que hace que, aunque lances ocho hilos de Python, solo uno ejecute código Python a la vez. Para cómputo paralelo, es un muro.

C no tiene ninguno de esos problemas: es compilado y sus hilos corren de verdad en paralelo. Por eso OpenMP nació en C. Parecería que estamos condenados a elegir: o la comodidad de Python, o el paralelismo de C.

### La solución: compilar y salir del intérprete (1:20–2:50)

PyOMP rompe esa falsa elección con un truco precioso. Se apoya en **Numba**, una herramienta que **compila** funciones de Python a código máquina nativo, justo antes de ejecutarlas. Marcas una función con el decorador `@njit` y Numba la traduce a instrucciones de procesador, como si la hubieras escrito en C.

Y aquí está la clave: una vez que tu función está compilada a código máquina, **ya no la ejecuta el intérprete de Python**. Y si no pasa por el intérprete… **el GIL no aplica**. PyOMP crea los hilos dentro de ese código ya compilado, fuera del alcance del candado. Resultado: paralelismo real de hilos, con los ocho núcleos trabajando de verdad, escribiendo Python. Lo mejor de los dos mundos.

Las directivas se escriben así, con un bloque `with`:

```python
from numba.openmp import njit
from numba.openmp import openmp_context as openmp

@njit
def calcular(n):
    with openmp("parallel for reduction(+:suma)"):
        for i in range(n):
            suma += f(i)
```

Fíjate en un detalle que vale oro: **la sintaxis dentro del string es la misma de OpenMP en C**. Ese `"parallel for reduction(+:suma)"` es idéntico a lo que escribirías en un `#pragma` de C. Por eso lo que aprendes en este curso se transfiere directo al OpenMP de C y C++: cambias la envoltura, pero las directivas son las mismas.

### La regla del JIT y el warmup (2:50–3:50)

Hay una peculiaridad de Numba que tienes que conocer o te va a confundir al medir tiempos. La compilación ocurre en la **primera llamada** a la función. Es decir, la primera vez que ejecutas `calcular(...)`, Numba primero traduce todo a código máquina —y eso tarda— y luego corre. Las siguientes llamadas usan la versión ya compilada y vuelan.

¿Qué implica esto? Que si cronometras la primera llamada, estás midiendo compilación más ejecución, no el rendimiento real de tu código. Por eso, todos los ejemplos del curso hacen una **llamada de calentamiento** —un *warmup*— antes de medir: una primera ejecución que fuerza la compilación y cuyo tiempo se descarta. Solo después se cronometra de verdad. Si ves «warmup» en el código, ya sabes por qué está ahí.

### Honestidad sobre la versión 0.5 (3:50–4:30)

Y una nota de honestidad técnica, importante para no frustrarte. PyOMP está en la versión 0.5, y **no implementa todo el estándar de OpenMP**. Las directivas que enseñamos en este módulo —`parallel`, `for`, `reduction`, `private`, `shared`, `firstprivate`, `critical`, `barrier`, `single`, `task`— sí funcionan y están verificadas. Pero otras que aparecen en libros de OpenMP, como `atomic`, `sections`, `master`, o `schedule(dynamic)`, **no** están disponibles todavía en esta versión. El curso está diseñado a propósito usando solo lo que funciona de verdad, y cuando algo no está soportado, te enseñamos el sustituto: por ejemplo, donde en C usarías `atomic`, aquí usas `critical`.

### Conexión con E-HPC (4:30–5:00)

Todo el simulador de E-HPC corre sobre PyOMP: cuando lances un job, tu código Python decorado con `@njit` se compila y se ejecuta con hilos reales dentro del contenedor. Ya entiendes la magia que lo hace posible. En el próximo video desmenuzamos, línea por línea, tu primer programa PyOMP de verdad.

## Apoyo visual

- 0:00–0:20 — El logo de Python con un candado (GIL) y el logo de OpenMP (C/C++); interrogante entre ambos.
- 0:20–1:20 — Balanza: «Python: cómodo pero lento + GIL» vs «C: rápido y paralelo pero incómodo».
- 1:20–2:50 — Pipeline: código Python → `@njit` / Numba → código máquina → hilos creados FUERA del intérprete (el candado GIL tachado).
- 2:50–3:50 — Línea de tiempo de dos llamadas: la 1ª larga (compila + corre), las siguientes cortas; rótulo «warmup = descartar la 1ª».
- 3:50–5:00 — Tabla «SÍ funciona / NO funciona en 0.5.x»; ejemplo `atomic → critical`; transición al editor de E-HPC.

## Para recordar

- PyOMP = OpenMP en Python, apoyado en **Numba**, que compila la función (`@njit`) a código máquina.
- Al salir del intérprete, el **GIL no aplica**: se obtiene paralelismo real de hilos.
- La sintaxis dentro de `openmp("...")` es **la misma de C**: lo aprendido se transfiere directo.
- La 1ª llamada compila (por eso el **warmup** antes de medir). La versión 0.5 no soporta todo el estándar; el curso usa solo lo verificado y enseña los sustitutos.
