// features/admin/validation.ts — comprobaciones del cliente IDÉNTICAS a las del
// schema del backend (backend/app/schemas/admin.py), para marcar el campo antes
// de enviar (CU-13.3, 14.3, 17.4, 18.5, 21.3). Cada función devuelve
// `{campo: mensaje}` con las mismas claves que un 422 del backend, así el
// editor pinta ambos igual. El backend re-valida siempre.
import type { AdminExampleBaseDto } from '../../api/admin-types'
import { isValidPyFilename, MAX_CODE_BYTES } from '../../lib/pyfile'

export type FieldIssues = Record<string, string>

const MAX_ORDER = 10_000

/** Entero escrito tal cual dentro de [min, max]: «2.5», «1e2» o «» no valen. */
export function parseIntInRange(raw: string, min: number, max: number): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= min && n <= max ? n : null
}

/** Texto obligatorio con tope (min_length=1, max_length=max). */
function textIssue(value: string, max: number, emptyMsg: string | null): string | null {
  if (emptyMsg != null && value.trim() === '') return emptyMsg
  if (value.length > max) return `Máximo ${max} caracteres.`
  return null
}

function collect(entries: Array<[string, string | null]>): FieldIssues {
  const out: FieldIssues = {}
  for (const [field, msg] of entries) if (msg != null) out[field] = msg
  return out
}

/** AdminModuleBase. */
export function moduleIssues(v: { order: string; title: string; level: string; description: string }): FieldIssues {
  return collect([
    ['order', parseIntInRange(v.order, 1, MAX_ORDER) == null ? `El orden debe ser un número entero entre 1 y ${MAX_ORDER}.` : null],
    ['title', textIssue(v.title, 160, 'Escribe un título.')],
    ['level', textIssue(v.level, 40, 'Escribe el nivel.')],
    ['description', textIssue(v.description, 2000, null)],
  ])
}

/** AdminLessonBase (los campos que el editor escribe como texto). */
export function lessonIssues(
  meta: { order: string; title: string; estimated_minutes: string; video_url: string },
  contentMarkdown: string,
): FieldIssues {
  return collect([
    ['order', parseIntInRange(meta.order, 1, MAX_ORDER) == null ? `La posición debe ser un número entero entre 1 y ${MAX_ORDER}.` : null],
    ['title', textIssue(meta.title, 160, 'Escribe un título.')],
    [
      'estimated_minutes',
      parseIntInRange(meta.estimated_minutes, 1, 600) == null
        ? 'Los minutos deben ser un número entero entre 1 y 600.'
        : null,
    ],
    ['content_markdown', contentMarkdown.trim() === '' ? 'El contenido de la lección no puede quedar vacío.' : null],
    ['video_url', textIssue(meta.video_url.trim(), 2048, null)],
  ])
}

type ExampleChecked = Pick<
  AdminExampleBaseDto,
  'title' | 'filename' | 'difficulty' | 'teaches' | 'takeaways' | 'est_run_seconds' | 'fixed_threads'
>

/** AdminExampleBase + el código (AdminExampleCodeRequest y el tope de bytes). */
export function exampleIssues(ex: ExampleChecked, sourceCode: string): FieldIssues {
  const bytes = new TextEncoder().encode(sourceCode).length
  return collect([
    ['title', textIssue(ex.title, 160, 'Escribe un título.')],
    [
      'filename',
      isValidPyFilename(ex.filename)
        ? null
        : 'El nombre debe terminar en .py y usar solo letras sin tilde, números, «.», «_» o «-» (máx. 80).',
    ],
    ['difficulty', ex.difficulty >= 1 && ex.difficulty <= 5 ? null : 'La dificultad va de 1 a 5.'],
    ['teaches', ex.teaches.trim() === '' ? 'Resume en una línea qué enseña el ejemplo.' : null],
    ['takeaways', ex.takeaways.some((t) => t.trim() !== '') ? null : 'Añade al menos una conclusión.'],
    ['est_run_seconds', ex.est_run_seconds >= 1 ? null : 'La duración estimada debe ser de al menos 1 segundo.'],
    [
      'fixed_threads',
      ex.fixed_threads == null || (ex.fixed_threads >= 1 && ex.fixed_threads <= 16)
        ? null
        : 'Los hilos fijos van de 1 a 16.',
    ],
    [
      'source_code',
      sourceCode === ''
        ? 'El código no puede quedar vacío.'
        : bytes > MAX_CODE_BYTES
          ? 'El código supera 256 KB.'
          : null,
    ],
  ])
}

/** Antepone `prefix` a cada clave (p. ej. `example.` en /nueva). */
export function withPrefix(issues: FieldIssues, prefix: string): FieldIssues {
  return Object.fromEntries(Object.entries(issues).map(([k, v]) => [`${prefix}${k}`, v]))
}
