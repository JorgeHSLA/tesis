# Barreras, single y el ritmo del equipo

Video F3.6 · ~4 minutos · Módulo F3 «Memoria compartida y sus peligros»

**Objetivo:** Entender la sincronización colectiva — cuándo hacer que todos los hilos esperen (`barrier`) y cuándo dejar que solo uno actúe (`single`) — y su costo.

## Guion

### Gancho (0:00–0:20)

Hasta ahora hablamos de evitar que los hilos se pisen. Pero hay otro problema de coordinación, más sutil: a veces necesitas que **todos** los hilos lleguen a un punto antes de que **cualquiera** continúe. Como un grupo de excursión frente a un río. De eso van las barreras, y su prima hermana, el `single`.

### La excursión (0:20–1:30)

Imagina un grupo de ocho excursionistas caminando a distinto ritmo. Llegan a un río con un puente estrecho, y la regla del guía es clara: **nadie cruza hasta que lleguen todos**. Los primeros en llegar esperan. Cuando el último pone un pie en la orilla, entonces sí, todos cruzan juntos. Ese punto de encuentro obligatorio es una **barrera**.

¿Por qué haría falta algo así en un programa? Piensa en un cálculo por fases. En la fase uno, cada hilo rellena su parte de un array grande. En la fase dos, los hilos necesitan **leer** el array completo para el siguiente paso. Si un hilo rápido empieza la fase dos antes de que un hilo lento haya terminado de escribir su parte… va a leer datos a medio cocinar. La barrera lo impide: nadie pasa a la fase dos hasta que todos terminaron la fase uno.

### barrier y single (1:30–3:00)

En OpenMP esto es una directiva: `barrier`. Cuando un hilo llega a un `barrier`, se detiene y espera; solo cuando **todos** los hilos del equipo han llegado, se liberan juntos. Es el punto de sincronización colectiva por excelencia.

Ahora la prima hermana. A veces, dentro de una región paralela, hay una tarea que debe hacer **exactamente un hilo, no los ocho**. Por ejemplo: imprimir un mensaje de progreso, o inicializar una variable compartida una sola vez. Si los ocho hilos lo hacen, tienes ocho mensajes repetidos o una inicialización hecha ocho veces. Para eso está `single`: marca un bloque que ejecuta **un solo hilo** —el primero que llegue— mientras los demás esperan a que termine. Volviendo a la excursión: solo una persona va a comprar los tickets del puente mientras el resto descansa; no tiene sentido que vayan los ocho a la misma taquilla.

Un matiz útil que verás en el módulo práctico: `single` lleva una barrera implícita al final. Es decir, cuando el hilo elegido termina su bloque, los demás lo estaban esperando de todas formas, y salen todos juntos. Tiene sentido: normalmente lo que ese único hilo preparó, los demás lo van a necesitar justo después.

### El costo: toda espera es tiempo perdido (3:00–3:35)

Pero cuidado, que aquí volvemos a un tema del módulo anterior: **toda espera es speedup perdido**. Cada vez que pones una barrera, los hilos rápidos se quedan de brazos cruzados esperando al más lento. Ese tiempo ocioso no lo recuperas. Por eso la regla es la misma de siempre: sincroniza **solo cuando la correctitud lo exige**, nunca «por si acaso». Una barrera de más no rompe tu programa, pero lo frena. El buen código paralelo tiene las mínimas barreras necesarias, y ni una más.

### Conexión con Telar (3:35–4:00)

En el simulador vas a encontrar `barrier` y `single` en acción en varias lecciones prácticas: el ejemplo de entorno de datos los usa para ordenar sus fases, y el de difusión de calor los necesita entre cada paso de la simulación. Cuando los veas, reconoce el patrón: es el grupo de excursión esperando en el río. En el próximo video, el último del módulo, cerramos con dos enemigos invisibles: el false sharing y el deadlock.

## Apoyo visual

- 0:00–0:20 — Ocho excursionistas a distinto ritmo acercándose a un río con un puente estrecho.
- 0:20–1:30 — Los rápidos esperan en la orilla; cuando llega el último, todos cruzan juntos; rótulo «barrier».
- 1:30–2:15 — Diagrama de dos fases: hilos escribiendo su parte de un array (fase 1), barrera, hilos leyendo el array completo (fase 2).
- 2:15–3:00 — Una sola persona comprando tickets mientras 7 descansan; rótulo «single» con «+ barrera implícita».
- 3:00–4:00 — Línea de tiempo mostrando el tiempo ocioso de los hilos rápidos en cada barrera (speedup perdido); captura de Telar.

## Para recordar

- `barrier` = punto de encuentro obligatorio: ningún hilo pasa hasta que **todos** llegan.
- Sirve para separar fases: no leas lo que otros aún están escribiendo.
- `single` = un bloque que ejecuta **un solo hilo** (los demás esperan); lleva una barrera implícita al final.
- Toda sincronización cuesta tiempo ocioso: úsala solo cuando la correctitud lo exige.
