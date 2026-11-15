// LiveTopology — reinterpretada (frontend-spec §5.4): misma geometría SVG del
// handoff §5.7 (rombos, codos, dashes), nueva semántica OpenMP:
// - N hilos = N figuras en UNA fila (misma regla y mismo layout que el idle,
//   lib/threadTopology). t0 es el hilo MAESTRO (rombo mayor, «t0 · maestro») y
//   también trabaja; t1..t{N-1} son el resto del equipo. No hay hilo extra ni
//   nodo aparte encima del equipo (CU-07.5).
// - paquetes terracota ida (var(--viz-packet)) / marrón vuelta (var(--viz-node)) =
//   accesos a memoria compartida / sincronizaciones — DECORATIVOS (la card
//   lleva la sub-etiqueta `representación didáctica del fork-join`). Salen de
//   t0 hacia el equipo.
// - etiqueta bajo cada hilo: `t{i} · activo` (useSimulation) — SIN % de CPU
//   por hilo (no existe esa medida real y no se inventa; architecture §6).
// - Rombos con fill plano de tokens.
// - SMIL (<animateMotion>/<animate>) SOLO si !reducedMotion (render condicional).
import type { DecorNode } from '../../hooks/useSimulation'
import { figureLabel, layoutFigures, topologyAriaLabel } from '../../lib/threadTopology'

const W = 800
const H = 220
const ROW_Y = 110
const BUS_Y = 52
const SIZE = 36
const MASTER_SIZE = 44

export interface LiveTopologyProps {
  /** Nodos decorativos de useSimulation (t0 maestro + t1..tN-1): N en total. */
  nodes: DecorNode[]
  /** true mientras el job corre (paquetes + etiqueta `activo`). */
  running: boolean
  reducedMotion: boolean
  /** El código separa a t0 del resto (lib/masterRole): t0 se rotula «coordina». */
  masterCoordinates?: boolean
}

export function LiveTopology({ nodes, running, reducedMotion, masterCoordinates = false }: LiveTopologyProps) {
  const figures = layoutFigures(nodes.length, W / 2, 720, 100, masterCoordinates)
  const master = figures[0]
  const animate = running && !reducedMotion
  const activityOf = (index: number): number => nodes[index]?.activity ?? 0.5

  // Responsive sin librerías: viewBox + width 100% y SIN alto fijo, para que el
  // alto se derive de la proporción.
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={topologyAriaLabel(figures.length, masterCoordinates)} style={{ display: 'block', height: 'auto' }}>
      {/* Halo pulsante del maestro (decorativo; sin SMIL con reduced-motion) */}
      <circle cx={master.x} cy={ROW_Y} r={38} fill="var(--viz-node)" fillOpacity={0.08}>
        {animate && <animate attributeName="r" values="30;42;30" dur="2s" repeatCount="indefinite" />}
      </circle>

      {/* Fork: t0 → resto del equipo, con paquetes decorativos ida/vuelta */}
      {figures.slice(1).map((f, i) => {
        const elbow = `M${master.x} ${ROW_Y - MASTER_SIZE / 2 - 2} L${master.x} ${BUS_Y} L${f.x} ${BUS_Y} L${f.x} ${ROW_Y - SIZE / 2 - 4}`
        return (
          <g key={`c${f.id}`}>
            <path d={elbow} fill="none" stroke="var(--viz-grid)" strokeWidth={1.5} strokeDasharray="3 4" />
            {animate && (
              <>
                <circle r={3.5} fill="var(--viz-packet)">
                  <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${(i * 0.25).toFixed(2)}s`} path={elbow} />
                </circle>
                <circle r={3} fill="var(--viz-node)">
                  <animateMotion
                    dur="1.8s"
                    repeatCount="indefinite"
                    begin={`${(i * 0.25 + 0.9).toFixed(2)}s`}
                    keyPoints="1;0"
                    keyTimes="0;1"
                    calcMode="linear"
                    path={elbow}
                  />
                </circle>
              </>
            )}
          </g>
        )
      })}

      {figures.map((f, i) => {
        const size = f.isMaster ? MASTER_SIZE : SIZE
        return (
          <g key={f.id} data-thread={f.id} data-master={f.isMaster ? 'true' : undefined}>
            {/* El relleno va SIEMPRE opaco: la actividad se expresa con un anillo
                terracota. Atenuando el relleno la etiqueta caía por debajo de AA. */}
            <g transform={`translate(${f.x} ${ROW_Y}) rotate(45)`}>
              <rect
                x={-size / 2}
                y={-size / 2}
                width={size}
                height={size}
                rx={f.isMaster ? 5 : 4}
                fill={f.isMaster ? 'var(--viz-node-master)' : 'var(--viz-node)'}
              />
              <rect
                x={-size / 2}
                y={-size / 2}
                width={size}
                height={size}
                rx={f.isMaster ? 5 : 4}
                fill="none"
                stroke="var(--viz-packet)"
                strokeWidth={2.5}
                opacity={activityOf(i)}
              />
            </g>
            <text x={f.x} y={ROW_Y + 4} textAnchor="middle" fontSize={f.isMaster ? 10 : 9} fill="var(--viz-on-node)" fontFamily="var(--font-mono)">
              {f.id}
            </text>
            <text x={f.x} y={ROW_Y + 44} textAnchor="middle" fontSize={10} fill="var(--viz-label)" fontFamily="var(--font-mono)">
              {figureLabel(f)}
              {running ? ' · activo' : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
