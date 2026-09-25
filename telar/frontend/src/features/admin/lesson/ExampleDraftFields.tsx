// ExampleDraftFields — código + metadatos de un ejemplo que aún no existe.
// Reutiliza CodeDropzone y ExampleMetaFields; controlado por el contenedor.
import type { AdminExampleBaseDto } from '../../../api/admin-types'
import { CodeDropzone } from '../example/CodeDropzone'
import { ExampleMetaFields } from '../example/ExampleMetaFields'
import type { ExampleDraft } from './exampleDraft'

export interface ExampleDraftFieldsProps {
  value: ExampleDraft
  onChange: (next: ExampleDraft) => void
  maxTimeoutS: number
  errors?: Readonly<Record<string, string>>
}

export function ExampleDraftFields({ value, onChange, maxTimeoutS, errors = {} }: ExampleDraftFieldsProps) {
  const patchExample = (patch: Partial<AdminExampleBaseDto>) =>
    onChange({ ...value, example: { ...value.example, ...patch } })
  return (
    <>
      <CodeDropzone
        filename={value.example.filename}
        code={value.source_code}
        error={errors.source_code}
        onCodeChange={(source_code) => onChange({ ...value, source_code })}
        onFile={(file) =>
          onChange({ example: { ...value.example, filename: file.filename }, source_code: file.code })
        }
      />
      <ExampleMetaFields
        value={value.example}
        onChange={patchExample}
        maxTimeoutS={maxTimeoutS}
        errors={errors}
        errorPrefix="example."
      />
    </>
  )
}
