// codeHighlight.tsx — resaltado mínimo de directivas OpenMP para el bloque de
// código de la lección (tab "Código" de LessonInfo). Regex simple sobre los
// strings `openmp("...")`, NO un highlighter completo. Extraído del antiguo
// CodeShowcase (2026-07) al convertir el bloque grande en reproductor de video.
import type { ReactNode } from 'react'

/** Resalta `openmp("...")` (y el contexto `with openmp(...)`) con term-orange. */
const DIRECTIVE_RE = /openmp\s*\(\s*"[^"]*"\s*\)/g

export function highlightDirectives(code: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of code.matchAll(DIRECTIVE_RE)) {
    const start = match.index
    if (start > last) nodes.push(code.slice(last, start))
    nodes.push(
      <span key={`dir-${key++}`} className="term-orange">
        {match[0]}
      </span>,
    )
    last = start + match[0].length
  }
  if (last < code.length) nodes.push(code.slice(last))
  return nodes
}
