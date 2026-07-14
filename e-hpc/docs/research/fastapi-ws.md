# Investigación: FastAPI para el backend de E-HPC

> **Fecha:** 2026-07-12 · **Proyecto:** E-HPC (plataforma educativa OpenMP/PyOMP)
> **Entorno objetivo:** WSL2 (Ubuntu) sobre Windows · Docker 29.3.0 + Compose v5.1.0 · Python 3.12.3 · Node 18.20.8
> **Alcance:** versiones, WebSockets (stream de logs/métricas desde threads sync), UploadFile, SQLite, lifespan/CORS/jobs largos, docker-compose con healthchecks.

---

## 1. Versiones recomendadas (verificadas a julio 2026)

| Paquete | Versión actual | Nota |
|---|---|---|
| `fastapi` | **0.139.0** (2026-07-01) | Requiere Python >= 3.10. Desde versiones recientes exige `pydantic >= 2.9.0`. Refactor de internals del router (0.136+): se pueden añadir rutas a un `APIRouter` después de incluirlo. |
| `uvicorn` | **0.51.0** (2026-07-08) | Soporta Python 3.10–3.14. Instalar como `uvicorn[standard]` (incluye `uvloop`, `httptools`, `websockets`). |
| `pydantic` | **2.12.x** (estable; 2.13 en beta) | v2 con `pydantic-core` en Rust. Compatible con Python 3.12 sin problemas. |
| `pydantic-settings` | 2.x | Para configuración vía variables de entorno (`BaseSettings`). |
| `python-multipart` | >= 0.0.20 | **Obligatorio** para `UploadFile` / `Form`. |
| `sse-starlette` | **3.4.1** | Solo si se optara por SSE (ver §2.4). |
| `aiosqlite` | >= 0.21 | Recomendado para SQLite async (ver §4). |
| `docker` (docker-py) | >= 7.1 | SDK para lanzar los contenedores runner y leer logs/stats. |
| `websockets` | (vía `uvicorn[standard]`) | Backend WS de uvicorn; no se usa directamente. |

`pip install "fastapi[standard]"` instala de una vez `uvicorn[standard]`, `python-multipart`, `httpx`, `jinja2` y el CLI `fastapi dev/run`. Para el backend de E-HPC es la opción más simple.

**Pin sugerido para `requirements.txt` (o `pyproject.toml`):**

```txt
fastapi[standard]>=0.139,<0.140
pydantic>=2.12,<3
pydantic-settings>=2.6,<3
aiosqlite>=0.21,<1
docker>=7.1,<8
```

> FastAPI aún es 0.x: cambios menores pueden romper API. Pinnear minor (`<0.140`) y subir de forma controlada es la práctica recomendada en sus propios docs de deployment (`fastapi.tiangolo.com/deployment/versions/`).

> **Nota Node:** nada del backend requiere Node. La restricción Node 18 solo afecta al frontend (Vite 5 funciona con Node 18; Vite 6/7 exigen Node 20+ → si se adopta Vite 6+, instalar Node 20/22 vía `nvm` y documentarlo en el repo).

---

## 2. WebSockets: stream de logs + métricas de un job

### 2.1 Patrón base (accept, send_json, WebSocketDisconnect)

FastAPI expone WebSockets de Starlette con soporte de primera clase:

```python
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

@router.websocket("/ws/jobs/{job_id}")
async def job_stream(websocket: WebSocket, job_id: str):
    await websocket.accept()
    try:
        while True:
            # enviar mensajes tipados como JSON
            await websocket.send_json({"type": "log", "line": "..."})
    except WebSocketDisconnect:
        # el cliente cerró la pestaña / perdió conexión — limpiar recursos
        pass
```

Claves:

- `WebSocketDisconnect` se lanza al hacer `receive()` sobre un socket cerrado; si solo se **envía**, la desconexión aparece como excepción en `send_*` (Starlette lanza `RuntimeError`/`WebSocketDisconnect` según versión). El patrón robusto es tener una tarea lectora concurrente (ver 2.3).
- `send_json(data)` serializa con `json.dumps` (modo `text` por defecto). Para los mensajes de E-HPC conviene un **envelope tipado**: `{"type": "log" | "metrics" | "status" | "eof", ...}`.
- `websocket.close(code=1000)` para cierre limpio; códigos 4000-4999 para errores de aplicación (p. ej. `4404` job inexistente).
- **CORS no aplica a WebSockets**: `CORSMiddleware` no inspecciona handshakes WS. Si se quiere restringir origen, validar manualmente `websocket.headers.get("origin")` antes de `accept()`.

