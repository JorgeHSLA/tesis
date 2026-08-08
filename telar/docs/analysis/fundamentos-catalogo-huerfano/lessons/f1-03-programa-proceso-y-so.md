# Programa, proceso y sistema operativo

Video F1.3 · ~4 minutos · Módulo F1 «El porqué del paralelismo»

**Objetivo:** Distinguir un programa de un proceso, entender que cada proceso tiene su propia memoria privada, y ver el papel del sistema operativo al repartir los núcleos.

## Guion

### Gancho (0:00–0:20)

Tu archivo `.py` guardado en el disco no está «haciendo» nada. Es texto quieto. Solo cuando le das a ejecutar cobra vida y empieza a consumir CPU y memoria. A esa versión viva de tu programa se le llama proceso, y entender la diferencia entre las dos cosas es el primer paso para entender los hilos. Vamos allá.

### La receta y la cocina (0:20–1:30)

Piensa en una receta escrita en un papel. La receta es el **programa**: una lista de pasos, guardada, estática, que no cambia y que no cocina nada por sí sola. Puedes tener la misma receta copiada en mil papeles y ninguno huele a comida.

Ahora entras a la cocina, enciendes el fuego, sacas los ingredientes y empiezas a seguir la receta. Eso que está ocurriendo —la receta en acción, con su cocinero, sus ollas medio llenas y su punto exacto de cocción en cada momento— es el **proceso**. El proceso es el programa vivo: tiene un estado que cambia a cada segundo. Y detalle importante: de la misma receta puedes tener dos cocinas funcionando a la vez, cada una en su propio punto. Dos procesos del mismo programa, independientes.

### Cada proceso, su propia memoria (1:30–2:45)

Aquí viene la propiedad más importante del proceso, la que hay que grabar a fuego: **cada proceso tiene su propia memoria privada**. Sus variables, sus datos, su estado, viven en un espacio que es solo suyo. Es como si cada cocina tuviera su propia despensa cerrada con llave.

¿Consecuencia? Dos procesos **no se ven las variables entre sí**. Si tu programa abre dos procesos y uno cambia una variable, el otro ni se entera: está mirando su propia copia, en su propia despensa. Esto es una bendición para la seguridad y la estabilidad —un proceso no puede corromper la memoria de otro por accidente— pero es un estorbo cuando lo que quieres es, precisamente, que colaboren. Si dos cocinas tienen que compartir un ingrediente, alguien tiene que llevarlo físicamente de una despensa a la otra. Comunicar procesos cuesta: hay que empaquetar los datos y «mandarlos», como quien manda una carta. Y mandar cartas es lento comparado con simplemente abrir la nevera de al lado. Recuerda esta molestia, porque es exactamente el problema que los hilos vienen a resolver en el próximo video.

### El sistema operativo, director de orquesta (2:45–3:30)

¿Y quién decide qué núcleo ejecuta qué proceso? El **sistema operativo**. En tu máquina hay decenas o cientos de procesos vivos —el navegador, la música, tu editor, tu script— y solo unos pocos núcleos. El sistema operativo hace de director de orquesta: reparte los núcleos entre los procesos, le da a cada uno su turno, lo pausa, lo reanuda, lo mueve de un núcleo a otro. A ese trabajo de repartir se le llama planificación, o *scheduling*. Tú casi nunca lo ves, pero está ocurriendo miles de veces por segundo bajo tus pies.

### Conexión con Telar (3:30–4:00)

En Telar, cuando lances un job, tu código PyOMP corre como un **proceso** dentro de un contenedor Docker aislado: su propia memoria, sus propios límites de CPU. Lo verás nacer, consumir recursos y terminar, en vivo, en la pantalla del simulador. Ya sabes qué es un proceso y por qué su memoria privada es a la vez una virtud y una molestia. En el próximo video abrimos ese proceso por dentro y conocemos a los protagonistas de todo el curso: los hilos.

## Apoyo visual

- 0:00–0:20 — Un archivo `.py` quieto en el explorador; al hacer clic en «ejecutar», se transforma en un proceso con medidores de CPU y memoria.
- 0:20–1:30 — Split screen: a la izquierda una receta en papel (programa); a la derecha una cocina en plena acción (proceso).
- 1:30–2:45 — Dos cocinas lado a lado, cada una con su despensa cerrada con llave; un ingrediente que hay que llevar físicamente de una a otra («mandar una carta»).
- 2:45–3:30 — El sistema operativo como director de orquesta asignando turnos de núcleo a muchos procesos (navegador, música, editor…).
- 3:30–4:00 — Captura del simulador Telar: un job corriendo como proceso dentro de su contenedor, con métricas.

## Para recordar

- Programa = la receta escrita (estática, en disco). Proceso = la receta en acción (viva, con estado que cambia).
- Cada proceso tiene su **memoria privada**: dos procesos no comparten variables.
- Comunicar procesos es caro: hay que empaquetar y «mandar» los datos.
- El sistema operativo reparte los núcleos entre los procesos (planificación / scheduling).
