// security.ts — CSP vía onHeadersReceived, permission handler deny,
// will-navigate whitelist y windowOpenHandler deny (electron-spec.md §7).
import { session, shell, type BrowserWindow } from 'electron'
import { API_ORIGIN, WS_ORIGIN, DEV_SERVER_ORIGIN, DEV_SERVER_URL } from './constants'

// El HTML se carga con loadFile (sin headers HTTP), así que la CSP se inyecta
// en la sesión — solo en la app de escritorio, sin tocar el build web (§7.1).
const CSP = [
  "default-src 'self'",
  // Prod: estricto ('self'). Dev: Vite/@vitejs/plugin-react inyecta un preámbulo
  // de HMR inline (y a veces usa eval) que la CSP estricta bloquea → 'can't
  // detect preamble' y React no monta. Se relaja SOLO en dev (DEV_SERVER_URL).
  `script-src 'self'` + (DEV_SERVER_URL ? " 'unsafe-inline' 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'", // estilos inline puntuales (SVG/anchos dinámicos)
  "img-src 'self' data:",
  // @fontsource = self-hosted, sin red. `data:` es necesario porque Vite
  // inlinea los subsets pequeños de fuentes (< assetsInlineLimit) como
  // data:font/woff2 en el CSS; sin él la CSP los bloquea en file://.
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} ${WS_ORIGIN}` +
    (DEV_SERVER_URL ? ' http://localhost:5173 ws://localhost:5173' : ''),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** CSP + denegación de todos los permisos del navegador (§7.1). */
export function hardenSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  // Denegar TODOS los permisos del navegador (cámara, geoloc, notificaciones…):
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}

const ALLOWED_NAV_ORIGINS = new Set([
  DEV_SERVER_ORIGIN, // dev
  // prod: la app vive en file:// — cualquier http(s) externo se bloquea
])

/** will-navigate whitelist + windowOpenHandler deny + sin webviews (§7.2). */
export function attachNavigationGuards(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event, url) => {
    let sameFile = false
    let origin = ''
    try {
      const u = new URL(url)
      sameFile = u.protocol === 'file:' // HashRouter no navega, pero por si acaso
      origin = u.origin
    } catch {
      /* URL inválida: se bloquea abajo */
    }
    if (!sameFile && !ALLOWED_NAV_ORIGINS.has(origin)) event.preventDefault()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:') setImmediate(() => void shell.openExternal(u.toString()))
    } catch {
      /* URL inválida: ignorar */
    }
    return { action: 'deny' } // NUNCA se crean ventanas nuevas
  })

  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
}
