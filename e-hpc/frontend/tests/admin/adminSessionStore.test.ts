// tests/admin/adminSessionStore.test.ts — sesión admin (Zustand + persist
// sessionStorage). login/logout/clear/restore y persistencia del token.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/api/admin', () => ({
  adminLogin: vi.fn(),
  adminLogout: vi.fn(),
  adminSessionInfo: vi.fn(),
}))

import { adminLogin, adminLogout, adminSessionInfo } from '@/api/admin'
import { useAdminSession } from '@/stores/adminSessionStore'
import { ApiError } from '@/api/client'

const adminLoginMock = adminLogin as Mock
const adminLogoutMock = adminLogout as Mock
const adminSessionInfoMock = adminSessionInfo as Mock

beforeEach(() => {
  sessionStorage.clear()
  useAdminSession.setState({ token: null, expiresAt: null, status: 'unknown' })
  adminLoginMock.mockReset()
  adminLogoutMock.mockReset()
  adminSessionInfoMock.mockReset()
})

describe('login()', () => {
  it('éxito: guarda token/expiresAt y pasa a authenticated', async () => {
    adminLoginMock.mockResolvedValue({ token: 'tok-1', expires_at: '2026-07-14T20:00:00Z' })
    await useAdminSession.getState().login('secreto')
    const st = useAdminSession.getState()
    expect(adminLoginMock).toHaveBeenCalledWith('secreto')
    expect(st.token).toBe('tok-1')
    expect(st.expiresAt).toBe('2026-07-14T20:00:00Z')
    expect(st.status).toBe('authenticated')
  })

  it('persiste {token, expiresAt} en sessionStorage', async () => {
    adminLoginMock.mockResolvedValue({ token: 'tok-persist', expires_at: '2026-07-14T21:00:00Z' })
    await useAdminSession.getState().login('p')
    const raw = sessionStorage.getItem('ehpc-admin-session')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed.state.token).toBe('tok-persist')
    expect(parsed.state.expiresAt).toBe('2026-07-14T21:00:00Z')
  })

  it('401: propaga el ApiError y no deja sesión', async () => {
    adminLoginMock.mockRejectedValue(new ApiError('UNAUTHORIZED', 'no', 401))
    await expect(useAdminSession.getState().login('mala')).rejects.toBeInstanceOf(ApiError)
    const st = useAdminSession.getState()
    expect(st.token).toBeNull()
    expect(st.status).toBe('unknown')
  })
})

describe('logout()', () => {
  it('revoca en el server y limpia la sesión local', async () => {
    useAdminSession.setState({ token: 'tok', expiresAt: 'e', status: 'authenticated' })
    adminLogoutMock.mockResolvedValue({ revoked: true })
    await useAdminSession.getState().logout()
    expect(adminLogoutMock).toHaveBeenCalledTimes(1)
    const st = useAdminSession.getState()
    expect(st.token).toBeNull()
    expect(st.status).toBe('anonymous')
  })

  it('aunque el server falle, limpia la sesión local', async () => {
    useAdminSession.setState({ token: 'tok', status: 'authenticated' })
    adminLogoutMock.mockRejectedValue(new ApiError('INTERNAL_ERROR', 'x', 500))
    await useAdminSession.getState().logout()
    expect(useAdminSession.getState().token).toBeNull()
    expect(useAdminSession.getState().status).toBe('anonymous')
  })
})

describe('clear()', () => {
  it('resetea token/expiresAt y pasa a anonymous', () => {
    useAdminSession.setState({ token: 'tok', expiresAt: 'e', status: 'authenticated' })
    useAdminSession.getState().clear()
    expect(useAdminSession.getState()).toMatchObject({ token: null, expiresAt: null, status: 'anonymous' })
  })
})

describe('restore()', () => {
  it('sin token: no consulta el server y queda anonymous', async () => {
    await useAdminSession.getState().restore()
    expect(adminSessionInfoMock).not.toHaveBeenCalled()
    expect(useAdminSession.getState().status).toBe('anonymous')
  })

  it('token válido (authenticated:true): pasa a authenticated y refresca expiresAt', async () => {
    useAdminSession.setState({ token: 'tok', status: 'unknown' })
    adminSessionInfoMock.mockResolvedValue({ authenticated: true, expires_at: '2026-07-14T22:00:00Z' })
    await useAdminSession.getState().restore()
    const st = useAdminSession.getState()
    expect(st.status).toBe('authenticated')
    expect(st.expiresAt).toBe('2026-07-14T22:00:00Z')
  })

  it('backend reiniciado (authenticated:false): limpia la sesión', async () => {
    useAdminSession.setState({ token: 'tok', status: 'unknown' })
    adminSessionInfoMock.mockResolvedValue({ authenticated: false, expires_at: null })
    await useAdminSession.getState().restore()
    expect(useAdminSession.getState().token).toBeNull()
    expect(useAdminSession.getState().status).toBe('anonymous')
  })

  it('token caducado (401): limpia la sesión', async () => {
    useAdminSession.setState({ token: 'stale', status: 'unknown' })
    adminSessionInfoMock.mockRejectedValue(new ApiError('UNAUTHORIZED', 'x', 401))
    await useAdminSession.getState().restore()
    expect(useAdminSession.getState().token).toBeNull()
    expect(useAdminSession.getState().status).toBe('anonymous')
  })
})
