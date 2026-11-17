# Telar — guía para Claude

Plataforma educativa para aprender paralelismo **OpenMP vía PyOMP**: cursos estilo Coursera + un **simulador** que ejecuta código real del estudiante en contenedores Docker aislados. Corre como **web** (nginx) Y como **app de escritorio Electron**, desde el MISMO build del frontend. Artefacto central de la tesis de Jorge (español).

**Estado (2026-11-17): app 1.0.12 y backend 1.0.5 publicados.** Mejoras S1–S8 completas (39 de los 41 casos de uso en 🟢; CU-39 y CU-40 dependen de la decisión «curso = módulo publicable») y, encima, las mejoras salidas de las pruebas de usabilidad con estudiantes (`docs/CHANGELOG-usabilidad-2026-11.md`). Tests en verde: backend 1243, frontend 1119, desktop 42 + `check:contract`. Ver `docs/CHANGELOG-mejoras.md` (y antes `CHANGELOG-fase3.md`/`-fase4.md`). Catálogo de CU: `docs/casos-de-uso.md` (41 CU, misma numeración que `docs/audits/`).

## Cómo correr

```bash
# Prerequisito en CADA shell (el Node por defecto es v18 y falla con EBADENGINE):
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"   # activa Node 22

# WEB (stack completo) — 'make' NO está instalado, usar docker compose directo:
docker compose build frontend backend && docker compose --profile build build runner
docker compose up -d          # UI en http://127.0.0.1:8080, backend en :8000
docker compose down

# Smoke E2E de todo el stack:
bash scripts/smoke.sh

# Tests backend (sin daemon Docker — usa fakes):
cd backend && DOCKER_HOST=tcp://127.0.0.1:1 pytest --cov=app --cov-fail-under=80

# Tests frontend / desktop dev:  cd frontend && npx vitest run   |   cd desktop && npm run dev
```

## Reglas de este entorno (NO obvias — respétalas)

- **Node 22 vía nvm obligatorio** (`. "$NVM_DIR/nvm.sh"` antes de node/npm). v18 rompe electron≥40 y vite≥7.
- **Builds pesados en ext4, nunca en `/mnt/d`**: rsync a `~/.telar-build/<pkg>/` y compila allí (drvfs es ~10x más lento; penaliza npm/node_modules y el JIT de Numba). El `package-lock.json` regenerado se copia de vuelta al repo.
- **`make` no está instalado**: usar `docker compose` directamente (el Makefile existe pero no se invoca con make).
- **Puertos ligados a `127.0.0.1`** (backend sin auth + socket Docker montado): no exponer en 0.0.0.0.
- **Contratos CONGELADOS** en `docs/architecture/` (`api-contract.md` manda). No modificar `backend/app/schemas.py`, `frontend/src/api/types.ts`, `frontend/src/ws/messages.ts`, `frontend/src/types/telar.d.ts`: el código se adapta al contrato, no al revés.
- **Bugs de infra ya corregidos — no re-introducir**: (1) los orígenes CORS/WS deben incluir `http://127.0.0.1:8080` (el navegador manda ese Origin, no `localhost`); (2) el volumen `telar_submissions` lleva `name:` explícito en `compose.yaml` para desactivar el prefijo de proyecto de Compose — sin eso el runner monta un volumen vacío distinto y TODOS los jobs fallan con "no such file or directory".

## Estructura

- `backend/` — FastAPI (jobs, WebSocket de logs+métricas, cursos, quizzes, SQLite). Ver `backend/CLAUDE.md`.
- `frontend/` — React+Vite+TS, mismo build para web y Electron. Ver `frontend/CLAUDE.md`.
- `runner/` — imagen Docker python:3.12-slim + pyomp 0.5.1 que ejecuta el código del estudiante. Ver `runner/CLAUDE.md`.
- `desktop/` — shell Electron seguro. Ver `desktop/CLAUDE.md`.
- `site/` — página pública de descargas (HTML+CSS+JS estáticos, sin backend ni framework). Se publica en GitHub Pages desde `telar-javeriana/telar`. Ver `site/README.md`.
- **El contenido del curso NO viaja en la app (desde la 1.0.10).** Todo vive en el catálogo de la nube (bucket `clasestelar`, se publica desde Autoría) y la app lo descarga: el frontend llama a `POST /api/v1/catalog/sync` al arrancar (`backend/app/services/course_sync.py`), que incorpora los módulos que falten. Las instalaciones ≤ 1.0.9 traían m1–m8 sembrados; la sincronización los cambia por su versión de la nube conservando el progreso. En modo admin no se descarga nada. `backend/tests/fixtures/content/` guarda el antiguo contenido base solo como datos de prueba.
- `docs/architecture/` — contratos + arquitectura (fuente de verdad). `docs/research/` — investigación de Fase 0. `docs/analysis/` — spec del handoff y de los ejemplos.
- `README.md` — documentación extensa para la memoria de tesis. `docs/CHANGELOG-fase3.md` — qué se entregó.

## Contexto de dominio

El diseño original (handoff) hablaba de clusters MPI/Slurm; la app real es **OpenMP = memoria compartida con hilos**. La UI adapta la semántica (workers→hilos, "Mensajes MPI"→sincronizaciones) manteniendo el lenguaje visual. El selector de framework queda fijo en "OpenMP · PyOMP".
