// helpTexts — explicaciones breves de cada dato de Simulador y Resultados, en
// lenguaje llano. Una sola fuente para que la misma métrica se explique igual en
// la ejecución en vivo y en Resultados. Cada una responde: qué es, cómo se lee y
// qué valor «es bueno». Los números del ejemplo (4 hilos, 400 %…) son ilustrativos.
import { HelpTip } from './HelpTip'

export const Help = {
  tiempoTotal: (
    <HelpTip topic="tiempo total">
      Lo que tardó toda la ejecución, desde que arrancó el contenedor hasta que el programa terminó. Incluye la
      compilación JIT de Numba: la primera vez que corre una función se compila y eso toma un momento, así que no es
      solo «el tiempo del bucle paralelo».
    </HelpTip>
  ),
  speedup: (
    <HelpTip topic="speedup" title="Speedup (aceleración)">
      Cuántas veces más rápido fue con varios hilos que con uno solo. <b>2×</b> = tardó la mitad; <b>4×</b> = la
      cuarta parte. Con N hilos lo máximo teórico es N×; casi siempre da menos, porque coordinar los hilos cuesta.
    </HelpTip>
  ),
  eficiencia: (
    <HelpTip topic="eficiencia">
      El speedup dividido entre los hilos usados. <b>100 %</b> = cada hilo aportó todo lo que podía. Si baja (por
      ejemplo 55 % con 8 hilos) es que parte del tiempo se va esperando, coordinando o usando memoria compartida.
    </HelpTip>
  ),
  cpu: (
    <HelpTip topic="uso de CPU" title="CPU del contenedor">
      Cuánto procesador usó el programa. <b>100 %</b> equivale a un núcleo completo, así que con 4 hilos trabajando
      bien verás cerca de <b>400 %</b>. Si usas 4 hilos y ves ~100 %, casi todo el trabajo corrió en uno solo.
    </HelpTip>
  ),
  memoria: (
    <HelpTip topic="memoria">
      La memoria RAM que llegó a usar el programa frente al límite que tiene el contenedor. Si se acerca al límite,
      la ejecución se corta por falta de memoria.
    </HelpTip>
  ),
  tareasContenedor: (
    <HelpTip topic="tareas del contenedor">
      Procesos e hilos del sistema dentro del contenedor (Python, los pools de Numba/OpenMP…). No es el número de
      hilos OpenMP de tu programa.
    </HelpTip>
  ),
  graficaSpeedup: (
    <HelpTip topic="la gráfica de speedup" title="Cómo leer la gráfica">
      Cada punto es una prueba con ese número de hilos (eje horizontal). Su altura es el speedup: cuántas veces más
      rápido fue que con 1 hilo. La línea <b>punteada</b> es el ideal (con N hilos, N veces más rápido). Mientras más
      pegada esté la línea <b>naranja</b> a la punteada, mejor se repartió el trabajo.
    </HelpTip>
  ),
  tablaSpeedup: (
    <HelpTip topic="la tabla de valores" title="Los números detrás de la gráfica">
      <b>Tiempo</b>: lo que tardó con esos hilos. <b>Speedup</b>: tiempo con 1 hilo ÷ tiempo con esos hilos.{' '}
      <b>Eficiencia</b>: speedup ÷ hilos.
    </HelpTip>
  ),
  graficaPar: (
    <HelpTip topic="la comparación de tiempos" title="Cómo leer las barras">
      Compara cuánto tardó tu versión paralela (OpenMP) contra una versión de referencia que hace lo mismo. La barra
      más corta es la más rápida. «Veces más rápida» es la razón entre las dos.
    </HelpTip>
  ),
  graficaEnVivo: (
    <HelpTip topic="la gráfica de CPU y memoria" title="CPU y memoria en el tiempo">
      La curva de CPU (izquierda) muestra cuánto procesador usó el programa a lo largo de la ejecución; la de
      memoria (derecha), cuánta RAM. Solo existe si viste la ejecución en vivo: no se guarda para después.
    </HelpTip>
  ),
  observaciones: (
    <HelpTip topic="observaciones">
      Lecturas automáticas de TUS números: qué pasó (por ejemplo, poco speedup) y una pista de por qué. Son orientativas;
      la lección asociada explica el fondo.
    </HelpTip>
  ),
  salida: (
    <HelpTip topic="la salida del programa" title="Output">
      Lo que tu programa imprimió (stdout), línea por línea, tal como salió. Es la fuente de los tiempos que usa Telar
      para calcular el speedup.
    </HelpTip>
  ),
  reproductor: (
    <HelpTip topic="el reproductor" title="Reproductor de la ejecución">
      Cuando la ejecución termina puedes volver a verla: pausar, retroceder, saltar a un momento (arrastrando la
      línea) y cambiar la velocidad. Es solo visual: usa los mismos datos que ya llegaron y no cambia ninguna
      medida.
    </HelpTip>
  ),
  hilosIlustracion: (
    <HelpTip topic="la ilustración de hilos" title="Ilustración de hilos">
      Un dibujo de los hilos del equipo (t0 es el maestro). El <b>anillo</b> es REAL: muestra la CPU medida del
      contenedor repartida a partes iguales entre los hilos (con 4 hilos y 200 % de CPU, cada anillo marca 50 %). Docker
      mide el contenedor entero, no cada hilo por separado, así que es un promedio. Los puntos que viajan entre hilos
      son decorativos: representan la coordinación, no una medida.
    </HelpTip>
  ),
} as const
