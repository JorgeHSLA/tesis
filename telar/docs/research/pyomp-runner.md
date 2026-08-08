# Investigación: imagen Docker del runner PyOMP para Telar

> Investigado y **verificado empíricamente** el 2026-07-12 en el entorno real del proyecto:
> WSL2 (Ubuntu, kernel 6.6.87.2-microsoft-standard), Docker 29.3.0, 8 núcleos.
> Evidencia primaria: el repo de aprendizaje `/mnt/d/universidad/tesis/simuladores/openmp/aprendizaje/`
> (probado con Python 3.12.3 + pyomp 0.5.1 + numba 0.63.1) y una imagen de prueba
> construida y ejecutada en esta máquina (`telar-runner-test`, queda en el daemon local).

## TL;DR — decisiones

| Decisión | Valor | Por qué |
|---|---|---|
| Imagen base | `python:3.12-slim` (Debian 13 trixie, glibc 2.41) | Hay wheel cp312 manylinux_2_28; conda **no** es necesario |
| Instalación | `pip install "pyomp==0.5.1"` | Wheel autocontenido; probado en esta máquina dentro y fuera de Docker |
| libomp/TBB del sistema | **No instalar nada** | El wheel trae su propio `libomp.so` (LLVM 20.1) |
| Hilos | Pasar **siempre** `OMP_NUM_THREADS` = límite `--cpus` | libomp **no** es cgroup-aware (verificado: con `--cpus=2` ve 8 hilos) |
| Caché JIT horneada | **No viable** | `@njit(cache=True)` + región `openmp` falla (verificado); mitigación = UX + `compileall` |
| Latencia primer run | **~1.9 s end-to-end** (no 30 s) | Medido en contenedor frío aislado; el miedo a 30 s venía del FS 9p de `/mnt/d` |

---

## 1. Matriz de versiones (PyPI, verificado 2026-07-12)

Fuente: `https://pypi.org/pypi/pyomp/json` y https://pypi.org/project/pyomp/

- Versiones publicadas: 0.2.0, 0.3.0–0.3.2, 0.4.0, **0.5.0, 0.5.1** (0.5.1 publicada el 2026-02-19).
- `requires-python` de 0.5.1: **`>=3.10,<3.15`**.
- Dependencias declaradas de pyomp 0.5.1: `numba>=0.62,<0.64`, `lark`, `cffi`, `setuptools`.
- Matriz de compatibilidad oficial (README y docs de PyOMP): pyomp 0.5.x ↔ numba 0.62.x–0.63.x; 0.4.x ↔ 0.61.x; 0.3.x ↔ 0.57.x–0.60.x.

### Wheels de pyomp 0.5.1

| Python tag | linux x86_64 | linux aarch64 | macOS arm64 |
|---|---|---|---|
| cp310 | ✅ manylinux_2_27/_2_28 | ✅ | ✅ macosx_11_0 |
| cp311 | ✅ | ✅ | ✅ |
| **cp312** | **✅ (la que usa el runner)** | ✅ | ✅ |
| cp313 | ✅ | ✅ | ✅ |
| cp314 | ✅ | ✅ | ✅ |

**Conclusión crítica:** SÍ hay wheel para Python 3.12 en linux x86_64 → `python:3.12-slim`
es válido y coincide con el Python 3.12.3 del host donde ya se validaron los 14 ejemplos.
No hay wheels para Windows ni musllinux (**Alpine descartada**). `manylinux_2_28`
exige glibc ≥ 2.28: Debian 12 (2.36) y 13 (2.41) cumplen.

### Lo que `pip install pyomp==0.5.1` instaló realmente (verificado en esta máquina)

```
pyomp 0.5.1, numba 0.63.1, llvmlite 0.46.0, numpy 2.3.5, lark 1.3.1, cffi 2.x, setuptools 82.x
```

Mismo resultado en el venv del repo de aprendizaje, en un venv nativo limpio y dentro
de la imagen Docker de prueba (reproducible).

## 2. ¿Necesita libomp/TBB del sistema? No.

Inspección de `site-packages` tras instalar el wheel (verificado):

