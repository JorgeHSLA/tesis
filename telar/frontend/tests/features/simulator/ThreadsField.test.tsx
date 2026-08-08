// Suite 7 (frontend-spec §10): features/simulator/ThreadsField.test.tsx
// Slider según flags del contrato: configurable activo 1..max; fixed/sweep
// deshabilitados con hint; aviso cores<8; el payload OMITE threads en fixed/sweep.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { effectiveCpus, shouldSendThreads, ThreadsField } from '@/features/simulator/ThreadsField'
import {
  EXAMPLE_CONFIGURABLE,
  EXAMPLE_FIXED,
  EXAMPLE_SWEEP,
  SYSTEM_INFO,
  SYSTEM_INFO_4CORES,
} from '../../fixtures/rest'

describe('modo configurable', () => {
  it('slider activo 1..max_threads y onChange dispara', () => {
    const onChange = vi.fn()
    render(
      <ThreadsField system={SYSTEM_INFO} example={EXAMPLE_CONFIGURABLE} edited={false} value={4} onChange={onChange} />,
    )
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider).not.toBeDisabled()
    expect(slider.max).toBe('8')
    expect(slider.min).toBe('1')
    fireEvent.change(slider, { target: { value: '6' } })
    expect(onChange).toHaveBeenCalledWith(6)
  })
})

describe('modo fixed', () => {
  it('slider deshabilitado en fixed_threads con hint = fixed_threads_note', () => {
    render(<ThreadsField system={SYSTEM_INFO} example={EXAMPLE_FIXED} edited={false} value={4} onChange={vi.fn()} />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider).toBeDisabled()
    expect(slider.value).toBe('4')
    expect(screen.getByText(/exactamente 4 hilos/i)).toBeInTheDocument()
  })
})

describe('modo sweep', () => {
  it('slider deshabilitado mostrando 1 · 2 · 4 · 8 y hint de barrido', () => {
    render(<ThreadsField system={SYSTEM_INFO} example={EXAMPLE_SWEEP} edited={false} value={4} onChange={vi.fn()} />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider).toBeDisabled()
    expect(screen.getByText('1 · 2 · 4 · 8')).toBeInTheDocument()
    expect(screen.getByText(/barre 1, 2, 4 y 8 hilos/i)).toBeInTheDocument()
  })

  it('cores<8 muestra el aviso ámbar', () => {
    render(<ThreadsField system={SYSTEM_INFO_4CORES} example={EXAMPLE_SWEEP} edited={false} value={4} onChange={vi.fn()} />)
    expect(screen.getByText(/Tu máquina tiene 4 núcleos/i)).toBeInTheDocument()
  })

  it('cores>=8 no muestra el aviso', () => {
    render(<ThreadsField system={SYSTEM_INFO} example={EXAMPLE_SWEEP} edited={false} value={4} onChange={vi.fn()} />)
    expect(screen.queryByText(/núcleos; los casos de 8 hilos/i)).not.toBeInTheDocument()
  })
})

describe('shouldSendThreads — el payload OMITE threads en fixed/sweep', () => {
  it('true para código propio (example null) y ejemplo configurable', () => {
    expect(shouldSendThreads(null)).toBe(true)
    expect(shouldSendThreads(EXAMPLE_CONFIGURABLE)).toBe(true)
  })
  it('false para fixed y sweep', () => {
    expect(shouldSendThreads(EXAMPLE_FIXED)).toBe(false)
    expect(shouldSendThreads(EXAMPLE_SWEEP)).toBe(false)
  })
})

describe('effectiveCpus', () => {
  it('sweep → min(8, cores)', () => {
    expect(effectiveCpus(EXAMPLE_SWEEP, 4, 4)).toBe(4)
    expect(effectiveCpus(EXAMPLE_SWEEP, 4, 16)).toBe(8)
  })
  it('fixed → fixed_threads', () => {
    expect(effectiveCpus(EXAMPLE_FIXED, 4, 8)).toBe(4)
  })
  it('configurable / propio → threads del slider', () => {
    expect(effectiveCpus(EXAMPLE_CONFIGURABLE, 6, 8)).toBe(6)
    expect(effectiveCpus(null, 3, 8)).toBe(3)
  })
})
