// features/admin/validation — las comprobaciones del cliente son las MISMAS del
// schema del backend (backend/app/schemas/admin.py), campo a campo, para que el
// error aparezca junto al control antes de enviar (CU-13.3, 14.3, 17.4, 18.5,
// 21.3). El backend re-valida siempre.
import { describe, expect, it } from 'vitest'
import { MAX_CODE_BYTES } from '@/lib/pyfile'
import { exampleIssues, lessonIssues, moduleIssues } from '@/features/admin/validation'

const MODULO = { order: '3', title: 'Hilos', level: 'Intro', description: '' }
const LECCION = { order: '1', title: 'Hola', estimated_minutes: '10', video_url: '' }
const EJEMPLO = {
  title: 'Ej', filename: 'ej.py', difficulty: 2, teaches: 'algo', takeaways: ['x'],
  est_run_seconds: 3, fixed_threads: null,
}

describe('moduleIssues', () => {
  it('un módulo válido no tiene errores', () => {
    expect(moduleIssues(MODULO)).toEqual({})
  })

  it.each(['0', '2.5', '1e2', '', '10001', 'abc'])('orden %j no vale', (order) => {
    expect(moduleIssues({ ...MODULO, order }).order).toBeDefined()
  })

  it('título y nivel son obligatorios y tienen tope', () => {
    const r = moduleIssues({ ...MODULO, title: '  ', level: '' })
    expect(r.title).toBe('Escribe un título.')
    expect(r.level).toBe('Escribe el nivel.')
    expect(moduleIssues({ ...MODULO, title: 'x'.repeat(161) }).title).toBe('Máximo 160 caracteres.')
    expect(moduleIssues({ ...MODULO, level: 'x'.repeat(41) }).level).toBe('Máximo 40 caracteres.')
    expect(moduleIssues({ ...MODULO, description: 'x'.repeat(2001) }).description).toBe('Máximo 2000 caracteres.')
  })
})

describe('lessonIssues', () => {
  it('una lección válida no tiene errores', () => {
    expect(lessonIssues(LECCION, '# Hola')).toEqual({})
  })

  it('minutos: entero entre 1 y 600 (0 ya no vale)', () => {
    for (const m of ['0', '601', '2.5', '']) {
      expect(lessonIssues({ ...LECCION, estimated_minutes: m }, '# x').estimated_minutes).toBe(
        'Los minutos deben ser un número entero entre 1 y 600.',
      )
    }
  })

  it('posición, título y contenido', () => {
    const r = lessonIssues({ ...LECCION, order: '0', title: '' }, '  ')
    expect(r.order).toBe('La posición debe ser un número entero entre 1 y 10000.')
    expect(r.title).toBe('Escribe un título.')
    expect(r.content_markdown).toBe('El contenido de la lección no puede quedar vacío.')
  })

  it('la URL del video tiene tope', () => {
    expect(lessonIssues({ ...LECCION, video_url: 'x'.repeat(2049) }, '# x').video_url).toBe(
      'Máximo 2048 caracteres.',
    )
  })
})

describe('exampleIssues', () => {
  it('un ejemplo válido no tiene errores', () => {
    expect(exampleIssues(EJEMPLO, 'print(1)')).toEqual({})
  })

  it('el nombre sigue el patrón del backend', () => {
    expect(exampleIssues({ ...EJEMPLO, filename: 'mi ejemplo.py' }, 'x').filename).toMatch(/^El nombre debe/)
  })

  it('campos obligatorios y rangos', () => {
    const r = exampleIssues(
      { ...EJEMPLO, title: '', teaches: ' ', takeaways: [], difficulty: 6, est_run_seconds: 0, fixed_threads: 17 },
      'x',
    )
    expect(Object.keys(r).sort()).toEqual(
      ['difficulty', 'est_run_seconds', 'fixed_threads', 'takeaways', 'teaches', 'title'],
    )
  })

  it('el código no puede ir vacío ni pasar de 256 KB (en bytes UTF-8)', () => {
    expect(exampleIssues(EJEMPLO, '').source_code).toBe('El código no puede quedar vacío.')
    // «ñ» ocupa 2 bytes: la mitad del tope en caracteres ya lo supera en bytes.
    const grande = 'ñ'.repeat(MAX_CODE_BYTES / 2 + 1)
    expect(exampleIssues(EJEMPLO, grande).source_code).toBe('El código supera 256 KB.')
  })
})
