// api/content.ts — capa de datos del contenido educativo (api-contract §3-§6):
// ejemplos, módulos/lecciones, quizzes (modelo servidor) y progreso.
// Todos los endpoints usan el envelope (client.ts lo desenvuelve).
import { fetchJson } from './client'
import type {
  ExampleDetailDto,
  ExampleSummaryDto,
  ExamplesListDto,
  LessonDetailDto,
  ModulesResponseDto,
  ProgressEntryDto,
  ProgressResponseDto,
  ProgressUpdateRequestDto,
  QuizAttemptResultDto,
  QuizDto,
  QuizOptionKey,
  WorkshopStepUpdateResultDto,
} from './types'

/** §3.1 GET /api/v1/examples — listado sin código fuente. */
export function getExamples(): Promise<ExamplesListDto> {
  return fetchJson<ExamplesListDto>('/api/v1/examples')
}

/** §3.2 GET /api/v1/examples/{id} — detalle con código, takeaways, flags. */
export function getExample(exampleId: string): Promise<ExampleDetailDto> {
  return fetchJson<ExampleDetailDto>(`/api/v1/examples/${encodeURIComponent(exampleId)}`)
}

/** §4.1 GET /api/v1/modules — catálogo completo con `progress` fusionado. */
export function getModules(): Promise<ModulesResponseDto> {
  return fetchJson<ModulesResponseDto>('/api/v1/modules')
}

/** §4.2 GET /api/v1/lessons/{id} — markdown, prev/next, recommended, progress. */
export function getLesson(lessonId: string): Promise<LessonDetailDto> {
  return fetchJson<LessonDetailDto>(`/api/v1/lessons/${encodeURIComponent(lessonId)}`)
}

/** §5.1 GET /api/v1/lessons/{id}/quiz — preguntas SIN respuestas correctas. */
export function getQuiz(lessonId: string): Promise<QuizDto> {
  return fetchJson<QuizDto>(`/api/v1/lessons/${encodeURIComponent(lessonId)}/quiz`)
}

/** §5.2 POST /api/v1/lessons/{id}/quiz/attempts — corrección en el servidor. */
export function postQuizAttempt(
  lessonId: string,
  answers: Record<string, QuizOptionKey>,
): Promise<QuizAttemptResultDto> {
  return fetchJson<QuizAttemptResultDto>(`/api/v1/lessons/${encodeURIComponent(lessonId)}/quiz/attempts`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
}

/** §6.1 GET /api/v1/progress — mapa completo (hidratación opcional). */
export function getProgress(): Promise<ProgressResponseDto> {
  return fetchJson<ProgressResponseDto>('/api/v1/progress')
}

/** §6.2 PUT /api/v1/progress/lessons/{id} — marcar viewed/completed. */
export function putLessonProgress(
  lessonId: string,
  body: ProgressUpdateRequestDto,
): Promise<ProgressEntryDto> {
  return fetchJson<ProgressEntryDto>(`/api/v1/progress/lessons/${encodeURIComponent(lessonId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/**
 * §12.2 PUT /api/v1/progress/lessons/{id}/steps/{idx} — casilla «Lo hice» de un
 * paso de taller. Idempotente; `completed` en la respuesta es monótono.
 */
export function putWorkshopStep(
  lessonId: string,
  idx: number,
  done: boolean,
): Promise<WorkshopStepUpdateResultDto> {
  return fetchJson<WorkshopStepUpdateResultDto>(
    `/api/v1/progress/lessons/${encodeURIComponent(lessonId)}/steps/${idx}`,
    { method: 'PUT', body: JSON.stringify({ done }) },
  )
}

// ── Índice de ejemplos memoizado (frontend-spec §3: fetch + caché simple a
//    nivel de módulo; sin react-query en MVP). Lo usan catálogo (metas
//    `Ejemplo · ~{n}s`, ContinueCard) y Learn (sidebar del módulo).

let examplesIndexCache: Promise<Map<string, ExampleSummaryDto>> | null = null

export function loadExamplesIndex(force = false): Promise<Map<string, ExampleSummaryDto>> {
  if (!examplesIndexCache || force) {
    examplesIndexCache = getExamples()
      .then(({ examples }) => new Map(examples.map((e) => [e.id, e])))
      .catch((err: unknown) => {
        examplesIndexCache = null // no cachear errores: el retry re-consulta
        throw err
      })
  }
  return examplesIndexCache
}
