// tests/admin/AdminGuard.test.tsx — el guard deja pasar con sesión, verifica el
// token persistido al arrancar y redirige a /admin/login sin sesión usable.
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  adminLogin: vi.fn(),
  adminLogout: vi.fn(),
  adminSessionInfo: vi.fn(),
}))

import { adminSessionInfo } from '@/api/admin'
import { AdminGuard } from '@/components/admin/AdminGuard'
import { useAdminSession } from '@/stores/adminSessionStore'

const adminSessionInfoMock = adminSessionInfo as Mock

function renderGuard(initial = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <AdminGuard>
              <div>PANEL PRIVADO</div>
            </AdminGuard>
          }
        />
        <Route path="/admin/login" element={<div>PANTALLA LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  useAdminSession.setState({ token: null, expiresAt: null, status: 'unknown' })
  adminSessionInfoMock.mockReset()
})

describe('AdminGuard', () => {
  it('sin token: redirige a /admin/login sin consultar el server', async () => {
    await act(async () => {
      renderGuard()
    })
    expect(await screen.findByText('PANTALLA LOGIN')).toBeInTheDocument()
    expect(adminSessionInfoMock).not.toHaveBeenCalled()
  })

  it('ya autenticado: renderiza el contenido protegido', () => {
    useAdminSession.setState({ token: 'tok', status: 'authenticated' })
    renderGuard()
    expect(screen.getByText('PANEL PRIVADO')).toBeInTheDocument()
  })

  it('con token válido: restore autentica y muestra el contenido', async () => {
    useAdminSession.setState({ token: 'tok', status: 'unknown' })
    adminSessionInfoMock.mockResolvedValue({ authenticated: true, expires_at: '2026-07-14T22:00:00Z' })
    renderGuard()
    expect(await screen.findByText('PANEL PRIVADO')).toBeInTheDocument()
    expect(adminSessionInfoMock).toHaveBeenCalledTimes(1)
  })

  it('con token inválido: restore falla y redirige a login', async () => {
    useAdminSession.setState({ token: 'stale', status: 'unknown' })
    adminSessionInfoMock.mockResolvedValue({ authenticated: false, expires_at: null })
    renderGuard()
    expect(await screen.findByText('PANTALLA LOGIN')).toBeInTheDocument()
  })
})
