# ¿Qué es el paralelismo?

Video F1.2 · ~4 minutos · Módulo F1 «El porqué del paralelismo»

**Objetivo:** Definir el paralelismo como la división de un problema en partes que se ejecutan al mismo tiempo, y entender su requisito clave: la independencia.

## Guion

### Gancho (0:00–0:20)

Imagina que tienes que pintar una casa entera y estás tú solo. Te toman ocho días. Ahora llamas a siete amigos: ocho pintores en total. ¿Cuánto tardan? Si te dijo la cabeza «un día», acabas de pensar en paralelo sin darte cuenta. Vamos a ponerle nombre y reglas a esa intuición.

### La analogía de los pintores (0:20–1:30)

Ocho pintores, ocho habitaciones. Cada uno agarra una habitación y se pone a pintar. Nadie espera a nadie: todos pintan **al mismo tiempo**. Ocho días de trabajo se convierten en uno. Eso es el paralelismo en su forma más pura: coger un problema grande, partirlo en trozos, y trabajar todos los trozos a la vez con distintas manos.

Pero fíjate en la condición que hizo que funcionara: las ocho habitaciones eran **independientes**. Pintar la cocina no necesita que primero termine el dormitorio. Cada trozo se puede hacer por su cuenta, sin pedirle permiso ni resultados a los demás. Esa palabra, independencia, es el corazón de todo. Guárdala.

### La definición formal (1:30–3:15)

Definámoslo con precisión. El paralelismo es **dividir un problema en partes que se ejecutan simultáneamente en distintas unidades de cómputo**. En una computadora, esas unidades de cómputo son los núcleos que conociste en el video anterior. En vez de un núcleo dando un millón de vueltas a un bucle, ocho núcleos dando ciento veinticinco mil vueltas cada uno, todos a la vez.

Compáralo con lo serial. Un programa serial es una fila india: instrucción tras instrucción, una sola línea de trabajo, por larga que sea. Un programa paralelo es esa misma fila partida en varias filas cortas que avanzan hombro con hombro. Si el trabajo total era el mismo, terminar ocho filas cortas a la vez es mucho más rápido que recorrer una fila larga.

Ahora bien, no todo se puede repartir. Volvamos a los pintores para ver los dos problemas que aparecen apenas sales de la teoría. Primero: hay pasos que solo puede hacer una persona. Alguien tiene que mezclar toda la pintura al principio, y mientras la mezcla, los otros siete esperan. Ese trozo es irremediablemente serial. Segundo: los pintores a veces se estorban. Si dos quieren usar la misma escalera, uno tiene que ceder. Cuando trabajas con computadoras, ese «estorbarse» tiene formas muy concretas y peligrosas, y es a lo que le vamos a dedicar todo un módulo más adelante.

Por ahora quédate con la idea grande: el paralelismo funciona de maravilla **cuando el trabajo se puede dividir en partes independientes**, y se complica exactamente en la medida en que esas partes dejan de serlo.

### Conexión con E-HPC (3:15–4:00)

En E-HPC vas a ver esta idea hecha números. Uno de los ejemplos del curso, un simulador de transporte de partículas, reparte su trabajo en partes tan independientes que con ocho hilos corre casi ocho veces más rápido: el caso ideal de los pintores. Otro ejemplo, en cambio, apenas mejora aunque le añadas hilos, y entender por qué será uno de los momentos más reveladores del curso. Todo empieza aquí: paralelizar es repartir. En el próximo video bajamos un nivel para ver qué es exactamente eso que se reparte dentro de tu computadora.

## Apoyo visual

- 0:00–0:20 — Una casa; un pintor solitario con un contador «8 días»; aparecen 7 pintores más y el contador cae a «1 día».
- 0:20–1:30 — Plano de la casa dividido en 8 habitaciones, cada una con un pintor de color distinto trabajando en paralelo.
- 1:30–2:30 — Comparación de líneas de tiempo: una barra serial larga vs 8 barras paralelas cortas apiladas, misma área total.
- 2:30–3:15 — Los mismos pintores, ahora mostrando el paso serial «mezclar la pintura» (7 esperando) y el choque por «la misma escalera».
- 3:15–4:00 — Captura de la pantalla de resultados de E-HPC con el speedup ~8x del ejemplo de transporte de partículas.

## Para recordar

- Paralelismo = dividir un problema en partes que se ejecutan al mismo tiempo en distintas unidades de cómputo.
- La condición para que funcione es la **independencia** de las partes.
- Serial es una fila larga; paralelo es esa fila partida en varias que avanzan a la vez.
- Dos límites aparecen siempre: los pasos que solo puede hacer uno (serial) y las partes que se estorban entre sí.
