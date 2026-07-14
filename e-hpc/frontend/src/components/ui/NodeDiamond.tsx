// NodeDiamond — rombo 18×18 del handoff (§5.8, running.jsx literal):
// warn #E8A317, master (head) #2F5E21, hilo (worker) #3F7A2E.
export interface NodeDiamondProps {
  /** Semántica OpenMP (frontend-spec §5.4): master = hilo maestro. */
  kind?: 'master' | 'thread' | 'warn'
  size?: number
}

const COLORS: Record<NonNullable<NodeDiamondProps['kind']>, string> = {
  warn: '#E8A317',
  master: '#2F5E21',
  thread: '#3F7A2E',
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
