// docker-desktop.ts — abre Docker Desktop al iniciar Telar y lo cierra al salir.
//
// Pedido (2026-11-16): «que Docker Desktop se lance cuando se abra la app para
// no tener que ejecutarlo antes, y que se detenga cuando se cierre». Hasta ahora
// el estudiante debía abrir Docker Desktop a mano; si no, el rail se ponía rojo
// con un error de conexión.
//
// Reglas, para no hacer daño:
//  1. Solo se abre si NO está corriendo ya (se comprueba con `docker info`).
//  2. Solo se cierra si FUE TELAR quien lo abrió. Si el estudiante ya lo tenía
//     abierto (con sus propios contenedores), se lo deja exactamente como estaba.
//  3. Solo en la app instalada y en Windows/macOS. En Linux lo normal es Docker
//     Engine como servicio del sistema, que no se arranca ni se detiene desde
//     una app de usuario; ahí no se toca nada.
//  4. `TELAR_DOCKER_AUTOSTART=0` lo desactiva.
//  5. Ninguna de las dos operaciones puede bloquear la app ni impedir su cierre.
//
// La lógica que no toca el sistema (qué ejecutable abrir, cómo reconocer «el
// daemon no responde») es pura y se prueba en test/docker-desktop.test.ts.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Texto que el renderer reconoce (lib/dockerErrors.ts: DOCKER_STARTING_MARK). */
export const DOCKER_STARTING_MESSAGE = 'Docker Desktop se está iniciando… puede tardar un minuto.'

/** Espera máxima a que Docker Desktop responda tras abrirlo. */
export const START_TIMEOUT_MS = 180_000
const POLL_MS = 2_500
/** `docker info` contra un daemon dormido puede tardar: se acota. */
const PROBE_TIMEOUT_MS = 6_000
/** `docker desktop stop` tarda unos segundos; se acota para no atascar el cierre. */
export const STOP_TIMEOUT_MS = 40_000

export interface LaunchSpec {
  command: string
  args: string[]
}

/**
 * Cómo abrir Docker Desktop en esta plataforma, o `null` si no se sabe / no
 * aplica (Linux, o Docker Desktop no instalado). `exists` se inyecta para poder
 * probarla sin tocar el disco.
 */
export function dockerDesktopLaunchSpec(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean = existsSync,
): LaunchSpec | null {
  if (platform === 'win32') {
    const candidates = [
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
      env.ProgramW6432 && path.win32.join(env.ProgramW6432, 'Docker', 'Docker', 'Docker Desktop.exe'),
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Docker', 'Docker', 'Docker Desktop.exe'),
    ].filter((c): c is string => typeof c === 'string' && c !== '')
    const found = candidates.find((c) => exists(c))
    return found === undefined ? null : { command: found, args: [] }
  }
  if (platform === 'darwin') {
    return exists('/Applications/Docker.app') ? { command: 'open', args: ['-a', 'Docker'] } : null
  }
  return null
}

/** ¿El error de `docker` significa «no hay daemon al que hablar» (y no otra cosa)? */
export function isDaemonUnreachable(stderr: string): boolean {
  return /cannot connect to the docker daemon|error during connect|dockerDesktopLinuxEngine|docker_engine|docker\.sock|is the docker daemon running|failed to connect to the docker api|daemon is not running|manually paused/i.test(
    stderr,
  )
}

/**
 * Cómo preguntar al sistema si el PROCESO de Docker Desktop ya existe. Importa:
 * «el daemon no responde» no significa «Docker Desktop no está abierto» (puede
 * estar en pausa o arrancando). Si el proceso existe, Telar no lo abre ni, por
 * tanto, lo cierra después: no es suyo.
 */
export function dockerDesktopProcessSpec(platform: NodeJS.Platform): LaunchSpec | null {
  if (platform === 'win32') {
    return { command: 'tasklist', args: ['/FI', 'IMAGENAME eq Docker Desktop.exe', '/NH'] }
  }
  if (platform === 'darwin') return { command: 'pgrep', args: ['-f', 'Docker.app/Contents/MacOS'] }
  return null
}

