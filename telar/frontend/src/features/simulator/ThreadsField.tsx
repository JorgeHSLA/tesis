// ThreadsField — slider de hilos según flags del contrato (frontend-spec §9).
// La UI NO miente cuando el script no obedece el slider:
// - threads_configurable=true → slider activo (el POST envía threads).
// - fixed (entornoDatos, monteCarloPi) → slider DESHABILITADO en fixed_threads
//   con hint = fixed_threads_note. El POST OMITE threads.
// - sweep (piSpmd, piSpmdCritical, transporteMonteCarlo) → slider DESHABILITADO
//   mostrando 1·2·4·8. El POST OMITE threads. cores<8 → aviso ámbar.
// - código propio/editado → slider activo + nota sobre omp_set_num_threads().
import type { ExampleDetailDto, SystemInfoDto } from '../../api/types'
import { RangeField } from '../../components/ui/RangeField'

const SWEEP_HINT = 'Este ejemplo prueba con 1, 2, 4 y 8 hilos y mide cada caso.'
const OWN_CODE_NOTE = 'Si tu código llama omp_set_num_threads(), este valor no cuenta.'

export interface ThreadsFieldProps {
  system: SystemInfoDto
  /** null = código propio (upload / editor en blanco). */
  example: ExampleDetailDto | null
  /** El código del ejemplo fue editado (payload example_id+code). */
  edited: boolean
  value: number
  onChange: (threads: number) => void
}

/** true si el POST debe INCLUIR `threads` (frontend-spec §9 / contrato §7.1). */
export function shouldSendThreads(example: ExampleDetailDto | null): boolean {
  return example == null || example.threads_configurable
}

/** CPUs efectivas que asignará el backend (fila informativa --cpus). */
export function effectiveCpus(example: ExampleDetailDto | null, threads: number, cores: number): number {
  if (example != null && !example.threads_configurable) {
    return example.sweeps_threads ? Math.min(8, cores) : (example.fixed_threads ?? threads)
  }
  return threads
}

export function ThreadsField({ system, example, edited, value, onChange }: ThreadsFieldProps) {
  const maxThreads = system.max_threads
  const configurable = example == null || example.threads_configurable
  const sweep = example != null && !example.threads_configurable && example.sweeps_threads
  const fixed = example != null && !example.threads_configurable && !example.sweeps_threads

  if (sweep) {
    return (
      <div>
        <RangeField
          label="Hilos"
          valueText="1 · 2 · 4 · 8"
          min={1}
          max={8}
          value={8}
          disabled
          ariaValueText="barrido de 1, 2, 4 y 8 hilos"
          hint={SWEEP_HINT}
        />
        {system.cores < 8 && (
          <div className="field-hint sweep-warn">
            Tu máquina tiene {system.cores} núcleos; los casos de 8 hilos no mostrarán speedup real.
          </div>
        )}
      </div>
    )
  }

  if (fixed) {
    const n = example.fixed_threads ?? 4
    return (
      <RangeField
        label="Hilos"
        valueText={`${n} hilos (fijo)`}
        min={1}
        max={Math.max(maxThreads, n)}
        value={n}
        disabled
        ariaValueText={`${n} hilos fijados por el código`}
        hint={example.fixed_threads_note ?? 'Este ejemplo fija sus hilos en el código.'}
      />
    )
  }

  // Slider activo: ejemplo configurable, ejemplo editado o código propio.
  const showOwnNote = example == null || (edited && configurable)
  return (
    <RangeField
      label="Hilos"
      valueText={`${value} ${value === 1 ? 'hilo' : 'hilos'}`}
      min={1}
      max={maxThreads}
      value={value}
      onChange={onChange}
      ariaValueText={`${value} ${value === 1 ? 'hilo' : 'hilos'}`}
      hint={showOwnNote ? OWN_CODE_NOTE : undefined}
    />
  )
}
