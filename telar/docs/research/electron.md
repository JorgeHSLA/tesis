# Investigación: Electron para Telar (estado 2025–2026)

> Fecha de investigación: 2026-07-12.
> Contexto: shell de escritorio delgado que reutiliza el MISMO build de Vite del frontend web
> (React + Vite + TS) y habla con un backend FastAPI en `localhost` (REST + WebSocket para
> logs/métricas de contenedores Docker con PyOMP).
> Entorno real: WSL2 (Ubuntu) sobre Windows, Docker 29.3.0 + Compose v5.1.0,
> **Node.js v18.20.8**, Python 3.12.3.

---

## 0. Versiones concretas verificadas (registry de npm, 2026-07-12)

| Paquete | Última versión | `engines.node` | ¿Instala con Node 18.20.8? |
|---|---|---|---|
| `electron` | **43.1.0** (2026-07-07) | `>= 22.12.0` | **NO** |
| `electron` 39.x | 39.8.10 (2026-05-05) | `>= 12.20.55` | Sí (pero 39 ya está fuera de soporte) |
| `electron-vite` | **5.0.0** | `^20.19.0 \|\| >=22.12.0` | **NO** |
| `electron-vite` 3.x | 3.1.0 | `^18.0.0 \|\| >=20.0.0` | Sí (desactualizado) |
| `electron-builder` | **26.15.3** (dist-tag `latest`; el tag `v26` apunta a 26.15.6) | `>=14.0.0` | **Sí** |
| `vite` | 8.1.4 | `^20.19.0 \|\| >=22.12.0` | NO (la 5.4.21 y la 6.4.3 sí soportan Node 18) |

Datos del runtime (de `https://releases.electronjs.org/releases.json`):

- Electron **43.1.0** → Chromium **150.0.7871.47**, Node embebido **24.18.0**.
- Electron 42.6.1 → Chromium 148, Node 24.18.0. Electron 41.10.1 → Chromium 146, Node 24.18.0.
- Electron 39.8.10 → Chromium 142, Node 22.22.1 (última major instalable con Node 18 de sistema:
  los majors 30–39 tienen `engines.node >= 12.20.55`; a partir del **major 40** exigen `>= 22.12.0`).
- Política de soporte oficial: **solo los 3 últimos majors estables** reciben parches
  (hoy: 43, 42, 41). Electron 39 ya es EOL.
  Fuente: https://www.electronjs.org/docs/latest/tutorial/electron-timelines

**Implicación clave para Telar**: con Node 18.20.8 solo se puede instalar un Electron EOL (39.x).
Node 18 en sí llegó a end-of-life el 2025-04-30. Dado que el checklist de seguridad oficial de
Electron exige "usar la versión actual de Electron" (ítem 16), la decisión correcta es
**instalar Node 22 LTS vía nvm** en WSL2:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22 && nvm alias default 22   # cumple >=22.12.0
```

Nota conceptual: el `engines.node` de `electron` aplica al **tooling de instalación/CLI**;
en runtime la app usa el Node *embebido* de Electron (24.18.0 en Electron 43), independiente
del Node del sistema. Pero como npm bloquea la instalación (EBADENGINE) y Vite 7+/electron-vite 4+
también exigen Node 20.19+/22.12+, el upgrade del Node de desarrollo es inevitable para un stack vigente.

---

## 1. electron-vite vs Vite + electron-builder "a mano"

### Qué es cada cosa

- **electron-vite** (https://electron-vite.org, v5.0.0): tool que unifica en un solo
  `electron.vite.config.ts` los 3 builds (main / preload / renderer), con HMR del renderer y
  hot-reload del main/preload, protección con bytecode V8, etc. Requiere Node 20.19+/22.12+ y
  Vite ^5 || ^6 || ^7 (peerDependency). Proyecto maduro, es la base del scaffold `create-electron` /
  `electron-vite` templates y de muchos boilerplates actuales.
- **Vite + electron-builder a mano**: el frontend se compila con el Vite que ya existe (proyecto
  web); main y preload se compilan aparte (esbuild/tsc, o directamente JS CommonJS sin build);
  `electron-builder` empaqueta.

### Recomendación para Telar: **Vite (existente) + esbuild para main/preload + electron-builder**

Razones específicas del proyecto:

1. El renderer **ya existe y ya se compila** para la web (nginx en docker-compose). electron-vite
   asume que es dueño del build del renderer; usarlo obligaría a duplicar/mover la config del
   frontend o a mantener dos pipelines de Vite. El requisito explícito es "mismo build del frontend".
2. El shell es delgado: `main.ts` (~1 ventana + 2-3 handlers IPC) y `preload.ts` (~20 líneas).
   Un `esbuild` de dos entradas lo resuelve sin framework:

   ```jsonc
   // apps/desktop/package.json (fragmento)
   {
     "main": "dist-electron/main.cjs",
     "scripts": {
       "build:electron": "esbuild src/main.ts src/preload.ts --bundle --platform=node --format=cjs --external:electron --outdir=dist-electron --out-extension:.js=.cjs",
       "dev": "npm run build:electron && electron . ",
       "dist:linux": "electron-builder --linux",
       "dist:win": "electron-builder --win"
     },
     "devDependencies": {
       "electron": "^43.1.0",
       "electron-builder": "^26.15.3",
       "esbuild": "^0.25.0"
     }
   }
   ```

3. HMR del renderer se conserva igualmente: en dev, Electron carga `http://localhost:5173`
   (dev-server de Vite del paquete web) — ver §5.