### 2.2 El problema: docker-py es sync y bloqueante

`container.logs(stream=True, follow=True)` y `container.stats(stream=True, decode=True)` son **generadores bloqueantes** (HTTP chunked sobre el socket de Docker). No pueden iterarse en una corutina sin congelar el event loop. Y los objetos de asyncio **no son thread-safe**: llamar `websocket.send_json(...)` o `queue.put_nowait(...)` directamente desde un thread corrompe estado silenciosamente.

**Solución canónica: `asyncio.Queue` como puente + programar el `put` en el loop desde el thread.** Dos variantes:

| Mecanismo | Comportamiento | Cuándo usar |
|---|---|---|
| `loop.call_soon_threadsafe(queue.put_nowait, msg)` | No bloquea el thread productor; si la cola está llena lanza `QueueFull` (se pierde el mensaje o hay que manejarlo) | Métricas (1 muestra/s, perder una no importa) |
| `asyncio.run_coroutine_threadsafe(queue.put(msg), loop).result()` | Bloquea el thread productor hasta que hay hueco → **backpressure natural** | Logs (no se debe perder ninguna línea; si el cliente va lento, se frena la lectura del contenedor) |

### 2.3 Snippet completo para E-HPC (logs + stats → WebSocket)

```python
import asyncio
import threading
from typing import Any

import docker
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
_EOF = {"type": "eof"}          # sentinela: el productor terminó
QUEUE_MAX = 1000                # backpressure: ~1000 mensajes en vuelo


def _logs_worker(container, loop: asyncio.AbstractEventLoop,
                 queue: "asyncio.Queue[dict[str, Any]]") -> None:
    """Thread sync: lee logs del runner y los empuja al loop con backpressure."""
    try:
        for raw in container.logs(stream=True, follow=True):
            fut = asyncio.run_coroutine_threadsafe(
                queue.put({"type": "log", "line": raw.decode(errors="replace")}),
                loop,
            )
            fut.result()  # bloquea ESTE thread si la cola está llena (backpressure)
    except Exception as exc:  # contenedor eliminado, socket roto, etc.
        loop.call_soon_threadsafe(
            queue.put_nowait, {"type": "error", "detail": str(exc)}
        )
    finally:
        loop.call_soon_threadsafe(queue.put_nowait, _EOF)


def _stats_worker(container, loop: asyncio.AbstractEventLoop,
                  queue: "asyncio.Queue[dict[str, Any]]",
                  stop: threading.Event) -> None:
    """Thread sync: muestrea docker stats (~1/s). Perder una muestra es aceptable."""
    for stats in container.stats(stream=True, decode=True):
        if stop.is_set():
            break
        msg = {
            "type": "metrics",
            "cpu": _cpu_percent(stats),          # calcular delta cpu_stats/precpu_stats
            "mem_bytes": stats["memory_stats"].get("usage", 0),
            "mem_limit": stats["memory_stats"].get("limit", 0),
        }
        try:
            loop.call_soon_threadsafe(queue.put_nowait, msg)
        except RuntimeError:     # loop cerrado durante shutdown
            break


@router.websocket("/ws/jobs/{job_id}")
async def job_stream(websocket: WebSocket, job_id: str):
    await websocket.accept()

    job = websocket.app.state.jobs.get(job_id)   # registro en memoria (ver §5.2)
    if job is None:
        await websocket.close(code=4404, reason="job not found")
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=QUEUE_MAX)
    stop = threading.Event()

    threading.Thread(target=_logs_worker,
                     args=(job.container, loop, queue), daemon=True).start()
    threading.Thread(target=_stats_worker,
                     args=(job.container, loop, queue, stop), daemon=True).start()

    async def _sender() -> None:
        while True:
            msg = await queue.get()
            if msg is _EOF:
                exit_info = await asyncio.to_thread(job.container.wait)
                await websocket.send_json(
                    {"type": "status", "state": "finished",
                     "exit_code": exit_info.get("StatusCode")})
                return
            await websocket.send_json(msg)

    async def _receiver() -> None:
        # detecta desconexión del cliente aunque solo estemos enviando;
        # también permite comandos futuros (p. ej. {"type": "cancel"})
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "cancel":
                await asyncio.to_thread(job.container.kill)

    sender = asyncio.create_task(_sender())
    receiver = asyncio.create_task(_receiver())
    try:
        done, pending = await asyncio.wait(
            {sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                raise exc
    except WebSocketDisconnect:
        pass                      # cliente se fue: no es un error
    finally:
        stop.set()                # detener el thread de stats
        # el thread de logs muere solo cuando el contenedor termina (daemon=True)
```

