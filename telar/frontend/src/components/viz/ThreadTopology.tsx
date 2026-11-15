// ThreadTopology — SVG ESTÁTICO de la card «Reparto de trabajo» del idle
// (frontend-spec §6.2). Misma semántica que LiveTopology: con N hilos hay N
// figuras en UNA fila, t0 (maestro, rombo mayor y «t0 · maestro») + t1..t{N-1}.
// El maestro NO es un nodo aparte: es uno de los N y también trabaja. El fork
// se dibuja como un puente dash desde t0 hacia el resto del equipo.
// Tamaño FIJO (el control de % cómputo se eliminó: no existe equivalente
// honesto en OpenMP). Fill plano de tokens (var(--viz-node)/var(--viz-node-master)).
import { figureLabel, layoutFigures, topologyAriaLabel } from '../../lib/threadTopology'

const W = 560
const H = 150
const ROW_Y = 70
const BUS_Y = 28
const SIZE = 36 // lado del rombo del equipo
const MASTER_SIZE = 44 // lado del rombo del maestro

export interface ThreadTopologyProps {
  threads: number
  /** El código separa a t0 del resto (lib/masterRole): t0 se rotula «coordina». */
  masterCoordinates?: boolean
}

export function ThreadTopology({ threads, masterCoordinates = false }: ThreadTopologyProps) {
  const figures = layoutFigures(threads, W / 2, W - 80, 80, masterCoordinates)
  const master = figures[0]

  // Responsive sin librerías: el alto lo deriva el viewBox (ver LiveTopology).
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={topologyAriaLabel(figures.length, masterCoordinates)} style={{ display: 'block', height: 'auto' }}>
      {/* Fork: t0 → cada hilo del equipo (codo por un puente superior) */}
      {figures.slice(1).map((f) => (
        <path
          key={`c${f.id}`}
          d={`M${master.x} ${ROW_Y - MASTER_SIZE / 2 - 2} L${master.x} ${BUS_Y} L${f.x} ${BUS_Y} L${f.x} ${ROW_Y - SIZE / 2 - 4}`}
          fill="none"
          stroke="var(--viz-grid)"
          strokeWidth={1.2}
          strokeDasharray="3 4"
        />
      ))}
      {figures.map((f) => {
        const size = f.isMaster ? MASTER_SIZE : SIZE
        return (
          <g key={f.id} data-thread={f.id} data-master={f.isMaster ? 'true' : undefined}>
            <g transform={`translate(${f.x} ${ROW_Y}) rotate(45)`}>
              <rect
                x={-size / 2}
                y={-size / 2}
                width={size}
                height={size}
                rx={f.isMaster ? 5 : 3}
                fill={f.isMaster ? 'var(--viz-node-master)' : 'var(--viz-node)'}
              />
            </g>
            <text x={f.x} y={ROW_Y + 4} textAnchor="middle" fontSize={f.isMaster ? 10 : 9} fill="var(--viz-on-node)" fontFamily="var(--font-mono)">
              {f.id}
            </text>
            <text x={f.x} y={ROW_Y + 40} textAnchor="middle" fontSize={9.5} fill="var(--viz-label)" fontFamily="var(--font-mono)">
              {figureLabel(f)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
