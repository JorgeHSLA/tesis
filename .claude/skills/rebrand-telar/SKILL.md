---
name: rebrand-telar
description: Ejecuta y verifica el rebrand de "E-HPC" a "Telar" en el monorepo de la tesis, por capas de riesgo creciente (prosa → env vars → estado persistido → contrato Electron → rutas), con una puerta de verificación mecánica por capa. Úsala para aplicar el rebrand, para correrlo en dry-run, o para comprobar que un rebrand ya aplicado no rompió nada. Incluye el test de invariancia que demuestra que el cambio es 100 % nominal.
---

# Rebrand E-HPC → Telar

Este rebrand es **100 % nominal**: cambia cómo se escribe el nombre, y NADA más.
Ni un campo, ni un tipo, ni un endpoint, ni un mensaje WS, ni un valor por
defecto. Toda la skill está construida alrededor de esa invariante, y la
comprueba mecánicamente (T1) después de cada capa.

El riesgo real no es el texto: es que un renombrado toque un **nombre que algo
externo al repo resuelve en runtime** — un volumen Docker, una etiqueta, una
clave de localStorage, un símbolo que el preload publica en `window`. Esos
fallan en producción con los tests en verde. Por eso el orden de capas es
obligatorio y cada una tiene su puerta.

## Antes de empezar

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"   # Node 22 obligatorio
```

- **Trabaja en un worktree**, nunca en el checkout vivo (son ~825 cambios).
- **`make` no está instalado**: usa `docker compose` directamente.
- **Docker es un recurso COMPARTIDO** con otros jobs de esta máquina. Nada de
  builds, `compose` ni smoke en paralelo. **Jamás** borres contenedores o
  volúmenes con un filtro amplio (`docker rm $(docker ps -aq)`, `prune -a`):
  te llevarías por delante trabajo ajeno. Borra por nombre exacto.
- Los scripts de esta skill viven en `scripts/` y se invocan desde la raíz del
  repo.

## Decisiones fijadas

| # | Decisión | Valor |
|---|----------|-------|
| D1 | `git mv e-hpc telar` | SÍ |
| D2 | Romper el estado persistido sin migración, documentando `down -v` | SÍ |
| D3 | Renombrar `ghcr.io/jorgesierra/ehpc-*` y `edu.ehpc.desktop` | SÍ |
| D4 | Playwright ad-hoc vía MCP, sin añadir `@playwright/test` al repo | SÍ |
| D6 | Rediseñar el monograma de marca: `E` → `T` (SVG + 10 iconos binarios) | SÍ |
| D7 | Renombrar también el repositorio remoto de GitHub | SÍ |

**D5 (decidida al construir esta skill): `mock/e-hpc-handoff/` NO se toca.**
Es el export literal de claude.ai/design, un artefacto de **procedencia**: el
bundle se llamaba así cuando se exportó, y su propio README apunta a
`e-hpc/project/E-HPC.html`. Reescribirlo falsearía el registro histórico de la
fase de diseño de la tesis y dejaría el documento incoherente consigo mismo. Son
10 ficheros / 16 ocurrencias, todas fuera del runtime. Están declaradas como
falso positivo autorizado en `scripts/grep-final.py`.
Para incluirlo igualmente: quita el prefijo de `DEFAULT_EXCLUDE` en
`scripts/inventory.py` y de `ALLOWED_PATHS` en `scripts/grep-final.py`.

**`.claude/` tampoco se rebrandea**, por la misma razón que un destornillador no
se desatornilla a sí mismo: los ficheros de esta skill *hablan* de la marca
vieja — está en los patrones del detector, en la allowlist de T6 y en la prosa
que explica el mapeo. Rebrandearlos dejaría al neutralizador sin reconocer
`ehpc` y la herramienta se quedaría ciega.

**D6 — el monograma se rediseña.** El logotipo es la letra `E` suelta sobre el
naranja de marca, y pasa a `T`. Ojo: **`E` → `T` no es un cambio de marca** para
el neutralizador (ninguna de las dos letras es una grafía de marca), así que T1
lo vería como cambio de FORMA y tumbaría la capa. Por eso los 12 sitios están
declarados como **cambio de forma autorizado** en `brand-invariance.py`, con su
motivo: siguen apareciendo en el informe, pero como `AUTORIZADO`, y `--strict`
los vuelve a tratar como fallo. Detalle en §C1.

**D7 — el repositorio remoto también se renombra.** En el repo sólo hay **una**
ocurrencia real: `desktop/electron-builder.yml:15`
(`homepage: https://github.com/jorgesierra/e-hpc` → `.../telar`). Como es una
ruta en minúscula, el inventario ya la clasifica en **C5** y no hace falta
ninguna excepción: T6 la exige renombrada, que es lo correcto ahora.

