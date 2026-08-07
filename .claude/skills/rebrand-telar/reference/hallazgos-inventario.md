# Hallazgos del inventario — dónde el encargo se quedaba corto

Verificado contra `origin/main @58295d8` el 2026-08-07. Todo lo de aquí sale de
leer el código, no de suponerlo. Los números los reproduce
`scripts/inventory.py`.

## Recuentos

El encargo traía cifras de un árbol anterior. Las reales hoy:

| Grafía | Encargo | Real | Ficheros |
|--------|---------|------|----------|
| `E-HPC` | 225 | **229** | 86 |
| `ehpc` | 354 | **440** | 82 |
| `EHPC` | 215 | **236** | 41 |
| `e-hpc` | 31 | **32** | 15 |
| `Ehpc` | — | **8** | 4 |
| rutas bajo `e-hpc/` | 543 | **518** | — |

La diferencia es que este worktree sale de `origin/main`, tres commits por
delante de `main` local (los diagramas de casos de uso). **No ajustes estas
cifras a mano: recalcula con `inventory.py`.**

## Cinco cosas que el mapa de capas original no contemplaba

### 1. `Ehpc` es una quinta grafía — y es un símbolo de TypeScript (C4)

`EhpcApi`, 8 ocurrencias. Es el nombre de la interfaz del contrato Electron:

- `desktop/types/ehpc-api.d.ts:25` — `export interface EhpcApi`
- `frontend/src/types/ehpc.d.ts:25` — idem (copia byte-idéntica)
- `desktop/src/preload.ts:6,8` — `import type { EhpcApi }`
- `docs/architecture/electron-spec.md:220,236`

Va a `TelarApi`. El neutralizador de T1 lo trata como clase Título, igual que
`E-HPC` → `Telar`.

### 2. El volumen `ehpc_data` (C3) — el que guarda la base de datos

El encargo sólo nombraba `ehpc_submissions`. Hay un segundo volumen con `name:`
explícito, y es el que contiene el SQLite:

- `compose.yaml:50,77-78`
- `desktop/resources/compose/compose.yaml:32,52-53`
- `backend/app/config.py:21` — `db_path: "~/.ehpc/ehpc.db"`, en compose `/app/data/ehpc.db`

**Consecuencia bajo D2:** renombrarlo sin migración deja atrás todo el progreso
del estudiante y el contenido editado con el modo autoría. Es aceptable porque
D2 lo acepta, pero tiene que estar escrito en el CHANGELOG y el README, no sólo
en el mensaje del commit.

Que el prefijo de Compose es un peligro real no es teórico — el daemon de esta
máquina todavía arrastra los restos de cuando lo era:

```
ehpc_data          ← el bueno, con name: explícito
e-hpc_ehpc_data    ← prefijado por el proyecto 'e-hpc'
repo_ehpc_data     ← prefijado por el proyecto 'repo'
```

### 3. Las etiquetas Docker `ehpc.runner` / `ehpc.job` (C3) — las usa el reaper

`backend/app/services/docker_service.py`:

- `:37` — `RUNNER_LABEL = "ehpc.runner"`
- `:266` — `labels={RUNNER_LABEL: "true", "ehpc.job": job_id}`
- `:334` — `filters={"label": f"{RUNNER_LABEL}=true"}` ← **el reaper de huérfanos**

Si se renombra la etiqueta mientras quedan contenedores creados con la vieja, el
reaper deja de verlos y se quedan huérfanos indefinidamente. Hay que drenarlos
**antes** de aplicar C3, y por nombre exacto: Docker es compartido con otros
procesos de esta máquina.

### 4. Una cuarta clave de localStorage (C3)

El encargo listaba tres. Son cuatro:

| Clave | Dónde |
|-------|-------|
| `ehpc-sidebar-expanded` | (sidebar) |
| `ehpc-last-lesson` | `frontend/src/stores/progressStore.ts:112` |
| `ehpc-theme` | `frontend/src/stores/themeStore.ts:39` |
| **`ehpc-learn-side`** | `frontend/src/features/learn/LearnScreen.tsx:29` |

`ehpc-learn-side` es la que faltaba. Si se queda sin renombrar, J5 pasa igual
—la preferencia sobrevive— pero por la clave vieja: quedaría marca vieja viva en
el navegador del estudiante. Sólo la caza T6.

### 5. El nombre de PROYECTO de Compose (C3) — el mismo mecanismo que BL-02

Salió en la revisión de código de la propia skill. `ehpc` **a secas**, sin punto
ni guion alrededor, en tres sitios:

- `desktop/resources/compose/compose.yaml:6` — `name: ehpc`
- `desktop/src/constants.ts:18` — `COMPOSE_PROJECT_NAME = 'ehpc'`
- `docs/architecture/electron-spec.md:410`

