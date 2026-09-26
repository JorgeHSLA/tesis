# Telar — Especificación del shell de escritorio (Electron)

> **Estado: CONGELADO para Fase 3.** Fuente de detalle: `docs/research/electron.md`.
> Decisiones de Fase 0 que este documento implementa sin re-litigar: Electron ^43 +
> electron-builder ^26 + esbuild para `main.ts`/`preload.ts`, SIN electron-vite;
> `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; preload con
> `contextBridge` (nunca `ipcRenderer` crudo); whitelist en `will-navigate`;
> `setWindowOpenHandler` deny + `shell.openExternal` solo https; IPC con whitelist cerrada de
> acciones `docker compose` vía `execFile` sin shell; validación de `senderFrame`.
> El shell carga **EL MISMO build de Vite** que sirve nginx (`base: './'`, HashRouter).

---

## 1. Estructura del paquete

```
telar/
├─ frontend/                        # paquete web (ver frontend-spec.md) — dueño del build del renderer
│  └─ dist/                         # ÚNICO build; lo consumen nginx y electron-builder
└─ desktop/
   ├─ package.json                  # "main": "dist-electron/main.cjs"
   ├─ electron-builder.yml          # §6
   ├─ tsconfig.json                 # §2
   ├─ scripts/
   │  └─ build.mjs                  # esbuild: main.ts + preload.ts → dist-electron/*.cjs (§3)
   ├─ src/
   │  ├─ main.ts                    # ciclo de vida, BrowserWindow, carga dev/prod (§4)
   │  ├─ preload.ts                 # contextBridge → window.telar (§5)
   │  ├─ ipc-docker.ts              # whitelist de acciones compose + execFile + validación sender (§5.2)
   │  ├─ security.ts                # CSP onHeadersReceived, Referer YouTube, will-navigate, windowOpenHandler (§7)
   │  └─ constants.ts               # orígenes permitidos, rutas, nombre del compose project
   ├─ types/
   │  └─ telar-api.d.ts              # contrato TS de window.telar — se COMPARTE con frontend/src/types/telar.d.ts
   ├─ dist-electron/                # salida esbuild (gitignored)
   └─ release/                      # salida electron-builder (gitignored)
```

- `desktop/` no tiene React ni Vite: solo `electron`, `electron-builder`, `esbuild`,
  `concurrently`, `wait-on` como devDependencies. Cero dependencias de producción
  (`node_modules` no se empaqueta).
- El contrato `telar-api.d.ts` es **un solo archivo** referenciado por ambos paquetes
  (copia verificada por un test o symlink dentro del repo; en NTFS/WSL2 preferir copia +
  check en CI/test para evitar problemas de symlinks).

**Regla WSL2:** `npm ci` y builds de `desktop/` se ejecutan en el clon de trabajo en ext4
(`~/dev/telar/desktop`), no en `/mnt/d`. Cachés: `export ELECTRON_CACHE=~/.cache/electron` y
`ELECTRON_BUILDER_CACHE=~/.cache/electron-builder`.

---

## 2. tsconfig.json (desktop)

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "CommonJS",            // esbuild emite cjs; electron main es CJS
    "moduleResolution": "node",
    "strict": true,
    "noEmit": true,                  // typecheck-only; esbuild compila
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src", "types"]
}
```

`npm run typecheck` = `tsc --noEmit` (esbuild no valida tipos).

---

## 3. Build con esbuild (`scripts/build.mjs`)

```js
import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const opts = {
  entryPoints: ['src/main.ts', 'src/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',                 // Node embebido de Electron 43 = 24.18
  external: ['electron'],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },   // usada por preload.ts
}
if (process.argv.includes('--watch')) {
  const ctx = await context(opts); await ctx.watch()
} else {
  await build(opts)
}
```

Salida: `dist-electron/main.cjs` + `dist-electron/preload.cjs`.

Para que `tsc --noEmit` acepte la constante inyectada, `types/globals.d.ts`
declara: `declare const __APP_VERSION__: string`.

### package.json (scripts)

```jsonc
{
  "main": "dist-electron/main.cjs",
  "scripts": {
    "build": "node scripts/build.mjs",
    "typecheck": "tsc --noEmit",
    "dev": "concurrently -k -n web,esb,app \"npm --prefix ../frontend run dev\" \"node scripts/build.mjs --watch\" \"wait-on http://localhost:5173 dist-electron/main.cjs && cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron .\"",
    "dist:linux": "npm run build && electron-builder --linux",
    "dist:win": "npm run build && electron-builder --win"
  },
  "devDependencies": {
    "electron": "^43.1.0",
    "electron-builder": "^26.15.3",
    "esbuild": "^0.25.0",
    "concurrently": "^9",
    "wait-on": "^8",
    "cross-env": "^7",
    "typescript": "~5.6"
  }
}
```

