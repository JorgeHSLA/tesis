// lib/completionRequirement.ts — qué le falta al estudiante para completar una
// lección, según su `completion_rule` (CU-12.3). Una sola regla por lección:
// solo esa vía la completa (backend: quiz_service, job_runner, PUT /progress).
//
// Punto de extensión: una regla nueva (p. ej. el taller de S6) se añade al
// union `CompletionRule` de api/types.ts y aquí a REQUIREMENT_BY_RULE; el
// `Record` obliga a TypeScript a pedir la entrada que falte.
import type { CompletionRule, LessonKind } from '../api/types'

interface LessonForRequirement {
  completion_rule: CompletionRule
  enabled: boolean
  archived: boolean
  has_quiz: boolean
  /** S6 (CU-28): en un taller la regla se ignora; lo completan sus pasos. */
  kind?: LessonKind
}

const REQUIREMENT_BY_RULE: Record<CompletionRule, (lesson: LessonForRequirement) => string> = {
  quiz: (l) => (l.has_quiz ? 'aprueba su quiz.' : 'aprueba su quiz (todavía no tiene preguntas).'),
  viewed: () => 'márcala como leída al terminar.',
  run: () => 'ejecuta su ejemplo en el simulador y que termine sin errores.',
}

/**
 * Texto del requisito, «Lección completada.» si ya lo está, o `null` si la
 * lección no cuenta para el progreso (deshabilitada o archivada).
 */
export function completionRequirement(lesson: LessonForRequirement, completed: boolean): string | null {
  if (!lesson.enabled || lesson.archived) return null
  if (completed) return 'Lección completada.'
  if (lesson.kind === 'taller') return 'Para completarlo: marca «Lo hice» en todos sus pasos.'
  return `Para completarla: ${REQUIREMENT_BY_RULE[lesson.completion_rule](lesson)}`
}
