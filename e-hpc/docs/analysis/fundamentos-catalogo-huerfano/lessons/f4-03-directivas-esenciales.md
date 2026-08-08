# Tour por las directivas esenciales

Video F4.3 · ~5 minutos · Módulo F4 «OpenMP y PyOMP: tu caja de herramientas»

**Objetivo:** Tener un mapa de las siete directivas y cláusulas que cubren el noventa y cinco por ciento del curso, cada una con un ejemplo de una línea.

## Guion

### Gancho (0:00–0:20)

OpenMP tiene decenas de directivas, pero la verdad es que con siete te comes casi todo lo que vas a necesitar en este curso. En los próximos cinco minutos te doy el mapa completo: una directiva, un ejemplo de una línea, para qué sirve. No hay que memorizar nada; esto es tu chuleta.

### parallel y for (0:20–1:30)

La primera y la más fundamental: **`parallel`**. Abre una región paralela, es decir, hace el fork del video anterior. En PyOMP se escribe así:

```python
with openmp("parallel"):
    ...
```

Todo lo que va dentro de ese bloque lo ejecutan todos los hilos a la vez. Es la puerta de entrada al paralelismo; sin ella no hay hilos.

La segunda casi siempre va pegada a la primera: **`for`**. Le dice a OpenMP «este bucle, repártelo entre los hilos»: en vez de que cada hilo dé todas las vueltas, cada uno se lleva un trozo de las iteraciones. Se suelen combinar en una sola línea, `parallel for`:

```python
with openmp("parallel for"):
    for i in range(n):
        ...
```

Esta combinación, `parallel for`, es probablemente la línea de OpenMP que más veces vas a escribir en tu vida. Reparte un bucle grande entre todos los núcleos, sin que tú tengas que calcular a mano qué iteración le toca a quién.

### reduction (1:30–2:20)

La tercera resuelve el problema estrella del módulo anterior: acumular sin races. **`reduction`**. Recuerda: si ocho hilos suman a un mismo total, tienes una race o un `critical` lento. La cláusula `reduction` hace que cada hilo acumule en su copia privada y al final las combine, todo automático:

```python
with openmp("parallel for reduction(+:suma)"):
    for i in range(n):
        suma += f(i)
```

Ese `reduction(+:suma)` le dice a OpenMP «la variable suma es un acumulador con la operación más; encárgate de que cada hilo sume por su lado y de juntarlo bien al final». Elegante y sin bugs.

### private, shared, firstprivate (2:20–3:20)

Las tres siguientes son cláusulas de **entorno de datos**, la decisión que vimos en su propio video: quién ve qué. **`shared`**: una sola variable para todos los hilos. **`private`**: cada hilo su propia copia, sin valor inicial —ideal para contadores y temporales—. **`firstprivate`**: como private, pero la copia nace con el valor que la variable tenía afuera. Se declaran en la misma directiva:

```python
with openmp("parallel private(x, i) shared(datos)"):
    ...
```

Regla rápida que ya conoces: temporales y contadores, privados; los datos grandes de entrada y salida, compartidos.

### critical, barrier, single, task (3:20–4:20)

Y el último grupo, de sincronización. **`critical`**: bloque que ejecuta un solo hilo a la vez, el pestillo del baño, para proteger operaciones sobre memoria compartida. **`barrier`**: punto de encuentro donde todos esperan a todos. **`single`**: un bloque que ejecuta un único hilo mientras los demás esperan.

```python
with openmp("critical"):
    total += local
```

Y una que aún no vimos y que abre un mundo entero: **`task`**. En vez de repartir un bucle, crea una unidad de trabajo suelta que cualquier hilo libre puede tomar. Es la base del patrón divide y vencerás —recursión, árboles, trabajo irregular— y tiene su propio módulo práctico más adelante.

### Cierre y conexión con Telar (4:20–5:00)

Ese es el mapa: `parallel`, `for`, `reduction`, `private`/`shared`/`firstprivate`, `critical`, `barrier`/`single`, y `task`. Con esas siete piezas construyes casi cualquier programa del curso. Y lo mejor: **no las memorices ahora**. Cada una tiene su lección práctica en el simulador, con código real que vas a ejecutar y medir. Esto era solo el mapa para que, cuando las encuentres, ya sepas de qué te hablan. En el próximo video resolvemos el gran misterio: cómo es posible escribir todo esto en Python.

## Apoyo visual

- 0:00–0:20 — Una tabla-mapa con las 7 directivas apagadas; se irán encendiendo una a una.
- 0:20–1:30 — `parallel` y `parallel for` con su código; animación de un bucle repartiéndose entre 4 hilos.
- 1:30–2:20 — `reduction(+:suma)`: 8 sumas privadas combinándose en un total en árbol.
- 2:20–3:20 — Tres cajas: shared (una para todos), private (copia por hilo sin valor), firstprivate (copia con valor inicial).
- 3:20–4:20 — critical (pestillo), barrier (línea de meta), single (uno actúa), task (fichas sueltas que los hilos toman).
- 4:20–5:00 — La tabla-mapa completa iluminada como «chuleta descargable»; transición a PyOMP.

## Para recordar

- `parallel` abre la región (fork); `for` reparte un bucle; juntas, `parallel for`, es la línea más usada.
- `reduction(+:x)` acumula sin races automáticamente.
- `private` / `shared` / `firstprivate` deciden quién ve qué variable.
- `critical`, `barrier`, `single` sincronizan; `task` crea trabajo suelto para el patrón divide y vencerás. No las memorices: cada una tiene su práctica.