4. Menos dependencias en la cadena de build = menos superficie de fallo para la tesis.

**Cuándo sí usaría electron-vite**: si más adelante el desktop deja de ser un shell delgado
(p.ej., lógica pesada en main, múltiples ventanas/preloads, necesidad de bytecode). Con Node 22
instalado, migrar a `electron-vite@5` es directo. Con Node 18 quedaría clavado en
`electron-vite@3.1.0` + `vite@5/6` (no recomendado).

Fuentes: https://electron-vite.org/guide/ · npm registry (`engines` verificados arriba).

---

## 2. Checklist de seguridad oficial vigente (Electron 43)

Fuente única: https://www.electronjs.org/docs/latest/tutorial/security (checklist de 20 ítems).
Los relevantes para Telar (contenido remoto = solo `localhost`, contenido local = build de Vite):

| Ítem | Regla | Default actual |
|---|---|---|
| 2 | `nodeIntegration: false` en todo renderer | default desde Electron 5 |
| 3 | `contextIsolation: true` (si se desactiva, también se pierde el sandbox) | default desde Electron 12 |
| 4 | `sandbox: true` (sandboxing de proceso del SO) | default desde Electron 20 |
| 6 | **No** desactivar `webSecurity` | default `true` |
| 7 | Definir una **CSP** restrictiva (header vía `webRequest.onHeadersReceived` o `<meta>` en el HTML) | — |
| 13 | Bloquear navegación con `will-navigate` | — |
| 14 | `setWindowOpenHandler` → `deny` + `shell.openExternal` solo para URLs validadas | — |
| 15 | Nunca pasar datos controlados por el usuario a `shell.openExternal` | — |
| 17 | Validar `sender` de todo mensaje IPC | — |
| 18 | Preferir protocolo custom sobre `file://` (evita acceso unilateral a disco) | — |
| 16/19 | Mantener Electron actualizado; deshabilitar fuses innecesarios (`runAsNode`, `nodeCliInspect`) vía `@electron/fuses` | — |

### BrowserWindow recomendado hoy (explícito aunque coincida con defaults)

```ts
import { app, BrowserWindow, shell, session } from 'electron'
import path from 'node:path'

const win = new BrowserWindow({
  width: 1280,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,   // default, pero explícito
    nodeIntegration: false,   // default, pero explícito
    sandbox: true,            // default desde Electron 20
    webSecurity: true         // NUNCA false, ni siquiera "para CORS en dev"
  }
})

// Ítem 13: bloquear navegación fuera de orígenes permitidos
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',   // dev-server Vite (solo dev)
  'http://localhost:8000'    // FastAPI (si se navega, normalmente solo fetch)
])
win.webContents.on('will-navigate', (event, url) => {
  if (!ALLOWED_ORIGINS.has(new URL(url).origin)) event.preventDefault()
})

// Ítem 14/15: nuevas ventanas → navegador del sistema, solo https validado
win.webContents.setWindowOpenHandler(({ url }) => {
  const u = new URL(url)
  if (u.protocol === 'https:') setImmediate(() => shell.openExternal(url))
  return { action: 'deny' }
})
```

Anti-patrones a evitar (mismos docs): `allowRunningInsecureContent: true`,
`experimentalFeatures: true`, `enableBlinkFeatures`, exponer `ipcRenderer` "crudo" en
el preload (ver §4).

### CSP para Telar

