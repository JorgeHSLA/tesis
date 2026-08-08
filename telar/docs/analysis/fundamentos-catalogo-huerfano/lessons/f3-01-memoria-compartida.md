# Memoria compartida: bendición y maldición

Video F3.1 · ~4 minutos · Módulo F3 «Memoria compartida y sus peligros»

**Objetivo:** enmarcar el módulo — compartir memoria es exactamente lo que hace a los hilos potentes y, a la vez, peligrosos.

## Guion

### Gancho (0:00–0:20)

Ocho hilos, una sola memoria. Esa combinación es al mismo tiempo la mayor ventaja y el mayor peligro de la programación con hilos. En este video abrimos el módulo más importante del curso: vas a entender por qué compartir memoria hace a los hilos tan potentes… y por qué exige respeto.

### La pizarra compartida (0:20–1:30)

Recuerda la casa del módulo F1: el proceso es la casa y los hilos son las personas que viven en ella, compartiendo cocina y nevera. Hoy cambia la imagen por una oficina con una única pizarra gigante. Ocho personas trabajan alrededor de ella. Todo lo que alguien anota, los demás lo ven al instante: sin llamadas, sin correos, sin esperar a nadie. Miran la pizarra y ya está.

Eso es la memoria compartida: todas las variables de tu programa viven en esa pizarra, a la vista de todos los hilos.

Mientras cada persona escribe en una zona distinta, el sistema es maravilloso. Pero ¿qué pasa si dos escriben sobre el mismo renglón al mismo tiempo? Una borra lo que la otra acababa de poner, los trazos se mezclan, y lo que queda no es lo que escribió ninguna de las dos. Y fíjate: nadie hizo nada «mal». Simplemente nadie coordinó quién escribía y cuándo.

### La bendición: comunicarse es gratis (1:30–2:20)

Primero la bendición. En el modelo de procesos que vimos en F1.3, cada programa tiene su memoria privada: para pasarle un dato a otro proceso hay que empaquetarlo y enviarlo, como mandar una carta. Con hilos, no. Todos ven el mismo array, la misma matriz, las mismas variables. Repartir trabajo es tan simple como decir «tú procesas esta mitad y yo la otra», sin copiar nada, sin transferir nada. Por eso OpenMP, la herramienta central de este curso, se construye sobre hilos y memoria compartida: la comunicación es gratis.

### La maldición: pisarse es fácil (2:20–3:10)

Ahora la maldición. Que todos puedan escribir en la misma pizarra significa que dos hilos pueden escribir la misma variable a la vez. Cuando eso ocurre, el resultado final depende del orden exacto de las escrituras — un orden que nadie garantiza y que cambia en cada ejecución. El programa compila, corre, no crashea… y aun así puede devolver resultados corruptos. Este tipo de bug no existe en los programas seriales: es el precio de compartir memoria, y hay que aprender a pagarlo con las herramientas correctas.

### El mapa del módulo (3:10–3:40)

Este módulo es el mapa completo de esos peligros y de sus antídotos. Primero, la decisión número uno: qué variables son `private` y cuáles `shared`. Luego, el enemigo principal: las race conditions. Después, las herramientas: `critical` para la exclusión mutua, `reduction` para acumular con elegancia, `barrier` y `single` para marcar el ritmo del equipo. Y cerramos con dos enemigos invisibles: el false sharing y el deadlock.

### Conexión con Telar (3:40–4:00)

Nada de esto se queda en teoría. En Telar hay una lección con un bug de memoria compartida puesto a propósito, para que lo veas fallar en vivo, y otra pareja de lecciones que mide con cronómetro cuánto cuesta compartir mal. En este módulo aprendes los conceptos; en el simulador los vas a romper y arreglar tú. Empezamos.

## Apoyo visual

- 0:00–0:20 — título del módulo sobre un diagrama de 8 hilos apuntando a un mismo bloque de memoria.
- 0:20–1:30 — animación de la pizarra: 8 personas escriben en zonas distintas (todo fluye) y luego dos coinciden en el mismo renglón (los trazos se corrompen).
- 1:30–2:20 — contraste procesos vs hilos: dos cajas aisladas mandándose «cartas» frente a una casa con un solo array visible para todos.
- 2:20–3:10 — dos flechas de escritura llegando a la misma variable con un signo de interrogación en el valor final.
- 3:10–4:00 — mapa del módulo como ruta con 6 paradas: private/shared → races → critical → reduction → barrier/single → false sharing y deadlock.

## Para recordar

- Todos los hilos de un proceso ven las mismas variables: esa es la memoria compartida.
- La bendición: la comunicación entre hilos es gratis — no hay mensajes, todos leen el mismo array.
- La maldición: dos hilos escribiendo la misma variable a la vez producen resultados que dependen del azar del orden de ejecución.
- Este módulo recorre los peligros (races, false sharing, deadlock) y sus antídotos (`private`, `critical`, `reduction`, `barrier`, `single`).
