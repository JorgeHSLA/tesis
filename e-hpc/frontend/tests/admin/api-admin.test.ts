// tests/admin/api-admin.test.ts — capa HTTP admin SIN login: las llamadas usan
// `fetchJson` normal (api/client), SIN cabecera Authorization/Bearer. El modo
// autoría se decide en build (VITE_ADMIN) + config del backend, no por sesión.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createModule, getAdminModules } from '@/api/admin'
import type { AdminModuleCreateDto } from '@/api/admin-types'

const originalFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, meta: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function initOf(call: number): RequestInit {
  return fetchMock.mock.calls[call][1] as RequestInit
}

function headersOf(call: number): Record<string, string> {
  return initOf(call).headers as Record<string, string>
}

beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('api/admin (sin login/Bearer)', () => {
  it('GET /admin/modules va SIN cabecera Authorization', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ modules: [] })))
    await getAdminModules()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/admin/modules')
    expect(headersOf(0).Authorization).toBeUndefined()
  })

  it('POST /admin/modules envía JSON (sin Bearer)', async () => {
    const body: AdminModuleCreateDto = {
      id: 'm9',
      order: 9,
      title: 'Módulo nuevo',
      description: 'x',
      level: 'intro',
    }
    fetchMock.mockImplementation(() => Promise.resolve(ok({ ...body, lessons: [] })))
    await createModule(body)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/admin/modules')
    expect(initOf(0).method).toBe('POST')
    expect(initOf(0).body).toBe(JSON.stringify(body))
    expect(headersOf(0).Authorization).toBeUndefined()
    expect(headersOf(0)['Content-Type']).toBe('application/json')
  })
})
