// progressStore.ts — el BACKEND es la fuente única del progreso
// (api-contract §4-§6; frontend-spec §3.1, decisión 9). Este store es una
// CACHÉ hidratada de GET /modules (progress fusionado) y refrescada tras cada
// PUT /progress y POST /quiz/attempts. En localStorage SOLO persiste
// `lastLessonId` (estado de UI "continuar donde lo dejaste") bajo la clave
// 'telar-last-lesson'; TODO lo demás viene del servidor.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getModules, putLessonProgress } from '../api/content'
import type { ModuleDto, ModulesSummaryDto, QuizAttemptResultDto } from '../api/types'

export interface ModuleProgressInfo {
  done: number
  total: number
  pct: number
}

export interface ProgressState {
  /** Caché de GET /api/v1/modules (con `progress` fusionado). */
  modules: ModuleDto[] | null
  /** `summary` del propio GET /modules (lessons_total, quizzes_total…). */
  summary: ModulesSummaryDto | null
  /** persist 'telar-last-lesson' — SOLO estado de UI, jamás progreso real. */
  lastLessonId: string | null
  loading: boolean
  /** Mensaje del último fallo de hydrate (las pantallas pintan ErrorState). */
  error: string | null
  /** GET /modules → caché. Dedupe de llamadas concurrentes. */
  hydrate: (force?: boolean) => Promise<void>
  /** PUT /api/v1/progress/lessons/{id} {viewed:true} → refresca la caché. */
  markViewed: (lessonId: string) => Promise<void>
  /** Actualiza la caché con la 201 de POST /quiz/attempts (sin re-GET). */
  applyAttemptResult: (r: QuizAttemptResultDto) => void
  /** Derivado de la caché: lecciones completadas del módulo. */
  moduleProgress: (moduleId: string) => ModuleProgressInfo
}

let inflight: Promise<void> | null = null

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      modules: null,
      summary: null,
      lastLessonId: null,
      loading: false,
      error: null,

      hydrate: (force = false) => {
        if (inflight && !force) return inflight
        if (!force && get().modules !== null) return Promise.resolve()
        set({ loading: true, error: null })
        inflight = getModules()
          .then(({ modules, summary }) => {
            set({ modules, summary, loading: false, error: null })
          })
          .catch((err: unknown) => {
            set({ loading: false, error: err instanceof Error ? err.message : String(err) })
          })
          .finally(() => {
            inflight = null
          })
        return inflight
      },

      markViewed: async (lessonId: string) => {
        // lastLessonId es estado de UI local: se fija siempre, incluso offline.
        set({ lastLessonId: lessonId })
        // Optimista sobre la caché (inmutable); el servidor manda después.
        const optimistic = updateLesson(get().modules, lessonId, (p) => ({ ...p, viewed: true }))
        if (optimistic) set({ modules: optimistic })
        try {
          await putLessonProgress(lessonId, { viewed: true })
        } catch {
          // PUT fallido (red caída): la vista no se rompe; el próximo
          // hydrate() re-sincroniza con la verdad del servidor.
          return
        }
        // «→ refresca» (frontend-spec §3.1): re-GET para reflejar la verdad.
        await get().hydrate(true)
      },

      applyAttemptResult: (r: QuizAttemptResultDto) => {
        const { modules, summary } = get()
        if (!modules) return
        let newlyCompleted = false
        const next = updateLesson(modules, r.lesson_id, (p) => {
          const best = p.best_quiz_score === null ? r.score : Math.max(p.best_quiz_score, r.score)
          const completed = p.completed || r.passed
          if (completed && !p.completed) newlyCompleted = true
          return { ...p, viewed: true, completed, best_quiz_score: best, quiz_total: r.total }
        })
        if (!next) return
        set({
          modules: next,
          summary:
            summary && newlyCompleted
              ? { ...summary, lessons_completed: summary.lessons_completed + 1 }
              : summary,
        })
      },

      moduleProgress: (moduleId: string): ModuleProgressInfo => {
        const mod = get().modules?.find((m) => m.id === moduleId)
        if (!mod || mod.lessons.length === 0) return { done: 0, total: 0, pct: 0 }
        const done = mod.lessons.filter((l) => l.progress.completed).length
        const total = mod.lessons.length
        return { done, total, pct: Math.round((done / total) * 100) }
      },
    }),
    {
      name: 'telar-last-lesson',
      // SOLO lastLessonId persiste (frontend-spec §3.1, decisión 9).
      partialize: (state) => ({ lastLessonId: state.lastLessonId }),
    },
  ),
)

/** Copia inmutable de modules con el progress de una lección transformado. */
function updateLesson(
  modules: ModuleDto[] | null,
  lessonId: string,
  fn: (p: ModuleDto['lessons'][number]['progress']) => ModuleDto['lessons'][number]['progress'],
): ModuleDto[] | null {
  if (!modules) return null
  let touched = false
  const next = modules.map((mod) => {
    if (!mod.lessons.some((l) => l.id === lessonId)) return mod
    touched = true
    return {
      ...mod,
      lessons: mod.lessons.map((l) => (l.id === lessonId ? { ...l, progress: fn(l.progress) } : l)),
    }
  })
  return touched ? next : null
}
