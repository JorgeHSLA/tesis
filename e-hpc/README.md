# Telar — Simulador educativo de OpenMP con PyOMP

Telar es una plataforma educativa para **aprender OpenMP con
[PyOMP](https://github.com/Python-for-HPC/PyOMP)**. El estudiante lee lecciones
derivadas de 14 ejemplos progresivos, **ejecuta código PyOMP real** en
contenedores Docker efímeros y aislados, observa logs y métricas en vivo por
WebSocket, responde quizzes y sigue su progreso. Se distribuye en dos formas
sobre el mismo build de React:

- **Web**: `docker compose up` → UI servida por nginx en `http://127.0.0.1:8080`.
- **Escritorio**: shell de Electron (AppImage/deb en Linux, instalador NSIS en
  Windows) que gestiona el stack de Docker por el usuario.

> Este README es el documento de integración (WP11) y la guía canónica para
> clonar, ejecutar, probar y entender el sistema. Los **contratos congelados**
> (API REST/WS, modelo de datos, arquitectura, specs de frontend y Electron)
> viven en [`docs/architecture/`](docs/architecture/) y son la fuente de verdad.

---

## Índice

1. [Qué hace Telar](#1-qué-hace-e-hpc)
2. [Arquitectura](#2-arquitectura)
3. [Prerequisitos](#3-prerequisitos)
4. [Ejecutar la versión WEB](#4-ejecutar-la-versión-web)
5. [Ejecutar la versión ESCRITORIO](#5-ejecutar-la-versión-escritorio)
6. [Ejecutar los TESTS](#6-ejecutar-los-tests)
7. [Prueba de humo E2E (`scripts/smoke.sh`)](#7-prueba-de-humo-e2e-scriptssmokesh)
8. [Variables de entorno `EHPC_*`](#8-variables-de-entorno-ehpc_)
9. [Modelo de seguridad del runner](#9-modelo-de-seguridad-del-runner)
10. [Decisiones de diseño clave](#10-decisiones-de-diseño-clave)
11. [Limitaciones conocidas](#11-limitaciones-conocidas)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Qué hace Telar

| Área | Descripción |
|---|---|
| **Aprender** | 6 módulos / 14 lecciones en Markdown que van de la región paralela básica a tareas, false sharing, RNG por hilo y validación contra NumPy/BLAS. |
| **Simular** | Editor con presets del catálogo; el código PyOMP se ejecuta de verdad en un contenedor efímero. Slider de hilos, logs en vivo, métricas de CPU/memoria (`docker stats`, ~1/s) y **gráficas de speedup/eficiencia** parseadas del stdout. |
| **Evaluar** | Quizzes de opción múltiple por lección; el servidor califica, guarda el mejor score y marca la lección como superada (umbral 80 %). |
| **Seguir progreso** | Persistencia en SQLite: jobs recientes, intentos de quiz y estado de cada lección. |

Los 14 ejemplos incluyen barridos internos de hilos (1/2/4/8) que producen
series de speedup pedagógicas —por ejemplo `spmd` (π con patrón SPMD)
**demuestra que el false sharing anula el speedup** aunque haya 8 hilos.

---

## 2. Arquitectura

Un único build de React (Vite, `base: './'`, HashRouter) se sirve **tanto por
nginx (web) como por Electron (escritorio)**. El backend FastAPI orquesta los
jobs hablando con el daemon de Docker a través de un módulo aislado
(`docker_service`), y cada job corre en un contenedor efímero endurecido.

```
+-----------------+        +------------------+
|  Navegador      |  :8080 |  nginx           |
|  (build Vite)   +------->|  estáticos       |
+-----------------+        |  proxy /api /ws  |
                           +--------+---------+
+-----------------+                 | HTTP/WS
|  Electron shell |  :8000          v
|  (mismo build)  +------->+------------------+       +------------------+
+--------+--------+        |  FastAPI backend |<----->|  SQLite (WAL)    |
         | IPC whitelist   |  uvicorn 1 worker|       |  vol. ehpc_data  |
         | (compose up/    +--------+---------+       +------------------+
         |  stop/ps)                | docker-py (módulo docker_service)
         v                          v
+---------------------------------------------------------------+
|  Docker daemon (/var/run/docker.sock)                          |
|   +---------------------------------------------------------+ |
|   | runner efímero por job: ehpc-runner                     | |
|   | --network none --user 10001 --cap-drop ALL              | |
|   | --read-only + tmpfs /tmp | 512m | pids 128 | init       | |
|   | código en /work :ro (vol. ehpc_submissions, subpath)    | |
|   +---------------------------------------------------------+ |
+---------------------------------------------------------------+
```

| Componente | Tecnología | Responsabilidad |
|---|---|---|
| **Frontend** | React + Vite + TypeScript (nginx en web, Electron en desktop) | UI: home, simulador, resultados, catálogo, lecciones/quizzes |
| **Desktop shell** | Electron ^43 + electron-builder ^26 + esbuild | Carga el mismo build; IPC con whitelist cerrada para `docker compose up/stop/ps` |
| **Backend** | FastAPI + uvicorn (**1 worker**) + Python 3.12 | API REST + WebSocket, orquestación de jobs, persistencia |
| **Runner** | Imagen propia `ehpc-runner` (`python:3.12-slim` + `pyomp==0.5.1`, ~777 MB) | Ejecuta el código del estudiante; un contenedor efímero por job |
| **Persistencia** | SQLite (aiosqlite, WAL) + fixtures versionados en código | Jobs, intentos de quiz, progreso |

**Puertos, todos ligados a `127.0.0.1` (loopback):** el backend **no tiene
autenticación** y monta el socket Docker; publicarlo en `0.0.0.0` expondría
ejecución de código arbitrario a toda la LAN. Ningún puerto del stack escucha
fuera de loopback. Diagrama Mermaid completo y variante de despliegue en
[`docs/architecture/architecture.md`](docs/architecture/architecture.md) §1–§2.

---

## 3. Prerequisitos

### 3.1 Sistema operativo — WSL2 (o Linux nativo)

El proyecto se desarrolla y prueba en **WSL2 (Ubuntu) sobre Windows**, pero
cualquier Linux con Docker sirve. En WSL2, ejecutar Docker Desktop con
integración WSL2 **o** el daemon de Docker instalado dentro de la distro.

### 3.2 Docker + Compose v2

- **Docker Engine 25+** y **Docker Compose v2** (`docker compose`, no el binario
  legacy `docker-compose`). Verificar:

  ```bash
  docker --version           # Docker version 25+ (probado en 29.x)
  docker compose version     # Docker Compose version v2+ (probado en v5.1)
  ```

- El backend necesita acceso al socket `/var/run/docker.sock` (ver
  [§9](#9-modelo-de-seguridad-del-runner)).

### 3.3 Node 22 vía nvm (⚠️ Node 18 **falla**)

El frontend y el desktop exigen **Node 22** (declarado en `engines`). El default
del sistema suele ser Node 18, que dispara `EBADENGINE` en `npm ci`/`npm run`.
**Instala y activa Node 22 con [nvm](https://github.com/nvm-sh/nvm)** y cárgalo
en **cada** shell antes de tocar npm:

```bash
# instalar una vez
nvm install 22 && nvm use 22

# en CADA terminal nueva, antes de cualquier comando npm/node:
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
node --version   # v22.x
```

> Si ves `npm warn EBADENGINE Unsupported engine … required: node >=22`, estás
> en Node 18: no has cargado nvm en esa shell. Repite el `export … && nvm use 22`.

### 3.4 Python 3.12

Necesario para el backend nativo en dev y como respaldo de parseo JSON en
`scripts/smoke.sh` (si no hay `jq`). `python3 --version` → `3.12.x`.

### 3.5 Utilidades del smoke test

`curl` (obligatorio) y **`jq` _o_ `python3`** (`scripts/smoke.sh` usa `jq` si
está disponible y cae a `python3` en su ausencia; Python 3.12 ya es
prerequisito, así que el smoke corre en un WSL2 limpio sin instalar nada más).

### 3.6 Regla ext4 de WSL2 (crítica para builds npm)

El repositorio suele vivir en `/mnt/d/...` (**drvfs**: el sistema de archivos de
Windows visto desde WSL2). drvfs es **~10× más lento** y no maneja symlinks de
forma fiable. Por eso:

- **`node_modules`, `npm ci`, `tsc`, `vite build` y `pytest` pesados NUNCA se
  ejecutan sobre `/mnt/d`.** Se sincronizan a una copia en **ext4**
  (`$HOME/.ehpc-build/…` o un clon de trabajo en `~/dev/e-hpc`), se compila
  allí y sólo se copian de vuelta los artefactos (`dist/`, `package-lock.json`).
- El `Makefile` encapsula esta regla: `make build-frontend`, `make build-desktop`
  y `make dist` hacen el `rsync` a ext4, compilan y traen los artefactos.
- Manualmente, el patrón es:

  ```bash
  rsync -a --exclude node_modules --exclude dist --exclude .venv \
        /mnt/d/universidad/tesis/e-hpc/frontend/ ~/.ehpc-build/frontend/
  cd ~/.ehpc-build/frontend && \
    export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22 && \
    npm ci && npm run build
  # copia de vuelta el lock regenerado y el dist:
  cp ~/.ehpc-build/frontend/package-lock.json /mnt/d/universidad/tesis/e-hpc/frontend/
  ```

> Los **builds de Docker** no sufren esta regla en el mismo grado (el contexto
> se copia al daemon y `node_modules` se crea dentro de la imagen), por eso
> `docker compose build` funciona directamente desde `/mnt/d`, sólo que más
> lento. El `Makefile` igualmente sincroniza el contexto a ext4 para acelerar.

---

## 4. Ejecutar la versión WEB

Es la vía recomendada para un evaluador que clona el repo. Todo el stack
(frontend + backend + runner) se levanta con Docker Compose.

```bash
# desde la raíz del repo
docker compose build frontend backend      # imágenes web (primera vez: varios min)
docker compose --profile build build runner # imagen del runner (~777 MB, JIT PyOMP)
docker compose up -d                        # levanta frontend + backend
```

Abre **`http://127.0.0.1:8080`** en el navegador. El backend queda en
`http://127.0.0.1:8000` (nginx hace de proxy de `/api` y `/ws`, así que la UI
sólo necesita el `:8080`).

Para parar:

```bash
docker compose down          # detiene y elimina contenedores (conserva volúmenes)
docker compose down -v       # además borra los volúmenes (jobs, DB, submissions)
```

### `make` es **opcional**

Existe un `Makefile` (WP0) que envuelve estos comandos y aplica la regla ext4:

```bash
make build-images   # == build frontend backend + runner (contexto en ext4)
make up             # == docker compose up -d
make down           # == docker compose down
```

**Si `make` no está instalado**, usa `docker compose` directamente como arriba;
son equivalentes. El runner (`profiles: ["build"]`) **no corre como servicio**:
lo instancia el backend por la API, un contenedor efímero por job. Por eso se
construye aparte con `--profile build`.

> **Nota sobre el nombre del proyecto Compose.** Levantar desde la raíz del repo
> usa el proyecto `e-hpc`; levantar desde un clon en ext4 usa `repo`. El volumen
> `ehpc_submissions` lleva `name:` explícito en `compose.yaml`, así que **es el
> mismo volumen real en ambos casos** (ver [§10](#10-decisiones-de-diseño-clave)).
> Compose puede emitir un warning cosmético "volume already exists but was
> created for project…"; es benigno y el job se ejecuta correctamente.

---

## 5. Ejecutar la versión ESCRITORIO

El shell de Electron carga **el mismo build de Vite** y ofrece controles para
levantar/parar el stack de Docker desde la app. Todo bajo `desktop/`.

### 5.1 Desarrollo (HMR)

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
cd desktop && npm ci
npm run dev     # Vite :5173 + esbuild watch (main/preload) + Electron
```

Cambios en el renderer → HMR instantáneo. Cambios en `main.ts`/`preload.ts` →
esbuild recompila; reinicia Electron a mano (`Ctrl+C` + `npm run dev`).

### 5.2 Distribución Linux (AppImage + deb)

```bash
# recomendado: usa el Makefile (aplica la regla ext4 automáticamente)
make dist

# o manualmente, en un clon ext4 (~/dev/e-hpc o ~/.ehpc-build):
cd desktop && npm run dist:linux   # == npm run build && electron-builder --linux
```

Genera `desktop/release/Telar-<versión>.AppImage` y `.deb` (target
`[AppImage, deb]` en `electron-builder.yml`). La AppImage es portable; el `.deb`
se instala con `sudo dpkg -i` / `sudo apt install ./…deb`.

### 5.3 Distribución Windows (NSIS + portable)

El artefacto de Windows se construye de dos formas:

| Dónde | Cómo | Cuándo |
|---|---|---|
| **Contenedor Wine** (desde WSL2) | imagen `electronuserland/builder:wine` | Iteración rápida sin salir de WSL2 |
| **Host Windows** con Node 22 nativo | `npm ci && npm run dist:win` en PowerShell | Artefacto **final** (evita Wine y problemas de symlinks) |

Comando con la imagen Wine (desde WSL2, con un clon en ext4):

```bash
docker run --rm -it -v ~/dev/e-hpc:/project -w /project/desktop \
  electronuserland/builder:wine \
  /bin/bash -lc "npm ci && npm run build && npx electron-builder --win nsis portable"
```

Produce un instalador **NSIS** (`Telar Setup <versión>.exe`, one-click) y un
ejecutable **portable**.

> **Aviso SmartScreen.** El instalador **no está firmado con un certificado de
> código** (ver [§11](#11-limitaciones-conocidas)). Windows SmartScreen mostrará
> "Windows protegió su PC". Es esperado: **Más información → Ejecutar de todas
> formas**. Firmar requiere un certificado EV de pago, fuera del alcance de la
> tesis.

### 5.4 Dos modos de imágenes del desktop

El `compose.yaml` del **repo** usa claves `build:` (contextos `./frontend`,
`./backend`, `./runner`) que no existen en la máquina de un usuario que sólo
tiene el instalador. Por eso el paquete de escritorio embebe un compose
**distinto** (`desktop/resources/compose/compose.yaml`) con sólo referencias
`image:`. Las imágenes llegan por uno de **dos modos**:

| Modo | Cómo llegan las imágenes | Cuándo |
|---|---|---|
| **A — Imágenes publicadas** | `docker compose pull` implícito en `up -d` desde GHCR (tags fijos publicados al cortar release). El instalador es autosuficiente. | Distribución a terceros |
| **B — Repo clonado** (default de la tesis) | `EHPC_COMPOSE_DIR` apunta al clon; la acción compuesta `compose:up` construye el runner y levanta con `build:`. | Desarrollo y demo de la tesis |

Si el usuario instala sin red al registry y sin repo, `dockerUp` falla con
stderr saneado y el footer muestra el error + enlace a la guía (no cuelga).
Detalles en [`docs/architecture/electron-spec.md`](docs/architecture/electron-spec.md) §6.

---

## 6. Ejecutar los TESTS

### 6.1 Backend — pytest con cobertura

La suite integral (`backend/tests/`) usa **fakes** del Protocol de Docker (no
toca el daemon), así que corre sin Docker. Sigue la regla ext4 para
rendimiento:

```bash
# sincroniza a ext4 y ejecuta
rsync -a --exclude .venv --exclude __pycache__ \
      /mnt/d/universidad/tesis/e-hpc/backend/ ~/.ehpc-build/backend/
cd ~/.ehpc-build/backend
python -m pytest --cov=app --cov-fail-under=80
```

- Criterio de aceptación WP9: `--cov-fail-under=80` (última verificación
  **93.79 %**).
- **Smoke real contra Docker** (opt-in, requiere el daemon + imagen runner):

  ```bash
  python -m pytest -m docker tests/test_docker_smoke.py
  ```

### 6.2 Frontend — vitest

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
cd ~/.ehpc-build/frontend   # clon ext4 con node_modules
npm run test                # vitest run
npm run test:coverage       # con cobertura (≥80% en src/ws, stores, lib, hooks)
```

### 6.3 Suites locales por paquete

Además de `backend/tests/` (integral), cada paquete de backend dejó una suite
local de desarrollo: `backend/tests_local_wp1..wp4`. **Se ejecutan por
separado** (usan `conftest.py` homónimos sin paquete que colisionan si se
recolectan juntos):

```bash
cd ~/.ehpc-build/backend
python -m pytest tests_local_wp1
python -m pytest tests_local_wp2
# … etc.
```

### 6.4 Todo junto (opcional, con make)

```bash
make test   # pytest backend + vitest frontend
```

---

## 7. Prueba de humo E2E (`scripts/smoke.sh`)

`scripts/smoke.sh` valida **todo el stack de punta a punta** sin `make`:

```bash
bash scripts/smoke.sh              # levanta, prueba y derriba el stack
bash scripts/smoke.sh --keep-up    # deja el stack corriendo al terminar
```

Qué hace, en orden:

1. Levanta el stack con `docker compose` (construye las imágenes si faltan).
2. Espera a que **nginx sirva `/health`** en `http://127.0.0.1:8080` (con
   reintentos y timeout).
3. Confirma `runner_image_present` vía `GET /api/v1/system`.
4. Crea un **job del ejemplo `spmd`** por `curl` (`POST /api/v1/jobs`).
5. Hace *polling* de `GET /api/v1/jobs/{id}` hasta estado terminal y verifica
   `status=="completed"` y **`parsed_timings.kind=="sweep"`**.
6. Comprueba que `GET /api/v1/jobs/{id}/output` devuelve stdout **no vacío**.
7. Corre un **ciclo de quiz** (`GET quiz` → `POST attempt`) y verifica que el
   servidor devuelve un **score numérico**.
8. Imprime `SMOKE PASS`/`SMOKE FAIL` y hace `docker compose down` (salvo
   `--keep-up`).

Es **idempotente** (reusa imágenes/volúmenes) y ejecutable en un WSL2 limpio.

---

## 8. Variables de entorno `EHPC_*`

Transcripción de
[`docs/architecture/architecture.md`](docs/architecture/architecture.md) §10.5
(congelada). El backend las lee con prefijo `EHPC_` (pydantic-settings); el
`compose.yaml` fija los valores de despliegue.

| Variable | Default | Usada por |
|---|---|---|
| `EHPC_DB_PATH` | `~/.ehpc/ehpc.db` (dev) / `/app/data/ehpc.db` (compose) | `db.py` |
| `EHPC_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:8080,http://127.0.0.1:5173,http://127.0.0.1:8080,null` | CORS + validación Origin del WS |
| `EHPC_CODE_DELIVERY` | `bind` (dev) / `volume` (compose) | `docker_service` |
| `EHPC_SUBMISSIONS_VOLUME` | `ehpc_submissions` | `docker_service` (modo volume) |
| `EHPC_JOBS_DIR` | `~/.ehpc/jobs` | `docker_service` (modo bind) |
| `EHPC_RUNNER_IMAGE` | `ehpc-runner:0.5.1` | `docker_service` |
| `EHPC_MAX_TIMEOUT_S` | `120` | validación de jobs |
| `EHPC_MAX_CONCURRENT_JOBS` | `2` | semáforo del `job_runner` |
| `EHPC_MAX_CODE_BYTES` | `262144` | validación jobs/upload |
| `EHPC_MAX_OUTPUT_BYTES` | `262144` | drainer del stream |
| `EHPC_ADMIN_MODE` | `0` (**apagado ⇒ modo autoría deshabilitado**) | habilita el modo autoría del despliegue, sin login, Fase 4 (`config.py`) |
| `EHPC_COMPOSE_DIR` | — (**sólo desktop**) | shell de Electron (`electron-spec` §5.3) |

> `EHPC_ALLOWED_ORIGINS` incluye `null` deliberadamente: Electron carga el HTML
> con `file://`, cuyo `Origin` es la cadena literal `null`. El riesgo residual
> está mitigado por el bind a loopback (ver [§10](#10-decisiones-de-diseño-clave)).

### 8.1 Modo autoría de cursos (admin) — Fase 4

Un administrador puede crear/editar módulos, lecciones, quizzes y subir ejemplos
`.py` desde una interfaz nueva. El contenido de cursos vive ahora en **SQLite**
(sembrado desde los fixtures de `backend/app/content/`, que quedan como semilla
versionada); los flujos y las respuestas del estudiante **no cambian**.

> **Actualización 2026-07-26 (sin login):** el modo autoría dejó de usar
> contraseña/login/token. Ahora es una **variante de despliegue**: se gatea por
> build del frontend (`VITE_ADMIN`) + config del backend (`EHPC_ADMIN_MODE`). La
> versión estudiante no incluye la UI admin (tree-shaking) ni habilita los
> endpoints; solo los administradores usan el build/despliegue admin.

> **Actualización 2026-07-26 (Nivel 3 — dos imágenes de backend):** además del
> gate de *runtime* `EHPC_ADMIN_MODE`, el backend se empaqueta como **dos
> imágenes desde el mismo código** vía el `ARG` de Docker `EHPC_ADMIN_BUILD`
> (`backend/Dockerfile`), replicando en el backend el tree-shaking del frontend:
> - **`EHPC_ADMIN_BUILD=0`** (default) → imagen **ESTUDIANTE**: los módulos
>   admin-only (`routers/admin.py`, `routers/admin_deps.py`,
>   `services/content_writer.py`, `services/markdown_validator.py`) **no se
>   copian** al artefacto y el router no se registra, así que `/api/v1/admin/*`
>   responde **404** (la ruta no existe). **Cero código admin en la imagen**
>   (seguridad por ausencia).
> - **`EHPC_ADMIN_BUILD=1`** → imagen **ADMIN**: incluye el código admin; el
>   runtime lo sigue gateando `EHPC_ADMIN_MODE`.
>
> ```bash
> docker compose build backend                     # estudiante (ARG=0, default)
> EHPC_ADMIN_BUILD=1 docker compose build backend   # admin
> ```
> `desktop/scripts/launch-wsl.sh --admin` ya pasa `EHPC_ADMIN_BUILD=1` al
> reconstruir. El compose empaquetado del desktop usa `image:` (no `build:`):
> publica la imagen estudiante por defecto y, para autoría, una imagen construida
> con `EHPC_ADMIN_BUILD=1`. Excepción: `repositories/content_admin.py` queda en
> **ambas** imágenes porque lo usa el flujo de quiz del estudiante
> (`services/quiz_service.py`); son helpers de repositorio inertes, sin endpoints
> admin.

- **Habilitar (backend)**: define `EHPC_ADMIN_MODE=1`. Sin ella, todos los
  `/api/v1/admin/*` responden `401 UNAUTHORIZED`. Es seguro sin login porque la
  app corre en loopback y solo los admins reciben el build/despliegue admin.

  ```bash
  # dev (backend nativo):
  EHPC_ADMIN_MODE=1 uvicorn app.main:app
  # web (compose): añade `EHPC_ADMIN_MODE: "1"` al servicio backend.
  ```

- **Habilitar (frontend)**: construye el build admin con `npm run build:admin`
  (`VITE_ADMIN=1`). El build normal (`npm run build`) es el de estudiante y NO
  contiene la UI de autoría.

- **Acceder**: en el build admin, entra a autoría por el ítem **"Autoría"** del
  Sidebar (o `#/admin`). No hay pantalla de login. El admin ve la vista de
  estudiante navegando el resto del Sidebar (es la misma app).

- **Semilla / migración**: al primer arranque, si las tablas de contenido están
  vacías, el backend siembra automáticamente los 14 ejemplos + 60 preguntas desde
  los fixtures. Para re-sembrar o resetear al baseline versionado:

  ```bash
  cd backend
  python -m app.tools.seed_content            # UPSERT idempotente (no pierde ediciones)
  python -m app.tools.seed_content --prune     # además borra contenido no-baseline
  python -m app.tools.seed_content --check      # verifica fixtures ≡ DB (sale ≠0 si difieren)
  ```

- **Seguridad**: el `.py` subido por el admin es **no confiable** igual que el del
  estudiante y se ejecuta en el mismo runner sandbox (network none, non-root,
  read-only, límites) — **sin relajar nada** ([§9](#9-modelo-de-seguridad-del-runner)).
  El markdown de las lecciones se valida contra el subset permitido (sin HTML
  crudo, enlaces `http(s)`/`#`/relativos). Contrato completo:
  `docs/architecture/api-contract.md` §10 · modelo de datos: `data-model.md` §7.

---

## 9. Modelo de seguridad del runner

El código del estudiante es **no confiable por definición**. Cada job corre en
un contenedor efímero con **una capa de defensa por amenaza** (patrón
contenedor-efímero de glot.run/codapi):

| # | Flag / mecanismo | Amenaza mitigada |
|---|---|---|
| 1 | `network_mode="none"` | Exfiltración de datos, descarga de payloads, ataques a la red local/metadata |
| 2 | `user=10001` (sin shell) | Operaciones privilegiadas; archivos root en volúmenes |
| 3 | `cap_drop=["ALL"]` | Capabilities del kernel (raw sockets, mknod, chown, ptrace…) |
| 4 | `security_opt=["no-new-privileges:true"]` | Escalada vía binarios setuid/setgid |
| 5 | `read_only=True` (rootfs) | Persistencia de malware; modificación del intérprete |
| 6 | `tmpfs /tmp` `rw,noexec,nosuid,size=64m` | Escritura ilimitada a disco; `noexec` frena droppers |
| 7 | `mem_limit=512m` + `memswap_limit=512m` (sin swap) | Agotamiento de memoria; el OOM-killer mata sólo al runner |
| 8 | `pids_limit=128` | Fork bombs (cuenta procesos **y** threads del cgroup) |
| 9 | `nano_cpus`/`cpuset_cpus` = nº de hilos | Monopolizar CPU; hace pedagógico el % de CPU |
| 10 | `ulimits`: `nofile=256`, `fsize=16MB` | Agotamiento de descriptores; archivos gigantes |
| 11 | `init=True` (tini PID 1) | Zombies y procesos hijos de OpenMP tras el `kill` |
| 12 | Código montado `/work` **`:ro`** | Automodificación; escritura fuera de tmpfs |
| 13 | Timeout duro `wait(timeout)` + `kill` | Bucles infinitos (wall-clock) |
| 14 | Truncado de output a 256 KB + kill | Inundación del backend/WS; deadlock de pipe |
| 15 | Labels `ehpc.runner=true` + reaper al arranque | Contenedores huérfanos si el backend crashea |
| 16 | Imagen fija por constante; el usuario nunca influye en `HostConfig` | Inyección de parámetros a `containers.run` |

### 9.1 Riesgo documentado del socket Docker

Montar `/var/run/docker.sock` en el backend **equivale a dar root del host**:
quien controle el socket puede crear un contenedor `--privileged` con `/`
montado. Análisis de riesgo consciente:

- El código del **estudiante nunca ve el socket** (el runner **jamás** lo monta).
  La superficie es un compromiso del **propio backend** (p.ej. RCE por un bug de
  FastAPI/dependencias).
- **Mitigación arquitectónica:** todo acceso a docker-py vive en **un único
  módulo aislado** (`app/services/docker_service.py`). Imagen, flags de sandbox
  y límites son **constantes del módulo**; ninguna entrada del usuario llega a
  `HostConfig` (sólo `threads` validado `1..max` y el timeout con doble tope).
- **Mitigación de despliegue** (documentada, no default): `docker-socket-proxy`
  en red interna del compose (`DOCKER_HOST=tcp://socket-proxy:2375`, sin cambios
  de código). Limitación honesta: filtra endpoints, no payloads. Complementos
  futuros: gVisor (`runtime="runsc"`), Docker rootless.
- **Contención de daño:** todos los puertos ligados a `127.0.0.1`, así que la
  superficie no está expuesta a la red.

Detalle completo en
[`docs/architecture/architecture.md`](docs/architecture/architecture.md) §4–§5.

---

## 10. Decisiones de diseño clave

1. **Un único build de React para web y escritorio** (`base: './'`, HashRouter),
   servido por nginx **y** por Electron con `loadFile` (`file://`). *Por qué:* el
   requisito es un solo pipeline de UI; el shell es delgado (1 ventana, IPC
   mínimo). Se descartó `electron-vite` porque obligaría a duplicar el build del
   renderer.

2. **Contenedor Docker efímero por job** (patrón glot/codapi) en vez de
   Judge0/Piston con `isolate`. *Por qué:* `isolate` exige contenedor
   `privileged` + administración de cgroups —frágil sobre Docker en WSL2 y
   sobredimensionado—. El overhead de ~300 ms/contenedor es irrelevante frente a
   los segundos de JIT de PyOMP.

3. **`python:3.12-slim` + `pip install pyomp==0.5.1`** en vez de conda. *Por qué:*
   existe wheel cp312 manylinux autocontenida (trae su propio `libomp.so`);
   conda añadiría cientos de MB y otra cadena de supply.

4. **WebSocket único multiplexado por job** en vez de SSE. *Por qué:* cancelar
   por SSE exigiría endpoints aparte (`EventSource` no admite headers); WS es
   nativo en FastAPI (cero deps).

5. **SQLite + repository pattern sin ORM** (aiosqlite, WAL). *Por qué:* ~4
   tablas; SQL explícito tras interfaces de repositorio. Migrar a Postgres =
   reimplementar repositorios sin tocar la lógica.

6. **Fix de infraestructura — CORS/Origin en `127.0.0.1`.** La UI se sirve en
   `http://127.0.0.1:8080`, un **origin distinto** de `http://localhost:8080`
   para el navegador. `EHPC_ALLOWED_ORIGINS` incluye **ambas** familias
   (`localhost` **y** `127.0.0.1`, puertos 5173 y 8080) más `null` (Electron
   `file://`). Sin las variantes `127.0.0.1`, el navegador bloquearía las
   llamadas `fetch`/WS de la UI web con error de CORS.

7. **Fix de infraestructura — nombre explícito del volumen Compose.** El backend
   escribe el código del job en el volumen `ehpc_submissions` y le pasa al runner
   `source=ehpc_submissions`. Por defecto Compose **prefija** los volúmenes con
   el nombre del proyecto (`<proyecto>_ehpc_submissions`), con lo que el backend
   escribiría en el volumen prefijado y el runner montaría **otro** volumen
   vacío → `no such file`. Se fija `name: ehpc_submissions` en `compose.yaml`
   para **desactivar el prefijo**, de modo que backend y runner comparten el
   mismo volumen real.

---

## 11. Limitaciones conocidas

- **Ejemplos GPU deshabilitados.** `sumaVectoresGPU` (y `requires_gpu`) están
  presentes en el catálogo pero **desactivados** (`gpu_examples_enabled: false`
  en `/system`). El runner no expone GPU; la ruta GPU de PyOMP queda como trabajo
  futuro.
- **Instalador de Windows sin firmar.** No hay certificado de código; SmartScreen
  advertirá (ver [§5.3](#53-distribución-windows-nsis--portable)). Firmar exige
  un certificado EV de pago.
- **Backend single-worker.** uvicorn corre con **1 worker**: el registro de jobs
  y la orquestación viven en memoria de proceso (`asyncio.create_task` +
  `app.state.jobs`). Escalar a múltiples workers requeriría un broker externo
  (descartado por sobredimensionado para 1 máquina).
- **Serie de métricas en vivo no persistida.** Las muestras de `docker stats`
  (~1/s) se emiten por WebSocket **en vivo** pero **no se guardan**; sólo se
  persiste el `metrics_summary` agregado (máximos/promedios). Recargar un job
  terminado no reproduce la serie temporal completa.
- **Concurrencia acotada.** `EHPC_MAX_CONCURRENT_JOBS=2` por defecto; jobs
  adicionales encolan (tope de cola 10 → `429 TOO_MANY_JOBS`).

---

## 12. Troubleshooting

| Síntoma | Causa | Solución |
|---|---|---|
| **`npm warn EBADENGINE … required: node >=22`** | Shell en Node 18 (default del sistema) | `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22` en esa terminal. |
| **Primera ejecución de un job muy lenta / "compiling" largo** | **JIT de PyOMP/Numba** compila en la primera invocación (segundos). No es un cuelgue | Espera; ejecuciones siguientes del mismo código son rápidas. El timeout por defecto ya lo contempla. |
| **`npm ci` eterno o errores de symlink** | Ejecutar sobre `/mnt/d` (drvfs) | Sigue la **regla ext4** ([§3.6](#36-regla-ext4-de-wsl2-crítica-para-builds-npm)): `rsync` a `~/.ehpc-build/…` y compila allí. Nunca `node_modules` en `/mnt/d`. |
| **AppImage no arranca: `dlopen(): error loading libfuse.so.2`** | Falta FUSE 2 | `sudo apt install libfuse2` (o extrae con `./Telar.AppImage --appimage-extract` y ejecuta el `AppRun`). |
| **Windows: "Windows protegió su PC" (SmartScreen)** | Instalador **sin firmar** | **Más información → Ejecutar de todas formas**. Es esperado (ver [§5.3](#53-distribución-windows-nsis--portable)). |
| **`docker compose` da warning "volume already exists but was created for project…"** | Volumen `ehpc_submissions` con `name:` explícito, levantado antes desde otro directorio (proyecto Compose distinto) | **Benigno**: es el mismo volumen real; el job se ejecuta bien. Para silenciarlo, levanta siempre desde el mismo directorio o `docker compose down -v` para recrearlo. |
| **UI carga pero las llamadas fallan con error de CORS** | Origin no permitido (p.ej. abriste por un host distinto de `127.0.0.1`/`localhost`) | Usa exactamente `http://127.0.0.1:8080`. Los origins válidos están en `EHPC_ALLOWED_ORIGINS` ([§8](#8-variables-de-entorno-ehpc_)). |
| **`/system` con `runner_image_present: false` / job falla con `RUNNER_IMAGE_MISSING`** | Falta la imagen `ehpc-runner:0.5.1` | `docker compose --profile build build runner` (o `make build-runner`). |
| **`scripts/smoke.sh`: "ni jq ni python3 disponibles"** | Entorno sin `jq` ni `python3` | Instala uno de los dos; Python 3.12 ya es prerequisito ([§3.4](#34-python-312)). |

---

## Referencias

- **Contratos congelados**: [`docs/architecture/`](docs/architecture/)
  — `api-contract.md` (manda sobre schemas), `data-model.md`, `architecture.md`,
  `frontend-spec.md`, `electron-spec.md`.
- **Plan de implementación de Fase 3**:
  [`docs/architecture/implementation-plan.md`](docs/architecture/implementation-plan.md).
- **Cambios de Fase 3**: [`docs/CHANGELOG-fase3.md`](docs/CHANGELOG-fase3.md).
- **Prueba de humo E2E**: [`scripts/smoke.sh`](scripts/smoke.sh).
