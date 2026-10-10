// ipc-docker.ts — whitelist CERRADA de acciones docker compose + execFile sin
// shell + validación de senderFrame (electron-spec.md §5.3).
import { app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { ComposeService, DockerActionResult, DockerStatusResult } from '../types/telar-api'
import {
  DEV_SERVER_ORIGIN,
  EXEC_MAX_BUFFER,
  EXEC_TIMEOUT_MS,
  PACKAGED_COMPOSE_SUBDIR,
  STDERR_MAX_CHARS,
} from './constants'

const execFileAsync = promisify(execFile)

// Acciones CERRADAS: el renderer solo elige una clave; los argumentos viven aquí.
// Cada acción es una SECUENCIA de pasos ejecutados en orden (mismo cwd).
//
// 'compose:up' es COMPUESTA y cubre los DOS modos de despliegue (README §5.4):
//   1. build  — modo repo (TELAR_COMPOSE_DIR → clon con `build:`): construye la
//      imagen del runner, que `up` ignoraría por estar tras el perfil 'build'.
//      En modo empaquetado es un no-op (el servicio solo tiene `image:`).
//   2. pull   — modo empaquetado (§6.1, compose solo-image:): DESCARGA la imagen
//      del runner. Sin este paso nunca llega a una máquina limpia: el `build` de
//      arriba no hace nada y el `up -d` de abajo va SIN `--profile build`, así
//      que ni siquiera considera el servicio. El síntoma era brutal por lo
//      silencioso: el backend levantaba sano, el pie de ventana se ponía VERDE,
//      y el primer job moría con `503 RUNNER_IMAGE_MISSING`
//      (reproducido 2026-08-25 con el release v1.0.1 en Ubuntu limpio).
//      `--ignore-pull-failures` es lo que lo hace válido en ambos modos: en modo
//      repo la imagen local ya se construyó en el paso 1 y un fallo de descarga
//      (tag no publicado, sin red) no debe romper la cadena.
//   3. up -d backend — levanta SÓLO el backend, explícitamente.
//      El shell de escritorio nunca necesita el nginx del compose del repo: la
//      UI la sirve Electron desde disco y habla directo al backend (por eso el
//      compose empaquetado ni siquiera trae ese servicio, electron-spec §6.1).
//      Con `up -d` a secas, en modo repo Compose intentaba levantar también
//      nginx y, si el 8080 del host está ocupado, TODO el comando terminaba en
//      error: el backend quedaba sano pero `dockerUp` devolvía ok:false y la UI
//      mostraba un fallo que no existía (visto el 2026-08-28 con el 8080 tomado
//      por otro servicio del sistema). Nombrar el servicio es además la
//      semántica correcta: se arranca lo que la app usa. En el compose
//      empaquetado el resultado es idéntico (backend es su único servicio no
//      gateado por perfil).
const DOCKER_ACTIONS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  'compose:ps': [['compose', 'ps', '--format', 'json']],
  'compose:up': [
    ['compose', '--profile', 'build', 'build', 'runner'],
    ['compose', '--profile', 'build', 'pull', '--ignore-pull-failures', 'runner'],
    ['compose', 'up', '-d', 'backend'],
  ],
  'compose:stop': [['compose', 'stop']],
}

// Limpieza de una instalación nueva (fresh-install.ts): contenedores y
// VOLÚMENES del proyecto (progreso, cursos instalados, ejecuciones) y los
// contenedores de jobs que hubieran quedado sueltos. Las imágenes se conservan:
// no son datos del usuario y evitan volver a descargar ~1 GB. No es una acción
// del renderer: solo la antepone el proceso principal al primer `compose:up`.
const RESET_STEPS: readonly (readonly string[])[] = [
  ['compose', '--profile', 'build', 'down', '-v', '--remove-orphans'],
  ['container', 'prune', '-f', '--filter', 'label=telar.runner'],
]

let resetPending = false
let onResetDone: () => void = () => {}

/** main.ts la llama al arrancar si esta es la primera apertura de una
 *  instalación nueva. `done` se invoca cuando la limpieza termina bien. */
export function scheduleFreshReset(done: () => void): void {
  resetPending = true
  onResetDone = done
}

// Una sola limpieza en vuelo: `ps` y `up` pueden llegar casi a la vez.
let resetInFlight: Promise<DockerActionResult> | null = null

function runFreshReset(): Promise<DockerActionResult> {
  resetInFlight ??= (async (): Promise<DockerActionResult> => {
    try {
      for (const step of RESET_STEPS) {
        await execFileAsync('docker', [...step], {
          cwd: composeCwd(),
          timeout: EXEC_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: EXEC_MAX_BUFFER,
        })
      }
      resetPending = false
      onResetDone()
      return { ok: true }
    } catch (err) {
      // Docker no disponible todavía: queda pendiente para el próximo intento.
      return { ok: false, error: sanitizeError(err) }
    } finally {
      resetInFlight = null
    }
  })()
  return resetInFlight
}