/** ¿La salida de `tasklist` (Windows) lista a Docker Desktop? En macOS basta el código de salida de `pgrep`. */
export function tasklistShowsDockerDesktop(stdout: string): boolean {
  return /Docker Desktop\.exe/i.test(stdout)
}

/** Comando para cerrar Docker Desktop con cortesía (sin matar procesos a la fuerza). */
export function dockerDesktopStopSpecs(platform: NodeJS.Platform): LaunchSpec[] {
  const primary: LaunchSpec = { command: 'docker', args: ['desktop', 'stop'] }
  if (platform === 'darwin') return [primary, { command: 'osascript', args: ['-e', 'quit app "Docker"'] }]
  if (platform === 'win32') return [primary, { command: 'taskkill', args: ['/IM', 'Docker Desktop.exe'] }]
  return []
}

// ── Estado del proceso principal ────────────────────────────────────────────

let startedByTelar = false
let starting = false
let inFlight: Promise<void> | null = null

/** ¿Está Telar esperando a que Docker Desktop termine de abrirse? */
export function isDockerDesktopStarting(): boolean {
  return starting
}

/** Solo para pruebas. */
export function _resetDockerDesktopState(): void {
  startedByTelar = false
  starting = false
  inFlight = null
}

async function daemonResponds(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

/** ¿Hay ya un proceso de Docker Desktop (aunque su daemon no responda)? */
async function dockerDesktopProcessRunning(): Promise<boolean> {
  const spec = dockerDesktopProcessSpec(process.platform)
  if (spec === null) return false
  try {
    const { stdout } = await execFileAsync(spec.command, spec.args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true })
    // pgrep sale con 0 solo si encontró algo; tasklist siempre sale con 0 y hay que leer la lista.
    return process.platform === 'win32' ? tasklistShowsDockerDesktop(stdout) : true
  } catch {
    return false // pgrep sale con 1 si no hay coincidencias
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function autostartEnabled(): boolean {
  return process.env.TELAR_DOCKER_AUTOSTART !== '0'
}

/**
 * Abre Docker Desktop si no está corriendo y espera (sin bloquear a nadie: se
 * llama con `void`) a que el daemon responda. Nunca lanza.
 */
export function ensureDockerDesktop(): Promise<void> {
  if (!autostartEnabled()) return Promise.resolve()
  inFlight ??= (async () => {
    try {
      if (await daemonResponds()) return // ya estaba abierto: no se toca ni se cerrará luego
      // El daemon no responde, pero el PROCESO puede existir (en pausa, o
      // arrancando por su cuenta): tampoco es de Telar, no se abre ni se cierra.
      if (await dockerDesktopProcessRunning()) return
      const spec = dockerDesktopLaunchSpec(process.platform, process.env)
      if (spec === null) return
      starting = true
      const child = spawn(spec.command, spec.args, { detached: true, stdio: 'ignore' })
      child.on('error', () => {
        starting = false // no se pudo abrir: el rail mostrará el estado real
      })
      child.unref()
      startedByTelar = true
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        await sleep(POLL_MS)
        if (await daemonResponds()) return
      }
    } catch {
      /* nunca romper el arranque de la app por esto */
    } finally {
      starting = false
    }
  })()
  return inFlight
}

/**
 * Cierra Docker Desktop SOLO si lo abrió Telar. Prueba el comando limpio y, si
 * falla, el cierre cortés del sistema. Nunca lanza ni se pasa de `timeoutMs`.
 */
export async function stopDockerDesktopIfStartedByTelar(timeoutMs: number = STOP_TIMEOUT_MS): Promise<boolean> {
  if (!startedByTelar) return false
  for (const spec of dockerDesktopStopSpecs(process.platform)) {
    try {
      await execFileAsync(spec.command, spec.args, { timeout: timeoutMs, windowsHide: true })
      startedByTelar = false
      return true
    } catch {
      /* se prueba el siguiente */
    }
  }
  return false
}
