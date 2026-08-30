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
import { QuizRunner } from './QuizRunner'
import { TracksCard } from './TracksCard'

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
  const gpuLocked = example.requires_gpu && !(system.data?.gpu_examples_enabled ?? false)
  const runDisabled = gpuLocked || !example.enabled

  return (
    <section className="screen learn">
      <div className="screen-head">
        <div>
          <Button variant="ghost" size="sm" style={{ marginBottom: 10, paddingLeft: 6 }} onClick={() => navigate('/cursos')}>
            <IconChevronLeft size={14} /> Volver al catálogo
          </Button>
          <div className="eyebrow">Aprender</div>
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

      <div className={`learn-grid${sideOpen ? ' with-side' : ''}`}>
        {/* Columna principal */}
        <div className="col" style={{ gap: 20 }}>
          {gpuLocked && (
            <div className="gpu-banner" role="note">
              <IconAlert size={16} />
              <span>Esta lección requiere GPU NVIDIA + gcc; puedes leerla pero no ejecutarla.</span>
            </div>
          )}
          <LessonMedia exampleId={example.id} filename={example.filename} runDisabled={runDisabled} />
          <LessonInfo lesson={lesson} example={example} runDisabled={runDisabled} />
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