Lo que **no** hace esta skill, porque no es del repo (lo haces tú en GitHub):

```bash
# 1. renombrar el repo en la web de GitHub (Settings → Repository name)
# 2. actualizar el remoto local:
git remote set-url origin git@github.com:jorgesierra/telar.git
git remote -v      # comprobar
```

GitHub deja una redirección desde el nombre viejo, así que los enlaces
publicados no se rompen de golpe — pero no dependas de ella: es cortesía, no
contrato, y desaparece si alguien crea otro repo con el nombre viejo.

## Fase A — inventario (siempre primero)

**Nunca uses una lista de ficheros escrita a mano**: se queda obsoleta al primer
commit. Recalcula:

```bash
python3 .claude/skills/rebrand-telar/scripts/inventory.py            # resumen
python3 .claude/skills/rebrand-telar/scripts/inventory.py --json     # manifiesto
python3 .claude/skills/rebrand-telar/scripts/inventory.py --layer C3 # detalle
```

Clasifica **cada ocurrencia** (no cada fichero) en su capa y su área. Un mismo
fichero cae en varias capas por razones distintas: `compose.yaml` aparece en C2
(`EHPC_*`), C3 (volúmenes) y C5 (rutas), y se toca tres veces.

El ancho del fan-out sale de aquí: **una tarea paralela por (capa, área)**, sólo
sobre los ficheros que el inventario marcó para esa capa.

## Mapa de capas

Orden **obligatorio**, un commit por capa. Cada capa pasa su puerta antes de
commitear; si la puerta falla, se arregla la capa, no se sigue.

### C1 · Prosa y marca — riesgo BAJO
`E-HPC` → `Telar` en documentación y textos de UI. Respeta las mayúsculas del
contexto. No toques `HPC` a secas: es *high-performance computing*, el término
genérico del dominio, y aparece legítimamente por todas partes.

⚠️ **Tres cosas de esta capa NO son prosa, aunque lo parezcan:**

**1. `productName: E-HPC`** (`desktop/package.json:3` y
`desktop/electron-builder.yml:7`). Electron deriva `app.getName()` de ahí, y de
ahí cuelga `app.getPath('userData')`. Cambiarlo **mueve el perfil de Chromium**
de `~/.config/E-HPC` a `~/.config/Telar` (en Windows, `%APPDATA%`). Efecto: la
app de escritorio arranca con **localStorage vacío** — tema por defecto, sidebar
plegada, sin última lección — aunque las claves de C3 estén perfectas. Si no lo
sabes, J5 falla en C1 y culpas a C3. Va acoplado a
`desktopName: E-HPC.desktop` (+ `linux.syncDesktopName`), que asocia la ventana
por `WM_CLASS`, y a los nombres de artefacto del README
(`E-HPC-<version>.AppImage`, derivados de `${productName}`).

**2. El literal de truncado** — `backend/app/routers/jobs.py:37`:

```python
_TRUNCATION_MARK = "\n--- [E-HPC] output truncado a {n} bytes ---\n"
```

Es **salida observable de `GET /jobs/{id}/output`**, no un comentario, y está
asertada byte a byte en los tests. Va en el mismo commit que sus asserts.

**3. El comentario de la línea 30 de los dos `.d.ts`** dice `del proyecto E-HPC`
y los dos ficheros deben ser **byte-idénticos**. Cambiar uno solo —aunque sea
"sólo un comentario"— hace fallar `npm run check:contract` con exit 1.