```
numba/openmp/libs/openmp/lib/libomp.so            ← runtime OpenMP de LLVM, EMBEBIDO
numba/openmp/libs/openmp/lib/libomptarget.so.20.1 ← offloading target (LLVM 20.1)
numba/openmp/libs/openmp/lib/libpyomp_loader.so
numba/openmp/libs/pass/libIntrinsicsOpenMP.so     ← pass LLVM de PyOMP
pyomp.libs/libffi-*.so, libzstd-*.so              ← vendorizadas por auditwheel
```

- **No hace falta `apt-get install libomp-dev` ni TBB.** TBB solo sería la capa de
  threading de numba para `parallel=True` (opcional; numba usa su workqueue interno si no está).
- El README oficial de PyOOMP hoy ofrece pip y conda como iguales; la recomendación
  histórica de conda quedó obsoleta desde que publican wheels manylinux (≥0.4/0.5).
- Existe imagen oficial `ghcr.io/python-for-hpc/pyomp:latest` (amd64+arm64) pero trae
  JupyterLab (orientada a probar PyOMP, no a runner mínimo) y no fija la versión de
  Python del tag → **preferimos imagen propia** con base pinneada.
- El ejemplo 14 (GPU, `target teams distribute`) además requiere `gcc` en la imagen,
  GPU NVIDIA y `--gpus` en `docker run`. **Fuera del alcance del runner MVP** (así lo
  documenta también el README del repo de aprendizaje: "⚠️ requiere gcc").

## 3. Variables de entorno (verificado)

| Variable | Efecto real | Recomendación runner |
|---|---|---|
| `OMP_NUM_THREADS` | La que **manda** sobre las directivas PyOMP (la lee el `libomp.so` embebido). Verificado: con `OMP_NUM_THREADS=4` los ejemplos reportan 4 hilos. | Pasarla SIEMPRE igual al límite `--cpus` |
| (sin setear) | **libomp NO es cgroup-aware**: en contenedor con `--cpus=2`, `omp_get_max_threads()` devolvió **8** (los núcleos del host) → oversubscription y métricas engañosas para el estudiante | Nunca confiar en el default |
| `NUMBA_NUM_THREADS` | Solo afecta la capa de threading propia de numba (`parallel=True`/`prange`), **no** a las directivas `openmp` | Setearla también, por si el estudiante mezcla `prange` |
| `NUMBA_CACHE_DIR` | Solo aplica a `@njit(cache=True)`. **Con regiones `openmp` el cacheo falla** (ver §5). Con rootfs read-only, un `cache=True` "normal" del estudiante intentaría escribir junto al código | Setear `NUMBA_CACHE_DIR=/tmp/numba_cache` + `--tmpfs /tmp` para que nunca rompa |
| `PYTHONUNBUFFERED=1` | Sin ella, los `print` del estudiante llegan a golpes al WebSocket | Obligatoria en la imagen |
| `omp_set_num_threads(n)` (API) | El código del estudiante puede subir hilos por encima del límite → solo oversubscription dentro de su cuota de CPU, no escape | Aceptable; documentarlo en la lección |

## 4. Dockerfile propuesto (probado en esta máquina)

Construido y ejecutado el 2026-07-12; el smoke test compiló y corrió durante el build
(1.4 s) y los ejemplos reales del repo de aprendizaje pasaron dentro del contenedor.
Tamaño resultante: **~777 MB** (llvmlite+numba+numpy dominan; slim vs full apenas cambia el total).

