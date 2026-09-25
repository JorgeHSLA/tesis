// ThreadsTable — card «Detalle por hilo» del live (frontend-spec §6.3),
// honesta con lo medible: Actividad y Estado son DECORATIVOS (CU-07.5). La
// actividad sale de useSimulation y el Estado repite la fase del JOB en cada
// fila: docker no mide hilos, así que ambos llevan la sub-etiqueta. N filas
// para N hilos: t0 es el hilo maestro.
import { Card, CardHead } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { MiniBar } from '../../components/ui/MiniBar'
import { NodeDiamond } from '../../components/ui/NodeDiamond'
import { IconLayers } from '../../components/icons/icons'
import type { DecorNode } from '../../hooks/useSimulation'
import { isTerminalPhase, type UiPhase } from '../../stores/jobStore'

export interface ThreadsTableProps {
  nodes: DecorNode[]
  phase: UiPhase
}

export function ThreadsTable({ nodes, phase }: ThreadsTableProps) {
  const running = phase === 'running'
  const terminal = isTerminalPhase(phase)
  return (
    <Card style={{ marginTop: 20 }}>
      <CardHead
        icon={<IconLayers size={16} />}
        title="Detalle por hilo"
        right={<span className="mono-small">actividad y estado ilustrativos</span>}
      />
      <div className="threads-table" role="table" aria-label="Detalle por hilo">
        <div className="threads-table-head" role="row">
          <span role="columnheader">Hilo</span>
          <span role="columnheader">Rol</span>
          <span role="columnheader">
            Actividad <span className="threads-table-sub">ilustrativa</span>
          </span>
          <span role="columnheader">
            Estado <span className="threads-table-sub">ilustrativo</span>
          </span>
        </div>
        {nodes.map((n) => (
          <div key={n.id} className="threads-table-row" role="row">
            <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <NodeDiamond kind={n.kind} />
              <span className="mono-small">{n.id}</span>
            </span>
            <span role="cell" className="mono-small">
              {n.kind === 'master' ? 'hilo maestro' : 'hilo del equipo'}
            </span>
            <span role="cell">
              <MiniBar pct={n.activity * 100} color={n.kind === 'master' ? 'var(--viz-node-master)' : 'var(--viz-node)'} />
            </span>
            <span role="cell">
              {running ? (
                <Chip tone="green">activo</Chip>
              ) : terminal ? (
                <Chip>terminado</Chip>
              ) : (
                <Chip tone="orange">preparando</Chip>
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
