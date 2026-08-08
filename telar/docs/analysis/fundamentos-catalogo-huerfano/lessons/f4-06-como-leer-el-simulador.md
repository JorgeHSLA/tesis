# Cómo leer el simulador de Telar

Video F4.6 · ~4 minutos · Módulo F4 «OpenMP y PyOMP: tu caja de herramientas»

**Objetivo:** Saber leer todo lo que el simulador muestra —logs, métricas del contenedor, resultados— antes de entrar a los módulos prácticos. Cierre del track.

## Guion

### Gancho (0:00–0:20)

Ya tienes todo el vocabulario del paralelismo. Solo falta una cosa antes de ensuciarte las manos: aprender a leer la herramienta donde vas a ejecutar código. Cuatro minutos para conocer el simulador de Telar de arriba abajo, y con eso cierras el track y quedas listo para el módulo uno.

### El ciclo de un job (0:20–1:30)

Todo en el simulador gira en torno a un ciclo de tres pasos. **Uno: eliges tu código.** Puedes subir tu propio archivo `.py` con PyOMP, o elegir uno de los ejemplos precargados del curso. **Dos: configuras.** Aquí mueves el slider de hilos —que ya sabes que controla cuántos hilos nacen, el `OMP_NUM_THREADS` del que hemos hablado todo el track— y ajustas las opciones que el ejemplo permita. **Tres: lanzas.** Le das al botón, y tu código se pone a correr.

Ese es el ritmo que vas a repetir en cada lección práctica: elegir, configurar, lanzar. Simple.

### Qué corre por detrás (1:30–2:20)

Pero, ¿dónde corre tu código cuando le das a lanzar? No en tu navegador ni directamente en el servidor. Corre dentro de un **contenedor Docker aislado**: una cajita sellada con Python y PyOMP ya instalados, creada solo para tu job y destruida al terminar. Y esa caja está deliberadamente encerrada: **sin acceso a la red**, con un usuario sin privilegios, y con **límites estrictos** de CPU, de memoria y de tiempo. Si tu programa intenta usar más de la cuenta o se cuelga, el sistema lo corta.

¿Por qué tanto candado? Porque el simulador ejecuta código real, y ejecutar código de forma segura exige aislarlo. Para ti, como estudiante, esto es transparente: solo significa que puedes experimentar, romper cosas, meter bugs a propósito, sin miedo a dañar nada. La caja te protege a ti y protege al sistema.

### Las pantallas: en vivo y resultados (2:20–3:20)

Mientras tu job corre, ves la **pantalla en vivo**, y trae tres cosas que ya sabes interpretar. Primero, los **logs en streaming**: lo que tu programa va imprimiendo, línea a línea, en tiempo real —como los saludos desordenados del video anterior—. Segundo, las **métricas del contenedor**: cuánta CPU y cuánta memoria está consumiendo tu código en cada instante; aquí es donde ves los núcleos encenderse. Tercero, la **actividad por hilo**: el fork-join respirando con datos reales.

Cuando el job termina, pasas a la **pantalla de resultados**. Ahí está el veredicto: el **tiempo total** que tardó, el **speedup** —cuántas veces más rápido fue con varios hilos que con uno, exactamente la métrica del módulo F2—, la distribución del trabajo entre hilos, y la **salida completa** descargable. Todo lo que aprendiste a nombrar en el track, aquí lo vas a ver medido.

### Cierre del track (3:20–4:00)

Y con esto cerramos. Hagamos memoria de lo que sabes ahora: por qué existe el paralelismo y qué es un hilo; cómo se reparte el trabajo y cómo se mide con speedup, Amdahl y overhead; los peligros de la memoria compartida y sus remedios —private, critical, reduction, barreras—; y qué es OpenMP, el modelo fork-join, y cómo PyOMP lo trae a Python. Eso es un montón de terreno. Ya no eres un espectador: tienes el vocabulario y el mapa. Ahora toca lo divertido —ejecutar, romper y arreglar programas de verdad—. Nos vemos en el módulo uno. Tu primer job te está esperando: el cálculo de π en paralelo.

## Apoyo visual

- 0:00–0:20 — Barrido rápido por todas las pantallas del simulador; título «cómo leer Telar».
- 0:20–1:30 — El ciclo de 3 pasos: elegir código (upload o presets) → configurar (el slider de hilos) → botón lanzar.
- 1:30–2:20 — Un contenedor Docker como caja sellada con Python+PyOMP; iconos de «sin red», «non-root», «límites CPU/mem/tiempo».
- 2:20–3:00 — Pantalla en vivo: logs corriendo, gráficas de CPU/memoria subiendo, actividad por hilo (fork-join).
- 3:00–3:20 — Pantalla de resultados: tiempo total, speedup, distribución, botón de descarga del stdout.
- 3:20–4:00 — Resumen visual de los 4 módulos del track; transición al «Módulo 1: π en paralelo».

## Para recordar

- El ciclo de todo job: **elegir** código (subir o preset) → **configurar** (slider de hilos) → **lanzar**.
- Tu código corre en un **contenedor Docker aislado**: sin red, non-root, con límites de CPU, memoria y tiempo. Puedes experimentar sin miedo.
- Pantalla en vivo: logs en streaming, métricas de CPU/memoria del contenedor, actividad por hilo (el fork-join real).
- Pantalla de resultados: tiempo total, **speedup**, distribución del trabajo y stdout descargable. Ya tienes el vocabulario para leerlo todo.
