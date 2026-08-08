# Investigación: docker-py (paquete `docker` de PyPI) para ejecutar código no confiable en Telar

> **Proyecto:** Telar — plataforma educativa para aprender OpenMP con PyOMP.
> **Contexto:** Backend FastAPI (Python 3.12) que ejecuta código PyOMP de estudiantes en
> contenedores Docker aislados (imagen runner: `python 3.12 + pyomp 0.5.*`), con logs y
> métricas (`docker stats`) en vivo vía WebSocket.
> **Entorno real de desarrollo:** WSL2 (Ubuntu) sobre Windows, Docker Engine **29.3.0**,
> Compose v5.1.0, Python 3.12.3.
> **Fecha de investigación:** 2026-07-12.

---

## 1. Versión actual y compatibilidad con Docker Engine 29

| Dato | Valor | Fuente |
|---|---|---|
| Última versión de `docker` (PyPI) | **7.2.0** (publicada 2026-07-09) | [PyPI](https://pypi.org/project/docker/) |
| Python soportado | 3.8 – 3.12 (clasificadores oficiales) → **compatible con nuestro backend 3.12** | [PyPI](https://pypi.org/project/docker/) |
| API de Engine por defecto (docker-py ≥ 7.1) | **1.44** (Moby 25.0) | [Changelog docker-py](https://docker-py.readthedocs.io/en/latest/change-log.html) |
| API mínima aceptada por docker-py | 1.24 | [Changelog docker-py](https://docker-py.readthedocs.io/en/latest/change-log.html) |
| API de Docker Engine 29 | **1.52** | [Release notes Engine 29](https://docs.docker.com/engine/release-notes/29/) |
| API **mínima** aceptada por Engine 29 | **1.44** (Moby v25) | [Release notes Engine 29](https://docs.docker.com/engine/release-notes/29/) |

**Conclusión de compatibilidad (crítica):**

- Docker Engine 29 **subió la API mínima a 1.44**. Un docker-py viejo (6.x usa 1.41 por
  defecto) recibe `400 Bad Request: client version 1.41 is too old` contra Engine 29.
  Este breakage está documentado por la comunidad ([ejemplo](https://frank.seesink.com/blog/docker-api-version-issues/)).
- docker-py **7.1+** usa 1.44 por defecto → funciona contra Engine 29 **justo en el mínimo**.
- **Recomendación:** fijar `docker>=7.2,<8` en `requirements.txt` y crear el cliente con
  negociación automática de versión para no depender del default:

```python
import docker

# from_env lee DOCKER_HOST / contexto CLI activo (novedad 7.2.0: respeta docker context)
client = docker.from_env(version="auto", timeout=120, max_pool_size=50)
```

Notas relevantes de 7.x ([changelog](https://docker-py.readthedocs.io/en/latest/change-log.html)):

- **7.2.0:** `docker.from_env()` respeta el *Docker CLI context* activo si `DOCKER_HOST`
  no está definido; nuevo `docker.from_context()`; soporte de `subpath` en volúmenes.
- **7.0.0:** soporte Python 3.12; websockets ya no se instalan por defecto
  (`pip install docker[websockets]` si hiciera falta — para nuestro caso **no** hace
  falta: el streaming de logs/stats va por HTTP sobre el socket UNIX, no por websocket).
- `max_pool_size` (default 10): cada stream de logs/stats **retiene una conexión** del
  pool. Con N ejecuciones concurrentes × (1 log-stream + 1 stats-stream + waits) hay que
  subirlo (p. ej. 50) o se serializan las peticiones.

**Moby y el módulo Go:** el aviso de deprecación `github.com/docker/docker` →
`github.com/moby/moby` ([discusión](https://github.com/moby/moby/discussions/52404)) afecta
solo a clientes Go; docker-py no se ve afectado.

---

## 2. `containers.run()`: sandbox duro para código de estudiantes

Referencia completa de parámetros: [Containers — docker-py docs](https://docker-py.readthedocs.io/en/stable/containers.html).

### 2.1 Parámetros de aislamiento (verificados en docs oficiales)

| Parámetro | Tipo | Efecto |
|---|---|---|
| `network_mode="none"` | str | Sin red. Equivale a `--network none`. (Ojo: si se omite, el `HostConfig` pone `NetworkMode='default'` → bridge con salida a Internet.) |
| `user="1000:1000"` | str/int | UID:GID no-root dentro del contenedor. |
| `cap_drop=["ALL"]` | list[str] | Elimina todas las *capabilities* del kernel. |
| `security_opt=["no-new-privileges:true"]` | list[str] | Bloquea escaladas vía binarios setuid/setgid. |
| `read_only=True` | bool | Rootfs de solo lectura. |
| `tmpfs={"/tmp": "rw,noexec,nosuid,size=64m"}` | dict | FS temporal en RAM con opciones de montaje. |
| `mem_limit="512m"` | str/int | Límite duro de memoria (acepta `b/k/m/g`). |
| `memswap_limit="512m"` | str/int | Memoria + swap total. **Igualarlo a `mem_limit` deshabilita el swap** (si es -1: swap ilimitado). |
| `nano_cpus=2_000_000_000` | int | CPU en unidades de 1e-9 CPUs (2e9 = 2 CPUs). Alternativa: `cpu_period=100_000` + `cpu_quota=200_000`. **No combinar ambos** (el daemon rechaza NanoCpus + CpuQuota simultáneos). |
| `pids_limit=256` | int | Máximo de PIDs (previene fork-bombs). `-1` = ilimitado. |
| `ulimits=[Ulimit(...)]` | list | Límites adicionales (`nofile`, `fsize`, `nproc`...), instancias de `docker.types.Ulimit`. |
| `init=True` | bool | PID 1 = tini: reenvía señales y cosecha zombies (importante para matar procesos hijos de OpenMP al hacer `kill`). |
| `cpuset_cpus="0-3"` | str | (Opcional) fija cores concretos — útil para que las mediciones de speedup OpenMP sean reproducibles. |

### 2.2 Ejemplo completo para el runner Telar

```python
import docker
from docker.types import Ulimit

client = docker.from_env(version="auto", timeout=120, max_pool_size=50)

def launch_student_container(execution_id: str, cpus: int = 4) -> "docker.models.containers.Container":
    """Lanza el código del estudiante en un sandbox duro. NO bloquea (detach=True)."""
    return client.containers.run(
        image="telar-runner:py3.12-pyomp0.5",
        command=["python", "-I", "/work/main.py"],   # -I: modo aislado de CPython
        name=f"telar-run-{execution_id}",
        detach=True,                                  # devuelve Container, no bloquea

        # --- Aislamiento ---
        network_mode="none",                          # sin red en absoluto
        user="1000:1000",                             # no-root (el UID debe existir o usarse numérico)
        cap_drop=["ALL"],
        security_opt=["no-new-privileges:true"],
        read_only=True,                               # rootfs inmutable
        tmpfs={
            "/tmp": "rw,noexec,nosuid,size=64m",      # /tmp en RAM
            "/work/out": "rw,noexec,nosuid,size=16m", # salida del estudiante
        },
        init=True,                                    # tini como PID 1

        # --- Código del estudiante (volumen nombrado compartido, ver §2.3) ---
        volumes={f"telar_sub_{execution_id}": {"bind": "/work", "mode": "ro"}},
        working_dir="/work",

        # --- Recursos ---
        mem_limit="512m",
        memswap_limit="512m",                         # == mem_limit → sin swap
        nano_cpus=cpus * 1_000_000_000,               # p.ej. 4 CPUs
        cpuset_cpus=f"0-{cpus-1}",                    # cores fijos → speedups medibles
        pids_limit=256,                               # PyOMP crea threads; 256 sobra y frena fork-bombs
        ulimits=[
            Ulimit(name="nofile", soft=256, hard=256),
            Ulimit(name="fsize", soft=16_000_000, hard=16_000_000),  # archivos ≤16MB
        ],

        # --- Entorno PyOMP/Numba ---
        environment={
            "PYTHONUNBUFFERED": "1",                  # logs en vivo sin buffering
            "OMP_NUM_THREADS": str(cpus),
            "NUMBA_CACHE_DIR": "/tmp/numba_cache",    # Numba/PyOMP necesita cache ESCRIBIBLE
        },

        # --- Ciclo de vida ---
        auto_remove=False,                            # ¡importante! ver §5 (leer logs/exit code)
        labels={"app": "e-hpc", "kind": "runner", "execution_id": execution_id},
    )
```

**Trampas específicas de PyOMP/Numba en este sandbox:**

- Con `read_only=True`, Numba (base de PyOMP) falla al compilar si no tiene un
  directorio de caché escribible → `NUMBA_CACHE_DIR` apuntando a un `tmpfs`.
- `tmpfs` con `noexec` es seguro para `/tmp` de datos, pero si Numba llegara a generar
  objetos cargables ahí, podría necesitarse un tmpfs sin `noexec` solo para la caché
  (probar; en la mayoría de setups la caché de Numba son ficheros `.nbi/.nbc` que no se
  ejecutan vía `exec`, así que `noexec` funciona).
- `pids_limit` demasiado bajo (< nº threads OMP + threads internos de CPython/Numba)
  aborta la ejecución; 128–256 es un buen rango.
- `nano_cpus` limita *quota* (throttling CFS): 4 threads sobre `nano_cpus=2e9` se
  reparten 2 CPUs → los estudiantes verían speedups raros. Para la pedagogía de OpenMP
  es mejor `cpuset_cpus` (cores dedicados enteros) que quota fraccionaria.

### 2.3 Trampa de rutas al correr el backend en Compose (contenedores hermanos)

Si el backend corre en un contenedor y monta `/var/run/docker.sock`, los runners que
crea son **hermanos** (siblings), no hijos: el daemon del **host** resuelve cualquier
bind-mount con rutas del **host**, no del contenedor backend. Un
`volumes={"/app/submissions/x": ...}` fallaría o montaría basura.

Soluciones (de más simple a más robusta):

1. **Volumen nombrado compartido**: compose declara `telar_submissions`, lo monta en el
   backend en `/submissions` (rw) y el backend lo pasa por nombre al runner
   (`volumes={"telar_submissions": {"bind": "/work", "mode": "ro"}}` + subcarpeta por
   ejecución con el `subpath` de docker-py 7.2.0 o estructura interna). Los volúmenes
   nombrados los resuelve el daemon, sin ambigüedad de rutas.
2. **`put_archive` (docker cp programático)**: `client.containers.create(...)` →
   `container.put_archive("/work", tarball_bytes)` → `container.start()`. Evita
   volúmenes por completo; el código viaja como tar por la API. (Con `read_only=True`,
   `/work` debe ser un volumen/tmpfs escribible en el momento de la copia — verificar en
   un spike.)

---

## 3. Streaming de logs en vivo (→ WebSocket FastAPI)

### 3.1 API

Docs: [container.logs()](https://docker-py.readthedocs.io/en/stable/containers.html).

```python
gen = container.logs(stream=True, follow=True, stdout=True, stderr=True)
# -> "blocking generator you can iterate over to retrieve log output as it happens" (docs oficiales)
for chunk in gen:      # bytes; frames según escrituras del proceso, no líneas garantizadas
    ...
```

- `stream=True, follow=True`: generador **bloqueante y síncrono** que emite `bytes`;
  termina solo cuando el contenedor para (o se cierra el socket).
- `logs()` vs `attach()`: `logs` entrega desde el **inicio** del contenedor (sin carrera
  de arranque); `attach` solo desde el momento de conexión → **usar `logs`** para no
  perder las primeras líneas de contenedores rápidos (issue
  [#3247](https://github.com/docker/docker-py/issues/3247)).
- Con `tty=False` (default) el daemon multiplexa stdout/stderr; `container.logs()` ya
  quita las cabeceras de frame. Para separarlos: dos streams
  (`stdout=True, stderr=False` y viceversa) o el low-level
  `client.api.attach(..., demux=True)`.
- Los chunks **no** son líneas: hay que re-bufferizar por `\n` en el backend si el
  frontend espera líneas.
- `PYTHONUNBUFFERED=1` en el runner es imprescindible o CPython bufferiza stdout y los
  logs llegan a ráfagas.

### 3.2 Integración con asyncio (FastAPI) — docker-py es 100 % síncrono

Patrón recomendado: iterar el generador dentro del *threadpool* con
`run_in_executor(None, next, gen, sentinel)`:

```python
import asyncio
from fastapi import WebSocket

_SENTINEL = object()

async def stream_logs(container, ws: WebSocket) -> None:
    loop = asyncio.get_running_loop()
    gen = container.logs(stream=True, follow=True)   # generador bloqueante
    buffer = b""
    try:
        while True:
            # next() corre en un thread del executor; el event loop queda libre
            chunk = await loop.run_in_executor(None, next, gen, _SENTINEL)
            if chunk is _SENTINEL:          # el contenedor paró → stream terminado
                break
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                await ws.send_json({"type": "log", "line": line.decode(errors="replace")})
        if buffer:
            await ws.send_json({"type": "log", "line": buffer.decode(errors="replace")})
    finally:
        gen.close()
```

Puntos clave:

- **Cancelación:** cancelar la task de asyncio NO desbloquea el `next()` que ya corre en
  el thread. La forma fiable de terminar el stream es **matar/parar el contenedor**
  (el daemon cierra la conexión y el generador acaba). Esto encaja bien con el timeout
  duro de §5: `kill()` termina a la vez ejecución, log-stream y stats-stream.
- `asyncio.to_thread(next, gen, _SENTINEL)` es equivalente (Python ≥3.9).
- Alternativa async nativa: **aiodocker** (cliente asyncio no oficial). Para Telar no es
  necesario: el patrón executor es suficiente y docker-py es el SDK mantenido por Docker.
- El threadpool por defecto tiene `min(32, cpu+4)` workers; cada ejecución activa ocupa
  ~2 threads (logs + stats). Dimensionar `ThreadPoolExecutor` propio si se esperan
  muchas ejecuciones simultáneas, y subir `max_pool_size` del cliente (§1).

---

## 4. `container.stats(stream=True)`: métricas en vivo

Docs: [container.stats()](https://docker-py.readthedocs.io/en/stable/containers.html) — parámetros `stream` (default True) y `decode`.

```python
for raw in container.stats(stream=True, decode=True):   # decode=True → dicts
    ...
```

- **Frecuencia:** el daemon emite **~1 muestra por segundo** (igual que `docker stats`).
  No es configurable por la API; si se necesita menos frecuencia, descartar muestras.
- `stream=False` devuelve una única muestra (tarda ~1-2 s porque el daemon toma dos
  lecturas para poblar `precpu_stats`). El low-level `client.api.stats(..., one_shot=True,
  stream=False)` (API ≥1.41) devuelve una sola lectura rápida sin `precpu_stats`.
- Igual que los logs: generador **bloqueante** → mismo patrón `run_in_executor` de §3.
- Al morir el contenedor el stream emite una última muestra (a veces con campos vacíos)
  y termina — hay que tolerar dicts incompletos.

### 4.1 Formato del JSON (campos relevantes, cgroups v2)

```jsonc
{
  "read": "2026-07-12T10:00:01.0Z",
  "precpu_stats": {                       // muestra anterior (vacía en la 1ª lectura)
    "cpu_usage": { "total_usage": 0 },
    "system_cpu_usage": 0
  },
  "cpu_stats": {
    "cpu_usage": { "total_usage": 123456789 },  // ns acumulados del contenedor
    "system_cpu_usage": 987654321000,            // ns acumulados de TODO el host
    "online_cpus": 8,
    "throttling_data": { "periods": 10, "throttled_periods": 2, "throttled_time": 500000 }
  },
  "memory_stats": {
    "usage": 210763776,                   // bytes (incluye page cache)
    "limit": 536870912,                   // = mem_limit
    "stats": { "inactive_file": 4096, "anon": 200000000 /* cgroup v2 */ }
  },
  "pids_stats": { "current": 9, "limit": 256 }
}
```

Nota: en cgroups v2 **no** hay `percpu_usage` ni `memory_stats.max_usage`; usar
`online_cpus` y no depender de campos v1.

### 4.2 Cálculo correcto de CPU % y memoria (cgroups v2)

Fórmula oficial (la misma que usa el CLI `docker stats`; ver
[moby#29306](https://github.com/moby/moby/issues/29306) y
[foros Docker](https://forums.docker.com/t/calculate-cpu-usage-in-percentage-with-latest-api/66769)):

```python
def compute_metrics(s: dict) -> dict | None:
    """Convierte una muestra cruda de stats en métricas para el WebSocket."""
    try:
        cpu = s["cpu_stats"]; pre = s["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"]["total_usage"]
        system_delta = cpu["system_cpu_usage"] - pre.get("system_cpu_usage", 0)
        online = cpu.get("online_cpus") or 1
        cpu_percent = (cpu_delta / system_delta) * online * 100.0 if system_delta > 0 and cpu_delta >= 0 else 0.0

        mem = s["memory_stats"]
        # docker stats resta la page cache; en cgroup v2 la cache es 'inactive_file'
        # (en v1 era 'total_inactive_file'; en <=19.03, 'cache').
        # Fuente: https://docs.docker.com/reference/cli/docker/container/stats/
        stats = mem.get("stats", {})
        cache = stats.get("inactive_file", stats.get("total_inactive_file", 0))
        mem_used = max(mem["usage"] - cache, 0)
        mem_limit = mem.get("limit", 0)

        return {
            "cpu_percent": round(cpu_percent, 2),        # puede superar 100 (multi-core)
            "mem_used_bytes": mem_used,
            "mem_limit_bytes": mem_limit,
            "mem_percent": round(mem_used / mem_limit * 100, 2) if mem_limit else 0.0,
            "pids": s.get("pids_stats", {}).get("current", 0),
            "throttled_periods": cpu.get("throttling_data", {}).get("throttled_periods", 0),
        }
    except (KeyError, TypeError):
        return None   # primera muestra o muestra final incompleta
```

Detalles verificados:

- **CPU %:** `(cpu_delta / system_delta) * online_cpus * 100`. Con 4 cores al máximo da
  ~400 % — perfecto para visualizar el paralelismo OpenMP en la UI (mostrar
  `cpu_percent / online_cpus` si se quiere escala 0-100).
- **Primera muestra:** `precpu_stats` viene a cero/vacío → deltas inválidos; descartarla
  (`compute_metrics` devuelve `None`).
- **Memoria:** `usage` incluye page cache; `docker stats` muestra
  `usage - inactive_file` en cgroup v2 (`total_inactive_file` en v1). Cita textual de los
  docs: *"On cgroup v2 hosts, the cache usage is defined as the value of `inactive_file`
  field"* ([docs](https://docs.docker.com/reference/cli/docker/container/stats/)). WSL2
  con Docker moderno usa cgroups v2.
- `throttling_data.throttled_periods` es oro pedagógico: muestra cuándo el código del
  estudiante chocó con el límite de CPU.

---

## 5. Timeout duro: `wait(timeout=)` + kill + remove

Docs: [container.wait()](https://docker-py.readthedocs.io/en/stable/containers.html) — *"Raises requests.exceptions.ReadTimeout – If the timeout is exceeded."*

### 5.1 Semántica de `wait`

- `container.wait(timeout=N)` bloquea hasta que el contenedor pare y devuelve
  `{"StatusCode": <exit_code>, ...}`. `timeout` es el **read-timeout HTTP** de la
  petición: al excederse lanza `requests.exceptions.ReadTimeout` (sobre socket UNIX
  algunas versiones lo envuelven en `requests.exceptions.ConnectionError` → capturar
  ambas).
- **Trampa del timeout global del cliente:** `docker.from_env()` tiene `timeout=60` por
  defecto; un `wait()` **sin** argumento sobre un contenedor que corre >60 s lanza
  `ReadTimeout` igualmente. Pasar siempre `timeout=` explícito (y/o subir el timeout del
  cliente).
- `wait` también es bloqueante → ejecutarlo con `run_in_executor`/`to_thread`.

### 5.2 Trampas de `auto_remove` / `remove`

- `auto_remove=True` (borrado en el **daemon** al salir) crea una **carrera**: el
  contenedor puede desaparecer antes de leer logs o exit code → `docker.errors.NotFound`
  (404). Issues: [#1813](https://github.com/docker/docker-py/issues/1813),
  [#2655](https://github.com/docker/docker-py/issues/2655),
  [#2427](https://github.com/docker/docker-py/issues/2427) (con `remove=True` incluso se
  pierden logs finales).
- `remove=True` solo aplica a `detach=False` (borra el cliente tras leer la salida);
  no sirve para nuestro flujo detach + streaming.
- **Decisión para Telar:** `auto_remove=False` siempre; leer logs + exit code; borrar
  explícitamente con `remove(force=True)` en un `finally`. Añadir un *reaper* periódico
  que borre contenedores viejos con label `app=e-hpc` por si el backend crashea.

### 5.3 Patrón completo (timeout duro + limpieza garantizada)

```python
import asyncio
import requests
import docker

HARD_TIMEOUT_S = 30            # límite de la lección
KILL_GRACE_S = 5

async def run_with_timeout(container) -> dict:
    """Espera el fin del contenedor con timeout duro; mata y limpia siempre."""
    timed_out = False
    exit_code: int | None = None
    try:
        try:
            result = await asyncio.to_thread(container.wait, timeout=HARD_TIMEOUT_S)
            exit_code = result["StatusCode"]
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError):
            timed_out = True
            try:
                await asyncio.to_thread(container.kill)          # SIGKILL al PID 1 (tini reenvía)
            except docker.errors.APIError:
                pass                                             # ya había muerto: carrera benigna
            # tras kill, wait vuelve enseguida con el exit code real (137 = SIGKILL)
            result = await asyncio.to_thread(container.wait, timeout=KILL_GRACE_S)
            exit_code = result["StatusCode"]
        # logs finales (seguro porque auto_remove=False)
        tail = await asyncio.to_thread(container.logs, stdout=True, stderr=True, tail=200)
        return {"exit_code": exit_code, "timed_out": timed_out,
                "tail": tail.decode(errors="replace")}
    finally:
        try:
            await asyncio.to_thread(container.remove, force=True, v=True)  # v=True borra volúmenes anónimos
        except docker.errors.NotFound:
            pass
```

Efecto colateral útil: el `kill()` cierra también los streams de logs y stats de §3/§4,
así que las tasks del WebSocket terminan solas.

Exit codes que verá el estudiante: `0` OK, `137` = 128+SIGKILL (timeout **o** OOM-kill —
distinguir con `container.attrs["State"]["OOMKilled"]` vía `container.reload()` antes de
`remove`), `139` = segfault.

---

## 6. Riesgo de montar `/var/run/docker.sock` en el backend y mitigaciones

### 6.1 El riesgo (documentado)

Montar el socket en el contenedor del backend **equivale a darle root en el host**:
quien controla el socket puede crear un contenedor `--privileged` con `/` del host
montado y escapar trivialmente. Cita: *"Mounting /var/run/docker.sock into each
container is equivalent to giving every one of those containers sudo root on your
host"* ([blog GnTech](https://blog.gntech.me/posts/2026-05-14-docker-socket-proxy/),
[GeeksforGeeks](https://www.geeksforgeeks.org/devops/docker-tips-about-varrundockersock/)).
Si un atacante compromete el backend FastAPI (RCE vía cualquier bug), tiene el host.
Nótese que el código del **estudiante** nunca ve el socket (el runner no lo monta); el
riesgo es la superficie del backend.

### 6.2 Mitigaciones habituales

1. **docker-socket-proxy (Tecnativa)** — la mitigación estándar en compose
   ([GitHub](https://github.com/Tecnativa/docker-socket-proxy),
   [Docker Hub](https://hub.docker.com/r/tecnativa/docker-socket-proxy/)): un HAProxy que
   monta el socket (ro) y expone `:2375` **solo en una red interna**, filtrando endpoints
   de la API por variables de entorno; lo no permitido → `403`.

   ```yaml
   services:
     socket-proxy:
       image: tecnativa/docker-socket-proxy
       volumes:
         - /var/run/docker.sock:/var/run/docker.sock:ro
       environment:
         CONTAINERS: 1        # GET /containers/* (list, logs, stats, wait)
         POST: 1              # necesario para create/start/kill/remove
         ALLOW_START: 1
         ALLOW_STOP: 1
         IMAGES: 1            # GET /images (verificar que el runner existe)
       networks: [docker-api] # SIN 'ports:' → inaccesible desde fuera

     backend:
       environment:
         DOCKER_HOST: tcp://socket-proxy:2375
       networks: [docker-api, default]
   ```

   docker-py lo consume sin cambios: `docker.from_env()` lee `DOCKER_HOST`.
   **Limitación honesta:** el proxy filtra *endpoints*, no *payloads* — un backend
   comprometido con `POST /containers/create` permitido aún puede pedir un contenedor
   privilegiado. Reduce superficie (no puede tocar volúmenes, redes, swarm, exec en
   otros contenedores...) pero no elimina el riesgo
   ([issue #115](https://github.com/Tecnativa/docker-socket-proxy/issues/115)).
2. **Defensa en profundidad del propio backend:** contenedor backend no-root,
   `read_only`, sin `cap_add`, dependencias auditadas; validar/limitar en el código todo
   lo que se pasa a `containers.run` (imagen fija por constante, límites fijos, nunca
   parámetros del usuario en `HostConfig`).
3. **Rootless Docker / Podman rootless:** el daemon corre como usuario sin privilegios;
   un escape del socket compromete ese usuario, no root. Funciona en WSL2, con
   fricciones (cgroups delegados para limits).
4. **gVisor (`runtime="runsc"`)** en el **runner**: kernel en espacio de usuario entre
   el código del estudiante y el kernel real. `containers.run(..., runtime="runsc")`.
   Mitiga el otro vector (escape del runner), complementario al socket-proxy.
5. **Daemon/host separado para runners:** `DOCKER_HOST=tcp://runner-host:2376` con TLS
   mutuo — el blast radius queda fuera del host principal. Sobredimensionado para la
   tesis; mencionable como trabajo futuro.
6. **Para desarrollo en WSL2:** correr el backend directamente en WSL (uvicorn, fuera de
   contenedor) elimina el dilema del socket durante el desarrollo; el socket-proxy entra
   en el compose "de despliegue".

---

## 7. Recomendaciones consolidadas para Telar

1. **Pin:** `docker>=7.2,<8` + `docker.from_env(version="auto", timeout=120, max_pool_size=50)`.
2. **Flujo por ejecución:** `run(detach=True, auto_remove=False)` → 2 tasks asyncio
   (logs + stats vía `run_in_executor`) → `wait(timeout=N)` con kill al exceder →
   `reload()` para `OOMKilled` → `remove(force=True)` en `finally` + reaper por label.
3. **Sandbox base:** `network_mode="none"`, `user` no-root, `cap_drop=["ALL"]`,
   `no-new-privileges`, `read_only=True` + tmpfs, `mem_limit==memswap_limit`,
   `cpuset_cpus` (mejor que quota para pedagogía OpenMP), `pids_limit=256`, `init=True`,
   `NUMBA_CACHE_DIR` en tmpfs.
4. **Código del estudiante:** volumen nombrado compartido o `put_archive` — nunca
   bind-mounts con rutas del contenedor backend (§2.3).
5. **Socket:** en producción/demo, `tecnativa/docker-socket-proxy` en red interna;
   documentar en la tesis el análisis de riesgo (§6). El runner jamás monta el socket.
6. **Nota de entorno:** nada de esto depende de Node (Node 18 solo afecta al frontend
   Vite/Electron, fuera del alcance de este doc).

---

## 8. Fuentes

- PyPI — paquete `docker` 7.2.0: <https://pypi.org/project/docker/>
- docker-py Changelog: <https://docker-py.readthedocs.io/en/latest/change-log.html>
- docker-py Containers (run/logs/stats/wait): <https://docker-py.readthedocs.io/en/stable/containers.html>
- docker-py releases: <https://github.com/docker/docker-py/releases>
- Docker Engine 29 release notes (API 1.52, mínimo 1.44): <https://docs.docker.com/engine/release-notes/29/>
- Blog Docker — Engine v29: <https://www.docker.com/blog/docker-engine-version-29/>
- Breakage de clientes viejos con API mínima: <https://frank.seesink.com/blog/docker-api-version-issues/>
- `docker stats` — cálculo de memoria/cache (cgroup v1 vs v2): <https://docs.docker.com/reference/cli/docker/container/stats/>
- Fórmula CPU% (moby): <https://github.com/moby/moby/issues/29306> y <https://forums.docker.com/t/calculate-cpu-usage-in-percentage-with-latest-api/66769>
- Carreras con `auto_remove`/logs: <https://github.com/docker/docker-py/issues/1813>, <https://github.com/docker/docker-py/issues/2655>, <https://github.com/docker/docker-py/issues/2427>, <https://github.com/docker/docker-py/issues/3247>
- docker-socket-proxy: <https://github.com/Tecnativa/docker-socket-proxy>, <https://hub.docker.com/r/tecnativa/docker-socket-proxy/>, <https://github.com/Tecnativa/docker-socket-proxy/issues/115>
- Riesgo del socket: <https://blog.gntech.me/posts/2026-05-14-docker-socket-proxy/>, <https://www.geeksforgeeks.org/devops/docker-tips-about-varrundockersock/>
- Deprecación módulo Go `github.com/docker/docker` (no afecta a docker-py): <https://github.com/moby/moby/discussions/52404>