Notas de diseño:

- **`asyncio.to_thread(...)`** (Python 3.9+) es la forma moderna de ejecutar llamadas bloqueantes puntuales de docker-py (`container.wait()`, `container.kill()`) sin threads manuales.
- La cancelación de `pending` en el `finally`/tras `asyncio.wait` es **crítica**: sin ella, la tarea emisora sigue intentando escribir a un socket muerto y se fugan recursos (patrón documentado en websocket.org/guides/frameworks/fastapi).
- El sentinela `_EOF` se compara **por identidad** (`is`), no por igualdad, para no confundirlo con datos del usuario.
- Si el frontend se reconecta (F5), conviene guardar los logs también en disco/DB (el runner ya los tiene: `container.logs()` sin `stream` devuelve todo el histórico) y reenviar el backlog al `accept()`.
- Alternativa empaquetada: la librería `janus` ofrece una cola con API sync + async simultánea; es exactamente este patrón. Para E-HPC no hace falta una dependencia extra: el puente son ~10 líneas.

### 2.4 ¿SSE (sse-starlette) sería más simple? Comparativa y recomendación

| Criterio | WebSocket | SSE (`sse-starlette` 3.4.1) |
|---|---|---|
| Dirección | Bidireccional | Solo servidor → cliente |
| Protocolo | Upgrade a WS (nginx necesita config `Upgrade`/`Connection`) | HTTP plano (nginx solo necesita `proxy_buffering off`) |
| Reconexión automática | No (implementar en cliente) | Sí, nativa en `EventSource` (+ header `Last-Event-ID`) |
| Headers custom (p. ej. `Authorization`) | Sí (en handshake vía subprotocolo o cookie/query) | **No** en `EventSource` nativo (solo GET, sin headers) |
| Cancelar / stdin / comandos del cliente | Mismo canal | Requiere endpoints HTTP aparte (POST /jobs/{id}/cancel) |
| Multiplexar logs+métricas+estado | JSON tipado en un canal | `event:` types en un stream (también posible) |
| Dependencias | Ninguna extra (FastAPI nativo) | `sse-starlette` (o el nuevo tutorial SSE de FastAPI con `StreamingResponse`) |
| Testeo manual | Cliente WS (wscat, Postman) | `curl -N` directo |
| Límite de conexiones | Sin límite práctico | HTTP/1.1: ~6 conexiones por navegador/dominio (irrelevante con 1 job a la vez) |

**Recomendación para E-HPC: WebSocket.** Razones:

1. **Un solo canal** multiplexa logs + métricas + cambios de estado del job con mensajes JSON tipados, y además admite comandos del cliente (**cancelar job**, y en el futuro stdin interactivo) sin endpoints adicionales. Para una plataforma educativa donde el estudiante ejecuta y aborta código, la bidireccionalidad no es opcional a medio plazo.
2. FastAPI lo soporta **nativamente** (cero dependencias extra) y uvicorn[standard] trae el backend `websockets`.
3. La limitación real de SSE — `EventSource` no permite headers — complica la autenticación (tocaría token por query string).
4. El costo extra (config `Upgrade` en nginx, reconexión manual en el cliente) es pequeño y bien documentado.

SSE queda como **plan B válido** si el WS diera problemas a través del nginx del compose: la migración es barata porque el productor (threads + queue) es idéntico; solo cambia el emisor (`EventSourceResponse` con un async generator que drena la misma cola).

Config nginx necesaria para proxyear WS (frontend en nginx:8080 → backend:8000):

```nginx
location /ws/ {
    proxy_pass http://backend:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # jobs largos: no cortar el stream
}
```

---

## 3. UploadFile: validación de tamaño y extensión

### 3.1 Requisitos y comportamiento

- `UploadFile` requiere **`python-multipart`** instalado (incluido en `fastapi[standard]`).
- Starlette escribe el cuerpo en un `SpooledTemporaryFile` (memoria hasta ~1 MB, luego disco), así que archivos grandes no revientan la RAM, pero **no hay límite de tamaño por defecto**: hay que imponerlo.
- `UploadFile.size` en Starlette moderno refleja los **bytes realmente recibidos** (no lo que declare el cliente) — es confiable *después* de recibir el cuerpo. Para cortar **antes** de recibir todo, se valida `Content-Length` o se lee por chunks.
- `file.content_type` lo declara el cliente → **no confiar** para seguridad; validar extensión + contenido.

