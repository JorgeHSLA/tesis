// sweepParse.ts — parseo PRESENTACIONAL en vivo de los logs de ejemplos sweep
// (frontend-spec §6.3, SweepProgressCard) usando EXACTAMENTE los regex de
// architecture.md §7.2. El `parsed_timings` autoritativo sigue siendo del
// backend (decisión 8): esto solo pinta el progreso `hilos = 1 · ✓ 0.726 s`.
import type { ParserId } from '../../api/types'

/** Regex por línea de architecture.md §7.2 (solo los sweep). */
export const SWEEP_REGEX = {
  sweep_pi: /hilos = (\d+) \| pi = ([\d.]+) \| tiempo = ([\d.]+) s/,
  sweep_transporte:
    /hilos = (\d+) \| tiempo = ([\d.]+) s \| transmitidas: ([\d.]+) % \| reflejadas: ([\d.]+) % \| absorbidas: ([\d.]+) %/,
} as const

export type SweepParserId = keyof typeof SWEEP_REGEX

export function isSweepParser(parserId: ParserId): parserId is SweepParserId {
  return parserId === 'sweep_pi' || parserId === 'sweep_transporte'
}

/** Casos que barren los 3 ejemplos sweep (architecture §7.1). */
export const SWEEP_CASES = [1, 2, 4, 8] as const

/** stdout parseado en vivo → mapa hilos → tiempo (s). */
export function parseSweepTimes(lines: readonly string[], parserId: SweepParserId): Map<number, number> {
  const regex = SWEEP_REGEX[parserId]
  const timeGroup = parserId === 'sweep_pi' ? 3 : 2
  const out = new Map<number, number>()
  for (const line of lines) {
    const m = regex.exec(line)
    if (m != null) out.set(Number(m[1]), Number(m[timeGroup]))
  }
  return out
}
