// LearnScreen — lección (frontend-spec §6.6). Columna principal, en este orden:
// LessonMedia (reproductor SOLO si la lección tiene video; si no, no se monta),
// LessonInfo abierta (markdown/código/salida esperada) y QuizRunner (modelo
// servidor). LessonSidebar + TracksCard van en un DRAWER lateral oculto por
// defecto (2026-07: "Recomendado para ti" retirado; el panel módulo+progreso se
// muestra/oculta con un botón).
//
// C1 (2026-08): antes el primer bloque era un reproductor con placeholder «Video
// próximamente» y LessonInfo nacía colapsada — con el mapa de videos vacío, la
// pantalla abría sin mostrar la lección. Ahora el contenido manda y el video es
// opcional.
//
// Al montar: progressStore.markViewed(id) → PUT /progress (el backend es la
// fuente del progreso) y lastLessonId local.
import '../../styles/screens/learn.css'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { getExample, getLesson, loadExamplesIndex } from '../../api/content'
import { ApiError } from '../../api/client'
import type { ExampleDetailDto, ExampleSummaryDto, LessonDetailDto } from '../../api/types'
import { IconAlert, IconChevronLeft, IconChevronRight, IconLayers } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { ErrorState } from '../../components/ui/ErrorState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useSystemInfo } from '../../hooks/useSystemInfo'
import { useProgressStore } from '../../stores/progressStore'
import { LessonMedia } from './LessonMedia'
import { LessonInfo } from './LessonInfo'
import { LessonSidebar } from './LessonSidebar'
import { MarkReadCard } from './MarkReadCard'
import { completionRequirement } from '../../lib/completionRequirement'
import { QuizRunner } from './QuizRunner'
import { TracksCard } from './TracksCard'
import { WorkshopSteps } from './WorkshopSteps'

// El panel "módulo + progreso" es un drawer a la derecha, OCULTO por defecto;
// su estado (abierto/cerrado) se persiste como preferencia de UI en localStorage.
const SIDE_STORAGE_KEY = 'telar-learn-side'

function readSidePref(): boolean {
  // El acceso a localStorage puede lanzar (iframe sandbox, webview Electron
  // restringido, modo privado). Simétrico con el write (más abajo): ante error,
  // el drawer arranca oculto. El try/catch cubre también el caso SSR (undefined).
  try {
    return localStorage.getItem(SIDE_STORAGE_KEY) === 'open'
  } catch {
    return false
  }
}

