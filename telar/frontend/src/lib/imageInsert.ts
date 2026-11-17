// lib/imageInsert.ts — pieza pura del botón «Insertar imagen» del editor de
// lecciones: validar el archivo en el cliente (el backend vuelve a validar) y
// meter el markdown `![texto](url)` donde está el cursor.

/** Mismo tope que el backend (services/image_upload.MAX_IMAGE_BYTES). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
const IMAGE_TYPES = new Set(IMAGE_ACCEPT.split(','))

/** Mensaje de error si el archivo no sirve, o `null` si puede subirse. */
export function imageFileIssue(file: { type: string; size: number; name?: string }): string | null {
  if (!IMAGE_TYPES.has(file.type)) {
    return file.type === 'image/svg+xml'
      ? 'SVG no se permite (puede contener scripts). Expórtalo como PNG o JPG.'
      : 'Formato no admitido. Usa PNG, JPG, GIF o WebP.'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return `La imagen pesa ${mb} MB y el máximo es ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Redúcela o expórtala más comprimida.`
  }
  if (file.size === 0) return 'El archivo está vacío.'
  return null
}

/** Texto alternativo de partida: el nombre del archivo sin extensión ni símbolos de markdown. */
export function defaultAltText(filename: string): string {
  const base = filename.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const cleaned = base.replace(/[[\]()!`*_<>]/g, ' ').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()
  // Nombres que no describen nada («image», «IMG 20261116», «Captura de pantalla
  // 2026-11-16 190546»): se deja un texto para que el autor lo reemplace.
  const generic = /^(?:images?|img|imagen(?:es)?|foto|screenshot|captura)(?:\b.*\d{4,}.*)?$/i.test(cleaned)
  return cleaned === '' || generic ? 'Descripción de la imagen' : cleaned
}

export interface Inserted {
  value: string
  /** Dónde queda el cursor: justo después de la imagen. */
  cursor: number
}

/**
 * Inserta `![alt](url)` en `value`, reemplazando la selección [start, end).
 * La imagen va en SU PROPIA LÍNEA (así se renderiza como figura): se añade el
 * salto de párrafo antes y después solo si hace falta.
 */
export function insertImageMarkdown(value: string, start: number, end: number, alt: string, url: string): Inserted {
  const safeAlt = alt.replace(/[[\]]/g, '').trim()
  const md = `![${safeAlt}](${url})`
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const inserted = `${lead}${md}${trail}`
  return { value: before + inserted + after, cursor: before.length + lead.length + md.length }
}
