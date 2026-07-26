// HomeMasterWorkers — hero de Home: el hilo maestro reparte trabajo a t0..t3.
// Port a SVG + @keyframes de la animación «Master y Workers» (bundle DC/React
// original: HTML absoluto + CSS). Se porta en vez de embeberse porque el
// bundle necesitaba `unsafe-eval` (@babel/standalone en runtime) y ~250 KB;
// esto son ~7 KB y no toca la CSP (`script-src 'self'`).
//
// COLOR: cero hex. Todo sale de tokens.css vía var(--viz-*), así que el tema
// oscuro (data-theme) lo conmuta el CSS sin JavaScript.
// MOTION: los @keyframes los suprime la regla global de base.css §5.3; los
// pulsos SMIL no la obedecen, así que se ocultan con useReducedMotion — el
// resultado es el mismo diagrama, quieto, sirviendo de póster estático.
import { useReducedMotion } from '../../hooks/useReducedMotion'

/** Centros de los 4 hilos en el espacio del viewBox. */
const WORKERS = [
  { x: 120, label: 't0' },
  { x: 273, label: 't1' },
  { x: 427, label: 't2' },
  { x: 580, label: 't3' },
] as const

const MASTER_X = 350
const MASTER_Y = 160
const WORKER_Y = 345
/** Ciclo completo fork→join, compartido por todos los @keyframes y el SMIL. */
const CYCLE = '3.6s'

/** Codo maestro→hilo: baja del rombo, reparte en horizontal y entra al hilo. */
function elbowPath(x: number): string {
  return `M${MASTER_X},214 L${MASTER_X},270 L${x},270 L${x},301`
}

/** Rombo = cuadrado redondeado girado 45°, centrado en (cx, cy). */
function Diamond({ cx, cy, size, radius, fill }: { cx: number; cy: number; size: number; radius: number; fill: string }) {
  return (
    <rect
      x={-size / 2}
      y={-size / 2}
      width={size}
      height={size}
      rx={radius}
      fill={fill}
      transform={`translate(${cx},${cy}) rotate(45)`}
    />
  )
}

/** Carita: dos ojos que parpadean + boca. Se dibuja SIN rotar (fuera del rombo). */
function Face({ cx, cy, scale, blinkDelay }: { cx: number; cy: number; scale: number; blinkDelay: string }) {
  const eyeR = 3 * scale
  const eyeDx = 5.5 * scale
  const eyeY = cy - 3 * scale
  return (
    <g fill="var(--viz-on-node)" aria-hidden="true">
      <circle className="mw-eye" cx={cx - eyeDx} cy={eyeY} r={eyeR} style={{ animationDelay: blinkDelay }} />
      <circle className="mw-eye" cx={cx + eyeDx} cy={eyeY} r={eyeR} style={{ animationDelay: blinkDelay }} />
      <path
        d={`M${cx - 3.5 * scale},${cy + 4 * scale} q${3.5 * scale},${3 * scale} ${7 * scale},0`}
        fill="none"
        stroke="var(--viz-on-node)"
        strokeWidth={1.3 * scale}
        strokeLinecap="round"
      />
    </g>
  )
}

export interface HomeMasterWorkersProps {
  /** Caritas en los rombos (guiño del diseño original). */
  faces?: boolean
}

export function HomeMasterWorkers({ faces = true }: HomeMasterWorkersProps) {
  const reduced = useReducedMotion()

  return (
    <svg
      className="mw"
      viewBox="60 72 580 353"
      width="100%"
      role="img"
      aria-label="Modelo fork-join animado: un hilo maestro reparte trabajo a 4 hilos (t0 a t3)"
      data-testid="home-fork-join-anim"
      style={{ display: 'block', height: 'auto' }}
    >
      <g className="mw-float">
        {/* Codos punteados maestro→hilos */}
        <g
          className="mw-links"
          stroke="var(--viz-grid)"
          strokeWidth={2}
          strokeDasharray="5 6"
          strokeLinecap="round"
          fill="none"
        >
          {WORKERS.map((w) => (
            <path key={`link-${w.x}`} d={elbowPath(w.x)} />
          ))}
        </g>

        {/* Nodos de reparto: laten en el instante en que el maestro emite */}
        {WORKERS.map((w, i) => (
          <circle
            key={`hub-${w.x}`}
            className="mw-hub"
            cx={w.x}
            cy={270}
            r={5}
            fill="var(--viz-packet)"
            style={{ animationDelay: `${(1.6 + i * 0.1).toFixed(1)}s` }}
          />
        ))}

        {/* Paquetes viajeros (SMIL): el CSS de reduced-motion no los detiene */}
        {!reduced &&
          WORKERS.map((w) => (
            <circle key={`pkt-${w.x}`} r={4.5} fill="var(--viz-packet)" opacity={0}>
              <animate
                attributeName="opacity"
                dur={CYCLE}
                repeatCount="indefinite"
                values="0;1;1;0;0"
                keyTimes="0;0.04;0.40;0.45;1"
              />
              <animateMotion
                dur={CYCLE}
                repeatCount="indefinite"
                path={elbowPath(w.x)}
                calcMode="linear"
                keyPoints="0;1;1"
                keyTimes="0;0.45;1"
              />
            </circle>
          ))}

        {/* Hilo maestro */}
        <text
          x={MASTER_X}
          y={97}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize={19}
          fill="var(--viz-label)"
        >
          master
        </text>
        <g className="mw-pop" style={{ animationDelay: '0.1s' }}>
          <g className="mw-send">
            <Diamond cx={MASTER_X} cy={MASTER_Y} size={74} radius={16} fill="var(--viz-node-master)" />
            {faces && <Face cx={MASTER_X} cy={MASTER_Y} scale={1} blinkDelay="0s" />}
          </g>
        </g>
        <text
          className="mw-heart"
          x={MASTER_X}
          y={100}
          textAnchor="middle"
          fontSize={16}
          fill="var(--viz-packet)"
          aria-hidden="true"
        >
          ♥
        </text>

        {/* Hilos t0..t3 */}
        {WORKERS.map((w, i) => (
          <g key={`w-${w.x}`}>
            <g className="mw-pop" style={{ animationDelay: `${(0.35 + i * 0.12).toFixed(2)}s` }}>
              <g className="mw-catch">
                <Diamond cx={w.x} cy={WORKER_Y} size={60} radius={13} fill="var(--viz-node)" />
                {faces && (
                  <Face cx={w.x} cy={WORKER_Y} scale={0.82} blinkDelay={`${(i * 0.7).toFixed(1)}s`} />
                )}
              </g>
            </g>
            <text
              x={w.x}
              y={406}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={19}
              fill="var(--viz-label)"
            >
              {w.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}
