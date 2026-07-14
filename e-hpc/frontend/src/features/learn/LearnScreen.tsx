// LearnScreen — lección (frontend-spec §6.6): CodeShowcase + LessonInfo
// (markdown/código/salida esperada) + QuizRunner (modelo servidor) en la
// columna principal; LessonSidebar + RecommendedCard + TracksCard en la
// lateral. Al montar: progressStore.markViewed(id) → PUT /progress (el
// backend es la fuente del progreso) y lastLessonId local.
import '../../styles/screens/learn.css'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { getExample, getLesson, loadExamplesIndex } from '../../api/content'
import { ApiError } from '../../api/client'
import type { ExampleDetailDto, ExampleSummaryDto, LessonDetailDto } from '../../api/types'
import { IconAlert, IconChevronLeft, IconChevronRight } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { useProgressStore } from '../../stores/progressStore'
import { CodeShowcase } from './CodeShowcase'
import { LessonInfo } from './LessonInfo'
import { LessonSidebar } from './LessonSidebar'
import { QuizRunner } from './QuizRunner'
import { RecommendedCard } from './RecommendedCard'
import { TracksCard } from './TracksCard'

interface LoadedLesson {
  lesson: LessonDetailDto
  example: ExampleDetailDto
}

export default function LearnScreen() {
  const { leccionId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const modules = useProgressStore((s) => s.modules)
  const summary = useProgressStore((s) => s.summary)
  const hydrate = useProgressStore((s) => s.hydrate)
  const markViewed = useProgressStore((s) => s.markViewed)
  const system = useSystemInfo()

  const [loaded, setLoaded] = useState<LoadedLesson | null>(null)
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null)
  const [examplesIndex, setExamplesIndex] = useState<Map<string, ExampleSummaryDto> | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    let alive = true
    loadExamplesIndex()
      .then((idx) => {
        if (alive) setExamplesIndex(idx)
      })
      .catch(() => {
        // metas `~{n}s` del sidebar degradan a '—'.
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setError(null)
    getLesson(leccionId)
      .then(async (lesson) => {
        const example = await getExample(lesson.example_id)
        if (!alive) return
        setLoaded({ lesson, example })
        // markViewed tras confirmar que la lección existe (PUT + refresco).
        void markViewed(lesson.id)
      })
      .catch((err: unknown) => {
        if (!alive) return
        const notFound = err instanceof ApiError && err.status === 404
        setError({ message: err instanceof Error ? err.message : String(err), notFound })
      })
    return () => {
      alive = false
    }
  }, [leccionId, markViewed, reloadKey])

  // Anclaje a la sección quiz cuando se llega desde la fila de quiz (§6.5).
  const anchor = (location.state as { anchor?: string } | null)?.anchor
  useEffect(() => {
    if (loaded && anchor === 'quiz') {
      document.getElementById('quiz')?.scrollIntoView({ block: 'start' })
    }
  }, [loaded, anchor])

  if (error) {
    return (
      <section className="screen learn">
        <ErrorState
          message={
            error.notFound
              ? 'Esta lección no existe en el catálogo.'
              : 'No se pudo cargar la lección.'
          }
          detail={error.message}
          onRetry={error.notFound ? undefined : () => setReloadKey((k) => k + 1)}
        >
          <Button variant="outline" size="sm" onClick={() => navigate('/cursos')}>
            Volver al catálogo
          </Button>
        </ErrorState>
      </section>
    )
  }

  if (!loaded) {
    return (
      <section className="screen learn" aria-busy="true">
        <div className="screen-head">
          <div>
            <Skeleton width={140} height={12} style={{ marginBottom: 10 }} />
            <Skeleton width={420} height={30} />
          </div>
        </div>
        <div className="learn-grid" aria-hidden="true">
          <div className="col" style={{ gap: 20 }}>
            <Skeleton height={320} radius="var(--r-lg)" />
            <Skeleton height={220} radius="var(--r-lg)" />
          </div>
          <div className="col" style={{ gap: 16 }}>
            <Skeleton height={260} radius="var(--r-lg)" />
            <Skeleton height={180} radius="var(--r-lg)" />
          </div>
        </div>
      </section>
    )
  }

  const { lesson, example } = loaded
  const module = modules?.find((m) => m.id === lesson.module_id) ?? null
  const lessonIndex = module ? [...module.lessons].sort((a, b) => a.order - b.order).findIndex((l) => l.id === lesson.id) + 1 : lesson.order
  // Progreso fresco desde la caché (se actualiza tras el intento de quiz).
  const cachedProgress = module?.lessons.find((l) => l.id === lesson.id)?.progress ?? lesson.progress
  const gpuLocked = example.requires_gpu && !(system.data?.gpu_examples_enabled ?? false)
  const runDisabled = gpuLocked || !example.enabled

  return (
    <section className="screen learn">
      <div className="screen-head">
        <div>
          <Button variant="ghost" size="sm" style={{ marginBottom: 10, paddingLeft: 6 }} onClick={() => navigate('/cursos')}>
            <IconChevronLeft size={14} /> Volver al catálogo
          </Button>
          <div className="eyebrow">ZINE · Aprender</div>
          <h2 className="display-lg">{lesson.title}</h2>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            {module && <Chip tone="orange">{module.title}</Chip>}
            <Chip>
              Módulo {module?.order ?? lesson.module_id} · Lección {lessonIndex}
            </Chip>
            {summary && (
              <span className="mono-small">
                Progreso: {summary.lessons_completed}/{summary.lessons_total}
              </span>
            )}
          </div>
        </div>
        <div className="row">
          <Button
            variant="outline"
            disabled={lesson.prev_lesson_id == null}
            onClick={() => lesson.prev_lesson_id && navigate(`/cursos/${lesson.prev_lesson_id}`)}
          >
            <IconChevronLeft size={14} /> Anterior
          </Button>
          <Button
            variant="primary"
            disabled={lesson.next_lesson_id == null}
            onClick={() => lesson.next_lesson_id && navigate(`/cursos/${lesson.next_lesson_id}`)}
          >
            Siguiente <IconChevronRight size={14} />
          </Button>
        </div>
      </div>

      <div className="learn-grid">
        {/* Columna principal */}
        <div className="col" style={{ gap: 20 }}>
          {gpuLocked && (
            <div className="gpu-banner" role="note">
              <IconAlert size={16} />
              <span>Esta lección requiere GPU NVIDIA + gcc; puedes leerla pero no ejecutarla.</span>
            </div>
          )}
          <CodeShowcase
            sourceCode={example.source_code}
            filename={example.filename}
            exampleId={example.id}
            runDisabled={runDisabled}
          />
          <LessonInfo lesson={lesson} example={example} runDisabled={runDisabled} />
          {lesson.has_quiz && (
            <QuizRunner
              key={lesson.id}
              lessonId={lesson.id}
              questionCount={lesson.quiz_question_count}
              progress={cachedProgress}
            />
          )}
        </div>

        {/* Lateral: módulo + recomendados + progreso */}
        <div className="col learn-side" style={{ gap: 16 }}>
          {module && <LessonSidebar module={module} currentLessonId={lesson.id} examplesIndex={examplesIndex} />}
          <RecommendedCard recommended={lesson.recommended} />
          {modules && <TracksCard modules={modules} />}
        </div>
      </div>
    </section>
  )
}
