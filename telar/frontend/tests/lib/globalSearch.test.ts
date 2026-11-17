// lib/globalSearch + lib/searchIndex — el buscador global encuentra TODO lo de
// Telar (páginas, cursos, lecciones, ejemplos, ejecuciones, configuraciones y
// módulos disponibles), sin importar tildes ni mayúsculas.
import { describe, expect, it } from 'vitest'
import type { RemoteModuleSummaryDto } from '@/api/catalog-types'
import type { ExampleSummaryDto, JobSummaryDto, ModuleDto } from '@/api/types'
import { flatten, normalize, scoreItem, searchItems, type SearchItem } from '@/lib/globalSearch'
import type { SavedConfig } from '@/lib/savedConfigs'
import { buildSearchIndex } from '@/lib/searchIndex'

const item = (over: Partial<SearchItem>): SearchItem => ({
  id: 'x',
  kind: 'leccion',
  title: 'Título',
  to: '/x',
  ...over,
})

describe('normalize', () => {
  it('quita tildes y pasa a minúsculas', () => {
    expect(normalize('Ejecución ÁÉÍÓÚ ñ')).toBe('ejecucion aeiou n')
  })
})

describe('scoreItem', () => {
  it('0 si alguna palabra no aparece (todas deben coincidir)', () => {
    expect(scoreItem(item({ title: 'Reducción con OpenMP' }), 'reduccion mpi')).toBe(0)
  })

  it('ignora tildes y mayúsculas', () => {
    expect(scoreItem(item({ title: 'Reducción' }), 'REDUCCION')).toBeGreaterThan(0)
  })

  it('el título pesa más que el subtítulo o las palabras clave', () => {
    const enTitulo = scoreItem(item({ title: 'Barrera' }), 'barrera')
    const enSubtitulo = scoreItem(item({ title: 'Otra', subtitle: 'sobre la barrera' }), 'barrera')
    const enClaves = scoreItem(item({ title: 'Otra', keywords: 'barrera' }), 'barrera')
    expect(enTitulo).toBeGreaterThan(enSubtitulo)
    expect(enSubtitulo).toBe(enClaves)
    expect(enSubtitulo).toBeGreaterThan(0)
  })

  it('empezar por la palabra gana a contenerla en medio', () => {
    expect(scoreItem(item({ title: 'Hilos y memoria' }), 'hilos')).toBeGreaterThan(
      scoreItem(item({ title: 'Qué es un hilo y por qué importa' }), 'imp'),
    )
  })

  it('una consulta vacía no puntúa', () => {
    expect(scoreItem(item({}), '   ')).toBe(0)
  })
})

describe('searchItems', () => {
  const items: SearchItem[] = [
    item({ id: 'p1', kind: 'pagina', title: 'Simulador', to: '/simulador' }),
    item({ id: 'l1', kind: 'leccion', title: 'Hilos en el simulador', to: '/aprender/l1' }),
    item({ id: 'e1', kind: 'ejecucion', title: 'hello.py', subtitle: '4 hilos · completada', to: '/resultados/e1' }),
    item({ id: 'c1', kind: 'curso', title: 'Fundamentos', to: '/aprender/c1' }),
  ]

  it('sin consulta solo ofrece las páginas (atajos)', () => {
    const groups = searchItems(items, '')
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('pagina')
  })

  it('agrupa por tipo en el orden de KIND_ORDER y filtra lo que no coincide', () => {
    const groups = searchItems(items, 'hilos')
    expect(groups.map((g) => g.kind)).toEqual(['leccion', 'ejecucion'])
    expect(groups.map((g) => g.label)).toEqual(['Lecciones', 'Ejecuciones'])
  })

  it('limita cada grupo', () => {
    const muchos = Array.from({ length: 20 }, (_, i) => item({ id: `l${i}`, title: `Lección ${i}` }))
    expect(searchItems(muchos, 'leccion', 5)[0].items).toHaveLength(5)
  })

  it('flatten conserva el orden de recorrido con flechas', () => {
    const groups = searchItems(items, 'hilos')
    expect(flatten(groups).map((i) => i.id)).toEqual(['l1', 'e1'])
  })

  it('sin coincidencias → sin grupos', () => {
    expect(searchItems(items, 'zzzz')).toEqual([])
  })
})

// ── Índice ────────────────────────────────────────────────────────────────────

const modulo = (over: Partial<ModuleDto> = {}): ModuleDto =>
  ({
    id: 'm1',
    order: 1,
    title: 'Primeros pasos',
    description: 'Región paralela e identidad de hilo',
    level: 'Básico',
    version: 1,
    origin: 'remote',
    update_available: null,
    lessons: [
      { id: 'l1', order: 1, title: 'Hola mundo paralelo', example_id: 'hello', has_quiz: true, has_video: true, enabled: true },
      { id: 'l2', order: 2, title: 'Lección apagada', example_id: null, has_quiz: false, has_video: false, enabled: false },
    ],
    ...over,
  }) as unknown as ModuleDto

