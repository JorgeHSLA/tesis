// S5 · D+ — en el build de autoría, /aprender enseña el BORRADOR del autor; el
// aviso lo dice para que nadie crea que sus cambios ya están publicados.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ ADMIN_BUILD: true }))
vi.mock('@/config', () => config)

import { DraftBanner } from '@/components/shell/DraftBanner'

afterEach(() => {
  config.ADMIN_BUILD = true
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DraftBanner />
    </MemoryRouter>,
  )
}

const TEXTO = /Vista previa: estás viendo tu borrador\. Los estudiantes ven la última versión publicada\./

describe('DraftBanner', () => {
  it('aparece en /aprender y en una lección del build de autoría', () => {
    renderAt('/aprender')
    expect(screen.getByRole('note')).toHaveTextContent(TEXTO)
  })

  it('aparece dentro de una lección', () => {
    renderAt('/aprender/hola-hilos')
    expect(screen.getByText(TEXTO)).toBeInTheDocument()
  })

  it('no aparece fuera de /aprender', () => {
    renderAt('/admin')
    expect(screen.queryByText(TEXTO)).not.toBeInTheDocument()
  })

  it('no aparece en /aprendermas (solo el segmento exacto)', () => {
    renderAt('/aprendermas')
    expect(screen.queryByText(TEXTO)).not.toBeInTheDocument()
  })

  it('no aparece en el build del estudiante', () => {
    config.ADMIN_BUILD = false
    renderAt('/aprender')
    expect(screen.queryByText(TEXTO)).not.toBeInTheDocument()
  })
})