```dockerfile
# telar/runner/Dockerfile — runner PyOMP de Telar
# Base: hay wheel cp312 manylinux_2_28 (glibc>=2.28); trixie trae glibc 2.41.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # defaults seguros; el backend los sobreescribe con -e segun --cpus
    OMP_NUM_THREADS=4 \
    NUMBA_NUM_THREADS=4 \
    # si el estudiante usa @njit(cache=True) sin openmp, que escriba en tmpfs
    NUMBA_CACHE_DIR=/tmp/numba_cache

# pin exacto: pyomp 0.5.1 resuelve numba 0.63.1 + llvmlite 0.46.0 + numpy 2.3.5
# compileall precompila .pyc de numba/llvmlite -> import ~0.2s mas rapido y
# se hornea en la capa de imagen (unica "cache" horneable; ver doc §5)
RUN pip install "pyomp==0.5.1" \
 && python -m compileall -q /usr/local/lib/python3.12/site-packages

# usuario non-root sin shell de login
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner

USER runner
WORKDIR /home/runner

# Smoke test EN EL BUILD: compila y ejecuta un hello openmp real.
# Valida wheel+libomp+pass LLVM (fail-fast si la imagen quedo rota).
# OJO: NO deja cache JIT reutilizable (cache=True no funciona con openmp, §5).
RUN printf '%s\n' \
      'from numba.openmp import njit, openmp_context as openmp' \
      'from numba.openmp import omp_get_num_threads' \
      '@njit' \
      'def smoke():' \
      '    n = 0' \
      '    with openmp("parallel"):' \
      '        with openmp("critical"):' \
      '            n += 1' \
      '    return n' \
      'assert smoke() >= 1' \
      'print("smoke test OpenMP OK")' > /tmp/smoke.py \
 && python /tmp/smoke.py && rm -f /tmp/smoke.py

# el backend monta el codigo del estudiante en /home/runner/main.py (read-only)
CMD ["python", "/home/runner/main.py"]
```

### `docker run` recomendado desde el backend FastAPI

Todos estos flags se probaron juntos el 2026-07-12 (pi 1e8 en 1.83 s totales):

```bash
docker run --rm \
  --network=none \
  --cpus=4 --memory=512m --pids-limit=64 \
  --read-only --tmpfs /tmp:size=64m \
  --cap-drop=ALL --security-opt no-new-privileges \
  -e OMP_NUM_THREADS=4 -e NUMBA_NUM_THREADS=4 \
  -v /ruta/al/codigo/main.py:/home/runner/main.py:ro \
  telar-runner
```

Notas:
- `OMP_NUM_THREADS` **debe** igualar `--cpus` (ver §3). Si la UI deja elegir hilos
  (1–8), el backend cambia ambos a la vez.
- `--memory=512m` sobró para los 13 ejemplos CPU del repo; el compilador JIT vive
  dentro de ese presupuesto.
- `--read-only` + `--tmpfs /tmp` no rompe la compilación JIT (es en memoria).
- Las métricas en vivo salen de `docker stats` (cgroup v2); `--cpus` hace que el %
  de CPU mostrado tenga sentido pedagógico (4 hilos ≈ 400 %).
- **Nunca** montar un venv/site-packages desde `/mnt/d` dentro del contenedor: el FS
  9p de WSL2 multiplica ~10x los tiempos (medido, ver §6).

## 5. Caché JIT: qué se puede hornear y qué no (verificado)

**Hallazgo clave:** `@njit(cache=True)` sobre una función con región `openmp` **falla** en
pyomp 0.5.1 + numba 0.63.1:

```
AttributeError: 'LiftedWith' object has no attribute 'output_types'
```

Las regiones `with openmp(...)` se implementan como *lifted with* de numba, y el código
"lifted" no soporta el caché en disco de numba. Consecuencias para el diseño:

1. **No se puede hornear en la imagen un caché JIT del código del estudiante** (además el
   caché de numba se indexa por archivo fuente: código nuevo = compilación nueva sí o sí).
2. El smoke test del build vale como **validación fail-fast** de la imagen y deja los
   `.pyc` calientes, pero no acelera la compilación del código del alumno.
3. `NUMBA_CACHE_DIR=/tmp/numba_cache` queda solo como red de seguridad para
   `cache=True` sin openmp (para que no explote con rootfs read-only).

## 6. Latencia del primer run y mitigación

### Mediciones reales (2026-07-12, 8 núcleos)

| Escenario | import `numba.openmp` | JIT hello (`parallel`+`critical`) | Total end-to-end |
|---|---|---|---|
| venv en `/mnt/d` (FS 9p de WSL2) | **6.85 s** | **3.56 s** | — |
| venv nativo ext4 | 0.61 s | 0.26 s | — |
| **Contenedor frío aislado** (flags de §4) | 0.82 s | 0.30 s | **1.9 s** (pi 1e8 incluida) |
| Contenedor frío, `fibonacciTareas.py` (tasks) | — | — | 2.0 s |
| Contenedor frío, `calorStencil.py` (varias funciones + cómputo real) | — | — | 6.5 s (≈1.9 s son cómputo medido del propio ejemplo) |

