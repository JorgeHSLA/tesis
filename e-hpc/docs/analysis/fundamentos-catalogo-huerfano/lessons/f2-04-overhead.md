# Overhead: el costo oculto de los hilos

Video F2.4 · ~4 minutos · Módulo F2 «Pensar en paralelo»

**Objetivo:** Entender por qué más hilos no siempre es más rápido: los costos invisibles de coordinar el paralelismo.

## Guion

### Gancho (0:00–0:20)

Escenario real: paralelizaste tu bucle, pusiste 8 hilos, corriste… y el programa salió más lento que en serial. No, no está roto. Acabas de conocer al enemigo silencioso de todo programa paralelo: el overhead. Hoy aprendes a reconocerlo y, sobre todo, a predecir cuándo va a aparecer.

### Los costos invisibles (0:20–1:40)

Piénsalo con una mudanza. Si tienes que mover una casa entera, llamar a ocho amigos es buenísima idea. Pero si tienes que mover una silla, ¿llamarías a ocho amigos? Entre que les escribes, llegan, les explicas, se reparten quién agarra qué pata… tú solo la habrías movido diez veces.

Paralelizar tiene exactamente esos costos, aunque no se vean en tu código. Primero: crear o despertar los hilos, que no es gratis. Segundo: repartir el trabajo, decidir qué vueltas del bucle le tocan a quién. Tercero: sincronizarse al final, porque nadie sigue hasta que el último hilo termina. Y cuarto, el más traicionero: competir por la memoria y la caché, porque ocho hilos comparten el mismo bus hacia la RAM y se estorban al usarlo.

Todo eso es el overhead: trabajo de coordinación que en la versión serial simplemente no existe. Y se paga siempre, lo notes o no.

### La regla mental: trabajo grande, coordinación pequeña (1:40–2:40)

De aquí sale la regla mental de este video: el trozo de trabajo que le das a cada hilo debe ser mucho más grande que el costo de coordinarse. Es la silla contra la casa. Si cada hilo recibe millones de operaciones, el overhead se vuelve despreciable y el speedup aparece. Si cada hilo recibe cuatro sumas, el overhead domina y el programa paralelo pierde contra el serial.

Por eso, con problemas pequeños, serial gana. Y no es una derrota: es la decisión correcta. Paralelizar un bucle de mil elementos triviales es contratar ocho amigos para mover una silla. La pregunta que debes hacerte antes de paralelizar no es «¿puedo?», sino «¿hay suficiente trabajo para que valga la pena?».

### Cuando la memoria es el cuello de botella (2:40–3:30)

Hay un caso especial de overhead que merece su propio nombre: los programas *memory-bound*, limitados por memoria. En el video anterior viste el dato: la difusión de calor en una placa 2D logra apenas 1.1x con ocho núcleos. ¿Por qué? Ese código hace solo cuatro sumas por celda, pero para hacerlas lee cuatro vecinas de la RAM. Muchísimo tráfico de memoria, poquísimo cálculo. Los ocho núcleos terminan haciendo fila frente al mismo bus de memoria: añadir hilos no añade velocidad, porque el límite no es la CPU, es el ancho de banda.

Compáralo con el transporte de partículas: muchísimo cálculo por cada byte que toca —es *compute-bound*— y por eso escala a 8x. En el módulo práctico 7 vas a medir esta diferencia con tus propias manos.

### Conexión con Telar (3:30–4:00)

El simulador de Telar es el laboratorio perfecto para cazar overhead: toma el mismo código y córrelo con 1, 2, 4 y 8 hilos. Observa dónde el speedup deja de crecer, o incluso retrocede. Ese punto exacto te está diciendo cuánto trabajo real hay en tu problema y cuánto te cuesta coordinarlo. Es un experimento de dos minutos que responde la pregunta central de esta lección: ¿valen la pena los hilos aquí, o serial gana?

## Apoyo visual

- 0:00–0:20 — dos barras de tiempo: «serial» corta, «8 hilos» más larga, con un sello rojo de «¿MÁS LENTO?».
- 0:20–1:40 — la mudanza: ocho amigos rodeando una silla; luego la lista de los cuatro costos apareciendo uno a uno (crear hilos, repartir, sincronizar, competir por memoria).
- 1:40–2:40 — balanza «trabajo útil vs coordinación» inclinándose según crece el tamaño del problema; timeline donde la franja de overhead se come la ganancia en el caso pequeño.
- 2:40–3:30 — ocho núcleos haciendo fila frente a un solo bus de memoria; comparativa stencil de calor (~1.1x) vs transporte de partículas (~8x).
- 3:30–4:00 — el simulador de Telar corriendo el mismo código con 1, 2, 4, 8 hilos y la curva de speedup aplanándose.

## Para recordar

- El overhead son los costos invisibles del paralelismo: crear hilos, repartir trabajo, sincronizarse y competir por memoria y caché.
- Regla mental: el trabajo por hilo debe ser mucho mayor que el costo de coordinarse; con problemas pequeños, serial gana.
- Un programa memory-bound (como el stencil de calor, ~1.1x) no acelera con más hilos: el límite es el ancho de banda de memoria, no la CPU.
- Experimento clave en Telar: correr el mismo código con 1, 2, 4 y 8 hilos y encontrar dónde deja de mejorar.