**Ciclo dev:** `npm run dev` levanta (1) Vite dev-server del frontend en 5173 con HMR completo,
(2) esbuild en watch para main/preload, (3) Electron apuntando a `VITE_DEV_SERVER_URL`.
Cambios en renderer → HMR instantáneo; cambios en main/preload → esbuild recompila y se
reinicia Electron a mano (Ctrl+C + `npm run dev`; auto-restart es mejora opcional, no requisito).
El backend FastAPI + runner se levantan aparte con `docker compose up` (o desde la propia app,
§8).

**Ciclo prod:** `frontend` hace `vite build` (con `base:'./'`) → `frontend/dist/`;
electron-builder lo copia como `extraResources` (§6); `main.ts` hace
`loadFile(resourcesPath/app-frontend/index.html)`.

---

## 4. main.ts — flujo completo

```ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { registerDockerIpc } from './ipc-docker'
import { hardenSession, attachNavigationGuards } from './security'

const DEV_URL = process.env.VITE_DEV_SERVER_URL   // solo definido en npm run dev

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,                            // evitar flash blanco; show en ready-to-show
    backgroundColor: '#FDF8EE',             // --cream-50 (v1) — coherente con la app
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,               // explícito aunque sea default
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  attachNavigationGuards(win)               // §7.2
  if (!app.isPackaged && DEV_URL) {
    win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(process.resourcesPath, 'app-frontend', 'index.html'))
    // HashRouter ⇒ las rutas viven tras '#', loadFile no necesita ajustes por ruta
  }
  return win
}

app.whenReady().then(() => {
  hardenSession()                            // CSP + permission handler, §7.1
  registerDockerIpc()                        // §5.2
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

Notas:
- **Single instance lock**: `app.requestSingleInstanceLock()`; segunda instancia enfoca la
  ventana existente (evita dos apps peleando por el mismo compose).
- El menú de aplicación se reduce a `Menu.setApplicationMenu(null)` en prod (atajos de
  copiar/pegar siguen funcionando vía roles del menú mínimo en macOS; en Win/Linux null es
  suficiente para MVP). DevTools deshabilitadas en prod (no abrir; además fuses §7.3).

---

## 5. API `window.telar` (contextBridge) y su IPC

### 5.1 Contrato TS (`types/telar-api.d.ts` — compartido con el frontend)

```ts
export interface ComposeService {
  name: string                                // p.ej. 'telar-backend-1'
  service: string                             // 'backend' | 'web' | ...
  state: 'running' | 'exited' | 'restarting' | 'paused' | 'created' | 'dead'
  health?: 'healthy' | 'unhealthy' | 'starting'
}

export interface DockerStatusResult {
  ok: boolean                                 // false = docker/compose no disponible o error
  services: ComposeService[]                  // [] si ok === false
  error?: string                              // mensaje saneado para UI
}

export interface DockerActionResult {
  ok: boolean
  error?: string                              // stderr saneado (primeras ~500 chars)
}

export interface TelarApi {
  /** Versión de la app de escritorio (package.json). */
  readonly appVersion: string
  /** Plataforma del SO: 'win32' | 'linux' | 'darwin'. */
  readonly platform: NodeJS.Platform
  /** `docker compose ps --format json` del proyecto Telar. */
  dockerStatus(): Promise<DockerStatusResult>
  /** `docker compose up -d` (backend + web + build de runner si falta). */
  dockerUp(): Promise<DockerActionResult>
  /** `docker compose stop`. */
  dockerStop(): Promise<DockerActionResult>
  /** Abre una URL https en el navegador del sistema. Rechaza cualquier otro esquema. */
  openExternal(url: string): Promise<void>
}

declare global {
  interface Window { telar?: TelarApi }         // undefined en el build web = detector de plataforma
}
```

### 5.2 preload.ts

```ts
import { contextBridge, ipcRenderer } from 'electron'

