// lib/pyHighlight.ts — resaltado de sintaxis de Python para el editor del
// simulador (colores del código, pedidos en las pruebas de usabilidad).
//
// A mano y sin librerías, igual que las gráficas (convención del frontend): un
// recorrido de izquierda a derecha con expresiones «pegajosas» que reconoce
// comentarios, cadenas (simples, triples, con prefijo r/f/b), decoradores,
// números, palabras clave, funciones integradas y los nombres tras `def`/`class`.
// Las cadenas dentro de `openmp("…")` se distinguen: son las directivas OpenMP,
// lo que el curso enseña a leer.
//
// No es un parser: es tolerante a código a medio escribir (una cadena sin
// cerrar llega hasta el fin de la línea; nunca lanza ni se queda en bucle).

export type TokenType = 'plain' | 'keyword' | 'builtin' | 'string' | 'omp' | 'number' | 'comment' | 'decorator' | 'def'

export interface Token {
  type: TokenType
  text: string
}

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
])

const BUILTINS = new Set([
  'print', 'range', 'len', 'int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple', 'sum', 'min', 'max',
  'abs', 'round', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'open', 'type', 'isinstance', 'input',
  'openmp', 'njit', 'prange',
])

// Cada patrón es «pegajoso» (flag y): solo coincide justo en `lastIndex`.
const COMMENT = /#[^\n]*/y
const TRIPLE = /[rRbBuUfF]{0,2}("""|''')[\s\S]*?(?:\1|$)/y
// Una cadena sin cerrar termina en el salto de línea (o el fin del texto).
const STRING = /[rRbBuUfF]{0,2}("|')(?:\\.|(?!\1)[^\\\n])*(?:\1|(?=\n)|$)/y
const DECORATOR = /@[A-Za-z_][\w.]*/y
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?j?)(?![A-Za-z_])/y
const IDENT = /[A-Za-z_]\w*/y
const SPACE = /[ \t]+/y

/** Por encima de este tamaño no se resalta (cada pulsación re-tokeniza todo). */
export const MAX_HIGHLIGHT_CHARS = 60_000

function matchAt(re: RegExp, code: string, at: number): string | null {
  re.lastIndex = at
  const m = re.exec(code)
  return m !== null && m.index === at && m[0].length > 0 ? m[0] : null
}

export function tokenizePython(code: string): Token[] {
  const out: Token[] = []
  const push = (type: TokenType, text: string) => {
    const last = out[out.length - 1]
    // Se fusionan los tramos sin color para no inflar el DOM.
    if (last !== undefined && last.type === 'plain' && type === 'plain') last.text += text
    else out.push({ type, text })
  }

  // Últimos dos significativos (sin espacios): detectan `openmp(` y `def nombre`.
  let prev1 = ''
  let prev2 = ''
  const remember = (text: string) => {
    prev2 = prev1
    prev1 = text
  }

  let i = 0
  while (i < code.length) {
    let tok: string | null
    if ((tok = matchAt(SPACE, code, i)) !== null) {
      push('plain', tok)
      i += tok.length
      continue
    }
    if ((tok = matchAt(COMMENT, code, i)) !== null) {
      push('comment', tok)
    } else if ((tok = matchAt(TRIPLE, code, i)) !== null || (tok = matchAt(STRING, code, i)) !== null) {
      // Las cadenas de `openmp("…")` son las directivas de OpenMP.
      push(prev1 === '(' && prev2 === 'openmp' ? 'omp' : 'string', tok)
      remember(tok)
    } else if ((tok = matchAt(DECORATOR, code, i)) !== null) {
      push('decorator', tok)
      remember(tok)
    } else if ((tok = matchAt(NUMBER, code, i)) !== null) {
      push('number', tok)
      remember(tok)
    } else if ((tok = matchAt(IDENT, code, i)) !== null) {
      let type: TokenType = 'plain'
      if (prev1 === 'def' || prev1 === 'class') type = 'def'
      else if (KEYWORDS.has(tok)) type = 'keyword'
      else if (BUILTINS.has(tok)) type = 'builtin'
      push(type, tok)
      remember(tok)
    } else {
      // Un carácter cualquiera (operador, paréntesis, salto de línea…).
      tok = code[i]
      push('plain', tok)
      if (tok !== '\n') remember(tok)
    }
    i += tok.length
  }
  return out
}
