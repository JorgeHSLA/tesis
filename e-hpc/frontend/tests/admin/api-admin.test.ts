// tests/admin/api-admin.test.ts — capa HTTP admin: authFetch inyecta el Bearer
// de la sesión, ante un 401 limpia la sesión, y adminLogin viaja SIN Bearer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminLogin, getAdminModules } from '@/api/admin'
import { useAdminSession } from '@/stores/adminSessionStore'

const originalFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, meta: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fail(code: string, status: number): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code, message: code, details: null }, meta: null }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

function initOf(call: number): RequestInit {
  return fetchMock.mock.calls[call][1] as RequestInit
}

function headersOf(call: number): Record<string, string> {
  return initOf(call).headers as Record<string, string>
}

beforeEach(() => {
  sessionStorage.clear()
  useAdminSession.setState({ token: null, expiresAt: null, status: 'unknown' })
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('authFetch', () => {
  it('inyecta Authorization: Bearer <token> cuando hay sesión', async () => {
    useAdminSession.setState({ token: 'tok-xyz', status: 'authenticated' })
    fetchMock.mockImplementation(() => Promise.resolve(ok({ modules: [] })))
    await getAdminModules()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/admin/modules')
    expect(headersOf(0).Authorization).toBe('Bearer tok-xyz')
  })

  it('sin token no envía cabecera Authorization', async () => {
    useAdminSession.setState({ token: null, status: 'anonymous' })
    fetchMock.mockImplementation(() => Promise.resolve(ok({ modules: [] })))
    await getAdminModules()
    expect(headersOf(0).Authorization).toBeUndefined()
  })

  it('ante un 401 limpia la sesión local y re-lanza el ApiError', async () => {
    useAdminSession.setState({ token: 'tok', status: 'authenticated' })
    fetchMock.mockImplementation(() => Promise.resolve(fail('UNAUTHORIZED', 401)))
    await expect(getAdminModules()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
    const st = useAdminSession.getState()
    expect(st.token).toBeNull()
    expect(st.status).toBe('anonymous')
  })
})

describe('adminLogin', () => {
  it('hace POST /admin/login con el password y SIN Bearer', async () => {
    // Aunque hubiera un token viejo, el login no debe reutilizarlo.
    useAdminSession.setState({ token: 'viejo', status: 'authenticated' })
    fetchMock.mockImplementation(() => Promise.resolve(ok({ token: 'nuevo', expires_at: 'x' })))
    const res = await adminLogin('secreto')
    expect(res).toEqual({ token: 'nuevo', expires_at: 'x' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/admin/login')
    expect(initOf(0).method).toBe('POST')
    expect(initOf(0).body).toBe(JSON.stringify({ password: 'secreto' }))
    expect(headersOf(0).Authorization).toBeUndefined()
    expect(headersOf(0)['Content-Type']).toBe('application/json')
  })
})
