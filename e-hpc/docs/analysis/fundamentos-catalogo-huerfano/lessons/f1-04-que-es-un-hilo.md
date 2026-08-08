# ¿Qué es un hilo?

Video F1.4 · ~5 minutos · Módulo F1 «El porqué del paralelismo»

**Objetivo:** Entender qué es un hilo, por qué los hilos de un proceso comparten memoria, y por qué eso es a la vez su gran ventaja y su gran peligro. Es el concepto central de todo el curso.

## Guion

### Gancho (0:00–0:20)

Si tuviera que resumir todo este curso en una sola palabra, sería esta: **hilo**. OpenMP existe para crear hilos, coordinarlos y repartirles trabajo. El slider que vas a mover en el simulador controla hilos. Los bugs que vas a cazar son bugs entre hilos. Así que dediquemos cinco minutos a entenderlos de verdad.

### La casa compartida (0:20–1:40)

En el video anterior comparamos un proceso con una cocina que tiene su despensa privada. Ampliemos la imagen: un proceso es una **casa**. Y los hilos son las **personas que viven en esa casa**.

Aquí está la magia. Todas las personas de la casa comparten la cocina y, sobre todo, la nevera. Cualquiera abre la nevera, ve lo que hay y lo usa. Eso es la **memoria compartida**: todos los hilos de un proceso ven las mismas variables, los mismos datos, la misma nevera. No hace falta mandar cartas de una despensa a otra como pasaba entre procesos; aquí todos comen de la misma nevera, y es instantáneo.

Pero cada persona tiene también su **habitación propia**, un espacio privado donde guarda sus cosas y nadie mete la mano. En el mundo de los hilos, esa habitación privada se llama *stack*: cada hilo tiene el suyo, con sus variables temporales, su punto exacto de ejecución. Así que el modelo es: nevera común para todos, habitación privada para cada uno.

### La definición y la ventaja (1:40–3:00)

Formalicémoslo. Un **hilo** es una unidad de ejecución dentro de un proceso. Un proceso puede tener un solo hilo —el caso serial de toda la vida— o muchos. Cuando tiene varios, cada hilo puede correr en un núcleo distinto, y ahí es donde por fin usamos los ocho núcleos de la máquina a la vez.

¿Cuál es la gran ventaja de los hilos frente a usar varios procesos? Que comunicarse es **gratis**. Como comparten memoria, si un hilo calcula un resultado y lo deja en un array, los otros hilos lo leen directamente de ese array. No hay que empaquetar nada, no hay que mandar cartas. Todos miran la misma nevera. Para un cálculo científico donde ocho hilos trabajan sobre la misma matriz gigante, esto es exactamente lo que quieres.

### El peligro que viene con ello (3:00–4:15)

Pero la nevera compartida tiene un lado oscuro, y es tan importante que le dedicaremos un módulo entero más adelante. Piénsalo: si ocho personas comparten una nevera y todas pueden meter y sacar cosas a la vez, ¿qué pasa cuando dos van a coger el último huevo en el mismo instante? O peor: uno está contando cuántos huevos quedan mientras otro los está sacando. El resultado es confusión, y en un programa esa confusión se traduce en bugs rarísimos: cálculos que dan un número distinto cada vez que corres el programa.

Ese es el trato con los hilos: la memoria compartida los hace potentísimos y a la vez peligrosos. **La misma propiedad que los hace rápidos —compartir la nevera— es la que los mete en problemas.** No te preocupes todavía por cómo se arregla; solo quédate con la intuición de que compartir sin reglas lleva al caos. Poner esas reglas es, en buena medida, de lo que trata OpenMP.

Un apunte práctico para cerrar: ¿cuántos hilos conviene crear? Como regla general, tantos como núcleos lógicos tenga la máquina. La de referencia de este curso tiene ocho, así que ocho hilos es el punto natural. Y ese número se controla con una variable que vas a ver por todas partes: `OMP_NUM_THREADS`.

### Conexión con Telar (4:15–5:00)

En el simulador de Telar, ese slider de «hilos» que vas a mover es literalmente esto: le dice a tu programa cuántas personas viven en la casa, cuántos hilos nacen para repartirse el trabajo. Pon uno y verás un núcleo trabajando; pon ocho y verás la máquina entera encendida. Ya tienes al protagonista del curso. En el próximo y último video del módulo aclaramos una confusión que casi todo el mundo arrastra: la diferencia entre concurrencia y paralelismo.

## Apoyo visual

- 0:00–0:20 — La palabra «HILO» grande en pantalla, rodeada de iconos: un slider, el logo de OpenMP, un bug.
- 0:20–1:40 — Una casa (proceso) con 8 personas dentro; todas abren la MISMA nevera (memoria compartida); cada una entra a SU habitación (stack privado).
- 1:40–3:00 — Diagrama: un proceso con 8 hilos, cada hilo mapeado a un núcleo; flecha «comunicación = leer/escribir la misma memoria = gratis».
- 3:00–4:15 — Dos personas alcanzando el último huevo a la vez en la nevera compartida; símbolo de conflicto; teaser «Módulo F3».
- 4:15–5:00 — El slider de hilos del simulador Telar moviéndose de 1 a 8; los núcleos se encienden uno a uno.

## Para recordar

- Un hilo es una unidad de ejecución dentro de un proceso; un proceso puede tener muchos.
- Los hilos de un proceso **comparten la memoria** (la nevera común) pero cada uno tiene su stack privado (su habitación).
- Ventaja: comunicarse entre hilos es gratis, porque leen y escriben las mismas variables.
- Peligro: compartir sin reglas provoca bugs (lo veremos en el módulo F3). Se suelen crear tantos hilos como núcleos, controlados por `OMP_NUM_THREADS`.