// NUNCA se expone ipcRenderer; solo funciones concretas que invocan canales fijos.
contextBridge.exposeInMainWorld('telar', {
  appVersion: __APP_VERSION__,               // inyectada por esbuild define
  platform: process.platform,
  dockerStatus: () => ipcRenderer.invoke('docker:run', 'compose:ps'),
  dockerUp:     () => ipcRenderer.invoke('docker:run', 'compose:up'),
  dockerStop:   () => ipcRenderer.invoke('docker:run', 'compose:stop'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
})
```

### 5.3 ipc-docker.ts — whitelist cerrada + execFile + validación de sender

```ts
import { app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

// Acciones CERRADAS: el renderer solo elige una clave; los argumentos viven aquí.
// 'compose:up' es COMPUESTA: en modo repo (TELAR_COMPOSE_DIR → clon con build:)
// primero construye la imagen runner (perfil 'build', que `up` ignoraría) y
// luego levanta; en modo empaquetado (§6.1, compose solo-image:) el build de
// runner es un no-op inmediato porque el servicio no tiene clave build.
const DOCKER_ACTIONS: Record<string, string[][]> = {
  'compose:ps':   [['compose', 'ps', '--format', 'json']],
  'compose:up':   [['compose', '--profile', 'build', 'build', 'runner'],
                   ['compose', 'up', '-d']],
  'compose:stop': [['compose', 'stop']],
} as const
type DockerAction = keyof typeof DOCKER_ACTIONS
// El handler ejecuta los arrays EN SECUENCIA (execFile por cada uno, mismo cwd);
// si un paso falla, devuelve { ok:false } con el stderr saneado de ese paso.

// Dónde vive el compose.yaml: junto a los recursos empaquetados o configurable.
// Prod: se empaqueta un compose.yaml de despliegue en resources/ (extraResources §6).
// Dev:  cwd del repo. Override por env TELAR_COMPOSE_DIR (documentado en README).
function composeCwd(): string {
  if (process.env.TELAR_COMPOSE_DIR) return process.env.TELAR_COMPOSE_DIR
  return app.isPackaged ? path.join(process.resourcesPath, 'compose') : path.resolve(process.cwd(), '..')
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame) throw new Error('IPC sin frame')
  const url = new URL(frame.url)
  const trusted =
    url.protocol === 'file:' ||                          // prod: loadFile
    url.origin === 'http://localhost:5173'               // dev: Vite
  if (!trusted || frame !== event.sender.mainFrame) {    // solo el frame principal
    throw new Error('IPC sender no autorizado')
  }
}

export function registerDockerIpc(): void {
  ipcMain.handle('docker:run', async (event, action: unknown) => {
    assertTrustedSender(event)
    const args = DOCKER_ACTIONS[action as DockerAction]
    if (!args) return { ok: false, error: 'Acción no permitida' }
    try {
      let stdout = ''
      for (const step of args) {             // §5.3: acciones = secuencia de pasos
        ;({ stdout } = await execFileAsync('docker', [...step], {
          cwd: composeCwd(),
          timeout: 600_000,                  // el build del runner (~777MB) tarda minutos
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        }))
      }
      if (action === 'compose:ps') return { ok: true, services: parseComposePs(stdout) }
      return { ok: true }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string }
      const msg = e.code === 'ENOENT'
        ? 'Docker no está instalado o no está en el PATH'
        : (e.stderr ?? e.message).slice(0, 500)
      return action === 'compose:ps'
        ? { ok: false, services: [], error: msg }
        : { ok: false, error: msg }
    }
  })

  ipcMain.handle('shell:open-external', async (event, url: unknown) => {
    assertTrustedSender(event)
    if (typeof url !== 'string') throw new Error('URL inválida')
    const u = new URL(url)                    // lanza si no parsea
    if (u.protocol !== 'https:') throw new Error('Solo se permiten URLs https')
    await shell.openExternal(u.toString())
  })
}

// `docker compose ps --format json` emite un objeto JSON por línea (NDJSON) en Compose v2+.
function parseComposePs(stdout: string): ComposeService[] {
  return stdout.split('\n').filter(Boolean).flatMap(line => {
    try {
      const j = JSON.parse(line)
      return [{ name: j.Name, service: j.Service, state: (j.State ?? '').toLowerCase(),
                health: j.Health ? j.Health.toLowerCase() : undefined }]
    } catch { return [] }
  })
}
```

Propiedades de seguridad del patrón: sin shell (array fijo de args → no hay inyección),
whitelist cerrada (el renderer no compone comandos), sender validado (protocolo + frame
principal), timeout, stderr saneado y truncado antes de llegar a UI, `openExternal`
solo https construida con `new URL` (ítems 13-17 del checklist oficial).

---

## 6. electron-builder.yml

```yaml
appId: edu.telar.desktop
productName: Telar
directories:
  output: release
