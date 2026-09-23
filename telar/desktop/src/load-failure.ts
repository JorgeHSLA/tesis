// load-failure.ts — si la interfaz no carga o su proceso muere, la ventana
// muestra una página de error LOCAL con «Reintentar» (CU-27.5). Sin esto la
// ventana quedaba en blanco y, sin interfaz, tampoco aparece el pie de estado
// con el que el usuario diagnostica Docker.
//
// La página es un HTML sin scripts (nada que la CSP tenga que permitir) que se
// escribe en userData y se abre con loadFile. El botón es un enlace al
// fragmento #reintentar: una navegación DENTRO de la página no dispara
// `will-navigate` (las guardas de security.ts no la ven) y aquí se escucha con
// `did-navigate-in-page` para volver a cargar la app. Tiene que ser file://:
// en un data: (origen opaco) Chromium no navega al pulsar el fragmento
// (comprobado con Electron 43 el 2026-09-22).
import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { WINDOW_BACKGROUND_COLOR } from './constants'

const ERROR_PAGE_FILE = 'error-carga.html'

const RETRY_HASH = '#reintentar'

/** Chromium usa -3 (ERR_ABORTED) cuando una navegación reemplaza a otra: no es un fallo. */
const ERR_ABORTED = -3

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function errorPageHtml(detail: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Telar</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: ${WINDOW_BACKGROUND_COLOR}; color: #2b2622;
         font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1.5rem; color: #5c534b; }
  code { font-size: .85em; }
  a { display: inline-block; padding: .5rem 1.25rem; border-radius: 6px;
      background: #2b2622; color: #fff; text-decoration: none; }
  a:focus-visible { outline: 3px solid #b5652b; outline-offset: 2px; }
</style></head>
<body><main>
  <h1>No se pudo cargar la interfaz de Telar</h1>
  <p>Vuelve a intentarlo. Si sigue fallando, reinstala la aplicación.<br><code>${escapeHtml(detail)}</code></p>
  <a href="${RETRY_HASH}">Reintentar</a>
</main></body></html>`
}

/** Engancha el manejo de fallos de carga; `load` vuelve a cargar la app. */
export function attachLoadFailureHandling(win: BrowserWindow, load: () => void): void {
  let showingError = false
  const contents = win.webContents

  const showError = (detail: string) => {
    if (win.isDestroyed()) return
    showingError = true
    try {
      const file = path.join(app.getPath('userData'), ERROR_PAGE_FILE)
      fs.writeFileSync(file, errorPageHtml(detail), 'utf8')
      contents.loadFile(file).catch(() => {
        // Si ni la página de error carga no queda nada útil que hacer aquí.
      })
    } catch {
      // Sin poder escribir en userData tampoco hay dónde dejar la página.
    }
  }

  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED || showingError) return
    showError(`${description} (${code})`)
  })

  contents.on('render-process-gone', (_event, details) => {
    // Con la página de error ya puesta no se reescribe en bucle si vuelve a caer.
    if (details.reason === 'clean-exit' || showingError) return
    showError(`La interfaz se cerró inesperadamente (${details.reason}).`)
  })

  contents.on('did-navigate-in-page', (_event, url) => {
    if (!showingError || !url.endsWith(RETRY_HASH)) return
    showingError = false
    load()
  })
}