### 3.2 Snippet de validación para E-HPC (código PyOMP del estudiante)

```python
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, status

router = APIRouter()

MAX_CODE_SIZE = 256 * 1024          # 256 KB: generoso para código de estudiante
CHUNK = 64 * 1024
ALLOWED_EXTENSIONS = {".py"}


async def read_validated_source(file: UploadFile) -> str:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Extensión no permitida: {ext or '(sin extensión)'}. Solo .py",
        )

    # Lectura por chunks: corta apenas se supera el límite,
    # sin depender del Content-Length declarado por el cliente.
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(CHUNK):
        total += len(chunk)
        if total > MAX_CODE_SIZE:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Archivo supera el máximo de {MAX_CODE_SIZE // 1024} KB",
            )
        chunks.append(chunk)

    data = b"".join(chunks)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El archivo debe ser texto UTF-8 válido",
        )


@router.post("/jobs/upload")
async def create_job_from_file(file: UploadFile):
    source = await read_validated_source(file)
    ...
```

### 3.3 Defensa en profundidad y alternativa recomendada

- **Primera barrera en nginx:** `client_max_body_size 1m;` rechaza cuerpos grandes antes de tocar Python.
- **Barrera rápida en FastAPI:** un chequeo de `Content-Length` (middleware o dependencia) devuelve 413 sin leer el cuerpo cuando el header ya excede el límite; la lectura por chunks cubre a los clientes que mienten u omiten el header.
- **Alternativa más simple para el caso principal:** el flujo típico de E-HPC es *editor Monaco → ejecutar*. Ahí el código es texto y basta un body JSON con Pydantic, sin multipart:

```python
from pydantic import BaseModel, Field

class RunRequest(BaseModel):
    code: str = Field(min_length=1, max_length=256_000)
    lesson_id: str | None = None
```

  `UploadFile` queda solo para la funcionalidad "subir archivo .py". Menos superficie, validación declarativa y documentación OpenAPI automática.

---

## 4. SQLite: sync vs aiosqlite vs SQLModel/SQLAlchemy

### 4.1 Comparativa

| Opción | Cómo encaja en FastAPI | Pros | Contras |
|---|---|---|---|
| `sqlite3` stdlib (sync) | Endpoints `def` (FastAPI los corre en threadpool) o `asyncio.to_thread` | Cero dependencias; simple | `check_same_thread=False` + lock manual o conexión por request; mezcla de estilos sync/async en un backend que ya es async por los WS |
| **`aiosqlite`** | `await db.execute(...)` directo en endpoints `async def` | API idéntica a sqlite3 pero async; ejecuta cada conexión en su propio thread interno (no hay problema `check_same_thread`); sin ORM = SQL explícito, fácil con repository pattern | Sin modelos tipados (se mapean a mano a Pydantic); sin migraciones automáticas |
| SQLModel (SQLAlchemy 2 + Pydantic) | Tutorial oficial de FastAPI; sesión sync con `connect_args={"check_same_thread": False}` o async con `sqlite+aiosqlite://` | Modelos = tablas = schemas; migración futura a Postgres casi gratis; Alembic disponible | Dos capas de complejidad extra para ~4 tablas; la variante async (asyncio de SQLAlchemy) añade fricción notable a un MVP |

### 4.2 Recomendación pragmática para el MVP: **aiosqlite + repository pattern, sin ORM**

La base de datos de E-HPC es pequeña (usuarios, lecciones/progreso, jobs y sus metadatos) y el backend es async-first por los WebSockets. `aiosqlite` mantiene todo en un solo modelo de concurrencia, el repository pattern aísla el SQL, y si la tesis creciera hacia Postgres, los repositorios se reimplementan sin tocar la lógica de negocio.

```python
# db.py
import aiosqlite

async def open_db(path: str) -> aiosqlite.Connection:
    db = await aiosqlite.connect(path)
    db.row_factory = aiosqlite.Row
    # PRAGMAs recomendados para una webapp con SQLite:
    await db.execute("PRAGMA journal_mode=WAL")     # lectores no bloquean al escritor
    await db.execute("PRAGMA busy_timeout=5000")    # espera 5 s ante lock en vez de fallar
    await db.execute("PRAGMA synchronous=NORMAL")   # seguro con WAL, mucho más rápido
    await db.execute("PRAGMA foreign_keys=ON")      # OFF por defecto en SQLite!
    await db.commit()
    return db
```

