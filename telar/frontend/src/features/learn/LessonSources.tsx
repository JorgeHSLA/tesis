// LessonSources — fuentes de la lección, ARRIBA del contenido y compactas.
//
// Antes eran un «## Fuentes» al final del texto, que casi nadie llegaba a ver
// (pruebas de usabilidad, 2026-11). Ahora cada fuente es una etiqueta; al pasar
// el cursor (o enfocarla con el teclado) se despliega la cita completa y la
// opción de abrir el enlace. Pulsar la etiqueta abre el primer enlace.
//
// El desplegable es CSS puro (:hover / :focus-within): sin estado ni listeners.
// Los enlaces son siempre https/http (lib/lessonSources.ts descarta el resto) y
// se abren con rel="noreferrer noopener"; en la app de escritorio, Electron los
// redirige al navegador del sistema (windowOpenHandler).
import { hostOf, type LessonSource } from '../../lib/lessonSources'

export interface LessonSourcesProps {
  sources: readonly LessonSource[]
}

export function LessonSources({ sources }: LessonSourcesProps) {
  if (sources.length === 0) return null
  return (
    <section className="lesson-sources" aria-label="Fuentes de esta lección">
      <span className="lesson-sources-title">Fuentes</span>
      <ul className="lesson-sources-list">
        {sources.map((source, i) => {
          const first = source.links[0]
          const popId = `lesson-source-${i}`
          return (
            <li key={`${i}-${source.label}`} className="lesson-source">
              {first !== undefined ? (
                <a
                  className="lesson-source-chip"
                  href={first.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-describedby={popId}
                >
                  {source.label}
                  <span aria-hidden="true"> ↗</span>
                </a>
              ) : (
                <span className="lesson-source-chip" tabIndex={0} aria-describedby={popId}>
                  {source.label}
                </span>
              )}
              <span className="lesson-source-pop" role="tooltip" id={popId}>
                <span className="lesson-source-cite">{source.citation}</span>
                {source.links.map((link) => (
                  <a
                    key={link.url}
                    className="lesson-source-open"
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Abrir «{link.text}» <span className="lesson-source-host">{hostOf(link.url)} ↗</span>
                  </a>
                ))}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
