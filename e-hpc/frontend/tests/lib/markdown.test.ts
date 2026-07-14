// Suite «lib/markdown» (frontend-spec §10): renderMarkdown, subset permitido
// (h1-h4, listas anidadas, código inline/fenced, negrita/cursiva, enlaces
// seguros, tablas) y escape de HTML (seguridad).
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/markdown'

describe('encabezados y párrafos', () => {
  it('h1-h4', () => {
    const html = renderMarkdown('# T1\n## T2\n### T3\n#### T4')
    expect(html).toContain('<h1>T1</h1>')
    expect(html).toContain('<h2>T2</h2>')
    expect(html).toContain('<h3>T3</h3>')
    expect(html).toContain('<h4>T4</h4>')
  })

  it('párrafo une líneas contiguas', () => {
    expect(renderMarkdown('linea uno\nlinea dos')).toContain('<p>linea uno linea dos</p>')
  })
})

describe('inline', () => {
  it('código inline protege el contenido', () => {
    expect(renderMarkdown('usa `omp_get_thread_num()`')).toContain('<code>omp_get_thread_num()</code>')
  })
  it('negrita y cursiva', () => {
    const html = renderMarkdown('esto es **fuerte** y *enfasis* y _otro_')
    expect(html).toContain('<strong>fuerte</strong>')
    expect(html).toContain('<em>enfasis</em>')
    expect(html).toContain('<em>otro</em>')
  })
  it('bloque fenced ``` preserva y escapa el código', () => {
    const html = renderMarkdown('```\nx = a < b & c\n```')
    expect(html).toContain('<pre><code>')
    expect(html).toContain('x = a &lt; b &amp; c')
  })
})

describe('enlaces seguros', () => {
  it('http(s), # y rutas relativas se permiten', () => {
    expect(renderMarkdown('[ext](https://x.com)')).toContain('href="https://x.com"')
    expect(renderMarkdown('[ancla](#quiz)')).toContain('href="#quiz"')
    expect(renderMarkdown('[rel](./otra)')).toContain('href="./otra"')
  })
  it('javascript: se neutraliza (queda solo el texto)', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('x')
  })
})

describe('listas anidadas', () => {
  it('ul con sub-nivel por sangría de 2 espacios', () => {
    const html = renderMarkdown('- a\n  - a1\n- b')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('<li>a1</li>')
    // hay dos aperturas de <ul> (nivel 0 y anidado)
    expect((html.match(/<ul>/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
  it('lista ordenada usa <ol>', () => {
    expect(renderMarkdown('1. uno\n2. dos')).toContain('<ol>')
  })
})

describe('tablas', () => {
  it('render de tabla simple con thead/tbody', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<td>2</td>')
  })
})

describe('seguridad / escape', () => {
  it('escapa HTML incrustado en texto plano', () => {
    const html = renderMarkdown('hola <script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
