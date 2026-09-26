// tests/admin/api-admin.test.ts — capa HTTP admin SIN login: las llamadas usan
// `fetchJson` normal (api/client), SIN cabecera Authorization/Bearer. El modo
// autoría se decide en build (VITE_ADMIN) + config del backend, no por sesión.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addLessonExample,
  createModule,
  deleteModule,
  getAdminModules,
  reorderLessons,
  reorderModules,
} from '@/api/admin'
import type { AdminModuleCreateDto, AdminReorderRequestDto } from '@/api/admin-types'

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
  it('DELETE /admin/modules/{id} sin cascade no añade parámetros; con cascade añade ?cascade=true', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ deleted: true, id: 'm1' })))
    await deleteModule('m1')
    await deleteModule('m1', { cascade: true })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/admin\/modules\/m1$/)
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/admin\/modules\/m1\?cascade=true$/)
    expect(initOf(1).method).toBe('DELETE')
  })

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

  it('PUT /admin/modules/reorder envía {items:[{id,order}]} por lote', async () => {
    const items = [
      { id: 'm2', order: 1 },
      { id: 'm1', order: 2 },
    ]
    fetchMock.mockImplementation(() => Promise.resolve(ok({ modules: [] })))
    await reorderModules(items)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/admin/modules/reorder')
    expect(initOf(0).method).toBe('PUT')
    const sent = JSON.parse(initOf(0).body as string) as AdminReorderRequestDto
    expect(sent).toEqual({ items })
    expect(headersOf(0).Authorization).toBeUndefined()
    expect(headersOf(0)['Content-Type']).toBe('application/json')
  })

  it('PUT /admin/lessons/reorder manda los items con module_id', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ modules: [] })))
    const items = [
      { id: 'A', order: 1, module_id: 'm1' },
      { id: 'C', order: 2, module_id: 'm1' },
    ]
    await reorderLessons(items)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/admin/lessons/reorder')
    expect(initOf(0).method).toBe('PUT')
    expect(JSON.parse(initOf(0).body as string)).toEqual({ items })
  })

  it('POST /admin/lessons/{id}/example manda {example, source_code}', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ id: 'l 1' })))
    const body = { example: { title: 'E' } as never, source_code: 'print(1)' }
    await addLessonExample('l 1', body)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/admin/lessons/l%201/example')
    expect(initOf(0).method).toBe('POST')
    expect(JSON.parse(initOf(0).body as string)).toEqual(body)
  })
})
