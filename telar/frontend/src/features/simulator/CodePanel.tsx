// CodePanel — card «Tu código» del idle (frontend-spec §6.2): dropzone del
// handoff con accept=".py" + validación client-side (extensión, ≤256 KB,
// UTF-8) y preview EDITABLE estilo terminal (--term-bg, mono 11.5px, sin
// resaltado en MVP). Editar el código de un ejemplo lo marca `modificado`.
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Card, CardHead } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { IconCode, IconUpload } from '../../components/icons/icons'
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

export function CodePanel({ filename, code, edited, onCodeChange, onFile }: CodePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const { fileError, pick: handleFile } = usePyFilePicker(onFile)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    void handleFile(e.dataTransfer.files[0])
  }

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.currentTarget.files?.[0])
    e.currentTarget.value = '' // permite re-seleccionar el mismo archivo
  }

  return (
    <Card className="code-upload">
      <CardHead icon={<IconCode size={16} />} title="Tu código" sub={filename || 'sin archivo'} />
      <div className="code-upload-body">
        <label
          className={['dropzone', dragOver ? 'drag-over' : ''].filter(Boolean).join(' ')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input ref={inputRef} type="file" accept=".py" hidden onChange={onInput} />
          <IconUpload size={22} />
          <div className="dz-title">Arrastra tu archivo aquí</div>
          <div className="dz-sub mono-small">.py · máx 256 KB</div>
          <Button
            variant="outline"
            size="sm"
            style={{ marginTop: 10 }}
            onClick={(e) => {
              e.preventDefault()
              inputRef.current?.click()
            }}
          >
            O selecciónalo
          </Button>
        </label>
        {fileError != null && (
          <div className="field-hint error" role="alert">
            {fileError}
          </div>
        )}
        <div className="code-preview">
          <div className="code-preview-head">
            <span className="mono-small">{filename || 'main.py'}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              {edited && <Chip tone="amber">modificado</Chip>}
              <Chip tone="orange">Python · OpenMP</Chip>
            </span>
          </div>
          <textarea
            className="code-editor"
            value={code}
            spellCheck={false}
            aria-label="Editor de código Python"
            onChange={(e) => onCodeChange(e.currentTarget.value)}
          />
        </div>
      </div>
    </Card>
  )
}