Es el nombre que gobierna el prefijo de todo lo que no lleve `name:` explícito
— exactamente el mecanismo del bug BL-02 que la skill documenta con tanto
cuidado para los volúmenes. Y por escribirse a secas, ninguna regla C3 basada en
`ehpc.` o `ehpc-` lo casaba: caía en C1 "prosa", el único cubo **sin smoke
test**. Corregido con una regla C3 propia en `inventory.py`.

Si `compose.yaml` y `constants.ts` se desincronizan, Electron levanta un stack y
consulta otro: `dockerStatus()` devuelve lista vacía y la app dice que no hay
nada corriendo aunque sí lo haya.

Ya existe un guardián que hay que mantener en verde: `backend/tests/test_compose_parity.py`.

### 6. Seis accesos a `window.ehpc` escritos como cast (C4)

`frontend/tests/hooks/hooks.test.tsx:25,61,127,142,154,165`:

```ts
delete (window as { ehpc?: unknown }).ehpc
```

Un grep de `window.ehpc` **no los ve** (no hay notación de punto). Son los tests
que montan y desmontan el mock del API de Electron para `usePlatform` y
`useDockerStatus`: consumidores de pleno derecho del contrato C4. Estaban
clasificados como C1 "prosa"; corregido con una regla C4 propia.

### 7. Nombres de tarea asyncio (C3, riesgo bajo)

`backend/app/services/job_runner.py:285,628,634,865` — `ehpc-drainer-`,
`ehpc-logs-`, `ehpc-stats-`, `ehpc-retain-`. Son nombres de `asyncio.Task`, sólo
visibles en trazas y depuración. Nada externo los resuelve; se renombran por
coherencia, sin riesgo.

## Dos cosas que resultaron ser MENOS graves de lo que parecía

### C5 es mucho menos peligrosa que sus 518 ficheros

Sólo **28 ocurrencias** de `e-hpc` en el CONTENIDO de los ficheros, y casi todas
en documentación (rutas absolutas de ejemplo tipo
`/mnt/d/universidad/tesis/e-hpc/frontend/`). El repo usa rutas relativas en casi
todas partes, así que `git mv e-hpc telar` mueve 518 rutas pero deja muy poco
que arreglar a mano. Los sitios reales:

- `desktop/scripts/launch-wsl.sh:9-10` — deriva `EHPC_DIR` de `dirname` (relativo:
  sobrevive al `git mv` sin tocarlo; sólo cambia el nombre de la variable, que es C2)
- `desktop/electron-builder.yml:15` — `homepage: https://github.com/jorgesierra/e-hpc`
- `Makefile:10`, `README.md` y varios `docs/architecture/*` — rutas de ejemplo

### `telar` ya existía, pero sólo 2 veces

`compose.yaml:38` y `desktop/scripts/launch-wsl.sh:48`, las dos en comentarios,
refiriéndose al CLI. Poco volumen, pero es justo lo que rompe la formulación
ingenua de T1 (ver `SKILL.md`, sección T1).

## Decisiones que este inventario obliga a tomar

1. **`mock/e-hpc-handoff/` (10 ficheros, 16 ocurrencias)** — resuelto como D5:
   no se toca. Es el export literal de claude.ai/design; su propio README
   apunta a `e-hpc/project/E-HPC.html`. Es un artefacto de procedencia de la
   fase de diseño de la tesis, y reescribirlo lo falsearía.

2. **`https://github.com/jorgesierra/e-hpc`** (`desktop/electron-builder.yml:15`)
   — **sin resolver, y es de Jorge**. Si el repositorio remoto no se renombra, la
   URL debe quedarse; si se renombra, cambia. `grep-final.py` la reporta como
   hallazgo a propósito en vez de silenciarla.

3. **`ghcr.io/python-for-hpc/pyomp`** — imagen de terceros (PyOMP upstream). No
   se toca nunca; está en la allowlist de T6.

## Estado de los baselines

- **T2 (contratos runtime):** capturado contra el stack viejo en pie, en
  `~/.telar-rebrand/snapshots/antes/`. Incluye `/openapi.json` (24 rutas, 15
  esquemas) y la secuencia WS de un job `spmd` real (11 mensajes:
  `status(creating)` → `status(compiling)` → `metrics`… → `status(completed)` →
  `eof`). Verificado estable: dos capturas del mismo stack dan un `shape/`
  byte-idéntico.
- **T3 backend:** 321 tests en verde, cobertura **91.72 %** (no el 93.79 % de
  `e-hpc/CLAUDE.md`, que es de la Fase 3).
- **T3 frontend:** sin medir en este worktree — `node_modules/` no está
  versionado y haría falta `npm ci` primero.
