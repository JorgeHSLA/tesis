// CodeShowcase — reemplazo del "video player" del handoff (frontend-spec
// §6.6): el código del ejemplo en un panel estilo terminal (marco 16:9,
// fondo --term-bg) con las directivas OpenMP resaltadas — regex simple sobre
// los strings `openmp("...")`, NO un highlighter completo — y el botón play
// de 72 px heredado con label `Ejecutar en el simulador`.
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPlay } from '../../components/icons/icons'

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

export interface CodeShowcaseProps {
  sourceCode: string
  filename: string
  exampleId: string
  /** Lección GPU sin GPU: el botón queda disabled (frontend-spec §6.6). */
  runDisabled: boolean
}

export function CodeShowcase({ sourceCode, filename, exampleId, runDisabled }: CodeShowcaseProps) {
  const navigate = useNavigate()
  const run = () => navigate(`/simulador?ejemplo=${encodeURIComponent(exampleId)}`)

  return (
    <div className="video-player code-showcase">
      <div className="code-screen">
        <pre className="code-screen-pre" aria-hidden="true">
          {highlightDirectives(sourceCode)}
        </pre>
        <div className="code-showcase-actions">
          <button
            type="button"
            className="video-play-btn"
            aria-label="Ejecutar en el simulador"
            onClick={run}
            disabled={runDisabled}
          >
            <IconPlay size={28} />
          </button>
          <span className="code-showcase-label">Ejecutar en el simulador</span>
        </div>
      </div>
      <div className="code-showcase-foot">
        <span className="mono-small">{filename}</span>
        <span className="chip chip-orange">Python · OpenMP</span>
      </div>
    </div>
  )
}
