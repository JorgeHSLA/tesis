// SourcesEditor — sección DEDICADA a las fuentes de la lección (Autoría).
//
// Antes se escribían al final del contenido markdown (`## Fuentes`). Ahora van
// aquí, cada una con sus campos, y el estudiante las ve arriba de la lección
// como etiquetas con enlace (features/learn/LessonSources). Al guardar se
// vuelven a escribir en el markdown, así que nada cambia en lo ya publicado.
import { Button } from '../../../components/ui/Button'
import { IconPlus } from '../../../components/icons/icons'
import { AdminHelp } from './adminHelp'
import { blankSourceRow, sourceRowIssue, type SourceRow } from './sourceRows'

export interface SourcesEditorProps {
  rows: readonly SourceRow[]
  onChange: (rows: SourceRow[]) => void
  /** Error general (p. ej. al intentar guardar con enlaces inválidos). */
  error?: string
}

export function SourcesEditor({ rows, onChange, error }: SourcesEditorProps) {
  const patch = (key: string, field: keyof Omit<SourceRow, 'key' | 'raw'>, value: string) =>
    // Tocar un campo descarta el texto original: la viñeta se reconstruye desde los campos.
    onChange(rows.map((r) => (r.key === key ? { ...r, raw: null, [field]: value } : r)))

  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta
    if (to < 0 || to >= rows.length) return
    const next = [...rows]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }

  return (
    <section className="sources-editor" aria-label="Fuentes de la lección">
      <div className="md-editor-head">
        <span className="md-editor-title">
          <span className="field-label">Fuentes de la lección</span>
          {AdminHelp.fuentes}
        </span>
        <Button variant="outline" size="sm" onClick={() => onChange([...rows, blankSourceRow()])}>
          <IconPlus size={14} /> Agregar fuente
        </Button>
      </div>
      {rows.length === 0 && <div className="sources-empty">Esta lección todavía no tiene fuentes.</div>}

      <ol className="sources-list">
        {rows.map((row, i) => {
          const issue = sourceRowIssue(row)
          return (
            <li key={row.key} className="sources-row">
              <div className="sources-row-grid">
                <label className="sources-field">
                  <span className="field-label">Título del enlace</span>
                  <input
                    className="input"
                    type="text"
                    value={row.title}
                    placeholder="OpenMP API Specification 5.2"
                    aria-invalid={issue != null}
                    onChange={(e) => patch(row.key, 'title', e.currentTarget.value)}
                  />
                </label>
                <label className="sources-field">
                  <span className="field-label">Enlace (https://…)</span>
                  <input
                    className="input"
                    type="url"
                    inputMode="url"
                    value={row.url}
                    placeholder="https://www.openmp.org/…"
                    aria-invalid={issue != null}
                    onChange={(e) => patch(row.key, 'url', e.currentTarget.value)}
                  />
                </label>
                <label className="sources-field">
                  <span className="field-label">Autor o entidad (opcional)</span>
                  <input
                    className="input"
                    type="text"
                    value={row.author}
                    placeholder="OpenMP Architecture Review Board"
                    onChange={(e) => patch(row.key, 'author', e.currentTarget.value)}
                  />
                </label>
                <label className="sources-field">
                  <span className="field-label">Nota (opcional)</span>
                  <input
                    className="input"
                    type="text"
                    value={row.note}
                    placeholder="constructos task y taskwait"
                    onChange={(e) => patch(row.key, 'note', e.currentTarget.value)}
                  />
                </label>
              </div>
              <div className="sources-row-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Subir la fuente ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Bajar la fuente ${i + 1}`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Quitar la fuente ${i + 1}`}
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                >
                  Quitar
                </button>
              </div>
              {issue != null && (
                <div className="field-hint error" role="alert">
                  {issue}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {error != null && (
        <div className="field-hint error" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}
