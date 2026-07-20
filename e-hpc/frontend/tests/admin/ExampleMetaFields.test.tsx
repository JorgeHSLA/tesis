// tests/admin/ExampleMetaFields.test.tsx — BL-24: coherencia GPU⇒deshabilitado
// inmediata en la UI del editor de ejemplo. Al marcar "Requiere GPU" el ejemplo
// pasa a enabled=false y el checkbox "Ejemplo habilitado" se bloquea (§10.6).
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AdminExampleBaseDto } from '@/api/admin-types'
import { ExampleMetaFields } from '@/features/admin/example/ExampleMetaFields'

function baseValue(over: Partial<AdminExampleBaseDto> = {}): AdminExampleBaseDto {
  return {
    title: 'Suma de vectores',
    filename: 'suma.py',
    difficulty: 2,
    teaches: 'reduction',
    directives: ['parallel for'],
    threads_configurable: true,
    fixed_threads: null,
    fixed_threads_note: null,
    sweeps_threads: false,
    self_measures: false,
    parser_id: 'none',
    default_timeout_s: 60,
    est_run_seconds: 5,
    enabled: true,
    requires_gpu: false,
    expected_output_note: '',
    takeaways: ['idea'],
    ...over,
  }
}

function renderFields(over: Partial<AdminExampleBaseDto> = {}) {
  const onChange = vi.fn()
  render(<ExampleMetaFields value={baseValue(over)} onChange={onChange} maxTimeoutS={120} />)
  return { onChange }
}

describe('ExampleMetaFields · coherencia GPU⇒deshabilitado (BL-24)', () => {
  it('marcar "Requiere GPU" fuerza enabled=false en el patch', () => {
    const { onChange } = renderFields({ requires_gpu: false, enabled: true })
    fireEvent.click(screen.getByRole('checkbox', { name: /Requiere GPU/i }))
    expect(onChange).toHaveBeenCalledWith({ requires_gpu: true, enabled: false })
  })

  it('desmarcar "Requiere GPU" no toca enabled', () => {
    const { onChange } = renderFields({ requires_gpu: true, enabled: false })
    fireEvent.click(screen.getByRole('checkbox', { name: /Requiere GPU/i }))
    expect(onChange).toHaveBeenCalledWith({ requires_gpu: false })
  })

  it('con requires_gpu=true el checkbox "Ejemplo habilitado" está deshabilitado y desmarcado', () => {
    renderFields({ requires_gpu: true, enabled: true })
    const enabled = screen.getByRole('checkbox', { name: /Ejemplo habilitado/i })
    expect(enabled).toBeDisabled()
    expect(enabled).not.toBeChecked()
    expect(
      screen.getByText(/quedan deshabilitados para el estudiante/i),
    ).toBeInTheDocument()
  })

  it('sin GPU el checkbox "Ejemplo habilitado" es editable', () => {
    const { onChange } = renderFields({ requires_gpu: false, enabled: false })
    const enabled = screen.getByRole('checkbox', { name: /Ejemplo habilitado/i })
    expect(enabled).not.toBeDisabled()
    fireEvent.click(enabled)
    expect(onChange).toHaveBeenCalledWith({ enabled: true })
  })
})