```python
# repositories/jobs.py — repository pattern sobre aiosqlite
from dataclasses import dataclass
import aiosqlite

@dataclass(frozen=True)                 # inmutable: se crean copias, no se muta
class JobRecord:
    id: str
    user_id: str
    status: str
    exit_code: int | None
    created_at: str

class JobRepository:
    def __init__(self, db: aiosqlite.Connection) -> None:
        self._db = db

    async def create(self, job: JobRecord) -> JobRecord:
        await self._db.execute(
            "INSERT INTO jobs (id, user_id, status, created_at) VALUES (?, ?, ?, ?)",
            (job.id, job.user_id, job.status, job.created_at),
        )
        await self._db.commit()
        return job

    async def find_by_id(self, job_id: str) -> JobRecord | None:
        cur = await self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
        row = await cur.fetchone()
        return JobRecord(**dict(row)) if row else None

    async def update_status(self, job_id: str, status: str,
                            exit_code: int | None = None) -> None:
        await self._db.execute(
            "UPDATE jobs SET status = ?, exit_code = ? WHERE id = ?",
            (status, exit_code, job_id),
        )
        await self._db.commit()
```

Notas clave:

- **WAL mode** es esencial: sin él, cada escritura bloquea todas las lecturas. Con WAL, lecturas concurrentes + 1 escritor funcionan bien para decenas de usuarios simultáneos (más que suficiente para un aula).
- **`check_same_thread`** es un problema de `sqlite3`/SQLAlchemy sync (la conexión se crea en un thread del pool y se usa en otro). Con `aiosqlite` **no aplica**: cada conexión vive en su propio thread dedicado y la librería serializa el acceso.
- Una **única conexión compartida** creada en el lifespan es suficiente y evita el problema del single-writer de SQLite (las escrituras quedan naturalmente serializadas). Si se quisiera paralelismo de lectura, abrir 2-3 conexiones de solo lectura aparte.
- **Migraciones:** para el MVP, un `schema.sql` idempotente (`CREATE TABLE IF NOT EXISTS ...`) ejecutado en el lifespan + una tabla `schema_version` manual. Alembic solo si se adopta SQLAlchemy.
- **Cuándo elegir SQLModel en su lugar:** si el equipo valora modelos tipados unificados (tabla = schema de respuesta) por encima del costo de aprender SQLAlchemy, la ruta del tutorial oficial (SQLModel sync + endpoints `def` + `check_same_thread=False`) es válida; FastAPI la ejecuta en el threadpool y no bloquea los WS. Es más código de infraestructura para el mismo resultado en este tamaño de proyecto.

---

## 5. Lifespan, jobs largos y CORS

### 5.1 Lifespan moderno con `asynccontextmanager`

`@app.on_event("startup"/"shutdown")` está **deprecado**; el patrón actual es:

```python
# main.py
from contextlib import asynccontextmanager
import docker
from fastapi import FastAPI
from .db import open_db
from .repositories.jobs import JobRepository

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- startup ----
    app.state.db = await open_db("data/ehpc.db")
    app.state.docker = docker.from_env()          # habla con /var/run/docker.sock
    app.state.jobs = {}                           # registro en memoria: job_id -> Job
    app.state.job_repo = JobRepository(app.state.db)
    yield
    # ---- shutdown ----
    for job in app.state.jobs.values():           # matar runners huérfanos
        if job.task and not job.task.done():
            job.task.cancel()
        try:
            job.container.kill()
        except Exception:
            pass
    await app.state.db.close()
    app.state.docker.close()

app = FastAPI(title="E-HPC API", lifespan=lifespan)
```

`app.state` es el lugar idiomático para singletons (cliente Docker, conexión DB, registro de jobs); en endpoints se accede vía `request.app.state` / `websocket.app.state`, o se envuelve en dependencias `Depends` para testear con overrides.

### 5.2 Jobs largos: `BackgroundTasks` vs `asyncio.create_task`

| | `BackgroundTasks` | `asyncio.create_task` |
|---|---|---|
| Diseñado para | Tareas cortas *después* de responder (enviar email, log de auditoría) | Tareas concurrentes arbitrarias del event loop |
| Handle para estado/cancelación | **No** — fire-and-forget, sin referencia | Sí — el `Task` se guarda, se consulta `done()`, se cancela |
| Funciones sync | Se ejecutan en el threadpool automáticamente | Hay que envolver con `asyncio.to_thread` |
| Sobrevive a restart del proceso | No | No |

