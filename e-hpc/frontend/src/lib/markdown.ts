// lib/markdown.ts — renderizador del subset EXACTO de markdown permitido en
// los lessons/*.md (frontend-spec §1): h1-h4, párrafos, listas anidadas
// (ul/ol, sangría de 2 espacios), código inline + fenced, negrita/cursiva,
// enlaces y tablas simples. Los fixtures se redactan DENTRO de este subset.
//
// Seguridad: TODO el texto se escapa ANTES de generar HTML propio; los href
// solo admiten http(s), '#' y rutas relativas — nunca javascript:.

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeHref(url: string): string | null {
  const trimmed = url.trim()
  if (/^(https?:\/\/|#|\.?\/)/i.test(trimmed)) return trimmed
  return null
}

/** Inline: código protegido primero, luego negrita, cursiva y enlaces. */
function renderInline(escaped: string): string {
  const codes: string[] = []
  let out = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const href = safeHref(url)
    return href ? `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>` : text
  })
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '')
  return out
}

interface ListLevel {
  tag: 'ul' | 'ol'
  indent: number
}

const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/

/**
 * Convierte el subset de markdown a HTML seguro (string). Usar dentro de un
 * contenedor con clase `markdown` (estilos en components.css).
 */
export function renderMarkdown(md: string): string {
  const lines = md.replaceAll('\r\n', '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let lists: ListLevel[] = []
  let inFence = false
  let fenceLines: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`)
      paragraph = []
    }
  }
  const closeListsTo = (indent: number) => {
    while (lists.length > 0 && lists[lists.length - 1].indent >= indent + 1) {
      html.push(`</${lists[lists.length - 1].tag}>`)
      lists.pop()
    }
  }
  const closeAllLists = () => {
    while (lists.length > 0) {
      html.push(`</${lists[lists.length - 1].tag}>`)
      lists.pop()
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Bloques de código fenced ```
    if (/^\s*```/.test(line)) {
      if (inFence) {
        html.push(`<pre><code>${fenceLines.join('\n')}</code></pre>`)
        fenceLines = []
        inFence = false
      } else {
        flushParagraph()
        closeAllLists()
        inFence = true
      }
      i++
      continue
    }
    if (inFence) {
      fenceLines.push(escapeHtml(line))
      i++
      continue
    }

    // Línea en blanco: cierra párrafo y listas
    if (line.trim() === '') {
      flushParagraph()
      closeAllLists()
      i++
      continue
    }

    // Encabezados h1-h4
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      closeAllLists()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`)
      i++
      continue
    }

    // Tablas simples: fila | ... | seguida de separador |---|---|
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      flushParagraph()
      closeAllLists()
      const parseRow = (row: string): string[] =>
        row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const headers = parseRow(line)
      const body: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        body.push(parseRow(lines[j]))
        j++
      }
      const th = headers.map((h) => `<th>${renderInline(escapeHtml(h))}</th>`).join('')
      const rows = body
        .map((cells) => `<tr>${cells.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join('')}</tr>`)
        .join('')
      html.push(`<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`)
      i = j
      continue
    }

    // Listas (anidadas por sangría de 2 espacios)
    const item = LIST_RE.exec(line)
    if (item) {
      flushParagraph()
      const indent = Math.floor(item[1].length / 2)
      const tag: 'ul' | 'ol' = /^\d+\.$/.test(item[2]) ? 'ol' : 'ul'
      closeListsTo(indent)
      const top = lists[lists.length - 1]
      if (!top || top.indent < indent || top.tag !== tag) {
        if (top && top.indent === indent && top.tag !== tag) {
          html.push(`</${top.tag}>`)
          lists.pop()
        }
        html.push(`<${tag}>`)
        lists.push({ tag, indent })
      }
      html.push(`<li>${renderInline(escapeHtml(item[3]))}</li>`)
      i++
      continue
    }

    // Texto corriente: párrafo (o continuación)
    closeAllLists()
    paragraph.push(line.trim())
    i++
  }

  if (inFence && fenceLines.length > 0) {
    html.push(`<pre><code>${fenceLines.join('\n')}</code></pre>`)
  }
  flushParagraph()
  closeAllLists()
  return html.join('\n')
}