**4. El monograma (D6) — el punto ciego que ningún grep ve.** El logotipo es la
letra `E` suelta, y pasa a `T`. T6 no lo verá jamás (no hay marca en la cadena) y
T1 lo marcaría como cambio de forma, así que va por la vía de los **cambios
autorizados**. Doce sitios, y la fuente de verdad es el SVG:

| Dónde | Qué |
|-------|-----|
| `frontend/public/favicon.svg` | `<text …>E</text>` → `T` ← **fuente de verdad** |
| `frontend/src/components/shell/Sidebar.tsx:68` | `sidebar-brand-mark` `>E<` → `>T<` (`aria-hidden`: decorativo, no cambia el nombre accesible) |
| `desktop/resources/icons/{16,24,32,48,64,128,256,512}x*.png` + `icon.png` | regenerados |
| `desktop/resources/icon.ico` | regenerado (multi-resolución, para el instalador Windows) |

Cambia **sólo el SVG** y propaga con:

```bash
bash .claude/skills/rebrand-telar/scripts/regen-brand-icons.sh <raíz> --check   # ¿hay rasterizador?
bash .claude/skills/rebrand-telar/scripts/regen-brand-icons.sh <raíz>
```

⚠️ En este WSL2 **no hay ningún rasterizador instalado** (ni `rsvg-convert`, ni
ImageMagick, ni Pillow): el script lo detecta y te dice qué instalar en vez de
generar iconos corruptos en silencio. Sin ImageMagick, el `.ico` de Windows se
queda con el icono viejo. Mira los tamaños de 16 y 24 px a ojo: es donde una
letra se empasta.

Y las **~118 capturas PNG** de `docs/assets/` siguen mostrando "E-HPC" en la UI.
No rompen nada y quedan fuera del rebrand: son evidencia fechada de cómo se veía
la app. Regenerarlas es trabajo de documentación, no de este rebrand.

### C2 · Variables de entorno — riesgo MEDIO
`EHPC_*` → `TELAR_*`. **Atómico**: definición y consumo en el MISMO commit, o el
stack arranca con la configuración por defecto y parece funcionar.

Puntos de definición y consumo que van juntos:
- `backend/app/config.py:18` → `env_prefix="EHPC_"`. Son **18 nombres distintos**
  en el repo, pero el prefijo de pydantic-settings **no los gobierna todos**:
  `EHPC_DIR` y `EHPC_JPATH` son variables de shell internas
  (`launch-wsl.sh`, `smoke.sh`), `EHPC_COMPOSE_DIR`/`EHPC_DEVTOOLS`/`EHPC_API_ORIGIN`
  las lee Electron por `process.env`, y `EHPC_ADMIN_PASSWORD` sólo existe en un
  documento de diseño (`docs/architecture/fase4-autoria-design.md`) — el
  `Settings` real no tiene contraseña. Cambiar el `env_prefix` NO renombra esas;
  hay que ir una a una.
- `compose.yaml` y `desktop/resources/compose/compose.yaml`
- `backend/Dockerfile` (`EHPC_ADMIN_BUILD` es un `ARG` de build)

⚠️ El fallo más afilado de esta capa está en `backend/Dockerfile:32-33`:

```dockerfile
ARG EHPC_ADMIN_BUILD=0
RUN if [ "$EHPC_ADMIN_BUILD" != "1" ]; then   # borra el código admin del artefacto
```

Si renombras el `ARG` pero no el `$…` del `RUN` (o al revés), la variable queda
vacía, `!= "1"` es cierto **siempre**, y la imagen ADMIN se construye en
silencio como imagen de ESTUDIANTE: `/api/v1/admin/*` responde 404 y nadie ve
un error. Es la seguridad-por-ausencia de Nivel 3 fallando en silencio. El
`ARG`, el `RUN`, el `args:` de `compose.yaml` y `launch-wsl.sh` van juntos.
- `process.env.EHPC_*` en Electron
- `scripts/smoke.sh` (`EHPC_JPATH`, variable interna del propio script)
- docs de arquitectura (la tabla de `architecture.md` §10.5 es la fuente)

### C3 · Estado persistido y nombres runtime — riesgo ALTO
Aquí es donde un rebrand rompe cosas de verdad. Todo esto se resuelve **por
nombre** fuera del repo:

