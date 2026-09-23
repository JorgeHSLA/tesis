// Sidebar con un backend MÁS VIEJO que el frontend (hallazgo del 22-09 en
// Electron): un /system sin el bloque `catalog` tumbaba TODA la app con
// «Cannot read properties of undefined (reading 'enabled')».
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_INFO } from '../../fixtures/rest'

vi.mock('@/api/system', () => ({
  getSystem: vi.fn(),
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', checks: { db: true, docker: true, runner_image: true } }),
}))

import { getSystem } from '@/api/system'
import { Sidebar } from '@/components/shell/Sidebar'
import { loadSystemInfo } from '@/hooks/useSystemInfo'

afterEach(() => {
  vi.clearAllMocks()
})

describe('Sidebar con un /system sin catalog', () => {
  it('renderiza el rail sin «Módulos disponibles»', async () => {
    const { catalog: _omit, ...viejo } = SYSTEM_INFO
    ;(getSystem as ReturnType<typeof vi.fn>).mockResolvedValue(viejo)
    await loadSystemInfo(true)

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    await waitFor(() => expect(getSystem).toHaveBeenCalled())
    expect(await screen.findByRole('link', { name: 'Inicio' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Módulos disponibles' })).toBeNull()
  })
})
