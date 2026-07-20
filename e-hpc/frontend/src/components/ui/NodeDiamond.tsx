// NodeDiamond — rombo 18×18 del handoff (§5.8, running.jsx literal), con la
// paleta de tokens: warn var(--viz-node-warn), master var(--viz-node-master),
// hilo (worker) var(--viz-node).
export interface NodeDiamondProps {
  /** Semántica OpenMP (frontend-spec §5.4): master = hilo maestro. */
  kind?: 'master' | 'thread' | 'warn'
  size?: number
}

const COLORS: Record<NonNullable<NodeDiamondProps['kind']>, string> = {
  warn: 'var(--viz-node-warn)',
  master: 'var(--viz-node-master)',
  thread: 'var(--viz-node)',
}

export function NodeDiamond({ kind = 'thread', size = 18 }: NodeDiamondProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        transform: 'rotate(45deg)',
        background: COLORS[kind],
        borderRadius: 3,
        flexShrink: 0,
      }}
    />
  )
}