**El mito de los 30 s de silencio no se materializa con esta imagen**: venía de medir
sobre `/mnt/d` (drvfs/9p). En overlayfs nativo del contenedor, la primera salida del
estudiante aparece en ~1–2 s; ejemplos con varias funciones JIT, en ~3–5 s de compilación.

### Mitigaciones recomendadas (en orden de impacto)

1. **Protocolo de fases por WebSocket**: el backend emite `{"fase": "arrancando"}` al crear
   el contenedor y `{"fase": "compilando"}` al detectar el proceso vivo sin stdout aún;
   pasa a `{"fase": "ejecutando"}` con el primer byte de stdout. Costo cero, elimina el silencio.
2. **`PYTHONUNBUFFERED=1`** en la imagen (ya incluido): sin él, el silencio es artificial
   aunque el programa ya esté imprimiendo.
3. **Patrón warmup en las plantillas de ejercicios** (ya lo hacen los 14 ejemplos del repo):
   llamada con `n` pequeño antes de medir con `omp_get_wtime()` → el estudiante nunca
   cronometra la compilación.
4. **`python -m compileall` en el build** (ya incluido): ahorra ~0.2 s de import en cada run.
5. Opcional futuro (si se añaden ejercicios pesados): pool de contenedores pre-creados
   (`docker create` + `start`) para amortizar los ~300 ms de arranque de contenedor;
   con 1.9 s totales hoy, no lo necesita el MVP.

## 7. Riesgos y notas

- **Pin exacto** `pyomp==0.5.1` (no `0.5.*`) en el Dockerfile: una futura 0.5.2 podría
  mover numba/llvmlite; la imagen debe ser reproducible. El repo de aprendizaje puede
  seguir con `0.5.*`.
- pyomp 0.5.1 soporta Python 3.10–3.14: si algún día conviene 3.13, hay wheel, pero
  **3.12 es lo validado** con los 14 ejemplos y coincide con el backend FastAPI (3.12).
- Directivas NO soportadas por pyomp 0.5.x (`atomic`, `sections`, `schedule(dynamic)`,
  `master`, etc. — lista completa en el README del repo de aprendizaje): el runner las
  reportará como error de compilación de numba; la UI debería mapear esos errores a
  mensajes pedagógicos.
- Node 18 del host no afecta a esta imagen (solo frontend); sin acción aquí.
- Imagen de prueba de esta investigación: `telar-runner-test` (queda en el daemon Docker
  local; `docker rmi telar-runner-test` para limpiar).

## Fuentes

- PyPI pyomp (versiones, wheels, deps): https://pypi.org/project/pyomp/ y `https://pypi.org/pypi/pyomp/json` (consultado 2026-07-12)
- Repo oficial PyOMP (matriz pyomp↔numba, plataformas, imagen Docker oficial): https://github.com/Python-for-HPC/PyOMP
- Docs oficiales (instalación pip/conda, `ghcr.io/python-for-hpc/pyomp:latest`): https://pyomp.readthedocs.io
- Evidencia local: `/mnt/d/universidad/tesis/simuladores/openmp/aprendizaje/README.md` (14 ejemplos validados, tabla de directivas soportadas/no soportadas, instalación pip probada en WSL2) y su `.venv` (Python 3.12.3, pyomp 0.5.1, numba 0.63.1, llvmlite 0.46.0)
- Mediciones propias 2026-07-12: build de `telar-runner-test` sobre `python:3.12-slim` (Debian 13, glibc 2.41), timings de import/JIT en `/mnt/d` vs ext4 vs contenedor, prueba `--cpus=2` sin `OMP_NUM_THREADS` (cgroup-unaware), fallo de `cache=True` con región openmp, ejecución de `fibonacciTareas.py` y `calorStencil.py` en contenedor aislado
- Paper PyOMP (CiSE 2021): https://www.osti.gov/pages/servlets/purl/1843562 — y PyOMP CPU+GPU (SC24): https://www.osti.gov/servlets/purl/2479018
