// main.ts — ciclo de vida, BrowserWindow, carga dev/prod (electron-spec.md §4).
// Single-instance lock, show-on-ready, menú null en prod, webPreferences
// endurecidas, hardenSession + registerDockerIpc + attachNavigationGuards.
import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { registerDockerIpc } from './ipc-docker'
import { hardenSession, attachNavigationGuards } from './security'
import { DEV_SERVER_URL, PACKAGED_FRONTEND_SUBDIR, WINDOW_BACKGROUND_COLOR } from './constants'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false, // evitar flash blanco; show en ready-to-show
    backgroundColor: WINDOW_BACKGROUND_COLOR, // --cream-50 (v1) — coherente con la app
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
  if (!app.isPackaged && DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(process.resourcesPath, PACKAGED_FRONTEND_SUBDIR, 'index.html'))
    // HashRouter ⇒ las rutas viven tras '#', loadFile no necesita ajustes por ruta
  }
  return win
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
  // Los servicios Docker NO se detienen al cerrar la app (decisión §8).
  if (process.platform !== 'darwin') app.quit()
})