Como el HTML se carga con `loadFile` (sin headers HTTP), la CSP va como `<meta>` en el
`index.html` del build de Vite **o** inyectada solo en la app de escritorio vía
`session.defaultSession.webRequest.onHeadersReceived`. Debe permitir el backend local
(REST + WebSocket de logs/métricas):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self' http://localhost:8000 ws://localhost:8000;
```

(Si el mismo `index.html` sirve para web y desktop, parametrizar el puerto/origen del backend;
`'unsafe-inline'` en `style-src` suele ser necesario con librerías CSS-in-JS — eliminar si no aplica.)

---

## 3. Empaquetado desde WSL2 (electron-builder 26)

Fuente: https://www.electron.build/docs/features/multi-platform-build/ · https://www.electron.build/docs/win/ · https://www.electron.build/docs/nsis/

### Windows (nsis / portable) desde Linux/WSL2 — SÍ, pero con Wine

- electron-builder **sí genera instaladores Windows desde Linux**: el binario de Electron para
  win32 se descarga precompilado; **Wine 2.0+** se usa para ejecutar las herramientas de
  Windows (NSIS que genera el `.exe` del instalador, edición de recursos del exe). El target
  `portable` también se construye con NSIS ⇒ también requiere Wine.
- **Mono 4.2+** solo hace falta para Squirrel.Windows ("NSIS doesn't require Mono") — no aplica.
- Vía sin instalar nada en el sistema: imagen Docker oficial
  **`electronuserland/builder:wine`** ("Wine + NodeJS 20. Use for Windows targets");
  existe `:wine-mono` para Squirrel. Como en Telar ya hay Docker en WSL2, esta es la ruta
  de menor fricción:

  ```bash
  docker run --rm -it \
    -v "$PWD":/project -w /project \
    electronuserland/builder:wine \
    /bin/bash -lc "npm ci && npx electron-builder --win nsis portable"
  ```

- Limitación documentada: "You cannot build for Windows using Docker if your app has native
  dependencies that don't use prebuild" — **no afecta a Telar** (shell sin módulos nativos).
- Firma de código (code signing) de Windows desde Linux es posible pero frágil; para la tesis
  se puede omitir (instalador sin firmar) y documentar el warning de SmartScreen.
- **Alternativa recomendada para el artefacto final**: empaquetar en el **host Windows**
  (Node 22 nativo + `npx electron-builder --win`), que evita Wine por completo y los problemas
  clásicos de permisos/symlinks de `/mnt/d`. WSL2 queda para dev diario; el host para el release.
- Buenas prácticas WSL2: compilar dentro del filesystem ext4 (`~/...`), no en `/mnt/d`
  (I/O 9P lento y metadatos NTFS rompen symlinks de node_modules); cachear descargas de
  Electron (`ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE`).

### Linux (para completar la matriz)

- **AppImage** (target por defecto) y **deb** se generan desde WSL2 sin Wine ni dependencias
  exóticas. También rpm, snap, pacman, tar.gz.
- Ejecutar un AppImage *dentro* de WSL2 puede requerir `--appimage-extract` (FUSE limitado);
  para probar la app en dev basta `electron .`.

### Fragmento `electron-builder.yml` propuesto

```yaml
appId: edu.telar.desktop
productName: Telar
directories:
  output: release
