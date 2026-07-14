// CodeDropzone — subida + edición del código `.py` del ejemplo (autoría §9.F.5).
// Reutiliza LITERAL las clases del dropzone/editor del simulador (.dropzone,
// .code-upload, .code-editor) importando su hoja de estilo, y la MISMA
// validación client-side (lib/pyfile: extensión .py, ≤256 KB, UTF-8 estricto).
// El backend re-valida siempre (413/415/422); esto es UX temprana.
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import '../../../styles/screens/simulator.css'
import { Button } from '../../../components/ui/Button'
import { Card, CardHead } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { IconCode, IconUpload } from '../../../components/icons/icons'
import { validatePyFile, type PickedFile } from '../../../lib/pyfile'

export interface CodeDropzoneProps {
  filename: string
  code: string
  /** Código editado a mano en el textarea. */
  onCodeChange: (code: string) => void
  /** Archivo `.py` válido soltado/seleccionado (fija filename + código). */
  onFile: (file: PickedFile) => void
  /** Hay cambios de código sin guardar → chip `modificado`. */
  edited?: boolean
  /** Error de campo (422 sobre `source_code`). */
  error?: string
}

export function CodeDropzone({
  filename,
  code,
  onCodeChange,
  onFile,
  edited = false,
  error,
}: CodeDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (file == null) return
    const result = await validatePyFile(file)
    if (result.ok) {
      setFileError(null)
      onFile(result.value)
    } else {
      setFileError(result.error)
    }
  }

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
      <CardHead icon={<IconCode size={16} />} title="Código del ejemplo" sub={filename || 'sin archivo'} />
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
          <div className="dz-title">Arrastra el archivo aquí</div>
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

        {(fileError ?? error) != null && (
          <div className="field-hint error" role="alert">
            {fileError ?? error}
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
            aria-label="Editor de código Python del ejemplo"
            onChange={(e) => onCodeChange(e.currentTarget.value)}
          />
        </div>
      </div>
    </Card>
  )
}
