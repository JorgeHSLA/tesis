// threadTopology — fuente única de la semántica de figuras de la topología
// (idle `ThreadTopology` y live `LiveTopology`). Regla OpenMP (CU-07.5): con N
// hilos hay EXACTAMENTE N figuras; t0 es el hilo maestro y también trabaja;
// t1..t{N-1} son el resto del equipo. No existe un hilo extra.

export interface ThreadFigure {
  id: string
  /** Posición x dentro del viewBox (fila única centrada). */
  x: number
  isMaster: boolean
}

/** Etiqueta bajo la figura: el maestro se rotula `t0 · maestro`. */
export function figureLabel(figure: ThreadFigure): string {
  return figure.isMaster ? `${figure.id} · maestro` : figure.id
}

/** aria-label común de ambas vistas. */
export function topologyAriaLabel(threads: number): string {
  const n = Math.max(1, Math.floor(threads))
  const noun = n === 1 ? '1 hilo' : `${n} hilos`
  if (n === 1) return `${noun}: t0 (maestro)`
  const rest = n === 2 ? 't1' : `t1 a t${n - 1}`
  return `${noun}: t0 (maestro) y ${rest}`
}

/** N figuras t0..t{N-1} en una sola fila centrada en `centerX`. */
export function layoutFigures(threads: number, centerX: number, availableWidth: number, maxSpacing: number): ThreadFigure[] {
  const n = Math.max(1, Math.floor(threads))
  const spacing = Math.min(maxSpacing, availableWidth / n)
  const startX = centerX - ((n - 1) * spacing) / 2
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}`, x: startX + i * spacing, isMaster: i === 0 }))
}
