// masterCoordinates(code): ¿el código separa a t0 del resto con if/else?
// OpenMP no excluye al maestro de la región: solo el código del estudiante
// puede hacerlo. Detección ESTÁTICA y conservadora: únicamente la forma
// `if tid == 0: … else: …` (o `!= 0`), con `tid` = omp_get_thread_num().
// Todo lo demás (master, single, un if sin else) deja a t0 trabajando.
import { describe, expect, it } from 'vitest'
import { masterCoordinates } from '@/lib/masterRole'

const wrap = (body: string) =>
  `from numba.openmp import njit, openmp_context as openmp, omp_get_thread_num\n\n@njit\ndef f():\n    with openmp("parallel"):\n${body
    .split('\n')
    .map((l) => '        ' + l)
    .join('\n')}\n`

describe('masterCoordinates', () => {
  it('hello world: nadie separa a t0 → false', () => {
    expect(masterCoordinates(wrap('print("Hello", omp_get_thread_num())'))).toBe(false)
  })

  it('tid == 0 / else con la variable asignada → true', () => {
    const body = ['tid = omp_get_thread_num()', 'if tid == 0:', '    coordinar()', 'else:', '    trabajar()'].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(true)
  })

  it('llamada directa a omp_get_thread_num() == 0 con else → true', () => {
    const body = ['if omp_get_thread_num() == 0:', '    coordinar()', 'else:', '    trabajar()'].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(true)
  })

  it('0 == tid, con else → true', () => {
    const body = ['tid = omp_get_thread_num()', 'if 0 == tid:', '    coordinar()', 'else:', '    trabajar()'].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(true)
  })

  it('forma inversa tid != 0 / else (t0 va por el else) → true', () => {
    const body = ['tid = omp_get_thread_num()', 'if tid != 0:', '    trabajar()', 'else:', '    coordinar()'].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(true)
  })

  it('cadena if/elif/else sobre tid == 0 → true', () => {
    const body = [
      'tid = omp_get_thread_num()',
      'if tid == 0:',
      '    coordinar()',
      'elif tid == 1:',
      '    algo()',
      'else:',
      '    trabajar()',
    ].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(true)
  })

  it('if tid == 0 SIN else: t0 hace algo extra pero sigue trabajando → false', () => {
    const body = ['tid = omp_get_thread_num()', 'if tid == 0:', '    print("hola")', 'trabajar()'].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(false)
  })

  it('master y single no separan a t0 del trabajo → false', () => {
    expect(masterCoordinates(wrap(['with openmp("master"):', '    log()', 'trabajar()'].join('\n')))).toBe(false)
    expect(masterCoordinates(wrap(['with openmp("single"):', '    log()', 'trabajar()'].join('\n')))).toBe(false)
  })

  it('el else de OTRO if (otro nivel de sangría) no cuenta → false', () => {
    const body = [
      'tid = omp_get_thread_num()',
      'if tid == 0:',
      '    print("x")',
      'if n > 3:',
      '    a()',
      'else:',
      '    b()',
    ].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(false)
  })

  it('una variable que NO viene de omp_get_thread_num no cuenta → false', () => {
    const body = ['i = 0', 'if i == 0:', '    a()', 'else:', '    b()'].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(false)
  })

  it('código comentado no cuenta → false', () => {
    const body = ['tid = omp_get_thread_num()', '# if tid == 0:', '#     a()', '# else:', '#     b()', 'trabajar()'].join('\n')
    expect(masterCoordinates(wrap(body))).toBe(false)
  })

  it('tolera código vacío y saltos de línea Windows', () => {
    expect(masterCoordinates('')).toBe(false)
    const body = 'tid = omp_get_thread_num()\r\nif tid == 0:\r\n    a()\r\nelse:\r\n    b()\r\n'
    expect(masterCoordinates(body)).toBe(true)
  })
})
