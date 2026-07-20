# Speedup y eficiencia: ¿valió la pena?

Video F2.2 · ~4 minutos · Módulo F2 «Pensar en paralelo»

**Objetivo:** Definir speedup y eficiencia, las dos métricas que el simulador de E-HPC calcula automáticamente en cada job.

## Guion

### Gancho (0:00–0:20)

Paralelizaste tu programa: corrió, dio el resultado correcto y hasta se sintió más rápido. Pero «se sintió» no es una medida. ¿Fue dos veces más rápido? ¿Ocho? ¿Y cuánto de esos ocho hilos estás aprovechando de verdad? Hoy vemos las dos métricas que responden eso con números: speedup y eficiencia.

### Speedup: ¿cuántas veces más rápido? (0:20–1:40)

Empecemos por la pregunta natural: ¿cuántas veces más rápido va mi programa? Eso es el speedup, y se calcula así:

`S = T1 / TN`

Léelo en palabras: el speedup es el tiempo que tarda el programa con un solo hilo, dividido por el tiempo que tarda con N hilos. Si con un hilo tardas 10 segundos y con cuatro hilos tardas 2.5, el speedup es 10 entre 2.5: cuatro. Tu programa va cuatro veces más rápido.

¿Y cuál sería el resultado perfecto? Que con N hilos fueras exactamente N veces más rápido: `S = N`, el llamado speedup lineal. Esa es la línea ideal contra la que se compara todo. En la práctica casi siempre te quedas por debajo, porque repartir el trabajo y coordinar a los hilos tiene costos, como verás en los próximos videos de este módulo.

### Eficiencia: ¿qué porcentaje de cada hilo aprovechas? (1:40–2:40)

El speedup te dice cuánto ganaste; la eficiencia te dice a qué costo. Se define así:

`E = S / N`

En palabras: la eficiencia es el speedup dividido por el número de hilos, y conviene leerla como un porcentaje: ¿qué fracción de cada hilo estoy aprovechando? Si con 8 hilos logras un speedup de 8, la eficiencia es 1: cien por ciento, cada hilo rinde a tope. Si con 8 hilos solo logras un speedup de 4, la eficiencia es 0.5: la mitad de la capacidad de cada hilo se pierde por el camino. Ocho personas contratadas, cuatro trabajando.

### Dos casos reales, dos extremos (2:40–3:30)

Ahora, dos casos reales de este curso, medidos en la máquina de referencia. Primero, el simulador de transporte de partículas Monte Carlo: con un hilo tarda 0.726 segundos; con ocho hilos, 0.091. Haz la cuenta: 0.726 entre 0.091 da prácticamente 8. Speedup de 8 con 8 hilos, eficiencia cercana al cien por ciento. El caso ideal.

Segundo, la difusión de calor en una placa 2D: la versión serial tarda 0.99 segundos y la paralela, con ocho núcleos, 0.91. Speedup de apenas 1.1, eficiencia alrededor del 14 por ciento. Ocho núcleos trabajando para ganar casi nada.

Mismo lenguaje, mismas directivas, resultados opuestos. ¿Por qué? Esa es exactamente la pregunta del video sobre overhead, dos lecciones más adelante, y la vas a comprobar con tus propias mediciones en el módulo práctico 7.

### Conexión con E-HPC (3:30–4:00)

En E-HPC no tendrás que calcular nada de esto a mano: cada job que lances mide los tiempos y te muestra el speedup y la eficiencia en la pantalla de resultados, automáticamente. Tu trabajo es interpretarlos: un speedup cercano a N es una victoria; uno cercano a 1 es una señal de que algo —overhead, memoria, desbalance— se está comiendo tu paralelismo. Las próximas lecciones te enseñan a encontrar al culpable.

## Apoyo visual

- 0:00–0:20 — dos cronómetros lado a lado: «1 hilo» vs «8 hilos», con un signo de interrogación gigante.
- 0:20–1:40 — la fórmula `S = T1 / TN` construyéndose pieza a pieza; ejemplo animado 10 s → 2.5 s → S = 4; recta del speedup lineal `S = N` como referencia.
- 1:40–2:40 — la fórmula `E = S / N` con una barra de porcentaje que se llena; comparación 8/8 = 100 % vs 4/8 = 50 %.
- 2:40–3:30 — pantalla de resultados real de E-HPC anotada con flechas: transporte de partículas (0.726 s → 0.091 s, ~8x) frente al stencil de calor (~1.1x).
- 3:30–4:00 — zoom a la tarjeta de speedup/eficiencia del simulador con la leyenda «esto se calcula solo en cada job».

## Para recordar

- `S = T1 / TN`: el speedup es el tiempo con un hilo dividido por el tiempo con N hilos; el ideal es lineal (`S = N`).
- `E = S / N`: la eficiencia dice qué porcentaje de cada hilo aprovechas de verdad.
- Datos reales del curso: el transporte de partículas escala ~8x con 8 hilos (eficiencia ~100 %); el stencil de calor apenas ~1.1x.
- E-HPC calcula ambas métricas automáticamente en cada job: tu tarea es interpretarlas.
