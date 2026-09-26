// security.ts — CSP vía onHeadersReceived (solo documentos de la app), Referer
// para el reproductor de YouTube, permission handler deny, will-navigate
// whitelist y windowOpenHandler deny (electron-spec.md §7).
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
  // Los videos de las lecciones son embeds de YouTube NO LISTADO (URLs, nunca
  // .mp4 descargados) → el reproductor es un <iframe> externo, que
  // `default-src 'self'` bloquearía. Se admite SOLO el dominio nocookie.
  // `resolveYouTubeEmbed` (frontend) ya normaliza toda URL de video a ese
  // origen; esta línea es la segunda barrera, por si esa validación fallara
  // con contenido venido del catálogo remoto (electron-spec.md §7.1).
  'frame-src https://www.youtube-nocookie.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** Origen del dev-server si la app corre en dev (null en la app instalada). */
const APP_DEV_ORIGIN = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : null

/**
 * ¿Lleva esta respuesta la CSP de Telar? Solo los documentos PROPIOS de la app:
 * file:// (app instalada), el origen del dev-server (dev) y cualquier mainFrame.
 * NUNCA un subFrame ni respuestas de otros orígenes: `onHeadersReceived` ve
 * TODO el tráfico de la sesión, y pegarle la CSP de Telar (script-src 'self'…)
 * al iframe de youtube-nocookie le bloqueaba al reproductor sus propios
 * scripts, fuentes y video («An error occurred»). Lo que se puede incrustar
 * lo sigue acotando `frame-src` de la CSP del documento de la app.
 */
export function debeAplicarCsp(
  details: { url: string; resourceType: string },
  devOrigin: string | null = APP_DEV_ORIGIN,
): boolean {
  if (details.resourceType === 'subFrame') return false
  if (details.resourceType === 'mainFrame') return true
  let u: URL
  try {
    u = new URL(details.url)
  } catch {
    return false
  }
  return u.protocol === 'file:' || (devOrigin !== null && u.origin === devOrigin)
}

/**
 * Referer que se presenta a YouTube: la página pública del proyecto (GitHub
 * Pages, site/README.md). Solo el origen, como haría un navegador con
 * `strict-origin-when-cross-origin`.
 */
export const REFERER_YOUTUBE = 'https://telar-javeriana.github.io/'

/**
 * Dominios (y sus subdominios) del reproductor embebido de YouTube, medidos con
 * scripts/check-youtube-embed.mjs --hosts: el embed (youtube-nocookie), miniaturas
 * (ytimg, ggpht), el video (googlevideo) y youtube.com por si el embed redirige.
 * El resto de hosts que toca el iframe (gstatic, google.com, googleapis) salen
 * desde la página https de YouTube, que ya manda su propio Referer.
 */
const YOUTUBE_DOMAINS = ['youtube-nocookie.com', 'youtube.com', 'ytimg.com', 'googlevideo.com', 'ggpht.com']

/** Filtro de `onBeforeSendHeaders`: la lista de arriba en patrones de URL. */
const YOUTUBE_URL_PATTERNS = YOUTUBE_DOMAINS.map((d) => `https://*.${d}/*`)

function esHostYouTube(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      YOUTUBE_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))
    )
  } catch {
    return false
  }
}

/**
 * Cabeceras para una petición saliente. En la app instalada la página es
 * file:// y Chromium NO manda Referer al iframe; YouTube rechaza los embeds sin
 * Referer (error 153). Si la petición va a YouTube y no trae Referer, se añade
 * `REFERER_YOUTUBE`; cualquier otra petición (backend local incluido) se
 * devuelve intacta. No muta la entrada.
 */
export function cabecerasYouTube(
  url: string,
  headers: Record<string, string>,
): Record<string, string> {
  if (!esHostYouTube(url)) return headers
  if (Object.keys(headers).some((k) => k.toLowerCase() === 'referer')) return headers
  return { ...headers, Referer: REFERER_YOUTUBE }
}

/** CSP + Referer de YouTube + denegación de todos los permisos (§7.1). */
export function hardenSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!debeAplicarCsp(details)) return cb({})
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: YOUTUBE_URL_PATTERNS },
    (details, cb) => cb({ requestHeaders: cabecerasYouTube(details.url, details.requestHeaders) }),
  )
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
