// AdvancedOptions — card «Opciones avanzadas» del idle (frontend-spec §6.2).
// Framework fijo OpenMP·PyOMP (MPI/Slurm disabled «próximamente»); entorno
// readonly de GET /system; timeout construido DINÁMICAMENTE desde
// limits.max_timeout_s (JAMÁS ofrecer > max_timeout_s: el backend valida 5..120).
import { useId } from 'react'
import type { SystemInfoDto } from '../../api/types'
import { Card, CardHead, CardPad } from '../../components/ui/Card'
import { IconSettings } from '../../components/icons/icons'

export interface AdvancedOptionsProps {
  system: SystemInfoDto
  /** default_timeout_s del ejemplo (o null para código propio → 60). */
  exampleDefaultTimeout: number | null
  timeoutS: number
  onTimeoutChange: (t: number) => void
}

/** Opciones de timeout: 30/60 + default del ejemplo + tope del backend. */
export function buildTimeoutOptions(maxTimeoutS: number, exampleDefault: number | null): number[] {
  const base = [30, 60, exampleDefault ?? 60, maxTimeoutS]
  return [...new Set(base)].filter((t) => t >= 5 && t <= maxTimeoutS).sort((a, b) => a - b)
}

export function AdvancedOptions({ system, exampleDefaultTimeout, timeoutS, onTimeoutChange }: AdvancedOptionsProps) {
  const fwId = useId()
  const envId = useId()
  const toId = useId()
  const options = buildTimeoutOptions(system.limits.max_timeout_s, exampleDefaultTimeout)
  const runtime = `ehpc-runner · python ${system.versions.python} + pyomp ${system.versions.pyomp}`

  return (
    <Card style={{ marginTop: 20 }}>
      <CardHead icon={<IconSettings size={16} />} title="Opciones avanzadas" />
      <CardPad className="adv-grid">
        <div>
          <label className="field-label" htmlFor={fwId}>
            Framework
          </label>
          <select id={fwId} className="select" value="openmp" onChange={() => undefined}>
            <option value="openmp">OpenMP · PyOMP</option>
            <option value="mpi" disabled>
              MPI (mpirun) — próximamente
            </option>
            <option value="slurm" disabled>
              Slurm (sbatch) — próximamente
            </option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={envId}>
            Entorno de ejecución
          </label>
          <input id={envId} className="input" readOnly value={runtime} aria-readonly="true" />
        </div>
        <div>
          <label className="field-label" htmlFor={toId}>
            Timeout
          </label>
          <select id={toId} className="select" value={timeoutS} onChange={(e) => onTimeoutChange(Number(e.currentTarget.value))}>
            {options.map((t) => (
              <option key={t} value={t}>
                {t} s{t === system.limits.max_timeout_s ? ' (límite del backend)' : ''}
              </option>
            ))}
          </select>
          <div className="field-hint">El timeout incluye el arranque de Python y la compilación JIT.</div>
        </div>
      </CardPad>
    </Card>
  )
}
