// lib/pyHighlight — colores de sintaxis del editor del simulador.
import { describe, expect, it } from 'vitest'
import { tokenizePython, type Token, type TokenType } from '@/lib/pyHighlight'

const kinds = (code: string, type: TokenType): string[] =>
  tokenizePython(code)
    .filter((t) => t.type === type)
    .map((t) => t.text)

const rebuilt = (tokens: Token[]): string => tokens.map((t) => t.text).join('')

describe('tokenizePython', () => {
  it('conserva el texto original exacto (el color no puede mover letras)', () => {
    const code = '@njit\ndef f(n):\n    s = 0  # suma\n    with openmp("parallel for"):\n        s += 1.5e3\n    return "ok\n"\n'
    expect(rebuilt(tokenizePython(code))).toBe(code)
  })

  it('palabras clave, integradas y nombre tras def/class', () => {
    const code = 'def suma(a):\n    for i in range(3):\n        print(i)\nclass Foo: pass'
    expect(kinds(code, 'keyword')).toEqual(['def', 'for', 'in', 'class', 'pass'])
    expect(kinds(code, 'builtin')).toEqual(['range', 'print'])
    expect(kinds(code, 'def')).toEqual(['suma', 'Foo'])
  })

  it('decoradores, números y comentarios', () => {
    const code = '@njit\nx = 0x1F + 3.14 + 1e-3 + 7  # cuenta'
    expect(kinds(code, 'decorator')).toEqual(['@njit'])
    expect(kinds(code, 'number')).toEqual(['0x1F', '3.14', '1e-3', '7'])
    expect(kinds(code, 'comment')).toEqual(['# cuenta'])
  })

  it('un # dentro de una cadena NO es comentario', () => {
    const code = 's = "a # b"  # real'
    expect(kinds(code, 'string')).toEqual(['"a # b"'])
    expect(kinds(code, 'comment')).toEqual(['# real'])
  })

  it('las directivas dentro de openmp("…") se distinguen de otras cadenas', () => {
    const code = 'with openmp("parallel for reduction(+:t)"):\n    print("hola")'
    expect(kinds(code, 'omp')).toEqual(['"parallel for reduction(+:t)"'])
    expect(kinds(code, 'string')).toEqual(['"hola"'])
  })

  it('cadenas con prefijo, comillas simples y triples (multilínea)', () => {
    const code = `a = f'x{1}'\nb = r"\d"\nc = """uno\ndos"""`
    expect(kinds(code, 'string')).toEqual([`f'x{1}'`, 'r"\d"', '"""uno\ndos"""'])
  })

  it('escapes dentro de la cadena no la cortan', () => {
    expect(kinds('x = "di \\"hola\\""', 'string')).toEqual(['"di \\"hola\\""'])
  })

  it('código a medio escribir: una cadena sin cerrar llega hasta el fin de la línea', () => {
    const code = 'x = "sin cerrar\ny = 2'
    expect(kinds(code, 'string')).toEqual(['"sin cerrar'])
    expect(kinds(code, 'number')).toEqual(['2'])
    expect(rebuilt(tokenizePython(code))).toBe(code)
  })

  it('un identificador con dígitos no se parte en número', () => {
    expect(kinds('t0 = x1 + 2x', 'number')).toEqual([])
  })

  it('vacío → sin tokens; solo espacios → un tramo plano', () => {
    expect(tokenizePython('')).toEqual([])
    expect(tokenizePython('  \n  ')).toEqual([{ type: 'plain', text: '  \n  ' }])
  })

  it('no se cuelga con caracteres raros ni con muchísimo texto', () => {
    const rare = '\u0000€𝄞 $ ? ` \ ~'
    expect(rebuilt(tokenizePython(rare))).toBe(rare)
    const big = 'x = 1\n'.repeat(5000)
    expect(rebuilt(tokenizePython(big))).toBe(big)
  })
})
