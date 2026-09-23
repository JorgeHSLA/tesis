// lib/savedConfigs — «Mis configuraciones» del simulador (CU-32.1), solo en
// localStorage (sin backend). Todo acceso va en try/catch: sin almacenamiento
// (modo privado, cuota) la lista queda vacía y guardar devuelve null.
import type { SimConfig } from './simConfig'

export const SAVED_CONFIGS_KEY = 'telar.savedConfigs'
const DEFAULT_NAME = 'Configuración sin nombre'

export interface SavedConfig extends SimConfig {
  id: string
  name: string
  saved_at: string
}

export interface SavedConfigInput extends SimConfig {
  name: string
}

function isSavedConfig(v: unknown): v is SavedConfig {
  if (v == null || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.saved_at === 'string' &&
    (c.example_id === null || typeof c.example_id === 'string') &&
    typeof c.code === 'string' &&
    typeof c.filename === 'string' &&
    typeof c.threads === 'number' &&
    typeof c.timeout_s === 'number' &&
    typeof c.edited === 'boolean'
  )
}

function read(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(SAVED_CONFIGS_KEY)
    if (raw == null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSavedConfig) : []
  } catch {
    return []
  }
}

function write(configs: readonly SavedConfig[]): boolean {
  try {
    localStorage.setItem(SAVED_CONFIGS_KEY, JSON.stringify(configs))
    return true
  } catch {
    return false
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Más reciente primero. Cada llamada devuelve objetos nuevos. */
export function listSavedConfigs(): SavedConfig[] {
  return read()
}

export function saveConfig(input: SavedConfigInput, now: Date = new Date()): SavedConfig | null {
  const saved: SavedConfig = {
    id: newId(),
    name: input.name.trim() || DEFAULT_NAME,
    saved_at: now.toISOString(),
    example_id: input.example_id,
    code: input.code,
    filename: input.filename,
    threads: input.threads,
    timeout_s: input.timeout_s,
    edited: input.edited,
  }
  return write([saved, ...read()]) ? saved : null
}

export function renameSavedConfig(id: string, name: string): boolean {
  const configs = read()
  if (!configs.some((c) => c.id === id)) return false
  const next = configs.map((c) => (c.id === id ? { ...c, name: name.trim() || DEFAULT_NAME } : c))
  return write(next)
}

export function deleteSavedConfig(id: string): boolean {
  const configs = read()
  if (!configs.some((c) => c.id === id)) return false
  return write(configs.filter((c) => c.id !== id))
}
