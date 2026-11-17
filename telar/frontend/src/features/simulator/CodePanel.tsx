// CodePanel — card «Tu código» del idle (frontend-spec §6.2): editor EDITABLE
// estilo terminal (--term-bg, mono) CON colores de sintaxis (2026-11: pedido de
// las pruebas de usabilidad). El truco es el clásico: un <pre> coloreado DETRÁS
// y el <textarea> encima con el texto transparente — el textarea sigue siendo
// el editor real (selección, deshacer, accesibilidad), el <pre> solo pinta.
// Subir un .py
// (botón «Subir .py» de la cabecera, o arrastrándolo sobre la card) lo valida
// en el cliente (extensión, ≤256 KB, UTF-8) y pasa a código propio. Editar el
// código de un ejemplo lo marca `modificado`.
import { Fragment, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type UIEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, CardHead } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { IconCode, IconUpload } from '../../components/icons/icons'
import { MAX_HIGHLIGHT_CHARS, tokenizePython } from '../../lib/pyHighlight'
import { MAX_CODE_BYTES, type PickedFile } from '../../lib/pyfile'
import { usePyFilePicker } from '../../hooks/usePyFilePicker'

// Re-export para no romper a los importadores existentes (SimulatorIdle usa
// `PickedFile` y el tope de bytes desde este módulo).
export { MAX_CODE_BYTES }
export type { PickedFile }

export interface CodePanelProps {
  filename: string
  code: string
  /** Código de ejemplo editado → chip-amber `modificado`. */
  edited: boolean
  onCodeChange: (code: string) => void
  /** Archivo .py válido soltado/seleccionado (pasa a código propio). */
  onFile: (file: PickedFile) => void
}

/** El arrastre trae archivos (y no, p. ej., texto movido dentro del editor). */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types ?? []).includes('Files')
}

export function CodePanel({ filename, code, edited, onCodeChange, onFile }: CodePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const { fileError, pick: handleFile } = usePyFilePicker(onFile)
  const preRef = useRef<HTMLPreElement>(null)
  // Archivos enormes se dejan sin color: cada pulsación re-tokeniza todo el texto.
  const highlight = code.length <= MAX_HIGHLIGHT_CHARS
  const tokens = useMemo(() => (highlight ? tokenizePython(code) : []), [code, highlight])

  // El <pre> sigue el scroll del <textarea> para que el color quede bajo cada letra.
  const syncScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    const pre = preRef.current
    if (pre === null) return
    pre.scrollTop = e.currentTarget.scrollTop
    pre.scrollLeft = e.currentTarget.scrollLeft
  }

  // Solo se reacciona a ARCHIVOS: arrastrar texto dentro del editor (o desde
  // otra app) es del navegador y cancelarlo impediría moverlo.
  const onDrop = (e: DragEvent) => {
    if (!dragHasFiles(e)) return
    e.preventDefault()
    setDragOver(false)
    void handleFile(e.dataTransfer.files[0])
  }

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.currentTarget.files?.[0])
    e.currentTarget.value = '' // permite re-seleccionar el mismo archivo
  }

  return (
    <Card
      className={['code-upload', dragOver ? 'drag-over' : ''].filter(Boolean).join(' ')}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        // dragleave también se dispara al pasar sobre los hijos: solo cuenta
        // si el puntero sale de la card.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <CardHead
        icon={<IconCode size={16} />}
        title="Tu código"
        sub={filename || 'sin archivo'}
        right={
          <>
            {edited && <Chip tone="amber">modificado</Chip>}
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <IconUpload size={14} /> Subir .py
            </Button>
          </>
        }
      />
      <input ref={inputRef} type="file" accept=".py" hidden onChange={onInput} />
      <div className="code-upload-body">
        {fileError != null && (
          <div className="field-hint error" role="alert">
            {fileError}
          </div>
        )}
        <div className="code-preview">
          <div className={'code-editor-wrap' + (highlight ? ' is-highlighted' : '')}>
            {highlight && (
              <pre ref={preRef} className="code-highlight" aria-hidden="true">
                {tokens.map((t, i) =>
                  t.type === 'plain' ? (
                    <Fragment key={i}>{t.text}</Fragment>
                  ) : (
                    <span key={i} className={`tok-${t.type}`}>
                      {t.text}
                    </span>
                  ),
                )}
                {/* Sin esta línea, un salto final del textarea no tendría fila en el <pre>. */}
                {'\n'}
              </pre>
            )}
            <textarea
              className="code-editor"
              value={code}
              spellCheck={false}
              aria-label="Editor de código Python"
              onChange={(e) => onCodeChange(e.currentTarget.value)}
              onScroll={syncScroll}
            />
          </div>
        </div>
      </div>
    </Card>
  )
}
