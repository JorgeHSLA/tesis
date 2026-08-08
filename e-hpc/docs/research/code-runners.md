# Investigación: sandboxes de ejecución de código (online judges / code runners)

> **Proyecto:** Telar — plataforma educativa para aprender OpenMP con PyOMP.
> **Objetivo:** adoptar patrones probados de Judge0, Piston, glot.run (docker-run) y codapi
> para el runner Docker de Telar (FastAPI + contenedores `python:3.12` + `pyomp 0.5.*`),
> en vez de inventar el aislamiento desde cero.
> **Fecha:** 2026-07-12. Todas las cifras fueron verificadas contra los repos/docs citados al final.

---

## 1. Cómo aísla cada proyecto

### 1.1 Judge0 (judge0/judge0) — isolate + cgroups, job queue persistente

Judge0 **no** crea un contenedor Docker por envío: los workers (Rails/Resque) viven en un
contenedor y cada envío se ejecuta dentro de [isolate](https://github.com/ioi/isolate)
(el sandbox del IOI: namespaces de Linux, chroot, usuarios no privilegiados y cgroups).

Invocación real (de `app/jobs/isolate_job.rb`):

```
isolate --cg -s -b <box_id> -M metadata.txt \
  -t <cpu_time_limit> -x <cpu_extra_time> -w <wall_time_limit> \
  -k <stack_limit> -p<max_processes_and_or_threads> \
  --cg-mem=<memory_limit> -f <max_file_size> \
  --run -- ... < stdin.txt > stdout.txt 2> stderr.txt
```

Puntos clave:

- **stdout/stderr a archivos** (`stdout.txt`, `stderr.txt`), no a pipes: el tamaño queda
  acotado por `-f` (ulimit `fsize`) y no hay riesgo de bloquear al lector.
- **Meta-file** (`-M metadata.txt`): isolate escribe `time`, `time-wall`, `max-rss`,
  `exitcode`, `exitsig`, `status` como pares `clave:valor`. Judge0 lo parsea para el veredicto:
  `TO` → Time Limit Exceeded, `SG` → muerto por señal, `RE` → runtime error,
  `XX` → error del sandbox; si no hay error, compara output → Accepted / Wrong Answer.
- **Timeout en dos niveles:** `-t` (CPU) + `-x` (gracia extra de CPU) + `-w` (wall clock).
  El wall time atrapa procesos que duermen o esperan I/O sin consumir CPU.
- **Cleanup determinista:** `isolate -b <box_id> --cleanup` al final de cada job
  (el `box_id` es `submission.id % 2147483647`, así un worker reiniciado puede re-inicializar
  la misma box con `--init`, que falla-limpia si quedó huérfana).
- **Config con doble tope:** cada límite tiene default y máximo del lado servidor
  (`CPU_TIME_LIMIT=5`, `MAX_CPU_TIME_LIMIT=15`…): el cliente puede pedir más por envío,
  pero nunca superar el `MAX_*`. Patrón directamente aplicable a Telar
  (el ejercicio define límites; el backend impone topes globales).

Defaults de `judge0.conf` (verificados en master):

| Variable | Default | Máximo permitido |
|---|---|---|
| `CPU_TIME_LIMIT` | 5 s | `MAX_CPU_TIME_LIMIT` = 15 s |
| `CPU_EXTRA_TIME` | 1 s | 5 s |
| `WALL_TIME_LIMIT` | 10 s | 20 s |
| `MEMORY_LIMIT` | 128000 KB | 512000 KB |
| `STACK_LIMIT` | 64000 KB | 128000 KB |
| `MAX_PROCESSES_AND_OR_THREADS` | 60 | 120 |
| `MAX_FILE_SIZE` (fsize) | 1024 KB | 4096 KB |
| `ENABLE_NETWORK` | false | (activable) |
| `NUMBER_OF_RUNS` | 1 | 20 |
| `REDIRECT_STDERR_TO_STDOUT` | false | — |
| `MAX_QUEUE_SIZE` | 100 | — |

### 1.2 Piston (engineer-man/piston) — isolate dentro de un contenedor privilegiado

Piston (el runner de emkc.org, usado por muchos bots/plataformas) también usa **isolate**
(fork `envicutor/isolate`, compilado en su imagen Docker). El contenedor `piston_api` corre
con `privileged: true` y `tmpfs /tmp:exec` (verificado en `docker-compose.yaml`) porque
isolate necesita administrar cgroups. Cada job:

- corre como un **uid/gid único no privilegiado** del rango `PISTON_RUNNER_UID_MIN..MAX`
  (1001–1500), en sus propios namespaces;
- API **síncrona**: `POST /api/v2/execute` responde con el resultado; no hay cola persistente
  (solo `PISTON_MAX_CONCURRENT_JOBS=64`);
- limpia todo el espacio temporal tras cada ejecución.

Defaults de `docs/configuration.md` (verificados en master):

| Variable | Default |
|---|---|
| `PISTON_COMPILE_TIMEOUT` / `PISTON_COMPILE_CPU_TIME` | 10000 ms |
| `PISTON_RUN_TIMEOUT` / `PISTON_RUN_CPU_TIME` | 3000 ms |
| `PISTON_COMPILE_MEMORY_LIMIT` / `PISTON_RUN_MEMORY_LIMIT` | −1 (sin límite) |
| `PISTON_MAX_PROCESS_COUNT` | 64 |
| `PISTON_MAX_OPEN_FILES` | 64 |
| `PISTON_MAX_FILE_SIZE` | 10 000 000 B (10 MB) |
| `PISTON_OUTPUT_MAX_SIZE` | 1024 (chars, por stream) |
| `PISTON_DISABLE_NETWORKING` | true |
| `PISTON_LIMIT_OVERRIDES` | `{}` (overrides por lenguaje) |

Nota: el readme habla de "max processes 256", pero `configuration.md` (la fuente
autoritativa del default real) dice 64. Separa **timeout de compilación** (10 s) del
**timeout de ejecución** (3 s) — patrón relevante para PyOMP, donde el JIT es la
"compilación" pero ocurre dentro del run (ver §6).

### 1.3 glot.run (glotcode/docker-run) — un contenedor Docker efímero por request

El más parecido a lo que Telar necesita: servicio (Rust) que habla con el **Docker daemon
por el unix socket** y crea **un contenedor nuevo por cada run, que siempre se borra**.
El payload entra por **stdin** (attach) y el resultado sale por **stdout como JSON**
`{stdout, stderr, error}` — es decir, hay un pequeño *agente dentro de la imagen* que
ejecuta el código y serializa el resultado (así el exit code y la separación de streams no
dependen del protocolo de attach).

Controles (README verificado):

| Variable | Rol |
|---|---|
| `DOCKER_CONTAINER_MEMORY` | límite de memoria en bytes |
| `DOCKER_CONTAINER_NETWORK_DISABLED` | red deshabilitada |
| `DOCKER_CONTAINER_USER` | usuario no root dentro del contenedor |
| `DOCKER_CONTAINER_ULIMIT_NPROC_SOFT/HARD` | anti fork-bomb (FAQ oficial: "How is fork bombs handled?") |
| `DOCKER_CONTAINER_ULIMIT_NOFILE_SOFT/HARD` | límite de descriptores |
| `DOCKER_CONTAINER_CAP_DROP` | drop de capabilities |
| `DOCKER_CONTAINER_READONLY_ROOTFS` | rootfs de solo lectura (recomendado) |
| `DOCKER_CONTAINER_TMP_DIR_PATH` | tmpfs escribible, default `rw,noexec,nosuid,size=65536k` |
| `DOCKER_CONTAINER_WORK_DIR_PATH` | tmpfs de trabajo, default `rw,exec,nosuid,size=131072k` |
| `RUN_MAX_EXECUTION_TIME` | segundos; al llegar, **mata el contenedor** (FAQ: infinite loops) |
| `RUN_MAX_OUTPUT_SIZE` | bytes; **deja de leer** el stream al alcanzarlo (FAQ: large output) |
| `DEBUG_KEEP_CONTAINER` | no borrar el contenedor (debug) |

Datos de rendimiento propios del proyecto: overhead de contenedor-por-run para Python
"Hello World" ≈ 250–350 ms (y ≈ 450–570 ms bajo gVisor). Útil como referencia de que el
patrón contenedor-efímero es viable en interactividad educativa.

### 1.4 codapi (nalgeon/codapi) — `docker run` efímero declarativo (el modelo a copiar)

codapi (motor de los snippets ejecutables de antonz.org) lanza `docker run` por request con
una config declarativa por sandbox (`box.json` + `commands.json`). Flags reales construidos
en `internal/engine/docker.go` (verificado en main):

```go
args := []string{
  "run", "--rm",
  "--name", req.ID,
  "--runtime", box.Runtime,
  "--cpus", strconv.Itoa(box.CPU),
  "--memory", fmt.Sprintf("%dm", box.Memory),
  "--network", box.Network,
  "--pids-limit", strconv.Itoa(box.NProc),
  "--user", step.User,
}
// + "--read-only" si !box.Writable
// + "--storage-opt size=..." si box.Storage
// + "--volume" (código montado ro), "--tmpfs" por entrada, "--cap-add/--cap-drop", "--ulimit"
```

Defaults globales (`codapi.json` del repo nalgeon/sandboxes, verificado):

```json
{
  "pool_size": 8,
  "box": {
    "runtime": "runc", "cpu": 1, "memory": 64, "network": "none",
    "writable": false, "volume": "%s:/sandbox:ro",
    "cap_drop": ["all"], "ulimit": ["nofile=96"], "nproc": 64
  },
  "step": { "user": "sandbox", "action": "run", "timeout": 5, "noutput": 4096 }
}
```

Y el sandbox de Python (`sandboxes/python/box.json` + `commands.json`):

```json
{ "image": "codapi/python", "memory": 128, "tmpfs": ["/tmp:rw,noexec,nosuid,size=16m"] }
// run: command ["python","main.py"], timeout 8 s, noutput 524288
```

Timeout: contexto Go con deadline; al vencer, responde `ErrTimeout` y ejecuta
`docker kill` **asíncrono** con `killTimeout = 5 s`. Exit code: el del propio `docker run`.
Cleanup: `--rm` + el kill; el nombre del contenedor es el ID del request (idempotencia y
trazabilidad).

---

## 2. Tabla comparativa de límites y flags

| Aspecto | Judge0 (isolate) | Piston (isolate) | glot docker-run | codapi | **Propuesta Telar** |
|---|---|---|---|---|---|
| Unidad de aislamiento | box de isolate, worker persistente | box de isolate en contenedor privileged | **contenedor Docker por run** | **contenedor Docker por run** | contenedor Docker por run |
| CPU-time | 5 s (máx 15) `-t` + `-x 1` | 3000 ms | — (solo wall) | — (solo wall) | opcional vía `ulimit cpu` |
| Wall-time | 10 s (máx 20) `-w` | 3000 ms | `RUN_MAX_EXECUTION_TIME` | 5 s global / 8 s python | 30–60 s (JIT PyOMP, §6) |
| Memoria | 128 MB (máx 512) cgroup | −1 (sin límite) | `DOCKER_CONTAINER_MEMORY` | `--memory 64m` (128m python) | `--memory 512m --memory-swap 512m` |
| CPUs | — | — | — | `--cpus 1` | `--cpus N` (N≥4 para speedup) |
| Procesos/threads | `-p 60` (máx 120) | 64 | `ulimit nproc` | `--pids-limit 64` | `--pids-limit 128` |
| Archivos abiertos | — | 64 | `ulimit nofile` | `ulimit nofile=96` | `--ulimit nofile=256` |
| Tamaño de archivo/disco | `fsize` 1024 KB (máx 4096) | 10 MB | tmpfs `size=64m/128m` | tmpfs `size=16m` | tmpfs `size=64m` + `fsize` |
| Output máx | acotado por fsize (archivo) | 1024 chars/stream | `RUN_MAX_OUTPUT_SIZE` (corta lectura) | `noutput` 4096 (524288 python-run) | 256 KB + flag `truncated` |
| Red | off por defecto | off por defecto | `NETWORK_DISABLED` | `--network none` | `--network none` |
| Usuario | uid isolate no-priv | uid 1001–1500 por job | `CONTAINER_USER` | `--user sandbox` | `--user 1000:1000` no root |
| Rootfs | chroot | box isolate | `--read-only` + 2 tmpfs | `--read-only` + volumen ro + tmpfs | `--read-only` + código ro + tmpfs |
| Capabilities | — | — | `CAP_DROP` | `--cap-drop all` | `--cap-drop ALL --security-opt no-new-privileges` |
| stdout/err/exit | archivos + meta-file isolate | meta isolate | agente JSON por stdin/stdout | streams + exit de `docker run` | attach/logs API + `docker wait` |
| Timeout kill | isolate mata | isolate mata | mata contenedor | ctx deadline + `docker kill` (5 s) | `asyncio.wait_for` + kill |
| Cleanup | `isolate --cleanup` | `--cleanup` + tmp | borra contenedor siempre | `--rm` + kill async | `--rm` + labels + purga al boot |
| Modelo de job | **cola Redis + Postgres, token, callback** | síncrono (64 concurr.) | síncrono | síncrono (pool 8) | cola asyncio + DB + WebSocket |

Lectura transversal: **los cuatro coinciden en** red deshabilitada por defecto, usuario no
root, límite de procesos ~60–128, output acotado y destrucción total del entorno tras cada
run. Divergen en la unidad de aislamiento (isolate vs contenedor) y en sync vs cola.

**Decisión para Telar:** patrón glot/codapi (contenedor efímero por job). isolate exige
contenedor `privileged` y manipulación de cgroups (Piston) — frágil sobre Docker en WSL2 y
excesivo para el caso educativo. El overhead de ~300 ms/contenedor es irrelevante frente a
los segundos de JIT de PyOMP.

---

## 3. Truncado de output, fork bombs y escritura a disco

### 3.1 Truncado de stdout/stderr (por qué importa)

Un `print` dentro de un `parallel for` con 10⁶ iteraciones genera cientos de MB. Sin límite:
(a) el backend acumula todo en RAM, (b) el WebSocket inunda el frontend, (c) si nadie lee el
pipe, el proceso hijo se **bloquea en `write()`** (deadlock clásico). Cada proyecto lo
resuelve distinto:

- **glot docker-run**: deja de **leer** al llegar a `RUN_MAX_OUTPUT_SIZE` bytes y mata el run
  — el límite protege al *lector*, no solo al disco.
- **Piston**: trunca a `PISTON_OUTPUT_MAX_SIZE=1024` caracteres por stream (agresivo, pensado
  para judges donde solo importa el veredicto).
- **codapi**: `noutput` por step (4096 default; 512 KB para el run de Python, 8 KB para tests).
- **Judge0**: escribe a archivo dentro del sandbox y el ulimit `fsize` (1024 KB) corta
  al *escritor* con SIGXFSZ (status 8 = Runtime Error SIGXFSZ).

**Para Telar:** leer los streams de forma incremental (attach/logs de la API de Docker),
contar bytes, cortar a ~256 KB y marcar `"truncated": true` en el resultado; además
rate-limit de frames del WebSocket (p. ej. flush cada 100 ms o cada 4 KB). No confiar solo
en el buffer del cliente.

### 3.2 Fork bombs → `--pids-limit` (cgroup pids)

`:(){ :|:& };:` o `while True: os.fork()`. Dos mecanismos:

- `--pids-limit N` (codapi `nproc=64`): tope del **cgroup pids del contenedor** — cuenta
  procesos *y threads*, por contenedor. Es el mecanismo correcto.
- `--ulimit nproc` (glot): RLIMIT_NPROC es **por uid en todo el kernel**, no por contenedor;
  si dos contenedores comparten uid se limitan entre sí (la propia doc de Docker lo
  advierte). Útil solo como segunda capa.

**Para Telar:** `--pids-limit 128`. Ojo con PyOMP: el proceso Python + runtime OpenMP
(N threads) + threadpool interno de Numba coexisten; con 64 puede quedar justo si el
estudiante pide muchos threads — 128 da margen sin habilitar una fork bomb útil.

### 3.3 Escritura a disco → `--read-only` + tmpfs con `size=`

Sin límite, `open('x','w')` en un loop llena el disco del host (o la layer del contenedor).
Patrón común glot/codapi:

- rootfs **`--read-only`**; el código del estudiante se monta como volumen **`:ro`**
  (codapi: `%s:/sandbox:ro`);
- un único punto escribible: **tmpfs** con tamaño acotado y opciones endurecidas —
  codapi Python: `/tmp:rw,noexec,nosuid,size=16m`; glot: work dir `rw,exec,nosuid,size=131072k`.
  tmpfs vive en RAM: se autodestruye con el contenedor y no toca el disco del host
  (pero cuenta contra la memoria: sumar su `size` al presupuesto de `--memory`).
- `--storage-opt size=` (codapi opcional) requiere overlay2 sobre xfs con `pquota` —
  **normalmente no disponible en Docker sobre WSL2**; usar tmpfs en su lugar.
- Judge0 usa el enfoque ulimit: `fsize` (KB) por proceso — combinable: `--ulimit fsize`.

**Para Telar:** `--read-only`, código en `/workspace:ro`, `--tmpfs /tmp:rw,noexec,nosuid,size=64m`.
Importante: Numba/PyOMP necesita un dir escribible para su caché si se activa
(`NUMBA_CACHE_DIR=/tmp/numba-cache`, ver §6.3) — con rootfs read-only y `HOME` no escribible,
sin esa variable el caché en disco simplemente no funciona (falla a modo sin caché).

---

## 4. Ciclo de vida del job

### 4.1 Qué hace cada proyecto

- **Judge0** (el único con ciclo de vida completo): `POST /submissions` → `{token}`;
  estados con id numérico: **1 In Queue, 2 Processing, 3 Accepted, 4 Wrong Answer,
  5 Time Limit Exceeded, 6 Compilation Error, 7–12 Runtime Error (SIGSEGV, SIGXFSZ,
  SIGFPE, SIGABRT, NZEC, Other), 13 Internal Error, 14 Exec Format Error**.
  Persistencia en PostgreSQL, cola en Redis (Resque), polling con `GET /submissions/{token}`,
  opcional `wait=true` (desaconsejado por ellos mismos) y **`callback_url`** (PUT con el
  resultado — el equivalente asíncrono de nuestro WebSocket). Campos de resultado:
  `stdout, stderr, compile_output, message, exit_code, exit_signal, time, wall_time, memory`.
- **Piston / glot / codapi**: request-response síncrono, sin persistencia; el "estado" es
  implícito (la conexión HTTP abierta). Concurrencia acotada (`PISTON_MAX_CONCURRENT_JOBS=64`,
  `pool_size=8` en codapi) — la cola es el semáforo.

### 4.2 Diseño recomendado para Telar

Estados (superset mínimo de Judge0, sin veredicto de judge):

```
queued → running → completed        (exit_code == 0)
                 → failed           (exit_code != 0, o error del sandbox)
                 → timeout          (matado por wall-time)
                 → cancelled        (usuario/profesor)
```

- **Persistencia:** tabla `jobs` (SQLite o Postgres) con `id (uuid), user_id, exercise_id,
  state, created_at, started_at, finished_at, exit_code, truncated, metrics_summary`.
  El `stdout/stderr` truncado se guarda para reconsulta; los frames en vivo van por WS.
- **Cola:** para una sola máquina basta `asyncio.Queue` + semáforo (límite de contenedores
  concurrentes = nº de jobs cuyo `--cpus` sumado quepa en el host); Redis/arq solo si se
  escala a varios workers.
- **Identidad contenedor↔job (patrón codapi):** `--name telar-job-<uuid>` y **labels**:
  `--label telar.runner=true --label telar.job=<uuid>`.
- **Cleanup de huérfanos al reiniciar** (la pieza que los proyectos síncronos resuelven con
  `--rm` pero que un backend con estado debe reforzar):
  1. al arrancar el backend: `docker ps -aq --filter label=telar.runner=true | xargs -r docker rm -f`
     (equivalente vía API: `containers.list(all=True, filters={"label": ...})`);
  2. reconciliar la DB: todo job en `running`/`queued` sin contenedor vivo → `failed`
     con motivo `orphaned_on_restart`;
  3. `--rm` en cada run como primera línea de defensa (el daemon borra el contenedor
     aunque el backend muera a mitad del job);
  4. timeout: `asyncio.wait_for(wait_container(), wall_limit)`; al vencer, `docker kill`
     (SIGKILL directo, como codapi con su `killTimeout=5 s`) y estado `timeout`.
- **Captura de stdout/stderr/exit code sin agente:** con la API de Docker,
  `attach`/`logs` con demultiplexado (frames stdout/stderr separados) y
  `docker wait` → `StatusCode`. El patrón "agente JSON dentro de la imagen" de glot solo
  hace falta si se quiere medir *dentro* del contenedor — que para PyOMP sí conviene,
  pero vía script harness (§6.4), no vía agente genérico.
- **Métricas en vivo:** `GET /containers/{id}/stats?stream=true` (Docker Engine API);
  emite ~1 muestra/s; CPU% = `(cpu_delta / system_cpu_delta) * online_cpus * 100`.
  Reenviar por el mismo WebSocket del job con tipo de mensaje distinto (`log` vs `stats`).

### 4.3 `docker run` de referencia para el runner Telar

```bash
docker run --rm \
  --name "telar-job-${JOB_ID}" \
  --label telar.runner=true --label "telar.job=${JOB_ID}" \
  --cpus 4 --memory 512m --memory-swap 512m \
  --pids-limit 128 \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -v "${JOB_DIR}:/workspace:ro" \
  --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges \
  --ulimit nofile=256 --ulimit fsize=8388608 \
  -e OMP_NUM_THREADS=4 -e NUMBA_CACHE_DIR=/tmp/numba-cache \
  telar-runner:py3.12-pyomp0.5 \
  python /workspace/harness.py
```

(`--memory-swap = --memory` desactiva el swap; `--cpus 4` es la gran diferencia con los
judges de la tabla — aquí el paralelismo es el objeto de estudio, no un riesgo.)

---

## 5. Comparación de decisiones que Telar hereda

| Patrón adoptado | Origen |
|---|---|
| Contenedor efímero por job, `--rm`, nombre = job id | glot docker-run, codapi |
| `--network none`, `--cap-drop all`, user no root, `--read-only` + tmpfs | codapi (defaults exactos verificados) |
| `--pids-limit` contra fork bombs (no solo ulimit nproc) | codapi |
| Corte de lectura de output + flag truncated | glot (`RUN_MAX_OUTPUT_SIZE`), codapi (`noutput`) |
| Doble tope de límites (default por ejercicio + máximo global) | Judge0 (`X` / `MAX_X`) |
| Estados persistidos + token + push del resultado | Judge0 (estados 1–14, `callback_url` → aquí WebSocket) |
| Timeout de compilación separado del de ejecución | Piston (`compile_timeout` 10 s vs `run_timeout` 3 s) → §6 |
| Kill asíncrono con gracia corta al vencer el deadline | codapi (`docker kill`, 5 s) |

---

## 6. PyOMP: JIT, caché de compilación y medición justa de speedup

### 6.1 Contexto de versiones (verificado en PyPI, 2026-07)

- **pyomp 0.5.1** (última, 2026-02-19); serie 0.5.x requiere **Numba 0.62.x–0.63.x** y
  soporta **Python 3.10–3.14** → compatible con el runner Python 3.12 de Telar.
- Instalación por pip con wheels manylinux x86-64 (funciona en el contenedor Linux);
  PyOMP es una **extensión de Numba** (`from numba.openmp import njit, openmp_context`),
  no un fork. Incluye su propio runtime LLVM OpenMP.
- GPU (directiva `target`) solo Linux + NVIDIA — fuera del alcance del runner básico.

### 6.2 El problema: la primera llamada compila

PyOMP compila vía Numba/LLVM en la **primera llamada** a la función `@njit` (por firma de
tipos). La guía oficial de Numba lo señala como *el* error clásico de benchmarking:

> "A really common mistake when measuring performance is to not account for the above
> behaviour and to time code once with a simple timer that includes the time taken to
> compile your function in the execution time." — Numba 5-minute guide

Su ejemplo canónico: `Elapsed (with compilation) ≈ 0.33 s` vs
`Elapsed (after compilation) ≈ µs`. Con PyOMP el efecto es peor: a la compilación de Numba
se suma la transformación OpenMP, y además `import numba` ya cuesta ~1–2 s. Si Telar mide
"tiempo del contenedor" (wall del `docker run`), el estudiante vería que su versión
paralela con 8 threads "tarda 6 s" contra 0.1 s del C secuencial — una medición inútil.

### 6.3 Caché de compilación en disco (`cache=True`, `NUMBA_CACHE_DIR`)

Qué dice la doc de Numba (FAQ + developer/caching + reference/envvars, verificado):

- `@njit(cache=True)` guarda el código objeto compilado en disco: un índice `.nbi` por
  función + un `.nbc` por overload, **serializados con pickle**.
- Ubicación: por defecto `__pycache__` junto al fuente; **`NUMBA_CACHE_DIR`** la
  sobreescribe (imprescindible con rootfs read-only). `NUMBA_DEBUG_CACHE=1` loguea
  hits/misses (útil para verificar en el runner).
- Invalidación: por mtime del fuente y por CPU (modelo + features); **no** se invalida al
  actualizar Numba salvo cambio del magic tuple, y "global variables are treated as
  constants" (queda cacheado el valor en tiempo de compilación).
- Concurrencia: "Concurrent read/write of the cache is safe only if file replacement
  operation is atomic for the filesystem" — tmpfs cumple.

Implicaciones para Telar:

1. **No compartir un volumen de caché entre estudiantes.** Los `.nbc` se cargan con
   pickle: un caché escribible compartido es un vector de ejecución arbitraria
   (envenenamiento de caché) y además rompe la equidad de medición (el run de un alumno
   calentaría el caché de otro). Con contenedores efímeros + `NUMBA_CACHE_DIR` en tmpfs,
   el caché muere con el contenedor: seguro, pero **no ayuda entre runs**.
2. Un caché persistente **por usuario+ejercicio** (volumen dedicado) aceleraría re-runs,
   pero la invalidación por mtime del fuente lo vacía en cuanto el estudiante edita el
   código — que es el caso típico. Beneficio marginal; complejidad y riesgo altos.
3. **Verificar experimentalmente `cache=True` con `numba.openmp`**: la doc de Numba
   enumera limitaciones de cacheabilidad y PyOMP no documenta soporte explícito de
   `cache=True` en sus regiones OpenMP (no encontrado ni en README ni en readthedocs).
   Hay además un issue de Numba (#10617) sobre anomalías de rendimiento entre código
   cargado de caché y recién compilado con `parallel=True`. Conclusión: no diseñar la
   medición asumiendo que el caché funciona.

### 6.4 Patrón recomendado: warm-up + medición dentro del script (harness)

La conclusión operativa — y lo que hacen todos los benchmarks serios de Numba/PyOMP — es
**medir dentro del proceso, después de calentar**:

```python
# harness.py (esqueleto conceptual del runner Telar)
from numba.openmp import njit, openmp_context as openmp
from numba.openmp import omp_get_wtime, omp_set_num_threads
import json, time

# ... función del estudiante decorada con @njit ...

student_fn(small_input)          # 1) WARM-UP: dispara el JIT (no se mide)

t0 = omp_get_wtime()             # 2) medición real (o time.perf_counter)
result = student_fn(full_input)
t1 = omp_get_wtime()

# 3) speedup justo: misma función ya compilada, variando threads
timings = {}
for n in (1, 2, 4):
    omp_set_num_threads(n)
    t0 = omp_get_wtime(); student_fn(full_input); timings[n] = omp_get_wtime() - t0

print(json.dumps({"elapsed": t1 - t0, "timings": timings}))  # línea JSON que el backend parsea
```

Reglas que se derivan de las fuentes:

- **Warm-up obligatorio**: primera llamada = compilación (Numba 5-min guide). Repetir la
  medición ≥3 veces y reportar mínimo o mediana (recomendación `timeit` de la misma guía).
- **Medir dentro vs fuera**: el wall del contenedor incluye arranque de Python, import de
  Numba y JIT → solo sirve como *presupuesto de timeout*, nunca como métrica de speedup.
  La métrica pedagógica sale de `omp_get_wtime()` (PyOMP la expone precisamente "for
  performance profiling", según su doc de usage).
- **Speedup con la misma función compilada**: cambiar el número de threads con
  `omp_set_num_threads()` **no** recompila (la firma no cambia), así que la comparación
  1 vs N threads es limpia dentro del mismo proceso. `OMP_NUM_THREADS` (env) fija el
  default del runtime OpenMP embebido; nota: `NUMBA_NUM_THREADS` es **independiente** de
  `OMP_NUM_THREADS` (doc de envvars de Numba) y solo afecta a `parallel=True` clásico de
  Numba, no a las regiones PyOMP.
- **Timeout acorde**: adoptar la separación de Piston (compile 10 s / run 3 s) adaptada:
  wall-time del contenedor 30–60 s para absorber import + JIT (5–20 s en funciones no
  triviales), con el tiempo *medido* reportado aparte. No usar los 3–5 s típicos de judge.
- **`--cpus` ≥ threads solicitados**: si el cgroup limita a 1 CPU, el speedup será plano
  y la lección fallará. Fijar `--cpus = max_threads_del_ejercicio` (p. ej. 4) y documentar
  que WSL2 limita los cores visibles a los asignados a la VM de WSL.

---

## 7. Notas del entorno Telar (WSL2, Docker 29.3, Node 18)

- Ninguno de los patrones adoptados exige Node: el backend es Python/FastAPI y habla con la
  Docker Engine API. Piston (API Node) y Judge0 (Rails) se estudiaron como referencia, no
  como dependencia — no imponen restricciones sobre el Node 18 del frontend.
- Se descartó isolate (Judge0/Piston) porque requiere contenedor privileged + cgroups
  administrables; sobre Docker-in-WSL2 (cgroupv2 unificado de la VM WSL) es frágil.
  El patrón contenedor-efímero funciona sin privilegios especiales.
- `--storage-opt size=` no funciona con overlay2/ext4 (setup por defecto de Docker en WSL2):
  el límite de escritura se implementa exclusivamente con tmpfs + `--read-only` + ulimit fsize.
- gVisor (`--runtime runsc`, opción soportada por glot y por el campo `runtime` de codapi)
  queda como *hardening opcional futuro*; en WSL2 requiere instalación manual de runsc y
  duplica el overhead (números de glot: 250→450 ms en Python).

---

## 8. Fuentes

- Judge0 — configuración: <https://github.com/judge0/judge0/blob/master/judge0.conf>
- Judge0 — ejecución con isolate: <https://github.com/judge0/judge0/blob/master/app/jobs/isolate_job.rb>
- Judge0 CE API (estados, campos, callback_url): <https://ce.judge0.com/>
- isolate (sandbox IOI): <https://github.com/ioi/isolate>
- Piston — readme (seguridad, isolate): <https://github.com/engineer-man/piston>
- Piston — configuración y defaults: <https://github.com/engineer-man/piston/blob/master/docs/configuration.md>
- Piston — docker-compose (privileged, tmpfs exec): <https://github.com/engineer-man/piston/blob/master/docker-compose.yaml>
- glot docker-run (env vars, FAQ fork bombs/output/timeout, rendimiento): <https://github.com/glotcode/docker-run>
- codapi — engine Docker (flags reales): <https://github.com/nalgeon/codapi/blob/main/internal/engine/docker.go>
- codapi — config structs: <https://github.com/nalgeon/codapi/blob/main/internal/config/config.go>
- codapi — sandboxes de ejemplo (codapi.json global, python box/commands): <https://github.com/nalgeon/sandboxes>
- codapi — añadir sandbox: <https://github.com/nalgeon/codapi/blob/main/docs/add-sandbox.md>
- PyOMP en PyPI (0.5.1, matriz de versiones): <https://pypi.org/project/pyomp/>
- PyOMP — repo y doc: <https://github.com/Python-for-HPC/PyOMP>, <https://pyomp.readthedocs.io/>
- Numba — medición de rendimiento (warm-up): <https://numba.readthedocs.io/en/stable/user/5minguide.html>
- Numba — caché en disco (nbi/nbc, pickle, invalidación): <https://numba.readthedocs.io/en/stable/developer/caching.html>
- Numba — env vars (`NUMBA_CACHE_DIR`, `NUMBA_NUM_THREADS` vs `OMP_NUM_THREADS`): <https://numba.readthedocs.io/en/stable/reference/envvars.html>
- Numba — FAQ (`cache=True`): <https://numba.readthedocs.io/en/stable/user/faq.html>
- Numba — issue caché + parallel: <https://github.com/numba/numba/issues/10617>
- Docker — recursos (`--memory`, `--cpus`, `--pids-limit`): <https://docs.docker.com/engine/containers/resource_constraints/>
- Docker Engine API — ContainerStats (métricas en vivo): <https://docs.docker.com/reference/api/engine/>
