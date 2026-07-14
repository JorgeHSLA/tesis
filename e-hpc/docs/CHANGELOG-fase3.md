# CHANGELOG — Fase 3 (implementación de E-HPC)

Resumen de lo entregado en la Fase 3 a partir del plan congelado
[`docs/architecture/implementation-plan.md`](architecture/implementation-plan.md).
Los contratos (`api-contract.md`, `data-model.md`, `architecture.md`,
`frontend-spec.md`, `electron-spec.md`) fueron la **única** interfaz entre
paquetes y no se modificaron durante la implementación.

## Modelo de ejecución

Los paquetes de trabajo (WP) se implementaron en **olas** según el grafo de
dependencias, cada archivo del repo perteneciente a exactamente un paquete:

| Ola | Paquetes |
|---|---|
| **0** | WP0 scaffold |
| **1** | WP1 backend-core · WP2 backend-jobs-runner · WP3 backend-cursos-quizzes · WP4 content-fixtures · WP5 frontend-shell-tokens · WP8 electron |
| **2** | WP6 frontend-simulator-results · WP7 frontend-home-catalog-learn · WP9 tests-backend |
| **3** | WP10 tests-frontend |
| **4** | WP11 integration-readme (este cierre) |

## Paquetes entregados

| WP | Nombre | Entregable |
|---|---|---|
| WP0 | scaffold | Estructura del monorepo, `compose.yaml` (puertos `127.0.0.1`), Dockerfiles (frontend multi-stage, backend root+socket, runner `python:3.12-slim`+`pyomp==0.5.1`), `nginx.conf`, `Makefile` (regla ext4), `config.py` con la tabla `EHPC_*`, `schemas.py` con los DTOs de todo el contrato. |
| WP1 | backend-core | DB SQLite (aiosqlite, WAL) + repositorios, lifespan, `/health` (liveness) y `/api/v1/system`, envelope genérico y catálogo de errores. |
| WP2 | backend-jobs-runner | `docker_service` (módulo aislado, sandbox de 16 capas), `job_runner` (semáforo, timeout, cancel, drainer), WebSocket por job, 6 parsers de stdout (`sweep_*`, `pair_*`, `none`). |
| WP3 | backend-cursos-quizzes | Endpoints de módulos, lecciones, quizzes (calificación en servidor, umbral 80 %) y progreso. |
| WP4 | content-fixtures | Los 14 ejemplos PyOMP (`main.py` + metadatos de catálogo), 14 lecciones Markdown y 14 quizzes JSON. |
| WP5 | frontend-shell-tokens | Design system (tokens), shell de la app (HashRouter, `base: './'`), cliente API/WS, infraestructura de estado. |
| WP6 | frontend-simulator-results | Flujo estrella: editor + simulador, logs y métricas en vivo por WS, gráficas de speedup/eficiencia. |
| WP7 | frontend-home-catalog-learn | Home con jobs recientes, catálogo de ejemplos, vista de lecciones y quizzes, mapa de progreso. |
| WP8 | electron | Shell de escritorio (Electron ^43 + esbuild + electron-builder), IPC con whitelist (`compose up/stop/ps`), CSP, compose empaquetado solo-`image:`, targets Linux (AppImage/deb) y Windows (NSIS/portable). |
| WP9 | tests-backend | Suite integral pytest con fakes del Protocol de Docker: repositorios, `job_runner`, WS, parsers, routers, contenido. |
| WP10 | tests-frontend | Suite Vitest sobre `src/ws`, `src/stores`, `src/lib`, `src/hooks`. |
| WP11 | integration-readme | `README.md` raíz, `scripts/smoke.sh` (smoke E2E), este changelog y verificación cruzada. |

## Bugs de infraestructura corregidos

Dos defectos de integración detectados al levantar el stack completo, ambos
resueltos sin tocar contratos:

1. **CORS/Origin en `127.0.0.1`.** La UI web se sirve en
   `http://127.0.0.1:8080`, que el navegador trata como un **origin distinto**
   de `http://localhost:8080`. `EHPC_ALLOWED_ORIGINS` se amplió para incluir las
   variantes `127.0.0.1` (puertos 5173 y 8080) junto a `localhost` y `null`
   (Electron `file://`). Sin esto, las llamadas `fetch`/WebSocket de la UI web
   fallaban por CORS.

2. **Nombre explícito del volumen Compose.** Por defecto, Compose prefija los
   volúmenes con el nombre del proyecto (`<proyecto>_ehpc_submissions`). El
   backend escribía en el volumen prefijado, pero pasaba al runner
   `source=ehpc_submissions` (sin prefijo) → el runner montaba **otro** volumen
   vacío y fallaba con `no such file`. Se fijó `name: ehpc_submissions` en
   `compose.yaml` para **desactivar el prefijo**; backend y runner comparten
   ahora el mismo volumen real.

## Resultados de verificación

| Verificación | Resultado |
|---|---|
| Backend E2E real (pytest `-m docker`) | Verde |
| Frontend build (`vite build`) | Verde |
| WP6/WP7 E2E por navegador | Verde |
| WP9 cobertura backend (`pytest --cov`) | **93.79 %** (criterio ≥ 80 %) |
| WP10 cobertura frontend (`vitest --coverage`) | Verde (≥ 80 % en módulos con riesgo) |
| **`scripts/smoke.sh` (WP11, E2E de todo el stack)** | **SMOKE PASS — 8/8 comprobaciones** |

El smoke E2E levanta el stack con `docker compose`, espera `/health` vía nginx,
ejecuta un job real del ejemplo `spmd` (verifica `status=="completed"` y
`parsed_timings.kind=="sweep"`), comprueba el `/output` no vacío y corre un
ciclo de quiz con calificación del servidor.
