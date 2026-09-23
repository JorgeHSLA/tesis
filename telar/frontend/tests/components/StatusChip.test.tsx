// StatusChip: `compiling` = «aún sin primer byte de stdout» (api-contract §7.7),
// no «fin de la compilación JIT» — el rótulo no debe prometer más (CU-07.1).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusChip, phaseChipSpec } from '@/components/ui/StatusChip'

describe('StatusChip · compiling', () => {
  it('rotula «Preparando · sin salida aún»', () => {
    expect(phaseChipSpec('compiling').label).toBe('Preparando · sin salida aún')
    render(<StatusChip phase="compiling" />)
    expect(screen.getByRole('status')).toHaveTextContent('Preparando · sin salida aún')
    expect(screen.queryByText(/Compilando/)).not.toBeInTheDocument()
  })
})
