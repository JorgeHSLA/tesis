// AdvancedOptions — card «Opciones avanzadas» del idle (frontend-spec §6.2).
// Framework fijo OpenMP·PyOMP (MPI/Slurm disabled «próximamente»); entorno
// readonly de GET /system; timeout construido DINÁMICAMENTE desde
// limits.max_timeout_s, que ahora es un TOPE OPCIONAL: `0` (o <= 0) significa
// «sin límite» y es el valor por defecto del backend. Con tope (> 0) jamás se
// ofrece un valor por encima de él (el backend responde 422).
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

/** Centinela del contrato (§7.1): `timeout_s = 0` ⇒ SIN TIMEOUT. */
export const NO_TIMEOUT = 0

/** Los 4 valores que se ofrecen siempre. Ya no hay techo de 120: la
 * migration 4 levantó el `CHECK (timeout_s BETWEEN 5 AND 120)` de la DB. */
export const TIMEOUT_CHOICES = [30, 60, 90, 120] as const

/** Opciones del select: la escalera fija + el default del ejemplo, más la
 * entrada «Sin timeout» (0) SOLO cuando el servidor no impone tope. Con tope
 * (`maxTimeoutS > 0`) se acota y «Sin timeout» desaparece, porque el backend
 * lo rechaza con 422. */
export function buildTimeoutOptions(maxTimeoutS: number, exampleDefault: number | null): number[] {
  const hasCap = maxTimeoutS > 0
  const base = [...TIMEOUT_CHOICES, exampleDefault ?? 60]
  const values = [...new Set(hasCap ? [...base, maxTimeoutS] : base)]
    .filter((t) => t >= 5 && (!hasCap || t <= maxTimeoutS))
    .sort((a, b) => a - b)
  // Con topes muy bajos (p. ej. 10 s) la escalera se queda vacía: ofrecer al
  // menos el propio tope evita repetir el bug del select sin opciones.
  const scale = values.length > 0 ? values : [Math.max(5, maxTimeoutS)]
  return hasCap ? scale : [NO_TIMEOUT, ...scale]
}

export function AdvancedOptions({ system, exampleDefaultTimeout, timeoutS, onTimeoutChange }: AdvancedOptionsProps) {
  const fwId = useId()
  const envId = useId()
  const toId = useId()
  const hasCap = system.limits.max_timeout_s > 0
  const options = buildTimeoutOptions(system.limits.max_timeout_s, exampleDefaultTimeout)
  const runtime = `telar-runner · python ${system.versions.python} + pyomp ${system.versions.pyomp}`

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
                {t === NO_TIMEOUT
                  ? 'Sin timeout'
                  : `${t} s${hasCap && t === system.limits.max_timeout_s ? ' (límite del backend)' : ''}`}
              </option>
            ))}
          </select>
          <div className="field-hint">
            {timeoutS === NO_TIMEOUT
              ? 'Sin límite de tiempo: el job corre hasta terminar. Si se queda colgado (bucle infinito) tendrás que cancelarlo a mano, y mientras tanto ocupa uno de los puestos de ejecución.'
              : 'El timeout incluye el arranque de Python y la compilación JIT.'}
          </div>
        </div>
      </CardPad>
    </Card>
  )
}
