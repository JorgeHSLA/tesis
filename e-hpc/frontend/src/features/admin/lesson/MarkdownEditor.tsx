// MarkdownEditor — panel izquierdo del editor de lección (fase4-autoria §9.F.3).
// Textarea de markdown + vista previa renderizada con el MISMO renderMarkdown
// que ve el estudiante (WYSIWYG real: el subset permitido, escape incluido).
// La preview se recalcula con useMemo; el contenedor `.markdown` es el global.
import { useId, useMemo } from 'react'
import { renderMarkdown } from '../../../lib/markdown'

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** Error de campo (422 sobre `content_markdown`). */
  error?: string
}

export function MarkdownEditor({ value, onChange, error }: MarkdownEditorProps) {
  const id = useId()
  const html = useMemo(() => renderMarkdown(value), [value])

  return (
    <div className="col" style={{ gap: 12 }}>
      <div>
        <label className="field-label" htmlFor={id}>
          Contenido de la lección (Markdown)
        </label>
        <textarea
          id={id}
          className="textarea"
          value={value}
          spellCheck={false}
          aria-invalid={error != null}
          aria-describedby={error != null ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.currentTarget.value)}
          style={{ minHeight: 340, lineHeight: 1.6 }}
        />
        {error != null ? (
          <div id={`${id}-err`} className="field-hint error" role="alert">
            {error}
          </div>
        ) : (
          <div className="field-hint">
            Subset soportado: encabezados, listas, código, negrita/cursiva, enlaces y tablas.
          </div>
        )}
      </div>

      <div>
        <div className="field-label">Vista previa</div>
        <div
          className="markdown"
          data-testid="markdown-preview"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface)',
            padding: '16px 18px',
            minHeight: 140,
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
