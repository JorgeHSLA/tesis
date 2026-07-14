// TutorialCallout — banner "¿Primera vez aquí?" (handoff §4.5, textos de
// frontend-spec §6.1). El CTA navega a la lección LITERAL `primerEjemplo`
// (regla: IDs del catálogo en camelCase, jamás slugificar).
import { useNavigate } from 'react-router-dom'
import { IconHelp, IconPlay } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'

export function TutorialCallout() {
  const navigate = useNavigate()
  return (
    <div className="tutorial-callout">
      <span className="tut-callout-icon">
        <IconHelp size={18} />
      </span>
      <div className="tut-callout-body">
        <b>¿Primera vez aquí?</b>
        <p>
          Te recomendamos empezar por la lección <i>&quot;¿Qué es el paralelismo?&quot;</i> — te da todo el
          contexto para entender qué estás ejecutando.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={() => navigate('/cursos/primerEjemplo')}>
        <IconPlay size={12} /> Ver lección
      </Button>
    </div>
  )
}
