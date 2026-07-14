// HomeThreadsDiagram — SVG animado del hero, port del HomeClusterDiagram del
// handoff (§4.4) con labels adaptados a OpenMP: `master` y `t0..t3`
// (frontend-spec §6.1). SMIL portado tal cual, SIN el setInterval redundante
// (el estado React `pulse` del prototipo quedaba anulado por el <animate>).
// Con prefers-reduced-motion los paquetes SMIL no se renderizan (§5.3).
import { useReducedMotion } from '../../hooks/useReducedMotion'

const WORKERS_X = [70, 170, 270, 370] as const

/** Codo head→worker_i del handoff: M220 80 L220 130 L{x} 130 L{x} 175. */
function elbowPath(x: number): string {
  return `M220 80 L220 130 L${x} 130 L${x} 175`
}

export function HomeThreadsDiagram() {
  const reduced = useReducedMotion()

  return (
    <svg viewBox="0 0 440 260" width="100%" height="100%" role="img" aria-label="Modelo fork-join: un hilo maestro reparte trabajo a 4 hilos">
      <defs>
        <linearGradient id="hg-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3F7A2E" />
          <stop offset="100%" stopColor="#2F5E21" />
        </linearGradient>
        <linearGradient id="hg-w" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6BA850" />
          <stop offset="100%" stopColor="#3F7A2E" />
        </linearGradient>
      </defs>

      {/* Hilo maestro (rombo verde superior) */}
      <text x={220} y={35} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10} fill="#5C4A39">
        master
      </text>
      <g transform="translate(220,60) rotate(45)">
        <rect x={-22} y={-22} width={44} height={44} rx={4} fill="url(#hg-head)" />
      </g>

      {/* Líneas de conexión en codo */}
      {WORKERS_X.map((x) => (
        <path key={`line-${x}`} d={elbowPath(x)} stroke="#D4C4A0" strokeWidth={1.5} strokeDasharray="3 4" fill="none" />
      ))}

      {/* Hilos t0..t3 (rombos) */}
      {WORKERS_X.map((x, i) => (
        <g key={`w-${x}`}>
          <g transform={`translate(${x},180) rotate(45)`}>
            <rect x={-18} y={-18} width={36} height={36} rx={4} fill="url(#hg-w)" />
          </g>
          <text x={x} y={222} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10} fill="#5C4A39">
            {`t${i}`}
          </text>
        </g>
      ))}

      {/* Paquetes viajeros (SMIL): pulso naranja master→t_i, ciclo 3.6 s */}
      {!reduced &&
        WORKERS_X.map((x, i) => (
          <circle key={`pkt-${x}`} r={4} fill="#F57324" opacity={0}>
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="0.9s"
              repeatCount="indefinite"
              begin={`${(i * 0.9).toFixed(1)}s`}
            />
            <animateMotion dur="0.9s" repeatCount="indefinite" begin={`${(i * 0.9).toFixed(1)}s`} path={elbowPath(x)} />
          </circle>
        ))}
    </svg>
  )
}