files:
  - dist-electron/**
  - package.json
extraMetadata:
  main: dist-electron/main.cjs
extraResources:
  - from: ../frontend/dist            # el MISMO build de Vite que sirve nginx
    to: app-frontend
  - from: resources/compose           # compose.yaml de despliegue local (backend+web+runner)
    to: compose
asar: true

win:
  target: [nsis, portable]
  icon: resources/icon.ico
nsis:
  oneClick: true
  perMachine: false
  deleteAppDataOnUninstall: false

linux:
  target: [AppImage, deb]
  icon: resources/icons               # png 256/512
  category: Education
  maintainer: Jorge Sierra <jorgesierralaiton@gmail.com>
  synopsis: Simulador educativo de OpenMP con PyOMP
```

### 6.1 El compose empaquetado (`desktop/resources/compose/compose.yaml`)

**El compose del repo NO se puede empaquetar tal cual**: sus claves `build:`
apuntan a contextos (`./frontend`, `./backend`, `./runner`) que no existen
bajo `process.resourcesPath` en una máquina con solo el instalador. El
compose de despliegue empaquetado es un archivo DISTINTO, sin ninguna clave
`build:`, con referencias `image:` a tags fijos.

Además, el despliegue de escritorio es **solo Electron**: el compose empaquetado
**NO** incluye el servicio `frontend`/nginx. Electron carga la UI desde disco
(`loadFile` sobre el recurso empaquetado `app-frontend` → `file://`, §4/§6) y
habla directo al backend en `127.0.0.1:8000` (`config.ts` resuelve la base del
API en runtime, §9), así que un nginx sirviendo estáticos + proxy sería
redundante. El compose solo levanta `backend`; `runner` queda en el perfil
`build` (que `up` ignora):

```yaml
# desktop/resources/compose/compose.yaml — solo image:, cero build:
name: telar
services:
  backend:
    image: ghcr.io/jorgesierra/telar-backend:1.0.0
    ports: ["127.0.0.1:8000:8000"]
    # … (mismo environment/volumes que architecture.md §2.2)
  runner:
    image: ghcr.io/jorgesierra/telar-runner:0.5.1
    profiles: ["build"]        # nunca corre como servicio; `up` lo ignora
    entrypoint: ["true"]
volumes:
  telar_data:
  telar_submissions:
    name: telar_submissions   # sin prefijo de proyecto — igual que el compose raíz (BL-02)
```

Estrategia de distribución de imágenes (dos modos, ambos documentados en el
README; el instalador solo es autosuficiente en el modo A):

| Modo | Cómo llegan las imágenes | Cuándo |
|---|---|---|
| **A — Imágenes publicadas** | `docker compose pull` implícito en `up -d` desde GHCR (tags fijos; se publican con `make publish-images` al cortar release). El backend necesita además la runner localmente: el paso `pull runner` se cubre etiquetando la imagen GHCR como `TELAR_RUNNER_IMAGE` en el environment del backend | Distribución del instalador a terceros |
| **B — Repo clonado** | `TELAR_COMPOSE_DIR` apunta al clon (compose del repo con `build:`); la acción `compose:up` compuesta (§5.3) construye el runner y levanta | Desarrollo y demo de la tesis (modo por defecto documentado) |

Si el usuario instala el paquete sin red al registry y sin repo, `dockerUp`
falla con stderr saneado y el footer muestra el error + link a la guía
(`openExternal`) — comportamiento definido, no un cuelgue.

Matriz de empaquetado (de electron.md §3):

| Target | Dónde se construye | Requisitos |
|---|---|---|
| linux AppImage + deb | WSL2 directamente (`npm run dist:linux`) | ninguno extra |
| win nsis + portable | contenedor `electronuserland/builder:wine` (Docker ya disponible) o build final en el host Windows con Node 22 nativo | Wine (en la imagen) |

Comando Windows desde WSL2 (documentado en README):

```bash
docker run --rm -it -v ~/dev/telar:/project -w /project/desktop \
  electronuserland/builder:wine \
  /bin/bash -lc "npm ci && npm run build && npx electron-builder --win nsis portable"
```

Nota: el build de Windows del artefacto FINAL se recomienda en el host Windows (evita Wine y
problemas de symlinks); WSL2 + imagen wine vale para iteración.

### 6.2 Limpieza de Docker al desinstalar

Al desinstalar Telar (no al actualizar), el instalador para y borra el
contenedor y las imágenes Docker de la app: `docker compose --profile build
down --rmi all` contra el compose empaquetado (§6.1). Deliberadamente
**sin `-v`**: los volúmenes (`telar_data` con el progreso de quizzes,
`telar_submissions`) no se tocan — es una decisión independiente de
`deleteAppDataOnUninstall`, que solo gobierna `%APPDATA%`, no Docker.

Cada plataforma engancha esto en el punto correcto del gestor de paquetes,
verificado leyendo el código fuente de electron-builder (no solo su docs):

| Plataforma | Mecanismo | Archivo | Corre... |
|---|---|---|---|
| Windows (NSIS) | `nsis.include` → macro `customUnInstall` | `resources/installer.nsh` | ANTES de borrar `$INSTDIR` (confirmado en `uninstaller.nsh` de electron-builder: el macro se inserta antes del borrado de archivos) |
| Linux (`.deb`) | `deb.fpm: ["--before-remove=…"]` → prerm de dpkg | `resources/before-remove.sh` | ANTES de que dpkg borre los archivos del paquete (electron-builder no tiene un campo con nombre propio para esto — su `LinuxTargetSpecificOptions` solo declara `afterInstall`/`afterRemove`; se pasa como flag crudo de fpm) |

En los dos casos hay que distinguir una desinstalación real de una
ACTUALIZACIÓN, porque electron-builder/dpkg invocan el mismo gancho también
cuando una versión nueva se instala encima:

- NSIS: `${isUpdated}` — la misma variable que electron-builder ya usa en su
  lógica de `KEEP_APP_DATA`; se pone en verdadero cuando el instalador nuevo
  invocó este desinstalador en silencio con `--updated`.
- dpkg: `$1` — prerm recibe `remove` en una desinstalación real y
  `upgrade <version-nueva>` cuando una versión nueva se instala encima.

Sin esa comprobación, cada actualización pararía y borraría los contenedores
e imágenes que la versión nueva necesita segundos después: el usuario vería
"preparando entorno…" y una descarga de ~1 GB en cada actualización, no solo
en la primera instalación.

**Sin gancho posible en AppImage ni en el `.exe` portable de Windows**: son
un solo archivo sin instalador ni desinstalador, y por diseño no tocan nada
fuera de sí mismos ("no instala nada" es justo lo que se documenta en las
notas de release). Un usuario de esas variantes que quiera limpiar Docker lo
hace a mano (§10, limitación nueva).

---

## 7. Seguridad

### 7.1 CSP inyectada vía `onHeadersReceived` (`security.ts`)

El HTML se carga con `loadFile` (sin headers HTTP), así que la CSP se inyecta en la sesión —
solo en la app de escritorio, sin tocar el build web (nginx puede definir la suya propia):

```ts
import { session } from 'electron'

const API_ORIGIN = process.env.TELAR_API_ORIGIN ?? 'http://localhost:8000'
const WS_ORIGIN  = API_ORIGIN.replace(/^http/, 'ws')

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",       // estilos inline puntuales (SVG/anchos dinámicos)
  "img-src 'self' data:",
  // @fontsource = self-hosted, sin red; `data:` porque Vite inlinea los
  // subsets pequeños de fuentes (< assetsInlineLimit) como data:font/woff2
  // en el CSS y sin él la CSP los bloquea en file://
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} ${WS_ORIGIN}` +
    (process.env.VITE_DEV_SERVER_URL ? ' http://localhost:5173 ws://localhost:5173' : ''),
  // Los videos de las lecciones son embeds de YouTube NO LISTADO (URLs, nunca
  // .mp4 descargados), así que el reproductor es un <iframe> a un origen
  // externo. Con `default-src 'self'` y sin `frame-src`, ese iframe se bloquea.
  // Se admite EXCLUSIVAMENTE el dominio nocookie de YouTube: es el modo sin
  // cookies de seguimiento y deja fuera el resto de youtube.com.
  // `resolveYouTubeEmbed` (frontend) normaliza toda URL de video a este origen
  // y descarta cualquier otra, así que el iframe nunca recibe una URL arbitraria
  // del catálogo remoto. Los dos controles son independientes a propósito:
  // el frontend valida el contenido, la CSP acota el daño si esa validación falla.
  "frame-src https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function hardenSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!debeAplicarCsp(details)) return cb({})          // ver «Alcance de la CSP»
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: YOUTUBE_URL_PATTERNS },                      // ver «Referer para YouTube»
    (details, cb) => cb({ requestHeaders: cabecerasYouTube(details.url, details.requestHeaders) }),
  )
  // Denegar TODOS los permisos del navegador (cámara, geoloc, notificaciones…):
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}
```

**Alcance de la CSP.** `onHeadersReceived` ve TODO el tráfico de la sesión, incluido el del
iframe de YouTube. La CSP de Telar se aplica solo a los documentos propios de la app —
`file://`, el origen de `VITE_DEV_SERVER_URL` en dev, y cualquier `mainFrame`— y NUNCA a un
`subFrame` ni a respuestas de otros orígenes (`debeAplicarCsp`). Antes se aplicaba a todo, y el
reproductor de youtube-nocookie recibía `script-src 'self'`/`font-src 'self' data:`: sus
scripts inline, fuentes y video quedaban bloqueados y el iframe mostraba «An error occurred».
Qué se puede incrustar lo sigue acotando `frame-src` de la CSP del documento de la app.

**Referer para YouTube.** En la app instalada la página es `file://` y Chromium no manda
`Referer` al iframe; YouTube rechaza los embeds sin Referer («Video player configuration
error», error 153). `onBeforeSendHeaders`, filtrado SOLO a `https://*.{youtube-nocookie.com,
youtube.com, ytimg.com, googlevideo.com, ggpht.com}/*`, añade
`Referer: https://telar-javeriana.github.io/` (la página pública del proyecto, solo el origen,
como haría `strict-origin-when-cross-origin`) cuando la petición no trae uno (`cabecerasYouTube`).
Ninguna otra petición se toca (backend local incluido). En dev la página es http://localhost y
el navegador ya manda su propio Referer, que no se pisa.

La prueba real de ambos puntos es `desktop/scripts/check-youtube-embed.mjs` (necesita red y
pantalla; no forma parte de los tests automáticos): carga el iframe de LessonMedia con la misma
seguridad que la app, por `loadFile` y por http://localhost, y comprueba que el video avanza.

### 7.2 Guardas de navegación (`security.ts`)

```ts
const ALLOWED_NAV_ORIGINS = new Set([
  'http://localhost:5173',                   // dev
  // prod: la app vive en file:// — cualquier http(s) externo se bloquea
])

export function attachNavigationGuards(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event, url) => {
    const u = new URL(url)
    const sameFile = u.protocol === 'file:'  // HashRouter no navega, pero por si acaso
    if (!sameFile && !ALLOWED_NAV_ORIGINS.has(u.origin)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:') setImmediate(() => shell.openExternal(u.toString()))
    } catch { /* URL inválida: ignorar */ }
    return { action: 'deny' }                // NUNCA se crean ventanas nuevas
  })
  win.webContents.on('will-attach-webview', e => e.preventDefault())
}
```

### 7.3 Checklist de seguridad aplicado (Electron 43, checklist oficial de 20 ítems)

| # | Ítem | Aplicación en Telar |
|---|---|---|
| 1 | Solo cargar contenido seguro | Prod: `file://` local (build propio). Dev: localhost |
| 2 | `nodeIntegration: false` | Explícito en webPreferences (§4) |
| 3 | `contextIsolation: true` | Explícito (§4); preload usa contextBridge (§5.2) |
| 4 | `sandbox: true` | Explícito (§4); preload compatible (solo ipcRenderer.invoke) |
| 5 | Permission handler | `setPermissionRequestHandler` → deny todo (§7.1) |
| 6 | `webSecurity` no desactivado | Explícito `true`; CORS del backend resuelto con `Origin: null` en FastAPI, no aquí |
| 7 | CSP | Inyectada por `onHeadersReceived` solo en los documentos de la app (§7.1) |
| 8 | `allowRunningInsecureContent` | No se toca (default false) |
| 9 | Sin `experimentalFeatures` | No se usa |
| 10 | Sin `enableBlinkFeatures` | No se usa |
| 11 | `allowpopups` en webview | No hay webviews; `will-attach-webview` → preventDefault |
| 12 | Verificar opciones de webview | Ídem (bloqueados) |
| 13 | `will-navigate` whitelist | §7.2 |
| 14 | `setWindowOpenHandler` → deny | §7.2 |
| 15 | `shell.openExternal` solo validado | Solo https, tanto en windowOpenHandler como en IPC `shell:open-external` (§5.3) |
| 16 | Electron actualizado | ^43 (último major); Node 22 LTS para tooling |
| 17 | Validar sender IPC | `assertTrustedSender` con `senderFrame` + mainFrame (§5.3) |
| 18 | Protocolo custom > file:// | **Aceptado como mejora futura** (`protocol.handle('app')`): para MVP `loadFile` + HashRouter basta; documentado |
| 19 | Fuses | `@electron/fuses` en el paso de dist: desactivar `runAsNode`, `nodeCliInspect`, `enableNodeOptionsEnvironmentVariable` (script post-pack; si complica el pipeline de la tesis, documentar como pendiente) |
| 20 | No exponer ipcRenderer crudo | Solo funciones concretas en contextBridge (§5.2) |

