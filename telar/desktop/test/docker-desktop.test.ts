// docker-desktop — qué abrir/cerrar según la plataforma, y cuándo hay que tocar nada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOCKER_STARTING_MESSAGE,
  dockerDesktopLaunchSpec,
  dockerDesktopStopSpecs,
  isDaemonUnreachable,
  stopDockerDesktopIfStartedByTelar,
  _resetDockerDesktopState,
} from '../src/docker-desktop'

import path from 'node:path'

const w = path.win32
const PF = w.join('C:', 'Program Files')
const LOCAL = w.join('C:', 'Users', 'a', 'AppData', 'Local')
const ENV_WIN = { ProgramFiles: PF, LOCALAPPDATA: LOCAL }
const EXE_PF = w.join(PF, 'Docker', 'Docker', 'Docker Desktop.exe')
const EXE_LOCAL = w.join(LOCAL, 'Programs', 'Docker', 'Docker', 'Docker Desktop.exe')

test('Windows: usa Program Files si Docker Desktop está ahí', () => {
  const spec = dockerDesktopLaunchSpec('win32', ENV_WIN, (p) => p === EXE_PF)
  assert.deepEqual(spec, { command: EXE_PF, args: [] })
})

test('Windows: cae a la instalación por usuario (LOCALAPPDATA)', () => {
  const spec = dockerDesktopLaunchSpec('win32', ENV_WIN, (p) => p === EXE_LOCAL)
  assert.equal(spec?.command, EXE_LOCAL)
})

test('Windows: sin Docker Desktop instalado → null (no se inventa una ruta)', () => {
  assert.equal(dockerDesktopLaunchSpec('win32', ENV_WIN, () => false), null)
  assert.equal(dockerDesktopLaunchSpec('win32', {}, () => true), null)
})

test('macOS: abre la app Docker si está instalada', () => {
  assert.deepEqual(dockerDesktopLaunchSpec('darwin', {}, () => true), { command: 'open', args: ['-a', 'Docker'] })
  assert.equal(dockerDesktopLaunchSpec('darwin', {}, () => false), null)
})

test('Linux: nunca se toca (Docker Engine es un servicio del sistema)', () => {
  assert.equal(dockerDesktopLaunchSpec('linux', {}, () => true), null)
  assert.deepEqual(dockerDesktopStopSpecs('linux'), [])
})

test('cierre: primero el comando limpio de Docker, luego el cierre cortés del sistema', () => {
  assert.deepEqual(dockerDesktopStopSpecs('win32')[0], { command: 'docker', args: ['desktop', 'stop'] })
  assert.equal(dockerDesktopStopSpecs('win32')[1].command, 'taskkill')
  assert.ok(!dockerDesktopStopSpecs('win32')[1].args.includes('/F'), 'sin /F: no se mata a la fuerza')
  assert.equal(dockerDesktopStopSpecs('darwin')[1].command, 'osascript')
})

test('isDaemonUnreachable reconoce el stderr de «no hay daemon» y nada más', () => {
  assert.equal(isDaemonUnreachable('error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/info"'), true)
  assert.equal(isDaemonUnreachable('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'), true)
  assert.equal(isDaemonUnreachable('Docker Desktop is manually paused'), true)
  assert.equal(isDaemonUnreachable('no such service: backend'), false)
})

test('el mensaje de arranque lleva la marca que el frontend reconoce', () => {
  assert.ok(DOCKER_STARTING_MESSAGE.startsWith('Docker Desktop se está iniciando'))
})

test('si Telar NO abrió Docker Desktop, no lo cierra (el estudiante ya lo tenía abierto)', async () => {
  _resetDockerDesktopState()
  assert.equal(await stopDockerDesktopIfStartedByTelar(50), false)
})

// ── Un daemon que no responde NO significa «Docker Desktop cerrado» ──────────
import { dockerDesktopProcessSpec, tasklistShowsDockerDesktop } from '../src/docker-desktop'

test('proceso: tasklist en Windows, pgrep en macOS, nada en Linux', () => {
  assert.equal(dockerDesktopProcessSpec('win32')?.command, 'tasklist')
  assert.ok(dockerDesktopProcessSpec('win32')?.args.some((a) => a.includes('Docker Desktop.exe')))
  assert.equal(dockerDesktopProcessSpec('darwin')?.command, 'pgrep')
  assert.equal(dockerDesktopProcessSpec('linux'), null)
})

test('tasklist: reconoce a Docker Desktop en la lista y no se deja engañar por el aviso de «sin resultados»', () => {
  assert.equal(tasklistShowsDockerDesktop('Docker Desktop.exe            14320 Console   1   310.504 K'), true)
  assert.equal(tasklistShowsDockerDesktop('INFORMACIÓN: no hay tareas ejecutándose que coincidan con los criterios especificados.'), false)
  assert.equal(tasklistShowsDockerDesktop(''), false)
})