const ejemplo = (over: Partial<ExampleSummaryDto> = {}): ExampleSummaryDto =>
  ({
    id: 'hello',
    title: 'Hola mundo paralelo',
    teaches: 'Crea una región paralela',
    filename: 'hello.py',
    directives: ['parallel'],
    enabled: true,
    ...over,
  }) as ExampleSummaryDto

const job = (over: Partial<JobSummaryDto> = {}): JobSummaryDto =>
  ({
    job_id: 'abc12345-0000',
    filename: 'suma.py',
    example_id: null,
    status: 'completed',
    threads: 4,
    created_at: '2026-11-16T14:30:00Z',
    ...over,
  }) as JobSummaryDto

const config: SavedConfig = {
  id: 'cfg1',
  name: 'Mi prueba de 8 hilos',
  saved_at: '2026-11-16T10:00:00Z',
  example_id: 'hello',
  code: 'print(1)',
  filename: 'hello.py',
  threads: 8,
  timeout_s: 60,
  edited: false,
}

const remoto = { id: 'mRend', title: 'Rendimiento', description: 'Medir speedup', level: 'Intermedio', lessons_count: 5, version: 2 } as RemoteModuleSummaryDto

describe('buildSearchIndex', () => {
  const base = { catalogEnabled: true, admin: false }

  it('siempre trae las páginas; «Módulos disponibles» y «Autoría» según el despliegue', () => {
    const titles = (c: boolean, a: boolean) => buildSearchIndex({ catalogEnabled: c, admin: a }).map((i) => i.title)
    expect(titles(false, false)).toEqual(['Inicio', 'Simulador', 'Resultados', 'Aprender'])
    expect(titles(true, false)).toContain('Módulos disponibles')
    expect(titles(false, true)).toContain('Autoría')
  })

  it('curso → primera lección habilitada; lección apagada no aparece', () => {
    const idx = buildSearchIndex({ ...base, modules: [modulo()] })
    const curso = idx.find((i) => i.kind === 'curso')
    expect(curso).toMatchObject({ title: 'Primeros pasos', to: '/aprender/l1' })
    expect(idx.filter((i) => i.kind === 'leccion').map((i) => i.id)).toEqual(['leccion:l1'])
    expect(idx.find((i) => i.id === 'leccion:l1')?.subtitle).toBe('Primeros pasos · video · quiz · ejemplo')
  })

  it('ejemplos habilitados llevan al simulador con ?ejemplo=', () => {
    const idx = buildSearchIndex({ ...base, examples: [ejemplo(), ejemplo({ id: 'gpu', enabled: false })] })
    const ejemplos = idx.filter((i) => i.kind === 'ejemplo')
    expect(ejemplos).toHaveLength(1)
    expect(ejemplos[0].to).toBe('/simulador?ejemplo=hello')
    expect(ejemplos[0].keywords).toContain('parallel')
  })

  it('ejecución terminada → resultados; en curso → simulador en vivo', () => {
    const idx = buildSearchIndex({
      ...base,
      jobs: [job(), job({ job_id: 'run1', status: 'running', threads: 1 })],
    })
    const [a, b] = idx.filter((i) => i.kind === 'ejecucion')
    expect(a.to).toBe('/resultados/abc12345-0000')
    expect(a.subtitle).toBe('4 hilos · completada · 2026-11-16 14:30')
    expect(b.to).toBe('/simulador/run1')
    expect(b.subtitle).toContain('1 hilo · en curso')
  })

  it('configuración guardada → simulador con su configuración en el state', () => {
    const [c] = buildSearchIndex({ ...base, configs: [config] }).filter((i) => i.kind === 'configuracion')
    expect(c.to).toBe('/simulador')
    expect(c.state).toMatchObject({ code: 'print(1)', filename: 'hello.py', threads: 8, example_id: 'hello' })
  })

  it('módulos remotos solo si hay catálogo', () => {
    expect(buildSearchIndex({ catalogEnabled: false, admin: false, remote: [remoto] }).some((i) => i.kind === 'modulo')).toBe(false)
    const [m] = buildSearchIndex({ ...base, remote: [remoto] }).filter((i) => i.kind === 'modulo')
    expect(m.to).toBe('/modulos/mRend')
  })

  it('encuentra una ejecución por su estado, sin tildes', () => {
    const idx = buildSearchIndex({ ...base, jobs: [job({ status: 'timeout' })] })
    const groups = searchItems(idx, 'se agoto')
    expect(groups[0]?.kind).toBe('ejecucion')
  })
})
