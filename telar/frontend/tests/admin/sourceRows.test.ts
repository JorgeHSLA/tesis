// sourceRows + joinSources — la sección «Fuentes» del editor se vuelve a escribir
// en el markdown sin perder ni reformatear lo que la persona no tocó.
import { describe, expect, it } from 'vitest'
import { joinSources, splitSources, splitSourcesRaw } from '@/lib/lessonSources'
import {
  blankSourceRow,
  parseSourceRow,
  serializeSourceRow,
  serializeSourceRows,
  sourceRowIssue,
} from '@/features/admin/lesson/sourceRows'

const ITEM = 'OpenMP Architecture Review Board, [*OpenMP API Specification 5.2*](https://www.openmp.org/spec-html/5.2/openmp.html): constructos `task` y `taskwait`.'

describe('splitSourcesRaw / joinSources', () => {
  const md = `# Lección\n\nTexto.\n\n## Fuentes\n\n- ${ITEM}\n- [LLNL](https://hpc-tutorials.llnl.gov/openmp/)\n`

  it('separa el cuerpo y deja cada viñeta tal cual', () => {
    const { body, items } = splitSourcesRaw(md)
    expect(body).toBe('# Lección\n\nTexto.')
    expect(items).toEqual([ITEM, '[LLNL](https://hpc-tutorials.llnl.gov/openmp/)'])
  })

  it('unir de vuelta produce un markdown que se vuelve a leer igual', () => {
    const { body, items } = splitSourcesRaw(md)
    const again = joinSources(body, items)
    expect(splitSourcesRaw(again)).toEqual({ body, items })
    expect(splitSources(again).sources).toHaveLength(2)
  })

  it('sin fuentes, unir devuelve el cuerpo EXACTO (ni un espacio cambiado)', () => {
    const body = '# Título\n\nTexto con espacios al final   \n\n\n'
    expect(joinSources(body, [])).toBe(body)
    expect(joinSources(body, ['', '  '])).toBe(body)
  })

  it('una lección sin sección de fuentes no se toca al separarla', () => {
    const plain = '# Título\n\nSolo texto.\n'
    expect(splitSourcesRaw(plain)).toEqual({ body: plain, items: [] })
  })

  it('cuerpo vacío + fuentes: la sección queda sola', () => {
    expect(joinSources('', ['[A](https://a.example)'])).toBe('## Fuentes\n\n- [A](https://a.example)\n')
  })
})

describe('parseSourceRow / serializeSourceRow', () => {
  it('reparte autor, título, enlace y nota', () => {
    const r = parseSourceRow(ITEM)
    expect(r.author).toBe('OpenMP Architecture Review Board')
    expect(r.title).toBe('OpenMP API Specification 5.2')
    expect(r.url).toBe('https://www.openmp.org/spec-html/5.2/openmp.html')
    expect(r.note).toBe('constructos `task` y `taskwait`')
  })

  it('una fila que NO se toca se escribe EXACTAMENTE como estaba', () => {
    expect(serializeSourceRow(parseSourceRow(ITEM))).toBe(ITEM)
  })

  it('al editar un campo, la viñeta se reconstruye desde los campos', () => {
    const r = { ...parseSourceRow(ITEM), raw: null, title: 'Spec 5.2' }
    expect(serializeSourceRow(r)).toBe(
      'OpenMP Architecture Review Board, [*Spec 5.2*](https://www.openmp.org/spec-html/5.2/openmp.html): constructos `task` y `taskwait`',
    )
  })

  it('fila nueva: solo enlace → viñeta con punto final; con nota → dos puntos', () => {
    const base = { ...blankSourceRow(), title: 'Guía', url: 'https://a.example/g' }
    expect(serializeSourceRow(base)).toBe('[*Guía*](https://a.example/g).')
    expect(serializeSourceRow({ ...base, note: 'capítulo 3' })).toBe('[*Guía*](https://a.example/g): capítulo 3')
    expect(serializeSourceRow({ ...base, author: 'MIT' })).toBe('MIT, [*Guía*](https://a.example/g).')
  })

  it('sin enlace es solo una cita', () => {
    expect(serializeSourceRow({ ...blankSourceRow(), title: 'Libro impreso', note: 'pág. 12' })).toBe('Libro impreso: pág. 12')
    const r = parseSourceRow('Hennessy y Patterson, Computer Architecture.')
    expect(r.url).toBe('')
    expect(r.title).toBe('Hennessy y Patterson, Computer Architecture.')
  })

  it('una fila vacía no se guarda', () => {
    expect(serializeSourceRow(blankSourceRow())).toBe('')
    expect(serializeSourceRows([blankSourceRow(), { ...blankSourceRow(), title: 'X', url: 'https://x.example' }])).toHaveLength(1)
  })

  it('un enlace extra dentro de la nota no se pierde', () => {
    const raw = 'LLNL, [*Sync*](https://a.example/x), [*CRITICAL*](https://a.example/y).'
    const r = parseSourceRow(raw)
    expect(serializeSourceRow(r)).toBe(raw)
    expect({ ...r, raw: null } && serializeSourceRow({ ...r, raw: null })).toContain('[*CRITICAL*](https://a.example/y)')
  })
})

describe('sourceRowIssue', () => {
  const row = (over: Partial<ReturnType<typeof blankSourceRow>>) => ({ ...blankSourceRow(), ...over })

  it('acepta https/http y filas solo de cita', () => {
    expect(sourceRowIssue(row({ title: 'A', url: 'https://a.example' }))).toBeNull()
    expect(sourceRowIssue(row({ title: 'A', url: 'http://a.example' }))).toBeNull()
    expect(sourceRowIssue(row({ title: 'Libro' }))).toBeNull()
    expect(sourceRowIssue(row({}))).toBeNull()
  })

  it('rechaza esquemas peligrosos, espacios y paréntesis', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.example', 'a.example', 'https://a b.example', 'https://a.example/(x)']) {
      expect(sourceRowIssue(row({ title: 'A', url }))).toMatch(/https:\/\//)
    }
  })

  it('un enlace sin título pide el título (es la etiqueta que se ve)', () => {
    expect(sourceRowIssue(row({ url: 'https://a.example' }))).toMatch(/título/)
    expect(sourceRowIssue(row({ author: 'MIT' }))).toMatch(/título/)
  })
})
