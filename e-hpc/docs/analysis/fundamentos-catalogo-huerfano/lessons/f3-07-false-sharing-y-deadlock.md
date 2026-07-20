# False sharing y deadlock: los enemigos invisibles

Video F3.7 · ~5 minutos · Módulo F3 «Memoria compartida y sus peligros»

**Objetivo:** Reconocer dos problemas avanzados — el false sharing (paralelo correcto pero lento) y el deadlock (nadie avanza) — para saber identificarlos, aunque su dominio completo venga después.

## Guion

### Gancho (0:00–0:20)

Este es el último video del módulo, y trae los dos enemigos más escurridizos del paralelismo. El primero no rompe tu resultado: lo hace lento sin que entiendas por qué. El segundo congela tu programa entero. Se llaman false sharing y deadlock, y con reconocerlos ya ganas mucho.

### La memoria viaja en bloques (0:20–1:40)

Para entender el false sharing hay que saber un secreto del hardware. Cuando tu programa lee una variable de la memoria, el procesador no trae solo esa variable: trae un bloque entero de memoria contigua, de unos sesenta y cuatro bytes, que se llama **línea de caché**. Es como cuando abres la nevera para un huevo y sacas toda la huevera: es más eficiente mover el cartón completo que ir huevo por huevo.

Ahora el problema. Imagina dos hilos que trabajan sobre variables **distintas** —cada uno la suya, sin compartir nada a nivel lógico— pero que resulta que esas dos variables están **pegadas en memoria**, dentro de la misma línea de caché. Aunque el hilo A solo toca su variable y el hilo B solo la suya, el hardware trae y gestiona el cartón completo. Cada vez que A escribe, el sistema invalida la copia que tenía B de toda la línea, y B tiene que volver a traerla; cuando B escribe, invalida la de A. Se pasan el cartón de huevos de un lado a otro sin parar, aunque cada uno solo quería su propio huevo.

### Correcto pero lento (1:40–2:50)

El resultado es lo que hace al false sharing tan traicionero: tu programa es **perfectamente correcto** —da el resultado exacto— pero va **lento**, a veces tan lento que el paralelismo no aporta nada. No hay ningún bug de lógica que encontrar; el problema está en cómo quedaron colocadas las variables en memoria.

Y esto no es teórico: es una pareja de ejemplos que vas a correr en el curso. Hay una versión del cálculo de π donde cada hilo guarda su suma parcial en una casilla de un array compartido. Las casillas quedan pegadas en la misma línea de caché, y el resultado es que con ocho hilos casi no hay speedup: los tiempos apenas bajan. La versión arreglada hace algo muy simple: cada hilo acumula en una variable **privada**, en su propio stack, lejos de las casillas de los demás. Con ese único cambio, el mismo programa pasa a ser hasta tres veces más rápido ya con un hilo, y por fin escala. Misma lógica, mismo resultado; la diferencia es puramente el false sharing. La lección práctica: cuando cada hilo necesite acumular, que lo haga en algo **privado**, no en casillas vecinas de un array compartido.

### Deadlock: el abrazo mortal (2:50–4:10)

El segundo enemigo es más dramático. Un **deadlock** es un abrazo mortal: dos hilos que se esperan mutuamente para siempre. El hilo A tiene algo que B necesita y no lo suelta hasta que B le dé algo; pero B tampoco lo suelta hasta que A le dé lo suyo. Ninguno cede, ninguno avanza, el programa se queda congelado.

La imagen clásica es un puente de un solo carril. Un coche entra por el este, otro por el oeste, se encuentran en el medio. Para que pase uno, el otro tiene que dar marcha atrás. Si ninguno cede, ahí se quedan los dos, bloqueados indefinidamente. Eso es un deadlock.

Ahora, una buena noticia para este curso: con OpenMP estructurado, usando `critical` sin nombre como hiciste en los videos anteriores, el riesgo de deadlock es **bajo**, porque el runtime gestiona las esperas de forma ordenada. Los deadlocks aparecen sobre todo cuando manejas varios candados a mano, o en el mundo de MPI donde dos procesos se quedan esperando el mensaje del otro. Pero el concepto es esencial en toda la concurrencia, y por eso lo tienes que reconocer: si alguna vez tu programa paralelo se queda colgado, sin consumir CPU, sin avanzar ni terminar, la primera sospecha es un deadlock.

### Conexión con E-HPC y cierre del módulo (4:10–5:00)

En el simulador vas a ejecutar tú mismo la pareja del false sharing: la versión lenta y la arreglada, una al lado de la otra, y verás la diferencia de tiempos en la pantalla de resultados. No te lo van a contar: lo vas a medir. Con esto cierras el módulo más importante del track. Ya sabes qué es la memoria compartida, por qué provoca races, y las herramientas para domarla: private, critical, reduction, barreras, y ahora reconoces el false sharing y el deadlock. En el último módulo por fin le ponemos nombre y sintaxis a todo esto: OpenMP y PyOMP.

## Apoyo visual

- 0:00–0:20 — Dos iconos: un caracol (lento pero correcto) y un candado congelado (bloqueado); títulos «false sharing» y «deadlock».
- 0:20–1:40 — Una línea de caché de 64 bytes como un cartón de huevos; dos hilos, cada uno con su huevo, pasándose el cartón completo de un lado a otro.
- 1:40–2:50 — Comparación de tiempos de los dos ejemplos de π (array compartido vs acumulador privado); barras de tiempo casi iguales vs escalando.
- 2:50–4:10 — Dos coches frente a frente en un puente de un carril, ninguno cede; ciclo de espera A→B→A.
- 4:10–5:00 — Pantalla de resultados de E-HPC comparando las dos versiones; resumen de las herramientas del módulo F3.

## Para recordar

- La memoria viaja en **líneas de caché** (~64 bytes): al leer una variable se trae todo el bloque vecino.
- **False sharing**: dos hilos escriben variables distintas pero vecinas en la misma línea; el programa es correcto pero lento. Solución: acumular en variables **privadas**.
- **Deadlock**: ciclo de espera mutua (A espera a B, B espera a A); el programa se congela sin avanzar.
- Con `critical` sin nombre el riesgo de deadlock es bajo, pero el concepto es esencial en toda la concurrencia.
