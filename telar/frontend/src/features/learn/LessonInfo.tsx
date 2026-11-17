// LessonInfo — card "De qué va esta lección" (frontend-spec §6.6), ABIERTA por
// defecto y plegable a voluntad:
// tabs Descripción (content_markdown de GET /lessons/{id}, renderizado con el
// subset de lib/markdown.ts) · Código (source_code expandido con directivas
// resaltadas) · Salida esperada (expected_output_note en bloque terminal).
// Se elimina la tab Transcripción (no hay videos). + Takeaways y CTAs.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ExampleDetailDto, LessonDetailDto } from '../../api/types'
import { IconCheck, IconChevronRight, IconDownload, IconPlay } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useBrokenImageFallback } from '../../hooks/useBrokenImageFallback'
import { splitSources } from '../../lib/lessonSources'
import { renderMarkdown } from '../../lib/markdown'
import { LessonSources } from './LessonSources'
import { highlightDirectives } from './codeHighlight'

type LessonTab = 'descripcion' | 'codigo' | 'salida'

// E1: las tabs de Código y Salida esperada solo existen si hay ejemplo. Una
// lección conceptual muestra una sola tab, y entonces la tira de tabs sobra.
const TABS_CON_EJEMPLO: Array<{ id: LessonTab; label: string }> = [
  { id: 'descripcion', label: 'Descripción' },
  { id: 'codigo', label: 'Código' },
  { id: 'salida', label: 'Salida esperada' },
]

export interface LessonInfoProps {
  lesson: LessonDetailDto
  /** E1: `null` en una lección conceptual. */
  example: ExampleDetailDto | null
  runDisabled: boolean
}

export function LessonInfo({ lesson, example, runDisabled }: LessonInfoProps) {
  const navigate = useNavigate()
  // 2026-08: nace ABIERTA. Colapsada por defecto (2026-07) tenía sentido cuando
  // el bloque grande de arriba era un video; con el mapa de videos vacío el
  // resultado combinado era una lección que no mostraba nada al abrirse
  // (hallazgo C1). El toggle se conserva: quien quiera plegarla puede.
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<LessonTab>('descripcion')

  // «## Fuentes» sale del cuerpo y se muestra ARRIBA, como etiquetas con enlace.
  const { body, sources } = useMemo(() => splitSources(lesson.content_markdown), [lesson.content_markdown])
  const markdownHtml = useMemo(() => renderMarkdown(body), [body])
  // Imagen que no carga (sin internet…) → aviso en lugar de un icono roto.
  const markdownRef = useBrokenImageFallback()

  const download = () => {
    if (example == null) return
    const blob = new Blob([example.source_code], { type: 'text/x-python' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = example.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <button type="button" className={`collapse-head ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconChevronRight size={16} className="collapse-chev" />
        <h3 className="display-md" style={{ margin: 0, flex: 1, textAlign: 'left' }}>
          De qué va esta lección
        </h3>
        <span className="mono-small">{open ? 'ocultar' : 'mostrar'}</span>
      </button>
      {open && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          {/* C4: `difficulty` y `directives` se escribían en autoría, viajaban
              por la API y no se pintaban en ninguna pantalla del estudiante.
              Las directivas son además la mejor pista de qué enseña el código.
              E1: una lección conceptual no tiene ninguna de las dos cosas. */}
          {example != null && (
            <div className="lesson-facts">
              <span className="mono-small">Dificultad {example.difficulty}/5</span>
              {example.directives.length > 0 && (
                <span className="lesson-directives">
                  <span className="mono-small">Directivas:</span>
                  {example.directives.map((directive) => (
                    <code key={directive}>{directive}</code>
                  ))}
                </span>
              )}
            </div>
          )}

          {/* E1: sin ejemplo no hay Código ni Salida esperada, así que la
              tira de tabs no aporta nada: la descripción se muestra sola. */}
          {example != null && (
            <div className="tabs" role="tablist" aria-label="Contenido de la lección">
              {TABS_CON_EJEMPLO.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`tab ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {(example == null || tab === 'descripcion') && (
            <>
              <LessonSources sources={sources} />
              {/* Markdown generado por lib/markdown.ts: todo el texto se escapa
                  antes de emitir HTML propio (subset seguro, sin HTML crudo). */}
              <div ref={markdownRef} className="markdown" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
              {example != null && example.takeaways.length > 0 && (
                <div className="takeaways" style={{ marginTop: 16 }}>
                  <div className="takeaway-title">Lo que vas a aprender</div>
                  <ul>
                    {example.takeaways.map((t) => (
                      <li key={t}>
                        <IconCheck size={14} /> <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {example != null && tab === 'codigo' && (
            <pre className="code-full">{highlightDirectives(example.source_code)}</pre>
          )}

          {example != null && tab === 'salida' && (
            <>
              <p className="expected-output-note">Qué deberías ver al ejecutar este ejemplo:</p>
              <pre className="expected-output">{example.expected_output_note}</pre>
            </>
          )}

          {/* Sin código no hay nada que ejecutar ni que descargar: los CTA no
              se deshabilitan, desaparecen. */}
          {example != null && (
            <div className="row" style={{ marginTop: 18, gap: 10 }}>
              <Button
                variant="primary"
                disabled={runDisabled}
                onClick={() => navigate(`/simulador?ejemplo=${encodeURIComponent(example.id)}`)}
              >
                <IconPlay size={14} /> Probar en el simulador
              </Button>
              <Button variant="outline" onClick={download}>
                <IconDownload size={14} /> Descargar {example.filename}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