| Qué | De | A | Por qué importa |
|-----|----|----|-----------------|
| volumen submissions | `ehpc_submissions` | `telar_submissions` | ⚠️ abajo |
| volumen de datos | `ehpc_data` | `telar_data` | ⚠️ abajo |
| SQLite | `ehpc.db` | `telar.db` | |
| home de dev | `~/.ehpc/` | `~/.telar/` | |
| build / verify | `~/.ehpc-build/`, `~/.ehpc-verify/` | `~/.telar-*` | fuera del repo |
| imagen runner | `ehpc-runner:0.5.1` | `telar-runner:0.5.1` | |
| registry (D3) | `ghcr.io/jorgesierra/ehpc-*` | `.../telar-*` | |
| appId (D3) | `edu.ehpc.desktop` | `edu.telar.desktop` | |
| **etiquetas Docker** | `ehpc.runner`, `ehpc.job` | `telar.*` | ⚠️ abajo |
| **nombre de proyecto Compose** | `name: ehpc` | `name: telar` | ⚠️ abajo |
| contenedores / tareas | `ehpc-runner-test`, `ehpc-job-`, `-worker-`, `-run-`, `-head-01`, `-frontend`, `-backend-1`, `-desktop`, `-variant`, `-drainer-`, `-logs-`, `-stats-`, `-retain-` | `telar-*` | |
| localStorage | `ehpc-sidebar-expanded`, `ehpc-last-lesson`, `ehpc-theme`, `ehpc-learn-side` | `telar-*` | 4 claves, no 3 |

⚠️ **`ehpc_submissions` lleva `name:` explícito en `compose.yaml` A PROPÓSITO**,
para anular el prefijo de proyecto de Compose. Si se pierde, el backend escribe
en `<proyecto>_telar_submissions` y el runner monta OTRO volumen vacío: **todos**
los jobs fallan con *"no such file or directory"*. Es un bug ya corregido; no lo
re-introduzcas. Lo mismo aplica a `ehpc_data`. Comprueba después:

```bash
docker volume ls | grep telar     # deben aparecer SIN prefijo de proyecto
```

⚠️ **`ehpc_data` guarda la base de datos** (progreso, contenido de cursos).
El inventario del encargo no lo listaba: sale de `compose.yaml:77` y de
`desktop/resources/compose/compose.yaml:52`. Bajo D2 se rompe sin migración, y
eso significa que **el estudiante pierde todo su progreso**. Documéntalo en el
CHANGELOG y en el README, no sólo en el commit.

⚠️ **`name: ehpc` es el nombre de PROYECTO de Compose** — el que decide el
prefijo de todo lo que no lleve `name:` explícito. Es el mecanismo exacto del
bug BL-02. Tres sitios, y los tres van juntos:

- `desktop/resources/compose/compose.yaml:6` — `name: ehpc`
- `desktop/src/constants.ts:18` — `COMPOSE_PROJECT_NAME = 'ehpc'`
- `docs/architecture/electron-spec.md:410`

Si el `.yaml` y el `constants.ts` se desincronizan, Electron levanta un stack y
consulta OTRO: `dockerStatus()` devuelve una lista vacía y la app dice que no
hay nada corriendo aunque lo haya. Ojo: como `ehpc` va aquí a secas (sin punto
ni guion), es fácil que un clasificador lo tome por prosa — `inventory.py` tiene
una regla C3 explícita para él por ese motivo.

Buena noticia: ya existe un guardián. `backend/tests/test_compose_parity.py`
comprueba que ambos compose declaran `name:` explícito en los volúmenes
precisamente para que el prefijo de proyecto no los toque. **Ese test debe
seguir en verde después de C3** — es la red de seguridad de BL-02.

⚠️ **Las etiquetas Docker `ehpc.runner` / `ehpc.job` las usa el REAPER de
huérfanos** (`backend/app/services/docker_service.py:37,266,334`): filtra por
`label=ehpc.runner=true`. Si renombras la etiqueta con contenedores viejos aún
vivos, el reaper deja de verlos y **se quedan huérfanos para siempre**. Antes de
aplicar C3, drena los que haya —por nombre exacto, nunca por filtro amplio—:

