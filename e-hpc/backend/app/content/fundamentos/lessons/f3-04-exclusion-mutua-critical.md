# Exclusión mutua: critical

Video F3.4 · ~4 minutos · Módulo F3 «Memoria compartida y sus peligros»

**Objetivo:** conocer la primera herramienta contra las race conditions — la sección crítica — y el precio que se paga por usarla mal.

## Guion

### Gancho (0:00–0:20)

Ya sabes el problema: dos hilos escribiendo la misma variable a la vez corrompen el resultado. La primera solución es de puro sentido común: que entren de a uno. Hoy conoces `critical`, la exclusión mutua de OpenMP… y su letra pequeña, que es importante.

### El baño de la casa compartida (0:20–1:20)

Vuelve a la casa donde viven los ocho hilos. Hay zonas donde no importa cuántos estén a la vez: la sala, el pasillo. Pero hay una puerta con pestillo: el baño. Entra uno, cierra el pestillo, y los demás — no importa cuánta prisa tengan — esperan afuera. Cuando sale, pasa el siguiente. Nadie choca con nadie jamás.

Fíjate en las dos caras de la analogía: el pestillo garantiza que adentro solo hay una persona… pero también crea una fila de gente parada sin hacer nada. Las dos cosas van juntas, siempre.

### La sección crítica (1:20–2:30)

En OpenMP, ese pestillo se llama `critical`. Una **sección crítica** es una región de código que solo un hilo puede ejecutar a la vez: el primero que llega entra; los demás **esperan** en la puerta hasta que quede libre. Dentro de la sección, las operaciones sobre variables compartidas son seguras: los tres pasos de leer, sumar y escribir que vimos en el video anterior se completan enteros, sin que otro hilo se intercale en medio. La race condition desaparece, garantizado.

Detalle práctico que te encontrarás en el curso: en C, para una suma simple existe además la directiva `atomic`, pero PyOMP no la implementa — así que tus opciones reales serán `critical` o la que verás en el próximo video.

### El precio: la re-serialización (2:30–3:20)

Ahora la letra pequeña. Todo hilo que espera en la puerta es tiempo de cómputo tirado a la basura. Si pones un `critical` dentro del bucle caliente — el que se ejecuta millones de veces —, tus ocho hilos pasan por la puerta de a uno, millones de veces. ¿El resultado? Un programa que en la práctica vuelve a ser serial, pero cargando además el costo de crear hilos y hacerlos esperar: la **re-serialización**. Correcto, sí. Más lento que la versión de un solo hilo, probablemente también.

De ahí la regla: `critical` es para operaciones **raras y cortas**. Nunca dentro del bucle caliente.

### Conexión con E-HPC (3:20–4:00)

La lección `spmdCritical` del módulo m2 es el ejemplo de manual de un `critical` bien puesto. Cada hilo acumula su suma parcial en una variable **privada**, sin tocar a nadie, durante todo el bucle. Y solo al final, una única vez por hilo, entra a la sección crítica para sumar su parcial al total compartido. Con 8 hilos, la puerta se cruza 8 veces en todo el programa — no millones —, así que el costo es despreciable. Esa es la receta: acumula privado, protege solo el final. Y en el próximo video verás que OpenMP puede hacer hasta eso por ti, con una sola cláusula: `reduction`.

## Apoyo visual

- 0:00–0:20 — recap animado de la actualización perdida del video F3.3, con un candado apareciendo encima.
- 0:20–1:20 — puerta con pestillo y cola de hilos esperando; contador de «1 adentro / 7 esperando».
- 1:20–2:30 — bloque de código con la región `critical` resaltada; timeline donde los accesos a la variable compartida ya no se intercalan.
- 2:30–3:20 — timeline comparado: `critical` dentro del bucle (barras de los 8 hilos casi todas en gris «esperando») vs fuera del bucle (barras llenas de trabajo útil).
- 3:20–4:00 — código de `spmdCritical` con la variable privada y el `critical` final señalados.

## Para recordar

- Una sección crítica (`critical`) es código que solo un hilo ejecuta a la vez: elimina la race por completo.
- El precio: los demás hilos esperan. Un `critical` dentro del bucle caliente re-serializa el programa.
- Regla: `critical` solo para operaciones raras y cortas — por ejemplo, una vez por hilo al final.
- El patrón correcto es «acumula en privado, protege solo la combinación final», como hace `spmdCritical` en m2.