Para E-HPC (ejecuciones de minutos, con estado consultable, stream en vivo y cancelación) **`asyncio.create_task` + registro en memoria** es lo correcto; `BackgroundTasks` no da handle. Celery/arq serían la evolución si hiciera falta persistencia de cola o múltiples workers — sobredimensionado para el MVP.

```python
import asyncio, uuid
from dataclasses import dataclass, field

@dataclass
class Job:
    id: str
    container: object | None = None
    task: asyncio.Task | None = None
    status: str = "pending"

@router.post("/jobs", status_code=202)
async def create_job(req: RunRequest, request: Request):
    job = Job(id=uuid.uuid4().hex)
    request.app.state.jobs[job.id] = job

    async def _run() -> None:
        docker_client = request.app.state.docker
        # crear el runner es bloqueante -> thread
        job.container = await asyncio.to_thread(
            docker_client.containers.run,
            "ehpc-runner:latest",
            command=["python", "/work/main.py"],
            detach=True,
            network_disabled=True,       # aislamiento: sin red
            mem_limit="512m",
            nano_cpus=2_000_000_000,     # 2 CPUs
            pids_limit=128,
            security_opt=["no-new-privileges"],
        )
        job.status = "running"
        await request.app.state.job_repo.update_status(job.id, "running")
        result = await asyncio.to_thread(job.container.wait, timeout=300)
        job.status = "finished"
        await request.app.state.job_repo.update_status(
            job.id, "finished", result.get("StatusCode"))

    job.task = asyncio.create_task(_run())
    # ¡mantener la referencia! (job.task): un Task sin referencia puede ser
    # recolectado por el GC a mitad de ejecución (trampa conocida de asyncio)
    return {"job_id": job.id, "ws": f"/ws/jobs/{job.id}"}
```

Respuesta inmediata `202 Accepted` con el `job_id`; el cliente abre el WS para el stream. La trampa del GC (guardar siempre la referencia al task) está documentada en los docs de asyncio.

### 5.3 CORS con múltiples orígenes + Electron

Orígenes reales del proyecto:

- `http://localhost:5173` — Vite dev server
- `http://localhost:8080` — nginx del docker-compose
- Electron: depende de cómo cargue el frontend:
  - `win.loadFile("index.html")` → protocolo `file://` → el navegador envía **`Origin: null`** (la cadena literal `"null"`).
  - Custom protocol (`app://`) registrado con `protocol.registerSchemesAsPrivileged` + `standard: true, secure: true` → origen tipo `app://.` (recomendado por Electron para SPAs).

```python
from fastapi.middleware.cors import CORSMiddleware

ALLOWED_ORIGINS = [
    "http://localhost:5173",   # Vite dev
    "http://localhost:8080",   # nginx (docker-compose)
    "null",                    # Electron con file:// — Origin literal "null"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^app://.*$",   # Electron con custom protocol app://
    allow_credentials=False,            # ver nota de seguridad
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Notas importantes:

- **`"null"` funciona** porque `CORSMiddleware` compara strings: el header `Origin: null` casa con el elemento `"null"` de la lista. Es la solución estándar para Electron+file:// (issue electron/electron#1990).
- **Seguridad de `"null"`:** cualquier iframe sandboxed o redirect también produce `Origin: null`, así que no es un origen "confiable". Mitigación: `allow_credentials=False` (sin cookies) y autenticación por header `Authorization: Bearer ...` — el token no viaja automáticamente desde orígenes ajenos, así que permitir `null` es aceptable para una herramienta local/educativa.
- **Regla dura de la spec:** `allow_origins=["*"]` es incompatible con `allow_credentials=True` (el middleware además dejaría de emitir `*`). Con lista explícita no hay problema.
- **Mejor a largo plazo:** usar custom protocol `app://` en Electron (evita todas las rarezas de `file://`: rutas relativas, `Origin: null`, restricciones de fetch) y permitirlo por `allow_origin_regex`. Alternativa que elimina CORS por completo en Electron: proxyear las llamadas API a través del main process (`net` module / handler de protocolo), pero añade complejidad al MVP.
- **WebSockets:** `CORSMiddleware` **no** los protege ni los bloquea — el handshake WS no pasa por CORS. Los navegadores tampoco aplican same-origin a WS. Si se quiere restringir, validar `Origin` a mano en el endpoint WS (y aceptar `null`/`app://` igual que arriba).

---

## 6. docker-compose: healthchecks y `depends_on: service_healthy`

### 6.1 Endpoint de salud en FastAPI

