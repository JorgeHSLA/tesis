# Suma de vectores en GPU (target)

Suma de vectores ejecutada **EN LA GPU** con la directiva `target` de OpenMP: el mismo código Python, pero el bucle corre en los miles de núcleos de la tarjeta gráfica. Es el ejemplo canónico de «*offloading*» que usa el propio equipo de PyOMP.

## Explicación línea a línea

- `target` = «ejecuta este bloque en el dispositivo (GPU)».
- `teams distribute` = en GPU no hay UN equipo de hilos como en CPU: hay **muchos equipos** (bloques CUDA). `teams` los crea y `distribute` reparte el bucle entre equipos.
- `parallel for` = dentro de cada equipo, paraleliza entre sus hilos.
- `map(to: a, b)` = copia los arrays del host (RAM) a la GPU **al entrar** al bloque. Solo lectura.
- `map(tofrom: c)` = copia `c` a la GPU al entrar **Y de vuelta al host al salir** (ahí viene el resultado).

El **mapeo de datos es EL concepto central de GPU**: la GPU tiene SU propia memoria, y mover datos por el PCIe suele costar más que el cálculo mismo.

## Estado: NO PROBADO en la máquina de referencia

El código está escrito según el ejemplo oficial, pero al ejecutarlo falló con:

```
FileNotFoundError: 'x86_64-linux-gnu-gcc'
RuntimeError: Compilation failed for trampolines
```

pyomp necesita un **compilador C del sistema** para generar el código de offload. En la máquina de referencia (WSL2 + GTX 1660, driver CUDA 13.1 OK) falta gcc. Para probarlo:

```
sudo apt-get install -y gcc
python sumaVectoresGPU.py
```

## Requisitos completos (docs oficiales de pyomp 0.5.x)

- GPU **NVIDIA** (AMD está «work in progress»; macOS no tiene soporte GPU).
- **Linux** (incluye WSL2 con driver NVIDIA instalado en Windows).
- **gcc** instalado en el sistema.
- Los ejemplos CPU **NO necesitan nada de esto** (por eso el resto del curso funciona sin GPU).

No hay *fallback* a CPU: sin GPU + gcc el proceso aborta con excepción; por eso esta lección está deshabilitada por defecto en el simulador.

## Fuentes

- [README oficial de PyOMP (ejemplo GPU)](https://github.com/Python-for-HPC/PyOMP#example)
- [Documentación de pyomp](https://pyomp.readthedocs.io/en/latest/usage.html)
