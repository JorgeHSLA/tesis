# Reduction: la forma elegante de acumular

Video F3.5 · ~4 minutos · Módulo F3 «Memoria compartida y sus peligros»

**Objetivo:** dominar el patrón correcto para el caso más común del paralelismo: sumar o acumular entre todos los hilos.

## Guion

### Gancho (0:00–0:20)

Acumular un total entre varios hilos es el problema más común de toda la programación paralela… y ya viste que tiene trampa: compartido sin protección es una race, y un `critical` en cada iteración es un embudo. Hoy llega la solución elegante, la que usarás el 90% de las veces: `reduction`.

### Las propinas de los meseros (0:20–1:20)

Imagina un restaurante donde todos los meseros echan sus propinas a un único frasco en la barra, billete a billete, durante todo el turno. Se cruzan, chocan, hacen fila frente al frasco: un desastre. Ahora la alternativa inteligente: cada mesero guarda sus propinas en **su propio bolsillo** durante el turno, sin consultarle nada a nadie. Y al cierre, una sola vez, cada uno canta su total y se suman todos en la caja. Mismo dinero, cero choques: durante el turno nadie comparte el frasco, y la única operación conjunta ocurre al final.

### Cómo funciona reduction (1:20–2:40)

Eso, exactamente eso, es lo que hace `reduction` en OpenMP. La idea tiene dos tiempos. Durante el bucle: cada hilo acumula en una **copia privada** de la variable, que nace inicializada para la operación — en una suma, nace en cero. Nadie toca la variable compartida, así que no hay race posible y no hay esperas de ningún tipo. Al terminar la región: OpenMP combina las copias privadas con la operación que le indicaste, de forma segura, una sola vez.

¿Y el código? Una cláusula: `reduction(+:suma)`. Se lee «reduce con suma sobre la variable suma». Con eso, el compilador hace todo el trabajo sucio: crea las copias privadas, las inicializa, y ejecuta la combinación final sin que escribas ni una línea de sincronización. El signo `+` es el más común, pero la misma cláusula existe para otras operaciones, como el producto o el máximo.

### La prueba de que funciona (2:40–3:20)

¿Recuerdas el Mandelbrot roto del video F3.3, el que daba un área distinta en cada corrida? Su versión corregida es idéntica salvo por una cosa: la cláusula `reduction(+:num_outside)`. Resultado real: 1.5103 en cada corrida, siempre el mismo valor, cerca del área verdadera de 1.506. Una cláusula, y el bug más traicionero del paralelismo desaparece — sin `critical`, sin esperas, sin perder velocidad. Es el mismo patrón «acumula privado, combina al final» del video anterior, pero automatizado: menos código tuyo, menos oportunidades de equivocarte.

### Conexión con Telar (3:20–4:00)

`reduction` es la estrella del módulo práctico m1 de Telar: el cálculo de π con un `parallel for` y `reduction(+:suma)`, el hola-mundo del paralelismo numérico. Y reaparece en m5, donde tú mismo arreglarás el Mandelbrot roto añadiendo la cláusula y verás el área quedarse quieta corrida tras corrida. Cuando en tu propio código veas un bucle que acumula sobre un total, ya sabes el reflejo: no lo compartas, no lo serialices — redúcelo.

## Apoyo visual

- 0:00–0:20 — recap en pantalla dividida: la race (resultados bailando) y el `critical` en el bucle (hilos en fila).
- 0:20–1:20 — animación de los meseros: frasco único con choques vs bolsillos individuales y suma única al cierre.
- 1:20–2:40 — árbol de combinación: 8 sumas privadas que convergen en un total; la cláusula `reduction(+:suma)` tecleándose sobre el bucle.
- 2:40–3:20 — output real de `mandelbrot`: tres corridas con race variando vs tres corridas con `reduction` clavadas en 1.5103.
- 3:20–4:00 — captura del módulo m1 en Telar con el cálculo de π.

## Para recordar

- `reduction` = cada hilo acumula en su copia privada y OpenMP combina los parciales una sola vez al final.
- Se escribe como cláusula: `reduction(+:suma)` — el compilador crea, inicializa y combina las copias por ti.
- Cero races y cero esperas durante el bucle: es más seguro que el acumulador compartido y más rápido que `critical` por iteración.
- Reflejo mental: bucle que acumula sobre un total → `reduction`.