### 7.4 Amenazas específicas y mitigación

- **El renderer puede pedir `compose:up`** → el impacto máximo es levantar/parar el compose del
  proyecto (acciones fijas, cwd fijo). No hay canal para comandos arbitrarios.
- **Backend local sin auth**: la app habla con `http://localhost:8000`, igual que el navegador.
  El aislamiento real del código del estudiante lo da el runner (contenedor efímero endurecido,
  responsabilidad del backend). El shell no añade superficie: no expone FS ni ejecuta código
  del renderer.
- **`Origin: null`** con `file://`: previsto en el backend (CORS `allow_origins` incluye `'null'`
  con `allow_credentials=False`). El WS no pasa por CORS; si el backend valida `Origin` a mano,
  debe aceptar `null`.

---

## 8. Flujo de arranque y UX de estado Docker

```
launch → main crea ventana → renderer monta AppShell
  └─ usePlatform() detecta window.telar → modo desktop
       └─ useDockerStatus():
            1. window.telar.dockerStatus()
            2a. ok && backend healthy  → footer: dot verde pulsante
                'Docker runtime' / '{n} contenedores activos'   (n = services running)
            2b. ok pero backend exited → AUTOARRANQUE: dockerUp() sin esperar al
                usuario; dot ámbar 'preparando entorno…' mientras dura
                (el primer arranque descarga ~1 GB y tarda varios minutos)
            2c. !ok (docker ausente)   → footer: dot rojo 'Docker no disponible'
                + tooltip con el error saneado + link 'Cómo instalar Docker'
                (openExternal a la guía https del repo)
            3. re-poll cada 10 s mientras la app esté abierta
salir → before-quit → compose:stop (timeout SHUTDOWN_TIMEOUT_MS) → app.quit()
```

