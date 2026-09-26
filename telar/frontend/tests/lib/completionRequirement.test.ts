// CU-12.3 — qué hace falta para completar una lección, según su regla.
import { describe, expect, it } from 'vitest'
import { completionRequirement } from '@/lib/completionRequirement'

const base = { completion_rule: 'quiz' as const, enabled: true, archived: false, has_quiz: true, example_id: 'ej' }

describe('completionRequirement', () => {
  it.each([
    ['quiz', 'Para completarla: aprueba su quiz.'],
    ['viewed', 'Para completarla: márcala como leída al terminar.'],
    ['run', 'Para completarla: ejecuta su ejemplo en el simulador y que termine sin errores.'],
  ] as const)('regla %s', (completion_rule, texto) => {
    expect(completionRequirement({ ...base, completion_rule }, false)).toBe(texto)
  })

  it('una lección completada lo dice en vez del requisito', () => {
    expect(completionRequirement(base, true)).toBe('Lección completada.')
  })

  it('regla quiz sin quiz todavía: lo avisa', () => {
    expect(completionRequirement({ ...base, has_quiz: false }, false)).toBe(
      'Para completarla: aprueba su quiz (todavía no tiene preguntas).',
    )
  })

  it('deshabilitada o archivada no cuenta para el progreso: sin requisito', () => {
    expect(completionRequirement({ ...base, enabled: false }, false)).toBeNull()
    expect(completionRequirement({ ...base, archived: true }, false)).toBeNull()
  })

  it('S6: un taller se completa marcando sus pasos, pida lo que pida la regla guardada', () => {
    expect(completionRequirement({ ...base, completion_rule: 'viewed', kind: 'taller' }, false)).toBe(
      'Para completarlo: marca «Lo hice» en todos sus pasos.',
    )
    expect(completionRequirement({ ...base, kind: 'taller', archived: true }, false)).toBeNull()
  })
})
