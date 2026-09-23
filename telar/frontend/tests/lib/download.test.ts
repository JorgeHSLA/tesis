// lib/download: fetch → Blob → URL.createObjectURL (CU-10.1). En Electron la
// página es file:// y el API http://localhost:8000: `<a download>` entre
// orígenes se ignora, así que la descarga pasa siempre por un Blob local.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFile, saveBlob } from '@/lib/download'

const createObjectURL = vi.fn(() => 'blob:telar/1')
const revokeObjectURL = vi.fn()
let clicked: HTMLAnchorElement[] = []

beforeEach(() => {
  vi.useFakeTimers()
  clicked = []
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('saveBlob', () => {
  it('descarga el Blob con el nombre pedido y libera la URL', () => {
    const blob = new Blob(['{}'], { type: 'application/json' })
    saveBlob(blob, 'resultado.json')
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('resultado.json')
    expect(clicked[0].href).toBe('blob:telar/1')
    expect(document.body.contains(clicked[0])).toBe(false)
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:telar/1')
  })
})

describe('downloadFile', () => {
  it('pide la URL con fetch y guarda la respuesta como Blob', async () => {
    const fetchMock = vi.fn(async () => new Response('hola\n', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await downloadFile('http://localhost:8000/api/v1/jobs/j1/output', 'demo-j1.txt')
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/v1/jobs/j1/output')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('demo-j1.txt')
  })

  it('rechaza si el servidor responde con error (no descarga nada)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })))
    await expect(downloadFile('/x', 'x.txt')).rejects.toThrow()
    expect(clicked).toHaveLength(0)
  })

  it('rechaza si la red falla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(downloadFile('/x', 'x.txt')).rejects.toThrow()
    expect(clicked).toHaveLength(0)
  })
})
