// lib/format.ts — formateadores compartidos (frontend-spec §1, §8.4).
// Formato de tiempo del handoff: `2m 14s` / `0m 35s` (segundos a 2 dígitos).

/** Segundos → `"2m 14s"` (formato literal del prototipo). */
export function fmtTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const rest = String(s % 60).padStart(2, '0')
  return `${m}m ${rest}s`
}

/** Milisegundos (p. ej. `wall_time_ms`) → `"2m 14s"`. */
export function fmtTimeMs(ms: number): string {
  return fmtTime(ms / 1000)
}

/** Bytes → `"512 B" | "1.2 KB" | "38.4 MB" | "1.02 GB"`. */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** Porcentaje ya en escala 0..100 (cpu_percent puede superar 100). */
export function fmtPct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** ISO-8601 → relativo en español: `ahora` / `hace 5 min` / `hace 1 h` / `hace 2 d`. */
export function fmtRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffSec = Math.max(0, Math.floor((now.getTime() - then) / 1000))
  if (diffSec < 60) return 'ahora'
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `hace ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} d`
}

/**
 * Decimación por buckets (media por bucket) para las gráficas en vivo
 * (frontend-spec §8.4: máx ~900 muestras → ~260 puntos). Genérica: el caller
 * aporta el reductor del bucket (p. ej. media de cada campo del MetricSample).
 */
export function decimate<T>(items: readonly T[], target: number, reduceBucket: (bucket: T[]) => T): T[] {
  if (target <= 0 || items.length <= target) return [...items]
  const out: T[] = []
  const size = items.length / target
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * size)
    const end = Math.max(start + 1, Math.floor((i + 1) * size))
    out.push(reduceBucket(items.slice(start, end)))
  }
  return out
}

/** Atajo para series numéricas: media por bucket. */
export function decimateNumbers(values: readonly number[], target: number): number[] {
  return decimate(values, target, (bucket) => bucket.reduce((a, b) => a + b, 0) / bucket.length)
}