```python
@app.get("/health", tags=["infra"])
async def health():
    checks = {"db": False, "docker": False}
    try:
        await app.state.db.execute("SELECT 1")
        checks["db"] = True
    except Exception:
        pass
    try:
        checks["docker"] = await asyncio.to_thread(app.state.docker.ping)
    except Exception:
        pass
    healthy = all(checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "degraded", "checks": checks},
    )
```

### 6.2 compose.yaml para E-HPC

```yaml
# compose.yaml — Compose v2/v5: la clave `version:` está obsoleta, omitirla
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - EHPC_DB_PATH=/app/data/ehpc.db
      - EHPC_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8080,null
    volumes:
      - ./data:/app/data
      # el backend lanza runners como contenedores HERMANOS (no DinD):
      - /var/run/docker.sock:/var/run/docker.sock
    healthcheck:
      # python en vez de curl: las imágenes slim no traen curl/wget
      test: ["CMD", "python", "-c",
             "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3); sys.exit(0 if r.status==200 else 1)"]
      interval: 10s        # frecuencia del chequeo
      timeout: 5s          # máximo por chequeo
      retries: 5           # fallos consecutivos antes de 'unhealthy'
      start_period: 15s    # gracia inicial: fallos aquí no cuentan
    restart: unless-stopped

  web:
    build: ./web           # nginx sirviendo el build de Vite + proxy /api y /ws
    ports:
      - "8080:80"
    depends_on:
      backend:
        condition: service_healthy   # espera al healthcheck, no solo al start
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:80/"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
```

Puntos clave:

- **`condition: service_healthy`** hace que `web` espere hasta que el healthcheck de `backend` pase (no solo a que el contenedor arranque). Condiciones disponibles: `service_started`, `service_healthy`, `service_completed_successfully`. Con `restart: true` en el `depends_on` (Compose 2.17+), `web` se reinicia si `backend` es recreado.
- **Healthcheck sin curl:** la imagen `python:3.12-slim` no trae curl; el one-liner de `urllib` evita instalarlo. Alternativa equivalente: `CMD-SHELL` con `python -c ...` si se necesitan variables de entorno.
- **`start_period`** cubre el arranque del lifespan (abrir DB, ping a Docker); los fallos dentro de ese periodo no cuentan para `retries`.
- **Socket de Docker montado:** los runners de PyOMP se lanzan como contenedores *hermanos* vía `/var/run/docker.sock` (patrón sibling, no Docker-in-Docker). Advertencia de seguridad conocida: acceso al socket = root del host; aceptable para entorno educativo local/WSL2, y motivo extra para que el runner corra con `network_disabled`, límites de memoria/CPU/pids y sin privilegios (ver §5.2). Documentarlo en la tesis como decisión consciente.
- **Runner precompilado:** construir la imagen `ehpc-runner` (python 3.12 + `pyomp==0.5.*`) en el mismo compose con `profiles: ["build"]` o un `docker build` previo, y referenciarla por tag desde el backend.
- **WSL2:** el socket `/var/run/docker.sock` funciona igual dentro de WSL2 con Docker Engine nativo o Docker Desktop (integración WSL). Sin cambios en el compose.
- **uvicorn en el contenedor:** `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` — un solo worker es suficiente y **necesario** mientras el registro de jobs viva en memoria (con `--workers N` cada worker tendría su propio dict y los WS podrían caer en el worker equivocado).

---

## 7. Resumen de decisiones recomendadas

1. **Stack:** `fastapi[standard] 0.139.x` + `uvicorn[standard] 0.51.x` + `pydantic 2.12.x` sobre Python 3.12 — todo verificado compatible.
2. **Tiempo real: WebSocket** (no SSE) — un canal JSON tipado para logs + métricas + estado, con capacidad de cancelar; SSE documentado como plan B de bajo costo.
3. **Puente sync→async:** threads daemon para `container.logs()`/`stats()` + `asyncio.Queue`; `run_coroutine_threadsafe(...).result()` para logs (backpressure) y `call_soon_threadsafe(put_nowait)` para métricas (lossy OK); sentinela EOF por identidad; tarea lectora concurrente para detectar desconexión.
4. **Entrada de código:** JSON con Pydantic (`max_length`) para el editor; `UploadFile` con validación por chunks (256 KB, `.py`, UTF-8) solo para subida de archivos; `client_max_body_size` en nginx como primera barrera.
5. **Persistencia:** `aiosqlite` + repository pattern sin ORM; WAL + `busy_timeout=5000` + `foreign_keys=ON`; una conexión compartida creada en lifespan.
6. **Jobs largos:** `asyncio.create_task` + registro en memoria en `app.state` (guardar referencia al task); `BackgroundTasks` solo para tareas cortas post-respuesta; un solo worker de uvicorn.
7. **CORS:** lista explícita `[5173, 8080, "null"]` + `allow_origin_regex` para `app://`; `allow_credentials=False` y auth por header; validar `Origin` a mano en WS si se desea (CORS no aplica a WS).
8. **Compose:** healthcheck con one-liner de `urllib` (sin curl), `depends_on: condition: service_healthy`, socket de Docker montado (runners hermanos con límites estrictos), sin clave `version:`.

