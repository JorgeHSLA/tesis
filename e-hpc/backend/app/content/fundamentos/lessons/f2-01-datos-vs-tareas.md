# Dividir el trabajo: datos vs tareas

Video F2.1 · ~5 minutos · Módulo F2 «Pensar en paralelo»

**Objetivo:** Distinguir los dos tipos de descomposición del trabajo —paralelismo de datos y paralelismo de tareas— y conocer los tres patrones que estructuran los módulos prácticos del curso.

## Guion

### Gancho (0:00–0:20)

Tienes un problema enorme y ocho núcleos esperando órdenes. La primera pregunta del programador paralelo no es qué lenguaje usar ni qué directiva escribir. Es otra, mucho más básica: ¿cómo parto este trabajo? Y aunque parezca que hay mil maneras de partirlo, casi todas caben en dos grandes familias. Hoy las vas a conocer.

### La analogía de los exámenes (0:20–1:30)

Imagina que eres profesor y acabas de aplicar un examen a 800 estudiantes. Corregirlos tú solo te tomaría la semana entera. Por suerte, tienes siete colegas dispuestos a ayudar: ocho profesores en total. ¿Cómo se reparten el trabajo?

La primera opción es la obvia: partir el montón en ocho pilas de cien exámenes, y que cada profesor corrija su pila completa. Todos hacen la misma operación —corregir— pero sobre trozos distintos del montón. Cuando terminan, se juntan los resultados y listo.

La segunda opción es montar una cadena: un profesor corrige, otro va sumando las notas de los exámenes ya corregidos, y un tercero las va subiendo al sistema. Aquí nadie hace lo mismo: cada uno ejecuta una operación diferente, y los exámenes fluyen de mano en mano.

Las dos estrategias son válidas, las dos ponen a varias personas a trabajar a la vez… y son fundamentalmente distintas. Cada una tiene nombre propio.

### Paralelismo de datos: misma operación, distintos trozos (1:30–2:40)

La primera estrategia es el paralelismo de datos: la misma operación, aplicada en paralelo, sobre porciones distintas de los datos. El montón de exámenes se convierte en ocho pilas; en tu código, un array se convierte en ocho rangos de índices, una imagen en ocho franjas de píxeles, un millón de partículas en ocho lotes.

Y aquí viene lo importante: el paralelismo de datos es el pan de cada día del cómputo científico. Piensa en lo que procesa la ciencia: arrays, matrices, mallas, píxeles, partículas… colecciones gigantes de elementos que reciben todos el mismo tratamiento. Si tu problema se puede describir como «haz esto con cada elemento», tienes paralelismo de datos delante. Es el caso más frecuente, el más fácil de razonar y, casi siempre, el que mejor escala, porque cada trozo es independiente de los demás.

### Paralelismo de tareas: operaciones distintas (2:40–3:30)

La segunda estrategia es el paralelismo de tareas: unidades de trabajo diferentes que pueden ejecutarse al mismo tiempo. En la cadena de los profesores, corregir, sumar notas y subirlas al sistema son tareas distintas que avanzan en paralelo mientras haya exámenes fluyendo entre ellas.

El paralelismo de tareas brilla cuando el trabajo no es un montón uniforme sino una estructura: etapas que se encadenan, ramas que se abren, subproblemas que aparecen sobre la marcha. Es más flexible que el de datos, pero también más delicado: hay que coordinar quién le pasa qué a quién, y una etapa lenta puede frenar toda la cadena.

### Los tres patrones que verás en el curso (3:30–4:20)

Con estas dos familias en mente, este es el mapa de los tres patrones concretos que vas a practicar en el curso.

Uno: paralelismo a nivel de bucle, o *loop-level*. Tienes un `for` que recorre datos; le dices a OpenMP «reparte estas vueltas entre los hilos» y él hace el resto. Es paralelismo de datos en su forma más cómoda.

Dos: SPMD, un mismo programa que ejecutan todos los hilos, donde cada hilo usa su número de identidad para decidir qué porción le toca. Sigue siendo paralelismo de datos, pero el reparto lo haces tú a mano, con control total.

Tres: divide y vencerás con tareas. El problema se va partiendo en subproblemas que se encolan como tareas, y los hilos las van tomando según se desocupan. Aquí ya estamos en paralelismo de tareas puro.

### Conexión con E-HPC (4:20–5:00)

Estos tres patrones no son teoría suelta: son, exactamente, tres módulos prácticos de E-HPC. El paralelismo a nivel de bucle es el módulo 1; SPMD, con su reparto manual por identidad del hilo, es el módulo 2; y divide y vencerás con tareas es el módulo 6. Cuando llegues a ellos, vas a escribir y ejecutar cada patrón con código real en el simulador. Por ahora, quédate con la pregunta clave de este video: ¿mi problema es un montón de datos iguales, o una estructura de tareas distintas? Casi todo lo demás se deriva de ahí.

## Apoyo visual

- 0:00–0:20 — título sobre un bloque gigante de trabajo que se agrieta en piezas; contador «8 núcleos esperando».
- 0:20–1:30 — animación del montón de 800 exámenes partiéndose en 8 pilas iguales; después, la cadena de montaje con tres profesores y flechas de flujo entre ellos.
- 1:30–3:30 — pantalla dividida: a la izquierda «DATOS: misma operación, distintos trozos» (un array partido en rangos de colores); a la derecha «TAREAS: operaciones distintas» (etapas encadenadas).
- 3:30–4:20 — tarjeta-mapa con los tres patrones (loop-level, SPMD, tareas) iluminándose uno a uno.
- 4:20–5:00 — catálogo de E-HPC resaltando los módulos m1, m2 y m6.

## Para recordar

- Paralelismo de datos: la misma operación sobre trozos distintos (ocho pilas de cien exámenes). Es el caso dominante en cómputo científico.
- Paralelismo de tareas: operaciones distintas ejecutándose a la vez (corregir, sumar, subir). Más flexible, pero exige más coordinación.
- Los tres patrones del curso: loop-level (repartir un `for`), SPMD (repartir a mano por identidad del hilo) y divide y vencerás (tareas).
- Corresponden exactamente a los módulos prácticos m1, m2 y m6 de E-HPC.
