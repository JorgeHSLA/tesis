// tests/admin/pyfile.test.ts — validación client-side de archivos .py extraída
// a lib/pyfile (DRY con CodePanel). Cubre extensión, tamaño (256 KB inclusivo)
// y decode UTF-8 estricto.
import { describe, expect, it } from 'vitest'
import { isValidPyFilename, MAX_CODE_BYTES, normalizePyFilename, validatePyFile } from '@/lib/pyfile'

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

// CU-06.3: el backend exige ^[A-Za-z0-9._-]{1,80}\.py$. El nombre se normaliza
// al leerlo (sin perder el código) en vez de fallar después, al ejecutar.
describe('nombre de archivo (CU-06.3)', () => {
  it.each([
    ['demo.py', 'demo.py'],
    ['Demo.PY', 'Demo.py'],
    ['mi programa (1).py', 'mi_programa_1_.py'],
    ['año_señal.py', 'ano_senal.py'],
    ['.py', 'main.py'],
    [`${'a'.repeat(90)}.py`, `${'a'.repeat(80)}.py`],
  ])('normalizePyFilename(%j) → %j', (entrada, salida) => {
    expect(normalizePyFilename(entrada)).toBe(salida)
    expect(isValidPyFilename(salida)).toBe(true)
  })

  it('isValidPyFilename sigue el patrón del backend', () => {
    expect(isValidPyFilename('ok-1.2_x.py')).toBe(true)
    for (const mal of ['con espacio.py', 'MAYUS.PY', 'x.txt', '.py', `${'a'.repeat(81)}.py`, 'ñ.py']) {
      expect(isValidPyFilename(mal)).toBe(false)
    }
  })

  it('validatePyFile devuelve el nombre ya normalizado y el código intacto', async () => {
    const res = await validatePyFile(new File(['print(1)\n'], 'Mi Programa.PY'))
    expect(res).toEqual({ ok: true, value: { filename: 'Mi_Programa.py', code: 'print(1)\n' } })
  })
})