---

## Fuentes

**Versiones**
- FastAPI en PyPI (0.139.0, 2026-07-01, Python >=3.10): https://pypi.org/project/fastapi/
- FastAPI release notes (refactor router, pydantic>=2.9.0): https://fastapi.tiangolo.com/release-notes/ · https://github.com/fastapi/fastapi/releases
- Política de versiones/pinning de FastAPI: https://fastapi.tiangolo.com/deployment/versions/
- uvicorn 0.51.0 (2026-07-08; py3.10–3.14): https://pypi.org/project/uvicorn/ · https://uvicorn.dev/release-notes/
- pydantic 2.12 (2.13 beta): https://pypi.org/project/pydantic/ · https://docs.pydantic.dev/latest/changelog/ · https://pydantic.dev/articles/pydantic-v2-12-release
- sse-starlette 3.4.1: https://pypi.org/project/sse-starlette/ · https://github.com/sysid/sse-starlette

**WebSockets / SSE**
- WebSockets en FastAPI (accept, WebSocketDisconnect, ConnectionManager): https://fastapi.tiangolo.com/advanced/websockets/
- Referencia WebSocket (send_json/receive_json): https://fastapi.tiangolo.com/reference/websockets/
- Guía FastAPI WebSockets (thread-safety, run_coroutine_threadsafe, cancelación de tasks): https://websocket.org/guides/frameworks/fastapi/
- Patrón queue thread-safe para librerías no async: https://gist.github.com/vinroger/5a6a7d311168602c5b3e093f054dd481
- Productor/consumidor WS con asyncio.Queue: https://github.com/greed2411/fastapi_ws_producer_consumer
- Tutorial SSE en docs de FastAPI: https://fastapi.tiangolo.com/tutorial/server-sent-events/
- Log streaming con SSE + docker: https://amittallapragada.github.io/docker/fastapi/python/2020/12/23/server-side-events.html
- Comparativa HTTP streaming / SSE / WS: https://tech-depth-and-breadth.medium.com/comparing-real-time-communication-options-http-streaming-sse-or-websockets-for-conversational-74c12f0bd7bc

**UploadFile**
- Request Files: https://fastapi.tiangolo.com/tutorial/request-files/
- Referencia UploadFile (atributo size): https://fastapi.tiangolo.com/reference/uploadfile/

**SQLite**
- Tutorial SQL de FastAPI (SQLModel, check_same_thread): https://fastapi.tiangolo.com/tutorial/sql-databases/
- SQLite async (aiosqlite) en Python: https://dzone.com/articles/python-async-sqlite-postgresql-development
- WAL + busy_timeout best practices: https://tech-insider.org/sqlite-python-tutorial-fts5-wal-mode-2026/

**Lifespan / background / CORS**
- Lifespan events: https://fastapi.tiangolo.com/advanced/events/
- Background Tasks (y cuándo usar herramientas mayores): https://fastapi.tiangolo.com/tutorial/background-tasks/
- BackgroundTasks vs asyncio vs Celery: https://dev.to/kaushikcoderpy/python-background-tasks-asyncio-traps-fastapi-celery-2026-381i · https://github.com/fastapi/fastapi/discussions/10743
- CORS en FastAPI: https://fastapi.tiangolo.com/tutorial/cors/
- Electron file:// y Origin null: https://github.com/electron/electron/issues/1990 · https://github.com/electron/electron/issues/20730

**docker-compose**
- Healthchecks en Compose (parámetros, CMD vs CMD-SHELL): https://last9.io/blog/docker-compose-health-checks/
- Healthcheck + FastAPI + depends_on service_healthy: https://medium.com/@ntjegadeesh/implementing-health-checks-and-auto-restarts-for-fastapi-applications-using-docker-and-4245aab27ece
- Discusión oficial healthcheck en Dockerfile de FastAPI: https://github.com/fastapi/fastapi/discussions/8520
