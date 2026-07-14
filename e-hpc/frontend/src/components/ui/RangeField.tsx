// RangeField — slider nativo del handoff (§2.5: accent-color orange-500)
// envuelto en Field. Soporta disabled (modos fixed/sweep de frontend-spec §9)
// y aria-valuetext para lectores de pantalla.
import { useId, type ReactNode } from 'react'
import { Field } from './Field'

export interface RangeFieldProps {
  label: ReactNode
  /** Texto mono a la derecha del label (p. ej. `{n} hilos`). */
  valueText?: ReactNode
  min: number
  max: number
  step?: number
  value: number
  onChange?: (value: number) => void
  disabled?: boolean
  hint?: ReactNode
  error?: ReactNode
  /** aria-valuetext (p. ej. `4 hilos`). */
  ariaValueText?: string
}

export function RangeField({
  label,
  valueText,
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
  hint,
  error,
  ariaValueText,
}: RangeFieldProps) {
  const id = useId()
  return (
    <Field label={label} value={valueText} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={ariaValueText}
        onChange={(e) => onChange?.(Number(e.currentTarget.value))}
      />
    </Field>
  )
}
