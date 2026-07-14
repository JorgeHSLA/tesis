# ¿Qué es OpenMP?

Video F4.1 · ~5 minutos · Módulo F4 «OpenMP y PyOMP: tu caja de herramientas»

**Objetivo:** presentar OpenMP como el estándar de directivas para paralelismo en memoria compartida y su filosofía de paralelización incremental.

## Guion

### Gancho (0:00–0:20)

Hay un estándar de programación que usan los laboratorios nacionales, los centros de supercomputación y buena parte de la ciencia que se calcula en este planeta: simulaciones de clima, física de partículas, genómica. Y lo más sorprendente es que cabe en una sola línea de tu código. Se llama OpenMP, y en los próximos cinco minutos vas a entender exactamente qué es.

### Una línea que lo cambia todo (0:20–1:30)

Mira este bucle en C. Recorre dos arrays y suma sus elementos, posición por posición. Es un programa serial de toda la vida: un solo hilo dando un millón de vueltas.

```c
#pragma omp parallel for
for (int i = 0; i < n; i++) {
    c[i] = a[i] + b[i];
}
```

Ahora fíjate en la primera línea: `#pragma omp parallel for`. Esa línea no es una función. No es una llamada a una librería. Es una **anotación**: una nota al margen que le dice al compilador «este bucle se puede repartir entre varios hilos; encárgate tú». Con esa única línea, el mismo bucle pasa de usar un núcleo a usarlos todos.

Piensa en una receta de cocina con un post-it pegado sobre uno de los pasos: «este paso pueden hacerlo varios cocineros a la vez». La receta no cambió. Los ingredientes no cambiaron. Solo le añadiste una instrucción de organización. Eso, exactamente eso, es una directiva.

### Un estándar de directivas, no una librería (1:30–3:15)

Y eso es OpenMP: un **estándar de directivas** para programar en paralelo sobre memoria compartida. Existe desde 1997 — casi treinta años de historia — y lo mantiene un consorcio en el que participan los grandes fabricantes de procesadores y de compiladores. Vive de forma nativa en tres lenguajes: C, C++ y Fortran, los clásicos del cómputo científico.

La palabra clave es «directivas», y vale la pena contrastarla con la alternativa. Una librería tradicional de hilos te da funciones que tú tienes que llamar: crea ocho hilos, calcula a mano qué trozo del trabajo le toca a cada uno, espera a que terminen, destrúyelos… todo paso por paso, y con mil oportunidades de equivocarte. OpenMP invierte la lógica: tú marcas **qué** quieres paralelizar, y el compilador, junto con su runtime, decide **cómo**: crea los hilos, reparte las iteraciones, los sincroniza al final y los reutiliza en la siguiente región. Tú escribes la intención; la maquinaria pesada la pone el estándar.

Por eso, en el mundo del HPC de memoria compartida — es decir, paralelismo dentro de una máquina donde todos los hilos ven las mismas variables, como aprendiste en el módulo F1 — OpenMP es el estándar dominante desde hace décadas.

### La filosofía: paralelizar poco a poco (3:15–4:20)

Y aquí está la idea que lo hizo ganar: la **paralelización incremental**. Con OpenMP no reescribes tu programa para hacerlo paralelo. Partes de la versión serial, que ya funciona y que ya sabes que da el resultado correcto. Mides dónde se va el tiempo. Y añades directivas solo en los puntos calientes: ese bucle que se come el noventa por ciento de la ejecución. El resto del programa queda intacto, línea por línea.

Mejor todavía: si un compilador ignora las directivas, el programa sigue siendo un programa serial válido que produce el mismo resultado. Puedes añadir paralelismo — y quitarlo — capa por capa, verificando la correctitud en cada paso. Comparado con reescribirlo todo desde cero, es una diferencia de noche y día.

Una aclaración honesta antes de cerrar: OpenMP trabaja dentro de **una** máquina, con hilos que comparten memoria; para repartir trabajo entre varias máquinas de un clúster existe otro estándar, MPI, que queda fuera de este curso.

### Conexión con E-HPC (4:20–5:00)

¿Y qué pinta todo esto en E-HPC, si aquí programamos en Python? Pues que se transfiere directo: en este curso usarás PyOMP, que te permite escribir estas mismas directivas — con exactamente la misma sintaxis — dentro de Python compilado. Cómo es posible esa magia lo vemos en el video F4.4. Y cada directiva importante tiene su lección práctica en el simulador, donde la ejecutarás sobre código real y medirás la diferencia con tus propios ojos. OpenMP no es teoría de museo: es la línea que vas a escribir una y otra vez durante todo el curso.

## Apoyo visual

- 0:00–0:20: montaje rápido de supercomputadores y visualizaciones científicas; al final, zoom hacia una sola línea de código resaltada.
- 0:20–1:30: el bucle serial en pantalla; la línea `#pragma omp parallel for` se escribe encima con efecto de tipeo; un medidor de núcleos pasa de 1 activo a 8 activos.
- 1:30–3:15: línea de tiempo 1997→hoy; tarjetas de C, C++ y Fortran; comparación en dos columnas «librería: docena de llamadas manuales» vs «directiva: 1 anotación».
- 3:15–4:20: un programa largo en gris donde solo dos bucles se iluminan en color al recibir directivas; rótulo breve «¿varias máquinas? eso es MPI».
- 4:20–5:00: transición al editor de E-HPC mostrando `with openmp("parallel for")` en Python.

## Para recordar

- OpenMP es un estándar de **directivas** (desde 1997) para paralelismo en memoria compartida, nativo en C, C++ y Fortran.
- Una directiva es una anotación sobre tu código: tú marcas qué paralelizar; el compilador y su runtime hacen el trabajo sucio.
- Filosofía de paralelización incremental: el programa serial sigue funcionando y añades paralelismo solo donde importa.
- OpenMP es paralelismo dentro de una máquina; repartir trabajo entre varias máquinas es MPI, otro estándar.
