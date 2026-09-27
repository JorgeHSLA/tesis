// HomeScreen — la caché de GET /modules se refresca al entrar: lo escrito en
// Autoría (p. ej. una lección nueva al principio del curso) se ve sin Ctrl+R.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { MODULES } from '../../fixtures/rest'

vi.mock('@/api/content', () => ({ getModules: vi.fn(), putLessonProgress: vi.fn() }))

import { getModules } from '@/api/content'
import HomeScreen from '@/features/home/HomeScreen'
import { useProgressStore } from '@/stores/progressStore'

beforeEach(() => {
  vi.clearAllMocks()
  useProgressStore.setState({ modules: null, summary: null, lastLessonId: null, loading: false, error: null })
})

describe('HomeScreen · caché de módulos', () => {
  it('con la caché ya cargada, entrar vuelve a pedir GET /modules', async () => {
    const vieja = structuredClone(MODULES)
    vieja.modules[0].lessons[0].title = 'Título viejo'
    useProgressStore.setState({ modules: vieja.modules, summary: vieja.summary })
    const nueva = structuredClone(MODULES)
    nueva.modules[0].lessons[0].title = 'Título editado en Autoría'
    ;(getModules as Mock).mockResolvedValue(nueva)

    render(
      <MemoryRouter>
        <HomeScreen />
      </MemoryRouter>,
    )
    await waitFor(() => expect(getModules).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Título editado en Autoría/)).toBeInTheDocument()
  })
})
