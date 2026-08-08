// TutorialTabs — "Cómo funciona", 3 pasos (handoff §4.5 `.tutorial-tabs.static`
// con los textos adaptados de frontend-spec §6.1). Los 3 navegan a /simulador.
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconCpu, IconPlay, IconUpload, type IconProps } from '../../components/icons/icons'

interface TutStep {
  num: string
  icon: ComponentType<IconProps>
  title: string
  short: string
}

const STEPS: TutStep[] = [
  { num: '01', icon: IconUpload, title: 'Elige o sube tu código', short: 'Un ejemplo del curso o tu archivo .py.' },
  { num: '02', icon: IconCpu, title: 'Configura los hilos', short: 'Decide cuántos hilos quieres.' },
  { num: '03', icon: IconPlay, title: 'Ejecuta y aprende', short: 'Observa la salida y las métricas en vivo.' },
]

export function TutorialTabs() {
  const navigate = useNavigate()
  return (
    <div className="tutorial-tabs static">
      {STEPS.map((step) => {
        const StepIcon = step.icon
        return (
          <button key={step.num} type="button" className="tut-tab active" onClick={() => navigate('/simulador')}>
            <span className="tut-tab-num">{step.num}</span>
            <span className="tut-tab-icon">
              <StepIcon size={16} />
            </span>
            <span className="tut-tab-body">
              <span className="tut-tab-title">{step.title}</span>
              <span className="tut-tab-short">{step.short}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
