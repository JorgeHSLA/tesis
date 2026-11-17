// lib/lessonSources.ts — separa la sección «Fuentes» del markdown de una lección.
//
// Las lecciones terminan con un «## Fuentes» (referencias oficiales con enlace).
// En las pruebas de usabilidad pidieron verlas ARRIBA, sin tener que bajar hasta
// el final, y que al pararse el cursor encima aparezca el enlace. Aquí solo se
// parte el texto: el cuerpo vuelve al renderizador de markdown SIN la sección, y
// cada fuente se entrega ya analizada para que la pinte `LessonSources`.
//
// Seguridad: el contenido viene del catálogo remoto (no confiable). Solo se
// conservan enlaces http(s); cualquier otro esquema se descarta, y el texto se
// pinta siempre como texto (React lo escapa), nunca como HTML.

export interface SourceLink {
  text: string
  url: string
}

export interface LessonSource {
  /** Cita completa en texto plano (sin marcas de markdown). */
  citation: string
  /** Texto corto para la etiqueta: el título del primer enlace, o el inicio de la cita. */
  label: string
  links: SourceLink[]
}

const SOURCES_HEADING = /^(#{2,4})\s+(fuentes|referencias|bibliograf[ií]a)\s*$/i
const ANY_HEADING = /^(#{1,4})\s+\S/
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g
const MAX_LABEL = 46

/** Quita las marcas de énfasis y deja el texto de los enlaces. */
function plain(md: string): string {
  return md
    .replace(LINK_RE, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|[\s(])_([^_]+)_/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function parseItem(raw: string): LessonSource | null {
  const links: SourceLink[] = []
  for (const m of raw.matchAll(LINK_RE)) {
    const text = plain(m[1])
    if (isHttp(m[2]) && text !== '') links.push({ text, url: m[2] })
  }
  const citation = plain(raw)
  if (citation === '') return null
  return { citation, label: truncate(links[0]?.text ?? citation, MAX_LABEL), links }
}

export interface SplitLesson {
  /** Markdown sin la sección de fuentes (o el original si no la había). */
  body: string
  sources: LessonSource[]
}

export interface SplitRaw {
  /** Markdown sin la sección de fuentes (o el original, idéntico, si no la había). */
  body: string
  /** El texto markdown de cada fuente (sin la viñeta), tal como estaba escrito. */
  items: string[]
}

/**
 * Parte el markdown en cuerpo + fuentes SIN analizarlas: lo que necesita el
 * editor de Autoría para mostrar las fuentes en su propia sección. Si no hay
 * sección legible, `body` es el texto original sin tocar.
 */
export function splitSourcesRaw(markdown: string): SplitRaw {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const start = lines.findIndex((l) => SOURCES_HEADING.test(l.trim()))
  if (start < 0) return { body: markdown, items: [] }

  const level = SOURCES_HEADING.exec(lines[start].trim())![1].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const h = ANY_HEADING.exec(lines[i])
    if (h !== null && h[1].length <= level) {
      end = i
      break
    }
  }

  // Cada viñeta es una fuente; una línea sin viñeta continúa la anterior.
  const items: string[] = []
  for (const line of lines.slice(start + 1, end)) {
    if (line.trim() === '') continue
    const bullet = LIST_ITEM.exec(line)
    if (bullet !== null) items.push(bullet[1])
    else if (items.length > 0) items[items.length - 1] += ` ${line.trim()}`
    else items.push(line.trim())
  }

  // Sin ninguna fuente legible no se toca el texto: mejor verla abajo que perderla.
  if (!items.some((item) => parseItem(item) !== null)) return { body: markdown, items: [] }

  const body = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
  return { body, items }
}

export function splitSources(markdown: string): SplitLesson {
  const { body, items } = splitSourcesRaw(markdown)
  return { body, sources: items.map(parseItem).filter((s): s is LessonSource => s !== null) }
}

/**
 * Operación inversa: pega las fuentes como una sección «## Fuentes» al final.
 * Sin fuentes devuelve el cuerpo TAL CUAL (ni un espacio cambiado), para que
 * guardar una lección que no las tiene no altere su texto.
 */
export function joinSources(body: string, items: readonly string[]): string {
  const clean = items.map((i) => i.trim()).filter((i) => i !== '')
  if (clean.length === 0) return body
  const head = body.trimEnd()
  return `${head}${head === '' ? '' : '\n\n'}## Fuentes\n\n${clean.map((i) => `- ${i}`).join('\n')}\n`
}

/** Dominio legible de un enlace (`www.` fuera), o el texto tal cual si no parsea. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
