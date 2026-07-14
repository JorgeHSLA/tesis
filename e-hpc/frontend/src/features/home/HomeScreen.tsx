// HomeScreen — pantalla de inicio (frontend-spec §6.1): hero con
// HomeThreadsDiagram (SMIL), TutorialTabs, TutorialCallout, QuickCards,
// RecentJobs y SuggestedLessons. Textos EXACTOS de la spec (adaptación
// MPI→OpenMP §6.0). El progreso viene del progressStore (caché de /modules).
import '../../styles/screens/home.css'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBook, IconZap } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { HomeThreadsDiagram } from '../../components/viz/HomeThreadsDiagram'
import { useProgressStore } from '../../stores/progressStore'
import { QuickCards } from './QuickCards'
import { RecentJobs } from './RecentJobs'
import { SuggestedLessons } from './SuggestedLessons'
import { TutorialCallout } from './TutorialCallout'
import { TutorialTabs } from './TutorialTabs'

export default function HomeScreen() {
  const navigate = useNavigate()
  const modules = useProgressStore((s) => s.modules)
  const lastLessonId = useProgressStore((s) => s.lastLessonId)
  const hydrate = useProgressStore((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return (
    <section className="screen home">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="hero">
        <div className="hero-left">
          <div className="eyebrow">Bienvenido de vuelta</div>
          <h1 className="display-xl">
            Aprende programación paralela
            <br />
            sin un supercomputador.
          </h1>
          <p className="hero-sub">
            Ejecutamos tu código OpenMP real en tu computadora, aislado en contenedores Docker. Escribe
            código, elige cuántos hilos, ejecútalo — y aprende por qué acelera (o por qué no).
          </p>
          <div className="row" style={{ gap: 10, marginTop: 20 }}>
            <Button variant="primary" size="xl" onClick={() => navigate('/simulador')}>
              <IconZap size={18} /> Empezar ejecución
            </Button>
            <Button variant="outline" size="xl" onClick={() => navigate('/cursos')}>
              <IconBook size={18} /> Explorar lecciones
            </Button>
          </div>
        </div>

        <div className="hero-right">
          <div className="hero-diagram">
            <HomeThreadsDiagram />
            <div className="hero-diagram-caption">
              <Chip tone="orange">omp parallel</Chip>
              <span className="mono-small">4 hilos · fork-join</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Cómo funciona ────────────────────────────────────────────────── */}
      <div className="section-head">
        <div>
          <div className="eyebrow">Cómo funciona</div>
          <h2 className="display-lg" style={{ marginTop: 4 }}>
            3 pasos para tu primera ejecución
          </h2>
        </div>
      </div>

      <TutorialTabs />
      <TutorialCallout />

      {/* ── Acciones rápidas ─────────────────────────────────────────────── */}
      <div className="section-head">
        <div>
          <div className="eyebrow">Acciones rápidas</div>
          <h2 className="display-lg" style={{ marginTop: 4 }}>
            ¿Qué quieres hacer ahora?
          </h2>
        </div>
      </div>

      <QuickCards modules={modules} lastLessonId={lastLessonId} />

      {/* ── Jobs recientes + Lecciones sugeridas ─────────────────────────── */}
      <div className="two-col">
        <RecentJobs />
        <SuggestedLessons modules={modules} />
      </div>
    </section>
  )
}
