// ExamplePicker — select de ejemplos agrupado por módulo (frontend-spec §6.2).
// Fuente: GET /api/v1/modules (lecciones con example_id + enabled). Las
// lecciones enabled:false (sumaVectoresGPU sin GPU) aparecen deshabilitadas.
// Vive UNA sola vez, en la cabecera del simulador, junto a «Lanzar ejecución».
import { useId } from 'react'
import type { ModuleDto } from '../../api/types'

export interface ExamplePickerProps {
  modules: ModuleDto[]
  /** example_id seleccionado (o '' = ninguno / código propio). */
  value: string
  onChange: (exampleId: string) => void
  disabled?: boolean
}

export function ExamplePicker({ modules, value, onChange, disabled }: ExamplePickerProps) {
  const id = useId()
  return (
    <div className="example-picker">
      <label className="field-label" htmlFor={id}>
        Ejemplo
      </label>
      <select
        id={id}
        className="select select-compact"
        value={value}
        disabled={disabled}
        aria-label="Ejemplo del curso"
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        <option value="">Código propio (editor)</option>
        {modules.map((m) => (
          <optgroup key={m.id} label={`M${m.order} · ${m.title}`}>
            {/* E1: el selector ofrece EJEMPLOS. Una lección conceptual no tiene
                código que precargar, así que no aparece aquí — no como opción
                deshabilitada, sino directamente ausente. */}
            {m.lessons
              .filter((l) => l.example_id != null)
              .map((l) => (
                <option key={l.id} value={l.example_id as string} disabled={!l.enabled}>
                  {l.title}
                  {!l.enabled ? ' — requiere GPU' : ''}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