**El autoarranque es de UNA SOLA VEZ por sesión de app** (guard `autoStarted` en
`useDockerStatus`). Sin ese guard, el re-poll de 10 s volvería a levantar lo que el usuario
acaba de parar con `Detener`, dejando ese control inservible: detener es una decisión
explícita y se respeta hasta el siguiente arranque. Con Docker ausente (2c) no se intenta,
pero **queda pendiente** (CU-27.2, 2026-09-22): el primer sondeo que encuentra el daemon lo
hace. `Detener` o `Levantar` pulsados por el usuario lo dan por resuelto.

**Qué es «listo»** (CU-27.1): el servicio `backend` en `running` con `health: healthy` (o sin
healthcheck declarado). `starting` se muestra como «verificando…» sin disparar nada;
`unhealthy` o un backend ausente cuentan como caídos aunque haya otros contenedores
corriendo. Con el backend listo, el pie consulta `runner_image_present` de `/system` y, si
es `false`, avisa «falta la imagen del runner» con **«Reintentar preparación»**
(`dockerUp`, CU-27.3); `/system` se vuelve a pedir al terminar cada preparación. El
`error` saneado de `dockerStatus` (Docker no instalado, permisos…) se muestra en el panel
(CU-27.4).

**Si la interfaz no carga** (CU-27.5): `did-fail-load` del frame principal (salvo
`ERR_ABORTED`) o `render-process-gone` (salvo `clean-exit`) cargan una página de error local
sin scripts (`userData/error-carga.html`) con la causa y un enlace «Reintentar». El enlace
es un fragmento (`#reintentar`): `main` lo detecta con `did-navigate-in-page` y vuelve a
cargar la interfaz (`src/load-failure.ts`). Tiene que ser `file://`: en un `data:` Chromium
no navega al pulsar el fragmento.