```bash
docker ps -a --filter label=ehpc.runner=true --format '{{.Names}}'   # míralos
docker rm -f <nombre-exacto>                                        # uno a uno
```

### C4 · Contrato Electron↔frontend — riesgo ALTO
`window.ehpc` → `window.telar` (56 ocurrencias), más el símbolo TS `EhpcApi` →
`TelarApi` (8) que el encargo no listaba, y los dos ficheros del contrato.

⚠️ Hay **6 accesos más al mismo global escritos con un cast**, no con notación
de punto, en `frontend/tests/hooks/hooks.test.tsx:25,61,127,142,154,165`:

```ts
delete (window as { ehpc?: unknown }).ehpc
;(window as { ehpc?: unknown }).ehpc = { dockerStatus, dockerUp }
```

Un grep de `window.ehpc` **no los encuentra**. Son los tests que montan y
desmontan el mock del API de Electron para `usePlatform` y `useDockerStatus`: si
se quedan atrás, esos tests fallan de forma desconcertante justo cuando C4 ya
parecía terminada. `inventory.py` los clasifica en C4 con una regla propia.

Los dos ficheros del contrato:

- `desktop/types/ehpc-api.d.ts` → `telar-api.d.ts`
- `frontend/src/types/ehpc.d.ts` → `telar.d.ts`

⚠️ **`desktop/scripts/check-contract.mjs` exige que esos dos ficheros sean
BYTE-IDÉNTICOS** y tiene las rutas escritas dentro. Los dos renombrados, su
contenido y el script se cambian **en el mismo commit** o `npm run check:contract`
falla.

⚠️ **EXCEPCIÓN AUTORIZADA al congelado.** `e-hpc/CLAUDE.md` y
`frontend/CLAUDE.md` marcan `ehpc.d.ts` como contrato CONGELADO. Este rebrand es
la única excepción: cambia **sólo el nombre** del símbolo y del fichero, cero
cambios de forma (T1 lo verifica). Actualiza la regla en ambos `CLAUDE.md` para
que apunte al nombre nuevo.

⚠️ El fallo característico de esta capa **no lo ve ningún test**, y se
manifiesta de tres formas distintas según el consumidor. Si el preload publica
`telar` pero los consumidores siguen mirando `window.ehpc`:

- `frontend/src/config.ts:4` —
  `typeof window.ehpc !== 'undefined' || location.protocol === 'file:'`
  El `|| file:` **enmascara el bug en Electron de producción** (carga por
  `loadFile`), pero NO en dev (carga por `VITE_DEV_SERVER_URL`, o sea `http:`):
  ahí `isDesktop` pasa a `false`, `API_BASE` se queda en `''` y el frontend
  pide al servidor de Vite en vez de al backend. Falla sólo en dev, que es
  justo donde más se prueba.
- `frontend/src/hooks/usePlatform.ts:7` — **no tiene fallback**. Devuelve
  `'web'` dentro de la app de escritorio, y la UI se comporta como la web.
- `frontend/src/hooks/useDockerStatus.ts` — llama a `window.ehpc.dockerStatus()`.
  Aquí sí revienta, con `Cannot read properties of undefined`, y sólo se ve en
  la consola del navegador.

Preload + `.d.ts` + los tres consumidores cambian juntos. **Sólo T5 lo caza**:
compila, los tests pasan en verde y el fallo vive en runtime.

### C5 · Rutas y directorio raíz — riesgo ALTO
`git mv e-hpc telar` (518 rutas versionadas) y luego los paths escritos a mano.
Buena noticia del inventario: **sólo 28 ocurrencias de `e-hpc/` en contenido**
(casi todas en docs) — el repo usa rutas relativas casi en todas partes, así que
esta capa es mucho menos peligrosa de lo que sugieren los 518 ficheros.

Usa `git mv` (no `mv`): conserva el historial y deja el índice coherente para
que T1 case las rutas de los dos árboles.

