// ExamplePicker — select de ejemplos agrupado por módulo (frontend-spec §6.2).
// Fuente: GET /api/v1/modules (lecciones con example_id + enabled). Las
// lecciones enabled:false (sumaVectoresGPU sin GPU) aparecen deshabilitadas.
import { useId } from 'react'
import type { ModuleDto } from '../../api/types'

export interface ExamplePickerProps {
  modules: ModuleDto[]
  /** example_id seleccionado (o '' = ninguno / código propio). */
  value: string
  onChange: (exampleId: string) => void
  /** Variante compacta para el header (sin label). */
  compact?: boolean
  disabled?: boolean
}

export function ExamplePicker({ modules, value, onChange, compact, disabled }: ExamplePickerProps) {
  const id = useId()
  const select = (
    <select
      id={id}
      className="select"
      value={value}
      disabled={disabled}
      aria-label={compact ? 'Ejemplo del curso' : undefined}
      onChange={(e) => onChange(e.currentTarget.value)}
      style={compact ? { width: 'auto', minWidth: 210 } : undefined}
    >
      <option value="">Código propio (editor)</option>
      {modules.map((m) => (
        <optgroup key={m.id} label={`M${m.order} · ${m.title}`}>
          {m.lessons.map((l) => (
            <option key={l.id} value={l.example_id} disabled={!l.enabled}>
              {l.title}
              {!l.enabled ? ' — requiere GPU' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
  if (compact) return select
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        Ejemplo del curso
      </label>
      {select}
    </div>
  )
}
