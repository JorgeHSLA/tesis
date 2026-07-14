// LiveTopology — reinterpretada (frontend-spec §5.4): misma geometría SVG del
// handoff §5.7 (viewBox 800×280, rombos, codos, dashes, gradientes lg-h/lg-w/
// lg-warn), nueva semántica OpenMP:
// - rombo superior = HILO MAESTRO (`master`); fila inferior = t0..t{N-1}.
// - paquetes naranjas ida / verdes vuelta = accesos a memoria compartida /
//   sincronizaciones — DECORATIVOS (la card lleva la sub-etiqueta
//   `representación didáctica del fork-join`).
// - etiqueta bajo cada hilo: `t{i} · activo` (useSimulation) — SIN % de CPU
//   por hilo (no existe esa medida real y no se inventa; architecture §6).
// - SIN warn-banner fake ni nodo idle fijo del prototipo.
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Hilo maestro y ${n} hilos del equipo (representación didáctica)`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="lg-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3F7A2E" />
          <stop offset="100%" stopColor="#2F5E21" />
        </linearGradient>
        <linearGradient id="lg-w" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6BA850" />
          <stop offset="100%" stopColor="#3F7A2E" />
        </linearGradient>
        <linearGradient id="lg-warn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8A317" />
          <stop offset="100%" stopColor="#A56F0A" />
        </linearGradient>
      </defs>

      {/* Halo pulsante del maestro (decorativo; sin SMIL con reduced-motion) */}
      <circle cx={MASTER.x} cy={MASTER.y} r={38} fill="rgba(63,122,46,0.08)">
        {animate && <animate attributeName="r" values="30;42;30" dur="2s" repeatCount="indefinite" />}
      </circle>

      {threads.map((t, i) => {
        const wx = startX + i * spacing
        const elbow = `M${MASTER.x} ${MASTER.y + 24} L${MASTER.x} 140 L${wx} 140 L${wx} ${ROW_Y - 22}`
        return (
          <g key={t.id}>
            <path d={elbow} fill="none" stroke="#D4C4A0" strokeWidth={1.5} strokeDasharray="3 4" />
            {/* Paquetes ida (naranja) / vuelta (verde): memoria compartida /
                sincronizaciones — decorativos (§5.4). */}
            {animate && (
              <>
                <circle r={3.5} fill="#F57324">
                  <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${(i * 0.25).toFixed(2)}s`} path={elbow} />
                </circle>
                <circle r={3} fill="#6BA850">
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
              <rect x={-18} y={-18} width={36} height={36} rx={4} fill="url(#lg-w)" opacity={0.55 + t.activity * 0.45} />
            </g>
            <text x={wx} y={ROW_Y + 4} textAnchor="middle" fontSize={9} fill="#F9EFD9" fontFamily="var(--font-mono)">
              {t.id}
            </text>
            <text x={wx} y={ROW_Y + 42} textAnchor="middle" fontSize={10} fill="#3D3125" fontFamily="var(--font-mono)">
              {t.id}
              {running ? ' · activo' : ''}
            </text>
          </g>
        )
      })}

      {/* Rombo del hilo maestro (44×44) */}
      <g transform={`translate(${MASTER.x} ${MASTER.y}) rotate(45)`}>
        <rect x={-22} y={-22} width={44} height={44} rx={5} fill="url(#lg-h)" />
      </g>
      <text x={MASTER.x} y={MASTER.y + 5} textAnchor="middle" fontSize={10} fill="#F9EFD9" fontFamily="var(--font-mono)">
        master
      </text>
      <text x={MASTER.x} y={MASTER.y - 32} textAnchor="middle" fontSize={11} fill="#3D3125" fontFamily="var(--font-mono)">
        hilo maestro
      </text>
    </svg>
  )
}
