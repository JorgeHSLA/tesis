// constants.ts — orígenes permitidos, rutas y parámetros del shell de
// escritorio (electron-spec.md §1). Un solo lugar para los valores que
// comparten main.ts, security.ts e ipc-docker.ts.

/** Origen del dev-server de Vite (solo `npm run dev`). */
export const DEV_SERVER_ORIGIN = 'http://localhost:5173'

/** URL del dev-server: solo definida cuando `npm run dev` la exporta. */
export const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/** Origen HTTP del backend local (architecture.md §2.3: resuelto en runtime). */
export const API_ORIGIN = process.env.EHPC_API_ORIGIN ?? 'http://localhost:8000'

/** Origen WS derivado del API (ws://localhost:8000 por defecto). */
export const WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws')

/** Nombre del proyecto compose (clave `name:` del compose empaquetado). */
export const COMPOSE_PROJECT_NAME = 'ehpc'

/** Subcarpeta bajo process.resourcesPath con el compose de despliegue (§6.1). */
export const PACKAGED_COMPOSE_SUBDIR = 'compose'

/** Subcarpeta bajo process.resourcesPath con el build de Vite (§6). */
export const PACKAGED_FRONTEND_SUBDIR = 'app-frontend'

/** Timeout por paso de docker compose: el build del runner (~777MB) tarda minutos. */
export const EXEC_TIMEOUT_MS = 600_000

/** Buffer máximo de stdout/stderr por execFile. */
export const EXEC_MAX_BUFFER = 4 * 1024 * 1024

/** stderr saneado y truncado antes de llegar a UI (electron-spec §5.3). */
export const STDERR_MAX_CHARS = 500

/** Color de fondo de la ventana ANTES del primer paint (evita el flash blanco).
 *  Debe seguir a `--bg` de frontend/src/styles/tokens.css §2 (lienzo hundido).
 *  Antes era '#FDF8EE' (--cream-50 de la variante v1, retirada): la ventana
 *  abría en crema y saltaba a azul-gris al pintar. */
export const WINDOW_BACKGROUND_COLOR = '#E8EDF4'
