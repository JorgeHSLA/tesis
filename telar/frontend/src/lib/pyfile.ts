// lib/pyfile.ts — validación client-side de un archivo de código Python.
// Extraída LITERAL de features/simulator/CodePanel (DRY): la reutiliza tanto el
// dropzone del simulador como el uploader de ejemplos del modo autoría (admin).
// Reglas idénticas: extensión .py, ≤ 256 KB (262144 bytes), decodable UTF-8.
// Los mensajes de error son en español y no deben cambiar (tests Fase 3).

/** Tope de tamaño del código fuente subido (bytes). Espeja TELAR_MAX_CODE_BYTES. */
export const MAX_CODE_BYTES = 262144

export interface PickedFile {
  filename: string
  code: string
}

/** Resultado discriminado: éxito con el archivo leído, o fallo con el motivo. */
export type PyFileResult = { ok: true; value: PickedFile } | { ok: false; error: string }

/**
 * Valida y lee un archivo como código Python. Exige extensión `.py`, tamaño
 * ≤ 256 KB y contenido UTF-8 estricto (decode `fatal`). No confía en el MIME
 * del navegador. El backend re-valida siempre; esto es solo UX temprana.
 */
export async function validatePyFile(file: File): Promise<PyFileResult> {
  if (!file.name.toLowerCase().endsWith('.py')) return { ok: false, error: 'Solo archivos .py' }
  if (file.size > MAX_CODE_BYTES) return { ok: false, error: 'El archivo supera 256 KB' }
  try {
    const buffer = await file.arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return { ok: true, value: { filename: file.name, code: text } }
  } catch {
    return { ok: false, error: 'El archivo no es texto UTF-8' }
  }
}
