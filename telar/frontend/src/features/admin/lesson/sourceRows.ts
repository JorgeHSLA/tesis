// sourceRows.ts — modelo de una fuente en el editor de Autoría.
//
// Las fuentes de una lección viajan dentro de su markdown (`## Fuentes` con una
// viñeta por fuente), así que el contenido publicado y la app del estudiante no
// cambian. El editor, en cambio, las muestra en su PROPIA sección con campos
// separados, en vez de dejar que se mezclen con el texto de la lección.
//
// Cada fila conserva su `raw` (la viñeta original). Mientras la persona no la
// toque, al guardar se escribe EXACTAMENTE ese texto: abrir y guardar una
// lección por otro motivo no reformatea sus fuentes. Al editar un campo, `raw`
// se descarta y la viñeta se reconstruye desde los campos.

export interface SourceRow {
  /** Identidad estable de la fila (clave de React); no se guarda. */
  key: string
  /** Viñeta original sin tocar, o `null` si la fila se creó o editó aquí. */
  raw: string | null
  /** Autor o entidad (opcional): «OpenMP Architecture Review Board». */
  author: string
  /** Título del enlace; es la etiqueta que ve el estudiante. */
  title: string
  /** URL https:// del recurso (opcional: una fuente puede ser solo una cita). */
  url: string
  /** Aclaración corta (opcional): «constructos task y taskwait». */
  note: string
}

let counter = 0
export const newSourceKey = (): string => `src-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function blankSourceRow(): SourceRow {
  return { key: newSourceKey(), raw: null, author: '', title: '', url: '', note: '' }
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/
/** Marcas de énfasis alrededor del título: `*Título*`, `_Título_`, `**Título**`. */
const strip = (s: string): string => s.replace(/^[*_]+|[*_]+$/g, '').trim()

/** Viñeta de markdown → campos. Lo que no encaja en los campos va a `note`, sin perderse. */
export function parseSourceRow(raw: string): SourceRow {
  const m = LINK.exec(raw)
  if (m === null) {
    return { key: newSourceKey(), raw, author: '', title: raw.replace(/\s+/g, ' ').trim(), url: '', note: '' }
  }
  const before = raw.slice(0, m.index).replace(/[,\s]+$/, '').trim()
  const after = raw
    .slice(m.index + m[0].length)
    .trim()
    .replace(/^[:;,.\s]+/, '')
    .replace(/\.$/, '')
    .trim()
  return { key: newSourceKey(), raw, author: before, title: strip(m[1]), url: m[2], note: after }
}

/** Campos → viñeta. `''` si la fila está vacía (se omite al guardar). */
export function serializeSourceRow(row: SourceRow): string {
  if (row.raw !== null) return row.raw
  const author = row.author.trim()
  const title = row.title.trim()
  const url = row.url.trim()
  const note = row.note.trim()
  if (author === '' && title === '' && url === '' && note === '') return ''
  const head = author === '' ? '' : `${author}, `
  const link = url !== '' ? `[*${title === '' ? url : title}*](${url})` : title
  return `${head}${link}${note === '' ? '.' : `: ${note}`}`
}

export function serializeSourceRows(rows: readonly SourceRow[]): string[] {
  return rows.map(serializeSourceRow).filter((s) => s !== '')
}

/** Problema de una fila, o `null`. Solo https/http: el estudiante no abre otra cosa. */
export function sourceRowIssue(row: SourceRow): string | null {
  const url = row.url.trim()
  if (url !== '' && !/^https?:\/\/[^\s()]+$/i.test(url)) {
    return 'El enlace debe empezar por https:// y no llevar espacios ni paréntesis.'
  }
  if (url !== '' && row.title.trim() === '') return 'Escribe el título del enlace: es lo que verá el estudiante.'
  if (url === '' && row.title.trim() === '' && (row.author.trim() !== '' || row.note.trim() !== '')) {
    return 'Escribe un título (o un enlace) para esta fuente.'
  }
  return null
}
