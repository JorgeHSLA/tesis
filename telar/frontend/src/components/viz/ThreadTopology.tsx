// ThreadTopology — SVG ESTÁTICO de la card «Hilos» del idle (frontend-spec §6.2).
// Misma semántica que LiveTopology: con N hilos hay N figuras, t0 (maestro,
// rombo mayor, «t0 · maestro») + t1..t{N-1}. El maestro NO es un nodo aparte:
// es uno de los N y, por defecto, también trabaja (va en la fila del equipo).
// Si el código lo aparta (if tid == 0 / else, lib/masterRole) t0 coordina y se
// dibuja ENCIMA del equipo, con el reparto saliendo de él.
// Tamaño FIJO (el control de % cómputo se eliminó: no existe equivalente
// honesto en OpenMP). Fill plano de tokens (var(--viz-node)/var(--viz-node-master)).
import { figureLabel, layoutFigures, topologyAriaLabel } from '../../lib/threadTopology'

const W = 560
const SIZE = 36 // lado del rombo del equipo
const MASTER_SIZE = 44 // lado del rombo del maestro

/** t0 dentro de la fila (trabaja) o encima del equipo (coordina). */
const FLAT = { H: 150, headY: 70, teamY: 70, busY: 28 }
const STACKED = { H: 200, headY: 44, teamY: 148, busY: 96 }

export interface ThreadTopologyProps {
  threads: number
  /** El código separa a t0 del resto (lib/masterRole): t0 va encima y «coordina». */
  masterCoordinates?: boolean
}

export function ThreadTopology({ threads, masterCoordinates = false }: ThreadTopologyProps) {
  const figures = layoutFigures(threads, W / 2, W - 80, 80, masterCoordinates)
  const head = figures[0]
  const stacked = head.tier === 'head'
  const geo = stacked ? STACKED : FLAT
  // Dónde sale el reparto: por debajo de t0 si está encima; por arriba si está en la fila.
  const startY = stacked ? geo.headY + MASTER_SIZE / 2 + 2 : geo.teamY - MASTER_SIZE / 2 - 2

  // Responsive sin librerías: el alto lo deriva el viewBox (ver LiveTopology).
  return (
    <svg viewBox={`0 0 ${W} ${geo.H}`} width="100%" role="img" aria-label={topologyAriaLabel(figures.length, masterCoordinates)} style={{ display: 'block', height: 'auto' }}>
      {/* Reparto: t0 → cada hilo del equipo (codo por un puente) */}
      {figures.slice(1).map((f) => (
        <path
          key={`c${f.id}`}
          d={`M${head.x} ${startY} L${head.x} ${geo.busY} L${f.x} ${geo.busY} L${f.x} ${geo.teamY - SIZE / 2 - 4}`}
          fill="none"
          stroke="var(--viz-grid)"
          strokeWidth={1.2}
          strokeDasharray="3 4"
        />
      ))}
      {figures.map((f) => {
        const size = f.isMaster ? MASTER_SIZE : SIZE
        const y = f.tier === 'head' ? geo.headY : geo.teamY
        // Con t0 encima, su rótulo va SOBRE la figura: bajo ella cruzaría el reparto.
        const labelY = f.tier === 'head' ? y - MASTER_SIZE / 2 - 10 : y + 40
        return (
          <g key={f.id} data-thread={f.id} data-master={f.isMaster ? 'true' : undefined}>
            <g transform={`translate(${f.x} ${y}) rotate(45)`}>
              <rect
                x={-size / 2}
                y={-size / 2}
                width={size}
                height={size}
                rx={f.isMaster ? 5 : 3}
                fill={f.isMaster ? 'var(--viz-node-master)' : 'var(--viz-node)'}
              />
            </g>
            <text x={f.x} y={y + 4} textAnchor="middle" fontSize={f.isMaster ? 10 : 9} fill="var(--viz-on-node)" fontFamily="var(--font-mono)">
              {f.id}
            </text>
            <text x={f.x} y={labelY} textAnchor="middle" fontSize={9.5} fill="var(--viz-label)" fontFamily="var(--font-mono)">
              {figureLabel(f)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
