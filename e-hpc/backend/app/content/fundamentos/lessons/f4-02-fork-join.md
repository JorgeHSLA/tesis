# El modelo fork-join

Video F4.2 · ~4 minutos · Módulo F4 «OpenMP y PyOMP: tu caja de herramientas»

**Objetivo:** Entender el modelo de ejecución de todo programa OpenMP — empieza con un hilo, se abre en varios (fork) y se vuelve a cerrar en uno (join) — para saber leer cualquier código paralelo.

## Guion

### Gancho (0:00–0:20)

Todo programa OpenMP del mundo, por complejo que sea, sigue un mismo patrón de respiración: se abre, trabaja en equipo, se cierra. Se abre, trabaja, se cierra. Ese patrón tiene nombre —fork-join— y si lo entiendes, puedes leer cualquier código paralelo sabiendo exactamente qué está pasando. Cuatro minutos.

### El jefe de obra (0:20–1:30)

Piensa en un jefe de obra que trabaja solo la mayor parte del día: revisa planos, hace papeleo, tareas de una sola persona. Pero llega un momento en que hay que levantar una pared, y eso no lo hace solo. Entonces **convoca a la cuadrilla**: llama a ocho obreros, les reparte la pared en tramos, y todos trabajan a la vez. Cuando la pared está lista, **despide a la cuadrilla**, los obreros se van, y el jefe vuelve a quedarse solo con su papeleo hasta la siguiente pared.

Ese vaivén —uno solo, luego muchos, luego uno solo otra vez— es exactamente cómo funciona OpenMP. Y puede repetirse muchas veces a lo largo del programa: cada vez que hay una tarea paralelizable, se convoca la cuadrilla y se despide al terminar.

### Fork y join (1:30–3:00)

Pongámosle los términos técnicos. Tu programa empieza con **un solo hilo**, al que se le llama el hilo maestro o *master*. Va ejecutando tu código de forma serial, línea por línea, como cualquier programa normal.

Cuando llega a una región paralela —ese bloque que marcaste con una directiva— ocurre el **fork**: del hilo maestro nacen varios hilos, digamos ocho, y todos entran a ejecutar el bloque paralelo a la vez. Aquí es donde se usan los ocho núcleos.

Cuando el bloque paralelo termina, ocurre el **join**: los hilos se sincronizan, esperan a que todos acaben, y luego se cierran. Vuelve a quedar solo el hilo maestro, que sigue con el código serial que venga después. Fork para abrir, join para cerrar. Un diagrama vale más que mil palabras:

```
maestro  ──────┐                    ┌──────────┐              ┌──────
               │  fork              │ join      │  fork        │
               ├──► hilo 0 ─────────┤           ├──► hilo 0 ───┤
               ├──► hilo 1 ─────────┤           ├──► hilo 1 ───┤
               ├──► hilo 2 ─────────┤           ├──► hilo 2 ───┤
               └──► hilo 3 ─────────┘           └──► hilo 3 ───┘
   serial       región paralela      serial      región paralela
```

Fíjate en algo importante: entre región y región paralela, el programa vuelve a ser serial. Un hilo. Por eso la parte serial de tu código —esa que la ley de Amdahl castigaba tanto— es literalmente el tiempo que el maestro pasa solo, sin cuadrilla. Cuanto más tiempo pase el programa con la cuadrilla convocada y trabajando bien repartida, más rápido irá.

### Cómo leer un programa OpenMP (3:00–3:35)

La consecuencia práctica es una habilidad de lectura. Cuando te enfrentes a un código OpenMP, lo primero que debes buscar es: **¿dónde forkea y dónde joinea?** Localiza las regiones paralelas —los bloques marcados con directivas— y ya sabes dónde entra la cuadrilla y dónde se va. Todo lo que está fuera de esas regiones lo hace un solo hilo. Con ese mapa mental, cualquier programa paralelo deja de ser un misterio.

### Conexión con E-HPC (3:35–4:00)

Y aquí viene algo bonito: la visualización de hilos «en vivo» del simulador de E-HPC es, literalmente, este diagrama con datos reales. Cuando lances un job vas a ver los hilos activarse al entrar a una región paralela y apagarse al salir: el fork y el join, respirando en tiempo real con tu propio código. En el próximo video hacemos un recorrido rápido por las directivas que marcan esas regiones.

## Apoyo visual

- 0:00–0:20 — Animación de una línea que se abre en varias y se vuelve a cerrar, respirando; título «fork-join».
- 0:20–1:30 — Un jefe de obra solo con papeleo; convoca 8 obreros para una pared; los despide; vuelve a estar solo.
- 1:30–3:00 — El diagrama fork-join animado, sincronizado con etiquetas «serial / región paralela / serial»; se resalta que entre regiones hay un solo hilo.
- 3:00–3:35 — Un fragmento de código OpenMP con las regiones paralelas resaltadas en color; lupa buscando «¿dónde forkea?».
- 3:35–4:00 — La visualización de hilos en vivo del simulador E-HPC activándose y apagándose.

## Para recordar

- Todo programa OpenMP respira: **fork** (un hilo se abre en muchos) y **join** (vuelven a uno).
- Empieza con el hilo **maestro** (serial); en cada región paralela nacen los hilos y al final se cierran.
- Entre regiones paralelas el programa es serial — ese es el tiempo que la ley de Amdahl penaliza.
- Leer código OpenMP = localizar dónde forkea y dónde joinea.