interface LoadedLesson {
  lesson: LessonDetailDto
  /** E1: `null` en una lección conceptual — no hay código que mostrar ni correr. */
  example: ExampleDetailDto | null
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
  // Drawer "módulo + progreso": oculto por defecto (preferencia persistida).
  const [sideOpen, setSideOpen] = useState<boolean>(readSidePref)

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_STORAGE_KEY, sideOpen ? 'open' : 'closed')
    } catch {
      // localStorage no disponible (modo privado/SSR): la preferencia no persiste.
    }
  }, [sideOpen])

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
        // E1: solo se pide el ejemplo si la lección tiene uno. Antes esto era
        // incondicional porque toda lección traía código.
        const example =
          lesson.example_id != null ? await getExample(lesson.example_id) : null
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
          <Button variant="outline" size="sm" onClick={() => navigate('/aprender')}>
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
        <div className={`learn-grid${sideOpen ? ' with-side' : ''}`} aria-hidden="true">
          {/* Silueta: contenido de la lección + quiz. Refleja la preferencia
              persistida del drawer para no provocar layout-shift al hidratar
              (1→2 columnas), y ya no reserva el hueco 16:9 del video, que solo
              aparece si la lección tiene fuente. */}
          <div className="col" style={{ gap: 20 }}>
            <Skeleton height={280} radius="var(--r-lg)" />
            <Skeleton height={180} radius="var(--r-lg)" />
          </div>
          {sideOpen && (
            <div className="col" style={{ gap: 16 }}>
              <Skeleton height={260} radius="var(--r-lg)" />
              <Skeleton height={180} radius="var(--r-lg)" />
            </div>
          )}
        </div>
      </section>
    )
  }

  const { lesson, example } = loaded
  const module = modules?.find((m) => m.id === lesson.module_id) ?? null
  const lessonIndex = module ? [...module.lessons].sort((a, b) => a.order - b.order).findIndex((l) => l.id === lesson.id) + 1 : lesson.order
  // Progreso fresco desde la caché (se actualiza tras el intento de quiz).
  const cachedProgress = module?.lessons.find((l) => l.id === lesson.id)?.progress ?? lesson.progress
  // Sin ejemplo no hay nada que bloquear: la lección se lee igual en cualquier
  // máquina. `runDisabled` solo tiene sentido cuando hay código.
  const gpuLocked =
    example != null && example.requires_gpu && !(system.data?.gpu_examples_enabled ?? false)
  const runDisabled = gpuLocked || (example != null && !example.enabled)
  // CU-12.3: qué falta para completarla, según su regla (null si no cuenta).
  const requirement = completionRequirement(lesson, cachedProgress.completed)
  // S6 (CU-28): un taller es una guía de pasos; no lleva video, quiz ni «Marcar
  // como completada» (su regla guardada es 'viewed', pero lo completan sus pasos).
  const isTaller = lesson.kind === 'taller'

  return (
    <section className="screen learn">
      <div className="screen-head">
        <div>
          <Button variant="ghost" size="sm" style={{ marginBottom: 10, paddingLeft: 6 }} onClick={() => navigate('/aprender')}>
            <IconChevronLeft size={14} /> Volver al catálogo
          </Button>
          <div className="eyebrow">Aprender</div>
          <h2 className="display-lg">{lesson.title}</h2>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            {module && <Chip tone="orange">{module.title}</Chip>}
            <Chip>
              Módulo {module?.order ?? lesson.module_id} · Lección {lessonIndex}
            </Chip>
            {/* C4: `estimated_minutes` se escribía en autoría y no llegaba a
                ninguna pantalla. Es el tiempo de LECTURA, distinto del
                `~{est_run_seconds}s` de ejecución que muestra el catálogo. */}
            {isTaller && <Chip tone="orange">Taller</Chip>}
            <Chip>~{lesson.estimated_minutes} min</Chip>
            {summary && (
              <span className="mono-small">
                Progreso: {summary.lessons_completed}/{summary.lessons_enabled}
              </span>
            )}
          </div>
          {requirement != null && (
            <p className="mono-small muted" data-testid="requisito-completar" style={{ margin: '8px 0 0' }}>
              {requirement}
            </p>
          )}
          {/* C4: `teaches` es el resumen de una línea de qué enseña la lección;
              tampoco se mostraba en ningún sitio. Vive en el EJEMPLO, así que
              una lección conceptual no lo tiene (E1). */}
          {example != null && example.teaches !== '' && (
            <p className="learn-teaches">{example.teaches}</p>
          )}
        </div>
        <div className="row">
          <Button
            variant="outline"
            size="sm"
            className={`learn-side-toggle${sideOpen ? ' is-open' : ''}`}
            aria-expanded={sideOpen}
            aria-controls="learn-side-panel"
            onClick={() => setSideOpen((o) => !o)}
          >
            <IconLayers size={14} />
            {sideOpen ? 'Ocultar módulo y progreso' : 'Módulo y progreso'}
            <IconChevronRight size={14} className="learn-side-toggle-chev" />
          </Button>
          <Button
            variant="outline"
            disabled={lesson.prev_lesson_id == null}
            onClick={() => lesson.prev_lesson_id && navigate(`/aprender/${lesson.prev_lesson_id}`)}
          >
            <IconChevronLeft size={14} /> Anterior
          </Button>
          <Button
            variant="primary"
            disabled={lesson.next_lesson_id == null}
            onClick={() => lesson.next_lesson_id && navigate(`/aprender/${lesson.next_lesson_id}`)}
          >
            Siguiente <IconChevronRight size={14} />
          </Button>
        </div>
      </div>

      <div className={`learn-grid${sideOpen ? ' with-side' : ''}`}>
        {/* Columna principal */}
        <div className="col" style={{ gap: 20 }}>
          {lesson.archived && (
            <div className="gpu-banner" role="note">
              <IconAlert size={16} />
              <span>
                Esta lección fue retirada de su módulo. Puedes leerla, pero ya no forma parte del
                curso ni cuenta para tu progreso.
              </span>
            </div>
          )}
          {gpuLocked && (
            <div className="gpu-banner" role="note">
              <IconAlert size={16} />
              <span>Esta lección requiere GPU NVIDIA + gcc; puedes leerla pero no ejecutarla.</span>
            </div>
          )}
          {!isTaller && (
            <LessonMedia
              lessonId={lesson.id}
              videoUrl={lesson.video_url}
              exampleId={example?.id ?? null}
              filename={example?.filename ?? null}
              runDisabled={runDisabled}
            />
          )}
          <LessonInfo lesson={lesson} example={example} runDisabled={runDisabled} />
          {isTaller && (
            <WorkshopSteps
              key={lesson.id}
              lessonId={lesson.id}
              steps={lesson.steps ?? []}
              completed={cachedProgress.completed}
              countsForProgress={lesson.enabled && !lesson.archived}
            />
          )}
          {!isTaller && lesson.completion_rule === 'viewed' && lesson.enabled && !lesson.archived && (
            <MarkReadCard lessonId={lesson.id} completed={cachedProgress.completed} />
          )}
          {lesson.has_quiz && (
            <QuizRunner
              key={lesson.id}
              lessonId={lesson.id}
              lessonTitle={lesson.title}
              questionCount={lesson.quiz_question_count}
              progress={cachedProgress}
            />
          )}
        </div>

        {/* Drawer lateral: módulo + progreso. Oculto por defecto (Fix 5);
            "Recomendado para ti" se retiró (Fix 4: en un path de aprendizaje
            la recomendación ES la siguiente lección, ya cubierta por el botón
            "Siguiente"). Se mantiene montado para que aria-controls resuelva. */}
        <aside
          id="learn-side-panel"
          className={`col learn-side${sideOpen ? '' : ' is-collapsed'}`}
          style={{ gap: 16 }}
          aria-label="Módulo y progreso"
        >
          {module && <LessonSidebar module={module} currentLessonId={lesson.id} examplesIndex={examplesIndex} />}
          {modules && <TracksCard modules={modules} />}
        </aside>
      </div>
    </section>
  )
}
