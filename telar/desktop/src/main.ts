// main.ts — ciclo de vida, BrowserWindow, carga dev/prod (electron-spec.md §4).
// Single-instance lock, show-on-ready, menú null en prod, webPreferences
// endurecidas, hardenSession + registerDockerIpc + attachNavigationGuards.
import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { registerDockerIpc, runDockerAction } from './ipc-docker'
import { attachLoadFailureHandling } from './load-failure'
import { hardenSession, attachNavigationGuards } from './security'
import { attachUnsavedChangesPrompt } from './unsaved-changes'
import {
  DEV_SERVER_URL,
  PACKAGED_FRONTEND_SUBDIR,
  SHUTDOWN_TIMEOUT_MS,
  WINDOW_BACKGROUND_COLOR,
} from './constants'

// Render por CPU (software) en TODAS las plataformas: la UI es ligera (texto +
// SVG, sin 3D), así la app es portable y no depende de la GPU. Evita el
// 'WebGL1 blocklisted' y la pantalla en blanco bajo WSLg / entornos sin GPU
// utilizable, sin coste visual perceptible. Debe invocarse antes de 'ready'.
app.disableHardwareAcceleration()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // minWidth sigue el set único de breakpoints del frontend (tokens.css §6):
    // --bp-sm = 640px. Antes era 980 (el breakpoint único que tenía el CSS
    // cuando el layout no era responsive) e impedía estrechar la ventana pese
    // a que la UI ya se adapta hasta 375px.
    minWidth: 640,
    minHeight: 560,
    show: false, // evitar flash blanco; show en ready-to-show
    backgroundColor: WINDOW_BACKGROUND_COLOR, // sigue a --bg de tokens.css (ver constants.ts)
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, // explícito aunque sea default
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  attachNavigationGuards(win) // §7.2
  const load = () => loadInterface(win)
  attachLoadFailureHandling(win, load) // CU-27.5: página de error local + «Reintentar»
  attachUnsavedChangesPrompt(win) // cerrar/recargar con cambios de Autoría sin guardar
  load()
  // DevTools solo si se pide con TELAR_DEVTOOLS=1; por defecto, ventana limpia.
  if (!app.isPackaged && DEV_SERVER_URL && process.env.TELAR_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }
  return win
}

/** Carga la interfaz: dev-server en desarrollo, build empaquetado en prod. El
 *  rechazo de la promesa se ignora a propósito: el fallo lo atiende
 *  `did-fail-load` en load-failure.ts. */
function loadInterface(win: BrowserWindow): void {
  const loading =
    !app.isPackaged && DEV_SERVER_URL
      ? win.loadURL(DEV_SERVER_URL)
      : // HashRouter ⇒ las rutas viven tras '#', loadFile no necesita ajustes por ruta
        win.loadFile(path.join(process.resourcesPath, PACKAGED_FRONTEND_SUBDIR, 'index.html'))
  loading.catch(() => {})
}

// Single instance lock: la segunda instancia enfoca la ventana existente
// (evita dos apps peleando por el mismo compose) — electron-spec §4, notas.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    // Menú de aplicación null en prod; en dev se conserva el default
    // (atajos de recarga/DevTools). DevTools no se abren en prod.
    if (app.isPackaged) Menu.setApplicationMenu(null)
    hardenSession() // CSP + permission handler, §7.1
    registerDockerIpc() // §5.2/§5.3
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Al salir se DETIENEN los servicios Docker, para no dejarlos consumiendo
// recursos en segundo plano (2026-08-28). Invierte la decisión §8/§11 del
// electron-spec, que los dejaba vivos por si otro proceso los usaba; el caso
// real de la plataforma es un estudiante con una sola app, y encontrarse
// contenedores corriendo después de cerrar es más confuso que útil. La vía
// manual («Detener» en el panel del rail) se conserva.
//
// `before-quit` es el único gancho que llega ANTES de que Electron desmonte
// todo, pero es síncrono: hay que frenar el cierre, esperar al comando y
// volver a pedir la salida. El flag evita el bucle infinito, porque el
// segundo app.quit() vuelve a disparar este mismo evento.
let stoppingServices = false
app.on('before-quit', (event) => {
  if (stoppingServices) return // segunda vuelta: dejar salir
  stoppingServices = true
  event.preventDefault()
  void (async () => {
    try {
      // Timeout corto: si Docker no responde, la app se cierra igual en vez de
      // quedarse sin ventana y sin poder salir.
      await runDockerAction('compose:stop', SHUTDOWN_TIMEOUT_MS)
    } catch {
      // Nunca impedir el cierre por un fallo al parar los servicios.
    } finally {
      app.quit()
    }
  })()
})
