# backend/ — FastAPI (Python 3.12)

API REST + WebSocket que lanza jobs PyOMP en contenedores Docker efímeros y sirve cursos/quizzes/progreso. Ver el contrato congelado en `../docs/architecture/api-contract.md` (manda) y el modelo de datos en `data-model.md`.

## Ejecutar / testear

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"   # (no hace falta para python, pero sí si tocas el front)
# Tests SIN daemon Docker (todo con fakes del Protocol) — copia a ext4 primero si /mnt/d va lento:
DOCKER_HOST=tcp://127.0.0.1:1 pytest --cov=app --cov-fail-under=80
uvicorn app.main:app            # arranque local (usa TELAR_DB_PATH / TELAR_JOBS_DIR propios)
```

## Mapa

- `app/main.py` — FastAPI + lifespan (DB, cliente docker inyectable, `app.state.jobs`, reaper de huérfanos, carga de contenido, CORS con `null` para Electron).
- `app/db.py` — aiosqlite: PRAGMAs (WAL, busy_timeout, foreign_keys ON) + **`write_lock` asyncio.Lock transversal** (toda escritura + commit va dentro del lock).
- `app/schema.sql`, `app/repositories/*` — repository pattern, firmas EXACTAS de data-model §5 (guard `WHERE status NOT IN (terminales)` en `finish`/`set_phase`).
- `app/services/docker_service.py` — **ÚNICO módulo que importa `docker`**. Expone `DockerServicePort` (typing.Protocol) para inyección/tests. Flags sandbox como constantes.
- `app/services/job_runner.py` — ciclo de vida del job: semáforo de concurrencia, **drainer por job** (buffer 256KB, ring-buffer+seq, fan-out a colas por-conexión lossy), puente threads(docker-py sync)→asyncio, `kill_reason` con prioridad cancel>output_limit>timeout, orden de terminación estricto.
- `app/services/output_parser.py` — 6 parsers de stdout (los ejemplos que auto-miden) + speedup/eficiencia.
- `app/routers/*` — jobs, ws, examples, lessons, quizzes, progress, modules, system.
- `app/schemas.py` — **DTOs pydantic CONGELADOS** (transcripción de api-contract.md). No editar para "arreglar" el front; el front se adapta.
- `app/services/image_upload.py` — **solo admin** (el `Dockerfile` lo borra de la imagen del estudiante): valida imágenes de las lecciones por su contenido (bytes mágicos y dimensiones, ≤2 MB, ≤4096 px, sin SVG) y calcula su ruta `imagenes/<sha256>.<ext>`. Las sube `POST /api/v1/admin/images`. `markdown_validator` solo admite imágenes de esa forma de URL (bucket de Telar).
- `app/services/course_sync.py` — `POST /api/v1/catalog/sync`: descarga del catálogo los módulos que falten. La app no trae contenido propio (desde la 1.0.10).
- `tests/fixtures/content/` — el antiguo contenido base (m1–m8), ahora solo datos de prueba y entrada de `app.tools.seed_content` en desarrollo.

## Reglas

- `docker_service` es la única frontera con Docker; el resto usa el Protocol → los tests inyectan un `FakeRunner`.
- Nunca pasar parámetros del usuario a `HostConfig` del contenedor (los flags de sandbox son constantes hardcodeadas).
- Un solo worker de uvicorn (el registro de jobs vive en memoria).
- Código no confiable: validar filename `^[A-Za-z0-9._-]{1,80}\.py$`, tamaño ≤256KB; el runner corre sin red, non-root, read-only, con límites (ver `runner/CLAUDE.md`).
- `OMP_NUM_THREADS` = `NUMBA_NUM_THREADS` = `--cpus` SIEMPRE (libomp no es cgroup-aware).