⚠️ **C5 cambia el nombre de proyecto de Compose sin que aparezca en ningún
diff.** El `compose.yaml` raíz **no tiene clave `name:`** (verificado): Compose
lo deriva del NOMBRE DEL DIRECTORIO. Al hacer `git mv e-hpc telar`, el proyecto
pasa de `e-hpc` a `telar` por el simple hecho de moverse.

Consecuencia: los contenedores que estuvieran levantados quedan fuera del
alcance del nuevo proyecto. `docker compose down` desde el directorio nuevo **no
los ve ni los para**, siguen ocupando 8080 y 8000, y el siguiente `up` aborta
con `Bind for 127.0.0.1:8080 failed: port is already allocated`. El daemon de
esta máquina ya arrastra la prueba de este mecanismo: los volúmenes
`e-hpc_ehpc_data` y `repo_ehpc_data` son restos prefijados de despliegues
anteriores.

**Antes de C5, derriba el stack desde el directorio VIEJO:**

```bash
cd e-hpc && docker compose down     # con el nombre de proyecto viejo aún vigente
```

Y luego reconstruye desde `telar/`. Los volúmenes con `name:` explícito
(`telar_data`, `telar_submissions`) no se ven afectados por el prefijo — para
eso está el `name:`.

Revisa después: `scripts/`, `compose.yaml`, `.gitignore`, `desktop/scripts/launch-wsl.sh`
(define `EHPC_DIR`), `Makefile`, y las rutas absolutas `/mnt/d/universidad/tesis/e-hpc/…`
que aparecen en la documentación.

**La URL del repositorio (D7)** entra aquí, no en C1: es una ruta en minúscula y
el inventario la clasifica en C5. Una sola línea —
`desktop/electron-builder.yml:15` — más la acción en GitHub y el
`git remote set-url`, que no son del repo (ver §Decisiones).

## Pruebas de no-regresión

Las puertas, de más barata y potente a más cara.

### T1 · Invariancia del diff — tras CADA capa

```bash
python3 .claude/skills/rebrand-telar/scripts/selftest-invariance.py   # una vez, al empezar
python3 .claude/skills/rebrand-telar/scripts/brand-invariance.py --old <ref-capa-anterior>
```

Neutraliza la marca —**las dos**, a un token por clase de mayúsculas— en el
árbol viejo y en el nuevo, y exige que sean byte a byte idénticos, rutas
incluidas. Cualquier diferencia es un cambio de forma que se coló.

Se neutraliza en vez de "sustituir al revés" porque **`telar` YA EXISTÍA** antes
del rebrand (nombre del CLI, en `compose.yaml` y `launch-wsl.sh`): la
sustitución inversa las convertiría en `ehpc` y reportaría un diff falso.

Corre `selftest-invariance.py` **antes de fiarte de la puerta**: comprueba que
acepta 15 cambios nominales reales y que caza 7 cambios de forma escondidos
(entre ellos, romper el bind a loopback y cambiar `_` por `-` en el nombre del
volumen). Una puerta que no has visto fallar no es una puerta.

T1 **no** comprueba que el rename esté completo — eso es T6. T1 = "no cambió la
forma"; T6 = "el rename está completo". Hacen falta las dos.

### T2 · Snapshot de contratos runtime — antes y después

```bash
# ANTES de tocar nada, con el stack VIEJO en pie:
python3 .claude/skills/rebrand-telar/scripts/snapshot-contracts.py --label antes
# …rebrand…, con el stack NUEVO en pie:
python3 .claude/skills/rebrand-telar/scripts/snapshot-contracts.py --label despues
diff -ru ~/.telar-rebrand/snapshots/antes/shape ~/.telar-rebrand/snapshots/despues/shape
```

Captura `/openapi.json` entero (24 rutas, 15 esquemas), `/health`, `/system`,
catálogo, lección, quiz, un job `spmd` real y su secuencia de mensajes WS. Todo
neutralizado, con los valores volátiles (ids, tiempos, mediciones) redactados
conservando su tipo: por eso dos capturas del mismo stack salen byte-idénticas y
el `diff` sólo enseña cambios de comportamiento reales.

El snapshot se parte en tres directorios, y **la distinción es lo que hace útil
la prueba**:

