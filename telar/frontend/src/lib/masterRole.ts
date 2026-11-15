// masterRole — ¿el código del estudiante separa a t0 del resto del equipo?
//
// OpenMP NO excluye al maestro de una región `parallel`: t0 es un miembro más
// y ejecuta el mismo bloque. Solo el código del estudiante puede apartarlo, y
// la única forma que se detecta de manera fiable (análisis ESTÁTICO y
// conservador, sin ejecutar nada) es:
//
//     tid = omp_get_thread_num()
//     if tid == 0:        # (o `!=`, o `omp_get_thread_num() == 0`, o `0 == tid`)
//         ...             # t0 coordina
//     else:
//         ...             # el resto trabaja
//
// NO cuentan: `openmp("master")` (t0 sigue trabajando después), `single` (lo
// ejecuta CUALQUIER hilo, no necesariamente t0) ni un `if tid == 0` sin `else`
// (t0 hace algo extra pero comparte el trabajo). Un falso negativo solo deja
// la figura como «t0 · maestro»; un falso positivo sería afirmar algo que el
// código no hace, por eso la regla es estrecha.

const THREAD_CALL = 'omp_get_thread_num()'

/** Texto de ayuda común (idle y en vivo) cuando se detecta la separación. */
export const MASTER_COORDINATES_NOTE =
  'Tu código manda a t0 por una rama aparte (if … == 0 / else): t0 coordina y el resto trabaja. ' +
  'Lo deduce Telar leyendo el código; OpenMP por sí solo no excluye al maestro.'

const stripComment = (line: string): string => {
  const i = line.indexOf('#')
  return i === -1 ? line : line.slice(0, i)
}

const indentOf = (line: string): number => line.length - line.trimStart().length

/** Nombres asignados directamente desde omp_get_thread_num(). */
function threadIdAliases(lines: readonly string[]): Set<string> {
  const aliases = new Set<string>()
  for (const line of lines) {
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*omp_get_thread_num\(\)\s*$/.exec(line)
    if (m != null) aliases.add(m[1])
  }
  return aliases
}

/** `tid == 0`, `tid != 0`, `0 == tid` (o la llamada directa), con paréntesis opcionales. */
function isThreadZeroTest(condition: string, aliases: ReadonlySet<string>): boolean {
  let c = condition.replace(/\s+/g, '').replace(/omp_get_thread_num\(\)/g, THREAD_CALL)
  while (c.startsWith('(') && c.endsWith(')')) c = c.slice(1, -1)
  const side = /^(.+?)(==|!=)(.+)$/.exec(c)
  if (side == null) return false
  const [, left, , right] = side
  const isId = (s: string) => s === THREAD_CALL || aliases.has(s)
  return (isId(left) && right === '0') || (left === '0' && isId(right))
}

/** true si algún `if` sobre «soy el hilo 0» tiene `else` en su cadena if/elif/else. */
export function masterCoordinates(code: string): boolean {
  const lines = code.split(/\r?\n/).map(stripComment)
  const aliases = threadIdAliases(lines)

  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)if\s+(.+?)\s*:\s*$/.exec(lines[i])
    if (m == null || !isThreadZeroTest(m[2], aliases)) continue
    const ifIndent = m[1].length

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '' || indentOf(line) > ifIndent) continue // cuerpo del bloque
      if (indentOf(line) < ifIndent) break // salió del bloque que contiene al if
      const head = line.trim()
      if (/^else\s*:/.test(head)) return true
      if (/^elif[\s(]/.test(head)) continue // sigue la cadena
      break // otra sentencia al mismo nivel: la cadena terminó sin else
    }
  }
  return false
}