// Dónde vive el compose.yaml: junto a los recursos empaquetados o configurable.
// Prod: se empaqueta un compose.yaml de despliegue en resources/ (extraResources §6).
// Dev:  raíz del repo. Override por env TELAR_COMPOSE_DIR (documentado en README).
function composeCwd(): string {
  if (process.env.TELAR_COMPOSE_DIR) return process.env.TELAR_COMPOSE_DIR
  return app.isPackaged
    ? path.join(process.resourcesPath, PACKAGED_COMPOSE_SUBDIR)
    : path.resolve(process.cwd(), '..')
}

/** Solo el frame principal, cargado desde file:// (prod) o el dev-server (dev). */
function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame) throw new Error('IPC sin frame')
  const url = new URL(frame.url)
  const trusted =
    url.protocol === 'file:' || // prod: loadFile
    url.origin === DEV_SERVER_ORIGIN // dev: Vite
  if (!trusted || frame !== event.sender.mainFrame) {
    // solo el frame principal
    throw new Error('IPC sender no autorizado')
  }
}

function sanitizeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string }
  if (e.code === 'ENOENT') return 'Docker no está instalado o no está en el PATH'
  const raw = e.stderr && e.stderr.trim() !== '' ? e.stderr : e.message
  return (raw ?? 'Error desconocido ejecutando docker').slice(0, STDERR_MAX_CHARS)
}

/** Ejecuta una acción de la whitelist. Extraído del handler IPC para que el
 *  proceso principal pueda invocarla al cerrar (§8) sin duplicar la lista ni
 *  relajar nada: la clave sigue siendo una de `DOCKER_ACTIONS` y los argumentos
 *  siguen viviendo aquí. `timeoutMs` permite acortar la espera al salir, donde
 *  no se puede bloquear el cierre durante minutos. */
export async function runDockerAction(
  action: string,
  timeoutMs: number = EXEC_TIMEOUT_MS,
): Promise<DockerStatusResult | DockerActionResult> {
  const steps = DOCKER_ACTIONS[action]
  if (!steps) return { ok: false, error: 'Acción no permitida' }
  // Instalación nueva: antes de la primera consulta o arranque se deja Docker
  // sin datos viejos. Va también en `compose:ps` porque es lo primero que hace
  // la app al abrir; si solo fuera en `up`, un backend viejo que siguiera
  // corriendo (restart: unless-stopped) se vería sano y `up` nunca llegaría.
  if (resetPending && (action === 'compose:ps' || action === 'compose:up')) {
    const reset = await runFreshReset()
    if (!reset.ok) {
      return action === 'compose:ps' ? { ok: false, services: [], error: reset.error } : reset
    }
  }
  try {
    let stdout = ''
    for (const step of steps) {
      // §5.3: acciones = secuencia de pasos
      ;({ stdout } = await execFileAsync('docker', [...step], {
        cwd: composeCwd(),
        timeout: timeoutMs, // el build del runner (~777MB) tarda minutos
        windowsHide: true,
        maxBuffer: EXEC_MAX_BUFFER,
      }))
    }
    if (action === 'compose:ps') return { ok: true, services: parseComposePs(stdout) }
    return { ok: true }
  } catch (err) {
    const msg = sanitizeError(err)
    return action === 'compose:ps'
      ? { ok: false, services: [], error: msg }
      : { ok: false, error: msg }
  }
}

export function registerDockerIpc(): void {
  ipcMain.handle(
    'docker:run',
    async (event, action: unknown): Promise<DockerStatusResult | DockerActionResult> => {
      assertTrustedSender(event)
      if (typeof action !== 'string') return { ok: false, error: 'Acción no permitida' }
      return runDockerAction(action)
    },
  )

  ipcMain.handle('shell:open-external', async (event, url: unknown): Promise<void> => {
    assertTrustedSender(event)
    if (typeof url !== 'string') throw new Error('URL inválida')
    const u = new URL(url) // lanza si no parsea
    if (u.protocol !== 'https:') throw new Error('Solo se permiten URLs https')
    await shell.openExternal(u.toString())
  })
}

// `docker compose ps --format json` emite un objeto JSON por línea (NDJSON) en
// Compose v2+. Líneas no parseables se descartan; el renderer recibe estructura
// tipada, nunca stdout crudo.
function parseComposePs(stdout: string): ComposeService[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .flatMap((line): ComposeService[] => {
      try {
        const j = JSON.parse(line) as {
          Name?: string
          Service?: string
          State?: string
          Health?: string
        }
        return [
          {
            name: j.Name ?? '',
            service: j.Service ?? '',
            state: (j.State ?? '').toLowerCase() as ComposeService['state'],
            health: j.Health ? (j.Health.toLowerCase() as ComposeService['health']) : undefined,
          },
        ]
      } catch {
        return []
      }
    })
}
