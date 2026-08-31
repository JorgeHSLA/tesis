// HomeScreen — pantalla de inicio (frontend-spec §6.1): hero con la animación
// fork-join (HomeMasterWorkers), TutorialTabs, TutorialCallout y la viñeta
// pixel-art de cierre. Textos EXACTOS de la spec (adaptación MPI→OpenMP §6.0).
//
// 2026-07: el bloque «¿Qué quieres hacer ahora?» (QuickCards + RecentJobs +
// SuggestedLessons) se retira de esta pantalla; el catálogo y el historial
// siguen accesibles desde la navegación lateral. Se conserva `hydrate()`
// porque calienta la caché de /modules que consumen Catálogo y Lección.
import '../../styles/screens/home.css'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBook, IconZap } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Chip'
import { HomeMasterWorkers } from '../../components/viz/HomeMasterWorkers'
import { PixelStudyScene } from '../../components/viz/PixelStudyScene'
import { useProgressStore } from '../../stores/progressStore'
import { TutorialCallout } from './TutorialCallout'
import { TutorialTabs } from './TutorialTabs'

export default function HomeScreen() {
  const navigate = useNavigate()
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
            <Button variant="outline" size="xl" onClick={() => navigate('/aprender')}>
              <IconBook size={18} /> Explorar lecciones
            </Button>
          </div>
        </div>

        <div className="hero-right">
          <div className="hero-diagram">
            <HomeMasterWorkers />
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

      {/* ── Cierre ilustrado ─────────────────────────────────────────────── */}
      <div className="home-scene">
        <PixelStudyScene />
      </div>
    </section>
  )
}
