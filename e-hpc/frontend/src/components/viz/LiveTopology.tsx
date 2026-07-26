// LiveTopology — reinterpretada (frontend-spec §5.4): misma geometría SVG del
// handoff §5.7 (viewBox 800×280, rombos, codos, dashes), nueva semántica OpenMP:
// - rombo superior = HILO MAESTRO (`master`); fila inferior = t0..t{N-1}.
// - paquetes terracota ida (var(--viz-packet)) / marrón vuelta (var(--viz-node)) =
//   accesos a memoria compartida / sincronizaciones — DECORATIVOS (la card
//   lleva la sub-etiqueta `representación didáctica del fork-join`).
// - etiqueta bajo cada hilo: `t{i} · activo` (useSimulation) — SIN % de CPU
//   por hilo (no existe esa medida real y no se inventa; architecture §6).
// - SIN warn-banner fake ni nodo idle fijo del prototipo.
// - Rombos con fill plano de tokens (los gradientes verdes del handoff se
//   retiraron en el rediseño 2026-07).
// - SMIL (<animateMotion>/<animate>) SOLO si !reducedMotion (render condicional).
import type { DecorNode } from '../../hooks/useSimulation'

const W = 800
const H = 280
const MASTER = { x: 400, y: 60 }
const ROW_Y = 190

export interface LiveTopologyProps {
  /** Nodos decorativos de useSimulation (master + t0..tN-1). */
  nodes: DecorNode[]
  /** true mientras el job corre (paquetes + etiqueta `activo`). */
  running: boolean
  reducedMotion: boolean
}

export function LiveTopology({ nodes, running, reducedMotion }: LiveTopologyProps) {
  const threads = nodes.filter((n) => n.kind === 'thread')
  const n = Math.max(1, threads.length)
  const spacing = Math.min(100, 720 / n)
  const startX = MASTER.x - ((n - 1) * spacing) / 2
  const animate = running && !reducedMotion

  // Responsive sin librerías: viewBox + width 100% y SIN alto fijo, para que el
  // alto se derive de la proporción. Con `height={H}` fijo el dibujo se encogía
  // (preserveAspectRatio "meet") y dejaba franja vertical vacía en contenedores
  // estrechos.
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Hilo maestro y ${n} hilos del equipo (representación didáctica)`} style={{ display: 'block', height: 'auto' }}>
      {/* Halo pulsante del maestro (decorativo; sin SMIL con reduced-motion) */}
      <circle cx={MASTER.x} cy={MASTER.y} r={38} fill="var(--viz-node)" fillOpacity={0.08}>
        {animate && <animate attributeName="r" values="30;42;30" dur="2s" repeatCount="indefinite" />}
      </circle>

      {threads.map((t, i) => {
        const wx = startX + i * spacing
        const elbow = `M${MASTER.x} ${MASTER.y + 24} L${MASTER.x} 140 L${wx} 140 L${wx} ${ROW_Y - 22}`
        return (
          <g key={t.id}>
            <path d={elbow} fill="none" stroke="var(--viz-grid)" strokeWidth={1.5} strokeDasharray="3 4" />
            {/* Paquetes ida (terracota) / vuelta (marrón): memoria compartida /
                sincronizaciones — decorativos (§5.4). */}
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
            {/* Rombo del hilo (36×36) */}
            <g transform={`translate(${wx} ${ROW_Y}) rotate(45)`}>
              <rect x={-18} y={-18} width={36} height={36} rx={4} fill="var(--viz-node)" opacity={0.55 + t.activity * 0.45} />
            </g>
            <text x={wx} y={ROW_Y + 4} textAnchor="middle" fontSize={9} fill="var(--viz-on-node)" fontFamily="var(--font-mono)">
              {t.id}
            </text>
            <text x={wx} y={ROW_Y + 42} textAnchor="middle" fontSize={10} fill="var(--viz-label)" fontFamily="var(--font-mono)">
              {t.id}
              {running ? ' · activo' : ''}
            </text>
          </g>
        )
      })}

      {/* Rombo del hilo maestro (44×44) */}
      <g transform={`translate(${MASTER.x} ${MASTER.y}) rotate(45)`}>
        <rect x={-22} y={-22} width={44} height={44} rx={5} fill="var(--viz-node-master)" />
      </g>
      <text x={MASTER.x} y={MASTER.y + 5} textAnchor="middle" fontSize={10} fill="var(--viz-on-node)" fontFamily="var(--font-mono)">
        master
      </text>
      <text x={MASTER.x} y={MASTER.y - 32} textAnchor="middle" fontSize={11} fill="var(--viz-label)" fontFamily="var(--font-mono)">
        hilo maestro
      </text>
    </svg>
  )
}
