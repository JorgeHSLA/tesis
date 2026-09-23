// TutorialCallout — banner "¿Primera vez aquí?" (handoff §4.5, textos de
// frontend-spec §6.1). S2: el CTA lleva a la primera lección disponible del
// curso (lessonTarget sin última visitada), nunca a un id fijo: la que antes
// se citaba podía estar archivada, deshabilitada o no existir.
import { useNavigate } from 'react-router-dom'
import { IconHelp, IconPlay } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { lessonTarget, useProgressStore } from '../../stores/progressStore'

export function TutorialCallout() {
  const navigate = useNavigate()
  const modules = useProgressStore((s) => s.modules)
  const target = modules != null ? lessonTarget(modules, null) : null

  return (
    <div className="tutorial-callout">
      <span className="tut-callout-icon">
        <IconHelp size={18} />
      </span>
      <div className="tut-callout-body">
        <b>¿Primera vez aquí?</b>
        <p>
          {target != null ? (
            <>
              Te recomendamos empezar por la lección <i>&quot;{target.lesson.title}&quot;</i> — te da todo el
              contexto para entender qué estás ejecutando.
            </>
          ) : (
            'Te recomendamos empezar por la primera lección del curso: te da todo el contexto para entender qué estás ejecutando.'
          )}
        </p>
      </div>
      <Button
        variant="primary"
        size="sm"
        disabled={target == null}
        onClick={() => target != null && navigate(`/aprender/${target.lesson.id}`)}
      >
        <IconPlay size={12} /> Ver lección
      </Button>
    </div>
  )
}
