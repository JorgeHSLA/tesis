// Suite 4 (frontend-spec §10): stores/progressStore.test.ts
// Caché de /modules: hydrate(), markViewed (PUT + refresh), applyAttemptResult
// (best score/completed), lastLessonId persistido en localStorage, moduleProgress.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { lessonTarget, useProgressStore } from '@/stores/progressStore'
import type { ModuleDto, ProgressEntryDto } from '@/api/types'
import { MODULES, MODULES_CON_LECTURA, QUIZ_ATTEMPT_FAIL, QUIZ_ATTEMPT_RESULT } from '../fixtures/rest'

vi.mock('@/api/content', () => ({
  getModules: vi.fn(),
  putLessonProgress: vi.fn(),
}))

import { getModules, putLessonProgress } from '@/api/content'

const getModulesMock = getModules as Mock
const putLessonProgressMock = putLessonProgress as Mock

function cloneModules(): ModuleDto[] {
  return structuredClone(MODULES.modules)
}

const PROGRESS_ENTRY: ProgressEntryDto = {
  viewed: true,
  completed: false,
  best_quiz_score: null,
  quiz_total: 5,
  last_job_id: null,
  completed_via: null,
  updated_at: '2026-07-12T09:30:00Z',
}

beforeEach(() => {
  localStorage.clear()
  useProgressStore.setState({
    modules: null,
    summary: null,
    lastLessonId: null,
    loading: false,
    error: null,
  })
  getModulesMock.mockReset()
  putLessonProgressMock.mockReset()
  getModulesMock.mockResolvedValue(structuredClone(MODULES))
  putLessonProgressMock.mockResolvedValue(PROGRESS_ENTRY)
})

describe('hydrate()', () => {
  it('puebla modules y summary desde GET /modules', async () => {
    await useProgressStore.getState().hydrate()
    const st = useProgressStore.getState()
    expect(st.modules?.[0].id).toBe('m2')
    expect(st.summary?.lessons_total).toBe(14)
    expect(st.loading).toBe(false)
    expect(st.error).toBeNull()
  })

  it('dedupe de llamadas concurrentes: un solo GET', async () => {
    const p1 = useProgressStore.getState().hydrate()
    const p2 = useProgressStore.getState().hydrate()
    await Promise.all([p1, p2])
    expect(getModulesMock).toHaveBeenCalledTimes(1)
  })

  it('no re-consulta si ya hay caché (salvo force)', async () => {
    await useProgressStore.getState().hydrate()
    await useProgressStore.getState().hydrate()
    expect(getModulesMock).toHaveBeenCalledTimes(1)
    await useProgressStore.getState().hydrate(true)
    expect(getModulesMock).toHaveBeenCalledTimes(2)
  })

  it('guarda el mensaje de error si el GET falla', async () => {
    getModulesMock.mockRejectedValueOnce(new Error('backend caído'))
    await useProgressStore.getState().hydrate()
    const st = useProgressStore.getState()
    expect(st.error).toBe('backend caído')
    expect(st.loading).toBe(false)
    expect(st.modules).toBeNull()
  })
})

describe('markViewed()', () => {
  it('fija lastLessonId, hace PUT viewed:true y refresca la caché', async () => {
    useProgressStore.setState({ modules: cloneModules() })
    await useProgressStore.getState().markViewed('spmdCritical')
    expect(putLessonProgressMock).toHaveBeenCalledWith('spmdCritical', { viewed: true })
    expect(useProgressStore.getState().lastLessonId).toBe('spmdCritical')
    // «→ refresca»: re-GET tras el PUT.
    expect(getModulesMock).toHaveBeenCalledTimes(1)
  })

  it('optimista: marca viewed en la caché antes del re-GET', async () => {
    useProgressStore.setState({ modules: cloneModules() })
    let optimisticViewed: boolean | undefined
    putLessonProgressMock.mockImplementationOnce(async () => {
      const lesson = useProgressStore
        .getState()
        .modules?.[0].lessons.find((l) => l.id === 'spmdCritical')
      optimisticViewed = lesson?.progress.viewed
      return PROGRESS_ENTRY
    })
    await useProgressStore.getState().markViewed('spmdCritical')
    expect(optimisticViewed).toBe(true)
  })

  it('PUT fallido (offline): lastLessonId igual se fija, sin re-GET ni throw', async () => {
    useProgressStore.setState({ modules: cloneModules() })
    putLessonProgressMock.mockRejectedValueOnce(new Error('red caída'))
    await expect(useProgressStore.getState().markViewed('spmd')).resolves.toBeUndefined()
    expect(useProgressStore.getState().lastLessonId).toBe('spmd')
    expect(getModulesMock).not.toHaveBeenCalled()
  })

  it('lastLessonId persiste en localStorage (telar-last-lesson)', async () => {
    useProgressStore.setState({ modules: cloneModules() })
    await useProgressStore.getState().markViewed('spmd')
    const raw = localStorage.getItem('telar-last-lesson')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.lastLessonId).toBe('spmd')
  })
})

describe('markRead()', () => {
  it('S2: PUT {viewed:true, completed:true} y refresca la caché', async () => {
    useProgressStore.setState({ modules: structuredClone(MODULES_CON_LECTURA.modules) })
    await useProgressStore.getState().markRead('queEsUnHilo')
    expect(putLessonProgressMock).toHaveBeenCalledWith('queEsUnHilo', { viewed: true, completed: true })
    expect(getModulesMock).toHaveBeenCalledTimes(1)
  })

  it('S2: si el PUT falla, propaga el error (la UI lo muestra) y no re-consulta', async () => {
    useProgressStore.setState({ modules: structuredClone(MODULES_CON_LECTURA.modules) })
    putLessonProgressMock.mockRejectedValueOnce(new Error('red caída'))
    await expect(useProgressStore.getState().markRead('queEsUnHilo')).rejects.toThrow('red caída')
    expect(getModulesMock).not.toHaveBeenCalled()
  })
})