| Directorio | Qué es | Se exige |
|---|---|---|
| `shape/` | contrato puro: openapi, health, system, job, secuencia WS | **idéntico byte a byte** |
| `contenido/` | catálogo, lección, quiz, progreso | sólo mirar a ojo |
| `raw/` | respuestas íntegras | referencia humana |

⚠️ **`contenido/` NO puede exigirse idéntico**, y esto no es una concesión: C3
renombra el volumen `ehpc_data` y, bajo D2, la DB se recrea desde las fixtures.
El catálogo vuelve a sus 8 módulos sembrados, el progreso se vacía y desaparece
cualquier módulo creado a mano con el modo autoría (en la DB de dev actual hay
uno: `m-3eyrhgfwywdqj`, con 9 módulos en total en vez de 8). Ese diff es
consecuencia esperada de D2, no una regresión. Mezclarlo con el contrato
inutilizaría la puerta.

Verificado: dos capturas consecutivas del **mismo** stack — cada una lanzando su
propio job real — dan un `shape/` byte-idéntico. Sin esa propiedad la prueba no
distinguiría una regresión del ruido.

**El snapshot depende del modo de despliegue**: una imagen admin expone
`/api/v1/admin/*` y una de estudiante no. Captura antes y después con el
**mismo** `EHPC_ADMIN_BUILD`/`ADMIN_MODE`, o el diff será ruido.

### T3 · Suites existentes — por capa, no sólo al final

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd <raíz>/backend && DOCKER_HOST=tcp://127.0.0.1:1 pytest --cov=app --cov-fail-under=80
cd <raíz>/frontend && npm run typecheck && npx vitest run
cd <raíz>/desktop && npm run typecheck && npm run check:contract
```

`DOCKER_HOST=tcp://127.0.0.1:1` es deliberado: apunta a un puerto muerto para
que el backend no toque el daemon real y use los fakes del `Protocol`.

**Baseline real medido en este árbol (origin/main @58295d8): 321 tests en verde,
cobertura 91.72 %.** No el 93.79 % que dice `e-hpc/CLAUDE.md`: esa cifra es de
la Fase 3 y el código ha crecido desde entonces (`content_writer`,
`seed_content`…). Usa 91.72 % como referencia a no empeorar, y **vuelve a medir
tu propio baseline antes de empezar** en lugar de fiarte de un número escrito
en un doc.

⚠️ **Un worktree recién creado no tiene entorno**: `.venv/` y `node_modules/`
están en `.gitignore`. El intérprete con las dependencias del backend vive en
`~/.ehpc-build/backend/.venv` (ext4, según la regla de builds pesados):

```bash
DOCKER_HOST=tcp://127.0.0.1:1 ~/.ehpc-build/backend/.venv/bin/python \
  -m pytest --cov=app --cov-fail-under=80
```

Ese directorio **también se renombra en C3** (`~/.ehpc-build/` → `~/.telar-build/`),
así que después de C3 esta ruta cambia. Es un directorio COMPARTIDO con otros
procesos de la máquina: no lo borres, muévelo o recréalo.

`npm run check:contract` es la puerta específica de C4.

### T4 · Smoke del stack completo — tras C2, C3 y C5

```bash
docker compose build frontend backend
docker compose --profile build build runner
bash scripts/smoke.sh
```

**En serie, nunca en paralelo con otro job.** Es la única prueba que valida de
verdad el volumen de submissions: levanta el stack, corre un job `spmd` real,
hace un ciclo de quiz y derriba.

Tras C3, y sólo tras C3, el estado viejo es inalcanzable por diseño (D2):

```bash
docker compose down -v      # borra los volúmenes de ESTE proyecto, no los ajenos
```

### T5 · Journeys de navegador (Playwright vía MCP) — tras C3 y C4

Sin instalar `@playwright/test` (D4). Con el stack en `http://127.0.0.1:8080`:

- **J1** Home → el catálogo renderiza. **No asertes "8 módulos" a ciegas**: son 8
  los sembrados desde `backend/app/content/`, pero el modo autoría puede haber
  creado más (la DB de dev de hoy tiene 9). Asertá contra lo que devuelve
  `GET /api/v1/modules` en ese momento, o contra los 8 sembrados si vienes de
  un `down -v`.
