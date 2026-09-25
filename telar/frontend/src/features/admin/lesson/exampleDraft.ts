// exampleDraft.ts — borrador de ejemplo que comparten la creación de una
// lección con ejemplo (CU-17.1) y «Agregar ejemplo» en una sin él (CU-18.2).
import type { AdminExampleBaseDto } from '../../../api/admin-types'

export const DEFAULT_EXAMPLE: AdminExampleBaseDto = {
  title: '',
  filename: 'main.py',
  difficulty: 1,
  teaches: '',
  directives: [],
  threads_configurable: true,
  fixed_threads: null,
  fixed_threads_note: null,
  sweeps_threads: false,
  self_measures: false,
  parser_id: 'none',
  default_timeout_s: 60,
  est_run_seconds: 5,
  enabled: true,
  requires_gpu: false,
  expected_output_note: '',
  takeaways: [],
}

export const DEFAULT_SOURCE = 'from numba import njit\n\n# Tu código PyOMP aquí\n'

/** Campos del ejemplo que el backend puede señalar en un 422 (`example.<campo>`). */
export const EXAMPLE_FIELDS = [
  'title', 'filename', 'difficulty', 'teaches', 'directives', 'threads_configurable', 'fixed_threads',
  'fixed_threads_note', 'sweeps_threads', 'self_measures', 'parser_id', 'default_timeout_s', 'est_run_seconds',
  'enabled', 'requires_gpu', 'expected_output_note', 'takeaways',
]

export interface ExampleDraft {
  example: AdminExampleBaseDto
  source_code: string
}

/** Borrador nuevo en cada llamada: los arrays del ejemplo no se comparten. */
export function blankDraft(): ExampleDraft {
  return {
    example: { ...DEFAULT_EXAMPLE, directives: [], takeaways: [] },
    source_code: DEFAULT_SOURCE,
  }
}
