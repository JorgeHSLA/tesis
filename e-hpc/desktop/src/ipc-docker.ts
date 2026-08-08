// ipc-docker.ts — whitelist CERRADA de acciones docker compose + execFile sin
// shell + validación de senderFrame (electron-spec.md §5.3).
import { app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { ComposeService, DockerActionResult, DockerStatusResult } from '../types/ehpc-api'
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
// 'compose:up' es COMPUESTA: en modo repo (TELAR_COMPOSE_DIR → clon con build:)
// primero construye la imagen runner (perfil 'build', que `up` ignoraría) y
// luego levanta; en modo empaquetado (§6.1, compose solo-image:) el build de
// runner es un no-op inmediato porque el servicio no tiene clave build.
const DOCKER_ACTIONS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  'compose:ps': [['compose', 'ps', '--format', 'json']],
  'compose:up': [
    ['compose', '--profile', 'build', 'build', 'runner'],
    ['compose', 'up', '-d'],
  ],
  'compose:stop': [['compose', 'stop']],
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

export function registerDockerIpc(): void {
  ipcMain.handle(
    'docker:run',
    async (event, action: unknown): Promise<DockerStatusResult | DockerActionResult> => {
      assertTrustedSender(event)
      const steps = typeof action === 'string' ? DOCKER_ACTIONS[action] : undefined
      if (!steps) return { ok: false, error: 'Acción no permitida' }
      try {
        let stdout = ''
        for (const step of steps) {
          // §5.3: acciones = secuencia de pasos
          ;({ stdout } = await execFileAsync('docker', [...step], {
            cwd: composeCwd(),
            timeout: EXEC_TIMEOUT_MS, // el build del runner (~777MB) tarda minutos
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
