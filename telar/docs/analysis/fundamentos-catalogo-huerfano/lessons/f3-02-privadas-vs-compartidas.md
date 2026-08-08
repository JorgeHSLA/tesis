# Variables privadas vs compartidas

Video F3.2 · ~5 minutos · Módulo F3 «Memoria compartida y sus peligros»

**Objetivo:** dominar la decisión número uno de todo programa OpenMP: qué variable es de cada hilo y cuál es de todos.

## Guion

### Gancho (0:00–0:20)

Si te llevas una sola habilidad de este módulo, que sea esta: mirar una variable y saber si debe ser de un solo hilo o de todos. La lección práctica del curso lo dice sin rodeos: el 90% de los bugs paralelos son variables mal declaradas. Hoy aprendes a declararlas bien.

### La cocina compartida (0:20–1:30)

Vuelve a la casa de los hilos, y esta vez entra a la cocina. Ocho cocineros preparando un banquete juntos. La nevera es una sola y es de todos: cualquiera abre, saca ingredientes, guarda resultados. Esa nevera es una variable `shared`: existe una única copia y todos los hilos ven la misma.

Pero ¿la tabla de cortar? Ahí nadie comparte. Cada cocinero necesita la suya: si dos picaran sobre la misma tabla al mismo tiempo, los dedos y los ingredientes acabarían mezclados. La tabla es `private`: cada hilo recibe su propia copia, limpia, sin nada encima.

Y hay un tercer caso: la receta. El chef escribió una receta original, y cada cocinero recibe una fotocopia. Puede rayarla, anotarla y adaptarla sin afectar la original — pero su copia arranca con el contenido que ya tenía la receta. Eso es `firstprivate`: una copia por hilo que nace con el valor de afuera.

### Las tres palabras clave, con datos reales (1:30–3:10)

Formalicemos con lo que verás en OpenMP. `shared`: hay una sola variable para todos los hilos; lo que uno escribe, los demás lo ven — con todos los riesgos que ya conoces. `private`: cada hilo trabaja sobre su propia copia, que arranca **sin valor inicial garantizado**; lo que el hilo haga con ella no se ve fuera de la región paralela. `firstprivate`: igual que `private`, pero la copia de cada hilo se inicializa con el valor que la variable tenía antes de entrar a la región.

La lección práctica `entornoDatos` demuestra esto ejecutándolo con 4 hilos, y su salida real es muy elocuente. Una variable `x` vale 100 antes de la región y se declara `private`: dentro, cada hilo le asigna su propio valor — 0, 1000, 2000, 3000 — y al salir de la región, `x` sigue valiendo 100, intacta, porque los hilos trabajaron sobre copias. Una variable `zfp` vale 10 y se declara `firstprivate`: cada hilo imprime 10 más su número — 10, 11, 12, 13 — porque su copia nació valiendo 10. Y al salir, la original sigue en 10. Solo la variable `shared`, `zsh`, conserva el efecto de los hilos: los 4 sumaron 1 y afuera vale 4.

Esa es la foto completa: lo privado se evapora al salir; lo compartido permanece.

### La regla de oro (3:10–4:10)

¿Y cómo decides en la práctica? Con una regla de oro que resuelve casi todos los casos. Contadores de bucle y variables temporales de trabajo: **privados**, siempre. Cada hilo necesita su propio índice y su propio espacio de cálculo; compartirlos sería invitar al caos. Datos de entrada y estructuras de salida: **compartidos**. El array que todos leen y el resultado que construyen entre todos deben ser una sola cosa.

Una advertencia que viene directo de los ejemplos del curso: olvidar **una sola** variable de trabajo en la lista `private` ya es un bug. En el ejemplo de Mandelbrot que verás pronto, la versión correcta declara privadas las ocho variables de trabajo del punto; dejar una fuera sería un race tan real como el del bug principal. Declarar el entorno de datos no es burocracia: es la diferencia entre un programa correcto y uno que miente.

### Conexión con Telar (4:10–5:00)

En Telar, la lección `entornoDatos` del módulo m3 es un laboratorio construido a propósito para esto: no calcula nada útil, y esa es su gracia. Declara una variable de cada tipo, las modifica desde 4 hilos y te muestra qué sobrevive al salir de la región. Córrela varias veces: verás que las líneas de los hilos salen en orden distinto, pero los valores de las copias privadas y de la compartida son siempre los que acabas de aprender. Cuando puedas predecir esa salida antes de ejecutarla, la decisión número uno de OpenMP ya es tuya.

## Apoyo visual

- 0:00–0:20 — titular con la cita: «el 90% de los bugs paralelos son variables mal declaradas».
- 0:20–1:30 — cocina animada: una nevera etiquetada `shared`, ocho tablas de cortar etiquetadas `private`, fotocopias de una receta etiquetadas `firstprivate`.
- 1:30–3:10 — diagrama de memoria: una caja grande compartida (`zsh`) y 4 cajitas por hilo para `x` y `zfp`; al lado, el output real de `entornoDatos` resaltando la línea final «x = 100 | zfp = 10 | zsh = 4».
- 3:10–4:10 — tabla de dos columnas: «privado: contadores, temporales» / «compartido: entrada, salida»; después, una lista `private(...)` donde una variable olvidada parpadea en rojo.
- 4:10–5:00 — captura de la lección `entornoDatos` en Telar con el botón de ejecutar.

## Para recordar

- `shared`: una sola variable para todos los hilos; lo escrito permanece fuera de la región.
- `private`: una copia por hilo, sin valor inicial garantizado; se evapora al salir.
- `firstprivate`: una copia por hilo que nace con el valor de afuera.
- Regla de oro: contadores y temporales → privados; datos de entrada/salida → compartidos. Olvidar una variable en `private` ya es un bug.
