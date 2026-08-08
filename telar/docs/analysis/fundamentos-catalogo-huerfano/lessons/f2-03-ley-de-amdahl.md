# La ley de Amdahl: el techo de cristal

Video F2.3 · ~5 minutos · Módulo F2 «Pensar en paralelo»

**Objetivo:** Entender el límite teórico del speedup que impone la fracción serial de un programa y sus consecuencias prácticas.

## Guion

### Gancho (0:00–0:20)

Te doy una mala noticia con número exacto: si el 5 por ciento de tu programa es serial —solo el 5— no importa cuántos núcleos le pongas. ¿Cien? ¿Mil? ¿Un millón? Nunca pasarás de 20x. Ese techo tiene nombre, ley de Amdahl, y conocerlo te va a ahorrar muchas horas de optimización inútil.

### Los cien pintores y la mezcla de pintura (0:20–1:30)

Volvamos a los pintores que conociste en el primer módulo. Pintar una casa se reparte de maravilla: más pintores, más paredes avanzando a la vez. Pero hay un detalle: antes de pintar, alguien tiene que mezclar la pintura para que todas las paredes queden del mismo tono. Y esa mezcla la hace una sola persona, en un solo balde, mientras el resto mira.

Con 4 pintores, la mezcla es un ratito sin importancia. Con 100 pintores, las paredes vuelan… y la mezcla sigue tardando exactamente lo mismo. Llega un punto en que casi todo el tiempo del proyecto es, precisamente, la mezcla. Puedes contratar mil pintores más: ya no ganas casi nada, porque lo que domina es la parte que no se puede repartir.

Todo programa tiene su «mezcla de pintura»: leer los datos de entrada, inicializar estructuras, escribir el resultado final. Esa es su fracción serial.

### La fórmula del techo (1:30–2:50)

Gene Amdahl puso esta intuición en fórmula en 1967. Divide el tiempo de tu programa en dos fracciones: `f_serial`, la parte que no se puede repartir, y `f_paralelo`, la que sí. El speedup con N hilos queda acotado así:

```
S ≤ 1 / (f_serial + f_paralelo / N)
```

Léelo en palabras: el speedup máximo es uno dividido por la fracción serial, más la fracción paralela repartida entre N hilos.

Ahora fíjate qué pasa cuando N crece muchísimo: el término `f_paralelo / N` se va haciendo pequeñito, casi cero, y la fórmula se reduce a `S ≤ 1 / f_serial`: uno entre la fracción serial. Ese es el techo de cristal. Con 5 por ciento serial: uno entre 0.05, veinte. Por eso el gancho del inicio: ni con un millón de núcleos pasas de 20x, porque los núcleos extra solo aceleran la parte paralela, y la serial queda intacta, esperando, como la mezcla de pintura.

### La tabla que duele (2:50–3:50)

Mira lo rápido que baja el techo cuando crece la parte serial:

| Parte paralela | Parte serial | Speedup máximo |
| --- | --- | --- |
| 95 % | 5 % | 20x |
| 90 % | 10 % | 10x |
| 50 % | 50 % | 2x |

Detente en la última fila, porque es la que más sorprende: si la mitad de tu programa es serial, tu techo es 2x. Dos. Aunque tengas un supercomputador entero a tu disposición, jamás irás más del doble de rápido. Y con 90 por ciento paralelo —que suena buenísimo— el techo es 10x: con 64 núcleos estarías desperdiciando la mayoría.

### La lección práctica (3:50–4:30)

De aquí sale una lección que contradice el primer instinto de todo el mundo. Cuando un programa paralelo no acelera, el reflejo es añadir más hilos. Amdahl dice: mira primero la fracción serial. Reducir la parte serial del 10 al 5 por ciento duplica tu techo, de 10x a 20x, sin tocar un solo hilo. A veces, una hora optimizando el código serial rinde más que cualquier cantidad de núcleos. Los ingenieros de HPC se obsesionan con la fracción serial por una buena razón: es la que manda.

### Conexión con Telar (4:30–5:00)

En el simulador de Telar vas a ver la ley de Amdahl en acción sin fórmulas: corre el mismo ejemplo con 1, 2, 4 y 8 hilos y grafica mentalmente los speedups. Verás la curva doblarse y aplanarse justo como predice Amdahl. Y una cosa más: en el quiz de este módulo te espera una pregunta concreta —¿cuál es el techo de un programa 80 por ciento paralelo?—. Ya tienes la fórmula: uno entre la fracción serial. Te toca hacer la cuenta.

## Apoyo visual

- 0:00–0:20 — contador de núcleos subiendo (8, 100, 1000…) mientras la aguja del speedup se clava en 20x y no pasa de ahí.
- 0:20–1:30 — brigada de pintores pintando paredes en paralelo; uno solo mezclando el balde mientras los demás esperan; barra de tiempo donde la franja «mezcla» no se encoge.
- 1:30–2:50 — la fórmula `S ≤ 1 / (f_serial + f_paralelo / N)` construyéndose por partes; animación de `f_paralelo / N` tendiendo a cero y la fórmula colapsando a `1 / f_serial`.
- 2:50–3:50 — curvas de speedup vs número de hilos para 95 %, 90 % y 50 % paralelo, aplanándose cada una contra su techo; la tabla apareciendo fila a fila.
- 3:50–5:00 — balanza «optimizar lo serial vs añadir hilos»; cierre con la pregunta del quiz en pantalla: «¿techo de un programa 80 % paralelo?».

## Para recordar

- La fracción serial de un programa no se acelera con más hilos: es el techo de cristal del speedup.
- `S ≤ 1 / (f_serial + f_paralelo / N)`; con infinitos núcleos queda `S ≤ 1 / f_serial`.
- Tabla rápida: 95 % paralelo → máximo 20x; 90 % → 10x; 50 % → 2x.
- Optimizar la parte serial a veces rinde más que añadir hilos: reducirla a la mitad duplica el techo.
