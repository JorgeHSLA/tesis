// tests/admin/pyfile.test.ts — validación client-side de archivos .py extraída
// a lib/pyfile (DRY con CodePanel). Cubre extensión, tamaño (256 KB inclusivo)
// y decode UTF-8 estricto.
import { describe, expect, it } from 'vitest'
import { MAX_CODE_BYTES, validatePyFile } from '@/lib/pyfile'

describe('validatePyFile', () => {
  it('acepta un .py válido (UTF-8) y devuelve filename + code', async () => {
    const res = await validatePyFile(new File(['print("hola")\n'], 'demo.py'))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toEqual({ filename: 'demo.py', code: 'print("hola")\n' })
  })

  it('acepta la extensión .py sin distinguir mayúsculas', async () => {
    const res = await validatePyFile(new File(['x = 1\n'], 'Demo.PY'))
    expect(res.ok).toBe(true)
  })

  it('rechaza una extensión distinta de .py', async () => {
    const res = await validatePyFile(new File(['x'], 'notas.txt'))
    expect(res).toEqual({ ok: false, error: 'Solo archivos .py' })
  })

  it('rechaza un archivo mayor de 256 KB', async () => {
    const big = new File([new Uint8Array(MAX_CODE_BYTES + 1)], 'grande.py')
    const res = await validatePyFile(big)
    expect(res).toEqual({ ok: false, error: 'El archivo supera 256 KB' })
  })

  it('acepta exactamente 256 KB (límite inclusivo)', async () => {
    const at = new File([new Uint8Array(MAX_CODE_BYTES).fill(0x61)], 'limite.py')
    const res = await validatePyFile(at)
    expect(res.ok).toBe(true)
  })

  it('rechaza contenido que no es UTF-8', async () => {
    const res = await validatePyFile(new File([new Uint8Array([0xff, 0xfe, 0xfd])], 'binario.py'))
    expect(res).toEqual({ ok: false, error: 'El archivo no es texto UTF-8' })
  })
})