El punto de estado del rail es un **disparador**: hover muestra el estado, clic abre un panel
con `Levantar`/`Detener` según corresponda. (Hasta 2026-08-26 el botón vivía dentro de
`.sidebar-footer-text`, oculto de forma permanente por el rediseño del rail: era inalcanzable.)

- Las pantallas que necesitan backend (simulador, resultados, catálogo) muestran su ErrorState
  normal si el fetch falla; en desktop el ErrorState añade el CTA `Revisar servicios Docker`
  que enfoca el footer (scroll + highlight) — el usuario tiene un solo lugar para arreglar todo.
- `dockerStop()` se expone en el panel del RuntimeFooter (`Detener`) — útil al cerrar sesión
  de práctica — **y también se invoca automáticamente al salir de la app**
  (`before-quit` en `main.ts`, timeout `SHUTDOWN_TIMEOUT_MS`).

  > **Cambio 2026-08-28.** Hasta esta fecha los servicios SOBREVIVÍAN al cierre, por si otro
  > proceso los estaba usando. Se invierte: el caso real de la plataforma es un estudiante con
  > una sola app, y dejar contenedores corriendo tras cerrar confunde más de lo que ayuda.
  > Efecto colateral asumido: si hay una pestaña con la versión web abierta contra el mismo
  > backend, cerrar la app de escritorio también la deja sin servicio.
