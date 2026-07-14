// TakeawaysEditor — editor de una lista de textos cortos (inmutable): sirve
// tanto para los `takeaways` ("Lo que vas a aprender") como para las
// `directives` del ejemplo. Añadir/quitar/editar recomputan un nuevo array; el
// componente es controlado (los resets del padre se reflejan sin estado local).
import { useId } from 'react'
import { Button } from '../../../components/ui/Button'
import { IconPlus } from '../../../components/icons/icons'

export interface TakeawaysEditorProps {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  addLabel?: string
  /** Ayuda opcional bajo la lista. */
  hint?: string
}

export function TakeawaysEditor({
  label,
  items,
  onChange,
  placeholder,
  addLabel = 'Añadir',
  hint,
}: TakeawaysEditorProps) {
  const groupId = useId()

  const update = (index: number, text: string) => {
    onChange(items.map((item, i) => (i === index ? text : item)))
  }
  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }
  const add = () => {
    onChange([...items, ''])
  }

  return (
    <div role="group" aria-labelledby={groupId}>
      <div className="field-label" id={groupId}>
        {label}
      </div>
      <div className="col" style={{ gap: 8 }}>
        {items.length === 0 && (
          <p className="mono-small muted" style={{ margin: 0 }}>
            Aún no hay elementos.
          </p>
        )}
        {items.map((item, index) => (
          <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              value={item}
              placeholder={placeholder}
              aria-label={`${label} ${index + 1}`}
              onChange={(e) => update(index, e.currentTarget.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="admin-btn-danger-ghost"
              aria-label={`Quitar elemento ${index + 1}`}
              onClick={() => remove(index)}
            >
              Quitar
            </Button>
          </div>
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={add}>
            <IconPlus size={14} />
            {addLabel}
          </Button>
        </div>
      </div>
      {hint != null && <div className="field-hint">{hint}</div>}
    </div>
  )
}
