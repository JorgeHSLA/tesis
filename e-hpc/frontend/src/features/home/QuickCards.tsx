// QuickCards — "Acciones rápidas" (handoff §4.6 `.qcard`, textos exactos de
// frontend-spec §6.1). La 3ª card es dinámica: retoma en `lastLessonId` con
// los quizzes pendientes del módulo (progreso fusionado de /modules).
import type { ComponentType, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowRight, IconBook, IconCpu, IconPlay, type IconProps } from '../../components/icons/icons'
import type { ModuleDto } from '../../api/types'

interface QuickCardProps {
  accent: 'orange' | 'green' | 'blue'
  icon: ComponentType<IconProps>
  title: string
  desc: ReactNode
  cta: string
  to: string
}

function QuickCard({ accent, icon: CardIcon, title, desc, cta, to }: QuickCardProps) {
  const navigate = useNavigate()
  return (
    <button type="button" className="qcard" data-accent={accent} onClick={() => navigate(to)}>
      <span className="qcard-icon">
        <CardIcon size={22} stroke={1.75} />
      </span>
      <span className="qcard-title">{title}</span>
      <span className="qcard-desc">{desc}</span>
      <span className="qcard-cta">
        {cta} <IconArrowRight size={14} />
      </span>
    </button>
  )
}

interface ContinueInfo {
  desc: string
  to: string
}

/** 3ª card: `Retomas en: {título}. {n} quizzes pendientes en tu módulo.` */
function continueInfo(modules: ModuleDto[] | null, lastLessonId: string | null): ContinueInfo {
  const fallback: ContinueInfo = {
    desc: 'Empieza por: ¿Qué es el paralelismo?',
    to: '/cursos/primerEjemplo',
  }
  if (!modules || !lastLessonId) return fallback
  const mod = modules.find((m) => m.lessons.some((l) => l.id === lastLessonId))
  const lesson = mod?.lessons.find((l) => l.id === lastLessonId)
  if (!mod || !lesson) return fallback
  const pending = mod.lessons.filter((l) => l.has_quiz && !l.progress.completed).length
  return {
    desc: `Retomas en: ${lesson.title}. ${pending} quizzes pendientes en tu módulo.`,
    to: `/cursos/${lastLessonId}`,
  }
}

export interface QuickCardsProps {
  modules: ModuleDto[] | null
  lastLessonId: string | null
}

export function QuickCards({ modules, lastLessonId }: QuickCardsProps) {
  const cont = continueInfo(modules, lastLessonId)
  return (
    <div className="quick-grid">
      <QuickCard
        accent="orange"
        icon={IconCpu}
        title="Configurar una ejecución"
        desc="Elige un ejemplo del curso, define los hilos y ejecútalo en un contenedor aislado."
        cta="Configurar"
        to="/simulador"
      />
      <QuickCard
        accent="green"
        icon={IconPlay}
        title="Ver ejecución en vivo"
        desc="Observa la salida, el CPU y la memoria de tu código en tiempo real."
        cta="Abrir monitor"
        to="/simulador"
      />
      <QuickCard
        accent="blue"
        icon={IconBook}
        title="Continuar aprendiendo"
        desc={cont.desc}
        cta="Continuar"
        to={cont.to}
      />
    </div>
  )
}
