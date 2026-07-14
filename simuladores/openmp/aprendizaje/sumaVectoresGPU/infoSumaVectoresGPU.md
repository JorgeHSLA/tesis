# de que trata?

suma de vectores ejecutada EN LA GPU con la directiva `target` de OpenMP: el mismo codigo Python, pero el bucle corre en los miles de nucleos de la tarjeta grafica. Es el ejemplo canonico de "offloading" que usa el propio equipo de PyOMP.

fuente: README oficial de PyOMP (ejemplo GPU) y docs

- https://github.com/Python-for-HPC/PyOMP#example
- https://pyomp.readthedocs.io/en/latest/usage.html

## EXPLICACION

`target` = "ejecuta este bloque en el dispositivo (GPU)"

`teams distribute` = en GPU no hay UN equipo de hilos como en CPU: hay muchos equipos (bloques CUDA). `teams` los crea y `distribute` reparte el bucle entre equipos

`parallel for` = dentro de cada equipo, paraleliza entre sus hilos

`map(to: a, b)` = copia los arrays del host (RAM) a la GPU al entrar al bloque. Solo lectura

`map(tofrom: c)` = copia c a la GPU al entrar Y de vuelta al host al salir (ahi viene el resultado)

el mapeo de datos es EL concepto central de GPU: la GPU tiene SU propia memoria, y mover datos por el PCIe suele costar mas que el calculo mismo.

## ⚠️ estado: NO PROBADO en esta maquina

el codigo esta escrito segun el ejemplo oficial, pero al ejecutarlo fallo con:

```
FileNotFoundError: 'x86_64-linux-gnu-gcc'
RuntimeError: Compilation failed for trampolines
```

pyomp necesita un compilador C del sistema para generar el codigo de offload. En esta maquina (WSL2 + GTX 1660, driver CUDA 13.1 OK) falta gcc. Para probarlo:

```bash
sudo apt-get install -y gcc
python sumaVectoresGPU.py
```

requisitos completos segun la documentacion oficial de pyomp 0.5.x:
- GPU NVIDIA (AMD esta "work in progress", macOS no tiene soporte GPU)
- Linux (incluye WSL2 con driver NVIDIA instalado en Windows)
- gcc instalado en el sistema
- los ejemplos CPU NO necesitan nada de esto (por eso el resto del repo funciona)
