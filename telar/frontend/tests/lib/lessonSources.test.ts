// lib/lessonSources — la sección «## Fuentes» se separa del cuerpo para mostrarla
// arriba, y solo conserva enlaces http(s).
import { describe, expect, it } from 'vitest'
import { hostOf, splitSources } from '@/lib/lessonSources'

const LECCION = `# Tareas: task y taskwait

**Objetivo:** paralelizar trabajo irregular.

## Qué es una tarea

Texto de la explicación.

## Para recordar

- Una tarea es trabajo empaquetado.

## Fuentes

- OpenMP Architecture Review Board, [*OpenMP API Specification 5.2*](https://www.openmp.org/spec-html/5.2/openmp.html): constructos \`task\` y \`taskwait\`.
- Lawrence Livermore National Laboratory, [*OpenMP Tutorial: TASK*](https://hpc-tutorials.llnl.gov/openmp/task_construct).
`

describe('splitSources', () => {
  it('saca las fuentes del cuerpo y las entrega analizadas', () => {
    const { body, sources } = splitSources(LECCION)
    expect(sources).toHaveLength(2)
    expect(body).not.toMatch(/Fuentes/)
    expect(body).toContain('## Para recordar')
    expect(body).toContain('Una tarea es trabajo empaquetado.')
    expect(body.endsWith('\n')).toBe(false)
  })

  it('etiqueta = título del primer enlace; cita = texto plano completo', () => {
    const [a] = splitSources(LECCION).sources
    expect(a.label).toBe('OpenMP API Specification 5.2')
    expect(a.citation).toBe(
      'OpenMP Architecture Review Board, OpenMP API Specification 5.2: constructos task y taskwait.',
    )
    expect(a.links).toEqual([{ text: 'OpenMP API Specification 5.2', url: 'https://www.openmp.org/spec-html/5.2/openmp.html' }])
  })

  it('una fuente puede traer varios enlaces', () => {
    const md = '## Fuentes\n\n- LLNL, [*Sync*](https://a.example/x), [*CRITICAL*](https://a.example/y) y [*BARRIER*](https://a.example/z).\n'
    const [s] = splitSources(md).sources
    expect(s.links.map((l) => l.text)).toEqual(['Sync', 'CRITICAL', 'BARRIER'])
  })

  it('sin sección de fuentes devuelve el texto intacto', () => {
    const md = '# Título\n\nSolo texto.\n'
    expect(splitSources(md)).toEqual({ body: md, sources: [] })
  })

  it('la sección termina en el siguiente encabezado del mismo nivel o mayor', () => {
    const md = '# T\n\n## Fuentes\n\n- [A](https://a.example)\n\n## Anexo\n\nQueda en el cuerpo.\n'
    const { body, sources } = splitSources(md)
    expect(sources).toHaveLength(1)
    expect(body).toContain('## Anexo')
    expect(body).toContain('Queda en el cuerpo.')
  })

  it('descarta enlaces que no son http(s): ni javascript: ni data:', () => {
    const md = '## Fuentes\n\n- [Malo](javascript:alert(1)) y [Otro](data:text/html,x) y [Bueno](https://ok.example/p)\n- Sin enlace, solo cita\n'
    const { sources } = splitSources(md)
    expect(sources[0].links).toEqual([{ text: 'Bueno', url: 'https://ok.example/p' }])
    expect(sources[1].links).toEqual([])
    expect(sources[1].label).toBe('Sin enlace, solo cita')
  })

  it('recorta etiquetas largas', () => {
    const md = `## Fuentes\n\n- [${'x'.repeat(120)}](https://a.example)\n`
    expect(splitSources(md).sources[0].label).toHaveLength(46)
  })

  it('una línea sin viñeta continúa la fuente anterior', () => {
    const md = '## Fuentes\n\n- Autor, [Título](https://a.example)\n  segunda línea de la cita\n'
    expect(splitSources(md).sources[0].citation).toBe('Autor, Título segunda línea de la cita')
  })

  it('con CRLF también separa', () => {
    expect(splitSources('# T\r\n\r\n## Fuentes\r\n\r\n- [A](https://a.example)\r\n').sources).toHaveLength(1)
  })

  it('una sección vacía no se toca (mejor verla abajo que perderla)', () => {
    const md = '# T\n\n## Fuentes\n\n'
    expect(splitSources(md)).toEqual({ body: md, sources: [] })
  })
})

describe('hostOf', () => {
  it('quita www. y devuelve el dominio', () => {
    expect(hostOf('https://www.openmp.org/spec-html/5.2/openmp.html')).toBe('openmp.org')
    expect(hostOf('https://hpc-tutorials.llnl.gov/x')).toBe('hpc-tutorials.llnl.gov')
    expect(hostOf('no es url')).toBe('no es url')
  })
})