- **J2** Abrir una lección → contenido y quiz renderizan
- **J3** Editor → ejecutar el ejemplo `spmd` → llegan logs por WS y aparecen las
  métricas de hilos (valida el WS de punta a punta)
- **J4** Responder el quiz → el progreso se persiste
- **J5** Toggle de sidebar y de tema → recargar → la preferencia SOBREVIVE
  (valida las 4 claves de localStorage renombradas en C3)

En **cada** journey:
- `browser_console_messages` → **CERO** errores. `window.telar is undefined` sólo
  aparece aquí: compila, los tests pasan, y revienta en runtime. Es el fallo que
  C4 puede introducir.
- `browser_snapshot` → la cadena "E-HPC" **no** aparece en la UI.
- `browser_network_requests` → ninguna petición en 4xx/5xx.

Guarda los snapshots como evidencia.

### T6 · Grep final

```bash
python3 .claude/skills/rebrand-telar/scripts/grep-final.py
python3 .claude/skills/rebrand-telar/scripts/grep-final.py --list   # ver lo autorizado
```

Cero ocurrencias de `E-HPC|e-hpc|EHPC|ehpc`, salvo los falsos positivos
declarados **con su motivo** en el propio script. Si aparece un resto legítimo
nuevo, añádelo ahí con su justificación: esa lista es la documentación de por
qué sobrevive.

## Puerta por capa

| Momento | Puertas |
|---------|---------|
| **Antes de empezar** | `selftest-invariance.py` · **T2 `--label antes`** (necesita el stack VIEJO en pie: después ya no podrás capturarlo) · baseline de T3 |
| C1 | T1 · T3 · revisión adversarial |
| C2 | T1 · T3 · **T4** |
| C3 | T1 · T3 · **T4** · **T5** · `docker volume ls` |
| C4 | T1 · T3 (incl. `check:contract`) · **T5** |
| C5 | T1 · T3 · **T4** · T6 |
| **Al terminar** | **T2 `--label despues`** + `diff` de `shape/` · T5 completo · T6 |

T2 no es una puerta *por capa*: abarca el rebrand entero y sólo tiene sentido
comparando los dos extremos. Por eso aparece arriba y abajo, no en el medio. Y
su captura `antes` es **irrepetible**: en cuanto se toque C3 ya no hay stack
viejo que capturar.

Y en cada capa, un **revisor adversarial** que busca tres cosas:
1. ocurrencias perdidas dentro del alcance de la capa,
2. falsos positivos tocados (`HPC` genérico, citas del handoff, URLs de terceros),
3. cambios de forma colados (T1 los caza, pero el revisor explica *cuál* y *por qué*).

## Cómo NO hacerlo

- **`sed -i` global sobre todo el repo.** Destroza las capas 2–4: convierte
  `EHPC_ADMIN_MODE` y `window.ehpc` y el nombre del volumen en el mismo commit
  indistinguible, y cuando algo falle no sabrás cuál de los tres fue.
- **Renombrar la definición sin el consumo** (o al revés). El stack arranca con
  los valores por defecto y *parece* que funciona.
- **Fiarte de que los tests en verde significan que funciona.** El fallo típico
  de C4 pasa todos los tests. Sólo se ve en un navegador de verdad.
- **Tocar `simuladores/`.** El inventario no encuentra marca real ahí.
- **Borrar contenedores o volúmenes por filtro amplio.** Docker es compartido.

## Ficheros de esta skill

| Fichero | Qué hace |
|---------|----------|
| `scripts/inventory.py` | Fase A: clasifica cada ocurrencia en capa y área |
| `scripts/brand_invariance_lib.py` | el neutralizador de marca (núcleo de T1) |
| `scripts/brand-invariance.py` | T1: compara dos árboles neutralizados |
| `scripts/selftest-invariance.py` | demuestra que T1 acepta y rechaza lo que debe |
| `scripts/snapshot-contracts.py` | T2: captura y compara contratos runtime |
| `scripts/grep-final.py` | T6: restos de marca vieja, con allowlist justificada |
| `scripts/regen-brand-icons.sh` | D6: propaga el monograma del SVG a los 10 iconos |
