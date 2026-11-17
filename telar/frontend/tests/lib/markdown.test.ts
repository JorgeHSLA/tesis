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

describe('imágenes', () => {
  const HASH = '0123456789abcdef0123456789abcdef'
  const OK = `https://storage.googleapis.com/clasestelar/imagenes/${HASH}.png`

  it('una imagen sola en su línea es una figura con pie', () => {
    const html = renderMarkdown(`![Jerarquía de memoria](${OK})`)
    expect(html).toContain('<figure class="md-figure">')
    expect(html).toContain(`src="${OK}"`)
    expect(html).toContain('alt="Jerarquía de memoria"')
    expect(html).toContain('<figcaption>Jerarquía de memoria</figcaption>')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('referrerpolicy="no-referrer"')
  })

  it('sin texto alternativo no hay pie', () => {
    const html = renderMarkdown(`![](${OK})`)
    expect(html).toContain('<img ')
    expect(html).not.toContain('<figcaption>')
  })

  it('dentro de un párrafo es una imagen en línea, sin figura', () => {
    const html = renderMarkdown(`Mira ![icono](${OK}) aquí.`)
    expect(html).toContain('<p>Mira <img class="md-img"')
    expect(html).not.toContain('<figure')
  })

  it('una URL de otro host NO se carga: sale un aviso de texto', () => {
    const html = renderMarkdown('![pixel](https://evil.example/track.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('md-img-blocked')
    expect(html).toContain('imagen no permitida: pixel')
  })

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    `http://storage.googleapis.com/clasestelar/imagenes/${HASH}.png`,
    `https://storage.googleapis.com/clasestelar/otra/${HASH}.png`,
    `https://storage.googleapis.com/clasestelar/imagenes/${HASH}.svg`,
    `https://storage.googleapis.com.evil.example/clasestelar/imagenes/${HASH}.png`,
  ])('rechaza %s', (url) => {
    const html = renderMarkdown(`![x](${url})`)
    expect(html).not.toContain('<img')
    expect(html).toContain('md-img-blocked')
  })

  it('el texto alternativo se escapa (no puede inyectar HTML ni romper el atributo)', () => {
    const html = renderMarkdown(`![a" onerror="alert(1)](${OK})`)
    expect(html).not.toContain('onerror="alert')
    expect(html).toContain('&quot;')
  })

  it('una imagen no rompe el resto: listas, énfasis y enlaces siguen funcionando', () => {
    const html = renderMarkdown(`- **uno** [enlace](https://a.example)\n\n![x](${OK})\n\nFin`)
    expect(html).toContain('<strong>uno</strong>')
    expect(html).toContain('<a href="https://a.example"')
    expect(html).toContain('<figure')
    expect(html).toContain('<p>Fin</p>')
  })

  it('el énfasis no entra en la URL de la imagen (subrayados del bucket)', () => {
    const url = `https://storage.googleapis.com/mi_bucket_x/imagenes/${HASH}.png`
    const html = renderMarkdown(`texto _cursiva_ y ![x](${url})`)
    expect(html).toContain(`src="${url}"`)
    expect(html).toContain('<em>cursiva</em>')
  })
})
