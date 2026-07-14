# ¿Por qué tu programa no va más rápido?

Video F1.1 · ~4 minutos · Módulo F1 «El porqué del paralelismo»

**Objetivo:** Entender por qué los procesadores dejaron de acelerar por frecuencia y pasaron a tener varios núcleos — y qué implica eso para tu código.

## Guion

### Gancho (0:00–0:20)

Compraste una laptop con ocho núcleos. Abres el monitor del sistema, lanzas tu script de Python… y la CPU marca un doce por ciento de uso. ¿Doce? Pagaste por ocho motores y estás usando uno solo. En los próximos cuatro minutos vas a entender por qué pasa esto, y por qué no es un defecto de tu máquina: es la historia reciente de toda la computación.

### El almuerzo gratis (0:20–1:30)

Viajemos un momento al pasado. Durante décadas, los programadores vivieron una época dorada que se conoció como el «almuerzo gratis». Funcionaba así: cada año o dos salía un procesador con más frecuencia, es decir, capaz de ejecutar más instrucciones por segundo. Tú escribías tu programa una vez, sin cambiarle ni una línea, y cuando lo corrías en la máquina nueva… iba más rápido. Gratis. El hardware hacía todo el trabajo de optimización por ti.

Pero alrededor de 2005 la fiesta se terminó. Resulta que subir la frecuencia tiene un precio físico: más frecuencia significa más consumo eléctrico y, sobre todo, más calor. Llegó un punto en que hacer un núcleo más rápido lo convertía en algo imposible de enfriar con métodos razonables. Los fabricantes chocaron contra un muro, y ese muro no era de software ni de falta de ingenio: era de física pura.

### Más núcleos en vez de núcleos más rápidos (1:30–3:30)

¿Y qué hizo la industria? No se rindió: cambió de estrategia. Si ya no puedo hacer un núcleo mucho más rápido, pongo varios núcleos en el mismo chip. Así nacieron los procesadores multicore: primero dos núcleos, luego cuatro, ocho… La máquina de referencia de este curso, por ejemplo, tiene ocho núcleos lógicos: si le preguntas con el comando `nproc`, responde 8.

Suena a solución perfecta, pero tiene una trampa enorme. Un programa serial —el clásico, escrito como una lista de instrucciones que se ejecutan una detrás de otra— solo puede usar un núcleo a la vez. El procesador no puede adivinar cómo repartir tu código entre los ocho núcleos: nadie le dijo qué partes pueden hacerse a la vez.

Y ahí está la explicación del misterio inicial: cien dividido entre ocho da 12,5. Tu script marca doce por ciento porque tiene un núcleo trabajando al cien por ciento… y los otros siete dormidos. La máquina es ocho veces más «ancha», pero tu programa solo sabe caminar por un carril.

La consecuencia es un cambio de época. Antes de 2005, el software se aceleraba solo con esperar al siguiente procesador. Hoy, un programa serial corre prácticamente igual en un chip de hace varios años que en uno nuevo. Si quieres que tu código aproveche la máquina que ya tienes, hay una sola salida: escribirlo para que use varios núcleos a la vez. Eso es programar en paralelo, y no es un lujo de supercomputadores: es la única forma de exprimir hasta la laptop en la que estás viendo este video.

### Conexión con E-HPC (3:30–4:00)

En E-HPC esto no se queda en teoría. Cada programa que ejecutes en la plataforma corre en un entorno real de ocho núcleos, y el simulador te muestra las métricas en vivo: cuánta CPU consume tu código y qué están haciendo los hilos. Vas a ver con tus propios ojos cómo ese doce por ciento se transforma en ocho núcleos trabajando a la vez. En el próximo video le ponemos nombre a la idea central: el paralelismo.

## Apoyo visual

- 0:00–0:20 — Monitor del sistema real: un proceso de Python al 12 % de CPU; zoom al porcentaje.
- 0:20–1:30 — Gráfica animada de frecuencia de los procesadores vs año: sube hasta ~2005 y se aplana; icono de termómetro al llegar al muro.
- 1:30–2:30 — Sobre la misma gráfica, segunda curva: número de núcleos por chip vs año, subiendo justo donde la frecuencia se aplana.
- 2:30–3:30 — Vista de 8 núcleos: uno al 100 % en color y siete en gris «dormidos»; en pantalla, el cálculo 100 / 8 = 12,5 %.
- 3:30–4:00 — Captura del simulador E-HPC con las métricas de CPU del contenedor en vivo.

## Para recordar

- Hasta ~2005 el software se aceleraba «gratis»: cada procesador nuevo traía más frecuencia.
- El calor puso el límite físico: ya no se pudo seguir subiendo la frecuencia.
- La industria respondió con más núcleos, no con núcleos más rápidos.
- Un programa serial usa un solo núcleo: si quieres velocidad, tienes que repartir el trabajo tú.