describe('applyAttemptResult()', () => {
  it('sube best score, marca completed e incrementa summary al aprobar', () => {
    useProgressStore.setState({ modules: cloneModules(), summary: structuredClone(MODULES.summary) })
    useProgressStore.getState().applyAttemptResult(QUIZ_ATTEMPT_RESULT)
    const lesson = useProgressStore.getState().modules?.[0].lessons.find((l) => l.id === 'spmd')
    expect(lesson?.progress.completed).toBe(true)
    expect(lesson?.progress.viewed).toBe(true)
    expect(lesson?.progress.best_quiz_score).toBe(4) // max(4, 2)
    expect(useProgressStore.getState().summary?.lessons_completed).toBe(6) // 5 + 1
  })

  it('intento fallido no marca completed ni toca summary', () => {
    useProgressStore.setState({ modules: cloneModules(), summary: structuredClone(MODULES.summary) })
    useProgressStore.getState().applyAttemptResult({ ...QUIZ_ATTEMPT_FAIL, lesson_id: 'spmdCritical' })
    const lesson = useProgressStore.getState().modules?.[0].lessons.find((l) => l.id === 'spmdCritical')
    expect(lesson?.progress.completed).toBe(false)
    expect(useProgressStore.getState().summary?.lessons_completed).toBe(5)
  })

  it('S2: aprobar el quiz de una lección run guarda la nota pero NO la completa', () => {
    const mods = cloneModules()
    mods[0].lessons[0].completion_rule = 'run'
    useProgressStore.setState({ modules: mods, summary: structuredClone(MODULES.summary) })
    useProgressStore.getState().applyAttemptResult({ ...QUIZ_ATTEMPT_RESULT, score: 5 })
    const lesson = useProgressStore.getState().modules?.[0].lessons.find((l) => l.id === 'spmd')
    expect(lesson?.progress.completed).toBe(false)
    expect(lesson?.progress.best_quiz_score).toBe(5)
    expect(useProgressStore.getState().summary?.lessons_completed).toBe(5)
  })

  it('S2: aprobar el quiz de una lección deshabilitada no la completa', () => {
    const mods = cloneModules()
    mods[0].lessons[0].enabled = false
    useProgressStore.setState({ modules: mods, summary: structuredClone(MODULES.summary) })
    useProgressStore.getState().applyAttemptResult(QUIZ_ATTEMPT_RESULT)
    const lesson = useProgressStore.getState().modules?.[0].lessons.find((l) => l.id === 'spmd')
    expect(lesson?.progress.completed).toBe(false)
    expect(useProgressStore.getState().summary?.lessons_completed).toBe(5)
  })

  it('sin caché (modules null) es no-op', () => {
    useProgressStore.setState({ modules: null })
    expect(() => useProgressStore.getState().applyAttemptResult(QUIZ_ATTEMPT_RESULT)).not.toThrow()
  })
})

describe('moduleProgress()', () => {
  it('calcula done/total/pct de las lecciones completadas', () => {
    const mods = cloneModules()
    mods[0].lessons[0].progress.completed = true // spmd completada
    useProgressStore.setState({ modules: mods })
    expect(useProgressStore.getState().moduleProgress('m2')).toEqual({ done: 1, total: 2, pct: 50 })
  })

  it('S2: el denominador son las lecciones habilitadas', () => {
    const mods = cloneModules()
    mods[0].lessons[0].progress.completed = true
    mods[0].lessons[1].enabled = false
    mods[0].lessons[1].progress.completed = true // deshabilitada: no suma
    useProgressStore.setState({ modules: mods })
    expect(useProgressStore.getState().moduleProgress('m2')).toEqual({ done: 1, total: 1, pct: 100 })
  })

  it('módulo inexistente → ceros', () => {
    useProgressStore.setState({ modules: cloneModules() })
    expect(useProgressStore.getState().moduleProgress('no-existe')).toEqual({ done: 0, total: 0, pct: 0 })
  })
})

describe('lessonTarget() · S2 Continuar/Empezar', () => {
  it('la última visitada si sigue disponible → Reanudar', () => {
    const t = lessonTarget(cloneModules(), 'spmdCritical')
    expect(t?.lesson.id).toBe('spmdCritical')
    expect(t?.resumed).toBe(true)
  })

  it('última visitada deshabilitada → primera disponible', () => {
    const mods = cloneModules()
    mods[0].lessons[1].enabled = false
    const t = lessonTarget(mods, 'spmdCritical')
    expect(t?.lesson.id).toBe('spmd')
    expect(t?.resumed).toBe(false)
  })

  it('última visitada que ya no está (archivada o borrada) → primera disponible en orden', () => {
    const mods = cloneModules()
    mods[0].lessons.reverse() // el orden lo da `order`, no la posición
    mods[0].lessons.find((l) => l.id === 'spmd')!.enabled = false
    const t = lessonTarget(mods, 'primerEjemplo')
    expect(t?.lesson.id).toBe('spmdCritical')
    expect(t?.resumed).toBe(false)
  })

  it('sin lecciones disponibles → null', () => {
    const mods = cloneModules()
    mods[0].lessons.forEach((l) => (l.enabled = false))
    expect(lessonTarget(mods, null)).toBeNull()
  })
})
