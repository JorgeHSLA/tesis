// lib/replay.ts — lógica PURA del reproductor de la ejecución («como un editor de
// video»: pausar, retroceder, saltar a un momento, cambiar la velocidad).
//
// Es SOLO visual y no toca la ejecución real ni sus métricas: cuando el job
// termina, la pantalla ya tiene en memoria lo que llegó por el WebSocket (líneas
// de salida con su hora y muestras de CPU/memoria con su hora). Reproducir es
// volver a mostrar esos mismos datos hasta el instante elegido. Nada se
// recalcula ni se inventa; lo único «sintético» es el movimiento de la
// ilustración de hilos, y ese ya estaba rotulado como «ilustración».
import type { LogLine, MetricSample } from '../stores/jobStore'

const parse = (ts: string): number => {
  const n = Date.parse(ts)
  return Number.isFinite(n) ? n : NaN
}

export interface Timeline {
  /** Epoch ms del primer dato recibido (instante 0 del reproductor). */
  t0: number
  /** Duración total en ms. */
  duration: number
}

/**
 * Línea de tiempo de una ejecución: empieza en el primer dato recibido y dura lo
 * que dice el servidor (`wall_time_ms`) o hasta el último dato, lo que sea más
 * largo. Sin datos ni duración → duración 0 (no hay nada que reproducir).
 */
export function timelineOf(
  logs: readonly Pick<LogLine, 'ts'>[],
  metrics: readonly Pick<MetricSample, 'ts'>[],
  wallTimeMs: number | null,
): Timeline {
  const stamps = [...logs.map((l) => parse(l.ts)), ...metrics.map((m) => parse(m.ts))].filter(Number.isFinite)
  if (stamps.length === 0) return { t0: 0, duration: Math.max(0, wallTimeMs ?? 0) }
  const t0 = Math.min(...stamps)
  const last = Math.max(...stamps)
  return { t0, duration: Math.max(last - t0, wallTimeMs ?? 0, 0) }
}

/** Líneas de salida que ya habían aparecido en el instante `timeMs`. */
export function logsUntil<T extends Pick<LogLine, 'ts'>>(logs: readonly T[], t0: number, timeMs: number): T[] {
  return logs.filter((l) => parse(l.ts) - t0 <= timeMs)
}

/** Muestras de CPU/memoria tomadas hasta el instante `timeMs`. */
export function metricsUntil<T extends Pick<MetricSample, 'ts'>>(metrics: readonly T[], t0: number, timeMs: number): T[] {
  return metrics.filter((m) => parse(m.ts) - t0 <= timeMs)
}

/** La última muestra a esa altura, o `null` si todavía no había ninguna. */
export function metricAt<T extends Pick<MetricSample, 'ts'>>(metrics: readonly T[], t0: number, timeMs: number): T | null {
  const until = metricsUntil(metrics, t0, timeMs)
  return until.length > 0 ? until[until.length - 1] : null
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Actividad (0..1) del hilo `index` en el instante `timeMs`, para el anillo de la
 * ilustración de hilos: la CPU REAL de la muestra más reciente repartida a partes
 * iguales entre los hilos (es lo único que se mide: docker stats da la CPU del
 * contenedor entero, no la de cada hilo). Sin ondulaciones ni azar: misma
 * entrada, mismo resultado.
 */
export function threadActivity(cpuPercent: number | null, threads: number): number {
  return cpuPercent == null ? 0.2 : clamp(cpuPercent / (Math.max(1, threads) * 100), 0.15, 0.98)
}

/** «0:03.2» — minutos:segundos.décimas. */
export function fmtClock(ms: number): string {
  const safe = Math.max(0, ms)
  const totalTenths = Math.floor(safe / 100)
  const tenths = totalTenths % 10
  const totalSec = Math.floor(totalTenths / 10)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}.${tenths}`
}

/** Velocidades del deslizante: de 0.25× a 4×, de 0.25 en 0.25. */
export const SPEED_MIN = 0.25
export const SPEED_MAX = 4
export const SPEED_STEP = 0.25

export const fmtSpeed = (s: number): string => `${Number.isInteger(s) ? s : s.toFixed(2).replace(/0$/, '')}×`
