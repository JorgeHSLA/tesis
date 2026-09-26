// hooks/usePyFilePicker.ts — lectura + validación de un `.py` elegido o soltado
// (lib/pyfile), compartida por el dropzone del simulador y el del editor de
// ejemplos. Solo la ÚLTIMA elección aplica su resultado: si el primer archivo
// tarda más en leerse que el segundo, su código (o su error) llega tarde y se
// descarta en vez de pisar al nuevo (CU-06.1).
import { useCallback, useRef, useState } from 'react'
import { validatePyFile, type PickedFile } from '../lib/pyfile'

export function usePyFilePicker(onFile: (file: PickedFile) => void) {
  const [fileError, setFileError] = useState<string | null>(null)
  const lastPick = useRef(0)
  const onFileRef = useRef(onFile)
  onFileRef.current = onFile

  const pick = useCallback(async (file: File | undefined) => {
    if (file == null) return
    const pickId = ++lastPick.current
    const result = await validatePyFile(file)
    if (pickId !== lastPick.current) return
    if (result.ok) {
      setFileError(null)
      onFileRef.current(result.value)
    } else {
      setFileError(result.error)
    }
  }, [])

  return { fileError, pick }
}
