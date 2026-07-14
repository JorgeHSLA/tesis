# Concurrencia no es paralelismo

Video F1.5 · ~5 minutos · Módulo F1 «El porqué del paralelismo»

**Objetivo:** Deshacer la confusión más común del tema — concurrencia es una forma de estructurar tareas, paralelismo es ejecutarlas al mismo tiempo — y ver por qué esto importa en Python.

## Guion

### Gancho (0:00–0:20)

Un solo barista puede atender a diez clientes «a la vez» sin preparar jamás dos cafés en el mismo instante. ¿Cómo? La respuesta separa dos palabras que casi todo el mundo usa como sinónimos y no lo son: concurrencia y paralelismo. Distinguirlas te va a ahorrar muchísima confusión, así que prestá atención estos cinco minutos.

### El barista (0:20–1:40)

Volvamos a la cafetería. Un barista, diez pedidos. Pone a hacer un espresso, y mientras la máquina extrae, no se queda mirando: empieza a espumar la leche de otro pedido. Mientras la leche calienta, cobra a un tercer cliente. Va saltando entre tareas, aprovechando los huecos muertos de cada una. Al final los diez clientes se van servidos y sienten que los atendieron «a la vez». Pero en ningún momento hubo dos cafés preparándose simultáneamente: había **un solo barista** alternando entre tareas.

Eso es **concurrencia**: varias tareas en progreso, gestionadas de forma que se solapan en el tiempo, alternándose. No necesitas varios trabajadores para tener concurrencia; necesitas una buena forma de intercalar el trabajo. Un solo núcleo puede ser concurrente: el sistema operativo le da un cachito a una tarea, la pausa, le da un cachito a otra, y va tan rápido que parecen simultáneas.

### Los cuatro baristas (1:40–2:40)

Ahora cambia la escena: contratas a cuatro baristas y les das cuatro máquinas. Ahora sí, en el mismo instante físico, hay cuatro espressos extrayéndose a la vez. Eso es **paralelismo**: varias tareas ejecutándose realmente al mismo tiempo, cada una en su propia unidad de cómputo. Y para eso sí necesitas varios trabajadores de verdad: varios núcleos.

Aquí está la frase que quiero que te lleves: **la concurrencia es cómo estructuras el trabajo; el paralelismo es cómo lo ejecutas.** La concurrencia es una forma de organizar tareas que se solapan; el paralelismo es tenerlas corriendo físicamente en paralelo. Un barista concurrente; cuatro baristas paralelos.

### Se combinan (2:40–3:40)

Y lo que suele liar a la gente: no son opuestos, se cruzan. Puedes tener concurrencia sin paralelismo, que es el barista único saltando entre pedidos en un solo núcleo. Puedes tener las dos a la vez: cuatro baristas y cada uno además saltando entre varios pedidos. Incluso puedes tener paralelismo puro y simple: cuatro baristas, cada uno con un solo pedido de principio a fin, sin saltar.

En este curso nos vamos a enfocar en el **paralelismo**: queremos que tus ocho núcleos trabajen de verdad al mismo tiempo sobre un cálculo. Pero necesitabas la distinción, porque cuando leas sobre programación vas a encontrar las dos palabras por todas partes, y ahora ya sabes que responden a preguntas distintas: ¿cómo está organizado el trabajo? es concurrencia; ¿se está ejecutando simultáneamente? es paralelismo.

### El caso especial de Python (3:40–4:35)

Y hay un detalle sobre Python que tienes que conocer desde ya. El intérprete clásico de Python tiene un cerrojo interno llamado el GIL, el *Global Interpreter Lock*. Su efecto práctico es que, en Python puro, aunque crees muchos hilos, solo uno puede ejecutar código de Python en cada instante. Es como si, por más baristas que contrates, hubiera una única cafetera que se turnan: tienes concurrencia, sí, pero no paralelismo real de cómputo. Para muchos programas eso da igual, pero para el cálculo pesado que nos interesa aquí, es un techo durísimo.

¿Entonces cómo va a hacer paralelismo de verdad este curso, si trabajamos en Python? Con un truco muy elegante que es la base de PyOMP: compilar tu código a lenguaje máquina y salir del intérprete —y por tanto del GIL— antes de crear los hilos. Cómo funciona esa magia lo desarrollamos en el módulo F4. Por ahora quédate con que sí, vamos a exprimir tus ocho núcleos de verdad.

### Conexión con E-HPC (4:35–5:00)

Con esto cierras el vocabulario base: sabes qué es un núcleo, un proceso, un hilo, y ahora la diferencia entre concurrencia y paralelismo. En E-HPC verás paralelismo genuino: métricas de varios núcleos encendidos al mismo tiempo, no uno turnándose. Te espera el quiz del módulo para afianzarlo, y luego pasamos a pensar en paralelo: cómo se reparte el trabajo y cómo se mide si valió la pena.

## Apoyo visual

- 0:00–0:20 — Un barista rodeado de 10 tickets de pedido; interrogante «¿a la vez?».
- 0:20–1:40 — Un barista alternando entre 3 estaciones (espresso extrayendo, leche espumando, cobrando); línea de tiempo con tareas que se solapan pero un solo trabajador.
- 1:40–2:40 — Cuatro baristas, cuatro máquinas, cuatro espressos extrayéndose en el MISMO instante marcado en la línea de tiempo.
- 2:40–3:40 — Matriz 2x2: concurrencia sí/no × paralelismo sí/no, con el barista ilustrando cada casilla.
- 3:40–4:35 — Diagrama del GIL: muchos hilos de Python pero un único «candado» que solo deja pasar a uno; teaser «PyOMP lo esquiva → F4».
- 4:35–5:00 — Métricas de E-HPC con varios núcleos activos simultáneamente.

## Para recordar

- **Concurrencia** = estructura: varias tareas en progreso que se alternan; puede ocurrir en un solo núcleo.
- **Paralelismo** = ejecución: varias tareas corriendo físicamente al mismo tiempo; exige varios núcleos.
- No son opuestos: puedes tener una, la otra, o ambas.
- En Python el GIL impide el paralelismo real de hilos; PyOMP lo esquiva compilando a código máquina fuera del intérprete (se ve en F4).