- Primer arranque (imagen runner sin construir): `compose:up` construye/baja imágenes → puede
  tardar minutos; el spinner del footer muestra `preparando entorno (primera vez: varios
  minutos)…` mientras `dockerStatus` no reporte healthy.

---

## 9. Configuración compartida con el frontend

| Variable | Web (nginx) | Desktop |
|---|---|---|
| `API_BASE` (runtime, `config.ts`) | `''` — mismo origen, proxy nginx | `http://localhost:8000` |
| `WS_BASE` (runtime) | `ws(s)://{location.host}` | `ws://localhost:8000` |
| `VITE_API_BASE`/`VITE_WS_BASE` | override SOLO de dev | override SOLO de dev |
| CSP | definida por nginx (opcional) | inyectada por main (§7.1) |
| Router | HashRouter | HashRouter (requisito file://) |
| `window.telar` | `undefined` | definida por preload |

**El build es único y NO hornea la base del API**: `config.ts` la resuelve en
RUNTIME — desktop si `window.telar !== undefined || location.protocol === 'file:'`,
web (rutas relativas) en caso contrario (regla congelada en `architecture.md`
§2.3). Así el mismo `dist/` funciona tras nginx y bajo `file://`.

---

## 10. Limitaciones documentadas (van al capítulo de la tesis y al README)

1. **Sin firma de código Windows**: el instalador NSIS y el portable no van firmados
   (certificado EV/OV fuera de alcance). Windows SmartScreen mostrará "aplicación no
   reconocida" → documentar el paso "Más información → Ejecutar de todas formas" con captura.
   Algunos antivirus marcan portables sin firma: el NSIS es el artefacto recomendado.
2. **Sin firma/notarización macOS**: no se distribuye target macOS en la tesis (matriz: win +
   linux). El código es portable si se quisiera.
3. **Sin auto-update**: electron-updater requiere firma en Windows para ser fiable; fuera de
   alcance. Actualización = reinstalar.
4. **AppImage dentro de WSL2** puede requerir `--appimage-extract` (FUSE limitado); el deb es
   el artefacto recomendado para Linux nativo, y en dev se usa `electron .`.
5. **Docker Desktop/Engine es prerequisito** del modo escritorio: la app lo detecta y guía,
   pero no lo instala.
6. **`file://` en vez de protocolo custom** (ítem 18): aceptado para MVP; migración a
   `protocol.handle('app')` documentada como trabajo futuro (beneficios: origen estable
   `app://`, history API, CSP más estricta sin `Origin: null`).
7. **Fuses**: si el paso post-pack de @electron/fuses complica el pipeline (Wine), se documenta
   como pendiente; el riesgo residual (runAsNode) exige acceso local al binario.
8. **AppImage y el `.exe` portable de Windows no limpian Docker al "desinstalarse"**: no tienen
   instalador/desinstalador del sistema donde enganchar nada (§6.2). Solo el `.deb` y el NSIS
   paran y borran el contenedor + imágenes al desinstalar de verdad.

---

## 11. Decisiones registradas en este documento

1. `desktop/` como paquete hermano sin Vite propio; contrato `telar-api.d.ts` compartido por copia verificada (§1).
2. esbuild dos entradas → `dist-electron/*.cjs`, target node24, typecheck separado con tsc (§2-3).
3. Dev con `concurrently` + `wait-on` (HMR del renderer vía `VITE_DEV_SERVER_URL`); sin auto-restart del main en MVP (§3).
4. `window.telar` = { appVersion, platform, dockerStatus, dockerUp, dockerStop, openExternal } — nombres finales del contrato (§5.1).
5. `compose ps --format json` parseado como NDJSON en el main; el renderer recibe estructura tipada, nunca stdout crudo (§5.3).
6. compose.yaml de despliegue empaquetado en `resources/compose` + override por `TELAR_COMPOSE_DIR` (§5.3, §6).
7. CSP por `onHeadersReceived` solo en desktop; nginx gestiona la suya en web (§7.1).
8. Los servicios Docker se levantan solos al abrir la app y se detienen al cerrarla; el panel
   del RuntimeFooter conserva el control manual (§8). *(Revisado el 2026-08-28: antes ni se
   levantaban ni se detenían de forma automática.)*
9. Targets: win nsis+portable (imagen wine o host Windows), linux AppImage+deb (WSL2) (§6).
10. Al desinstalar (NSIS `customUnInstall` / `.deb` prerm, no al actualizar) se para y borra el
    contenedor y las imágenes Docker; los volúmenes con datos de usuario NUNCA se tocan desde
    ahí (§6.2).