files:
  - dist-electron/**          # main + preload compilados
  - "!node_modules/**"
extraMetadata:
  main: dist-electron/main.cjs
extraResources:
  - from: ../frontend/dist    # MISMO build de Vite que sirve nginx
    to: app-frontend
win:
  target: [nsis, portable]    # ambos requieren Wine si se construye en Linux
nsis:
  oneClick: true
  perMachine: false
linux:
  target: [AppImage, deb]
  category: Education
```

(Con `extraResources`, el HTML queda en `process.resourcesPath + '/app-frontend/index.html'`.
Alternativa: incluirlo en `files` y cargarlo relativo a `__dirname` dentro del asar — ver §5.)

---

## 4. Patrón IPC seguro: main ejecuta `docker compose`, renderer consume

Fuente: https://www.electronjs.org/docs/latest/tutorial/ipc (patrón oficial "two-way":
`ipcMain.handle` + `ipcRenderer.invoke`) y https://www.electronjs.org/docs/latest/tutorial/context-isolation.
Regla oficial: *"We don't directly expose the whole `ipcRenderer.invoke` API for security reasons"* —
se exponen funciones concretas con `contextBridge.exposeInMainWorld`.

### main.ts — whitelist de acciones + `execFile` (nunca `exec` con string)

```ts
import { app, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Acciones cerradas: el renderer elige una CLAVE, jamás compone argumentos.
const DOCKER_ACTIONS = {
  'compose:ps':   ['compose', 'ps', '--format', 'json'],
  'compose:up':   ['compose', 'up', '-d'],
  'compose:stop': ['compose', 'stop']
} as const
type DockerAction = keyof typeof DOCKER_ACTIONS

const COMPOSE_CWD = app.isPackaged
  ? process.resourcesPath          // o ruta configurada del proyecto telar
  : process.cwd()

app.whenReady().then(() => {
  ipcMain.handle('docker:run', async (event, action: DockerAction) => {
    // Ítem 17 del checklist: validar el sender
    const frameUrl = new URL(event.senderFrame.url)
    const trusted = frameUrl.protocol === 'file:' ||
                    frameUrl.origin === 'http://localhost:5173'
    if (!trusted) throw new Error('IPC sender no autorizado')

    const args = DOCKER_ACTIONS[action]
    if (!args) throw new Error(`Acción desconocida: ${String(action)}`)

    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        cwd: COMPOSE_CWD,
        timeout: 60_000,
        windowsHide: true
      })
      return { ok: true as const, stdout, stderr }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
      return { ok: false as const, code: e.code ?? null, stderr: e.stderr ?? e.message }
    }
  })
})
```

Claves de seguridad del patrón:

- `execFile('docker', [args])` con **array fijo** ⇒ no hay shell, no hay inyección de comandos.
- El renderer solo envía una **clave de whitelist**; los argumentos viven en el main.
- Validación del `sender` (ítem 17 del checklist) antes de ejecutar.
- Timeout + resultado como objeto `{ok, stdout, stderr}` (nunca lanzar stderr crudo a UI sin sanear).
- En Windows empaquetado, `docker` resuelve al CLI de Docker Desktop (`docker.exe` en PATH);
  en dev bajo WSL2 resuelve al docker de Ubuntu. Mismo código para ambos.

### preload.ts — `contextBridge`, sin exponer `ipcRenderer`

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('telar', {
  dockerPs:   () => ipcRenderer.invoke('docker:run', 'compose:ps'),
  dockerUp:   () => ipcRenderer.invoke('docker:run', 'compose:up'),
  dockerStop: () => ipcRenderer.invoke('docker:run', 'compose:stop')
})
```

### renderer (React) — tipado + uso

```ts
// types/telar.d.ts (compartible con el paquete web; en web window.telar === undefined)
interface DockerResult { ok: boolean; stdout?: string; stderr?: string; code?: number | null }
interface Window {
  telar?: {
    dockerPs(): Promise<DockerResult>
    dockerUp(): Promise<DockerResult>
    dockerStop(): Promise<DockerResult>
  }
}

// componente
const res = await window.telar?.dockerPs()
if (res?.ok) setServices(JSON.parse(res.stdout!))
```

El `window.telar === undefined` en el navegador es además el **detector natural de plataforma**
para que el mismo build web/desktop muestre u oculte el panel "estado de servicios Docker".

---

## 5. Cargar el build de Vite en producción y el dev-server en dev

### Producción: `loadFile` (recomendado para Telar) vs servidor local

- **`win.loadFile(...)`**: cero dependencias, sin puertos abiertos, funciona dentro del asar.
  Es lo que recomienda electron-vite y la mayoría de templates actuales. Suficiente para Telar.
- **Servidor HTTP local embebido**: innecesario aquí; abre superficie de ataque (cualquier
  proceso local puede conectarse) y contradice el espíritu del ítem 18 del checklist.
- **Punto intermedio moderno**: `protocol.handle('app', ...)` sirviendo el dist con esquema
  custom `app://` — es lo que sugiere el checklist (ítem 18: preferir protocolo custom sobre
  `file://`) y resuelve las limitaciones de `file://` (history API, cookies). Documentado como
  mejora futura; para la tesis `loadFile` + HashRouter basta.

### Patrón dev/prod (main.ts)

```ts
import path from 'node:path'

const DEV_URL = process.env.ELECTRON_RENDERER_URL   // convención de electron-vite
             ?? process.env.VITE_DEV_SERVER_URL      // o la nuestra: http://localhost:5173

if (!app.isPackaged && DEV_URL) {
  win.loadURL(DEV_URL)                // dev: HMR completo del paquete web
  win.webContents.openDevTools()
} else {
  // prod: mismo dist/ del frontend web, copiado por electron-builder (extraResources)
  win.loadFile(path.join(process.resourcesPath, 'app-frontend', 'index.html'))
}
```

Es el patrón oficial de electron-vite (`!app.isPackaged && process.env['ELECTRON_RENDERER_URL']`
→ `loadURL`, si no → `loadFile('../renderer/index.html')`), fuente:
https://electron-vite.org/guide/hmr-and-hot-reloading — adaptado a que nuestro dist vive en
`resources/app-frontend` porque lo comparte el paquete web.

Script de dev sugerido (con `concurrently` o dos terminales):
`vite dev` (frontend) + `VITE_DEV_SERVER_URL=http://localhost:5173 electron .` (desktop).

### `base: './'` en Vite — obligatorio para `file://`

Vite genera por defecto URLs absolutas (`base: '/'` → `/assets/index-abc.js`), que bajo
`file://` apuntan a la raíz del disco y **rompen la carga**. La opción `base` acepta
"empty string or `./` for embedded deployment" (fuente: https://vite.dev/config/shared-options.html):

```ts
// vite.config.ts del frontend compartido
export default defineConfig({
  base: './',        // rutas relativas: funciona en nginx (subpath o raíz) Y en file://
  plugins: [react()]
})
```

`base: './'` es inocuo para el despliegue web con nginx (los assets pasan a ser relativos al
HTML), así que **un único build sirve para ambos destinos** — requisito del proyecto.

Caveats del mismo build bajo `file://`:

1. **Routing**: `BrowserRouter` (history API) no funciona con `file://` ⇒ usar `HashRouter`
   (o `createHashRouter`) en el frontend compartido, o detectar `window.location.protocol === 'file:'`.
2. **URLs del backend**: no usar rutas relativas tipo `fetch('/api/...')` (bajo `file://` no hay
   origen); centralizar `API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'`
   y `WS_BASE = 'ws://localhost:8000'`.
3. **CORS**: al cargar con `file://` el `Origin` de fetch será `null` — FastAPI debe permitirlo
   (`allow_origins=["http://localhost", "http://localhost:5173", "null"]` o middleware propio),
   o usar el esquema custom `app://` y whitelistear ese origen.
4. **Assets dinámicos**: `new URL('x.png', import.meta.url)` funciona; rutas absolutas hardcodeadas no.

---

## 6. Decisión de stack propuesta (resumen ejecutivo)

1. **Instalar Node 22 LTS vía nvm en WSL2** (Node 18 es EOL y bloquea Electron ≥40, Vite ≥7,
   electron-vite ≥4). Documentar en el README del repo.
2. **Electron `^43.1.0` + electron-builder `^26.15.3` + esbuild** para el shell; **sin
   electron-vite** (el renderer es el build del paquete web existente).
3. Frontend compartido: `base: './'`, HashRouter, `VITE_API_BASE` configurable, CSP con
   `connect-src http://localhost:8000 ws://localhost:8000`.
4. Seguridad: defaults explícitos (`contextIsolation/sandbox/webSecurity: true`,
   `nodeIntegration: false`), `will-navigate` + `setWindowOpenHandler(deny)+shell.openExternal`,
   validación de sender en IPC, whitelist de acciones docker con `execFile`.
5. Empaquetado: dev y AppImage/deb desde WSL2; instalador **NSIS/portable** con
   `electronuserland/builder:wine` en Docker (ya disponible) o build final en el host Windows.

---

## Fuentes

- Checklist de seguridad oficial: https://www.electronjs.org/docs/latest/tutorial/security
- IPC oficial (invoke/handle + contextBridge): https://www.electronjs.org/docs/latest/tutorial/ipc
- Context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Timelines / política de soporte (3 majors): https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- Releases (Chromium/Node por versión): https://releases.electronjs.org/releases.json
- electron-vite: https://electron-vite.org/guide/ · https://electron-vite.org/guide/hmr-and-hot-reloading
- electron-builder multi-plataforma (Wine, Docker `electronuserland/builder:wine`): https://www.electron.build/docs/features/multi-platform-build/
- electron-builder Windows targets: https://www.electron.build/docs/win/ · NSIS: https://www.electron.build/docs/nsis/
- Vite `base` (`'./'` para "embedded deployment"): https://vite.dev/config/shared-options.html
- Versiones/`engines` verificadas contra https://registry.npmjs.org/ (electron, electron-vite, electron-builder, vite) el 2026-07-12.
- Node 18 EOL (2025-04-30): https://nodejs.org/en/about/previous-releases
