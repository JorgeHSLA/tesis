// MarkdownEditor — panel izquierdo del editor de lección (fase4-autoria §9.F.3).
// Textarea de markdown + vista previa renderizada con el MISMO renderMarkdown
// que ve el estudiante (WYSIWYG real: el subset permitido, escape incluido).
// La preview se recalcula con useMemo; el contenedor `.markdown` es el global.
//
// Imágenes (2026-11-16): «Insertar imagen», arrastrar un archivo sobre el texto o
// pegar una captura. La imagen SUBE al bucket de Telar al momento (el nombre es
// el hash del contenido, así que repetirla no duplica) y en el texto queda solo
// `![descripción](url)` en su propia línea, igual que el video es un enlace.
// Necesita la misma clave de cuenta de servicio que publicar.
import { useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { uploadLessonImage } from '../../../api/admin'
import { ApiError } from '../../../api/client'
import { Button } from '../../../components/ui/Button'
import { useBrokenImageFallback } from '../../../hooks/useBrokenImageFallback'
import {
  IMAGE_ACCEPT,
  defaultAltText,
  imageFileIssue,
  insertImageMarkdown,
} from '../../../lib/imageInsert'
import { renderMarkdown } from '../../../lib/markdown'

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** Error de campo (422 sobre `content_markdown`). */
  error?: string
}

type UploadState = { kind: 'idle' } | { kind: 'uploading'; name: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string }

export function MarkdownEditor({ value, onChange, error }: MarkdownEditorProps) {
  const id = useId()
  const html = useMemo(() => renderMarkdown(value), [value])
  const previewRef = useBrokenImageFallback()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<UploadState>({ kind: 'idle' })
  const [dragOver, setDragOver] = useState(false)
  // Lo último escrito, para no insertar sobre un `value` viejo si se teclea mientras sube.
  const latest = useRef(value)
  latest.current = value
  /** ¿Ya puso el autor el cursor en el texto? (ver `insert`). */
  const touched = useRef(false)

  const insert = async (file: File) => {
    const issue = imageFileIssue(file)
    if (issue !== null) {
      setUpload({ kind: 'error', text: issue })
      return
    }
    const area = textareaRef.current
    // La posición se toma ANTES de subir: es donde el autor quería la imagen. Si
    // nunca puso el cursor en el texto, el navegador dice «0» (arriba del todo), y
    // lo esperable es añadirla al FINAL, no encima de la lección.
    const start = touched.current ? (area?.selectionStart ?? latest.current.length) : latest.current.length
    const end = touched.current ? (area?.selectionEnd ?? start) : start
    setUpload({ kind: 'uploading', name: file.name })
    try {
      const img = await uploadLessonImage(file)
      const inserted = insertImageMarkdown(
        latest.current,
        Math.min(start, latest.current.length),
        Math.min(end, latest.current.length),
        defaultAltText(file.name),
        img.url,
      )
      onChange(inserted.value)
      setUpload({
        kind: 'done',
        text: `Imagen subida (${img.width}×${img.height}, ${Math.max(1, Math.round(img.bytes / 1024))} KB). Edita la descripción entre los corchetes.`,
      })
      // El cursor queda tras la imagen; se espera a que React pinte el nuevo texto.
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (ta !== null) {
          ta.focus()
          ta.setSelectionRange(inserted.cursor, inserted.cursor)
        }
      })
    } catch (err: unknown) {
      setUpload({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'No se pudo subir la imagen. Revisa tu conexión.',
      })
    }
  }

  const firstImage = (files: FileList | null | undefined): File | undefined =>
    Array.from(files ?? []).find((f) => f.type.startsWith('image/'))

  const onPaste = (e: ClipboardEvent) => {
    const file = firstImage(e.clipboardData.files)
    if (file === undefined) return // texto normal: se pega como siempre
    e.preventDefault()
    void insert(file)
  }

  const onDrop = (e: DragEvent) => {
    const file = firstImage(e.dataTransfer.files)
    if (file === undefined) return
    e.preventDefault()
    setDragOver(false)
    void insert(file)
  }

  const uploading = upload.kind === 'uploading'

  return (
    <div className="col" style={{ gap: 12 }}>
      <div>
        <div className="md-editor-head">
          <label className="field-label" htmlFor={id}>
            Contenido de la lección (Markdown)
          </label>
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Subiendo imagen…' : 'Insertar imagen'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            aria-label="Elegir imagen para la lección"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = '' // permite elegir de nuevo el mismo archivo
              if (file !== undefined) void insert(file)
            }}
          />
        </div>
        <textarea
          id={id}
          ref={textareaRef}
          className={'textarea' + (dragOver ? ' is-dragover' : '')}
          value={value}
          spellCheck={false}
          aria-invalid={error != null}
          aria-describedby={error != null ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.currentTarget.value)}
          onFocus={() => {
            touched.current = true
          }}
          onPaste={onPaste}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault()
              setDragOver(true)
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{ minHeight: 340, lineHeight: 1.6 }}
        />
        {error != null ? (
          <div id={`${id}-err`} className="field-hint error" role="alert">
            {error}
          </div>
        ) : (
          <div className="field-hint">
            Subset soportado: encabezados, listas, código, negrita/cursiva, enlaces, tablas e imágenes (botón «Insertar
            imagen», o arrastra / pega una).
          </div>
        )}
        {upload.kind === 'error' && (
          <div className="field-hint error" role="alert">
            {upload.text}
          </div>
        )}
        {upload.kind === 'done' && (
          <div className="field-hint" role="status">
            {upload.text}
          </div>
        )}
      </div>

      <div>
        <div className="field-label">Vista previa</div>
        <div
          ref={previewRef}
          className="markdown"
          data-testid="markdown-preview"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface)',
            padding: '16px 18px',
            minHeight: 140,
            // Scroll PROPIO: sin esto la vista previa crecía con la lección (cientos de
            // líneas) y empujaba todo lo demás fuera de la pantalla.
            maxHeight: 460,
            overflowY: 'auto',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
