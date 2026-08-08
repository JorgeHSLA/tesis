# Race conditions: el bug más traicionero

Video F3.3 · ~5 minutos · Módulo F3 «Memoria compartida y sus peligros»

**Objetivo:** entender qué es una condición de carrera y por qué produce resultados no deterministas.

## Guion

### Gancho (0:00–0:20)

Imagina un programa que da un resultado distinto cada vez que lo corres. Y de vez en cuando — solo de vez en cuando — da el correcto. No es tu computador, no es magia negra: es una race condition, una condición de carrera. El bug más traicionero de toda la programación paralela.

### La hoja de cálculo compartida (0:20–1:20)

Piensa en dos personas editando la misma celda de una hoja de cálculo, sin refrescar la pantalla. La celda dice 40. Ana la lee y calcula que hay que sumarle 10. Beto la lee al mismo tiempo — también ve 40 — y calcula que hay que sumarle 5. Ana guarda 50. Un segundo después, Beto guarda 45… sobre el 50 de Ana. La suma de Ana desapareció sin dejar rastro: nadie vio un error, nadie recibió un aviso. La celda simplemente quedó mal.

Eso es exactamente lo que les pasa a dos hilos cuando actualizan la misma variable compartida sin coordinarse.

### Anatomía de `contador += 1` (1:20–2:50)

Vamos al código. La línea `contador += 1` parece una sola operación, pero para el procesador son **tres pasos**: leer el valor, sumarle uno, escribir el resultado. Míralo con dos hilos intercalados:

```text
contador += 1 son en realidad TRES pasos:
  1. leer     el valor de contador
  2. sumar    1 al valor leído
  3. escribir el resultado en contador

contador vale 40. Dos hilos lo incrementan «a la vez»:

  Hilo A: lee 40
  Hilo B: lee 40        <- lee ANTES de que A escriba
  Hilo A: suma -> 41
  Hilo B: suma -> 41
  Hilo A: escribe 41
  Hilo B: escribe 41    <- pisa la escritura de A

Resultado final: 41. Debería ser 42. Una suma SE PERDIÓ.
```

El hilo B leyó el valor viejo antes de que A escribiera el nuevo, así que la escritura de B pisó la de A. Dos incrementos, pero el contador solo subió uno: una actualización se perdió.

Y aquí está la clave del no determinismo: si B hubiera llegado un microsegundo más tarde, todo habría salido bien. El resultado depende del orden exacto en que el sistema operativo intercala a los hilos — y ese orden cambia en cada ejecución. Por eso se llama «carrera»: gana el que llega primero, y nunca sabes quién será.

### Por qué es tan traicionero (2:50–3:50)

Este bug tiene tres propiedades que lo hacen especialmente peligroso. Uno: el compilador no lo detecta — el código es sintácticamente perfecto. Dos: el programa no crashea — corre hasta el final y entrega un número, solo que un número equivocado. Y tres: es intermitente — con pocos datos o poca carga, los hilos casi nunca chocan, así que **funciona en tus pruebas y falla en producción**, donde la carga y el tamaño del problema multiplican las oportunidades de colisión. Un bug que se esconde cuando lo buscas es el peor tipo de bug.

### La demo real: Mandelbrot (3:50–4:30)

En este curso no te lo vamos a contar: te lo vamos a mostrar. El ejemplo `mandelbrot` estima el área del conjunto de Mandelbrot contando puntos, y trae **un bug puesto a propósito**: el contador `num_outside` es compartido y todos los hilos le hacen `+= 1` sin protección. Tres corridas reales de la versión rota: área 1.955, área 1.788, área 2.272. Distinta cada vez, y siempre lejos del valor real, que ronda 1.506. La versión corregida da 1.5103 en todas las corridas, sin excepción. Como resume la propia lección: el programa no crashea — solo miente.

### Conexión con Telar (4:30–5:00)

En el módulo m5 de Telar vas a correr ese bug tú mismo: lanzarás la versión rota varias veces, verás el área bailar entre corridas, y luego la arreglarás. En los próximos dos videos te doy las herramientas: la exclusión mutua con `critical` y la joya de la corona, `reduction`. No te los saltes: son el antídoto exacto de lo que acabas de ver.

## Apoyo visual

- 0:00–0:20 — terminal con tres corridas del mismo programa mostrando tres resultados distintos.
- 0:20–1:20 — animación de la hoja de cálculo: Ana y Beto leyendo la misma celda, la escritura de Ana desapareciendo bajo la de Beto.
- 1:20–2:50 — timeline de dos hilos sobre la variable `contador`: los tres pasos (leer, sumar, escribir) intercalándose, con la actualización perdida resaltada en rojo.
- 2:50–3:50 — tríptico: «el compilador no lo ve · no crashea · funciona en pruebas, falla en producción».
- 3:50–5:00 — output real de `mandelbrot`: las tres áreas con race variando frente a las tres con `reduction` clavadas en 1.5103; captura del módulo m5 en Telar.

## Para recordar

- Una race condition ocurre cuando dos hilos actualizan la misma variable compartida sin coordinación y el resultado depende del orden de llegada.
- `contador += 1` son tres pasos (leer, sumar, escribir): dos hilos intercalados pierden actualizaciones.
- Es traicionero: no lo detecta el compilador, no crashea, y puede pasar todas tus pruebas. «El programa no crashea, solo miente.»
- El ejemplo `mandelbrot` del curso demuestra el bug en vivo: área distinta en cada corrida con race; 1.5103 siempre con `reduction`.
