// ThreadTopology — SVG ESTÁTICO de la card «Reparto de trabajo» del idle
// (frontend-spec §6.2; geometría del handoff §5.4 reinterpretada §5.4 del
// spec): rombo superior = hilo maestro `master`, fila inferior = t0..t{N-1}.
// Tamaño FIJO 36 px (el control de % cómputo se eliminó: no existe un
// equivalente honesto en OpenMP). Rombos con fill plano de tokens
// (var(--viz-node)/var(--viz-node-master)); conexiones en codo dash
// var(--viz-grid); labels var(--viz-label).

const W = 560
const H = 200
const MASTER = { x: 280, y: 40 }
const ROW_Y = 140
const SIZE = 36 // lado del rombo (fijo, §6.2)

export interface ThreadTopologyProps {
  threads: number
}

export function ThreadTopology({ threads }: ThreadTopologyProps) {
  const n = Math.max(1, threads)
  const spacing = Math.min(80, (W - 80) / n)
  const startX = MASTER.x - ((n - 1) * spacing) / 2
  const xs = Array.from({ length: n }, (_, i) => startX + i * spacing)

  // Responsive sin librerías: el alto lo deriva el viewBox (ver LiveTopology).
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Hilo maestro y ${n} hilos del equipo`} style={{ display: 'block', height: 'auto' }}>
      {/* Conexiones en codo (handoff §5.4): master → cada hilo */}
      {xs.map((wx) => (
        <path
          key={`c${wx}`}
          d={`M${MASTER.x} ${MASTER.y + 22} L${MASTER.x} 100 L${wx} 100 L${wx} ${ROW_Y - 18}`}
          fill="none"
          stroke="var(--viz-grid)"
          strokeWidth={1.2}
          strokeDasharray="3 4"
        />
      ))}
      {/* Hilo maestro */}
      <g transform={`translate(${MASTER.x} ${MASTER.y}) rotate(45)`}>
        <rect x={-20} y={-20} width={40} height={40} rx={4} fill="var(--viz-node-master)" />
      </g>
      <text x={MASTER.x} y={MASTER.y + 4} textAnchor="middle" fontSize={10} fill="var(--viz-on-node)" fontFamily="var(--font-mono)">
        master
      </text>
      <text x={MASTER.x} y={MASTER.y - 26} textAnchor="middle" fontSize={10} fill="var(--viz-label)" fontFamily="var(--font-mono)">
        hilo maestro
      </text>
      {/* Hilos del equipo t0..tN-1 (rombos fijos 36px) */}
      {xs.map((wx, i) => (
        <g key={`t${i}`}>
          <g transform={`translate(${wx} ${ROW_Y}) rotate(45)`}>
            <rect x={-SIZE / 2} y={-SIZE / 2} width={SIZE} height={SIZE} rx={3} fill="var(--viz-node)" />
          </g>
          <text x={wx} y={ROW_Y + 4} textAnchor="middle" fontSize={9} fill="var(--viz-on-node)" fontFamily="var(--font-mono)">
            t{i}
          </text>
          <text x={wx} y={ROW_Y + 34} textAnchor="middle" fontSize={9.5} fill="var(--viz-label)" fontFamily="var(--font-mono)">
            t{i}
          </text>
        </g>
      ))}
    </svg>
  )
}
