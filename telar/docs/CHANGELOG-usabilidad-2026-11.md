# CHANGELOG — Mejoras salidas de las pruebas de usabilidad (noviembre de 2026)

Publicado en la **app 1.0.12** y el **backend 1.0.5** (2026-11-17).

## Origen

Pruebas con 17 estudiantes: 10 minutos de uso libre, preguntas al momento y un
formulario al final. Cada persona hizo 8 tareas (encontrar la lección, leer, ver el
video, responder el quiz, abrir el simulador, ejecutar con 1 y con 2 hilos, ver los
resultados). Resultado: 125 de 136 tareas sin ayuda (92 %), ninguna sin completar.
Las 11 con ayuda se concentraron en encontrar la lección, abrir el simulador,
elegir el ejemplo/los hilos y volver a Aprender desde Resultados.

## Qué se cambió y por qué

| Hallazgo (quién lo dijo) | Cambio |
|---|---|
| Iconos del menú sin nombre (12 de 17) | Al pasar el cursor con el menú plegado sale su nombre. Antes existía con `::after`, pero un contenedor con scroll lo recortaba: ahora es un portal (`RailTooltip`). El modo claro/oscuro lleva texto con el menú abierto y el estado de conexión va en una fila. |
| Buscador solo para cursos | Buscador global (`Ctrl+K`): páginas, cursos, lecciones, ejemplos, ejecuciones, configuraciones guardadas y módulos disponibles. |
| Pantalla completa del video no funcionaba (E01–E03) | Electron negaba **todos** los permisos del navegador, incluido `fullscreen`. Ahora concede solo ese, solo a YouTube y a la propia app. |
| Mini reproductor abrupto / aparece sin reproducir (E04, E17) | Animación de entrada y regreso; solo aparece si el video se está reproduciendo (estado leído por `postMessage`, con `enablejsapi=1`). |
| Fuentes al final de la lección (E17) | Salen arriba como etiquetas; al pasar el cursor, la cita y el enlace. En Autoría tienen su propia sección. |
| Diagramas ASCII (E03, E05, E07) | Las lecciones aceptan imágenes: viven en el bucket (`imagenes/<sha256>`), la lección solo lleva el enlace. El diagrama de «Núcleos, caché y memoria» se hizo como imagen. |
| Cambiar hilos y repetir sin volver a Configurar (E03, E17) | «Re-ejecutar este ejemplo» y el deslizante de hilos en la pantalla de ejecución. |
| Pausar / velocidad (E17) | Reproductor de la ejecución (pausar, retroceder, saltar, 0,25×–4×). Es solo visual y no toca las métricas reales. El anillo de cada hilo sigue la CPU medida. |
| Colores en el código (E17) | Resaltado de sintaxis en el editor del simulador. |
| Simulador con scroll general; ejemplos de módulos sin ejemplos | La pantalla llena el alto (el scroll es dentro de cada tarjeta); el selector solo muestra módulos con ejemplos. |
| Métricas y gráfica poco claras (E02, E04, E14, E15, E16, E17) | «?» con explicación en cada dato; gráfica de speedup con ejes rotulados y tabla de valores; barras con nombres claros y una frase que las lee. |
| Volver / avanzar entre pantallas | Flechas en la barra superior. |
| Docker Desktop cerrado = error feo | Telar abre Docker Desktop al iniciar y lo cierra al salir (solo si lo abrió él); errores de Docker en lenguaje llano y barra de carga. |

## Decisiones que conviene recordar

- **Imágenes en la nube, no en el módulo:** el bundle sigue pesando kilobytes. A cambio,
  sin internet la imagen no se ve (hay un aviso). El validador de markdown solo admite
  URLs del bucket de Telar: una imagen de otro host serviría de baliza de rastreo.
- **Pausar/retroceder es solo visual:** pausar el contenedor falsearía los tiempos que
  mide el propio programa.
- **El anillo por hilo es un promedio:** `docker stats` mide el contenedor entero, no cada
  hilo. Medir cada hilo exigiría leer `/proc/<pid>/task/*` dentro del contenedor y
  ampliar el mensaje WS de métricas (contrato congelado).
- **Docker Desktop:** no se abre ni se cierra si su proceso ya existía (aunque esté en
  pausa); solo Windows y macOS; `TELAR_DOCKER_AUTOSTART=0` lo desactiva.

## Pendiente / no verificado

- La subida real de una imagen al bucket (solo probada con el driver local).
- La pantalla completa del video, el mini reproductor y el arranque/cierre de Docker
  Desktop en la app instalada (dependen de Electron y YouTube).
- Medir el rendimiento por hilo de verdad (ver arriba).
