// fresh-install.ts — una instalación nueva arranca desde cero.
//
// El desinstalador borra los volúmenes Docker (progreso, cursos instalados,
// ejecuciones) y la carpeta de datos de la app. Pero solo puede hablar con
// Docker si Docker está corriendo en ese momento: si no, los volúmenes
// sobreviven y una reinstalación aparecería con el progreso viejo.
//
// Esta es la red de seguridad. La carpeta de datos (userData) SÍ se borra
// siempre al desinstalar, sin depender de Docker; así que su ausencia es la
// señal fiable de «primera apertura de una instalación nueva». En ese caso, el
// primer `compose:up` va precedido de un `compose down -v` que deja Docker sin
// datos de Telar.
//
// Quien ACTUALIZA desde una versión anterior ya tiene userData con rastros de
// uso (cachés del renderer, Local Storage) y no se toca: actualizar nunca
// borra nada. La decisión se persiste en MARKER_FILE, porque desde la segunda
// apertura esos rastros ya existen y no servirían para decidir.
//
// Los instaladores refuerzan esto, porque los desinstaladores ≤1.0.8 no
// borraban userData: en una instalación nueva (no actualización), el de
// Windows deja userData con este marcador en resetPending:true
// (installer.nsh, customInstall) y el .deb borra ~/.config/Telar
// (before-install.sh).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const MARKER_FILE = 'telar-instalacion.json'

/** Carpetas que Chromium crea en userData al cargar la ventana (nunca antes de
 *  que corra main.ts). Si existe alguna, la app ya se usó en este equipo. */
export const USAGE_TRACES = ['Local Storage', 'Session Storage', 'Code Cache', 'Cache', 'GPUCache'] as const

export interface MarkerState {
  /** true ⇒ el próximo `compose:up` limpia antes los datos Docker de Telar. */
  resetPending: boolean
}

/** Decisión pura (sin E/S), para poder probarla. */
export function decideReset(marker: MarkerState | null, hasUsageTraces: boolean): MarkerState {
  if (marker) return marker // ya se decidió en una apertura anterior
  return { resetPending: !hasUsageTraces } // sin marcador: nueva si no hay rastros de uso
}

function readMarker(file: string): MarkerState | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<MarkerState>
    return { resetPending: raw.resetPending === true }
  } catch {
    return null
  }
}

function writeMarker(file: string, state: MarkerState): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state))
  } catch {
    // Sin poder escribir el marcador no se bloquea el arranque.
  }
}

/** Lee o crea el marcador y devuelve si hay una limpieza pendiente. Se llama
 *  al inicio de main.ts, antes de crear la ventana. */
export function initFreshInstall(userDataDir: string): MarkerState {
  const file = path.join(userDataDir, MARKER_FILE)
  const hasTraces = USAGE_TRACES.some((dir) => existsSync(path.join(userDataDir, dir)))
  const state = decideReset(readMarker(file), hasTraces)
  writeMarker(file, state)
  return state
}

/** Tras una limpieza que terminó bien, ya no queda nada pendiente. */
export function markResetDone(userDataDir: string): void {
  writeMarker(path.join(userDataDir, MARKER_FILE), { resetPending: false })
}
